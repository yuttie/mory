use std::collections::HashMap;
use std::env;
use std::ffi::OsStr;
use std::io::Write;
use std::net::ToSocketAddrs;
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;
use std::vec::Vec;
use std::string::String;
use std::sync::Arc;

use argon2;
use axum::{
    extract::{
        ContentLengthLimit,
        Extension,
        FromRequest,
        Multipart,
        Path,
        RequestParts,
    },
    http::{
        header,
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
use axum_macros::debug_handler;
use bytes::buf::Buf;
use chrono::{DateTime, Duration, Utc, FixedOffset};
use chrono::offset::TimeZone;
use dotenv::dotenv;
use futures::stream::StreamExt;
use git2::{Index, IndexEntry, IndexTime, Repository, Oid};
use jsonwebtoken as jwt;
use log::{debug, error};
use mime_guess;
use tower::ServiceBuilder;
use tower_http::{
    compression::CompressionLayer,
    cors::{self, CorsLayer},
};

use models::*;

#[tokio::main]
async fn main() {
    pretty_env_logger::init();

    dotenv().ok();

    let repo = {
        let git_dir = env::var("MORIED_GIT_DIR").unwrap();
        match Repository::open(git_dir) {
            Ok(repo) => repo,
            Err(e) => panic!("failed to open: {}", e),
        }
    };
    let state = Arc::new(models::State::new(repo));

    let addr = {
        let mut addrs_iter = env::var("MORIED_LISTEN").unwrap().to_socket_addrs().unwrap();
        addrs_iter.next().unwrap()
    };
    debug!("{:?}", addr);

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .allow_origin(cors::Any)
        .allow_credentials(true);

    let api = Router::new()
        .route("/notes", get(get_notes))
        .route("/notes/*path", get(get_notes_path).put(put_notes_path).delete(delete_notes_path))
        .route("/files", post(post_files))
        .route("/files/*path", get(get_files_path))
        .layer(Extension(state))
        .route_layer(middleware::from_fn(auth))
        .route("/login", post(post_login))
        .layer(
            ServiceBuilder::new()
                .layer(CompressionLayer::new())
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

    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

async fn auth<B>(req: Request<B>, next: Next<B>) -> Result<Response, StatusCode> {
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
    debug!("received token: {}", token);

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
        println!("{:?}", duration);
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
    Extension(state): Extension<Arc<State>>,
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
                    let tz = FixedOffset::east(t.offset_minutes() * 60);
                    tz.timestamp(t.seconds(), 0)
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
                                let metadata = extract_metadata(blob.content());
                                // Add an entry
                                entries.push(ListEntry {
                                    path: entry.path.to_owned(),
                                    size: size,
                                    mime_type: entry.mime_type.to_owned(),
                                    metadata: metadata,
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
                        let metadata = extract_metadata(blob.content());
                        // Add an entry
                        entries.push(ListEntry {
                            path: path,
                            size: size,
                            mime_type: mime_type,
                            metadata: metadata,
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
                                    let metadata = extract_metadata(blob.content());
                                    // Time
                                    let t = commit.time();
                                    let tz = FixedOffset::east(t.offset_minutes() * 60);
                                    let time = tz.timestamp(t.seconds(), 0);
                                    // Add an entry
                                    debug!("{:?} {:?} {:?}", time, delta.status(), path);
                                    entries.push(ListEntry {
                                        path: path,
                                        size: size,
                                        mime_type: mime_type,
                                        metadata: metadata,
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
    Extension(state): Extension<Arc<State>>,
) -> Response {
    debug!("get_notes_path");

    // Remove leading '/'
    let path = &path[1..];

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
    Json(note_save): Json<NoteSave>,
    Extension(state): Extension<Arc<State>>,
) -> Response {
    debug!("put_notes_path");
    debug!("{:?}", note_save);

    // Remove leading '/'
    let path = &path[1..];

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
    Extension(state): Extension<Arc<State>>,
) -> Response {
    debug!("delete_notes_path");

    // Remove leading '/'
    let path = &path[1..];

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
    Extension(state): Extension<Arc<State>>,
) -> Response {
    debug!("get_files_path");

    // Remove leading '/'
    let path = &path[1..];

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
            Err(_) => StatusCode::NOT_FOUND.into_response()
        }
    }
    else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn post_files(
    ContentLengthLimit(mut multipart): ContentLengthLimit<Multipart, { 8 * 1024 * 1024 }>,
    Extension(state): Extension<Arc<State>>,
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

fn extract_metadata(content: &[u8]) -> Option<serde_yaml::Value> {
    if content.starts_with(b"---\n") {
        if let Some(j) = content.windows(5).position(|window| window == b"\n---\n") {
            if let Ok(yaml) = std::str::from_utf8(&content[4..j]) {
                match serde_yaml::from_str::<serde_yaml::Value>(yaml) {
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
            }
        }
        else {
            None
        }
    }
    else {
        None
    }
}

mod models {
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

    #[derive(Clone)]
    pub struct State {
        pub repo: Arc<Mutex<Repository>>,
        pub cached_entries: Arc<Mutex<Cached<Vec<ListEntry>>>>,
    }

    impl State {
        pub fn new(repo: Repository) -> State {
            State {
                repo: Arc::new(Mutex::new(repo)),
                cached_entries: Arc::new(Mutex::new(Cached::None)),
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
