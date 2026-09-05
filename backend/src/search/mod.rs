mod image;
mod lexical;
mod passage;
mod provider;
pub mod query;

use std::collections::{HashMap, HashSet};
use std::env;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use anyhow::{Context, Result};
use axum::{
    extract,
    extract::rejection::JsonRejection,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use git2::{Oid, Repository};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;

use crate::models::AppState;
use lexical::{IndexInput, LexicalHit, LexicalIndex};
use provider::{EmbeddingProvider, OpenAiEmbeddingProvider, ProviderError};
use query::{parse, ParsedQuery, SearchMode};

const SEARCH_WAIT: Duration = Duration::from_millis(1200);
const EMBEDDING_TEMPLATE: &str = "mory-passage-v2:chunker-500-800-80-v2";
const MAX_EMBEDDING_INPUT_CHARS: usize = 4_000;

#[derive(Debug, Clone)]
pub struct SearchConfig {
    pub index_dir: PathBuf,
    pub semantic_enabled: bool,
    pub embedding_model: String,
    pub embedding_dimensions: usize,
    pub vision_model: Option<String>,
}

impl SearchConfig {
    pub fn from_env() -> Result<Self> {
        let embedding_dimensions = env::var("MORIED_OPENAI_EMBEDDING_DIMENSIONS")
            .unwrap_or_else(|_| "1536".to_owned())
            .parse::<usize>()
            .context("MORIED_OPENAI_EMBEDDING_DIMENSIONS must be a positive integer")?;
        anyhow::ensure!(
            embedding_dimensions > 0,
            "embedding dimensions must be positive"
        );
        Ok(Self {
            index_dir: PathBuf::from(
                env::var("MORIED_SEARCH_INDEX_DIR").unwrap_or_else(|_| "search-index".to_owned()),
            ),
            semantic_enabled: env::var("MORIED_SEMANTIC_SEARCH_ENABLED")
                .is_ok_and(|value| value.eq_ignore_ascii_case("true")),
            embedding_model: env::var("MORIED_OPENAI_EMBEDDING_MODEL")
                .unwrap_or_else(|_| "text-embedding-3-small".to_owned()),
            embedding_dimensions,
            vision_model: env::var("MORIED_OPENAI_VISION_MODEL")
                .ok()
                .filter(|value| !value.is_empty()),
        })
    }
}

#[derive(Debug, Clone)]
struct SnapshotEntry {
    path: String,
    blob_id: String,
    mime_type: String,
    title: Option<String>,
    metadata: String,
}

#[derive(Debug, Clone)]
struct SearchSnapshot {
    commit: Oid,
    entries: Vec<SnapshotEntry>,
}

impl SearchSnapshot {
    async fn read(pool: &SqlitePool) -> Result<Self> {
        let mut transaction = pool.begin().await?;
        let commit = sqlx::query_scalar::<_, String>(
            "SELECT value FROM cache_state WHERE key = 'commit_id';",
        )
        .fetch_optional(&mut *transaction)
        .await?
        .and_then(|value| Oid::from_str(&value).ok())
        .unwrap_or_else(Oid::zero);
        let entries = sqlx::query("SELECT path, blob_id, mime_type, title, metadata FROM entry;")
            .map(|row: SqliteRow| SnapshotEntry {
                path: row.get("path"),
                blob_id: row.get("blob_id"),
                mime_type: row.get("mime_type"),
                title: row.get("title"),
                metadata: row.get("metadata"),
            })
            .fetch_all(&mut *transaction)
            .await?;
        Ok(Self { commit, entries })
    }

    fn current_blobs(&self) -> HashMap<&str, &str> {
        self.entries
            .iter()
            .map(|entry| (entry.path.as_str(), entry.blob_id.as_str()))
            .collect()
    }
}

#[derive(Debug, Clone)]
struct ManagerStatus {
    state: String,
    indexed_commit: Option<String>,
    message: Option<String>,
}

pub struct SearchManager {
    config: SearchConfig,
    repo: Arc<std::sync::Mutex<Repository>>,
    cache_db: SqlitePool,
    cache_db_writer: SqlitePool,
    lexical: RwLock<Option<Arc<LexicalIndex>>>,
    status: RwLock<ManagerStatus>,
    writer: AsyncMutex<()>,
    provider: Arc<dyn EmbeddingProvider>,
    provider_gate: AsyncMutex<()>,
    interactive_waiters: AtomicUsize,
    vision_client: reqwest::Client,
    force_rebuild: AtomicBool,
}

impl SearchManager {
    pub async fn new(
        config: SearchConfig,
        repo: Arc<std::sync::Mutex<Repository>>,
        cache_db: SqlitePool,
        cache_db_writer: SqlitePool,
    ) -> Result<Arc<Self>> {
        lexical::recover_directory(&config.index_dir).with_context(|| {
            format!(
                "failed to prepare local search index at {}",
                config.index_dir.display()
            )
        })?;
        let existing = LexicalIndex::open(&config.index_dir).ok().map(Arc::new);
        if existing.is_some() {
            // Indexes created before the ownership marker was introduced are adopted only after
            // Tantivy and the application fingerprint have both validated successfully.
            lexical::mark_managed(&config.index_dir)?;
        }
        let status = if let Some(index) = &existing {
            ManagerStatus {
                state: "ready".to_owned(),
                indexed_commit: Some(index.generation.clone()),
                message: None,
            }
        } else {
            ManagerStatus {
                state: "updating".to_owned(),
                indexed_commit: None,
                message: None,
            }
        };
        let vision_client = reqwest::Client::builder().gzip(true).brotli(true).build()?;
        let provider = Arc::new(OpenAiEmbeddingProvider::new(vision_client.clone()));
        Ok(Arc::new(Self {
            config,
            repo,
            cache_db,
            cache_db_writer,
            lexical: RwLock::new(existing),
            status: RwLock::new(status),
            writer: AsyncMutex::new(()),
            provider,
            provider_gate: AsyncMutex::new(()),
            interactive_waiters: AtomicUsize::new(0),
            vision_client,
            force_rebuild: AtomicBool::new(false),
        }))
    }

    pub async fn reconcile_initial(&self) -> Result<()> {
        self.reconcile_current().await
    }

    pub fn spawn(self: &Arc<Self>) {
        let manager = self.clone();
        tokio::spawn(async move {
            let mut delay = Duration::from_secs(1);
            loop {
                tokio::time::sleep(delay).await;
                match manager.reconcile_current().await {
                    Ok(()) => {
                        delay = Duration::from_secs(2);
                        if manager.config.semantic_enabled
                            && manager.interactive_waiters.load(Ordering::SeqCst) == 0
                        {
                            if let Err(error) = manager.ingest_embedding_batch().await {
                                tracing::warn!("Semantic indexing batch failed: {error:?}");
                            }
                            if let Err(error) = manager.ingest_image_description().await {
                                tracing::warn!("Image description indexing failed: {error:?}");
                            }
                        }
                    },
                    Err(error) => {
                        tracing::warn!("Search index reconciliation failed: {error:?}");
                        delay = (delay * 2).min(Duration::from_secs(30));
                    },
                }
            }
        });
    }

    async fn reconcile_current(&self) -> Result<()> {
        let _writer = self.writer.lock().await;
        let snapshot = SearchSnapshot::read(&self.cache_db).await?;
        let generation = snapshot.commit.to_string();
        let descriptions = self.cached_image_descriptions(&snapshot).await?;
        let content_version = description_version(&descriptions);
        let passage_generation: Option<String> =
            sqlx::query_scalar("SELECT value FROM search_state WHERE key = 'passage_commit';")
                .fetch_optional(&self.cache_db)
                .await?;
        if !self.force_rebuild.load(Ordering::SeqCst)
            && passage_generation.as_deref() == Some(generation.as_str())
            && self.lexical.read().unwrap().as_ref().is_some_and(|index| {
                index.generation == generation && index.content_version == content_version
            })
        {
            return Ok(());
        }
        *self.status.write().unwrap() = ManagerStatus {
            state: "updating".to_owned(),
            indexed_commit: self
                .lexical
                .read()
                .unwrap()
                .as_ref()
                .map(|index| index.generation.clone()),
            message: None,
        };

        let force_rebuild = self.force_rebuild.load(Ordering::SeqCst);
        let incremental_index = self.lexical.read().unwrap().clone().filter(|index| {
            !force_rebuild
                && index.generation != generation
                && index.content_version == content_version
                && passage_generation.as_deref() == Some(index.generation.as_str())
        });
        let incremental_base = incremental_index
            .as_ref()
            .map(|index| index.generation.clone());
        let repo = self.repo.clone();
        let (inputs, changed_paths) = tokio::task::spawn_blocking(move || -> Result<_> {
            let changed_paths = incremental_base
                .as_deref()
                .and_then(|base| changed_paths(&repo, base, snapshot.commit).ok());
            let inputs = build_inputs(&repo, &snapshot, &descriptions)?;
            Ok((inputs, changed_paths))
        })
        .await??;
        let destination = self.config.index_dir.clone();
        let build = lexical::unique_sibling(&destination, "building");
        let generation_for_build = generation.clone();
        let version_for_build = content_version.clone();
        let build_inputs_copy = inputs.clone();
        let built = tokio::task::spawn_blocking(move || -> Result<()> {
            if let (Some(index), Some(changed_paths)) = (incremental_index, changed_paths) {
                if index
                    .update(
                        &generation_for_build,
                        &version_for_build,
                        &changed_paths,
                        &build_inputs_copy,
                    )
                    .is_ok()
                {
                    return Ok(());
                }
            }
            drop(LexicalIndex::build(
                &build,
                &generation_for_build,
                &version_for_build,
                &build_inputs_copy,
            )?);
            lexical::replace_directory(&build, &destination)?;
            Ok(())
        })
        .await?;
        if let Err(error) = built {
            *self.status.write().unwrap() = ManagerStatus {
                state: "error".to_owned(),
                indexed_commit: self
                    .lexical
                    .read()
                    .unwrap()
                    .as_ref()
                    .map(|index| index.generation.clone()),
                message: Some(
                    "The local text index could not be updated; retrying automatically.".to_owned(),
                ),
            };
            return Err(error);
        }
        let opened = Arc::new(LexicalIndex::open(&self.config.index_dir)?);
        self.replace_passage_snapshot(&generation, &inputs).await?;
        if let Some(model) = &self.config.vision_model {
            let _ = sqlx::query(
                "UPDATE search_image_description SET last_used = ?
                 WHERE model = ? AND prompt_version = ? AND preprocess = ? AND detail = ?
                   AND blob_id IN (
                       SELECT blob_id FROM search_passage WHERE content_kind = 'image_description'
                   );",
            )
            .bind(Utc::now().timestamp())
            .bind(model)
            .bind(image::PROMPT_VERSION)
            .bind(image::PREPROCESS_VERSION)
            .bind(image::DETAIL)
            .execute(&self.cache_db_writer)
            .await;
        }
        *self.lexical.write().unwrap() = Some(opened);
        *self.status.write().unwrap() = ManagerStatus {
            state: "ready".to_owned(),
            indexed_commit: Some(generation),
            message: None,
        };
        self.force_rebuild.store(false, Ordering::SeqCst);
        Ok(())
    }

    async fn replace_passage_snapshot(
        &self,
        generation: &str,
        inputs: &[IndexInput],
    ) -> Result<()> {
        let mut transaction = self.cache_db_writer.begin().await?;
        sqlx::query("DELETE FROM search_passage;")
            .execute(&mut *transaction)
            .await?;
        for input in inputs {
            let semantic_text = format!(
                "{}\n{}\n{}\n{}",
                input.title.as_deref().unwrap_or(""),
                input.passage.heading,
                input.tags,
                input.passage.text,
            )
            .chars()
            // Passage text is already capped at 800 approximate tokens. This additional
            // conservative ceiling prevents pathological titles or tag lists from approaching
            // the embeddings endpoint's 8,192-token per-input limit.
            .take(MAX_EMBEDDING_INPUT_CHARS)
            .collect::<String>();
            sqlx::query(
                "INSERT INTO search_passage (
                    path, blob_id, passage_id, text_hash, start_byte, end_byte,
                    start_line, end_line, mime_type, title, snippet, semantic_text, content_kind
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            )
            .bind(&input.path)
            .bind(&input.blob_id)
            .bind(&input.passage.passage_id)
            .bind(&input.passage.text_hash)
            .bind(input.passage.start_byte as i64)
            .bind(input.passage.end_byte as i64)
            .bind((input.content_kind == "source").then_some(input.passage.start_line as i64))
            .bind((input.content_kind == "source").then_some(input.passage.end_line as i64))
            .bind(&input.mime_type)
            .bind(&input.title)
            .bind(&input.passage.text)
            .bind(semantic_text)
            .bind(&input.content_kind)
            .execute(&mut *transaction)
            .await?;
        }
        sqlx::query(
            "INSERT INTO search_state (key, value) VALUES ('passage_commit', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
        )
        .bind(generation)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn wait_for(&self, commit: Oid) -> bool {
        let wanted = commit.to_string();
        if self
            .lexical
            .read()
            .unwrap()
            .as_ref()
            .is_some_and(|index| index.generation == wanted)
        {
            return true;
        }
        let _ = tokio::time::timeout(SEARCH_WAIT, self.reconcile_current()).await;
        self.lexical
            .read()
            .unwrap()
            .as_ref()
            .is_some_and(|index| index.generation == wanted)
    }

    fn lexical_status(&self) -> IndexStatus {
        let status = self.status.read().unwrap().clone();
        IndexStatus {
            state: status.state,
            indexed_commit: status.indexed_commit,
            message: status.message,
        }
    }

    fn lexical_status_for(&self, commit: Oid) -> IndexStatus {
        let mut status = self.lexical_status();
        if status.state == "ready"
            && status.indexed_commit.as_deref() != Some(commit.to_string().as_str())
        {
            status.state = "updating".to_owned();
        }
        status
    }

    fn search_text(
        &self,
        commit: Oid,
        parsed: &ParsedQuery,
        limit: usize,
    ) -> Result<Vec<LexicalHit>> {
        let lexical = self
            .lexical
            .read()
            .unwrap()
            .clone()
            .context("lexical index is not available")?;
        anyhow::ensure!(
            lexical.generation == commit.to_string(),
            "lexical generation changed"
        );
        match lexical.search(parsed, limit) {
            Ok(hits) => Ok(hits),
            Err(error) => {
                self.force_rebuild.store(true, Ordering::SeqCst);
                *self.status.write().unwrap() = ManagerStatus {
                    state: "error".to_owned(),
                    indexed_commit: Some(lexical.generation.clone()),
                    message: Some(
                        "The local text index could not be read; rebuilding automatically."
                            .to_owned(),
                    ),
                };
                Err(error)
            },
        }
    }

    async fn cached_image_descriptions(
        &self,
        snapshot: &SearchSnapshot,
    ) -> Result<Vec<CachedDescription>> {
        let Some(model) = &self.config.vision_model else {
            return Ok(Vec::new());
        };
        let current = snapshot
            .entries
            .iter()
            .map(|entry| entry.blob_id.as_str())
            .collect::<HashSet<_>>();
        let rows = sqlx::query(
            "SELECT blob_id, description, visible_text FROM search_image_description
             WHERE model = ? AND prompt_version = ? AND preprocess = ? AND detail = ?
               AND state = 'ready';",
        )
        .bind(model)
        .bind(image::PROMPT_VERSION)
        .bind(image::PREPROCESS_VERSION)
        .bind(image::DETAIL)
        .map(|row: SqliteRow| CachedDescription {
            blob_id: row.get("blob_id"),
            description: row.get("description"),
            visible_text: row.get("visible_text"),
        })
        .fetch_all(&self.cache_db)
        .await?;
        Ok(rows
            .into_iter()
            .filter(|row| current.contains(row.blob_id.as_str()))
            .collect())
    }

    async fn ingest_image_description(&self) -> Result<()> {
        if !self.config.semantic_enabled || self.interactive_waiters.load(Ordering::SeqCst) > 0 {
            return Ok(());
        }
        let Some(model) = self.config.vision_model.clone() else {
            return Ok(());
        };
        let snapshot = SearchSnapshot::read(&self.cache_db).await?;
        let now = Utc::now().timestamp();
        let mut seen = HashSet::new();
        let mut selected = None;
        for entry in &snapshot.entries {
            if entry.path == ".mory"
                || entry.path.starts_with(".mory/")
                || !image::supported(&entry.mime_type, std::path::Path::new(&entry.path))
                || !seen.insert(entry.blob_id.clone())
            {
                continue;
            }
            let cached = sqlx::query(
                "SELECT state, next_retry FROM search_image_description
                 WHERE blob_id = ? AND model = ? AND prompt_version = ?
                   AND preprocess = ? AND detail = ?;",
            )
            .bind(&entry.blob_id)
            .bind(&model)
            .bind(image::PROMPT_VERSION)
            .bind(image::PREPROCESS_VERSION)
            .bind(image::DETAIL)
            .fetch_optional(&self.cache_db)
            .await?;
            let eligible = match cached {
                None => true,
                Some(row) if row.get::<String, _>("state") == "pending" => row
                    .try_get::<i64, _>("next_retry")
                    .map_or(true, |retry| retry <= now),
                _ => false,
            };
            if eligible {
                selected = Some(entry.clone());
                break;
            }
        }
        let Some(selected) = selected else {
            return Ok(());
        };
        let source = {
            let repo = self.repo.lock().unwrap();
            let source = repo
                .find_blob(Oid::from_str(&selected.blob_id)?)?
                .content()
                .to_vec();
            source
        };
        let gate = self.provider_gate.lock().await;
        let result = image::describe(&self.vision_client, &model, &source).await;
        drop(gate);
        // A delayed response may outlive a delete. A rename is safe because the blob remains in
        // the selected generation and the next rebuild attaches the cached description to its new path.
        let current = SearchSnapshot::read(&self.cache_db).await?;
        if !current
            .entries
            .iter()
            .any(|entry| entry.blob_id == selected.blob_id)
        {
            return Ok(());
        }
        match result {
            Ok(description) => {
                sqlx::query(
                    "INSERT INTO search_image_description (
                        blob_id, model, prompt_version, preprocess, detail, description,
                        visible_text, state, last_attempt, next_retry, last_used
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, NULL, ?)
                     ON CONFLICT(blob_id, model, prompt_version, preprocess, detail) DO UPDATE SET
                        description = excluded.description, visible_text = excluded.visible_text,
                        state = 'ready', last_attempt = excluded.last_attempt,
                        next_retry = NULL, last_used = excluded.last_used;",
                )
                .bind(&selected.blob_id)
                .bind(&model)
                .bind(image::PROMPT_VERSION)
                .bind(image::PREPROCESS_VERSION)
                .bind(image::DETAIL)
                .bind(description.description)
                .bind(description.visible_text)
                .bind(now)
                .bind(now)
                .execute(&self.cache_db_writer)
                .await?;
            },
            Err(error) => {
                tracing::warn!("Image description provider failure: {error}");
                let retry_seconds = error
                    .retry_after
                    .unwrap_or(Duration::from_secs(30))
                    .as_secs()
                    .min(i64::MAX.saturating_sub(now) as u64)
                    as i64;
                let state = if error.retryable { "pending" } else { "failed" };
                sqlx::query(
                    "INSERT INTO search_image_description (
                        blob_id, model, prompt_version, preprocess, detail, description,
                        visible_text, state, last_attempt, next_retry, last_used
                     ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
                     ON CONFLICT(blob_id, model, prompt_version, preprocess, detail) DO UPDATE SET
                        description = NULL, visible_text = NULL, state = excluded.state,
                        last_attempt = excluded.last_attempt, next_retry = excluded.next_retry;",
                )
                .bind(&selected.blob_id)
                .bind(&model)
                .bind(image::PROMPT_VERSION)
                .bind(image::PREPROCESS_VERSION)
                .bind(image::DETAIL)
                .bind(state)
                .bind(now)
                .bind(if error.retryable {
                    Some(now + retry_seconds)
                } else {
                    None
                })
                .bind(now)
                .execute(&self.cache_db_writer)
                .await?;
            },
        }
        Ok(())
    }

    async fn ingest_embedding_batch(&self) -> Result<()> {
        if !self.config.semantic_enabled || self.interactive_waiters.load(Ordering::SeqCst) > 0 {
            return Ok(());
        }
        let now = Utc::now().timestamp();
        let pending = sqlx::query(
            "SELECT DISTINCT p.passage_id, p.text_hash, p.semantic_text
             FROM search_passage p
             LEFT JOIN search_embedding e
               ON e.passage_id = p.passage_id
              AND e.model = ? AND e.dimensions = ? AND e.template = ?
             WHERE e.passage_id IS NULL OR e.text_hash != p.text_hash
                OR (e.state = 'pending' AND coalesce(e.next_retry, 0) <= ?)
             LIMIT 32;",
        )
        .bind(&self.config.embedding_model)
        .bind(self.config.embedding_dimensions as i64)
        .bind(EMBEDDING_TEMPLATE)
        .bind(now)
        .map(|row: SqliteRow| PendingEmbedding {
            passage_id: row.get("passage_id"),
            text_hash: row.get("text_hash"),
            text: row.get("semantic_text"),
        })
        .fetch_all(&self.cache_db)
        .await?;
        if pending.is_empty() {
            self.garbage_collect_embeddings().await?;
            return Ok(());
        }
        // Every passage is capped at 800 approximate tokens, so 32 inputs remain far below the
        // endpoint's 300,000-token request ceiling as well as its 8,192-token per-input ceiling.
        let input = pending
            .iter()
            .map(|item| item.text.clone())
            .collect::<Vec<_>>();
        let _gate = self.provider_gate.lock().await;
        let response = self
            .provider
            .embed(
                &input,
                &self.config.embedding_model,
                self.config.embedding_dimensions,
            )
            .await;
        drop(_gate);
        let response = match response {
            Ok(vectors) if vectors.len() == pending.len() => vectors
                .into_iter()
                .map(|vector| normalize_vector(vector, self.config.embedding_dimensions))
                .collect::<Result<Vec<_>>>()
                .map_err(|error| ProviderError {
                    retryable: false,
                    retry_after: None,
                    message: error.to_string(),
                }),
            Ok(_) => Err(ProviderError {
                retryable: false,
                retry_after: None,
                message: "embedding response count mismatch".to_owned(),
            }),
            Err(error) => Err(error),
        };
        match response {
            Ok(vectors) => {
                let mut transaction = self.cache_db_writer.begin().await?;
                for (item, vector) in pending.iter().zip(vectors) {
                    sqlx::query(
                        "INSERT INTO search_embedding (
                            passage_id, text_hash, model, dimensions, template, vector, norm,
                            state, last_attempt, next_retry, last_used
                         ) VALUES (?, ?, ?, ?, ?, ?, 1.0, 'ready', ?, NULL, ?)
                         ON CONFLICT(passage_id, model, dimensions, template) DO UPDATE SET
                            text_hash = excluded.text_hash, vector = excluded.vector,
                            norm = excluded.norm, state = excluded.state,
                            last_attempt = excluded.last_attempt, next_retry = NULL,
                            last_used = excluded.last_used;",
                    )
                    .bind(&item.passage_id)
                    .bind(&item.text_hash)
                    .bind(&self.config.embedding_model)
                    .bind(self.config.embedding_dimensions as i64)
                    .bind(EMBEDDING_TEMPLATE)
                    .bind(encode_vector(&vector))
                    .bind(now)
                    .bind(now)
                    .execute(&mut *transaction)
                    .await?;
                }
                transaction.commit().await?;
            },
            Err(error) => {
                tracing::warn!("Embedding ingestion provider failure: {error}");
                let retry_seconds = error
                    .retry_after
                    .unwrap_or(Duration::from_secs(30))
                    .as_secs()
                    .min(i64::MAX.saturating_sub(now) as u64)
                    as i64;
                let state = if error.retryable { "pending" } else { "failed" };
                let mut transaction = self.cache_db_writer.begin().await?;
                for item in &pending {
                    sqlx::query(
                        "INSERT INTO search_embedding (
                            passage_id, text_hash, model, dimensions, template, vector, norm,
                            state, last_attempt, next_retry, last_used
                         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
                         ON CONFLICT(passage_id, model, dimensions, template) DO UPDATE SET
                            text_hash = excluded.text_hash, vector = NULL, norm = NULL,
                            state = excluded.state, last_attempt = excluded.last_attempt,
                            next_retry = excluded.next_retry;",
                    )
                    .bind(&item.passage_id)
                    .bind(&item.text_hash)
                    .bind(&self.config.embedding_model)
                    .bind(self.config.embedding_dimensions as i64)
                    .bind(EMBEDDING_TEMPLATE)
                    .bind(state)
                    .bind(now)
                    .bind(if error.retryable {
                        Some(now + retry_seconds)
                    } else {
                        None
                    })
                    .bind(now)
                    .execute(&mut *transaction)
                    .await?;
                }
                transaction.commit().await?;
            },
        }
        Ok(())
    }

    async fn embed_interactive(&self, text: &str) -> std::result::Result<Vec<f32>, ProviderError> {
        self.interactive_waiters.fetch_add(1, Ordering::SeqCst);
        let gate = self.provider_gate.lock().await;
        self.interactive_waiters.fetch_sub(1, Ordering::SeqCst);
        let result = self
            .provider
            .embed(
                &[text.to_owned()],
                &self.config.embedding_model,
                self.config.embedding_dimensions,
            )
            .await;
        drop(gate);
        let mut vectors = result?;
        if vectors.len() != 1 {
            return Err(ProviderError {
                retryable: false,
                retry_after: None,
                message: "embedding response count mismatch".to_owned(),
            });
        }
        normalize_vector(vectors.remove(0), self.config.embedding_dimensions).map_err(|error| {
            ProviderError {
                retryable: false,
                retry_after: None,
                message: error.to_string(),
            }
        })
    }

    async fn search_semantic(
        &self,
        commit: Oid,
        parsed: &ParsedQuery,
        limit: usize,
    ) -> std::result::Result<Vec<SearchHit>, SemanticSearchError> {
        let mut snapshot = begin_semantic_snapshot(&self.cache_db, commit).await?;
        let lexical = self
            .lexical
            .read()
            .unwrap()
            .clone()
            .ok_or(SemanticSearchError::Generation)?;
        if lexical.generation != commit.to_string() {
            return Err(SemanticSearchError::Generation);
        }
        let parsed_for_filters = parsed.clone();
        let allowed =
            tokio::task::spawn_blocking(move || lexical.matching_passages(&parsed_for_filters))
                .await
                .map_err(|error| SemanticSearchError::Internal(error.into()))?
                .map_err(SemanticSearchError::Internal)?;
        let rows = sqlx::query(
            "SELECT p.path, p.blob_id, p.passage_id, p.mime_type, p.title,
                    p.start_line, p.end_line, p.snippet, p.content_kind, e.vector
             FROM search_passage p
             JOIN search_embedding e
               ON e.passage_id = p.passage_id AND e.text_hash = p.text_hash
              AND e.model = ? AND e.dimensions = ? AND e.template = ?
              AND e.state = 'ready';",
        )
        .bind(&self.config.embedding_model)
        .bind(self.config.embedding_dimensions as i64)
        .bind(EMBEDDING_TEMPLATE)
        .fetch_all(&mut *snapshot)
        .await
        .map_err(|error| SemanticSearchError::Internal(error.into()))?;
        snapshot
            .commit()
            .await
            .map_err(|error| SemanticSearchError::Internal(error.into()))?;
        let mut corrupt = Vec::new();
        let candidates = rows
            .into_iter()
            .filter_map(|row| {
                let path: String = row.get("path");
                let passage_id: String = row.get("passage_id");
                if !allowed.contains(&(path.clone(), passage_id.clone())) {
                    return None;
                }
                let vector = row
                    .try_get::<Vec<u8>, _>("vector")
                    .ok()
                    .and_then(|bytes| decode_vector(&bytes, self.config.embedding_dimensions));
                let Some(vector) = vector else {
                    corrupt.push(passage_id);
                    return None;
                };
                Some(SemanticCandidate {
                    path,
                    blob_id: row.get("blob_id"),
                    passage_id,
                    mime_type: row.get("mime_type"),
                    title: row.get("title"),
                    start_line: row
                        .try_get::<i64, _>("start_line")
                        .ok()
                        .map(|value| value as usize),
                    end_line: row
                        .try_get::<i64, _>("end_line")
                        .ok()
                        .map(|value| value as usize),
                    snippet: row.get("snippet"),
                    content_kind: row.get("content_kind"),
                    vector,
                })
            })
            .collect::<Vec<_>>();
        if !corrupt.is_empty() {
            let mut transaction = self
                .cache_db_writer
                .begin()
                .await
                .map_err(|error| SemanticSearchError::Internal(error.into()))?;
            for passage_id in corrupt {
                sqlx::query(
                    "UPDATE search_embedding
                     SET vector = NULL, norm = NULL, state = 'pending', next_retry = 0
                     WHERE passage_id = ? AND model = ? AND dimensions = ? AND template = ?;",
                )
                .bind(passage_id)
                .bind(&self.config.embedding_model)
                .bind(self.config.embedding_dimensions as i64)
                .bind(EMBEDDING_TEMPLATE)
                .execute(&mut *transaction)
                .await
                .map_err(|error| SemanticSearchError::Internal(error.into()))?;
            }
            transaction
                .commit()
                .await
                .map_err(|error| SemanticSearchError::Internal(error.into()))?;
        }
        let query_vector = self
            .embed_interactive(&parsed.semantic_text())
            .await
            .map_err(SemanticSearchError::Provider)?;
        let hits = tokio::task::spawn_blocking(move || {
            score_semantic_candidates(candidates, &query_vector, limit)
        })
        .await
        .map_err(|error| SemanticSearchError::Internal(error.into()))?;
        let now = Utc::now().timestamp();
        let _ = sqlx::query(
            "UPDATE search_embedding SET last_used = ?
             WHERE model = ? AND dimensions = ? AND template = ? AND state = 'ready'
               AND passage_id IN (SELECT passage_id FROM search_passage);",
        )
        .bind(now)
        .bind(&self.config.embedding_model)
        .bind(self.config.embedding_dimensions as i64)
        .bind(EMBEDDING_TEMPLATE)
        .execute(&self.cache_db_writer)
        .await;
        Ok(hits)
    }

    async fn garbage_collect_embeddings(&self) -> Result<()> {
        let cutoff = Utc::now().timestamp() - 30 * 24 * 60 * 60;
        sqlx::query(
            "DELETE FROM search_embedding
             WHERE last_used < ? AND (
                 passage_id NOT IN (SELECT passage_id FROM search_passage)
                 OR model != ? OR dimensions != ? OR template != ?
             );",
        )
        .bind(cutoff)
        .bind(&self.config.embedding_model)
        .bind(self.config.embedding_dimensions as i64)
        .bind(EMBEDDING_TEMPLATE)
        .execute(&self.cache_db_writer)
        .await?;
        if let Some(model) = &self.config.vision_model {
            sqlx::query(
                "DELETE FROM search_image_description
                 WHERE last_used < ? AND (
                     blob_id NOT IN (SELECT blob_id FROM entry)
                     OR model != ? OR prompt_version != ? OR preprocess != ? OR detail != ?
                 );",
            )
            .bind(cutoff)
            .bind(model)
            .bind(image::PROMPT_VERSION)
            .bind(image::PREPROCESS_VERSION)
            .bind(image::DETAIL)
            .execute(&self.cache_db_writer)
            .await?;
        } else {
            sqlx::query(
                "DELETE FROM search_image_description
                 WHERE last_used < ? AND blob_id NOT IN (SELECT blob_id FROM entry);",
            )
            .bind(cutoff)
            .execute(&self.cache_db_writer)
            .await?;
        }
        Ok(())
    }

    async fn semantic_status(&self) -> Result<SemanticStatus> {
        let passage_total: i64 =
            sqlx::query_scalar("SELECT count(DISTINCT passage_id) FROM search_passage;")
                .fetch_one(&self.cache_db)
                .await?;
        let (image_total, described_images, image_failed) = if let Some(model) =
            &self.config.vision_model
        {
            let image_total: i64 = sqlx::query_scalar(
                "SELECT count(DISTINCT blob_id) FROM entry
                 WHERE path NOT LIKE '.mory/%' AND path != '.mory'
                   AND mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff');",
            ).fetch_one(&self.cache_db).await?;
            let described: i64 = sqlx::query_scalar(
                "SELECT count(DISTINCT blob_id) FROM search_passage WHERE content_kind = 'image_description';",
            ).fetch_one(&self.cache_db).await?;
            let failed: i64 = sqlx::query_scalar(
                "SELECT count(DISTINCT d.blob_id) FROM search_image_description d
                 WHERE d.model = ? AND d.prompt_version = ? AND d.preprocess = ? AND d.detail = ?
                   AND d.state = 'failed'
                   AND EXISTS (SELECT 1 FROM entry e WHERE e.blob_id = d.blob_id);",
            )
            .bind(model)
            .bind(image::PROMPT_VERSION)
            .bind(image::PREPROCESS_VERSION)
            .bind(image::DETAIL)
            .fetch_one(&self.cache_db)
            .await?;
            (image_total, described, failed)
        } else {
            (0, 0, 0)
        };
        let total = passage_total + image_total.saturating_sub(described_images);
        if !self.config.semantic_enabled {
            return Ok(SemanticStatus {
                state: "disabled".to_owned(),
                indexed: 0,
                total: total as usize,
                failed: 0,
            });
        }
        let indexed: i64 = sqlx::query_scalar(
            "SELECT count(DISTINCT p.passage_id) FROM search_passage p
             JOIN search_embedding e ON e.passage_id = p.passage_id AND e.text_hash = p.text_hash
             WHERE e.model = ? AND e.dimensions = ? AND e.template = ? AND e.state = 'ready';",
        )
        .bind(&self.config.embedding_model)
        .bind(self.config.embedding_dimensions as i64)
        .bind(EMBEDDING_TEMPLATE)
        .fetch_one(&self.cache_db)
        .await?;
        let embedding_failed: i64 = sqlx::query_scalar(
            "SELECT count(DISTINCT p.passage_id) FROM search_passage p
             JOIN search_embedding e ON e.passage_id = p.passage_id AND e.text_hash = p.text_hash
             WHERE e.model = ? AND e.dimensions = ? AND e.template = ? AND e.state = 'failed';",
        )
        .bind(&self.config.embedding_model)
        .bind(self.config.embedding_dimensions as i64)
        .bind(EMBEDDING_TEMPLATE)
        .fetch_one(&self.cache_db)
        .await?;
        let failed = embedding_failed + image_failed;
        Ok(SemanticStatus {
            state: if indexed + failed >= total {
                "ready"
            } else {
                "indexing"
            }
            .to_owned(),
            indexed: indexed as usize,
            total: total as usize,
            failed: failed as usize,
        })
    }
}

async fn begin_semantic_snapshot(
    pool: &SqlitePool,
    commit: Oid,
) -> std::result::Result<sqlx::Transaction<'static, sqlx::Sqlite>, SemanticSearchError> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| SemanticSearchError::Internal(error.into()))?;
    let passage_commit: Option<String> =
        sqlx::query_scalar("SELECT value FROM search_state WHERE key = 'passage_commit';")
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| SemanticSearchError::Internal(error.into()))?;
    if passage_commit.as_deref() != Some(commit.to_string().as_str()) {
        return Err(SemanticSearchError::Generation);
    }
    Ok(transaction)
}

#[derive(Debug)]
struct PendingEmbedding {
    passage_id: String,
    text_hash: String,
    text: String,
}

#[derive(Debug, Clone)]
struct CachedDescription {
    blob_id: String,
    description: String,
    visible_text: String,
}

fn description_version(descriptions: &[CachedDescription]) -> String {
    let mut rows = descriptions
        .iter()
        .map(|description| {
            format!(
                "{}\0{}\0{}",
                description.blob_id, description.description, description.visible_text
            )
        })
        .collect::<Vec<_>>();
    rows.sort();
    format!("{:x}", Sha1::digest(rows.join("\n").as_bytes()))
}

#[derive(Debug)]
enum SemanticSearchError {
    Provider(ProviderError),
    Generation,
    Internal(anyhow::Error),
}

#[derive(Debug)]
struct SemanticCandidate {
    path: String,
    blob_id: String,
    passage_id: String,
    mime_type: String,
    title: Option<String>,
    start_line: Option<usize>,
    end_line: Option<usize>,
    snippet: String,
    content_kind: String,
    vector: Vec<f32>,
}

fn score_semantic_candidates(
    candidates: Vec<SemanticCandidate>,
    query: &[f32],
    limit: usize,
) -> Vec<SearchHit> {
    let mut hits = candidates
        .into_iter()
        .filter_map(|candidate| {
            let score = dot(query, &candidate.vector);
            score.is_finite().then_some(SearchHit {
                path: candidate.path,
                blob_id: candidate.blob_id,
                passage_id: candidate.passage_id,
                mime_type: candidate.mime_type,
                title: candidate.title,
                start_line: candidate.start_line,
                end_line: candidate.end_line,
                snippet: candidate.snippet,
                content_kind: candidate.content_kind,
                sources: vec![SearchMode::Semantic],
                score: Some(score),
            })
        })
        .collect::<Vec<_>>();
    hits.sort_by(|left, right| {
        right
            .score
            .unwrap_or_default()
            .total_cmp(&left.score.unwrap_or_default())
            .then_with(|| left.path.cmp(&right.path))
            .then_with(|| left.passage_id.cmp(&right.passage_id))
    });
    hits.truncate(limit);
    hits
}

fn normalize_vector(mut vector: Vec<f32>, dimensions: usize) -> Result<Vec<f32>> {
    anyhow::ensure!(vector.len() == dimensions, "embedding dimension mismatch");
    anyhow::ensure!(
        vector.iter().all(|value| value.is_finite()),
        "embedding contains a non-finite value"
    );
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    anyhow::ensure!(norm.is_finite() && norm > 0.0, "embedding norm is invalid");
    for value in &mut vector {
        *value /= norm;
    }
    Ok(vector)
}

fn encode_vector(vector: &[f32]) -> Vec<u8> {
    vector
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

fn decode_vector(bytes: &[u8], dimensions: usize) -> Option<Vec<f32>> {
    if bytes.len() != dimensions * std::mem::size_of::<f32>() {
        return None;
    }
    let vector = bytes
        .chunks_exact(4)
        .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
        .collect::<Vec<_>>();
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if vector.iter().all(|value| value.is_finite())
        && norm.is_finite()
        && (norm - 1.0).abs() <= 0.01
    {
        Some(vector)
    } else {
        None
    }
}

fn dot(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right)
        .map(|(left, right)| left * right)
        .sum()
}

fn build_inputs(
    repo: &Arc<std::sync::Mutex<Repository>>,
    snapshot: &SearchSnapshot,
    descriptions: &[CachedDescription],
) -> Result<Vec<IndexInput>> {
    let repo = repo.lock().unwrap();
    let mut inputs = Vec::new();
    let descriptions = descriptions
        .iter()
        .map(|description| (description.blob_id.as_str(), description))
        .collect::<HashMap<_, _>>();
    for entry in &snapshot.entries {
        if entry.path == ".mory" || entry.path.starts_with(".mory/") {
            continue;
        }
        if !entry.path.ends_with(".md") {
            if image::supported(&entry.mime_type, std::path::Path::new(&entry.path)) {
                if let Some(description) = descriptions.get(entry.blob_id.as_str()) {
                    let text = if description.visible_text.trim().is_empty() {
                        format!(
                            "AI-generated image description: {}",
                            description.description
                        )
                    } else {
                        format!(
                            "AI-generated image description: {}\nVisible text: {}",
                            description.description, description.visible_text,
                        )
                    };
                    let text_hash = format!("{:x}", Sha1::digest(text.as_bytes()));
                    let identity = format!("{}:image:{text_hash}", entry.blob_id);
                    inputs.push(IndexInput {
                        path: entry.path.clone(),
                        blob_id: entry.blob_id.clone(),
                        mime_type: entry.mime_type.clone(),
                        title: entry.title.clone(),
                        tags: String::new(),
                        passage: passage::Passage {
                            passage_id: format!("{:x}", Sha1::digest(identity.as_bytes())),
                            start_byte: 0,
                            end_byte: 0,
                            start_line: 0,
                            end_line: 0,
                            heading: String::new(),
                            text,
                            text_hash,
                        },
                        content_kind: "image_description".to_owned(),
                    });
                }
            }
            continue;
        }
        let blob_id = Oid::from_str(&entry.blob_id)?;
        let blob = repo.find_blob(blob_id)?;
        let Ok(source) = std::str::from_utf8(blob.content()) else {
            continue;
        };
        let tags = selected_tags(&entry.metadata);
        for passage in passage::passages(&entry.blob_id, source) {
            inputs.push(IndexInput {
                path: entry.path.clone(),
                blob_id: entry.blob_id.clone(),
                mime_type: entry.mime_type.clone(),
                title: entry.title.clone(),
                tags: tags.clone(),
                passage,
                content_kind: "source".to_owned(),
            });
        }
    }
    Ok(inputs)
}

fn changed_paths(
    repo: &Arc<std::sync::Mutex<Repository>>,
    base: &str,
    target: Oid,
) -> Result<HashSet<String>> {
    let repo = repo.lock().unwrap();
    let base = repo.find_commit(Oid::from_str(base)?)?.tree()?;
    let target = repo.find_commit(target)?.tree()?;
    let diff = repo.diff_tree_to_tree(Some(&base), Some(&target), None)?;
    let mut paths = HashSet::new();
    for delta in diff.deltas() {
        for path in [delta.old_file().path(), delta.new_file().path()]
            .into_iter()
            .flatten()
        {
            paths.insert(
                path.to_str()
                    .context("search cannot index a non-UTF-8 path")?
                    .to_owned(),
            );
        }
    }
    Ok(paths)
}

fn selected_tags(metadata: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(metadata) else {
        return String::new();
    };
    match value.get("tags") {
        Some(serde_json::Value::Array(tags)) => tags
            .iter()
            .filter_map(|tag| tag.as_str())
            .collect::<Vec<_>>()
            .join(" "),
        Some(serde_json::Value::String(tag)) => tag.clone(),
        _ => String::new(),
    }
}

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub mode: SearchMode,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    50
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    requested_mode: SearchMode,
    executed_modes: Vec<SearchMode>,
    commit: String,
    head: String,
    lexical: IndexStatus,
    semantic: SemanticStatus,
    warnings: Vec<SearchWarning>,
    hits: Vec<SearchHit>,
}

#[derive(Debug, Serialize)]
pub struct SearchStatusResponse {
    commit: String,
    head: String,
    lexical: IndexStatus,
    semantic: SemanticStatus,
}

#[derive(Debug, Serialize)]
struct IndexStatus {
    state: String,
    indexed_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Debug, Serialize)]
struct SemanticStatus {
    state: String,
    indexed: usize,
    total: usize,
    failed: usize,
}

#[derive(Debug, Serialize)]
struct SearchWarning {
    code: String,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchHit {
    path: String,
    blob_id: String,
    passage_id: String,
    mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end_line: Option<usize>,
    snippet: String,
    content_kind: String,
    sources: Vec<SearchMode>,
    score: Option<f32>,
}

#[derive(Debug, Serialize)]
struct SearchErrorBody {
    code: String,
    message: String,
}

fn search_error(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (
        status,
        Json(SearchErrorBody {
            code: code.to_owned(),
            message: message.into(),
        }),
    )
        .into_response()
}

pub async fn get_status(extract::State(state): extract::State<AppState>) -> Response {
    if let Err(error) = state.ensure_cache().await {
        tracing::error!("Search status cache sync failed: {error:?}");
        return search_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "search_unavailable",
            "Search status is temporarily unavailable.",
        );
    }
    let snapshot = match SearchSnapshot::read(&state.cache_db).await {
        Ok(snapshot) => snapshot,
        Err(error) => {
            tracing::error!("Search status snapshot failed: {error:?}");
            return search_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "search_unavailable",
                "Search status is temporarily unavailable.",
            );
        },
    };
    let semantic = match state.search.semantic_status().await {
        Ok(status) => status,
        Err(error) => {
            tracing::error!("Semantic status failed: {error:?}");
            return search_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "search_unavailable",
                "Search status is temporarily unavailable.",
            );
        },
    };
    Json(SearchStatusResponse {
        commit: snapshot.commit.to_string(),
        head: state
            .head_commit_id()
            .unwrap_or(snapshot.commit)
            .to_string(),
        lexical: state.search.lexical_status_for(snapshot.commit),
        semantic,
    })
    .into_response()
}

pub async fn post_search(
    extract::State(state): extract::State<AppState>,
    payload: std::result::Result<Json<SearchRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match payload {
        Ok(request) => request,
        Err(_) => {
            return search_error(
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "Search request JSON is invalid.",
            )
        },
    };
    if request.query.trim().is_empty() || request.query.len() > 2048 {
        return search_error(
            StatusCode::BAD_REQUEST,
            "invalid_query",
            "Query must contain 1–2,048 UTF-8 bytes.",
        );
    }
    if !(1..=100).contains(&request.limit) {
        return search_error(
            StatusCode::BAD_REQUEST,
            "invalid_limit",
            "Limit must be between 1 and 100.",
        );
    }
    if let Err(error) = state.ensure_cache().await {
        tracing::error!("Search cache sync failed: {error:?}");
        return search_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "search_unavailable",
            "Search is temporarily unavailable.",
        );
    }
    let snapshot = match SearchSnapshot::read(&state.cache_db).await {
        Ok(snapshot) => snapshot,
        Err(error) => {
            tracing::error!("Search snapshot failed: {error:?}");
            return search_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "search_unavailable",
                "Search is temporarily unavailable.",
            );
        },
    };
    let head = state.head_commit_id().unwrap_or(snapshot.commit);
    let semantic = state
        .search
        .semantic_status()
        .await
        .unwrap_or(SemanticStatus {
            state: "error".to_owned(),
            indexed: 0,
            total: 0,
            failed: 0,
        });

    if request.mode == SearchMode::Grep {
        return match grep_at(
            &env::var("MORIED_GIT_DIR").unwrap(),
            &request.query,
            snapshot.commit,
        )
        .await
        {
            Ok(found) => {
                let entries = snapshot
                    .entries
                    .iter()
                    .map(|entry| (entry.path.as_str(), entry))
                    .collect::<HashMap<_, _>>();
                let hits = found
                    .into_iter()
                    .take(request.limit)
                    .filter_map(|found| {
                        let entry = entries.get(found.file.as_str())?;
                        let identity =
                            format!("grep:{}:{}:{}", snapshot.commit, found.file, found.line);
                        Some(SearchHit {
                            path: found.file,
                            blob_id: entry.blob_id.clone(),
                            passage_id: format!("{:x}", Sha1::digest(identity.as_bytes())),
                            mime_type: entry.mime_type.clone(),
                            title: entry.title.clone(),
                            start_line: Some(found.line),
                            end_line: Some(found.line),
                            snippet: found.content,
                            content_kind: "source".to_owned(),
                            sources: vec![SearchMode::Grep],
                            score: None,
                        })
                    })
                    .collect();
                Json(SearchResponse {
                    requested_mode: request.mode,
                    executed_modes: vec![SearchMode::Grep],
                    commit: snapshot.commit.to_string(),
                    head: head.to_string(),
                    lexical: state.search.lexical_status_for(snapshot.commit),
                    semantic,
                    warnings: vec![],
                    hits,
                })
                .into_response()
            },
            Err(GrepError::Invalid) => search_error(
                StatusCode::BAD_REQUEST,
                "invalid_grep_pattern",
                "The Grep pattern is invalid.",
            ),
            Err(GrepError::Internal(error)) => {
                tracing::error!("git grep failed: {error:?}");
                search_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "grep_failed",
                    "Grep could not be completed.",
                )
            },
        };
    }

    let parsed = match parse(&request.query) {
        Ok(parsed) => parsed,
        Err(error) => {
            return search_error(StatusCode::BAD_REQUEST, "invalid_query", error.to_string())
        },
    };
    if request.mode == SearchMode::Semantic && parsed.semantic_text().is_empty() {
        return search_error(
            StatusCode::BAD_REQUEST,
            "semantic_query_has_only_filters",
            "Semantic search needs a positive title or body term.",
        );
    }
    if request.mode == SearchMode::Semantic && !state.search.config.semantic_enabled {
        return search_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "semantic_disabled",
            "Semantic search is disabled on this server.",
        );
    }
    if !state.search.wait_for(snapshot.commit).await {
        return search_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "lexical_index_updating",
            "The local text index is updating. Please retry shortly.",
        );
    }

    let mut warnings = Vec::new();
    let mut executed_modes = vec![SearchMode::Text];
    if request.mode == SearchMode::Hybrid && !state.search.config.semantic_enabled {
        warnings.push(SearchWarning {
            code: "semantic_disabled_fallback".to_owned(),
            message: "Semantic search is disabled; Hybrid executed Text only.".to_owned(),
        });
    } else if request.mode == SearchMode::Hybrid && parsed.semantic_text().is_empty() {
        warnings.push(SearchWarning {
            code: "hybrid_lexical_only".to_owned(),
            message: "This query contains only filters; Hybrid executed Text only.".to_owned(),
        });
    }
    if matches!(request.mode, SearchMode::Semantic | SearchMode::Hybrid)
        && semantic.indexed < semantic.total
    {
        warnings.push(SearchWarning {
            code: "semantic_partial_coverage".to_owned(),
            message: format!(
                "Semantic indexing covers {} of {} passages; results may be incomplete.",
                semantic.indexed, semantic.total,
            ),
        });
    }

    let lexical_hits = match state.search.search_text(snapshot.commit, &parsed, 100) {
        Ok(hits) => hits,
        Err(error) => {
            tracing::error!("Lexical search failed: {error:?}");
            return search_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "lexical_index_updating",
                "The local text index changed while searching. Please retry.",
            );
        },
    };
    let current = snapshot.current_blobs();
    let text_hits = lexical_hits
        .into_iter()
        .filter(|hit| {
            current
                .get(hit.path.as_str())
                .is_some_and(|blob| **blob == hit.blob_id)
        })
        .map(|hit| SearchHit {
            path: hit.path,
            blob_id: hit.blob_id,
            passage_id: hit.passage_id,
            mime_type: hit.mime_type,
            title: hit.title,
            start_line: hit.start_line,
            end_line: hit.end_line,
            snippet: hit.snippet,
            content_kind: hit.content_kind,
            sources: vec![SearchMode::Text],
            score: Some(hit.score),
        })
        .collect::<Vec<_>>();

    let should_run_semantic = state.search.config.semantic_enabled
        && !parsed.semantic_text().is_empty()
        && matches!(request.mode, SearchMode::Semantic | SearchMode::Hybrid);
    let hits = if should_run_semantic {
        match state
            .search
            .search_semantic(snapshot.commit, &parsed, 100)
            .await
        {
            Ok(semantic_hits) => {
                let semantic_hits = semantic_hits
                    .into_iter()
                    .filter(|hit| {
                        current
                            .get(hit.path.as_str())
                            .is_some_and(|blob| **blob == hit.blob_id)
                    })
                    .collect::<Vec<_>>();
                if request.mode == SearchMode::Semantic {
                    executed_modes = vec![SearchMode::Semantic];
                    diversify(semantic_hits, request.limit)
                } else {
                    executed_modes = vec![SearchMode::Text, SearchMode::Semantic];
                    diversify(fuse_rrf(text_hits, semantic_hits), request.limit)
                }
            },
            Err(SemanticSearchError::Provider(error)) => {
                tracing::warn!("Interactive semantic query failed: {error}");
                if request.mode == SearchMode::Semantic {
                    return search_error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "semantic_unavailable",
                        "Semantic search is temporarily unavailable.",
                    );
                }
                warnings.push(SearchWarning {
                    code: "semantic_unavailable_fallback".to_owned(),
                    message:
                        "Semantic search is temporarily unavailable; Hybrid executed Text only."
                            .to_owned(),
                });
                diversify(text_hits, request.limit)
            },
            Err(SemanticSearchError::Generation) => {
                if request.mode == SearchMode::Semantic {
                    return search_error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "semantic_index_updating",
                        "The semantic candidate map is updating. Please retry shortly.",
                    );
                }
                warnings.push(SearchWarning {
                    code: "semantic_index_updating_fallback".to_owned(),
                    message: "The semantic candidate map is updating; Hybrid executed Text only."
                        .to_owned(),
                });
                diversify(text_hits, request.limit)
            },
            Err(SemanticSearchError::Internal(error)) => {
                tracing::error!("Semantic scan failed: {error:?}");
                if request.mode == SearchMode::Semantic {
                    return search_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "semantic_unavailable",
                        "Semantic search is temporarily unavailable.",
                    );
                }
                warnings.push(SearchWarning {
                    code: "semantic_unavailable_fallback".to_owned(),
                    message:
                        "Semantic search is temporarily unavailable; Hybrid executed Text only."
                            .to_owned(),
                });
                diversify(text_hits, request.limit)
            },
        }
    } else {
        diversify(text_hits, request.limit)
    };

    Json(SearchResponse {
        requested_mode: request.mode,
        executed_modes,
        commit: snapshot.commit.to_string(),
        head: head.to_string(),
        lexical: state.search.lexical_status_for(snapshot.commit),
        semantic,
        warnings,
        hits,
    })
    .into_response()
}

fn fuse_rrf(text: Vec<SearchHit>, semantic: Vec<SearchHit>) -> Vec<SearchHit> {
    const K: f32 = 60.0;
    let mut fused: HashMap<(String, String), SearchHit> = HashMap::new();
    for (source, hits) in [(SearchMode::Text, text), (SearchMode::Semantic, semantic)] {
        for (index, mut hit) in hits.into_iter().enumerate() {
            let contribution = 1.0 / (K + index as f32 + 1.0);
            let key = (hit.path.clone(), hit.passage_id.clone());
            if let Some(existing) = fused.get_mut(&key) {
                existing.score = Some(existing.score.unwrap_or_default() + contribution);
                if !existing.sources.contains(&source) {
                    existing.sources.push(source);
                }
            } else {
                hit.score = Some(contribution);
                hit.sources = vec![source];
                fused.insert(key, hit);
            }
        }
    }
    fused.into_values().collect()
}

fn diversify(mut hits: Vec<SearchHit>, limit: usize) -> Vec<SearchHit> {
    hits.sort_by(|left, right| {
        right
            .score
            .unwrap_or_default()
            .total_cmp(&left.score.unwrap_or_default())
            .then_with(|| left.path.cmp(&right.path))
            .then_with(|| left.start_line.cmp(&right.start_line))
    });
    let mut per_file: HashMap<String, usize> = HashMap::new();
    let mut ranges: HashMap<String, Vec<(usize, usize)>> = HashMap::new();
    let mut result = Vec::new();
    for hit in hits {
        if per_file.get(&hit.path).copied().unwrap_or(0) >= 3 {
            continue;
        }
        let range = (hit.start_line.unwrap_or(0), hit.end_line.unwrap_or(0));
        let overlaps = range.0 != range.1
            && ranges.get(&hit.path).is_some_and(|existing| {
                existing.iter().any(|other| {
                    let overlap = range.1.min(other.1).saturating_sub(range.0.max(other.0)) + 1;
                    let shorter = (range.1.saturating_sub(range.0) + 1)
                        .min(other.1.saturating_sub(other.0) + 1);
                    overlap * 2 >= shorter
                })
            });
        if overlaps {
            continue;
        }
        *per_file.entry(hit.path.clone()).or_default() += 1;
        ranges.entry(hit.path.clone()).or_default().push(range);
        result.push(hit);
        if result.len() == limit {
            break;
        }
    }
    result
}

#[derive(Debug)]
struct GrepMatch {
    file: String,
    line: usize,
    content: String,
}

#[derive(Debug)]
enum GrepError {
    Invalid,
    Internal(anyhow::Error),
}

async fn grep_at(
    git_dir: &str,
    pattern: &str,
    revision: Oid,
) -> std::result::Result<Vec<GrepMatch>, GrepError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(git_dir)
        .arg("grep")
        .arg("--line-number")
        .arg("--null")
        .arg("-I")
        .arg("-e")
        .arg(pattern)
        .arg(revision.to_string())
        .arg("--")
        .env("LC_ALL", "C")
        .output()
        .await
        .map_err(|error| GrepError::Internal(error.into()))?;
    if output.status.code() == Some(1) {
        return Ok(Vec::new());
    }
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("Invalid regular expression") || stderr.contains("invalid regex") {
            return Err(GrepError::Invalid);
        }
        return Err(GrepError::Internal(anyhow::anyhow!(
            "git grep exited {:?}",
            output.status.code()
        )));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let prefix = format!("{revision}:");
    let mut results = Vec::new();
    for line in stdout.lines() {
        let mut parts = line.split('\0');
        let Some(file) = parts.next() else {
            continue;
        };
        let Some(number) = parts.next().and_then(|value| value.parse().ok()) else {
            continue;
        };
        let Some(content) = parts.next() else {
            continue;
        };
        results.push(GrepMatch {
            file: file.strip_prefix(&prefix).unwrap_or(file).to_owned(),
            line: number,
            content: content.to_owned(),
        });
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::provider::DeterministicEmbeddingProvider;
    use crate::search::query::{Field, Occur};

    fn commit_file(
        repo: &Repository,
        root: &std::path::Path,
        body: &str,
        parents: &[&git2::Commit<'_>],
    ) -> Oid {
        std::fs::write(root.join("note.md"), body).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("note.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = git2::Signature::now("Search Test", "search@example.invalid").unwrap();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "search fixture",
            &tree,
            parents,
        )
        .unwrap()
    }

    #[test]
    fn hard_filters_are_applied_without_native_query_syntax() {
        let parsed = parse("path:research +title:検索 -body:obsolete").unwrap();
        assert_eq!(parsed.clauses[0].field, Field::Path);
        assert_eq!(parsed.clauses[1].occur, Occur::Required);
        assert_eq!(parsed.clauses[2].occur, Occur::Excluded);
    }

    #[test]
    fn result_diversity_caps_each_file() {
        let hits = (0..5)
            .map(|line| SearchHit {
                path: "one.md".to_owned(),
                blob_id: "b".to_owned(),
                passage_id: line.to_string(),
                mime_type: "text/markdown".to_owned(),
                title: None,
                start_line: Some(line * 10),
                end_line: Some(line * 10 + 2),
                snippet: String::new(),
                content_kind: "source".to_owned(),
                sources: vec![SearchMode::Text],
                score: Some(10.0 - line as f32),
            })
            .collect();
        assert_eq!(diversify(hits, 10).len(), 3);
    }

    #[test]
    fn hybrid_rrf_merges_identical_passages_and_records_both_sources() {
        let hit = |source| SearchHit {
            path: "one.md".to_owned(),
            blob_id: "blob".to_owned(),
            passage_id: "passage".to_owned(),
            mime_type: "text/markdown".to_owned(),
            title: None,
            start_line: Some(1),
            end_line: Some(1),
            snippet: "text".to_owned(),
            content_kind: "source".to_owned(),
            sources: vec![source],
            score: Some(1.0),
        };
        let fused = fuse_rrf(vec![hit(SearchMode::Text)], vec![hit(SearchMode::Semantic)]);
        assert_eq!(fused.len(), 1);
        assert_eq!(
            fused[0].sources,
            vec![SearchMode::Text, SearchMode::Semantic]
        );
        assert!((fused[0].score.unwrap() - 2.0 / 61.0).abs() < f32::EPSILON);
    }

    #[test]
    fn rejects_corrupt_or_mixed_dimension_vectors() {
        assert!(normalize_vector(vec![1.0, f32::NAN], 2).is_err());
        assert!(normalize_vector(vec![1.0], 2).is_err());
        assert!(decode_vector(&[0; 7], 2).is_none());
    }

    #[tokio::test]
    async fn tests_use_a_deterministic_local_embedding_provider() {
        let provider = DeterministicEmbeddingProvider;
        let vectors = provider
            .embed(&["same".to_owned(), "same".to_owned()], "test", 8)
            .await
            .unwrap();
        assert_eq!(vectors[0], vectors[1]);
        assert_eq!(vectors[0].len(), 8);
    }

    #[tokio::test]
    async fn grep_uses_a_fixed_commit_and_treats_option_like_patterns_as_data() {
        let directory = tempfile::tempdir().unwrap();
        let repo = Repository::init(directory.path()).unwrap();
        let first = commit_file(&repo, directory.path(), "-danger\n", &[]);
        let first_commit = repo.find_commit(first).unwrap();
        let second = commit_file(&repo, directory.path(), "replacement\n", &[&first_commit]);

        let found = grep_at(directory.path().to_str().unwrap(), "-danger", first)
            .await
            .unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file, "note.md");
        assert!(grep_at(directory.path().to_str().unwrap(), "absent", first)
            .await
            .unwrap()
            .is_empty());
        assert!(matches!(
            grep_at(directory.path().to_str().unwrap(), "[", first).await,
            Err(GrepError::Invalid)
        ));
        drop(first_commit);
        drop(repo);
        let repo = Arc::new(std::sync::Mutex::new(
            Repository::open(directory.path()).unwrap(),
        ));
        assert_eq!(
            changed_paths(&repo, &first.to_string(), second).unwrap(),
            HashSet::from(["note.md".to_owned()]),
        );
    }

    #[tokio::test]
    async fn semantic_candidate_reads_stay_on_the_selected_generation() {
        use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
        use std::str::FromStr;

        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("semantic.sqlite");
        let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", database.display()))
            .unwrap()
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
        let writer = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await
            .unwrap();
        let reader = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.read_only(true))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE search_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .execute(&writer)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE search_passage (passage_id TEXT NOT NULL);")
            .execute(&writer)
            .await
            .unwrap();
        let first = Oid::from_str(&"1".repeat(40)).unwrap();
        let second = Oid::from_str(&"2".repeat(40)).unwrap();
        sqlx::query("INSERT INTO search_state VALUES ('passage_commit', ?);")
            .bind(first.to_string())
            .execute(&writer)
            .await
            .unwrap();
        sqlx::query("INSERT INTO search_passage VALUES ('old');")
            .execute(&writer)
            .await
            .unwrap();

        let mut snapshot = begin_semantic_snapshot(&reader, first).await.unwrap();
        let mut replacement = writer.begin().await.unwrap();
        sqlx::query("UPDATE search_state SET value = ? WHERE key = 'passage_commit';")
            .bind(second.to_string())
            .execute(&mut *replacement)
            .await
            .unwrap();
        sqlx::query("DELETE FROM search_passage;")
            .execute(&mut *replacement)
            .await
            .unwrap();
        sqlx::query("INSERT INTO search_passage VALUES ('new');")
            .execute(&mut *replacement)
            .await
            .unwrap();
        replacement.commit().await.unwrap();

        let passage: String = sqlx::query_scalar("SELECT passage_id FROM search_passage;")
            .fetch_one(&mut *snapshot)
            .await
            .unwrap();
        assert_eq!(passage, "old");
        snapshot.commit().await.unwrap();
        let current: String = sqlx::query_scalar("SELECT passage_id FROM search_passage;")
            .fetch_one(&reader)
            .await
            .unwrap();
        assert_eq!(current, "new");
    }
}
