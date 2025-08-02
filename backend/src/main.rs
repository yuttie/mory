use std::collections::HashMap;
use std::env;
use std::ffi::OsStr;
use std::fs::File;
use std::io::Write;
use std::iter::once;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::vec::Vec;
use std::string::String;
use std::sync::Arc;
use std::time;

use anyhow::Context;
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
use chrono::{DateTime, Duration, Utc, FixedOffset};
use chrono::offset::TimeZone;
use dotenv::dotenv;
use git2::{Index, IndexEntry, IndexTime, Repository, Oid};
use jsonwebtoken as jwt;
use mime_guess;
use sha1::{Digest, Sha1};
use tempfile::tempdir;
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, process::Command};
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

    let repo = {
        let git_dir = env::var("MORIED_GIT_DIR").unwrap();
        match Repository::open(git_dir) {
            Ok(repo) => repo,
            Err(e) => panic!("failed to open: {}", e),
        }
    };
    let state = Arc::new(models::AppState::new(repo));

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

fn collect_latest_ops(
    repo: &Repository,
    last_commit_id: Oid,
) -> HashMap<PathBuf, (git2::Delta, DateTime<FixedOffset>, Oid)> {
    use git2::Delta;

    // Iterate over recent commit history to collect operations on files
    let mut latest_ops: HashMap<PathBuf, (Delta, DateTime<FixedOffset>, Oid)> = HashMap::new();
    let mut revwalk = repo.revwalk().unwrap();
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL).unwrap();
    revwalk.push_range(&format!("{}..HEAD", last_commit_id)).unwrap();
    for oid in revwalk {
        let oid = oid.unwrap();
        let commit = repo.find_commit(oid).unwrap();
        debug!("{:?}", commit);

        let time = {
            let t = commit.time();
            let tz = FixedOffset::east_opt(t.offset_minutes() * 60).unwrap();
            tz.timestamp_opt(t.seconds(), 0).unwrap()
        };

        let tree = commit.tree().unwrap();
        for parent in commit.parents() {
            let parent_tree = parent.tree().unwrap();
            let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&tree), None).unwrap();
            for delta in diff.deltas() {
                match delta.status() {
                    Delta::Added | Delta::Modified => {
                        let file = delta.new_file();
                        let path = file.path().unwrap().to_owned();
                        latest_ops.entry(path).or_insert((
                            delta.status(),
                            time,
                            file.id(),
                        ));
                    },
                    Delta::Deleted => {
                        let file = delta.old_file();
                        let path = file.path().unwrap().to_owned();
                        latest_ops.entry(path).or_insert((
                            delta.status(),
                            time,
                            file.id(),
                        ));
                    },
                    _ => (),
                }
            }
        }
    }

    latest_ops
}

fn create_entry_from_diff_file(
    file: &git2::DiffFile,
    commit: &git2::Commit,
    repo: &Repository,
) -> ListEntry {
    // Path
    let path = file.path().unwrap().to_owned();
    // Guess the mime type
    let guess = mime_guess::from_path(&path);
    let mime_type = if let Some(mime) = guess.first() {
        mime.as_ref().parse().unwrap()
    }
    else {
        "application/octet-stream".to_string()
    };
    // Get the file size
    let blob = repo.find_blob(file.id()).unwrap();
    let size = blob.size();
    // Extract metadata
    let (metadata, title) = extract_metadata(blob.content());
    // Time
    let t = commit.time();
    let tz = FixedOffset::east_opt(t.offset_minutes() * 60).unwrap();
    let time = tz.timestamp_opt(t.seconds(), 0).unwrap();
    // Return a new ListEntry
    ListEntry {
        path: path,
        size: size,
        mime_type: mime_type,
        metadata: metadata,
        title: title,
        time: time,
    }
}

fn update_entries(
    entries: &[ListEntry],
    repo: &Repository,
    last_commit_id: Oid,
) -> Vec<ListEntry> {
    use git2::Delta;

    // Iterate over recent commit history to collect operations on files
    let mut latest_ops = collect_latest_ops(repo, last_commit_id);

    // Update existing entries
    let mut new_entries: Vec<ListEntry> = Vec::with_capacity(entries.len());
    for entry in entries {
        let mut found = false;
        match latest_ops.get(&entry.path) {
            None => {
                // Entry is untouched
                new_entries.push(entry.clone());
            },
            Some(&(op, time, blob_id)) => {
                // Entry is modified or deleted
                found = true;
                match op {
                    Delta::Added | Delta::Modified => {
                        // Get the file size
                        let blob = repo.find_blob(blob_id).unwrap();
                        let size = blob.size();
                        // Extract metadata
                        let (metadata, title) = extract_metadata(blob.content());
                        // Add an entry
                        new_entries.push(ListEntry {
                            path: entry.path.to_owned(),
                            size: size,
                            mime_type: entry.mime_type.to_owned(),
                            metadata: metadata,
                            title: title,
                            time: time,
                        });
                    },
                    Delta::Deleted => {
                        // Ignore the entry
                    },
                    _ => unreachable!(),
                }
            },
        }
        if found {
            latest_ops.remove(&entry.path);
        }
    }

    // Add newly created entries
    for (path, (op, time, blob_id)) in latest_ops {
        match op {
            Delta::Added | Delta::Modified => {
                // Guess the mime type
                let guess = mime_guess::from_path(&path);
                let mime_type = if let Some(mime) = guess.first() {
                    mime.as_ref().parse().unwrap()
                }
                else {
                    "application/octet-stream".to_string()
                };
                // Get the file size
                let blob = repo.find_blob(blob_id).unwrap();
                let size = blob.size();
                // Extract metadata
                let (metadata, title) = extract_metadata(blob.content());
                // Add an entry
                new_entries.push(ListEntry {
                    path: path,
                    size: size,
                    mime_type: mime_type,
                    metadata: metadata,
                    title: title,
                    time: time,
                });
            },
            Delta::Deleted => {
                // Ignore the entry
            },
            _ => unreachable!(),
        }
    }

    new_entries
}

async fn get_notes(
    extract::State(state): extract::State<Arc<AppState>>,
) -> Json<Vec<ListEntry>> {
    debug!("get_notes");

    // Check if a cache exists
    let repo = state.repo.lock().await;
    let mut cached_entries = state.cached_entries.lock().await;
    match cached_entries.get(&repo) {
        Cache::Valid(entries) => {
            // Return the cache
            Json(entries.clone())
        },
        Cache::Invalid(last_commit_id, old_entries) => {
            // Update entries
            let entries: Vec<ListEntry> = update_entries(old_entries, &repo, last_commit_id);

            // Find the head commit
            let head = repo.head().unwrap();
            let head_commit = head.peel_to_commit().unwrap();

            // Save to a cache file
            let mut cache_file = File::create("cache.msgpack").unwrap();
            rmp_serde::encode::write(&mut cache_file, &models::EntriesCache {
                commit_id: head_commit.id().to_string(),
                entries: entries.clone(),
            }).unwrap();

            // Reply
            let reply = Json(entries.clone());
            *cached_entries = Cached::Computed {
                commit_id: head_commit.id(),
                data: entries,
            };
            reply
        },
        Cache::None => {
            // Create a new list

            // Find the head commit and tree
            let head = repo.head().unwrap();
            let head_commit = head.peel_to_commit().unwrap();
            let head_tree = head.peel_to_tree().unwrap();

            // Load the head tree into an index
            let mut index = Index::new().unwrap();
            index.read_tree(&head_tree).unwrap();

            // Populate the list
            let mut oid_path_map: HashMap<Oid, PathBuf> = HashMap::new();
            for entry in index.iter() {
                let path = PathBuf::from(OsStr::from_bytes(&entry.path));
                oid_path_map.insert(entry.id, path);
            }

            // Iterate over commit history until last modified times of all the files are determined
            let mut entries = Vec::new();
            let mut revwalk = repo.revwalk().unwrap();
            revwalk.set_sorting(git2::Sort::TOPOLOGICAL).unwrap();
            revwalk.push_head().unwrap();
            'revwalk: for oid in revwalk {
                let oid = oid.unwrap();
                let commit = repo.find_commit(oid).unwrap();
                let tree = commit.tree().unwrap();
                debug!("{:?}", commit);

                for parent in commit.parents() {
                    // FIXME: We assume there were no conflict in the case of multiple parents
                    let parent_tree = parent.tree().unwrap();
                    let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&tree), None).unwrap();
                    for delta in diff.deltas() {
                        use git2::Delta;
                        match delta.status() {
                            Delta::Added | Delta::Modified => {
                                let file = delta.new_file();
                                if let Some(path) = oid_path_map.get(&file.id()) {
                                    if path == file.path().unwrap() {
                                        // Add an entry
                                        let entry = create_entry_from_diff_file(&file, &commit, &repo);
                                        debug!("{:?} {:?} {:?}", entry.time, delta.status(), entry.path);
                                        entries.push(entry);
                                        // Remove the entry from oid_path_map
                                        oid_path_map.remove(&file.id());
                                        // Finish if all of the entries have been processed
                                        if oid_path_map.is_empty() {
                                            break 'revwalk;
                                        }
                                    }
                                }
                            },
                            _ => (),
                        }
                    }
                }
            }

            // Save to a cache file
            let mut cache_file = File::create("cache.msgpack").unwrap();
            rmp_serde::encode::write(&mut cache_file, &models::EntriesCache {
                commit_id: head_commit.id().to_string(),
                entries: entries.clone(),
            }).unwrap();

            // Reply
            let reply = Json(entries.clone());
            *cached_entries = Cached::Computed {
                commit_id: head_commit.id(),
                data: entries,
            };
            reply
        },
    }
}

async fn find_entry_blob(
    state: &Arc<AppState>,
    path: &str,
) -> Option<(Oid, Vec<u8>)> {
    // Search an index of HEAD for the given path
    let (oid, entry) = {
        let repo = state.repo.lock().await;

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
        let repo = state.repo.lock().await;
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
    extract::State(state): extract::State<Arc<AppState>>,
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
    extract::State(state): extract::State<Arc<AppState>>,
    Json(note_save): Json<NoteSave>,
) -> Response {
    debug!("put_notes_path");
    debug!("{:?}", note_save);

    match note_save {
        NoteSave::Save { content, message } => {
            let repo = state.repo.lock().await;

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
                let repo = state.repo.lock().await;

                let head = repo.head().unwrap();
                let head_tree = head.peel_to_tree().unwrap();

                let mut index = Index::new().unwrap();
                index.read_tree(&head_tree).unwrap();

                index.iter().find(|entry| std::str::from_utf8(&entry.path).unwrap() == from)
            };
            if let Some(mut entry) = found {
                let repo = state.repo.lock().await;

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
    extract::State(state): extract::State<Arc<AppState>>,
) -> Response {
    debug!("delete_notes_path");

    let found = {
        let repo = state.repo.lock().await;

        let head = repo.head().unwrap();
        let head_tree = head.peel_to_tree().unwrap();

        let mut index = Index::new().unwrap();
        index.read_tree(&head_tree).unwrap();

        index.iter().find(|entry| std::str::from_utf8(&entry.path).unwrap() == path)
    };
    if let Some(entry) = found {
        let repo = state.repo.lock().await;

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
    extract::State(state): extract::State<Arc<AppState>>,
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
    extract::State(state): extract::State<Arc<AppState>>,
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

            let repo = state.repo.lock().await;
            let mut writer = repo.blob_writer(None).unwrap();
            writer.write_all(&data).unwrap();
            writer.commit().unwrap()
        };

        files.push((filename, blob_oid));
        result.push((uuid, "success"));
    }

    // Commit
    let repo = state.repo.lock().await;

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
        extract::State(state): extract::State<Arc<AppState>>,
    ) -> Result<Json<String>, AppError> {
        let repo = state.repo.lock().await;
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
        state: Arc<AppState>,
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

    fn head_from_full(mut full: Response) -> Response {
        let mut head = Response::builder()
            .status(full.status())
            .body(Body::empty())
            .unwrap();
        *head.headers_mut() = full.headers().clone();
        head
    }

    pub async fn get_files_path(
        extract::Path(path): extract::Path<String>,
        extract::State(state): extract::State<Arc<AppState>>,
        headers: HeaderMap,
    ) -> Response {
        debug!("v2::get_files_path");
        make_files_path_response(path, state, headers).await
    }

    pub async fn head_files_path(
        extract::Path(path): extract::Path<String>,
        extract::State(state): extract::State<Arc<AppState>>,
        headers: HeaderMap,
    ) -> Response {
        debug!("v2::head_files_path");
        head_from_full(make_files_path_response(path, state, headers).await)
    }
}

mod models {
    use std::fs::File;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::option::Option;

    use axum::{
        http::StatusCode,
        response::{IntoResponse, Response},
    };
    use chrono::{DateTime, FixedOffset};
    use git2::{Repository, Oid};
    use serde::{Deserialize, Serialize};
    use tokio::sync::Mutex;

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

    pub enum Cache<'a, T> {
        Valid(&'a T),
        Invalid(Oid, &'a T),
        None,
    }

    pub enum Cached<T> {
        Computed {
            commit_id: Oid,
            data: T,
        },
        None,
    }

    impl<T> Cached<T> {
        pub fn get(&self, repo: &Repository) -> Cache<T> {
            match self {
                Cached::None => Cache::None,
                Cached::Computed { commit_id, data } => {
                    let head = repo.head().unwrap();
                    let commit = head.peel_to_commit().expect("Failed to obtain the commit of HEAD");
                    if *commit_id == commit.id() {
                        Cache::Valid(data)
                    }
                    else {
                        Cache::Invalid(*commit_id, data)
                    }
                },
            }
        }
    }

    #[derive(Deserialize, Serialize)]
    pub struct EntriesCache {
        pub commit_id: String,
        pub entries: Vec<ListEntry>,
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

    #[derive(Clone)]
    pub struct AppState {
        pub repo: Arc<Mutex<Repository>>,
        pub cached_entries: Arc<Mutex<Cached<Vec<ListEntry>>>>,
    }

    impl AppState {
        pub fn new(repo: Repository) -> AppState {
            let cache = match File::open("cache.msgpack") {
                Ok(file) => {
                    if let Ok(cache) = rmp_serde::from_read::<_, EntriesCache>(file) {
                        Cached::Computed {
                            commit_id: Oid::from_str(&cache.commit_id).unwrap(),
                            data: cache.entries,
                        }
                    }
                    else {
                        Cached::None
                    }
                },
                Err(_) => {
                    Cached::None
                },
            };
            AppState {
                repo: Arc::new(Mutex::new(repo)),
                cached_entries: Arc::new(Mutex::new(cache)),
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
