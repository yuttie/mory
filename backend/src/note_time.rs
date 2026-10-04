/// Local wall clock carrying its offset, as notes spell their timestamps.
pub fn now_local() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S%:z").to_string()
}
