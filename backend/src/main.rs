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
        .allow_methods(vec!["GET", "POST", "PUT", "DELETE"])
        .allow_headers(vec!["Authorization", "Content-Type"]);

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

    use warp::Filter;

    pub fn notes(
        root_path: Option<String>,
        state: models::State,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        if let Some(root_path) = root_path {
            warp::path(root_path)
                .and(auth()
                    .and(notes_list(state.clone())
                        .or(notes_load(state.clone()))
                        .or(notes_save(state.clone()))
                        .or(notes_delete(state)))
                    .or(notes_login()))
                .recover(handlers::rejection)
                .boxed()
        }
        else {
            auth()
                .and(notes_list(state.clone())
                    .or(notes_load(state.clone()))
                    .or(notes_save(state.clone()))
                    .or(notes_delete(state)))
                .or(notes_login())
                .recover(handlers::rejection)
                .boxed()
        }
    }

    pub fn notes_login() -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("login")
            .and(warp::path::end())
            .and(warp::post())
            .and(warp::body::json())
            .and_then(handlers::login)
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

    pub fn auth() -> impl Filter<Extract = (), Error = warp::Rejection> + Copy {
        warp::header::<String>("Authorization")
            .and_then(handlers::auth)
            .untuple_one()
    }
}

mod handlers {
    use super::models::{Unauthorized, Claims, State, Cached, Login, NoteSave};

    use std::env;
    use std::convert::Infallible;
    use std::vec::Vec;
    use std::string::String;

    use argon2;
    use chrono::{DateTime, Duration, Utc};
    use git2::{Index, IndexEntry, IndexTime};
    use jsonwebtoken as jwt;
    use log::{debug, error};
    use warp::reply::Reply;
    use mime_guess;
    use warp::http::header::CONTENT_TYPE;

    pub async fn login(login: Login) -> Result<Box<dyn warp::Reply>, warp::reject::Rejection> {
        debug!("login");
        debug!("{:?}", login);
        let user_name = env::var("MORIED_USER_NAME").unwrap();
        let user_email = env::var("MORIED_USER_EMAIL").unwrap();
        let user_hash = env::var("MORIED_USER_HASH").unwrap();
        let matches = user_name == login.user && argon2::verify_encoded(&user_hash, login.password.as_ref()).unwrap();

        if matches {
            let secret = env::var("MORIED_SECRET").unwrap();
            let now: DateTime<Utc> = Utc::now();
            let my_claims = Claims {
                sub: login.user.to_owned(),
                exp: (now + Duration::hours(6)).timestamp() as usize,
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
        let code =
            if err.is_not_found() {
                warp::http::StatusCode::NOT_FOUND
            } else if let Some(missing_header) = err.find::<warp::reject::MissingHeader>() {
                if missing_header.name() == "Authorization" {
                    warp::http::StatusCode::UNAUTHORIZED
                }
                else {
                    error!("unhandled rejection: {:?}", err);
                    warp::http::StatusCode::INTERNAL_SERVER_ERROR
                }
            } else if let Some(_) = err.find::<Unauthorized>() {
                warp::http::StatusCode::UNAUTHORIZED
            } else {
                error!("unhandled rejection: {:?}", err);
                warp::http::StatusCode::INTERNAL_SERVER_ERROR
            };

        Ok(code)
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

    #[derive(Debug)]
    pub struct Unauthorized;

    impl warp::reject::Reject for Unauthorized {}

    #[derive(Debug, Serialize, Deserialize)]
    pub struct Claims {
        pub sub: String,
        pub exp: usize,
        pub email: String,
    }

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
