use std::sync::Arc;

use tokio::sync::{Mutex};
use git2::Repository;

#[tokio::main]
async fn main() {
    pretty_env_logger::init();

    let repo = match Repository::open("notes") {
        Ok(repo) => repo,
        Err(e) => panic!("failed to open: {}", e),
    };
    let repo = Arc::new(Mutex::new(repo));

    let api = filters::notes(repo);

    let routes = api;
    warp::serve(routes).run(([127, 0, 0, 1], 3030)).await;
}

mod filters {
    use super::handlers;

    use std::sync::Arc;

    use warp::Filter;
    use git2::Repository;
    use tokio::sync::{Mutex};

    pub fn notes(
        repo: Arc<Mutex<Repository>>,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        notes_list(repo.clone())
            .or(notes_load(repo))
    }

    pub fn notes_list(
        repo: Arc<Mutex<Repository>>,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("list")
            .and(warp::any().map(move || repo.clone()))
            .and_then(handlers::list_notes)
    }

    pub fn notes_load(
        repo: Arc<Mutex<Repository>>,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("load")
            .and(warp::path::tail())
            .and(warp::any().map(move || repo.clone()))
            .and_then(handlers::load_note)
    }
}

mod handlers {
    use std::sync::Arc;
    use std::convert::Infallible;
    use std::vec::Vec;
    use std::string::String;

    use git2::Repository;
    use tokio::sync::{Mutex};
    use tokio;
    use log::debug;
    use warp::reply::Reply;
    use mime_guess;
    use warp::http::header::CONTENT_TYPE;

    pub async fn list_notes(repo: Arc<Mutex<Repository>>) -> Result<impl warp::Reply, Infallible> {
        debug!("list");
        let repo = repo.lock().await;

        let head = repo.head().unwrap();
        let head_tree = head.peel_to_tree().unwrap();

        let mut index = Index::new().unwrap();
        index.read_tree(&head_tree).unwrap();

        let mut files = Vec::new();
        for x in index.iter() {
            files.push(String::from_utf8(x.path).unwrap());
        }
        Ok(warp::reply::json(&files))
    }

    pub async fn load_note(path: warp::path::Tail, repo: Arc<Mutex<Repository>>) -> Result<impl warp::Reply, warp::reject::Rejection> {
        debug!("load");
        let found = {
            let repo = repo.lock().await;
            let index = repo.index().unwrap();
            index.iter().find(|entry| std::str::from_utf8(&entry.path).unwrap() == path.as_str())
        };
        if let Some(entry) = found {
            let found = {
                let repo = repo.lock().await;
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
}
