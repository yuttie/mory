use std::env;
use std::net::ToSocketAddrs;

use dotenv::dotenv;
use git2::Repository;
use warp::Filter;

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
    let state = models::State::new(repo);

    let api = {
        let root_path = env::var("MORIED_ROOT_PATH").unwrap();
        assert!(root_path.starts_with('/'), "MORIED_ROOT_PATH must start with '/'");
        assert!(root_path.ends_with('/'), "MORIED_ROOT_PATH must end with '/'");

        if root_path == "/" {
            filters::notes(None, state)
        }
        else {
            filters::notes(Some(root_path[1..root_path.len() - 1].to_owned()), state)
        }
    };

    let cors = warp::cors()
        .allow_any_origin()
        .allow_credentials(true)
        .allow_methods(vec!["GET", "POST", "PUT", "DELETE"])
        .allow_headers(vec!["Authorization", "Content-Type"]);

    let routes = api.with(cors).with(warp::compression::gzip());
    let addr = {
        let mut addrs_iter = env::var("MORIED_LISTEN").unwrap().to_socket_addrs().unwrap();
        addrs_iter.next().unwrap()
    };
    warp::serve(routes).run(addr).await;
}

mod filters {
    use super::handlers;
    use super::models;

    use warp::Filter;

    pub fn notes(
        root_path: Option<String>,
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        // APIs
        let closed = notes_list(state.clone())
            .or(notes_load(state.clone()))
            .or(notes_save(state.clone()))
            .or(notes_delete(state.clone()))
            .or(files_download(state.clone()))
            .or(files_upload(state));
        let open = notes_login();
        let api = auth().and(closed)
            .or(open);

        // Construct routes
        if let Some(root_path) = root_path {
            warp::path(root_path)
                .and(api)
                .recover(handlers::rejection)
                .boxed()
        }
        else {
            api
                .recover(handlers::rejection)
                .boxed()
        }
    }

    pub fn notes_login() -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::post()
            .and(warp::path("login"))
            .and(warp::path::end())
            .and(warp::body::json())
            .and_then(handlers::login)
    }

    pub fn notes_list(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::get()
            .and(warp::path("notes"))
            .and(warp::path::end())
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::list_notes)
    }

    pub fn notes_load(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::get()
            .and(warp::path("notes"))
            .and(warp::path::tail())
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::load_note)
    }

    pub fn notes_save(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::put()
            .and(warp::path("notes"))
            .and(warp::path::tail())
            .and(warp::body::json())
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::save_note)
    }

    pub fn notes_delete(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::delete()
            .and(warp::path("notes"))
            .and(warp::path::tail())
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::delete_note)
    }

    pub fn files_download(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::get()
            .and(warp::path("files"))
            .and(warp::path::tail())
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::download_file)
    }

    pub fn files_upload(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::post()
            .and(warp::path("files"))
            .and(warp::path::end())
            .and(warp::multipart::form().max_length(8 * 1024 * 1024))
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::upload_file)
    }

    pub fn auth() -> impl Filter<Extract = (), Error = warp::Rejection> + Copy {
        warp::header::<String>("Authorization")
            .and_then(handlers::auth)
            .untuple_one()
    }
}

mod handlers {
    use super::models::{Unauthorized, NotFound, Claims, State, ListEntry, Cache, Cached, Login, NoteSave};

    use std::env;
    use std::collections::HashMap;
    use std::convert::Infallible;
    use std::ffi::OsStr;
    use std::io::Write;
    use std::os::unix::ffi::OsStrExt;
    use std::path::PathBuf;
    use std::vec::Vec;
    use std::string::String;

    use argon2;
    use bytes::buf::Buf;
    use chrono::{DateTime, Duration, Utc, FixedOffset};
    use chrono::offset::TimeZone;
    use futures::stream::StreamExt;
    use git2::{Index, IndexEntry, IndexTime, Oid};
    use jsonwebtoken as jwt;
    use log::{debug, error};
    use warp::reply::Reply;
    use mime_guess;
    use warp::http::header::CONTENT_TYPE;

    pub async fn login(login: Login) -> Result<Box<dyn warp::Reply>, warp::reject::Rejection> {
        debug!("login");
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
            Ok(Box::new(token))
        }
        else {
            Err(warp::reject::custom(Unauthorized))
        }
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

    pub async fn list_notes(state: State) -> Result<impl warp::Reply, Infallible> {
        debug!("list");

        // Check if a cache exists
        let repo = state.repo.lock().await;
        let mut cached_entries = state.cached_entries.lock().await;
        match cached_entries.get(&repo) {
            Cache::Valid(entries) => {
                // Return the cache
                Ok(warp::reply::json(&entries))
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
                let reply = warp::reply::json(&entries);
                *cached_entries = Cached::Computed {
                    commit_id: head_commit.id(),
                    data: entries,
                };
                Ok(reply)
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
                let reply = warp::reply::json(&entries);
                *cached_entries = Cached::Computed {
                    commit_id: head_commit.id(),
                    data: entries,
                };
                Ok(reply)
            },
        }
    }

    pub async fn load_note(path: warp::path::Tail, state: State) -> Result<impl warp::Reply, warp::reject::Rejection> {
        debug!("load");
        let path = urlencoding::decode(path.as_str()).unwrap();
        let found = {
            let repo = state.repo.lock().await;

            let head = repo.head().unwrap();
            let head_tree = head.peel_to_tree().unwrap();

            let mut index = Index::new().unwrap();
            index.read_tree(&head_tree).unwrap();

            index.iter().find(|entry| std::str::from_utf8(&entry.path).unwrap() == path.as_str())
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
                        res.headers_mut().insert(CONTENT_TYPE, mime.as_ref().parse().unwrap()).unwrap();
                    }
                    Ok(res)
                },
                Err(_) => Err(warp::reject::custom(NotFound))
            }
        }
        else {
            Err(warp::reject::custom(NotFound))
        }
    }

    pub async fn save_note(path: warp::path::Tail, note_save: NoteSave, state: State) -> Result<impl warp::Reply, warp::reject::Rejection> {
        debug!("save");
        debug!("{:?}", note_save);
        let path = urlencoding::decode(path.as_str()).unwrap();
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
                    path: path.into_bytes(),
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
                Ok(warp::reply::json(&true))
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
                    entry.path = path.into_bytes();
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
                    Ok(warp::reply::json(&true))
                }
                else {
                    Err(warp::reject::custom(NotFound))
                }
            },
        }
    }

    pub async fn delete_note(path: warp::path::Tail, state: State) -> Result<impl warp::Reply, warp::reject::Rejection> {
        debug!("delete");
        let path = urlencoding::decode(path.as_str()).unwrap();
        let found = {
            let repo = state.repo.lock().await;

            let head = repo.head().unwrap();
            let head_tree = head.peel_to_tree().unwrap();

            let mut index = Index::new().unwrap();
            index.read_tree(&head_tree).unwrap();

            index.iter().find(|entry| std::str::from_utf8(&entry.path).unwrap() == path.as_str())
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
            Ok(warp::reply::json(&true))
        }
        else {
            Err(warp::reject::custom(NotFound))
        }
    }

    pub async fn download_file(path: warp::path::Tail, state: State) -> Result<impl warp::Reply, warp::reject::Rejection> {
        debug!("download");
        let path = urlencoding::decode(path.as_str()).unwrap();
        let found = {
            let repo = state.repo.lock().await;

            let head = repo.head().unwrap();
            let head_tree = head.peel_to_tree().unwrap();

            let mut index = Index::new().unwrap();
            index.read_tree(&head_tree).unwrap();

            index.iter().find(|entry| std::str::from_utf8(&entry.path).unwrap() == path.as_str())
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
                        res.headers_mut().insert(CONTENT_TYPE, mime.as_ref().parse().unwrap()).unwrap();
                    }
                    Ok(res)
                },
                Err(_) => Err(warp::reject::custom(NotFound))
            }
        }
        else {
            Err(warp::reject::custom(NotFound))
        }
    }

    pub async fn upload_file(mut form_data: warp::multipart::FormData, state: State) -> Result<impl warp::Reply, warp::reject::Rejection> {
        debug!("upload");

        // Create a blob for each part (file) in the form data
        let mut files = Vec::new();
        let mut result = Vec::new();
        while let Some(part) = form_data.next().await {
            debug!("{:?}", part);
            let mut part = part.unwrap();
            let data = part.data().await.unwrap();
            let mut buf = data.unwrap();

            let blob_oid = {
                let repo = state.repo.lock().await;

                let mut writer = repo.blob_writer(None).unwrap();
                while buf.has_remaining() {
                    let count = {
                        let bytes = buf.bytes();
                        writer.write_all(bytes).unwrap();
                        bytes.len()
                    };
                    buf.advance(count);
                }
                writer.commit().unwrap()
            };

            let filename = part.filename().unwrap().as_bytes().to_vec();
            files.push((filename, blob_oid));

            let uuid = part.name().to_owned();
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

        Ok(warp::reply::json(&result))
    }

    pub async fn auth(header_value: String) -> Result<(), warp::reject::Rejection> {
        let token = header_value.split_whitespace().nth(1).unwrap();
        debug!("received token: {}", token);

        let secret = env::var("MORIED_SECRET").unwrap();
        match jwt::decode::<Claims>(&token, &jwt::DecodingKey::from_secret(secret.as_ref()), &jwt::Validation::default()) {
            Ok(_) => {
                debug!("authorized");
                Ok(())
            },
            Err(e) => {
                debug!("failed to decode token: {:?}", e);
                Err(warp::reject::custom(Unauthorized))
            },
        }
    }

    pub async fn rejection(err: warp::reject::Rejection) -> Result<impl Reply, Infallible> {
        debug!("recovering from: {:?}", &err);
        let code =
            if let Some(_) = err.find::<NotFound>() {
                warp::http::StatusCode::NOT_FOUND
            }
            else if let Some(missing_header) = err.find::<warp::reject::MissingHeader>() {
                if missing_header.name() == "Authorization" {
                    warp::http::StatusCode::UNAUTHORIZED
                }
                else {
                    error!("unhandled rejection: {:?}", err);
                    warp::http::StatusCode::INTERNAL_SERVER_ERROR
                }
            } else if let Some(_) = err.find::<Unauthorized>() {
                warp::http::StatusCode::UNAUTHORIZED
            } else if let Some(_) = err.find::<warp::reject::PayloadTooLarge>() {
                warp::http::StatusCode::PAYLOAD_TOO_LARGE
            } else {
                error!("unhandled rejection: {:?}", err);
                warp::http::StatusCode::INTERNAL_SERVER_ERROR
            };

        Ok(code)
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

    impl warp::reject::Reject for Unauthorized {}

    #[derive(Debug)]
    pub struct NotFound;

    impl warp::reject::Reject for NotFound {}

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
