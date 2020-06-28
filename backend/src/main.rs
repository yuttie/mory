use std::env;
use std::net::ToSocketAddrs;
use std::sync::Arc;

use dotenv::dotenv;
use tokio::sync::{Mutex};
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

    let api = filters::notes(state);

    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["GET", "PUT", "DELETE"])
        .allow_headers(vec!["Content-Type"]);

    let routes = api.with(cors);
    let addr = {
        let mut addrs_iter = env::var("MORIED_LISTEN").unwrap().to_socket_addrs().unwrap();
        addrs_iter.next().unwrap()
    };
    warp::serve(routes).run(addr).await;
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
            .or(notes_save(state.clone()))
            .or(notes_delete(state))
    }

    pub fn notes_list(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("notes")
            .and(warp::path::end())
            .and(warp::get())
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::list_notes)
    }

    pub fn notes_load(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("notes")
            .and(warp::path::tail())
            .and(warp::get())
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::load_note)
    }

    pub fn notes_save(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("notes")
            .and(warp::path::tail())
            .and(warp::put())
            .and(warp::body::json())
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::save_note)
    }

    pub fn notes_delete(
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("notes")
            .and(warp::path::tail())
            .and(warp::delete())
            .and(warp::any().map(move || state.clone()))
            .and_then(handlers::delete_note)
    }
}

mod handlers {
    use super::models::{State, Cached, ListEntry, NoteSave};

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
        let repo = state.repo.lock().await;
        let mut cached_entries = state.cached_entries.lock().await;
        if let Some(entries) = cached_entries.get(&repo) {
            Ok(warp::reply::json(&entries))
        }
        else {
            let head = repo.head().unwrap();
            let head_commit = head.peel_to_commit().unwrap();
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
            *cached_entries = Cached::Computed {
                commit_id: head_commit.id(),
                data: entries,
            };
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
                    Err(warp::reject::not_found())
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
            Err(warp::reject::not_found())
        }
    }
}

mod models {
    use std::sync::Arc;
    use std::option::Option;

    use git2::{Repository, Oid};
    use serde::{Deserialize, Serialize};
    use tokio::sync::Mutex;

    pub type Metadata = serde_yaml::Value;
    pub type ListEntry = (String, Option<Metadata>);

    pub enum Cached<T> {
        Computed {
            commit_id: Oid,
            data: T,
        },
        None,
    }

    impl<T> Cached<T> {
        pub fn get(&self, repo: &Repository) -> Option<&T> {
            match self {
                Cached::None => None,
                Cached::Computed { commit_id, data } => {
                    let head = repo.head().unwrap();
                    match head.peel_to_commit() {
                        Err(_) => None,
                        Ok(commit) => {
                            if *commit_id == commit.id() {
                                Some(data)
                            }
                            else {
                                None
                            }
                        },
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
