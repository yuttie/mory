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

mod ical;

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
    let cache_writer_pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(cache_db_opts.clone().read_only(false))
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
    let (done_tx, done_rx) = watch::channel(None);

    let state = models::AppState {
        repo: repo.clone(),
        cache_db: cache_reader_pool,
        cache_db_writer: cache_writer_pool,
        cache_sync: Arc::new(CacheSync { request: refresh_tx, done: done_rx }),
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
        done_tx,
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
        .route("/entries", get(v2::get_entries))
        .route("/tasks", get(v2::get_tasks))
        .route("/events", get(v2::get_events))
        .route("/imported-events", get(v2::get_imported_events))
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
            CREATE TABLE IF NOT EXISTS ical_cache (
                url            TEXT PRIMARY KEY,
                body           TEXT NOT NULL,
                etag           TEXT,
                last_modified  TEXT,
                created_at     INTEGER NOT NULL
            ) STRICT, WITHOUT ROWID;
        ")
        .execute(&mut *conn)
        .await?;
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
    done: watch::Sender<Option<Oid>>,
    mut conn: SqliteConnection,
) {
    while rx.changed().await.is_ok() {
        let cache_state = *rx.borrow_and_update();
        if let Err(e) = sync_cache_to(&mut conn, repo.clone(), cache_state).await {
            tracing::error!("sync_cache_to() failed: {:?}", e);
        }
        // Publish what the cache describes now, successful or not, so that anyone waiting on this
        // sync wakes rather than sitting out their whole deadline.
        let current = sqlx::query_scalar::<_, String>(
                "SELECT value FROM cache_state WHERE key = 'commit_id';",
            )
            .fetch_optional(&mut conn)
            .await
            .ok()
            .flatten()
            .and_then(|value| Oid::from_str(&value).ok());
        let _ = done.send(current);
    }
}

/// How long a read waits for the cache to reach HEAD before serving what is there.
///
/// After the tree-diff sync an ordinary save lands in milliseconds, so this only matters when a
/// full rebuild is genuinely required -- an empty table, or a cached commit that has been garbage
/// collected. Startup syncs before binding the listener, so those never reach a request at all.
fn cache_sync_deadline() -> time::Duration {
    let ms = env::var("MORIED_CACHE_SYNC_DEADLINE_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(3000);
    time::Duration::from_millis(ms)
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

    // The state was observed by whoever asked, which may have been before an earlier sync landed:
    // a mutation nudges, and the read that follows nudges again from the same stale reading. Both
    // then name a commit the cache has already reached, so check before doing the work again.
    let current = sqlx::query_scalar::<_, String>(
            "SELECT value FROM cache_state WHERE key = 'commit_id';",
        )
        .fetch_optional(&mut *conn)
        .await?
        .and_then(|value| Oid::from_str(&value).ok());
    if current == Some(head) {
        return Ok(());
    }

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

    let response = match note_save {
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
    };

    // Let the writer start on the new HEAD now, rather than leaving the next read to discover
    // it. Unconditional: when HEAD did not move the sync sees a fresh cache and returns at once,
    // which is cheaper than working out whether this particular branch changed anything.
    state.nudge_cache().await;
    response
}

async fn delete_notes_path(
    extract::Path(path): extract::Path<String>,
    extract::State(state): extract::State<AppState>,
) -> Response {
    tracing::debug!("delete_notes_path");

    let response = {
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
    };

    // Let the writer start on the new HEAD now, rather than leaving the next read to discover
    // it. Unconditional: when HEAD did not move the sync sees a fresh cache and returns at once,
    // which is cheaper than working out whether this particular branch changed anything.
    state.nudge_cache().await;
    response
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

    // Commit. Scoped so the repository guard and everything borrowing from it are released
    // before the cache is nudged, which re-locks it.
    {
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
    }

    // Let the writer start on the new HEAD now, rather than leaving the next read to discover
    // it. Unconditional: when HEAD did not move the sync sees a fresh cache and returns at once,
    // which is cheaper than working out whether this particular branch changed anything.
    state.nudge_cache().await;

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
    use anyhow::bail;
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
        .execute(&state.cache_db_writer)
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

    #[derive(serde::Deserialize)]
    pub struct ImportedEventsQuery {
        pub start: String,
        pub end: String,
    }

    #[derive(serde::Deserialize)]
    struct CalendarSubscriptions {
        #[serde(default)]
        calendars: Vec<CalendarSubscription>,
    }

    #[derive(serde::Deserialize)]
    struct CalendarSubscription {
        id: String,
        #[serde(default)]
        name: Option<String>,
        url: String,
        #[serde(default)]
        color: Option<String>,
        #[serde(default = "default_true")]
        enabled: bool,
    }

    fn default_true() -> bool {
        true
    }

    #[derive(Serialize)]
    pub struct CalendarReport {
        id: String,
        name: String,
        color: Option<String>,
        /// `None` when the feed was read. A calendar that fails is reported here rather than
        /// failing the request, so one dead feed cannot blank the whole view.
        error: Option<String>,
    }

    #[derive(Serialize)]
    pub struct ImportedEventsResponse {
        calendars: Vec<CalendarReport>,
        events: Vec<crate::ical::ImportedEvent>,
        series: std::collections::BTreeMap<String, crate::ical::SeriesDefinition>,
        /// Set when some series hit the per-series occurrence cap, so the client can say the view
        /// is incomplete rather than quietly showing less than exists.
        truncated: bool,
    }

    /// Where the subscription list lives, alongside the app's other repository-held config.
    const CALENDARS_PATH: &str = ".mory/calendars.yaml";

    /// How long a fetched feed is served from the cache before it is revalidated.
    fn ical_cache_seconds() -> i64 {
        env::var("MORIED_ICAL_CACHE_MINUTES")
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(60)
            * 60
    }

    /// The largest feed we will read into memory.
    const MAX_FEED_BYTES: usize = 8 * 1024 * 1024;

    /// At most this many hops, which is more than any calendar host needs.
    const MAX_FEED_REDIRECTS: usize = 5;

    /// Whether a URL is one a feed may be fetched from, or redirected to.
    ///
    /// Declaring a URL in the repository is not on its own a defence: a declared address can
    /// redirect somewhere else, and the body would come back to the caller. Redirects must still be
    /// followed -- Google hands out `www.google.com/calendar/ical/...` links that 302 to
    /// `calendar.google.com` -- so each hop is checked instead of refused.
    ///
    /// This is a hostname check, so it stops the obvious cases and not a host that resolves to a
    /// private address anyway. Blocking that needs the resolved IP, which means a custom connector;
    /// for a single-user app fetching calendars it names itself, this is the proportionate guard.
    pub fn is_fetchable_feed_url(url: &reqwest::Url) -> bool {
        if url.scheme() != "https" {
            return false;
        }
        let Some(host) = url.host_str() else {
            return false;
        };
        let host = host.trim_end_matches('.').to_ascii_lowercase();
        // `host_str` keeps the brackets on an IPv6 literal, which `IpAddr` will not parse.
        let literal = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(&host);

        if let Ok(ip) = literal.parse::<std::net::IpAddr>() {
            return !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || match ip {
                    std::net::IpAddr::V4(v4) => {
                        v4.is_private() || v4.is_link_local() || v4.is_broadcast()
                    }
                    // Unique-local (fc00::/7) and link-local (fe80::/10).
                    std::net::IpAddr::V6(v6) => {
                        let segments = v6.segments();
                        (segments[0] & 0xfe00) == 0xfc00 || (segments[0] & 0xffc0) == 0xfe80
                    }
                });
        }

        host != "localhost"
            && !host.ends_with(".localhost")
            && !host.ends_with(".local")
            && !host.ends_with(".internal")
    }

    fn feed_client() -> reqwest::Client {
        let redirect = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_FEED_REDIRECTS {
                return attempt.error("too many redirects");
            }
            if is_fetchable_feed_url(attempt.url()) {
                attempt.follow()
            }
            else {
                attempt.error("redirected somewhere a calendar may not be fetched from")
            }
        });
        reqwest::Client::builder()
            .gzip(true)
            .brotli(true)
            .redirect(redirect)
            .timeout(time::Duration::from_secs(20))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    }

    struct CachedFeed {
        body: String,
        etag: Option<String>,
        last_modified: Option<String>,
        age: i64,
    }

    async fn read_cached_feed(state: &AppState, url: &str) -> Option<CachedFeed> {
        let now = chrono::Utc::now().timestamp();
        let row = sqlx::query(
            "SELECT body, etag, last_modified, created_at FROM ical_cache WHERE url = ?",
        )
        .bind(url)
        .fetch_optional(&state.cache_db)
        .await
        .ok()??;
        let created_at: i64 = row.get("created_at");
        Some(CachedFeed {
            body: row.get("body"),
            etag: row.get("etag"),
            last_modified: row.get("last_modified"),
            age: now - created_at,
        })
    }

    async fn write_cached_feed(
        state: &AppState,
        url: &str,
        body: &str,
        etag: Option<&str>,
        last_modified: Option<&str>,
    ) {
        let now = chrono::Utc::now().timestamp();
        if let Err(e) = sqlx::query(
            "INSERT INTO ical_cache (url, body, etag, last_modified, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(url) DO UPDATE SET
                 body = excluded.body,
                 etag = excluded.etag,
                 last_modified = excluded.last_modified,
                 created_at = excluded.created_at;",
        )
        .bind(url)
        .bind(body)
        .bind(etag)
        .bind(last_modified)
        .bind(now)
        .execute(&state.cache_db_writer)
        .await
        {
            tracing::debug!("Failed to cache the feed {}: {}", url, e);
        }
        // Bounded so `cache.sqlite` cannot grow without limit; a dropped row simply refetches.
        let cutoff = now - 30 * 24 * 3600;
        let _ = sqlx::query("DELETE FROM ical_cache WHERE created_at < ?")
            .bind(cutoff)
            .execute(&state.cache_db_writer)
            .await;
    }

    /// The feed body, from the cache when it is still fresh and from the network otherwise.
    ///
    /// A revalidation answered with 304 refreshes the row's age, so a feed that rarely changes
    /// costs one conditional request rather than a full download.
    async fn fetch_feed(state: &AppState, url: &str) -> Result<String> {
        let parsed = reqwest::Url::parse(url).context("the calendar URL is not a URL")?;
        if !is_fetchable_feed_url(&parsed) {
            bail!("a calendar must be an https:// URL on a public host");
        }

        let cached = read_cached_feed(state, url).await;
        if let Some(cached) = &cached {
            if cached.age < ical_cache_seconds() {
                return Ok(cached.body.clone());
            }
        }

        let client = feed_client();
        let mut request = client.get(url);
        if let Some(cached) = &cached {
            if let Some(etag) = &cached.etag {
                request = request.header(header::IF_NONE_MATCH, etag);
            }
            else if let Some(modified) = &cached.last_modified {
                request = request.header(header::IF_MODIFIED_SINCE, modified);
            }
        }

        let response = match request.send().await {
            Ok(response) => response,
            Err(e) => {
                // Serving a stale feed beats blanking the calendar because a network blipped.
                if let Some(cached) = cached {
                    tracing::debug!("Serving a stale feed for {}: {}", url, e);
                    return Ok(cached.body);
                }
                return Err(e.into());
            }
        };

        if response.status() == StatusCode::NOT_MODIFIED {
            if let Some(cached) = cached {
                write_cached_feed(
                    state, url, &cached.body, cached.etag.as_deref(),
                    cached.last_modified.as_deref(),
                ).await;
                return Ok(cached.body);
            }
        }
        if !response.status().is_success() {
            bail!("the calendar responded {}", response.status());
        }

        let etag = response
            .headers()
            .get(header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let last_modified = response
            .headers()
            .get(header::LAST_MODIFIED)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);

        if let Some(length) = response.content_length() {
            if length as usize > MAX_FEED_BYTES {
                bail!("the calendar is larger than {} bytes", MAX_FEED_BYTES);
            }
        }
        let body = response.text().await?;
        if body.len() > MAX_FEED_BYTES {
            bail!("the calendar is larger than {} bytes", MAX_FEED_BYTES);
        }

        write_cached_feed(state, url, &body, etag.as_deref(), last_modified.as_deref()).await;
        Ok(body)
    }

    async fn read_subscriptions(state: &AppState) -> Result<Vec<CalendarSubscription>> {
        let Some((_, content)) = find_entry_blob(state, CALENDARS_PATH).await else {
            // No file means no calendars, which is the normal state before any are added.
            return Ok(Vec::new());
        };
        let text = String::from_utf8(content.to_vec())
            .context("the calendar list is not UTF-8")?;
        if text.trim().is_empty() {
            return Ok(Vec::new());
        }
        let parsed: CalendarSubscriptions = serde_yaml::from_str(&text)
            .context("the calendar list is not valid YAML")?;
        Ok(parsed.calendars)
    }

    /// Events from every subscribed calendar that fall inside the requested window.
    pub async fn get_imported_events(
        extract::Query(query): extract::Query<ImportedEventsQuery>,
        extract::State(state): extract::State<AppState>,
    ) -> Result<Json<ImportedEventsResponse>, AppError> {
        tracing::debug!("v2::get_imported_events");

        let (from, to) = crate::ical::parse_window(&query.start, &query.end)?;
        let subscriptions = read_subscriptions(&state).await?;

        let mut response = ImportedEventsResponse {
            calendars: Vec::new(),
            events: Vec::new(),
            series: std::collections::BTreeMap::new(),
            truncated: false,
        };

        for subscription in subscriptions {
            let name = subscription.name.clone().unwrap_or_else(|| subscription.id.clone());
            if !subscription.enabled {
                continue;
            }

            let outcome = async {
                let body = fetch_feed(&state, &subscription.url).await?;
                let calendar = crate::ical::parse_calendar(&body)?;
                Ok::<_, anyhow::Error>(crate::ical::expand(
                    &calendar, &subscription.id, from, to,
                ))
            }
            .await;

            match outcome {
                Ok(expansion) => {
                    response.truncated |= expansion.limited;
                    response.events.extend(expansion.events);
                    response.series.extend(expansion.series);
                    let error = if expansion.warnings.is_empty() {
                        None
                    }
                    else {
                        Some(expansion.warnings.join("; "))
                    };
                    response.calendars.push(CalendarReport {
                        id: subscription.id,
                        name,
                        color: subscription.color,
                        error,
                    });
                }
                Err(e) => {
                    tracing::debug!("Calendar {} failed: {:#}", subscription.id, e);
                    response.calendars.push(CalendarReport {
                        id: subscription.id,
                        name,
                        color: subscription.color,
                        error: Some(format!("{e:#}")),
                    });
                }
            }
        }

        response.events.sort_by(|a, b| a.start.cmp(&b.start));
        Ok(Json(response))
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

    #[derive(Deserialize)]
    pub struct EntriesQuery {
        /// The commit the client's cached listing describes, if it has one.
        pub since: Option<String>,
    }

    /// The file listing, or just what changed since a commit the client already has.
    ///
    /// One tagged shape so a client handles either uniformly.
    #[derive(Serialize)]
    #[serde(tag = "kind", rename_all = "lowercase")]
    pub enum EntriesResponse {
        Full {
            commit: String,
            head: String,
            entries: Vec<ListEntry>,
        },
        Delta {
            commit: String,
            head: String,
            base: String,
            changed: Vec<ListEntry>,
            deleted: Vec<PathBuf>,
        },
    }

    /// `GET /v2/entries[?since=<oid>]`
    ///
    /// `commit` is the commit the returned rows actually describe; `head` is where the repository
    /// actually is. They differ only while a sync is still running, and reporting both means the
    /// client can tell without spending a second request on `/v2/commits/head`.
    pub async fn get_entries(
        extract::Query(query): extract::Query<EntriesQuery>,
        extract::State(state): extract::State<AppState>,
    ) -> Result<Json<EntriesResponse>, AppError> {
        tracing::debug!("v2::get_entries");

        state.ensure_cache().await?;
        let head = state.head_commit_id()?.to_string();

        // Serve a delta when the client names a commit still present in the object database.
        // Ancestry is deliberately not required: a client whose commit was force-pushed away
        // still gets a delta rather than a 660 KB refetch, because a tree diff is valid between
        // any two commits.
        if let Some(since) = query.since.as_deref().and_then(|s| Oid::from_str(s).ok()) {
            if let Some((base, changed_paths, deleted)) = state.entry_delta_since(since)? {
                let (commit, changed) = state.read_entries_at(&changed_paths).await?;
                // Past roughly a quarter of the listing a full response is cheaper than a large
                // `changed` array plus the client's merge, so fall through to it.
                let total = state.entry_count().await?;
                if total == 0 || changed.len() * 4 < total {
                    return Ok(Json(EntriesResponse::Delta {
                        commit: commit.to_string(),
                        head,
                        base: base.to_string(),
                        changed,
                        deleted,
                    }));
                }
            }
        }

        let (commit, entries) = state.read_entries(None).await?;
        Ok(Json(EntriesResponse::Full {
            commit: commit.to_string(),
            head,
            entries,
        }))
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

    fn row_to_list_entry(row: SqliteRow) -> ListEntry {
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
    }

    /// Requests cache syncs and lets a reader wait for one to land.
    ///
    /// `request` collapses a burst of nudges to the latest state; `done` carries the commit the
    /// cache describes after each attempt -- published even when the sync failed, so a waiter
    /// always wakes rather than sitting out its whole deadline.
    pub struct CacheSync {
        pub request: watch::Sender<CacheState>,
        pub done: watch::Receiver<Option<Oid>>,
    }

    #[derive(Clone, extract::FromRef)]
    pub struct AppState {
        pub repo: Arc<Mutex<Repository>>,
        pub cache_db: SqlitePool,
        /// Writes to the disposable caches a handler owns, such as `openai_cache`.
        ///
        /// `cache_db` is opened read-only, so a handler cannot write through it -- an INSERT there
        /// fails with "attempt to write a readonly database". The `entry` table is not affected,
        /// because its writes belong to `cache_manager_task`, which holds its own connection; this
        /// is for the caches that have no such task behind them. Single connection, because SQLite
        /// serialises writers anyway and a pool would only queue them in a second place.
        #[from_ref(skip)]
        pub cache_db_writer: SqlitePool,
        pub cache_sync: Arc<CacheSync>,
        pub http_client: reqwest::Client,
    }

    impl AppState {
        /// Ask for a sync to HEAD and wait for it, up to a deadline.
        ///
        /// Expiry is not an error. The caller then serves whatever the cache holds, labelled with
        /// the commit that content actually describes -- which is honest, and lets the client
        /// converge on its next read. Blocking until a cold rebuild finishes would be worse for
        /// everyone, and lying about the commit is what this whole change exists to stop.
        pub async fn ensure_cache(&self) -> Result<()> {
            let cache_state = self.check_cache_state().await?;
            if let CacheState::Fresh(_) = cache_state {
                return Ok(());
            }
            let head = cache_state.head();

            // Subscribe before requesting, so a sync that finishes immediately is not missed.
            let mut done = self.cache_sync.done.clone();
            done.mark_unchanged();
            let _ = self.cache_sync.request.send(cache_state);

            let _ = tokio::time::timeout(super::cache_sync_deadline(), async {
                loop {
                    if *done.borrow_and_update() == Some(head) {
                        return;
                    }
                    if done.changed().await.is_err() {
                        return;
                    }
                }
            })
            .await;
            Ok(())
        }

        /// Nudge the writer without waiting, after a mutation has moved HEAD.
        pub async fn nudge_cache(&self) {
            match self.check_cache_state().await {
                Ok(cache_state) => {
                    let _ = self.cache_sync.request.send(cache_state);
                },
                Err(e) => {
                    tracing::warn!("Failed to inspect the cache state after a mutation: {:?}", e);
                },
            }
        }

        pub async fn get_entries(&self, pattern_opt: Option<&str>) -> Result<(Oid, Vec<ListEntry>)> {
            self.ensure_cache().await?;
            self.read_entries(pattern_opt).await
        }

        /// Read the cache as it stands, without waiting for a sync.
        pub async fn read_entries(&self, pattern_opt: Option<&str>) -> Result<(Oid, Vec<ListEntry>)> {
            // Read the rows and the commit they describe in one transaction. Under WAL that is a
            // single snapshot, so the label can never belong to a different generation than the
            // rows -- the bug this replaces, where the listing was served at the *old* commit
            // while `/v2/commits/head` already reported the new one.
            let mut txn = self.cache_db.begin().await?;
            let cache_commit_id = sqlx::query_scalar::<_, String>(
                    "SELECT value FROM cache_state WHERE key = 'commit_id';",
                )
                .fetch_optional(&mut *txn)
                .await?
                .and_then(|value| Oid::from_str(&value).ok())
                .unwrap_or_else(Oid::zero);

            // Return the latest version of cached entries
            let query = if let Some(pattern) = pattern_opt {
                sqlx::query("SELECT * FROM entry WHERE path GLOB ?;")
                    .bind(pattern)
            }
            else {
                sqlx::query("SELECT * FROM entry;")
            };
            let entries = query
                .map(row_to_list_entry)
                .fetch_all(&mut *txn)
                .await?;

            Ok((cache_commit_id, entries))
        }

        /// Where the repository actually is.
        pub fn head_commit_id(&self) -> Result<Oid> {
            Ok(self.repo.lock().unwrap().head()?.peel_to_commit()?.id())
        }

        /// How many rows the cache holds.
        pub async fn entry_count(&self) -> Result<usize> {
            let count: i64 = sqlx::query_scalar("SELECT count(*) FROM entry;")
                .fetch_one(&self.cache_db)
                .await?;
            Ok(count as usize)
        }

        /// What changed between `since` and the commit the cache currently describes.
        ///
        /// `None` when no delta can be computed -- either commit missing from the object
        /// database, or the cache has no commit at all -- in which case the caller serves a full
        /// listing rather than an error.
        pub fn entry_delta_since(
            &self,
            since: Oid,
        ) -> Result<Option<(Oid, Vec<PathBuf>, Vec<PathBuf>)>> {
            let repo = self.repo.lock().unwrap();
            let Ok(since_tree) = repo.find_commit(since).and_then(|c| c.tree()) else {
                return Ok(None);
            };
            let head = match repo.head().and_then(|h| h.peel_to_commit()) {
                Ok(commit) => commit,
                Err(_) => return Ok(None),
            };
            let head_tree = head.tree()?;

            let diff = repo.diff_tree_to_tree(Some(&since_tree), Some(&head_tree), None)?;
            let mut changed = Vec::new();
            let mut deleted = Vec::new();
            for delta in diff.deltas() {
                use git2::Delta;
                match delta.status() {
                    Delta::Added | Delta::Modified | Delta::Copied => {
                        changed.push(delta.new_file().path().unwrap().to_owned());
                    },
                    Delta::Renamed => {
                        changed.push(delta.new_file().path().unwrap().to_owned());
                        deleted.push(delta.old_file().path().unwrap().to_owned());
                    },
                    Delta::Deleted => {
                        deleted.push(delta.old_file().path().unwrap().to_owned());
                    },
                    _ => (),
                }
            }
            Ok(Some((since, changed, deleted)))
        }

        /// The rows for `paths` only, with the commit the cache describes.
        ///
        /// Used to answer a delta without materialising -- or JSON-encoding -- the other 2,100
        /// entries. Reads in one transaction for the same reason `get_entries` does.
        pub async fn read_entries_at(
            &self,
            paths: &[PathBuf],
        ) -> Result<(Oid, Vec<ListEntry>)> {
            let mut txn = self.cache_db.begin().await?;
            let cache_commit_id = sqlx::query_scalar::<_, String>(
                    "SELECT value FROM cache_state WHERE key = 'commit_id';",
                )
                .fetch_optional(&mut *txn)
                .await?
                .and_then(|value| Oid::from_str(&value).ok())
                .unwrap_or_else(Oid::zero);

            let mut entries = Vec::with_capacity(paths.len());
            for path in paths {
                let entry = sqlx::query("SELECT * FROM entry WHERE path = ?;")
                    .bind(path.to_str())
                    .map(row_to_list_entry)
                    .fetch_optional(&mut *txn)
                    .await?;
                // A path can be absent when the cache is behind the commit the delta was computed
                // against; the client simply does not learn about it this round.
                if let Some(entry) = entry {
                    entries.push(entry);
                }
            }
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
