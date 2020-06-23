use std::sync::Arc;

use tokio::sync::{Mutex};
use git2::Repository;
use warp::Filter;

#[tokio::main]
async fn main() {
    pretty_env_logger::init();

    let repo = match Repository::open("notes") {
        Ok(repo) => repo,
        Err(e) => panic!("failed to open: {}", e),
    };
    let state = models::State::new(repo);

    let api = filters::notes(state);

    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["GET", "POST"])
        .allow_headers(vec!["Content-Type"]);

    let routes = api.with(cors);
    warp::serve(routes).run(([127, 0, 0, 1], 3030)).await;
}

mod filters {
    use super::handlers;
    use super::models;

    use std::sync::Arc;

    use warp::Filter;
    use git2::Repository;
    use tokio::sync::{Mutex};

    pub fn notes(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        notes_list(state.clone())
            .or(notes_load(state.clone()))
            .or(notes_save(state))
    }

    pub fn notes_list(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("list")
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::list_notes)
    }

    pub fn notes_load(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("load")
            .and(warp::path::tail())
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::load_note)
    }

    pub fn notes_save(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("save")
            .and(warp::post())
            .and(warp::body::json())
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::save_note)
    }
}

mod handlers {
    use super::models::{State, ListEntry, NoteSave};

    use std::sync::Arc;
    use std::convert::Infallible;
    use std::vec::Vec;
    use std::string::String;

    use git2::{Repository, Index, IndexEntry, IndexTime, Oid, Signature};
    use tokio::sync::{Mutex};
    use tokio;
    use log::debug;
    use warp::reply::Reply;
    use mime_guess;
    use warp::http::header::CONTENT_TYPE;

    pub async fn list_notes(state: State) -> Result<impl warp::Reply, Infallible> {
        debug!("list");
        let mut cached_entries = state.cached_entries.lock().await;
        if let Some(ref entries) = *cached_entries {
            Ok(warp::reply::json(&entries))
        }
        else {
            let repo = state.repo.lock().await;

            let head = repo.head().unwrap();
            let head_tree = head.peel_to_tree().unwrap();

            let mut index = Index::new().unwrap();
            index.read_tree(&head_tree).unwrap();

            let mut entries = Vec::new();
            for entry in index.iter() {
                let path = String::from_utf8(entry.path).unwrap();
                let blob = repo.find_blob(entry.id).unwrap();
                if blob.content().starts_with(b"---\n") {
                    if let Some(j) = blob.content().windows(5).position(|window| window == b"\n---\n") {
                        if let Ok(yaml) = std::str::from_utf8(&blob.content()[4..j]) {
                            let doc: serde_yaml::Value = serde_yaml::from_str(yaml).unwrap();
                            debug!("{:?}", &doc);
                            entries.push((path.clone(), Some(doc)));
                        }
                        else {
                            entries.push((path.clone(), None));
                        }
                    }
                    else {
                        entries.push((path.clone(), None));
                    }
                }
                else {
                    entries.push((path.clone(), None));
                }
            }
            let reply = warp::reply::json(&entries);
            *cached_entries = Some(entries);
            Ok(reply)
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
                Err(_) => Err(warp::reject::not_found()),
            }
        }
        else {
            Err(warp::reject::not_found())
        }
    }

    pub async fn save_note(note_save: NoteSave, state: State) -> Result<impl warp::Reply, Infallible> {
        debug!("save");
        let repo = state.repo.lock().await;

        let head = repo.head().unwrap();
        let head_tree = head.peel_to_tree().unwrap();
        let head_commit = head.peel_to_commit().unwrap();

        let mut index = Index::new().unwrap();
        index.read_tree(&head_tree).unwrap();

        let blob_oid = repo.blob(note_save.content.as_bytes()).unwrap();
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
            path: note_save.path.into_bytes(),
        };
        index.add(&entry).unwrap();

        let tree_oid = index.write_tree_to(&repo).unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();

        let signature = repo.signature().unwrap();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &note_save.message,
            &tree,
            &[&head_commit],
        ).unwrap();
        Ok(warp::reply::json(&true))
    }
}

mod models {
    use std::sync::Arc;
    use std::option::Option;

    use git2::Repository;
    use serde::{Deserialize, Serialize};
    use tokio::sync::Mutex;

    pub type Metadata = serde_yaml::Value;
    pub type ListEntry = (String, Option<Metadata>);

    #[derive(Clone)]
    pub struct State {
        pub repo: Arc<Mutex<Repository>>,
        pub cached_entries: Arc<Mutex<Option<Vec<ListEntry>>>>,
    }

    impl State {
        pub fn new(repo: Repository) -> State {
            State {
                repo: Arc::new(Mutex::new(repo)),
                cached_entries: Arc::new(Mutex::new(None)),
            }
        }
    }

    #[derive(Debug, Deserialize, Serialize, Clone)]
    pub struct NoteSave {
        pub path: String,
        pub content: String,
        pub message: String,
    }
}
