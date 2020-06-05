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
    use log::debug;
    use git2::Repository;
    use tokio::sync::{Mutex};

    pub fn notes(
        repo: Arc<Mutex<Repository>>,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        notes_list(repo)
    }

    pub fn notes_list(
        repo: Arc<Mutex<Repository>>,
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("list")
            .and(warp::any().map(move || repo.clone()))
            .and_then(handlers::list_notes)
    }
}

mod handlers {
    use std::sync::Arc;
    use std::convert::Infallible;
    use std::vec::Vec;
    use std::string::String;

    use git2::Repository;
    use tokio::sync::{Mutex};
    use log::debug;

    pub async fn list_notes(repo: Arc<Mutex<Repository>>) -> Result<impl warp::Reply, Infallible> {
        debug!("list");
        let locked = repo.lock().await;
        let index = locked.index().unwrap();
        let mut files = Vec::new();
        for x in index.iter() {
            files.push(String::from_utf8(x.path).unwrap());
        }
        Ok(warp::reply::json(&files))
    }
}
