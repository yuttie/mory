#[tokio::main]
async fn main() {
    pretty_env_logger::init();

    let api = filters::notes();
    let routes = api;
    warp::serve(routes).run(([127, 0, 0, 1], 3030)).await;
}

mod filters {
    use warp::Filter;
    use log::debug;

    pub fn notes(
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        notes_list()
    }

    pub fn notes_list(
    ) -> impl Filter<Extract = impl warp::Reply, Error = warp::Rejection> + Clone {
        warp::path("list")
            .map(|| {
                debug!("list");
                let files = vec!["Home.md", "test.md"];
                warp::reply::json(&files)
            })
    }
}
