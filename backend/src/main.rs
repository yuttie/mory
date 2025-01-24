use std::collections::HashMap;
use std::env;
use std::ffi::OsStr;
use std::fs::File;
use std::io::Write;
use std::iter::once;
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;
use std::process::Stdio;
use std::vec::Vec;
use std::string::String;
use std::sync::Arc;
use std::time;

use argon2;
use axum::{
    BoxError,
    body::Body,
    error_handling::HandleErrorLayer,
    extract::{
        DefaultBodyLimit,
        Multipart,
        Path,
        State,
    },
    http::{
        header,
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
async fn main() {
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
        .route("/notes", get(get_notes))
        .route("/notes/*path", get(get_notes_path).put(put_notes_path).delete(delete_notes_path))
        .route("/files", post(post_files).layer(DefaultBodyLimit::max(16 * 1024 * 1024)))
        .route("/files/*path", get(get_files_path))
        .with_state(state)
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
    let api = Router::new()
        .merge(protected_api)
        .merge(login_api)
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

async fn get_notes(
    State(state): State<Arc<AppState>>,
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

            // Update existing entries
            let mut entries: Vec<ListEntry> = Vec::with_capacity(old_entries.len());
            for entry in old_entries {
                let mut found = false;
                match latest_ops.get(&entry.path) {
                    None => {
                        // Entry is untouched
                        entries.push(entry.clone());
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
                                entries.push(ListEntry {
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
                        entries.push(ListEntry {
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

            // Iterate over commit history to find out last modified time for each file
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
                    let parent_tree = parent.tree().unwrap();
                    let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&tree), None).unwrap();
                    for delta in diff.deltas() {
                        use git2::Delta;
                        match delta.status() {
                            Delta::Added | Delta::Modified => {
                                let file = delta.new_file();
                                let found = {
                                    if let Some(path) = oid_path_map.get(&file.id()) {
                                        path == file.path().unwrap()
                                    }
                                    else {
                                        false
                                    }
                                };
                                if found {
                                    // Remove the entry from oid_path_map
                                    let path = oid_path_map.remove(&file.id()).unwrap();
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
                                    // Add an entry
                                    debug!("{:?} {:?} {:?}", time, delta.status(), path);
                                    entries.push(ListEntry {
                                        path: path,
                                        size: size,
                                        mime_type: mime_type,
                                        metadata: metadata,
                                        title: title,
                                        time: time,
                                    });
                                    // Finish if all of the entries have been processed
                                    if oid_path_map.is_empty() {
                                        break 'revwalk;
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

async fn get_notes_path(
    Path(path): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Response {
    debug!("get_notes_path");

    // Find a file at the given path
    let found = {
        let repo = state.repo.lock().await;

        let head = repo.head().unwrap();
        let head_tree = head.peel_to_tree().unwrap();

        let mut index = Index::new().unwrap();
        index.read_tree(&head_tree).unwrap();

        index.iter().find(|entry| std::str::from_utf8(&entry.path).unwrap() == path)
    };
    if let Some(entry) = found {
        let found = {
            let repo = state.repo.lock().await;
            repo.find_blob(entry.id).map(|blob| Vec::from(blob.content()))
        };
        match found {
            Ok(content) => {
                let mut res = content.into_response();
                // Guess the mime type
                let guess = mime_guess::from_path(std::str::from_utf8(&entry.path).unwrap());
                if let Some(mime) = guess.first() {
                    res.headers_mut().insert(header::CONTENT_TYPE, mime.as_ref().parse().unwrap()).unwrap();
                }
                res
            },
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        }
    }
    else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn put_notes_path(
    Path(path): Path<String>,
    State(state): State<Arc<AppState>>,
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
    Path(path): Path<String>,
    State(state): State<Arc<AppState>>,
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

async fn get_files_path(
    Path(path): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Response {
    debug!("get_files_path");

    let found = {
        let repo = state.repo.lock().await;

        let head = repo.head().unwrap();
        let head_tree = head.peel_to_tree().unwrap();

        let mut index = Index::new().unwrap();
        index.read_tree(&head_tree).unwrap();

        index.iter().find(|entry| std::str::from_utf8(&entry.path).unwrap() == path)
    };
    if let Some(entry) = found {
        let found = {
            let repo = state.repo.lock().await;
            repo.find_blob(entry.id).map(|blob| Vec::from(blob.content()))
        };
        match found {
            Ok(content) => {
                // Guess the mime type
                let entry_path = PathBuf::from(std::str::from_utf8(&entry.path).unwrap());
                let guess = mime_guess::from_path(&entry_path);
                if let Some(mime) = guess.first() {
                    if mime.type_() == "image" {
                        let mut cache_path = PathBuf::from(env::var("MORIED_IMAGE_CACHE_DIR").unwrap());
                        {
                            let input_hash = Sha1::digest(&content);
                            let mut buf = [0u8; 40];
                            let input_hash_hex = base16ct::lower::encode_str(&input_hash, &mut buf).unwrap();
                            cache_path.push(input_hash_hex);
                        }
                        if cache_path.is_file() {
                            let mut buf = Vec::new();
                            let mut cache_file = tokio::fs::File::open(&cache_path).await.unwrap();
                            cache_file.read_to_end(&mut buf).await.unwrap();

                            let mut res = buf.into_response();
                            res.headers_mut().insert(header::CONTENT_TYPE, "image/webp".parse().unwrap()).unwrap();
                            res
                        }
                        else {
                            let tmp_dir = tempdir().unwrap();
                            let tmp_file_path = tmp_dir.path().join(entry_path.file_name().unwrap());
                            let mut tmp_file = tokio::fs::File::create(&tmp_file_path).await.unwrap();
                            tmp_file.write_all(&content).await.unwrap();
                            let mut child = Command::new("magick")
                                .arg(&tmp_file_path)
                                .arg("-quality")
                                .arg("1")
                                .arg("webp:-")
                                .stdout(Stdio::piped())
                                .spawn()
                                .unwrap();
                            let output = child.wait_with_output().await.unwrap();
                            if output.status.success() {
                                tokio::fs::create_dir_all(cache_path.parent().unwrap()).await.unwrap();
                                let mut cache_file = tokio::fs::File::create(&cache_path).await.unwrap();
                                cache_file.write_all(&output.stdout).await.unwrap();

                                let mut res = output.stdout.into_response();
                                res.headers_mut().insert(header::CONTENT_TYPE, "image/webp".parse().unwrap()).unwrap();
                                res
                            }
                            else {
                                let mut res = content.into_response();
                                res.headers_mut().insert(header::CONTENT_TYPE, mime.as_ref().parse().unwrap()).unwrap();
                                res
                            }
                        }
                    }
                    else {
                        let mut res = content.into_response();
                        res.headers_mut().insert(header::CONTENT_TYPE, mime.as_ref().parse().unwrap()).unwrap();
                        res
                    }
                }
                else {
                    content.into_response()
                }
            },
            Err(_) => StatusCode::NOT_FOUND.into_response()
        }
    }
    else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn post_files(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
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

mod models {
    use std::fs::File;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::option::Option;

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

    #[derive(Debug)]
    pub struct Unauthorized;

    #[derive(Debug)]
    pub struct NotFound;

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
}
