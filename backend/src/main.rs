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
use sha1::{Digest, Sha1};
use sqlx::sqlite::{
    SqliteConnectOptions,
    SqlitePoolOptions,
    SqliteTransaction,
};
use tempfile::tempdir;
use tokio::process::Command;
use tower::ServiceBuilder;
use tower_http::{
    cors::CorsLayer,
    sensitive_headers::SetSensitiveHeadersLayer,
    trace::TraceLayer,
};
use tracing::debug;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use models::*;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    dotenv().ok();

    // Cache database
    let options = SqliteConnectOptions::from_str("sqlite://cache.sqlite")?
        .create_if_missing(true)
        .busy_timeout(std::time::Duration::from_secs(5 * 60));
    let db_pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;
    sqlx::query("
            CREATE TABLE IF NOT EXISTS cache_state (
                key    TEXT PRIMARY KEY,
                value  ANY
            ) STRICT, WITHOUT ROWID;
        ")
        .execute(&db_pool)
        .await?;
    sqlx::query("
            CREATE TABLE IF NOT EXISTS entry (
                path       TEXT PRIMARY KEY,
                size       INTEGER NOT NULL,
                mime_type  TEXT NOT NULL,
                metadata   TEXT,
                title      TEXT,
                time       INTEGER,
                tz_offset  INTEGER
            ) STRICT;
        ")
        .execute(&db_pool)
        .await?;

    let repo = {
        let git_dir = env::var("MORIED_GIT_DIR").unwrap();
        match Repository::open(git_dir) {
            Ok(repo) => repo,
            Err(e) => panic!("failed to open: {}", e),
        }
    };
    let state = models::AppState {
        repo: Arc::new(Mutex::new(repo)),
        cache_db: db_pool,
    };

    let addr = env::var("MORIED_LISTEN").unwrap();
    debug!("{:?}", addr);

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
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
            debug!("authorized");
            true
        },
        Err(e) => {
            debug!("failed to decode token: {:?}", e);
            false
        },
    }
}

async fn post_login(
    Json(login): Json<Login>,
) -> Response {
    debug!("post_login");
    let user_name = env::var("MORIED_USER_NAME").unwrap();
    let user_email = env::var("MORIED_USER_EMAIL").unwrap();
    let user_hash = env::var("MORIED_USER_HASH").unwrap();
    let matches = user_name == login.user && argon2::verify_encoded(&user_hash, login.password.as_ref()).unwrap();

    if matches {
        let secret = env::var("MORIED_SECRET").unwrap();
        let duration = env::var("MORIED_SESSION_DURATION").map_or(Duration::hours(6), |v| {
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

enum FileOp {
    AddedOrModified(git2::Time, Oid),
    Deleted,
}

fn collect_recent_file_ops(
    repo: &Repository,
    last_commit_id: Oid,
) -> HashMap<PathBuf, FileOp> {
    use git2::Delta;

    // Iterate over commit history after `last_commit_id` to collect recent file operations
    let mut recent_ops: HashMap<PathBuf, FileOp> = HashMap::new();
    let mut revwalk = repo.revwalk().unwrap();
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL).unwrap();
    revwalk.push_range(&format!("{}..HEAD", last_commit_id)).unwrap();
    for oid in revwalk {
        let oid = oid.unwrap();
        let commit = repo.find_commit(oid).unwrap();
        debug!("{:?}", commit);

        let tree = commit.tree().unwrap();
        for parent in commit.parents() {
            let parent_tree = parent.tree().unwrap();
            let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&tree), None).unwrap();
            for delta in diff.deltas() {
                match delta.status() {
                    Delta::Added | Delta::Modified | Delta::Copied => {
                        let file = delta.new_file();
                        let path = file.path().unwrap().to_owned();
                        recent_ops.entry(path).or_insert(FileOp::AddedOrModified(
                            commit.time(),
                            file.id(),
                        ));
                    },
                    Delta::Renamed => {
                        let file = delta.new_file();
                        let path = file.path().unwrap().to_owned();
                        recent_ops.entry(path).or_insert(FileOp::AddedOrModified(
                            commit.time(),
                            file.id(),
                        ));
                        let file = delta.old_file();
                        let path = file.path().unwrap().to_owned();
                        recent_ops.entry(path).or_insert(FileOp::Deleted);
                    },
                    Delta::Deleted => {
                        let file = delta.old_file();
                        let path = file.path().unwrap().to_owned();
                        recent_ops.entry(path).or_insert(FileOp::Deleted);
                    },
                    _ => (),
                }
            }
        }
    }

    recent_ops
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

async fn rebuild_entries_cache<'c>(
    tx: &mut SqliteTransaction<'c>,
    repo: Arc<Mutex<Repository>>,
    commit_id: Oid,
) -> Result<()> {
    // Collect minimum necessary information for each file path
    let path_info_list: Vec<(PathBuf, git2::Time, Oid)> = {
        let repo = repo.lock().unwrap();
        // Find the commit and its tree
        let commit = repo.find_commit(commit_id).unwrap();
        let tree = commit.tree().unwrap();
        // Load the tree into an index
        let mut index = Index::new().unwrap();
        index.read_tree(&tree).unwrap();
        // Populate the target file set
        let mut files: HashSet<PathBuf> = index.iter()
            .map(|entry| PathBuf::from(OsStr::from_bytes(&entry.path)))
            .collect();
        // Iterate over commit history until last modified times of all the files are determined
        let mut path_info_list: Vec<(PathBuf, git2::Time, Oid)> = Vec::with_capacity(files.len());
        let mut revwalk = repo.revwalk()?;
        revwalk.set_sorting(git2::Sort::TOPOLOGICAL)?;
        revwalk.push(commit_id)?;
        'revwalk: for oid in revwalk {
            let oid = oid?;
            let commit = repo.find_commit(oid)?;
            let tree = commit.tree()?;
            debug!("{:?}", commit);

            for parent in commit.parents() {
                // FIXME: We assume there were no conflict in the case of multiple parents
                let parent_tree = parent.tree()?;
                let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&tree), None)?;
                for delta in diff.deltas() {
                    use git2::Delta;
                    match delta.status() {
                        Delta::Added | Delta::Modified | Delta::Renamed | Delta::Copied => {
                            let file = delta.new_file();
                            let path = file.path().unwrap().to_owned();
                            // If this is the most recent commit that touches the file
                            if files.remove(&path) {
                                // Add an entry
                                path_info_list.push((path, commit.time(), file.id()));
                                // Finish if all the files have been processed
                                if files.is_empty() {
                                    break 'revwalk;
                                }
                            }
                        },
                        _ => (),
                    }
                }
            }
        }
        path_info_list
    };

    // Drop the current cache
    sqlx::query("DELETE FROM entry;")
        .execute(&mut **tx)
        .await?;

    // Insert entries
    for (path, time, blob_id) in path_info_list {
        // Guess the mime type
        let mime_type = guess_mime_from_path(&path);
        // Get the file size and extract metadata
        let (size, metadata, title) = {
            let repo = repo.lock().unwrap();
            let blob = repo.find_blob(blob_id)?;
            let size = blob.size();
            let (metadata, title) = extract_metadata(blob.content());
            (size, metadata, title)
        };
        // Insert the entry
        sqlx::query("INSERT INTO entry VALUES (?, ?, ?, ?, ?, ?, ?);")
            .bind(path.to_str())
            .bind(size as i64)
            .bind(mime_type)
            .bind(serde_json::to_string(&metadata).unwrap())
            .bind(title)
            .bind(time.seconds())
            .bind(time.offset_minutes() * 60)
            .execute(&mut **tx)
            .await?;
    }

    // Record the commit ID
    sqlx::query("INSERT INTO cache_state VALUES ('commit_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;")
        .bind(commit_id.to_string())
        .execute(&mut **tx)
        .await?;

    Ok(())
}

fn is_ancestor(
    repo: &Repository,
    ancestor: Oid,
    descendant: Oid,
) -> Result<bool> {
    let mut revwalk = repo.revwalk()?;
    revwalk.push(descendant)?;
    for oid_result in revwalk {
        let oid = oid_result?;
        if oid == ancestor {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn update_entries_cache<'c>(
    tx: &mut SqliteTransaction<'c>,
    repo: Arc<Mutex<Repository>>,
    last_commit_id: Oid,
) -> Result<()> {
    // Iterate over recent commit history to collect operations on files
    let recent_ops = collect_recent_file_ops(&*repo.lock().unwrap(), last_commit_id);

    // Update existing entries in the cache
    for (path, op) in recent_ops {
        match op {
            FileOp::AddedOrModified(time, blob_id) => {
                // Guess the mime type
                let mime_type = guess_mime_from_path(&path);
                // Get the file size and extract metadata
                let (size, metadata, title) = {
                    let repo = repo.lock().unwrap();
                    let blob = repo.find_blob(blob_id).unwrap();
                    let size = blob.size();
                    let (metadata, title) = extract_metadata(blob.content());
                    (size, metadata, title)
                };
                // Upsert the entry
                sqlx::query("
                        INSERT INTO entry
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(path) DO UPDATE SET
                                size = excluded.size,
                                mime_type = excluded.mime_type,
                                metadata = excluded.metadata,
                                title = excluded.title,
                                time = excluded.time,
                                tz_offset = excluded.tz_offset;
                    ")
                    .bind(path.to_str())
                    .bind(size as i64)
                    .bind(mime_type)
                    .bind(serde_json::to_string(&metadata).unwrap())
                    .bind(title)
                    .bind(time.seconds())
                    .bind(time.offset_minutes() * 60)
                    .execute(&mut **tx)
                    .await?;
            },
            FileOp::Deleted => {
                // Delete the entry
                sqlx::query("DELETE FROM entry WHERE path = ?;")
                    .bind(path.to_str())
                    .execute(&mut **tx)
                    .await?;
            },
        }
    }

    // Update the commit ID
    let head_commit_id = repo.lock().unwrap().head()?.peel_to_commit()?.id();
    sqlx::query("INSERT INTO cache_state VALUES ('commit_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;")
        .bind(head_commit_id.to_string())
        .execute(&mut **tx)
        .await?;

    Ok(())
}

async fn get_notes(
    extract::State(state): extract::State<AppState>,
) -> Json<Vec<ListEntry>> {
    debug!("get_notes");
    Json(state.get_entries(None).await.unwrap())
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
    debug!("get_notes_path");

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
    debug!("put_notes_path");
    debug!("{:?}", note_save);

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
    debug!("delete_notes_path");

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
    debug!("get_files_path");

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
    debug!("post_files_path");

    // Create a blob for each part (file) in the form data
    let mut files = Vec::new();
    let mut result = Vec::new();
    while let Some(field) = multipart.next_field().await.unwrap() {
        debug!("{:?}", field);

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

fn extract_metadata(blob: &[u8]) -> (Option<serde_yaml::Value>, Option<String>) {
    if let Ok(text) = std::str::from_utf8(blob) {
        let mut opts = markdown::ParseOptions::gfm();
        opts.constructs.frontmatter = true;
        if let Ok(node) = markdown::to_mdast(text, &opts) {
            let metadata = if let Some(markdown::mdast::Node::Yaml(yaml_node)) = get_frontmatter_node(&node) {
                match serde_yaml::from_str::<serde_yaml::Value>(&yaml_node.value) {
                    Ok(doc) => {
                        debug!("parsed YAML metadata: {:?}", &doc);
                        Some(doc)
                    },
                    Err(err) => {
                        debug!("failed to parse YAML metadata: {:?}", &err);
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
        debug!("v2::get_files_path");
        make_files_path_response(path, state, headers).await
    }

    pub async fn head_files_path(
        extract::Path(path): extract::Path<String>,
        extract::State(state): extract::State<AppState>,
        headers: HeaderMap,
    ) -> Response {
        debug!("v2::head_files_path");
        head_from_full(make_files_path_response(path, state, headers).await)
    }
}

mod models {
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::option::Option;

    use anyhow::Result;
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

    #[derive(Debug, Serialize, Deserialize)]
    pub struct Claims {
        pub sub: String,
        pub exp: usize,
        pub email: String,
    }

    pub struct AppError(anyhow::Error);

    impl IntoResponse for AppError {
        fn into_response(self) -> Response {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Something went wrong: {}", self.0),
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
    }

    impl AppState {
        pub async fn get_entries(&self, pattern_opt: Option<&str>) -> Result<Vec<ListEntry>> {
            // Rebuild the cache if it is stale
            self.ensure_file_entries_cache_updated().await?;

            // Return the entries from the cache
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

            Ok(entries)
        }

        async fn ensure_file_entries_cache_updated(
            &self,
        ) -> Result<()> {
            let head_commit_id = self.repo.lock().unwrap().head()?.peel_to_commit()?.id();

            // Start an exclusive transaction
            let mut tx = self.cache_db.begin_with("BEGIN EXCLUSIVE").await?;

            let cache_commit_id_opt = sqlx::query(
                    "SELECT value FROM cache_state WHERE key = 'commit_id';",
                )
                .map(|row: SqliteRow| {
                    Oid::from_str(row.get("value")).unwrap()
                })
                .fetch_optional(&mut *tx)
                .await?;

            match cache_commit_id_opt {
                Some(cache_commit_id) if cache_commit_id == head_commit_id => {
                    // No update is needed
                    ()
                },
                Some(cache_commit_id) if super::is_ancestor(&*self.repo.lock().unwrap(), cache_commit_id, head_commit_id)? => {
                    // Perform delta update
                    super::update_entries_cache(&mut tx, self.repo.clone(), cache_commit_id).await?;
                },
                _ => {
                    // Rebuild from scratch
                    super::rebuild_entries_cache(&mut tx, self.repo.clone(), head_commit_id).await?;
                },
            }

            // End the transaction
            tx.commit().await?;

            Ok(())
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
