mod image;
mod lexical;
mod passage;
mod provider;
pub mod query;

use std::collections::{HashMap, HashSet};
use std::env;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

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
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::{watch, Mutex as AsyncMutex, MutexGuard, Notify};

use crate::models::AppState;
use lexical::{IndexInput, LexicalHit, LexicalIndex};
use provider::{EmbeddingProvider, Failure, OpenAiEmbeddingProvider, ProviderError};
use query::{parse, ParsedQuery, SearchMode};

const SEARCH_WAIT: Duration = Duration::from_millis(1200);
const EMBEDDING_TEMPLATE: &str = "mory-passage-v3:chunker-500-800-80-v3";
const MAX_EMBEDDING_INPUT_BYTES: usize = 8_192;
const MAX_EMBEDDING_REQUEST_BYTES: usize = 300_000;
const MAX_GREP_RECORD_BYTES: usize = 64 * 1024;
// How soon background work tries again after standing aside for a search, or after a failure
// the provider pause does not cover. It is the interval the loop used to poll at.
const BACKGROUND_RETRY_DELAY: Duration = Duration::from_secs(2);
const PROVIDER_BACKOFF: Duration = Duration::from_secs(30);
const MAX_PROVIDER_BACKOFF: Duration = Duration::from_secs(60 * 60);
const FAILED_IMAGE_COUNT_SQL: &str =
    "SELECT count(DISTINCT d.blob_id) FROM search_image_description d
     WHERE d.model = ? AND d.prompt_version = ? AND d.preprocess = ? AND d.detail = ?
       AND d.state = 'failed'
       AND EXISTS (
           SELECT 1 FROM entry e WHERE e.blob_id = d.blob_id
             AND e.path NOT LIKE '.mory/%' AND e.path != '.mory'
             AND e.mime_type IN (
                 'image/jpeg', 'image/png', 'image/webp', 'image/gif',
                 'image/bmp', 'image/tiff'
             )
       );";

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
    // Separate because OpenAI rate-limits each model on its own, so a limited vision model must
    // not hold back embeddings. An outage or an exhausted quota refuses both, and both back off.
    embedding_backoff: ProviderBackoff,
    image_backoff: ProviderBackoff,
    force_rebuild: AtomicBool,
    rebuild_requested: Notify,
}

struct InteractiveWaiter<'a> {
    count: &'a AtomicUsize,
}

impl<'a> InteractiveWaiter<'a> {
    fn new(count: &'a AtomicUsize) -> Self {
        count.fetch_add(1, Ordering::SeqCst);
        Self { count }
    }
}

impl Drop for InteractiveWaiter<'_> {
    fn drop(&mut self) {
        self.count.fetch_sub(1, Ordering::SeqCst);
    }
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
        lexical::adopt_legacy(&config.index_dir).with_context(|| {
            format!(
                "failed to recognize an existing local search index at {}",
                config.index_dir.display()
            )
        })?;
        let existing = LexicalIndex::open(&config.index_dir).ok().map(Arc::new);
        if existing.is_some() {
            // A compatible index may predate the ownership marker even without needing a rebuild.
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
            embedding_backoff: ProviderBackoff::new("Embedding"),
            image_backoff: ProviderBackoff::new("Image description"),
            force_rebuild: AtomicBool::new(false),
            rebuild_requested: Notify::new(),
        }))
    }

    pub async fn reconcile_initial(&self) -> Result<()> {
        self.reconcile_current().await
    }

    /// Runs indexing in the background whenever there may be something to do.
    ///
    /// `listing` announces each sync of the entry cache, the only thing that changes what there is
    /// to index. Between those, the loop sleeps until a retry or a provider pause is due, or
    /// until a search asks for a rebuild, instead of rereading the listing every few seconds.
    pub fn spawn(self: &Arc<Self>, mut listing: watch::Receiver<Option<Oid>>) {
        let manager = self.clone();
        tokio::spawn(async move {
            // The first pass reads the listing as it stands, so any earlier sync is covered.
            listing.mark_unchanged();
            let mut failure_delay = Duration::from_secs(1);
            loop {
                let wake = match manager.reconcile_current().await {
                    Ok(()) => {
                        failure_delay = Duration::from_secs(1);
                        let embeddings =
                            manager.ingest_embedding_batch().await.unwrap_or_else(|error| {
                                tracing::warn!("Semantic indexing batch failed: {error:?}");
                                Wake::After(BACKGROUND_RETRY_DELAY)
                            });
                        let images =
                            manager.ingest_image_description().await.unwrap_or_else(|error| {
                                tracing::warn!("Image description indexing failed: {error:?}");
                                Wake::After(BACKGROUND_RETRY_DELAY)
                            });
                        embeddings.min(images)
                    },
                    Err(error) => {
                        tracing::warn!("Search index reconciliation failed: {error:?}");
                        failure_delay = (failure_delay * 2).min(Duration::from_secs(30));
                        Wake::After(failure_delay)
                    },
                };
                wait_for_work(wake, &mut listing, &manager.rebuild_requested).await;
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
            let semantic_text = bounded_embedding_input(&format!(
                "{}\n{}\n{}\n{}",
                input.title.as_deref().unwrap_or(""),
                input.passage.heading,
                input.tags,
                input.passage.text,
            ));
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
                self.rebuild_requested.notify_one();
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

    fn validate_query(
        &self,
        commit: Oid,
        parsed: &ParsedQuery,
    ) -> std::result::Result<(), QueryValidationError> {
        let lexical = self
            .lexical
            .read()
            .unwrap()
            .clone()
            .ok_or(QueryValidationError::Generation)?;
        validate_query_at(&lexical, commit, parsed)
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

    async fn ingest_image_description(&self) -> Result<Wake> {
        let Some(model) = self
            .config
            .vision_model
            .clone()
            .filter(|_| self.config.semantic_enabled)
        else {
            return Ok(Wake::Never);
        };
        if self.interactive_waiters.load(Ordering::SeqCst) > 0 {
            return Ok(Wake::After(BACKGROUND_RETRY_DELAY));
        }
        if let Some(wake) = self.image_backoff.blocked() {
            return Ok(wake);
        }
        let snapshot = SearchSnapshot::read(&self.cache_db).await?;
        let now = Utc::now().timestamp();
        // One query for every image rather than one per image: a library of a few hundred images
        // made those lookups nearly all of the database traffic of a pass.
        let attempts = sqlx::query(
            "SELECT blob_id, state, next_retry FROM search_image_description
             WHERE model = ? AND prompt_version = ? AND preprocess = ? AND detail = ?;",
        )
        .bind(&model)
        .bind(image::PROMPT_VERSION)
        .bind(image::PREPROCESS_VERSION)
        .bind(image::DETAIL)
        .map(|row: SqliteRow| {
            (
                row.get::<String, _>("blob_id"),
                ImageAttempt {
                    state: row.get("state"),
                    next_retry: row.get("next_retry"),
                },
            )
        })
        .fetch_all(&self.cache_db)
        .await?
        .into_iter()
        .collect::<HashMap<_, _>>();
        let selected = match next_image(&snapshot.entries, &attempts, now) {
            NextImage::Due(entry) => entry.clone(),
            NextImage::RetryAt(retry) => return Ok(Wake::at(retry, now)),
            NextImage::Idle => return Ok(Wake::Never),
        };
        let source = {
            let repo = self.repo.lock().unwrap();
            let source = repo
                .find_blob(Oid::from_str(&selected.blob_id)?)?
                .content()
                .to_vec();
            source
        };
        let Some(gate) = try_background_gate(&self.provider_gate, &self.interactive_waiters) else {
            return Ok(Wake::After(BACKGROUND_RETRY_DELAY));
        };
        let result = image::describe(&self.vision_client, &model, &source).await;
        drop(gate);
        self.image_backoff.record(&result);
        // A delayed response may outlive a delete. A rename is safe because the blob remains in
        // the selected generation and the next rebuild attaches the cached description to its new path.
        let current = SearchSnapshot::read(&self.cache_db).await?;
        if !current
            .entries
            .iter()
            .any(|entry| entry.blob_id == selected.blob_id)
        {
            return Ok(Wake::Now);
        }
        let wake = wake_after_attempt(&result, &self.image_backoff);
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
                let state = if error.retryable() { "pending" } else { "failed" };
                let (last_attempt, next_retry) = failure_timestamps(&error);
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
                .bind(last_attempt)
                .bind(next_retry)
                .bind(last_attempt)
                .execute(&self.cache_db_writer)
                .await?;
            },
        }
        Ok(wake)
    }

    async fn ingest_embedding_batch(&self) -> Result<Wake> {
        if !self.config.semantic_enabled {
            return Ok(Wake::Never);
        }
        if self.interactive_waiters.load(Ordering::SeqCst) > 0 {
            return Ok(Wake::After(BACKGROUND_RETRY_DELAY));
        }
        if let Some(wake) = self.embedding_backoff.blocked() {
            return Ok(wake);
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
            // Every passage still waiting has a retry time after `now`, or it would be pending.
            let retry = sqlx::query_scalar::<_, Option<i64>>(
                "SELECT min(e.next_retry) FROM search_embedding e
                 JOIN search_passage p ON p.passage_id = e.passage_id AND p.text_hash = e.text_hash
                 WHERE e.model = ? AND e.dimensions = ? AND e.template = ?
                   AND e.state = 'pending';",
            )
            .bind(&self.config.embedding_model)
            .bind(self.config.embedding_dimensions as i64)
            .bind(EMBEDDING_TEMPLATE)
            .fetch_one(&self.cache_db)
            .await?;
            return Ok(retry.map_or(Wake::Never, |retry| Wake::at(retry, now)));
        }
        // UTF-8 bytes conservatively bound model tokens without coupling the cache to a provider
        // tokenizer implementation.
        let mut request_bytes = 0;
        let input = pending
            .iter()
            .map(|item| bounded_embedding_input(&item.text))
            .take_while(|text| {
                let fits = request_bytes + text.len() <= MAX_EMBEDDING_REQUEST_BYTES;
                if fits {
                    request_bytes += text.len();
                }
                fits
            })
            .collect::<Vec<_>>();
        let pending = &pending[..input.len()];
        let Some(_gate) = try_background_gate(&self.provider_gate, &self.interactive_waiters) else {
            return Ok(Wake::After(BACKGROUND_RETRY_DELAY));
        };
        let response = self
            .provider
            .embed(
                &input,
                &self.config.embedding_model,
                self.config.embedding_dimensions,
            )
            .await;
        drop(_gate);
        self.embedding_backoff.record(&response);
        let response = response.and_then(|vectors| {
            validate_embedding_vectors(
                vectors,
                pending.len(),
                self.config.embedding_dimensions,
            )
        });
        let wake = wake_after_attempt(&response, &self.embedding_backoff);
        match response {
            Ok(vectors) => {
                let mut transaction = self.cache_db_writer.begin().await?;
                for (item, vector) in pending.iter().zip(vectors) {
                    match vector {
                        Ok(vector) => {
                            sqlx::query(
                                "INSERT INTO search_embedding (
                                    passage_id, text_hash, model, dimensions, template, vector,
                                    norm, state, last_attempt, next_retry, last_used
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
                        },
                        Err(error) => {
                            tracing::warn!(
                                passage_id = %item.passage_id,
                                "Rejected malformed embedding vector: {error}"
                            );
                            sqlx::query(
                                "INSERT INTO search_embedding (
                                    passage_id, text_hash, model, dimensions, template, vector,
                                    norm, state, last_attempt, next_retry, last_used
                                 ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'failed', ?, NULL, ?)
                                 ON CONFLICT(passage_id, model, dimensions, template) DO UPDATE SET
                                    text_hash = excluded.text_hash, vector = NULL, norm = NULL,
                                    state = excluded.state, last_attempt = excluded.last_attempt,
                                    next_retry = NULL, last_used = excluded.last_used;",
                            )
                            .bind(&item.passage_id)
                            .bind(&item.text_hash)
                            .bind(&self.config.embedding_model)
                            .bind(self.config.embedding_dimensions as i64)
                            .bind(EMBEDDING_TEMPLATE)
                            .bind(now)
                            .bind(now)
                            .execute(&mut *transaction)
                            .await?;
                        },
                    }
                }
                transaction.commit().await?;
            },
            Err(error) => {
                tracing::warn!("Embedding ingestion provider failure: {error}");
                let state = if error.retryable() { "pending" } else { "failed" };
                let (last_attempt, next_retry) = failure_timestamps(&error);
                let mut transaction = self.cache_db_writer.begin().await?;
                for item in pending {
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
                    .bind(last_attempt)
                    .bind(next_retry)
                    .bind(last_attempt)
                    .execute(&mut *transaction)
                    .await?;
                }
                transaction.commit().await?;
            },
        }
        Ok(wake)
    }

    async fn embed_interactive(&self, text: &str) -> std::result::Result<Vec<f32>, ProviderError> {
        let _waiter = InteractiveWaiter::new(&self.interactive_waiters);
        let gate = self.provider_gate.lock().await;
        let result = self
            .provider
            .embed(
                &[text.to_owned()],
                &self.config.embedding_model,
                self.config.embedding_dimensions,
            )
            .await;
        drop(gate);
        // A search is never held back by the pause, since the person asking is waiting on it,
        // but what it learns about the limit applies to indexing too.
        self.embedding_backoff.record(&result);
        let mut vectors = result?;
        if vectors.len() != 1 {
            return Err(provider::failure(Failure::Item, "embedding response count mismatch"));
        }
        normalize_vector(vectors.remove(0), self.config.embedding_dimensions)
            .map_err(|error| provider::failure(Failure::Item, error.to_string()))
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

    async fn semantic_status_for(&self, commit: Oid) -> Result<SemanticStatus> {
        let mut snapshot = self.cache_db.begin().await?;
        let passage_commit: Option<String> =
            sqlx::query_scalar("SELECT value FROM search_state WHERE key = 'passage_commit';")
                .fetch_optional(&mut *snapshot)
                .await?;
        let entry_commit: Option<String> =
            sqlx::query_scalar("SELECT value FROM cache_state WHERE key = 'commit_id';")
                .fetch_optional(&mut *snapshot)
                .await?;
        let expected = commit.to_string();
        if passage_commit.as_deref() != Some(expected.as_str())
            || entry_commit.as_deref() != Some(expected.as_str())
        {
            return Ok(SemanticStatus {
                state: if self.config.semantic_enabled {
                    "indexing"
                } else {
                    "disabled"
                }
                .to_owned(),
                indexed: 0,
                total: 0,
                failed: 0,
            });
        }
        let passage_total: i64 =
            sqlx::query_scalar("SELECT count(DISTINCT passage_id) FROM search_passage;")
                .fetch_one(&mut *snapshot)
                .await?;
        let (image_total, described_images, image_failed) = if let Some(model) =
            &self.config.vision_model
        {
            let image_total: i64 = sqlx::query_scalar(
                "SELECT count(DISTINCT blob_id) FROM entry
                 WHERE path NOT LIKE '.mory/%' AND path != '.mory'
                   AND mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff');",
            ).fetch_one(&mut *snapshot).await?;
            let described: i64 = sqlx::query_scalar(
                "SELECT count(DISTINCT blob_id) FROM search_passage WHERE content_kind = 'image_description';",
            ).fetch_one(&mut *snapshot).await?;
            let failed: i64 = sqlx::query_scalar(FAILED_IMAGE_COUNT_SQL)
            .bind(model)
            .bind(image::PROMPT_VERSION)
            .bind(image::PREPROCESS_VERSION)
            .bind(image::DETAIL)
            .fetch_one(&mut *snapshot)
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
        .fetch_one(&mut *snapshot)
        .await?;
        let embedding_failed: i64 = sqlx::query_scalar(
            "SELECT count(DISTINCT p.passage_id) FROM search_passage p
             JOIN search_embedding e ON e.passage_id = p.passage_id AND e.text_hash = p.text_hash
             WHERE e.model = ? AND e.dimensions = ? AND e.template = ? AND e.state = 'failed';",
        )
        .bind(&self.config.embedding_model)
        .bind(self.config.embedding_dimensions as i64)
        .bind(EMBEDDING_TEMPLATE)
        .fetch_one(&mut *snapshot)
        .await?;
        let failed = embedding_failed + image_failed;
        let status = SemanticStatus {
            state: if indexed + failed >= total {
                "ready"
            } else {
                "indexing"
            }
            .to_owned(),
            indexed: indexed as usize,
            total: total as usize,
            failed: failed as usize,
        };
        snapshot.commit().await?;
        Ok(status)
    }
}

fn bounded_embedding_input(text: &str) -> String {
    if text.len() <= MAX_EMBEDDING_INPUT_BYTES {
        return text.to_owned();
    }
    let mut end = MAX_EMBEDDING_INPUT_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    // Tokenization cannot produce more tokens than there are input bytes, making this a
    // provider-independent conservative enforcement of the endpoint's token ceiling.
    text[..end].to_owned()
}

fn try_background_gate<'a>(
    gate: &'a AsyncMutex<()>,
    interactive_waiters: &AtomicUsize,
) -> Option<MutexGuard<'a, ()>> {
    if interactive_waiters.load(Ordering::SeqCst) > 0 {
        return None;
    }
    let guard = gate.try_lock().ok()?;
    if interactive_waiters.load(Ordering::SeqCst) > 0 {
        return None;
    }
    Some(guard)
}

struct ImageAttempt {
    state: String,
    next_retry: Option<i64>,
}

enum NextImage<'a> {
    /// Never described, or its retry is due.
    Due(&'a SnapshotEntry),
    /// Nothing is due; the earliest retry comes at this Unix time.
    RetryAt(i64),
    /// Every image is described or has failed for good.
    Idle,
}

/// The first image in the listing that can be described now, or else when one can be.
fn next_image<'a>(
    entries: &'a [SnapshotEntry],
    attempts: &HashMap<String, ImageAttempt>,
    now: i64,
) -> NextImage<'a> {
    let mut earliest_retry: Option<i64> = None;
    for entry in entries {
        if entry.path == ".mory"
            || entry.path.starts_with(".mory/")
            || !image::supported(&entry.mime_type, std::path::Path::new(&entry.path))
        {
            continue;
        }
        match attempts.get(&entry.blob_id) {
            None => return NextImage::Due(entry),
            Some(attempt) if attempt.state == "pending" => match attempt.next_retry {
                Some(retry) if retry > now => {
                    earliest_retry = Some(earliest_retry.map_or(retry, |at| at.min(retry)));
                },
                _ => return NextImage::Due(entry),
            },
            Some(_) => {},
        }
    }
    earliest_retry.map_or(NextImage::Idle, NextImage::RetryAt)
}

/// When the background loop should run its next pass. The variants are ordered soonest first,
/// so the earliest of several is their `min`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Wake {
    /// The last pass made progress, and more work may be waiting.
    Now,
    After(Duration),
    /// Only a sync of the listing, or a search asking for a rebuild, can bring more work.
    Never,
}

impl Wake {
    /// At a Unix time in the database's resolution of whole seconds.
    fn at(timestamp: i64, now: i64) -> Self {
        Self::After(Duration::from_secs(
            u64::try_from(timestamp.saturating_sub(now)).unwrap_or(0),
        ))
    }
}

/// After a success more work may be waiting, so go on at once. After a failure, wait out the
/// provider's pause or stop, or a short delay for a failure of the item alone.
fn wake_after_attempt<T>(
    result: &std::result::Result<T, ProviderError>,
    backoff: &ProviderBackoff,
) -> Wake {
    match result {
        Ok(_) => Wake::Now,
        Err(_) => backoff.blocked().unwrap_or(Wake::After(BACKGROUND_RETRY_DELAY)),
    }
}

/// Sleeps until `wake` comes due, the listing is synced, or a rebuild is requested.
async fn wait_for_work(
    wake: Wake,
    listing: &mut watch::Receiver<Option<Oid>>,
    rebuild_requested: &Notify,
) {
    let delay = match wake {
        Wake::Now => return,
        Wake::After(delay) => Some(delay),
        Wake::Never => None,
    };
    let sleep = async {
        match delay {
            Some(delay) => tokio::time::sleep(delay).await,
            None => std::future::pending().await,
        }
    };
    // A closed channel would report a change on every call and spin the loop, so stop listening
    // to it. Only shutdown drops the sender.
    let listing_open = listing.has_changed().is_ok();
    tokio::select! {
        () = sleep => {},
        _ = listing.changed(), if listing_open => {},
        () = rebuild_requested.notified() => {},
    }
}

/// Holds back background requests to one provider: pauses them after a temporary failure, and
/// stops them until moried restarts after a failure only an admin can fix.
///
/// Each item's `next_retry` cannot do this alone. Such a failure belongs to the provider, not the
/// item, so skipping the item that just failed only sends the next one in a backlog into it.
struct ProviderBackoff {
    name: &'static str,
    state: std::sync::Mutex<BackoffState>,
}

#[derive(Default)]
struct BackoffState {
    paused_until: Option<Instant>,
    consecutive: u32,
    stopped: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum Hold {
    Pause(Duration),
    Stop,
}

impl ProviderBackoff {
    fn new(name: &'static str) -> Self {
        Self {
            name,
            state: std::sync::Mutex::default(),
        }
    }

    /// When background requests may go out again, if not now.
    fn blocked(&self) -> Option<Wake> {
        self.blocked_at(Instant::now())
    }

    fn blocked_at(&self, now: Instant) -> Option<Wake> {
        let state = self.state.lock().unwrap();
        if state.stopped.is_some() {
            return Some(Wake::Never);
        }
        state
            .paused_until
            .and_then(|until| until.checked_duration_since(now))
            .filter(|remaining| !remaining.is_zero())
            .map(Wake::After)
    }

    fn record<T>(&self, result: &std::result::Result<T, ProviderError>) {
        match (self.record_at(result, Instant::now()), result) {
            (Some(Hold::Pause(pause)), _) => {
                tracing::warn!(
                    "{} provider is failing; pausing background requests for {}s",
                    self.name,
                    pause.as_secs(),
                );
            },
            (Some(Hold::Stop), Err(error)) => {
                tracing::error!("{} requests stopped until moried restarts: {error}", self.name);
            },
            _ => {},
        }
    }

    fn record_at<T>(
        &self,
        result: &std::result::Result<T, ProviderError>,
        now: Instant,
    ) -> Option<Hold> {
        let mut state = self.state.lock().unwrap();
        let error = match result {
            Ok(_) => {
                // Only a restart ends a stop, so what an admin was told stays true until they act.
                state.paused_until = None;
                state.consecutive = 0;
                return None;
            },
            Err(error) => error,
        };
        match error.failure {
            Failure::Temporary => {
                state.consecutive = state.consecutive.saturating_add(1);
                // A rate limit can outlast a short pause, so keep doubling instead of probing at
                // a fixed interval.
                let pause = PROVIDER_BACKOFF
                    .saturating_mul(2u32.saturating_pow(state.consecutive - 1))
                    .min(MAX_PROVIDER_BACKOFF)
                    .max(error.retry_after.unwrap_or_default());
                state.paused_until = now.checked_add(pause).or(Some(now + MAX_PROVIDER_BACKOFF));
                Some(Hold::Pause(pause))
            },
            Failure::Admin if state.stopped.is_none() => {
                state.stopped = Some(error.message.clone());
                Some(Hold::Stop)
            },
            // Already stopped, or a failure of the item alone, which says nothing about the
            // provider either way.
            Failure::Admin | Failure::Item => None,
        }
    }
}

fn failure_timestamps(error: &ProviderError) -> (i64, Option<i64>) {
    failure_timestamps_at(error, Utc::now().timestamp())
}

fn failure_timestamps_at(error: &ProviderError, completed_at: i64) -> (i64, Option<i64>) {
    let next_retry = error.retryable().then(|| {
        let retry_seconds = error
            .retry_after
            .unwrap_or(Duration::from_secs(30))
            .as_secs();
        completed_at.saturating_add(i64::try_from(retry_seconds).unwrap_or(i64::MAX))
    });
    (completed_at, next_retry)
}

fn validate_embedding_vectors(
    vectors: Vec<Vec<f32>>,
    expected: usize,
    dimensions: usize,
) -> std::result::Result<Vec<Result<Vec<f32>>>, ProviderError> {
    if vectors.len() != expected {
        return Err(provider::failure(Failure::Item, "embedding response count mismatch"));
    }
    Ok(vectors
        .into_iter()
        .map(|vector| normalize_vector(vector, dimensions))
        .collect())
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
enum QueryValidationError {
    Generation,
    Invalid(anyhow::Error),
}

fn validate_query_at(
    lexical: &LexicalIndex,
    commit: Oid,
    parsed: &ParsedQuery,
) -> std::result::Result<(), QueryValidationError> {
    if lexical.generation != commit.to_string() {
        return Err(QueryValidationError::Generation);
    }
    lexical
        .validate_query(parsed)
        .map_err(QueryValidationError::Invalid)
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
        if !is_markdown(entry) {
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

fn is_markdown(entry: &SnapshotEntry) -> bool {
    entry
        .mime_type
        .split(';')
        .next()
        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/markdown"))
        || std::path::Path::new(&entry.path)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
            })
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
    pub requested_mode: SearchMode,
    pub executed_modes: Vec<SearchMode>,
    pub commit: String,
    pub head: String,
    pub lexical: IndexStatus,
    pub semantic: SemanticStatus,
    pub warnings: Vec<SearchWarning>,
    pub hits: Vec<SearchHit>,
}

#[derive(Debug, Serialize)]
pub struct SearchStatusResponse {
    commit: String,
    head: String,
    lexical: IndexStatus,
    semantic: SemanticStatus,
}

#[derive(Debug, Serialize)]
pub struct IndexStatus {
    pub state: String,
    pub indexed_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SemanticStatus {
    pub state: String,
    pub indexed: usize,
    pub total: usize,
    pub failed: usize,
}

#[derive(Debug, Serialize)]
pub struct SearchWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchHit {
    pub path: String,
    pub blob_id: String,
    pub passage_id: String,
    pub mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<usize>,
    pub snippet: String,
    pub content_kind: String,
    pub sources: Vec<SearchMode>,
    pub score: Option<f32>,
}

#[derive(Debug, Serialize)]
struct SearchErrorBody {
    code: String,
    message: String,
}

/// A search that could not be answered.
///
/// Carries the stable code and message the API has always returned, plus the status it maps to,
/// so a caller that is not serving HTTP can still tell "your query was wrong" from "the index is
/// busy, retry" without parsing prose.
#[derive(Debug)]
pub struct SearchFailure {
    pub status: StatusCode,
    pub code: String,
    pub message: String,
}

impl SearchFailure {
    fn new(status: StatusCode, code: &str, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.to_owned(),
            message: message.into(),
        }
    }
}

impl IntoResponse for SearchFailure {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(SearchErrorBody {
                code: self.code,
                message: self.message,
            }),
        )
            .into_response()
    }
}

fn search_error(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    SearchFailure::new(status, code, message).into_response()
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
    let semantic = match state.search.semantic_status_for(snapshot.commit).await {
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

/// `POST /v2/search`
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
    if let Err(failure) = validate_search_request(&request) {
        return failure.into_response();
    }
    match run_search(&state, request).await {
        Ok(response) => Json(response).into_response(),
        Err(failure) => failure.into_response(),
    }
}

/// The request-shape checks, kept apart from the search itself so every caller applies them.
pub(crate) fn validate_search_request(
    request: &SearchRequest,
) -> std::result::Result<(), SearchFailure> {
    if request.query.trim().is_empty() || request.query.len() > 2048 {
        return Err(SearchFailure::new(
            StatusCode::BAD_REQUEST,
            "invalid_query",
            "Query must contain 1–2,048 UTF-8 bytes.",
        ));
    }
    if !(1..=100).contains(&request.limit) {
        return Err(SearchFailure::new(
            StatusCode::BAD_REQUEST,
            "invalid_limit",
            "Limit must be between 1 and 100.",
        ));
    }
    Ok(())
}

/// Answer a search request, with no HTTP in sight.
///
/// Callers apply `validate_search_request` first; everything after that -- the Grep branch, the
/// mode fallbacks and their warnings, blob-liveness filtering, RRF fusion and diversification --
/// is here, so the MCP tools and the HTTP endpoint cannot drift apart.
pub(crate) async fn run_search(
    state: &AppState,
    request: SearchRequest,
) -> std::result::Result<SearchResponse, SearchFailure> {
    if let Err(error) = state.ensure_cache().await {
        tracing::error!("Search cache sync failed: {error:?}");
        return Err(SearchFailure::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "search_unavailable",
            "Search is temporarily unavailable.",
        ));
    }
    let snapshot = match SearchSnapshot::read(&state.cache_db).await {
        Ok(snapshot) => snapshot,
        Err(error) => {
            tracing::error!("Search snapshot failed: {error:?}");
            return Err(SearchFailure::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "search_unavailable",
                "Search is temporarily unavailable.",
            ));
        },
    };
    let head = state.head_commit_id().unwrap_or(snapshot.commit);
    if request.mode == SearchMode::Grep {
        let semantic = state
            .search
            .semantic_status_for(snapshot.commit)
            .await
            .unwrap_or(SemanticStatus {
                state: "error".to_owned(),
                indexed: 0,
                total: 0,
                failed: 0,
            });
        return match grep_at(
            &env::var("MORIED_GIT_DIR").unwrap(),
            &request.query,
            snapshot.commit,
            request.limit,
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
                Ok(SearchResponse {
                    requested_mode: request.mode,
                    executed_modes: vec![SearchMode::Grep],
                    commit: snapshot.commit.to_string(),
                    head: head.to_string(),
                    lexical: state.search.lexical_status_for(snapshot.commit),
                    semantic,
                    warnings: vec![],
                    hits,
                })
            },
            Err(GrepError::Invalid) => Err(SearchFailure::new(
                StatusCode::BAD_REQUEST,
                "invalid_grep_pattern",
                "The Grep pattern is invalid.",
            )),
            Err(GrepError::Internal(error)) => {
                tracing::error!("git grep failed: {error:?}");
                Err(SearchFailure::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "grep_failed",
                    "Grep could not be completed.",
                ))
            },
        };
    }

    let parsed = match parse(&request.query) {
        Ok(parsed) => parsed,
        Err(error) => {
            return Err(SearchFailure::new(
                StatusCode::BAD_REQUEST,
                "invalid_query",
                error.to_string(),
            ))
        },
    };
    if request.mode == SearchMode::Semantic && parsed.semantic_text().is_empty() {
        return Err(SearchFailure::new(
            StatusCode::BAD_REQUEST,
            "semantic_query_has_only_filters",
            "Semantic search needs a positive title or body term.",
        ));
    }
    if request.mode == SearchMode::Semantic && !state.search.config.semantic_enabled {
        return Err(SearchFailure::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "semantic_disabled",
            "Semantic search is disabled on this server.",
        ));
    }
    if !state.search.wait_for(snapshot.commit).await {
        return Err(SearchFailure::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "lexical_index_updating",
            "The local text index is updating. Please retry shortly.",
        ));
    }
    match state.search.validate_query(snapshot.commit, &parsed) {
        Ok(()) => {},
        Err(QueryValidationError::Generation) => {
            return Err(SearchFailure::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "lexical_index_updating",
                "The local text index changed while validating the query. Please retry.",
            ));
        },
        Err(QueryValidationError::Invalid(error)) => {
            return Err(SearchFailure::new(
                StatusCode::BAD_REQUEST,
                "invalid_query",
                error.to_string(),
            ))
        },
    }
    let semantic = state
        .search
        .semantic_status_for(snapshot.commit)
        .await
        .unwrap_or(SemanticStatus {
            state: "error".to_owned(),
            indexed: 0,
            total: 0,
            failed: 0,
        });

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
            return Err(SearchFailure::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "lexical_index_updating",
                "The local text index changed while searching. Please retry.",
            ));
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
                    return Err(SearchFailure::new(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "semantic_unavailable",
                        "Semantic search is temporarily unavailable.",
                    ));
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
                    return Err(SearchFailure::new(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "semantic_index_updating",
                        "The semantic candidate map is updating. Please retry shortly.",
                    ));
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
                    return Err(SearchFailure::new(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "semantic_unavailable",
                        "Semantic search is temporarily unavailable.",
                    ));
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

    Ok(SearchResponse {
        requested_mode: request.mode,
        executed_modes,
        commit: snapshot.commit.to_string(),
        head: head.to_string(),
        lexical: state.search.lexical_status_for(snapshot.commit),
        semantic,
        warnings,
        hits,
    })
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
    limit: usize,
) -> std::result::Result<Vec<GrepMatch>, GrepError> {
    let mut child = Command::new("git")
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
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| GrepError::Internal(error.into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| GrepError::Internal(anyhow::anyhow!("git grep stdout was unavailable")))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| GrepError::Internal(anyhow::anyhow!("git grep stderr was unavailable")))?;
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).await.map(|_| bytes)
    });
    let prefix = format!("{revision}:");
    let (results, reached_limit) = read_grep_matches(stdout, &prefix, limit)
        .await
        .map_err(|error| GrepError::Internal(error.into()))?;
    if reached_limit {
        let _ = child.kill().await;
    }
    let status = child
        .wait()
        .await
        .map_err(|error| GrepError::Internal(error.into()))?;
    let stderr = stderr_task
        .await
        .map_err(|error| GrepError::Internal(error.into()))?
        .map_err(|error| GrepError::Internal(error.into()))?;
    if reached_limit {
        return Ok(results);
    }
    if status.code() == Some(1) {
        return Ok(Vec::new());
    }
    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr);
        if stderr.contains("Invalid regular expression") || stderr.contains("invalid regex") {
            return Err(GrepError::Invalid);
        }
        return Err(GrepError::Internal(anyhow::anyhow!(
            "git grep exited {:?}",
            status.code()
        )));
    }
    Ok(results)
}

async fn read_grep_matches<R: AsyncRead + Unpin>(
    mut stdout: R,
    prefix: &str,
    limit: usize,
) -> std::io::Result<(Vec<GrepMatch>, bool)> {
    let mut results = Vec::new();
    let mut record = Vec::with_capacity(MAX_GREP_RECORD_BYTES.min(8 * 1024));
    let mut chunk = [0_u8; 8 * 1024];
    let mut discarding = false;
    let mut separators = 0;
    loop {
        let read = stdout.read(&mut chunk).await?;
        if read == 0 {
            if !discarding && !record.is_empty() {
                if let Some(found) = parse_grep_record(&record, prefix, false) {
                    results.push(found);
                }
            }
            return Ok((results, false));
        }
        for byte in &chunk[..read] {
            if *byte == 0 && separators < 2 {
                separators += 1;
            }
            // With `git grep --null --line-number`, the filename and line number end in NUL.
            // A newline cannot terminate the record until both protected fields are complete.
            if *byte == b'\n' && separators >= 2 {
                if !discarding {
                    if record.last() == Some(&b'\r') {
                        record.pop();
                    }
                    if let Some(found) = parse_grep_record(&record, prefix, false) {
                        results.push(found);
                        if results.len() >= limit {
                            return Ok((results, true));
                        }
                    }
                }
                record.clear();
                discarding = false;
                separators = 0;
                continue;
            }
            if discarding {
                continue;
            }
            if record.len() == MAX_GREP_RECORD_BYTES {
                if let Some(found) = parse_grep_record(&record, prefix, true) {
                    results.push(found);
                    if results.len() >= limit {
                        return Ok((results, true));
                    }
                }
                record.clear();
                discarding = true;
                continue;
            }
            record.push(*byte);
        }
    }
}

fn parse_grep_record(bytes: &[u8], prefix: &str, truncated: bool) -> Option<GrepMatch> {
    let mut parts = bytes.splitn(3, |byte| *byte == 0);
    let file = String::from_utf8_lossy(parts.next()?);
    let number = String::from_utf8_lossy(parts.next()?).parse().ok()?;
    let mut content = String::from_utf8_lossy(parts.next()?).into_owned();
    if truncated {
        content.push('…');
    }
    Some(GrepMatch {
        file: file.strip_prefix(prefix).unwrap_or(&file).to_owned(),
        line: number,
        content,
    })
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
        let first = commit_file(&repo, directory.path(), "-danger\n-danger again\n", &[]);
        let first_commit = repo.find_commit(first).unwrap();
        let second = commit_file(&repo, directory.path(), "replacement\n", &[&first_commit]);

        let found = grep_at(directory.path().to_str().unwrap(), "-danger", first, 1)
            .await
            .unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file, "note.md");
        assert!(grep_at(directory.path().to_str().unwrap(), "absent", first, 10)
            .await
            .unwrap()
            .is_empty());
        assert!(matches!(
            grep_at(directory.path().to_str().unwrap(), "[", first, 10).await,
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
    async fn grep_caps_memory_for_one_oversized_matching_line() {
        let directory = tempfile::tempdir().unwrap();
        let repo = Repository::init(directory.path()).unwrap();
        let body = format!("needle {}", "x".repeat(MAX_GREP_RECORD_BYTES * 2));
        let commit = commit_file(&repo, directory.path(), &body, &[]);

        let found = grep_at(directory.path().to_str().unwrap(), "needle", commit, 1)
            .await
            .unwrap();

        assert_eq!(found.len(), 1);
        assert!(found[0].content.len() <= MAX_GREP_RECORD_BYTES);
        assert!(found[0].content.ends_with('…'));
    }

    #[tokio::test]
    async fn grep_preserves_newlines_in_git_paths() {
        let directory = tempfile::tempdir().unwrap();
        let repo = Repository::init(directory.path()).unwrap();
        let path = std::path::Path::new("first\nsecond.md");
        std::fs::write(directory.path().join(path), "needle\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(path).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = git2::Signature::now("Search Test", "search@example.invalid").unwrap();
        let commit = repo
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "newline path",
                &tree,
                &[],
            )
            .unwrap();

        let found = grep_at(directory.path().to_str().unwrap(), "needle", commit, 10)
            .await
            .unwrap();

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file, "first\nsecond.md");
        assert_eq!(found[0].content, "needle");
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

    #[tokio::test]
    async fn semantic_status_does_not_mix_passage_and_entry_generations() {
        use sqlx::sqlite::SqlitePoolOptions;

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE search_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE cache_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE search_passage (passage_id TEXT, text_hash TEXT);")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE search_embedding (
                passage_id TEXT, text_hash TEXT, model TEXT, dimensions INTEGER,
                template TEXT, state TEXT
             );",
        )
        .execute(&pool)
        .await
        .unwrap();
        let selected = Oid::from_str(&"1".repeat(40)).unwrap();
        let newer = Oid::from_str(&"2".repeat(40)).unwrap();
        sqlx::query("INSERT INTO search_state VALUES ('passage_commit', ?);")
            .bind(selected.to_string())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO cache_state VALUES ('commit_id', ?);")
            .bind(newer.to_string())
            .execute(&pool)
            .await
            .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let manager = SearchManager {
            config: SearchConfig {
                index_dir: directory.path().join("index"),
                semantic_enabled: true,
                embedding_model: "model".to_owned(),
                embedding_dimensions: 2,
                vision_model: None,
            },
            repo: Arc::new(std::sync::Mutex::new(
                Repository::init(directory.path().join("repo")).unwrap(),
            )),
            cache_db: pool.clone(),
            cache_db_writer: pool,
            lexical: RwLock::new(None),
            status: RwLock::new(ManagerStatus {
                state: "updating".to_owned(),
                indexed_commit: None,
                message: None,
            }),
            writer: AsyncMutex::new(()),
            provider: Arc::new(DeterministicEmbeddingProvider),
            provider_gate: AsyncMutex::new(()),
            interactive_waiters: AtomicUsize::new(0),
            vision_client: reqwest::Client::new(),
            embedding_backoff: ProviderBackoff::new("Embedding"),
            image_backoff: ProviderBackoff::new("Image description"),
            force_rebuild: AtomicBool::new(false),
            rebuild_requested: Notify::new(),
        };

        let status = manager.semantic_status_for(selected).await.unwrap();

        assert_eq!(status.state, "indexing");
        assert_eq!(status.indexed, 0);
        assert_eq!(status.total, 0);
        assert_eq!(status.failed, 0);
    }

    #[tokio::test]
    async fn semantic_status_excludes_failed_images_outside_the_search_corpus() {
        use sqlx::sqlite::SqlitePoolOptions;

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE entry (path TEXT, blob_id TEXT, mime_type TEXT);")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE search_image_description (
                blob_id TEXT, model TEXT, prompt_version TEXT, preprocess TEXT,
                detail TEXT, state TEXT
             );",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO entry VALUES ('.mory/photo.png', 'blob', 'image/png');")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO search_image_description VALUES ('blob', 'vision', ?, ?, ?, 'failed');",
        )
        .bind(image::PROMPT_VERSION)
        .bind(image::PREPROCESS_VERSION)
        .bind(image::DETAIL)
        .execute(&pool)
        .await
        .unwrap();

        let failed: i64 = sqlx::query_scalar(FAILED_IMAGE_COUNT_SQL)
            .bind("vision")
            .bind(image::PROMPT_VERSION)
            .bind(image::PREPROCESS_VERSION)
            .bind(image::DETAIL)
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(failed, 0);

        sqlx::query("UPDATE entry SET path = 'photo.png';")
            .execute(&pool)
            .await
            .unwrap();
        let failed: i64 = sqlx::query_scalar(FAILED_IMAGE_COUNT_SQL)
            .bind("vision")
            .bind(image::PROMPT_VERSION)
            .bind(image::PREPROCESS_VERSION)
            .bind(image::DETAIL)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(failed, 1);
    }

    #[test]
    fn indexes_markdown_from_mime_and_case_insensitive_extensions() {
        let directory = tempfile::tempdir().unwrap();
        let repo = Repository::init(directory.path()).unwrap();
        let upper = repo.blob(b"# Upper\n\nBody").unwrap();
        let long = repo.blob(b"# Long\n\nBody").unwrap();
        let mime = repo.blob(b"# Mime\n\nBody").unwrap();
        let snapshot = SearchSnapshot {
            commit: Oid::zero(),
            entries: vec![
                SnapshotEntry {
                    path: "Upper.MD".to_owned(),
                    blob_id: upper.to_string(),
                    mime_type: "application/octet-stream".to_owned(),
                    title: None,
                    metadata: "{}".to_owned(),
                },
                SnapshotEntry {
                    path: "Long.markdown".to_owned(),
                    blob_id: long.to_string(),
                    mime_type: "application/octet-stream".to_owned(),
                    title: None,
                    metadata: "{}".to_owned(),
                },
                SnapshotEntry {
                    path: "notes/custom".to_owned(),
                    blob_id: mime.to_string(),
                    mime_type: "text/markdown; charset=utf-8".to_owned(),
                    title: None,
                    metadata: "{}".to_owned(),
                },
            ],
        };
        let repo = Arc::new(std::sync::Mutex::new(repo));

        let inputs = build_inputs(&repo, &snapshot, &[]).unwrap();
        let paths = inputs
            .into_iter()
            .map(|input| input.path)
            .collect::<HashSet<_>>();

        assert_eq!(
            paths,
            HashSet::from([
                "Upper.MD".to_owned(),
                "Long.markdown".to_owned(),
                "notes/custom".to_owned(),
            ])
        );
    }

    #[test]
    fn generation_changes_are_not_query_syntax_errors() {
        let directory = tempfile::tempdir().unwrap();
        let current = Oid::from_str(&"2".repeat(40)).unwrap();
        let selected = Oid::from_str(&"1".repeat(40)).unwrap();
        let lexical = LexicalIndex::build(
            &directory.path().join("index"),
            &current.to_string(),
            "content",
            &[],
        )
        .unwrap();
        let parsed = parse("valid query").unwrap();

        assert!(matches!(
            validate_query_at(&lexical, selected, &parsed),
            Err(QueryValidationError::Generation)
        ));
    }

    #[tokio::test]
    async fn restart_does_not_retry_permanently_failed_artifacts() {
        use sqlx::sqlite::SqlitePoolOptions;

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE search_embedding (
                model TEXT, dimensions INTEGER, template TEXT, state TEXT, next_retry INTEGER
             );",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE search_image_description (
                model TEXT, prompt_version TEXT, preprocess TEXT, detail TEXT,
                state TEXT, next_retry INTEGER
             );",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO search_embedding VALUES ('model', 8, ?, 'failed', NULL);")
            .bind(EMBEDDING_TEMPLATE)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO search_image_description VALUES ('vision', ?, ?, ?, 'failed', NULL);",
        )
        .bind(image::PROMPT_VERSION)
        .bind(image::PREPROCESS_VERSION)
        .bind(image::DETAIL)
        .execute(&pool)
        .await
        .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path().join("repo")).unwrap();
        let config = SearchConfig {
            index_dir: directory.path().join("index"),
            semantic_enabled: true,
            embedding_model: "model".to_owned(),
            embedding_dimensions: 8,
            vision_model: Some("vision".to_owned()),
        };

        SearchManager::new(
            config,
            Arc::new(std::sync::Mutex::new(repository)),
            pool.clone(),
            pool.clone(),
        )
        .await
        .unwrap();

        let embedding: (String, Option<i64>) =
            sqlx::query_as("SELECT state, next_retry FROM search_embedding;")
                .fetch_one(&pool)
                .await
                .unwrap();
        let image: (String, Option<i64>) =
            sqlx::query_as("SELECT state, next_retry FROM search_image_description;")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(embedding, ("failed".to_owned(), None));
        assert_eq!(image, ("failed".to_owned(), None));
    }

    #[tokio::test]
    async fn cancelling_a_queued_interactive_query_releases_its_priority() {
        let count = AtomicUsize::new(0);
        let gate = AsyncMutex::new(());
        let held = gate.lock().await;
        let mut waiting = Box::pin(async {
            let _waiter = InteractiveWaiter::new(&count);
            let _gate = gate.lock().await;
        });

        assert!(
            tokio::time::timeout(Duration::from_millis(10), &mut waiting)
                .await
                .is_err()
        );
        assert_eq!(count.load(Ordering::SeqCst), 1);
        drop(waiting);
        assert_eq!(count.load(Ordering::SeqCst), 0);
        drop(held);
    }

    #[tokio::test]
    async fn background_ingestion_never_queues_ahead_of_interactive_work() {
        let count = AtomicUsize::new(0);
        let gate = AsyncMutex::new(());
        let held = gate.lock().await;

        // Background work that reaches a busy provider must defer instead of taking a place in
        // the FIFO mutex queue before an interactive request that arrives moments later.
        assert!(try_background_gate(&gate, &count).is_none());
        let waiter = InteractiveWaiter::new(&count);
        drop(held);
        assert!(try_background_gate(&gate, &count).is_none());
        drop(waiter);
        assert!(try_background_gate(&gate, &count).is_some());
    }

    #[test]
    fn embedding_inputs_obey_per_input_and_request_limits() {
        let oversized = "🦀".repeat(MAX_EMBEDDING_INPUT_BYTES);
        let bounded = bounded_embedding_input(&oversized);
        assert!(bounded.len() <= MAX_EMBEDDING_INPUT_BYTES);
        assert!(bounded.is_char_boundary(bounded.len()));

        let batch = (0..32)
            .map(|_| bounded_embedding_input(&oversized))
            .collect::<Vec<_>>();
        assert!(batch.iter().map(String::len).sum::<usize>() <= MAX_EMBEDDING_REQUEST_BYTES);
    }

    #[test]
    fn retry_after_starts_when_the_failed_response_finishes() {
        let error = ProviderError {
            failure: Failure::Temporary,
            retry_after: Some(Duration::from_secs(10)),
            message: "rate limited".to_owned(),
        };

        // The request began at 100 but did not finish until 120. Scheduling from the request start
        // would produce an already-expired deadline of 110.
        assert_eq!(failure_timestamps_at(&error, 120), (120, Some(130)));
    }

    fn image_entry(path: &str, blob_id: &str, mime_type: &str) -> SnapshotEntry {
        SnapshotEntry {
            path: path.to_owned(),
            blob_id: blob_id.to_owned(),
            mime_type: mime_type.to_owned(),
            title: None,
            metadata: "{}".to_owned(),
        }
    }

    fn image_attempt(state: &str, next_retry: Option<i64>) -> ImageAttempt {
        ImageAttempt {
            state: state.to_owned(),
            next_retry,
        }
    }

    #[test]
    fn next_image_finds_the_first_due_image_or_the_earliest_retry() {
        let entries = [
            image_entry(".mory/logo.png", "config", "image/png"),
            image_entry("drawing.svg", "vector", "image/svg+xml"),
            image_entry("ready.png", "ready", "image/png"),
            image_entry("failed.png", "failed", "image/png"),
            image_entry("later.png", "later", "image/png"),
            image_entry("waiting.png", "waiting", "image/png"),
            image_entry("due.png", "due", "image/png"),
            image_entry("new.png", "new", "image/png"),
        ];
        let attempts = HashMap::from([
            ("ready".to_owned(), image_attempt("ready", None)),
            ("failed".to_owned(), image_attempt("failed", None)),
            ("later".to_owned(), image_attempt("pending", Some(150))),
            ("waiting".to_owned(), image_attempt("pending", Some(101))),
            ("due".to_owned(), image_attempt("pending", Some(100))),
        ]);

        let next = |entries: &[SnapshotEntry], now| match next_image(entries, &attempts, now) {
            NextImage::Due(entry) => format!("due {}", entry.path),
            NextImage::RetryAt(retry) => format!("retry at {retry}"),
            NextImage::Idle => "idle".to_owned(),
        };
        assert_eq!(next(&entries, 100), "due due.png");
        assert_eq!(next(&entries, 99), "due new.png");
        assert_eq!(next(&entries[..6], 100), "retry at 101");
        assert_eq!(next(&entries[..6], 101), "due waiting.png");
        assert_eq!(next(&entries[..4], 100), "idle");
    }

    #[test]
    fn the_soonest_wake_wins() {
        let seconds = Duration::from_secs;
        assert_eq!(Wake::Never.min(Wake::After(seconds(5))), Wake::After(seconds(5)));
        assert_eq!(Wake::After(seconds(5)).min(Wake::After(seconds(2))), Wake::After(seconds(2)));
        assert_eq!(Wake::After(Duration::ZERO).min(Wake::Now), Wake::Now);
        assert_eq!(Wake::at(130, 100), Wake::After(seconds(30)));
        assert_eq!(Wake::at(90, 100), Wake::After(Duration::ZERO));
    }

    #[tokio::test]
    async fn background_work_waits_for_a_sync_a_rebuild_or_its_time() {
        async fn waits(
            wake: Wake,
            listing: &mut watch::Receiver<Option<Oid>>,
            rebuild_requested: &Notify,
        ) -> bool {
            let wait = wait_for_work(wake, listing, rebuild_requested);
            tokio::time::timeout(Duration::from_millis(10), wait)
                .await
                .is_err()
        }

        let (sender, mut listing) = watch::channel(None);
        let rebuild = Notify::new();

        assert!(waits(Wake::Never, &mut listing, &rebuild).await);
        sender.send(Some(Oid::zero())).unwrap();
        assert!(!waits(Wake::Never, &mut listing, &rebuild).await);
        assert!(waits(Wake::Never, &mut listing, &rebuild).await);
        rebuild.notify_one();
        assert!(!waits(Wake::Never, &mut listing, &rebuild).await);

        assert!(waits(Wake::After(Duration::from_secs(60)), &mut listing, &rebuild).await);
        assert!(!waits(Wake::After(Duration::from_millis(1)), &mut listing, &rebuild).await);
        assert!(!waits(Wake::Now, &mut listing, &rebuild).await);

        // A closed channel reports a change on every call, which would spin the loop.
        drop(sender);
        assert!(waits(Wake::Never, &mut listing, &rebuild).await);
    }

    fn provider_failure(retry_after: Option<Duration>) -> std::result::Result<(), ProviderError> {
        Err(ProviderError {
            failure: Failure::Temporary,
            retry_after,
            message: "HTTP 503".to_owned(),
        })
    }

    fn pause(seconds: u64) -> Option<Hold> {
        Some(Hold::Pause(Duration::from_secs(seconds)))
    }

    fn paused(seconds: u64) -> Option<Wake> {
        Some(Wake::After(Duration::from_secs(seconds)))
    }

    #[test]
    fn provider_backoff_doubles_up_to_its_cap() {
        let backoff = ProviderBackoff::new("Test");
        let start = Instant::now();

        assert_eq!(backoff.blocked_at(start), None);
        let pauses = (0..10)
            .map(|_| backoff.record_at(&provider_failure(None), start))
            .collect::<Vec<_>>();
        let expected = [30, 60, 120, 240, 480, 960, 1920, 3600, 3600, 3600].map(pause);
        assert_eq!(pauses, expected);
        assert_eq!(backoff.blocked_at(start + Duration::from_secs(3599)), paused(1));
        assert_eq!(backoff.blocked_at(start + Duration::from_secs(3600)), None);
    }

    #[test]
    fn provider_backoff_honours_a_longer_retry_after() {
        let backoff = ProviderBackoff::new("Test");
        let start = Instant::now();

        let hold = backoff.record_at(&provider_failure(Some(Duration::from_secs(90))), start);
        assert_eq!(hold, pause(90));
        let hold = backoff.record_at(&provider_failure(Some(Duration::from_secs(1))), start);
        assert_eq!(hold, pause(60));
    }

    #[test]
    fn only_a_success_ends_a_provider_backoff() {
        let backoff = ProviderBackoff::new("Test");
        let start = Instant::now();
        backoff.record_at(&provider_failure(None), start);

        let unrelated: std::result::Result<(), ProviderError> =
            Err(provider::failure(Failure::Item, "HTTP 400"));
        assert_eq!(backoff.record_at(&unrelated, start), None);
        assert_eq!(backoff.blocked_at(start), paused(30));
        assert_eq!(backoff.record_at(&provider_failure(None), start), pause(60));

        assert_eq!(backoff.record_at(&Ok(()), start), None);
        assert_eq!(backoff.blocked_at(start), None);
        assert_eq!(backoff.record_at(&provider_failure(None), start), pause(30));
    }

    #[test]
    fn a_failure_only_an_admin_can_fix_stops_requests_until_restart() {
        let backoff = ProviderBackoff::new("Test");
        let start = Instant::now();
        let refused: std::result::Result<(), ProviderError> =
            Err(provider::failure(Failure::Admin, "HTTP 401"));

        assert_eq!(backoff.record_at(&refused, start), Some(Hold::Stop));
        assert_eq!(
            backoff.blocked_at(start + Duration::from_secs(24 * 60 * 60)),
            Some(Wake::Never),
        );
        // A second refusal is not news, and a success from a search does not end the stop.
        assert_eq!(backoff.record_at(&refused, start), None);
        assert_eq!(backoff.record_at(&Ok(()), start), None);
        assert_eq!(backoff.blocked_at(start), Some(Wake::Never));
    }

    #[derive(Clone, Copy)]
    enum StubAnswer {
        Vectors,
        Unavailable,
        Rejected,
        Refused,
    }

    struct StubProvider {
        answer: StubAnswer,
        calls: AtomicUsize,
    }

    #[async_trait::async_trait]
    impl EmbeddingProvider for StubProvider {
        async fn embed(
            &self,
            input: &[String],
            _model: &str,
            dimensions: usize,
        ) -> std::result::Result<Vec<Vec<f32>>, ProviderError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let (failure, status) = match self.answer {
                StubAnswer::Vectors => return Ok(vec![vec![1.0; dimensions]; input.len()]),
                StubAnswer::Unavailable => (Failure::Temporary, 503),
                StubAnswer::Rejected => (Failure::Item, 400),
                StubAnswer::Refused => (Failure::Admin, 401),
            };
            Err(provider::failure(failure, format!("embedding provider returned HTTP {status}")))
        }
    }

    struct StubIndex {
        manager: SearchManager,
        provider: Arc<StubProvider>,
        pool: SqlitePool,
        _directory: tempfile::TempDir,
    }

    impl StubIndex {
        async fn new(answer: StubAnswer) -> Self {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            crate::init_cache_database(&mut pool.acquire().await.unwrap())
                .await
                .unwrap();
            let provider = Arc::new(StubProvider {
                answer,
                calls: AtomicUsize::new(0),
            });
            let directory = tempfile::tempdir().unwrap();
            let manager = SearchManager {
                config: SearchConfig {
                    index_dir: directory.path().join("index"),
                    semantic_enabled: true,
                    embedding_model: "model".to_owned(),
                    embedding_dimensions: 2,
                    vision_model: None,
                },
                repo: Arc::new(std::sync::Mutex::new(
                    Repository::init(directory.path().join("repo")).unwrap(),
                )),
                cache_db: pool.clone(),
                cache_db_writer: pool.clone(),
                lexical: RwLock::new(None),
                status: RwLock::new(ManagerStatus {
                    state: "updating".to_owned(),
                    indexed_commit: None,
                    message: None,
                }),
                writer: AsyncMutex::new(()),
                provider: provider.clone(),
                provider_gate: AsyncMutex::new(()),
                interactive_waiters: AtomicUsize::new(0),
                vision_client: reqwest::Client::new(),
                embedding_backoff: ProviderBackoff::new("Embedding"),
                image_backoff: ProviderBackoff::new("Image description"),
                force_rebuild: AtomicBool::new(false),
                rebuild_requested: Notify::new(),
            };
            Self {
                manager,
                provider,
                pool,
                _directory: directory,
            }
        }

        async fn add_passage(&self, passage_id: &str) {
            sqlx::query(
                "INSERT INTO search_passage VALUES (
                    'note.md', 'blob', ?, 'hash', 0, 4, 1, 1, 'text/markdown', NULL, 'text', 'text',
                    'text'
                 );",
            )
            .bind(passage_id)
            .execute(&self.pool)
            .await
            .unwrap();
        }

        async fn ingest(&self) -> Wake {
            self.manager.ingest_embedding_batch().await.unwrap()
        }

        fn calls(&self) -> usize {
            self.provider.calls.load(Ordering::SeqCst)
        }
    }

    fn about_seconds(wake: Wake, seconds: u64) -> bool {
        matches!(wake, Wake::After(delay)
            if delay <= Duration::from_secs(seconds)
                && delay >= Duration::from_secs(seconds - 1))
    }

    #[tokio::test]
    async fn a_provider_failure_pauses_embedding_ingestion_for_every_passage() {
        let index = StubIndex::new(StubAnswer::Unavailable).await;

        index.add_passage("first").await;
        assert!(about_seconds(index.ingest().await, 30));
        assert_eq!(index.calls(), 1);

        // The failed passage waits for its own retry time anyway. A passage that has never been
        // tried has no such time, and sending it would meet the same failure.
        index.add_passage("second").await;
        assert!(about_seconds(index.ingest().await, 30));
        assert_eq!(index.calls(), 1);
    }

    #[tokio::test]
    async fn embedding_ingestion_sleeps_until_its_next_retry() {
        let index = StubIndex::new(StubAnswer::Vectors).await;

        assert_eq!(index.ingest().await, Wake::Never);
        index.add_passage("first").await;
        sqlx::query(
            "INSERT INTO search_embedding VALUES (
                'first', 'hash', 'model', 2, ?, NULL, NULL, 'pending', 0, ?, 0
             );",
        )
        .bind(EMBEDDING_TEMPLATE)
        .bind(Utc::now().timestamp() + 30)
        .execute(&index.pool)
        .await
        .unwrap();
        assert!(about_seconds(index.ingest().await, 30));
        assert_eq!(index.calls(), 0);
    }

    #[tokio::test]
    async fn a_refused_key_stops_embedding_ingestion_and_keeps_the_passages() {
        let index = StubIndex::new(StubAnswer::Refused).await;

        index.add_passage("first").await;
        assert_eq!(index.ingest().await, Wake::Never);
        index.add_passage("second").await;
        assert_eq!(index.ingest().await, Wake::Never);
        assert_eq!(index.calls(), 1);
        let state: String =
            sqlx::query_scalar("SELECT state FROM search_embedding WHERE passage_id = 'first';")
                .fetch_one(&index.pool)
                .await
                .unwrap();
        assert_eq!(state, "pending");
    }

    #[tokio::test]
    async fn a_rejected_batch_is_given_up_without_a_pause() {
        let index = StubIndex::new(StubAnswer::Rejected).await;

        index.add_passage("first").await;
        assert_eq!(index.ingest().await, Wake::After(BACKGROUND_RETRY_DELAY));
        assert_eq!(index.manager.embedding_backoff.blocked(), None);
        assert_eq!(index.ingest().await, Wake::Never);
        assert_eq!(index.calls(), 1);
    }

    #[tokio::test]
    async fn embedding_ingestion_goes_on_while_it_makes_progress() {
        let index = StubIndex::new(StubAnswer::Vectors).await;

        index.add_passage("first").await;
        assert_eq!(index.ingest().await, Wake::Now);
        assert_eq!(index.ingest().await, Wake::Never);
        assert_eq!(index.calls(), 1);
    }

    #[test]
    fn malformed_embedding_does_not_discard_valid_siblings() {
        let vectors = validate_embedding_vectors(
            vec![vec![3.0, 4.0], vec![f32::NAN, 1.0], vec![1.0]],
            3,
            2,
        )
        .unwrap();

        assert_eq!(vectors.len(), 3);
        assert!(vectors[0].is_ok());
        assert!(vectors[1].is_err());
        assert!(vectors[2].is_err());
        assert!(validate_embedding_vectors(vec![vec![1.0, 0.0]], 2, 2).is_err());
    }
}
