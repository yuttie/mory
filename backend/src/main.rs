use std::collections::{HashMap, HashSet};
use std::env;
use std::ffi::OsStr;
use std::io::Write;
use std::iter::once;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::str::FromStr;
use std::vec::Vec;
use std::string::String;
use std::sync::{Arc, Mutex};
use std::time;

use anyhow::{Context, Result};
use argon2;
use axum::{
    BoxError,
    body::Body,
    error_handling::HandleErrorLayer,
    extract,
    http::{
        header,
        HeaderMap,
        HeaderValue,
        Method,
        Request,
        StatusCode,
    },
    Json,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
    routing::{get, post},
};
use chrono::{DateTime, Duration, Utc};
use dotenv::dotenv;
use git2::{Index, IndexEntry, IndexTime, Repository, Oid};
use jsonwebtoken as jwt;
use mime_guess;
use reqwest;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use sqlx::sqlite::{
    SqliteConnection,
    SqliteConnectOptions,
    SqliteJournalMode,
    SqlitePoolOptions,
};
use sqlx::{Connection, Row};
use tempfile::tempdir;
use tokio::{
    process::Command,
    sync::watch,
};
use tower::ServiceBuilder;
use tower_http::{
    cors::CorsLayer,
    sensitive_headers::SetSensitiveHeadersLayer,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use models::*;

#[cfg(test)]
mod tests;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    dotenv().ok();

    // Cache database
    let cache_db_url = "sqlite://cache.sqlite";
    let cache_db_opts = SqliteConnectOptions::from_str(cache_db_url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal);
    let mut cache_writer_conn = SqliteConnection::connect_with(&cache_db_opts.clone().read_only(false))
        .await?;
    let cache_reader_pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(cache_db_opts.read_only(true))
        .await?;
    init_cache_database(&mut cache_writer_conn).await?;

    let repo: Arc<Mutex<Repository>> = {
        let git_dir = env::var("MORIED_GIT_DIR").unwrap();
        match Repository::open(git_dir) {
            Ok(repo) => Arc::new(Mutex::new(repo)),
            Err(e) => panic!("failed to open: {}", e),
        }
    };

    let (refresh_tx, refresh_rx) = watch::channel(CacheState::Fresh(Oid::zero()));

    let state = models::AppState {
        repo: repo.clone(),
        cache_db: cache_reader_pool,
        tx: refresh_tx,
        http_client: reqwest::Client::builder()
            .gzip(true)
            .brotli(true)
            .build()
            .context("Failed to build a reqwest client")
            .unwrap(),
    };
    // Sync before binding the listener, so the server never starts up serving a listing it knows
    // to be behind.
    let cache_state = state.check_cache_state().await?;
    sync_cache_to(&mut cache_writer_conn, state.repo.clone(), cache_state).await?;

    tokio::spawn(cache_manager_task(
        repo.clone(),
        refresh_rx,
        cache_writer_conn,
    ));

    let addr = env::var("MORIED_LISTEN").unwrap();
    tracing::debug!("{:?}", addr);

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::IF_NONE_MATCH])
        .allow_origin(env::var("MORIED_ORIGIN_ALLOWED").unwrap().parse::<HeaderValue>().unwrap())
        .allow_credentials(true);

    let protected_api = Router::new()
        .route("/notes", get(get_notes).post(post_notes))
        .route("/notes/*path", get(get_notes_path).put(put_notes_path).delete(delete_notes_path))
        .route("/files", post(post_files).layer(extract::DefaultBodyLimit::max(16 * 1024 * 1024)))
        .route("/files/*path", get(get_files_path))
        .with_state(state.clone())
        .route_layer(middleware::from_fn(auth));
    let login_api = Router::new()
        .route("/login", post(post_login))
        .route_layer(
            ServiceBuilder::new()
                .layer(HandleErrorLayer::new(|_: BoxError| async {
                    // Too many requests
                    StatusCode::SERVICE_UNAVAILABLE
                }))
                .load_shed()
                .buffer(1)  // Required to make it Clone.
                .rate_limit(1, time::Duration::from_secs(3))
        );
    let protected_api_v2 = Router::new()
        .route("/commits/head", get(v2::get_commits_head))
        .route("/files/*path", get(v2::get_files_path).head(v2::head_files_path))
        .route("/tasks", get(v2::get_tasks))
        .route("/events", get(v2::get_events))
        .route("/assess-task", post(v2::post_assess_task))
        .route("/ai-action", post(v2::post_ai_action))
        .with_state(state.clone())
        .route_layer(middleware::from_fn(auth));
    let api_v2 = Router::new()
        .merge(protected_api_v2);
    let api = Router::new()
        .merge(protected_api)
        .merge(login_api)
        .nest("/v2", api_v2)
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(SetSensitiveHeadersLayer::new(once(header::AUTHORIZATION)))
                .layer(cors)
        );

    let app = {
        let root_path = env::var("MORIED_ROOT_PATH").unwrap();
        assert!(root_path.starts_with('/'), "MORIED_ROOT_PATH must start with '/'");
        assert!(root_path.ends_with('/'), "MORIED_ROOT_PATH must end with '/'");

        if root_path == "/" {
            api
        }
        else {
            Router::new().nest(&root_path, api)
        }
    };

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();

    Ok(())
}

/// Bumping this drops and refills the `entry` table on the next start.
const ENTRY_SCHEMA_VERSION: i64 = 2;

async fn init_cache_database(
    conn: &mut SqliteConnection,
) -> Result<()> {
    sqlx::query("
            CREATE TABLE IF NOT EXISTS cache_state (
                key    TEXT PRIMARY KEY,
                value  ANY
            ) STRICT, WITHOUT ROWID;
        ")
        .execute(&mut *conn)
        .await?;
    sqlx::query("
            CREATE TABLE IF NOT EXISTS openai_cache (
                request_hash  TEXT PRIMARY KEY,
                request_data  TEXT NOT NULL,
                response_data TEXT NOT NULL,
                created_at    INTEGER NOT NULL
            ) STRICT;
        ")
        .execute(&mut *conn)
        .await?;
    // The `entry` table holds exactly one generation: the listing at the commit recorded in
    // `cache_state.commit_id`. There is no migration mechanism, so a schema change is applied by
    // dropping the table and letting the next sync refill it. `openai_cache` is left alone --
    // it is expensive to refill and its schema is unrelated.
    let schema_version: Option<i64> =
        sqlx::query_scalar("SELECT value FROM cache_state WHERE key = 'schema_version';")
            .fetch_optional(&mut *conn)
            .await
            .unwrap_or(None);
    if schema_version != Some(ENTRY_SCHEMA_VERSION) {
        tracing::info!(
            "Entry cache schema is {:?}, expected {}: rebuilding it from scratch.",
            schema_version,
            ENTRY_SCHEMA_VERSION,
        );
        sqlx::query("DROP TABLE IF EXISTS entry;").execute(&mut *conn).await?;
        sqlx::query("DELETE FROM cache_state WHERE key = 'commit_id';")
            .execute(&mut *conn)
            .await?;
        // Dropping the table frees pages but does not shrink the file, and the generation-keyed
        // schema this replaces left 29 MB behind for a listing worth under 1 MB. Reclaim it once,
        // here, where the cost is already being paid.
        sqlx::query("VACUUM;").execute(&mut *conn).await?;
    }
    sqlx::query("
            CREATE TABLE IF NOT EXISTS entry (
                path       TEXT NOT NULL PRIMARY KEY,
                blob_id    TEXT NOT NULL,
                size       INTEGER NOT NULL,
                mime_type  TEXT NOT NULL,
                metadata   TEXT NOT NULL,
                title      TEXT,
                time       INTEGER NOT NULL,
                tz_offset  INTEGER NOT NULL
            ) STRICT;
        ")
        .execute(&mut *conn)
        .await?;
    sqlx::query("INSERT INTO cache_state VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;")
        .bind(ENTRY_SCHEMA_VERSION)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn cache_manager_task(
    repo: Arc<Mutex<Repository>>,
    mut rx: watch::Receiver<CacheState>,
    mut conn: SqliteConnection,
) {
    while rx.changed().await.is_ok() {
        let cache_state = *rx.borrow_and_update();
        if let Err(e) = sync_cache_to(&mut conn, repo.clone(), cache_state).await {
            tracing::error!("sync_cache_to() failed: {:?}", e);
        }
    }
}

async fn auth(req: Request<Body>, next: Next) -> Result<Response, StatusCode> {
    let auth_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());

    match auth_header {
        Some(auth_header) if token_is_valid(auth_header) => {
            Ok(next.run(req).await)
        },
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

fn token_is_valid(header_value: &str) -> bool {
    let token = header_value.split_whitespace().nth(1).unwrap();

    let secret = env::var("MORIED_SECRET").unwrap();
    match jwt::decode::<Claims>(&token, &jwt::DecodingKey::from_secret(secret.as_ref()), &jwt::Validation::default()) {
        Ok(_) => {
            tracing::debug!("authorized");
            true
        },
        Err(e) => {
            tracing::debug!("failed to decode token: {:?}", e);
            false
        },
    }
}

async fn post_login(
    Json(login): Json<Login>,
) -> Response {
    tracing::debug!("post_login");
    let user_name = env::var("MORIED_USER_NAME").unwrap();
    let user_email = env::var("MORIED_USER_EMAIL").unwrap();
    let user_hash = env::var("MORIED_USER_HASH").unwrap();
    let matches = user_name == login.user && argon2::verify_encoded(&user_hash, login.password.as_ref()).unwrap();

    if matches {
        let secret = env::var("MORIED_SECRET").unwrap();
        let duration = env::var("MORIED_SESSION_EXPIRY_MINUTES").map_or(Duration::hours(6), |v| {
            Duration::minutes(v.parse::<i64>().expect("Session duration in minutes represented as integer value is expected"))
        });
        let now: DateTime<Utc> = Utc::now();
        let my_claims = Claims {
            sub: login.user.to_owned(),
            exp: (now + duration).timestamp() as usize,
            email: user_email,
        };
        let token = jwt::encode(
            &jwt::Header::default(),
            &my_claims,
            &jwt::EncodingKey::from_secret(secret.as_ref())
        ).unwrap();
        token.into_response()
    }
    else {
        StatusCode::UNAUTHORIZED.into_response()
    }
}

fn guess_mime_from_path<P: AsRef<Path>>(path: P) -> String {
    let guess = mime_guess::from_path(path);
    if let Some(mime) = guess.first() {
        mime.as_ref().parse().unwrap()
    }
    else {
        "application/octet-stream".to_string()
    }
}

/// Every path touched by a commit reachable from `head` but not from `base`.
///
/// The endpoint tree diff is not enough on its own: a file edited and then reverted within the
/// window has byte-identical blobs at both ends, so the diff reports nothing, yet it really was
/// modified and its recorded time would stay at the older edit. Walking the range catches that.
///
/// Bounded by the number of commits since `base` -- one or two for an ordinary save -- and empty
/// when `head` is an ancestor of `base`, as a rollback makes it.
fn paths_touched_since(repo: &Repository, base: Oid, head: Oid) -> Result<HashSet<PathBuf>> {
    let mut touched = HashSet::new();
    let mut revwalk = repo.revwalk()?;
    revwalk.push(head)?;
    // `hide` prunes everything reachable from the cached commit, so a rewritten history walks
    // only the commits genuinely unique to HEAD.
    if revwalk.hide(base).is_err() {
        return Ok(touched);
    }
    for oid in revwalk {
        let commit = repo.find_commit(oid?)?;
        let tree = commit.tree()?;
        let parent_tree = match commit.parents().next() {
            Some(parent) => Some(parent.tree()?),
            None => None,
        };
        if parent_tree.as_ref().is_some_and(|parent| parent.id() == tree.id()) {
            continue;
        }
        let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)?;
        for delta in diff.deltas() {
            if let Some(path) = delta.new_file().path() {
                touched.insert(path.to_owned());
            }
            if let Some(path) = delta.old_file().path() {
                touched.insert(path.to_owned());
            }
        }
    }
    Ok(touched)
}

/// The newest commit reachable from `head` that authored each of `wanted`.
///
/// "Authored" is git's TREESAME rule: a commit authors a path only when its content there differs
/// from the content in *every* parent. A merge that merely combines two branches is TREESAME to
/// one parent at each path it carries, so attribution falls through to the commit that really
/// wrote the content; a merge that resolved a conflict into something matching neither parent did
/// author it, and is attributed.
///
/// The walk stops as soon as every wanted path is attributed, so an ordinary save costs a commit
/// or two. Only a cold cache, where every path is wanted, pays for the whole history.
fn attribute_times(
    repo: &Repository,
    head: Oid,
    wanted: &HashSet<PathBuf>,
) -> Result<HashMap<PathBuf, git2::Time>> {
    let mut times: HashMap<PathBuf, git2::Time> = HashMap::with_capacity(wanted.len());
    if wanted.is_empty() {
        return Ok(times);
    }

    let started = time::Instant::now();
    let mut remaining = wanted.clone();
    let mut commits_scanned = 0usize;

    let mut revwalk = repo.revwalk()?;
    // Topological order guarantees a descendant is never visited after its ancestor, which is the
    // property this "first hit wins" attribution relies on once merges exist. Measured against
    // Sort::TIME and the default: all within noise, so it is free.
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL)?;
    revwalk.push(head)?;
    'revwalk: for oid in revwalk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let tree = commit.tree()?;
        commits_scanned += 1;

        let parents: Vec<git2::Commit> = commit.parents().collect();
        // Identical to some parent's tree, so nothing here differs from every parent.
        if parents.iter().any(|parent| parent.tree_id() == tree.id()) {
            continue;
        }

        // A root commit has no parent to diff against, so its whole tree is an addition. Without
        // this it contributes no deltas at all, and any file introduced there and never touched
        // again is never attributed.
        let base_tree = match parents.first() {
            Some(parent) => Some(parent.tree()?),
            None => None,
        };
        let mut other_trees = Vec::with_capacity(parents.len().saturating_sub(1));
        for parent in parents.iter().skip(1) {
            other_trees.push(parent.tree()?);
        }

        let diff = repo.diff_tree_to_tree(base_tree.as_ref(), Some(&tree), None)?;
        for delta in diff.deltas() {
            use git2::Delta;
            match delta.status() {
                Delta::Added | Delta::Modified | Delta::Renamed | Delta::Copied => {
                    let file = delta.new_file();
                    let path = file.path().unwrap();
                    if !remaining.contains(path) {
                        continue;
                    }
                    // Present with the same content in another parent, so that parent already had
                    // it and this commit did not author it.
                    let treesame_elsewhere = other_trees.iter().any(|other| {
                        other.get_path(path).map(|entry| entry.id()).ok() == Some(file.id())
                    });
                    if treesame_elsewhere {
                        continue;
                    }
                    let path = path.to_owned();
                    remaining.remove(&path);
                    times.insert(path, commit.time());
                    if remaining.is_empty() {
                        break 'revwalk;
                    }
                },
                _ => (),
            }
        }
    }

    tracing::info!(
        "Attributed {}/{} paths over {} commits in {:.2?}",
        times.len(),
        wanted.len(),
        commits_scanned,
        started.elapsed(),
    );
    Ok(times)
}

/// The paths that differ between the cache's current contents and `head`.
struct CacheDelta {
    /// Paths to insert or refresh, with their blob at `head`.
    changed: Vec<(PathBuf, Oid)>,
    /// Paths to drop.
    deleted: Vec<PathBuf>,
}

/// Bring the entry cache to the commit `state` names.
///
/// Both transitions are a *tree* comparison, never a history walk:
///
/// - `Behind` diffs the cached commit's tree against HEAD's. `diff_tree_to_tree` does not care
///   whether the two commits share history, so a force-push costs exactly what an ordinary push
///   costs -- a rewrite that leaves the tree untouched produces an empty delta and is free.
/// - `Cold` has no commit to diff against (the cache is empty, or the base was garbage collected
///   after a force-push), so it reconciles HEAD's tree against the rows directly: a path whose
///   stored `blob_id` already matches HEAD needs no work at all. Only a genuinely empty table
///   makes every path changed, and so pays for a full attribution walk.
async fn sync_cache_to(
    conn: &mut SqliteConnection,
    repo: Arc<Mutex<Repository>>,
    state: CacheState,
) -> Result<()> {
    let (base, head) = match state {
        CacheState::Fresh(_) => return Ok(()),
        CacheState::Behind { base, head } => (Some(base), head),
        CacheState::Cold(head) => (None, head),
    };
    let started = time::Instant::now();

    // Only the cold path needs the current rows; the tree diff already knows what moved.
    let existing: HashMap<PathBuf, String> = if base.is_none() {
        sqlx::query("SELECT path, blob_id FROM entry;")
            .map(|row: sqlx::sqlite::SqliteRow| {
                (PathBuf::from(row.get::<String, _>("path")), row.get::<String, _>("blob_id"))
            })
            .fetch_all(&mut *conn)
            .await
            .context("Failed to read the current entry rows")?
            .into_iter()
            .collect()
    }
    else {
        HashMap::new()
    };

    let (delta, head_time) = {
        let repo = repo.lock().unwrap();
        let head_commit = repo.find_commit(head)?;
        let head_tree = head_commit.tree()?;

        let delta = match base {
            Some(base) => {
                let base_tree = repo.find_commit(base)?.tree()?;
                let diff = repo.diff_tree_to_tree(Some(&base_tree), Some(&head_tree), None)?;
                let mut changed_paths: HashSet<PathBuf> = HashSet::new();
                let mut deleted = Vec::new();
                for delta in diff.deltas() {
                    use git2::Delta;
                    match delta.status() {
                        Delta::Added | Delta::Modified | Delta::Copied => {
                            changed_paths.insert(delta.new_file().path().unwrap().to_owned());
                        },
                        Delta::Renamed => {
                            changed_paths.insert(delta.new_file().path().unwrap().to_owned());
                            deleted.push(delta.old_file().path().unwrap().to_owned());
                        },
                        Delta::Deleted => {
                            deleted.push(delta.old_file().path().unwrap().to_owned());
                        },
                        _ => (),
                    }
                }
                // On a fast-forward, union in everything touched along the way, so a revert
                // back to identical content still refreshes the recorded time.
                //
                // Deliberately not done when the history was rewritten. There, the commits in
                // the range are new objects that did not author the content they carry -- a
                // rebase or squash of unchanged files would stamp the rewrite's time on every
                // one of them. Keeping the recorded time is both cheaper and truer, and it is
                // the same principle as the TREESAME rule in `attribute_times`: a history
                // operation that changed no content authored nothing.
                if repo.graph_descendant_of(head, base).unwrap_or(false) {
                    changed_paths.extend(paths_touched_since(&repo, base, head)?);
                }

                // Resolve each against HEAD's tree; a touched path that HEAD does not contain is
                // a deletion the tree diff already recorded.
                let mut changed = Vec::with_capacity(changed_paths.len());
                for path in changed_paths {
                    if let Ok(entry) = head_tree.get_path(&path) {
                        let blob_id = entry.id();
                        changed.push((path, blob_id));
                    }
                }
                CacheDelta { changed, deleted }
            },
            None => {
                let mut index = Index::new()?;
                index.read_tree(&head_tree)?;
                let mut changed = Vec::new();
                let mut present: HashSet<PathBuf> = HashSet::with_capacity(existing.len());
                for entry in index.iter() {
                    let path = PathBuf::from(OsStr::from_bytes(&entry.path));
                    let unchanged = existing
                        .get(&path)
                        .is_some_and(|cached| cached.as_str() == entry.id.to_string());
                    if !unchanged {
                        changed.push((path.clone(), entry.id));
                    }
                    present.insert(path);
                }
                let deleted = existing
                    .keys()
                    .filter(|path| !present.contains(*path))
                    .cloned()
                    .collect();
                CacheDelta { changed, deleted }
            },
        };

        (delta, head_commit.time())
    };

    if delta.changed.is_empty() && delta.deleted.is_empty() {
        // The trees agree, so only the label moves. A history rewrite that preserved the tree
        // lands here.
        record_cache_commit(conn, head).await?;
        tracing::info!("Entry cache moved to {} with no content change.", head);
        return Ok(());
    }

    let wanted: HashSet<PathBuf> = delta.changed.iter().map(|(path, _)| path.clone()).collect();
    let times = {
        let repo = repo.lock().unwrap();
        attribute_times(&repo, head, &wanted)?
    };

    // Read blobs and extract metadata before opening the write transaction: this is the slow,
    // CPU-bound part and nothing else needs to observe it.
    let mut rows = Vec::with_capacity(delta.changed.len());
    for (path, blob_id) in &delta.changed {
        let mime_type = guess_mime_from_path(path);
        let (size, metadata, title) = {
            let repo = repo.lock().unwrap();
            let blob = repo.find_blob(*blob_id)?;
            let size = blob.size();
            let (metadata, title) = extract_metadata(blob.content(), &mime_type);
            (size, metadata, title)
        };
        // Every changed path should have been attributed; fall back to HEAD's own time rather
        // than dropping the entry from the listing if some path was not.
        let when = times.get(path).copied().unwrap_or_else(|| {
            tracing::warn!("No commit attributed {:?}; using HEAD's time.", path);
            head_time
        });
        rows.push((path.clone(), *blob_id, size, mime_type, metadata, title, when));
    }

    let mut tx = conn.begin().await?;
    for path in &delta.deleted {
        sqlx::query("DELETE FROM entry WHERE path = ?;")
            .bind(path.to_str())
            .execute(&mut *tx)
            .await
            .context("Failed to delete an entry")?;
    }
    for (path, blob_id, size, mime_type, metadata, title, when) in rows {
        sqlx::query("
                INSERT INTO entry VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET
                        blob_id = excluded.blob_id,
                        size = excluded.size,
                        mime_type = excluded.mime_type,
                        metadata = excluded.metadata,
                        title = excluded.title,
                        time = excluded.time,
                        tz_offset = excluded.tz_offset;
            ")
            .bind(path.to_str())
            .bind(blob_id.to_string())
            .bind(size as i64)
            .bind(mime_type)
            .bind(serde_json::to_string(&metadata).unwrap())
            .bind(title)
            .bind(when.seconds())
            .bind(when.offset_minutes() * 60)
            .execute(&mut *tx)
            .await
            .context("Failed to upsert an entry")?;
    }
    // The commit id moves in the same transaction as the rows, so the cache never describes a
    // commit its contents do not match.
    sqlx::query("INSERT INTO cache_state VALUES ('commit_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;")
        .bind(head.to_string())
        .execute(&mut *tx)
        .await
        .context("Failed to record the latest commit ID of the cache")?;
    tx.commit().await.context("COMMIT should succeed")?;

    tracing::info!(
        "Entry cache synced to {}: {} changed, {} deleted, in {:.2?}",
        head,
        delta.changed.len(),
        delta.deleted.len(),
        started.elapsed(),
    );
    Ok(())
}

async fn record_cache_commit(conn: &mut SqliteConnection, head: Oid) -> Result<()> {
    sqlx::query("INSERT INTO cache_state VALUES ('commit_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;")
        .bind(head.to_string())
        .execute(&mut *conn)
        .await
        .context("Failed to record the latest commit ID of the cache")?;
    Ok(())
}

async fn get_notes(
    extract::State(state): extract::State<AppState>,
) -> Json<Vec<ListEntry>> {
    tracing::debug!("get_notes");
    Json(state.get_entries(None).await.unwrap().1)
}

async fn find_entry_blob(
    state: &AppState,
    path: &str,
) -> Option<(Oid, Vec<u8>)> {
    // Search an index of HEAD for the given path
    let (oid, entry) = {
        let repo = state.repo.lock().unwrap();

        // Build an in-memory index of HEAD
        let head_ref = repo.head().ok()?;
        let head_oid = head_ref.target()?;
        let head_tree = head_ref.peel_to_tree().ok()?;

        let mut index = Index::new().ok()?;
        index.read_tree(&head_tree).ok()?;

        // Find the entry whose path matches our requested string
        let entry = index
            .iter()
            .find(|entry| std::str::from_utf8(&entry.path).map(|p| p == path).unwrap_or(false))?;

        (head_oid, entry)
    };

    // Load the blob's bytes
    let content = {
        let repo = state.repo.lock().unwrap();
        repo.find_blob(entry.id).map(|blob| Vec::from(blob.content())).ok()?
    };

    Some((oid, content))
}

fn content_response(content: Vec<u8>, path: &Path) -> Response {
    let mut res = content.into_response();
    if let Some(mime) = mime_guess::from_path(path).first() {
        res.headers_mut().insert(
            header::CONTENT_TYPE,
            mime.as_ref().parse().unwrap(),
        );
    }
    res
}

async fn get_notes_path(
    extract::Path(path): extract::Path<String>,
    extract::State(state): extract::State<AppState>,
) -> Response {
    tracing::debug!("get_notes_path");

    if let Some((_, content)) = find_entry_blob(&state, &path).await {
        content_response(content, path.as_ref())
    }
    else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn put_notes_path(
    extract::Path(path): extract::Path<String>,
    extract::State(state): extract::State<AppState>,
    Json(note_save): Json<NoteSave>,
) -> Response {
    tracing::debug!("put_notes_path");
    tracing::debug!("{:?}", note_save);

    match note_save {
        NoteSave::Save { content, message } => {
            let repo = state.repo.lock().unwrap();

            let head = repo.head().unwrap();
            let head_tree = head.peel_to_tree().unwrap();
            let head_commit = head.peel_to_commit().unwrap();

            let mut index = Index::new().unwrap();
            index.read_tree(&head_tree).unwrap();

            let blob_oid = repo.blob(content.as_bytes()).unwrap();
            let entry = IndexEntry {
                ctime: IndexTime::new(0, 0),
                mtime: IndexTime::new(0, 0),
                dev: 0,
                ino: 0,
                mode: 0o100644,
                uid: 0,
                gid: 0,
                file_size: 0,
                id: blob_oid,
                flags: 0,
                flags_extended: 0,
                path: path.as_bytes().into(),
            };
            index.add(&entry).unwrap();

            let tree_oid = index.write_tree_to(&repo).unwrap();
            let tree = repo.find_tree(tree_oid).unwrap();

            let signature = repo.signature().unwrap();
            repo.commit(
                Some("HEAD"),
                &signature,
                &signature,
                &message,
                &tree,
                &[&head_commit],
            ).unwrap();
            Json(&true).into_response()
        },
        NoteSave::Rename { from } => {
            let found = {
                let repo = state.repo.lock().unwrap();

                let head = repo.head().unwrap();
                let head_tree = head.peel_to_tree().unwrap();

                let mut index = Index::new().unwrap();
                index.read_tree(&head_tree).unwrap();

                index.iter().find(|entry| std::str::from_utf8(&entry.path).unwrap() == from)
            };
            if let Some(mut entry) = found {
                let repo = state.repo.lock().unwrap();

                let head = repo.head().unwrap();
                let head_tree = head.peel_to_tree().unwrap();
                let head_commit = head.peel_to_commit().unwrap();

                let mut index = Index::new().unwrap();
                index.read_tree(&head_tree).unwrap();

                let from = std::str::from_utf8(&entry.path).unwrap();
                index.remove(from.as_ref(), 0).unwrap();

                let message = format!("Rename {} to {}", &from, &path);
                entry.path = path.as_bytes().into();
                index.add(&entry).unwrap();

                let tree_oid = index.write_tree_to(&repo).unwrap();
                let tree = repo.find_tree(tree_oid).unwrap();

                let signature = repo.signature().unwrap();
                repo.commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    &message,
                    &tree,
                    &[&head_commit],
                ).unwrap();
                Json(&true).into_response()
            }
            else {
                StatusCode::NOT_FOUND.into_response()
            }
        },
    }
}

async fn delete_notes_path(
    extract::Path(path): extract::Path<String>,
    extract::State(state): extract::State<AppState>,
) -> Response {
    tracing::debug!("delete_notes_path");

    let found = {
        let repo = state.repo.lock().unwrap();

        let head = repo.head().unwrap();
        let head_tree = head.peel_to_tree().unwrap();

        let mut index = Index::new().unwrap();
        index.read_tree(&head_tree).unwrap();

        index.iter().find(|entry| std::str::from_utf8(&entry.path).unwrap() == path)
    };
    if let Some(entry) = found {
        let repo = state.repo.lock().unwrap();

        let head = repo.head().unwrap();
        let head_tree = head.peel_to_tree().unwrap();
        let head_commit = head.peel_to_commit().unwrap();

        let mut index = Index::new().unwrap();
        index.read_tree(&head_tree).unwrap();

        let path = std::str::from_utf8(&entry.path).unwrap();
        index.remove(path.as_ref(), 0).unwrap();

        let tree_oid = index.write_tree_to(&repo).unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();

        let signature = repo.signature().unwrap();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &format!("Delete {}", &path),
            &tree,
            &[&head_commit],
        ).unwrap();
        Json(&true).into_response()
    }
    else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn serve_image_content(content: Vec<u8>, path: &Path) -> Response {
    // Build cache path
    let cache_root = PathBuf::from(env::var("MORIED_IMAGE_CACHE_DIR")
        .expect("MORIED_IMAGE_CACHE_DIR must be set"));
    let hash = Sha1::digest(&content);
    let mut buf = [0u8; 40];
    let hex = base16ct::lower::encode_str(&hash, &mut buf).unwrap();
    let cache_path = cache_root.join(&hex);

    // If we already have a webp in cache, serve it
    if let Ok(meta) = tokio::fs::metadata(&cache_path).await {
        if meta.is_file() {
            if let Ok(cached) = tokio::fs::read(&cache_path).await {
                let mut res = cached.into_response();
                res.headers_mut().insert(
                    header::CONTENT_TYPE,
                    "image/webp".parse().unwrap(),
                );
                return res;
            }
        }
    }

    // Otherwise write a temp file, call `convert`, cache & serve
    let tmp_dir = tempdir().unwrap();
    let tmp_file_path = tmp_dir.path().join(path.file_name().unwrap());
    tokio::fs::write(&tmp_file_path, &content).await.unwrap();

    let output = Command::new("convert")
        .arg(&tmp_file_path)
        .arg("-quality")
        .arg("1")
        .arg("webp:-")
        .stdout(Stdio::piped())
        .spawn()
        .unwrap()
        .wait_with_output()
        .await
        .unwrap();

    if output.status.success() {
        if let Some(parent) = cache_path.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        tokio::fs::write(&cache_path, &output.stdout).await.unwrap();

        let mut res = output.stdout.into_response();
        res.headers_mut().insert(
            header::CONTENT_TYPE,
            "image/webp".parse().unwrap(),
        );
        res
    } else {
        // Fallback to original image bytes + mime
        content_response(content, &path)
    }
}

async fn get_files_path(
    extract::Path(path): extract::Path<String>,
    extract::State(state): extract::State<AppState>,
) -> Response {
    tracing::debug!("get_files_path");

    if let Some((_, content)) = find_entry_blob(&state, &path).await {
        match mime_guess::from_path::<&Path>(path.as_ref()).first() {
            Some(mime) if mime.type_() == "image" => {
                serve_image_content(content, path.as_ref()).await
            },
            _ => content_response(content, path.as_ref()),
        }
    }
    else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn post_files(
    extract::State(state): extract::State<AppState>,
    mut multipart: extract::Multipart,
) -> Response {
    tracing::debug!("post_files_path");

    // Create a blob for each part (file) in the form data
    let mut files = Vec::new();
    let mut result = Vec::new();
    while let Some(field) = multipart.next_field().await.unwrap() {
        tracing::debug!("{:?}", field);

        let uuid = field.name().unwrap().to_owned();
        let filename = field.file_name().unwrap().as_bytes().to_vec();

        let blob_oid = {
            let data = field.bytes().await.unwrap();

            let repo = state.repo.lock().unwrap();
            let mut writer = repo.blob_writer(None).unwrap();
            writer.write_all(&data).unwrap();
            writer.commit().unwrap()
        };

        files.push((filename, blob_oid));
        result.push((uuid, "success"));
    }

    // Commit
    let repo = state.repo.lock().unwrap();

    let head = repo.head().unwrap();
    let head_tree = head.peel_to_tree().unwrap();
    let head_commit = head.peel_to_commit().unwrap();

    let mut index = Index::new().unwrap();
    index.read_tree(&head_tree).unwrap();

    let count = files.len();
    for (path, blob_oid) in files {
        let entry = IndexEntry {
            ctime: IndexTime::new(0, 0),
            mtime: IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode: 0o100644,
            uid: 0,
            gid: 0,
            file_size: 0,
            id: blob_oid,
            flags: 0,
            flags_extended: 0,
            path: path,
        };
        index.add(&entry).unwrap();
    }

    let tree_oid = index.write_tree_to(&repo).unwrap();
    let tree = repo.find_tree(tree_oid).unwrap();

    let signature = repo.signature().unwrap();
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        &format!("Upload {} files", count),
        &tree,
        &[&head_commit],
    ).unwrap();

    Json(result).into_response()
}

fn get_frontmatter_node(node: &markdown::mdast::Node) -> Option<&markdown::mdast::Node> {
    use markdown::mdast::Node;
    node.children().and_then(|children| children.get(0)).and_then(|first_child_node| {
        match first_child_node {
            Node::Yaml(_) | Node::Toml(_) => {
                Some(first_child_node)
            },
            _ => {
                None
            },
        }
    })
}

fn get_first_toplevel_rank1_heading(node: &markdown::mdast::Node) -> Option<&markdown::mdast::Node> {
    use markdown::mdast::Node;
    if let Node::Root(root) = node {
        for child in root.children.iter() {
            if let Node::Heading(heading) = child {
                if heading.depth == 1 {
                    return Some(child);
                }
            }
        }
        None
    }
    else {
        None
    }
}

/// Extract YAML frontmatter and the first top-level `#` heading from a blob.
///
/// `mime_type` gates the markdown parse. Images are skipped even when their bytes are valid
/// UTF-8, which SVG's are: parsing a multi-megabyte SVG as GFM markdown costs seconds and can
/// never yield frontmatter or a heading. On the real repository this is the difference between
/// 5.85 s and 0.77 s of a cold rebuild, and all 385 image entries are unaffected — none carried
/// a title or metadata before.
fn extract_metadata(blob: &[u8], mime_type: &str) -> (Option<serde_yaml::Value>, Option<String>) {
    if mime_type.starts_with("image/") {
        return (None, None);
    }
    if let Ok(text) = std::str::from_utf8(blob) {
        let mut opts = markdown::ParseOptions::gfm();
        opts.constructs.frontmatter = true;
        if let Ok(node) = markdown::to_mdast(text, &opts) {
            let metadata = if let Some(markdown::mdast::Node::Yaml(yaml_node)) = get_frontmatter_node(&node) {
                match serde_yaml::from_str::<serde_yaml::Value>(&yaml_node.value) {
                    Ok(doc) => {
                        tracing::debug!("parsed YAML metadata: {:?}", &doc);
                        Some(doc)
                    },
                    Err(err) => {
                        tracing::debug!("failed to parse YAML metadata: {:?}", &err);
                        let mut error_object = serde_yaml::Mapping::new();
                        error_object.insert("error".into(), format!("{}", err).into());
                        Some(serde_yaml::Value::Mapping(error_object))
                    },
                }
            }
            else {
                None
            };
            let title = get_first_toplevel_rank1_heading(&node).map(|heading_node| heading_node.to_string());
            (metadata, title)
        }
        else {
            (None, None)
        }
    }
    else {
        (None, None)
    }
}

/// Search notes for a given query with `git grep`.
pub async fn post_notes(
    Json(query): Json<GrepQuery>,
) -> impl IntoResponse {
    let git_dir = env::var("MORIED_GIT_DIR").unwrap();
    match grep_bare_repo(&git_dir, &query.pattern, "HEAD").await {
        Ok(matches) => Json(matches).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Error: {}", err),
        ).into_response(),
    }
}

pub async fn grep_bare_repo(
    git_dir: &str,
    pattern: &str,
    revision: &str,
) -> anyhow::Result<Vec<models::GrepMatch>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(git_dir)
        .arg("grep")
        .arg("--line-number")
        .arg("--null")
        .arg("-I")  // Don’t match the pattern in binary files
        .arg(pattern)
        .arg(revision)
        .output()
        .await
        .with_context(|| "Failed to execute git grep")?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "git grep failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout.lines() {
        let mut parts = line.split('\0');

        let file = match parts.next() {
            Some(f) => f.strip_prefix(&format!("{revision}:")).unwrap_or(f),
            None => continue,
        };

        let line_no = match parts.next().and_then(|s| s.parse::<usize>().ok()) {
            Some(n) => n,
            None => continue,
        };

        let content = match parts.next() {
            Some(c) => c.to_string(),
            None => continue,
        };

        results.push(GrepMatch {
            file: file.to_string(),
            line: line_no,
            content,
        });
    }

    Ok(results)
}

mod v2 {
    use super::*;
    use std::env;

    #[derive(Deserialize, Serialize)]
    pub struct AssessmentRequest {
        pub ancestor_titles: Option<Vec<String>>,
        pub title: String,
        pub tags: Option<Vec<String>>,
        pub status: Option<serde_json::Value>,
        pub progress: Option<f32>,
        pub importance: Option<i32>,
        pub urgency: Option<i32>,
        pub start_at: Option<String>,
        pub due_by: Option<String>,
        pub deadline: Option<String>,
        pub note: Option<String>,
    }

    #[derive(Serialize, Deserialize)]
    pub struct AssessmentResponse {
        pub quality_score: f32,
        pub suggestions: Vec<String>,
        pub feedback: String,
        pub note_suggestions: Vec<String>,
    }

    #[derive(Deserialize)]
    struct OpenAIResponse {
        choices: Vec<OpenAIChoice>,
    }

    #[derive(Deserialize)]
    struct OpenAIChoice {
        message: OpenAIMessage,
    }

    #[derive(Deserialize)]
    struct OpenAIMessage {
        content: String,
    }

    #[derive(Serialize)]
    struct OpenAIRequest {
        model: String,
        messages: Vec<ChatMessage>,
    }

    #[derive(Serialize)]
    pub struct ChatMessage {
        pub role: String,
        pub content: String,
    }

    /// Send a chat completion request to the provider and return the assistant's
    /// message content verbatim.
    async fn chat_completion(client: &reqwest::Client, messages: Vec<ChatMessage>) -> Result<String> {
        let openai_api_key = env::var("MORIED_OPENAI_API_KEY")
            .context("MORIED_OPENAI_API_KEY environment variable not set")?;
        let model = env::var("MORIED_OPENAI_MODEL")
            .context("MORIED_OPENAI_MODEL environment variable not set")?;

        let openai_request = OpenAIRequest {
            model,
            messages,
        };

        let response = client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", openai_api_key))
            .header("Content-Type", "application/json")
            // The shared client has no timeout, so bound this request only: a hung
            // provider call must not pin a connection forever.
            .timeout(time::Duration::from_secs(120))
            .json(&openai_request)
            .send()
            .await
            .context("Failed to send request to OpenAI")?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("OpenAI API error {}: {}", status, error_text));
        }

        let openai_response: OpenAIResponse = response
            .json()
            .await
            .context("Failed to parse OpenAI response")?;

        let content = openai_response
            .choices
            .into_iter()
            .next()
            .map(|choice| choice.message.content)
            .ok_or_else(|| anyhow::anyhow!("No response from OpenAI"))?;

        Ok(content)
    }

    pub async fn post_assess_task(
        extract::State(state): extract::State<AppState>,
        Json(request): Json<AssessmentRequest>,
    ) -> Result<Json<AssessmentResponse>, AppError> {
        // Create cache key from request data
        let request_json = serde_json::to_string(&request)
            .context("Failed to serialize request")?;
        let mut hasher = Sha1::new();
        hasher.update(request_json.as_bytes());
        let request_hash = format!("{:x}", hasher.finalize());

        // Check cache first (cache entries older than 24 hours are considered stale)
        let cache_expiry_hours = env::var("MORIED_OPENAI_CACHE_HOURS")
            .unwrap_or_else(|_| "24".to_string())
            .parse::<i64>()
            .unwrap_or(24);
        let cache_expiry_seconds = cache_expiry_hours * 3600;
        let now = chrono::Utc::now().timestamp();

        if let Ok(cached_response) = sqlx::query(
            "SELECT response_data FROM openai_cache WHERE request_hash = ? AND created_at > ?;"
        )
        .bind(&request_hash)
        .bind(now - cache_expiry_seconds)
        .map(|row: sqlx::sqlite::SqliteRow| -> String {
            row.get("response_data")
        })
        .fetch_one(&state.cache_db)
        .await
        {
            tracing::debug!("Returning cached OpenAI response for hash: {}", request_hash);
            let assessment: AssessmentResponse = serde_json::from_str(&cached_response)
                .context("Failed to parse cached response")?;
            return Ok(Json(assessment));
        }

        // Cache miss or expired - make API call
        let client = &state.http_client;

        // Get today's date for context
        let today = Utc::now().format("%Y-%m-%d").to_string();

        let context_part = if let Some(ref ancestors) = request.ancestor_titles {
            if !ancestors.is_empty() {
                format!(
                    "\n\nTask hierarchy context (from top-level to immediate parent):\n{}\n\nConsider the hierarchy context when evaluating the task title. The task title may be short and rely on context, but it should still be understandable within the hierarchy.",
                    ancestors.iter().enumerate()
                        .map(|(i, title)| format!("{}. <task-title>{}</task-title>", i + 1, title))
                        .collect::<Vec<_>>()
                        .join("\n")
                )
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        // Build complete task information as JSON for the prompt
        let task_information = serde_json::to_string_pretty(&request)
            .context("Failed to serialize task information to JSON")?;

        let prompt = format!(
            r#"Analyze the following task and provide comprehensive assistance:

Today's date: {}

Task Information (JSON):
{}{}

Primary Focus: Evaluate the TASK AS A WHOLE and suggest improvements for overall clarity and completeness.

The task information is provided as JSON containing:
- title: The main task description
- tags: Categories/labels associated with the task
- status: Current state of the task (todo, in_progress, waiting, etc.)
- progress: Completion percentage (0-100%)
- importance: Priority level (1-5, where 5 is most important)
- urgency: Time sensitivity (1-5, where 5 is most urgent)
- start_at: Planned start date/time
- due_by: Preferred completion date/time
- deadline: Hard deadline
- note: Any current notes about the task
- ancestor_titles: Hierarchical context (parent tasks)

Evaluate the task holistically by considering the combination of title, note, and other task information:
1. Overall clarity: Is it clear what needs to be done when considering title + note + other information together?
2. Completeness: Does the combined information provide sufficient context to understand and execute the task?
3. Actionability: Are the required actions clear from the overall task description?
4. Information sufficiency: Does the title need to be complete on its own, or does the note provide adequate context?

The title may be intentionally brief or incomplete if the note provides sufficient detail. Focus on the overall task comprehensibility rather than title completeness alone.

Suggest improvements that enhance overall task clarity, which may include:
- Title refinements (if needed for clarity)
- Note content additions or improvements
- Better organization of existing information
- Missing critical details that would help task execution

Respond with JSON:
{{
  "quality_score": <real number between 0 and 10, where 10 = excellent overall task clarity>,
  "suggestions": ["specific improvement suggestion for overall task clarity 1", "suggestion 2", ...],
  "feedback": "overall task assessment emphasizing how well the combined title+note+info communicates the task",
  "note_suggestions": ["helpful note content addition or improvement 1", "suggestion 2", "suggestion 3", ...]
}}

Important:
- Use the same language as the task title.
- Evaluate the task as a complete unit (title + note + other fields).
- Accept brief titles if the note provides adequate context.
- Keep suggestions practical and actionable.
- Write note snippets in GitHub Flavored Markdown format.
- Consider the complete task context when making suggestions.
            "#,
            today,
            task_information,
            context_part
        );

        let content = chat_completion(client, vec![
            ChatMessage {
                role: "developer".to_string(),
                content: "You are a helpful assistant that provides feedback on task titles and suggests practical note content for task completion. Always respond with valid JSON. Be concise but thorough in your suggestions.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: prompt,
            },
        ]).await?;

        // Parse the JSON content from OpenAI response
        let assessment: AssessmentResponse = serde_json::from_str(&content)
            .context("Failed to parse OpenAI JSON response")?;

        // Cache the response
        let response_json = serde_json::to_string(&assessment)
            .context("Failed to serialize response for caching")?;

        if let Err(e) = sqlx::query(
            "INSERT INTO openai_cache (request_hash, request_data, response_data, created_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(request_hash) DO UPDATE SET
                 response_data = excluded.response_data,
                 created_at = excluded.created_at;"
        )
        .bind(&request_hash)
        .bind(&request_json)
        .bind(&response_json)
        .bind(now)
        .execute(&state.cache_db)
        .await
        {
            tracing::debug!("Failed to cache OpenAI response: {}", e);
            // Don't fail the request if caching fails, just log it
        } else {
            tracing::debug!("Cached OpenAI response with hash: {}", request_hash);
        }

        tracing::debug!("Task assessment: {:?}", assessment.feedback);
        Ok(Json(assessment))
    }

    #[derive(Deserialize)]
    pub struct AiActionRequest {
        pub prompt: String,
    }

    #[derive(Serialize)]
    pub struct AiActionResponse {
        pub text: String,
    }

    /// Run a user-defined prompt through the provider and return the result as-is.
    ///
    /// Deliberately uncached: re-running an action on the same input is allowed to
    /// produce a different result.
    pub async fn post_ai_action(
        extract::State(state): extract::State<AppState>,
        Json(request): Json<AiActionRequest>,
    ) -> Result<Json<AiActionResponse>, AppError> {
        let text = chat_completion(&state.http_client, vec![
            ChatMessage {
                role: "developer".to_string(),
                content: "You are a text-processing assistant embedded in a Markdown note editor. \
                          Output only the resulting text: no preamble, no explanation, no commentary, \
                          and no surrounding code fences unless the result is itself meant to be a code block. \
                          Format the output as GitHub Flavored Markdown. \
                          Reply in the same language as the input unless the instruction says otherwise.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: request.prompt,
            },
        ]).await?;

        Ok(Json(AiActionResponse { text }))
    }

    pub async fn get_commits_head(
        extract::State(state): extract::State<AppState>,
    ) -> Result<Json<String>, AppError> {
        let repo = state.repo.lock().unwrap();
        let head = repo.head()?;
        let commit = head.peel_to_commit()?;
        let commit_id = commit.id();
        Ok(Json(commit_id.to_string()))
    }

    fn attach_oid(mut res: Response, oid: git2::Oid) -> Response {
        // ETag values should be quoted
        let etag_value = format!("\"{}\"", oid);
        res.headers_mut().insert(
            header::ETAG,
            HeaderValue::from_str(&etag_value).unwrap(),
        );
        res.headers_mut().insert(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_str("ETag").unwrap(),
        );
        res
    }

    async fn make_files_path_response(
        path: String,
        state: AppState,
        headers: HeaderMap,
    ) -> Response {
        if let Some((oid, content)) = find_entry_blob(&state, &path).await {
            // Check If-None-Match header, and shortcut to 304
            let etag_value = format!("\"{}\"", oid);
            if let Some(inm) = headers.get(header::IF_NONE_MATCH) {
                if inm.to_str().unwrap_or("") == etag_value {
                    return Response::builder()
                        .status(StatusCode::NOT_MODIFIED)
                        .header(header::ETAG, etag_value.clone())
                        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "ETag")
                        .body(Body::empty())
                        .unwrap();
                }
            }

            let res = match mime_guess::from_path::<&Path>(path.as_ref()).first() {
                Some(mime) if mime.type_() == "image" => {
                    serve_image_content(content, path.as_ref()).await
                },
                _ => content_response(content, path.as_ref()),
            };
            attach_oid(res, oid)
        }
        else {
            StatusCode::NOT_FOUND.into_response()
        }
    }

    fn head_from_full(full: Response) -> Response {
        let (parts, _) = full.into_parts();
        Response::from_parts(parts, Body::empty())
    }

    pub async fn get_files_path(
        extract::Path(path): extract::Path<String>,
        extract::State(state): extract::State<AppState>,
        headers: HeaderMap,
    ) -> Response {
        tracing::debug!("v2::get_files_path");
        make_files_path_response(path, state, headers).await
    }

    pub async fn head_files_path(
        extract::Path(path): extract::Path<String>,
        extract::State(state): extract::State<AppState>,
        headers: HeaderMap,
    ) -> Response {
        tracing::debug!("v2::head_files_path");
        head_from_full(make_files_path_response(path, state, headers).await)
    }

    #[derive(Deserialize)]
    pub struct TaskQuery {
        format: Option<String>,
    }

    pub async fn get_tasks(
        extract::Query(query): extract::Query<TaskQuery>,
        extract::State(state): extract::State<AppState>,
        headers: HeaderMap,
    ) -> Response {
        tracing::debug!("v2::get_tasks");

        // Load task entries
        let (head_commit_id, entries) = state.get_entries(Some(".tasks/*")).await.unwrap();

        // Check If-None-Match header, and shortcut to 304
        let etag_value = format!("\"{}\"", head_commit_id);
        if let Some(inm) = headers.get(header::IF_NONE_MATCH) {
            if inm.to_str().unwrap_or("") == etag_value {
                return Response::builder()
                    .status(StatusCode::NOT_MODIFIED)
                    .header(header::ETAG, etag_value.clone())
                    .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "ETag")
                    .body(Body::empty())
                    .unwrap();
            }
        }

        match query.format.as_deref() {
            Some("tree") => {
                // Tree structure response
                let roots = entries_to_tree(&entries, Some(".tasks")).unwrap();
                let response = Json(roots).into_response();
                attach_oid(response, head_commit_id)
            },
            _ => {
                // List structure response
                let response = Json(entries).into_response();
                attach_oid(response, head_commit_id)
            },
        }
    }

    pub async fn get_events(
        extract::State(state): extract::State<AppState>,
        headers: HeaderMap,
    ) -> Response {
        tracing::debug!("v2::get_events");

        // Load event entries
        let (head_commit_id, entries) = state.get_entries(Some(".events/*")).await.unwrap();

        // Check If-None-Match header, and shortcut to 304
        let etag_value = format!("\"{}\"", head_commit_id);
        if let Some(inm) = headers.get(header::IF_NONE_MATCH) {
            if inm.to_str().unwrap_or("") == etag_value {
                return Response::builder()
                    .status(StatusCode::NOT_MODIFIED)
                    .header(header::ETAG, etag_value.clone())
                    .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "ETag")
                    .body(Body::empty())
                    .unwrap();
            }
        }

        // Normal response
        let response = Json(entries).into_response();
        attach_oid(response, head_commit_id)
    }
}

mod models {
    use std::borrow::Cow;
    use std::collections::HashMap;
    use std::path::{Component, Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use std::option::Option;

    use anyhow::{bail, ensure, Context, Result};
    use axum::{
        extract,
        http::StatusCode,
        response::{IntoResponse, Response},
    };
    use chrono::{DateTime, FixedOffset, offset::TimeZone};
    use git2::{Repository, Oid};
    use serde::{Deserialize, Serialize};
    use serde_yaml;
    use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
    use tokio::{
        sync::watch,
    };
    use uuid::Uuid;

    pub type Metadata = serde_yaml::Value;

    #[derive(Debug, Deserialize, Serialize, Clone)]
    pub struct ListEntry {
        pub path: PathBuf,
        pub size: usize,
        pub mime_type: String,
        pub metadata: Option<Metadata>,
        pub title: Option<String>,
        pub time: DateTime<FixedOffset>,
    }

    #[derive(Debug, Serialize, Clone)]
    pub struct TreeNode {
        pub uuid: Uuid,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub name: Option<String>,
        pub path: PathBuf,
        pub size: usize,
        pub mime_type: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub metadata: Option<Metadata>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub title: Option<String>,
        pub mtime: DateTime<FixedOffset>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        pub children: Vec<TreeNode>,
    }

    pub fn entries_to_tree(entries: &[ListEntry], special_dir: Option<&str>) -> Result<Vec<TreeNode>> {
        let mut nodes_by_uuid: HashMap<Uuid, TreeNode> = HashMap::with_capacity(entries.len());
        let mut parent_of: HashMap<Uuid, Option<Uuid>> = HashMap::with_capacity(entries.len());

        for e in entries {
            let logical = strip_special_dir(&e.path, special_dir)
                .with_context(|| format!("While handling {}", e.path.display()))?;

            validate_path_constraints(&logical)
                .with_context(|| format!("Path constraints violation: {}", e.path.display()))?;

            // Extract UUID and optional name portions from filename stem
            let stem = logical.file_stem().context("Missing filename stem")?
                .to_str().context("Filename stem is not UTF-8")?;
            let (file_uuid, name) = parse_file_uuid(stem)
                .with_context(|| format!("While handling {}", e.path.display()))?;

            let parent_uuid = logical.parent()
                .and_then(|p| p.file_name())
                .map(|os_str| -> Result<Uuid> {
                    let s = os_str.to_str().context("Non-UTF-8 directory name")?;
                    parse_uuid_v4(s)
                })
                .transpose()?;

            let node = TreeNode {
                uuid: file_uuid,
                name,
                path: e.path.clone(),
                size: e.size,
                mime_type: e.mime_type.clone(),
                metadata: e.metadata.clone(),
                title: e.title.clone(),
                mtime: e.time,
                children: Vec::new(),
            };

            ensure!(
                nodes_by_uuid.insert(file_uuid, node).is_none(),
                "Duplicate file UUID in entries: {}",
                file_uuid
            );
            parent_of.insert(file_uuid, parent_uuid);
        }

        let mut children_of: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
        for (child, maybe_parent) in &parent_of {
            if let Some(p) = maybe_parent {
                ensure!(
                    nodes_by_uuid.contains_key(p),
                    "Parent directory UUID {} has no corresponding file entry",
                    p
                );
                children_of.entry(*p).or_default().push(*child);
            }
        }

        let mut roots: Vec<TreeNode> = Vec::new();
        let mut pool = nodes_by_uuid;
        for (uuid, parent) in parent_of {
            if parent.is_none() {
                roots.push(assemble_tree(uuid, &mut pool, &children_of)?);
            }
        }

        sort_forest(&mut roots);

        Ok(roots)
    }

    fn strip_special_dir<'a>(path: &'a Path, special: Option<&str>) -> Result<Cow<'a, Path>> {
        if let Some(sd) = special {
            if let Some(Component::Normal(first)) = path.components().next() {
                if first == sd {
                    let stripped = path.strip_prefix(sd)
                        .with_context(|| format!("Failed to strip special dir '{}' from {}", sd, path.display()))?;
                    ensure!(stripped.components().next().is_some(), "Path becomes empty after stripping '{}'", sd);
                    return Ok(Cow::Owned(stripped.to_path_buf()));
                }
            }
        }
        Ok(Cow::Borrowed(path))
    }

    fn validate_path_constraints(path: &Path) -> Result<()> {
        for comp in path.components() {
            match comp {
                Component::CurDir | Component::ParentDir => {
                    bail!("Path contains '.' or '..': {}", path.display());
                }
                Component::Normal(os_str) => {
                    // Skip filename
                    if Some(os_str) == path.file_name() {
                        break;
                    }
                    let s = os_str.to_str().context("Non-UTF-8 directory component")?;
                    parse_uuid_v4(s)
                        .with_context(|| format!("Directory component must be UUIDv4 (got '{}')", s))?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn assemble_tree(id: Uuid, pool: &mut HashMap<Uuid, TreeNode>, children_of: &HashMap<Uuid, Vec<Uuid>>) -> Result<TreeNode> {
        let mut me = pool.remove(&id)
            .context("Specified node must exist in `pool`")?;
        if let Some(kids) = children_of.get(&id) {
            for &kid in kids {
                let child_node = assemble_tree(kid, pool, children_of)?;
                me.children.push(child_node);
            }
        }
        Ok(me)
    }

    fn parse_file_uuid(stem: &str) -> Result<(Uuid, Option<String>)> {
        ensure!(stem.len() >= 36, "stem too short for UUID");
        let cand = &stem[stem.len() - 36..];
        let uuid = parse_uuid_v4(cand)
            .with_context(|| format!("Filename stem must end with UUIDv4: {}", stem))?;

        let leading = &stem[..stem.len() - 36];
        let leading = leading.strip_suffix('-').unwrap_or(leading);
        let name = if leading.is_empty() { None } else { Some(leading.to_string()) };

        Ok((uuid, name))
    }

    fn parse_uuid_v4(s: &str) -> Result<Uuid> {
        let u = Uuid::parse_str(s)
            .with_context(|| format!("'{}' is not a UUID", s))?;
        ensure!(u.get_version() == Some(uuid::Version::Random), "UUID is not v4");
        Ok(u)
    }

    fn sort_forest(nodes: &mut [TreeNode]) {
        nodes.sort_by(|a, b| {
            b.mtime.cmp(&a.mtime)
        });
        for n in nodes.iter_mut() {
            sort_forest(&mut n.children);
        }
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct Claims {
        pub sub: String,
        pub exp: usize,
        pub email: String,
    }

    /// How the cache stands relative to HEAD.
    ///
    /// Ancestry deliberately plays no part in classification. Syncing is a tree comparison, which
    /// is valid between any two commits, so "the cache is behind" and "the history was rewritten"
    /// are the same case and cost the same. What matters here is only whether the cached commit is
    /// still *reachable in the object database*, since that is what a tree diff needs.
    ///
    /// (The sync itself does ask whether HEAD descends from the cached commit, to decide how to
    /// treat content reverted within the window -- but via merge-base machinery, not the linear
    /// revwalk this classification used to run on every request.)
    #[derive(Debug, Clone, Copy)]
    pub enum CacheState {
        Fresh(Oid),
        /// The cached commit differs from HEAD but its object is still present, so HEAD can be
        /// reached by diffing two trees.
        Behind { base: Oid, head: Oid },
        /// No cached commit, or its object is gone -- typically a force-push followed by a gc.
        Cold(Oid),
    }

    impl CacheState {
        /// The commit the cache should end up describing.
        pub fn head(&self) -> Oid {
            match *self {
                CacheState::Fresh(head) => head,
                CacheState::Behind { head, .. } => head,
                CacheState::Cold(head) => head,
            }
        }
    }

    pub struct AppError(anyhow::Error);

    impl IntoResponse for AppError {
        fn into_response(self) -> Response {
            tracing::error!("AppError: {:?}", self.0);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("AppError: {}", self.0),
            )
                .into_response()
        }
    }

    impl<E> From<E> for AppError
    where
        E: Into<anyhow::Error>,
    {
        fn from(err: E) -> Self {
            Self(err.into())
        }
    }

    #[derive(Clone, extract::FromRef)]
    pub struct AppState {
        pub repo: Arc<Mutex<Repository>>,
        pub cache_db: SqlitePool,
        pub tx: watch::Sender<CacheState>,
        pub http_client: reqwest::Client,
    }

    impl AppState {
        pub async fn get_entries(&self, pattern_opt: Option<&str>) -> Result<(Oid, Vec<ListEntry>)> {
            let cache_state = self.check_cache_state().await?;
            let _ = self.tx.send(cache_state.clone());
            let cache_commit_id = match cache_state {
                CacheState::Fresh(head) => head,
                CacheState::Behind { base, .. } => base,
                CacheState::Cold(_) => Oid::zero(),
            };

            // Return the latest version of cached entries
            let query = if let Some(pattern) = pattern_opt {
                sqlx::query("SELECT * FROM entry WHERE path GLOB ?;")
                    .bind(pattern)
            }
            else {
                sqlx::query("SELECT * FROM entry;")
            };
            let entries = query
                .map(|row: SqliteRow| {
                    let tz = FixedOffset::east_opt(row.get("tz_offset")).unwrap();
                    let time = tz.timestamp_opt(row.get("time"), 0).unwrap();
                    ListEntry {
                        path: row.get::<String, _>("path").into(),
                        size: row.get::<i64, _>("size") as usize,
                        mime_type: row.get("mime_type"),
                        metadata: serde_json::from_str(&row.get::<String, _>("metadata")).unwrap(),
                        title: row.get("title"),
                        time: time,
                    }
                })
                .fetch_all(&self.cache_db)
                .await?;

            Ok((cache_commit_id, entries))
        }

        pub async fn check_cache_state(
            &self,
        ) -> Result<CacheState> {
            let head_commit_id = self.repo.lock().unwrap().head()?.peel_to_commit()?.id();

            let cache_commit_id_opt = sqlx::query(
                    "SELECT value FROM cache_state WHERE key = 'commit_id';",
                )
                .map(|row: SqliteRow| {
                    Oid::from_str(row.get("value")).unwrap()
                })
                .fetch_optional(&self.cache_db)
                .await?;

            match cache_commit_id_opt {
                Some(cache_commit_id) if cache_commit_id == head_commit_id => {
                    Ok(CacheState::Fresh(head_commit_id))
                },
                // Two hash lookups, where the old ancestry probe was a linear revwalk that, in
                // exactly the rewritten-history case, walked the entire history to completion
                // before returning false -- on the request path.
                Some(cache_commit_id)
                    if self.repo.lock().unwrap().find_commit(cache_commit_id).is_ok() =>
                {
                    Ok(CacheState::Behind { base: cache_commit_id, head: head_commit_id })
                },
                _ => {
                    Ok(CacheState::Cold(head_commit_id))
                },
            }
        }
    }

    #[derive(Debug, Deserialize, Serialize, Clone)]
    pub struct Login {
        pub user: String,
        pub password: String,
    }

    #[derive(Debug, Deserialize, Serialize, Clone)]
    pub enum NoteSave {
        Save {
            content: String,
            message: String,
        },
        Rename {
            from: String,
        },
    }

    #[derive(Debug, Deserialize, Serialize, Clone)]
    pub struct GrepQuery {
        pub pattern: String,
    }

    #[derive(Serialize)]
    pub struct GrepMatch {
        pub file: String,
        pub line: usize,
        pub content: String,
    }
}
