//! What the backend knows of the task tree: which paths are in it, and a task's status.
//!
//! The web app derives the tree from the paths under `.tasks/` (`taskUuidOf` in
//! `frontend/src/task-forest.ts`), and a note outside the naming it needs is not a task there.
//! The MCP tools and the alarm scheduler both have to agree with it about which notes are tasks, so
//! the checks live here rather than in either.

/// Where the task tree's naming rules apply.
///
/// `entries_to_tree` derives the forest from the paths, so a file here named outside the
/// convention makes the whole task tree unbuildable for the web app.
pub(crate) const TASKS_DIR: &str = ".tasks/";

/// Whether a note at `path` is in the task tree, as the calendar and the task views count it.
pub(crate) fn in_task_tree(path: &str) -> bool {
    path.strip_prefix(TASKS_DIR).is_some_and(|rest| check_tree_naming(rest).is_ok())
}

/// The naming `entries_to_tree` needs: every directory component a bare UUIDv4, and the file
/// stem ending in one, optionally after a readable prefix.
pub(crate) fn check_tree_naming(rest: &str) -> Result<(), String> {
    let advice = "A task's file name must end with a UUIDv4 -- `<uuid>.md` or \
                  `readable-name-<uuid>.md` -- and every directory under `.tasks/` must be a bare \
                  UUIDv4 naming its parent task. The task tree is derived from these paths.";

    let mut components = rest.split('/').collect::<Vec<_>>();
    let Some(file) = components.pop() else {
        return Err(advice.to_owned());
    };
    for directory in components {
        if !is_uuid_v4(directory) {
            return Err(format!("The directory {directory:?} is not a UUIDv4. {advice}"));
        }
    }
    let stem = file.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(file);
    // `get`, not indexing: 36 bytes back can land inside a multibyte character, and a note's
    // path is whatever its author typed. This runs for every task on every scheduler pass, where
    // a panic would end the alarms until moried restarts.
    if !stem.len().checked_sub(36).and_then(|from| stem.get(from..)).is_some_and(is_uuid_v4) {
        return Err(format!("The file name {file:?} does not end with a UUIDv4. {advice}"));
    }
    Ok(())
}

fn is_uuid_v4(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .is_ok_and(|parsed| parsed.get_version() == Some(uuid::Version::Random))
}

/// The `task.status.kind` of a note, when it has one.
pub(crate) fn task_status_of(metadata: Option<&serde_yaml::Value>) -> Option<String> {
    metadata?
        .get("task")?
        .get("status")?
        .get("kind")?
        .as_str()
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn yaml(text: &str) -> serde_yaml::Value {
        serde_yaml::from_str(text).expect("the fixture should be YAML")
    }

    #[test]
    fn a_task_status_is_read_from_its_kind_and_nothing_else() {
        assert_eq!(
            task_status_of(Some(&yaml("task:\n  status:\n    kind: done"))).as_deref(),
            Some("done"),
        );
        // The older spelling, where status was a bare string, is not this shape and must not be
        // mistaken for it.
        assert_eq!(task_status_of(Some(&yaml("task:\n  status: done"))), None);
        assert_eq!(task_status_of(Some(&yaml("task: a string"))), None);
        assert_eq!(task_status_of(Some(&yaml("task:"))), None);
        assert_eq!(task_status_of(Some(&yaml("tags: [x]"))), None);
    }

    #[test]
    fn a_note_is_in_the_task_tree_by_its_path() {
        let uuid = "6f1d3c2e-8a4b-4c57-9d1e-2b7a5f0e9c31";
        let parent = "0d9a7e54-1c3b-4f6a-8b2d-5e4c7a1f9b60";
        assert!(in_task_tree(&format!(".tasks/{uuid}.md")));
        assert!(in_task_tree(&format!(".tasks/readable-name-{uuid}.md")));
        assert!(in_task_tree(&format!(".tasks/{parent}/{uuid}.md")));
        assert!(!in_task_tree(&format!("notes/{uuid}.md")));
        assert!(!in_task_tree(".tasks/not-a-uuid.md"));
        assert!(!in_task_tree(&format!(".tasks/directory/{uuid}.md")));
        assert!(!in_task_tree(&format!(".tasks{uuid}.md")));
    }

    #[test]
    fn a_multibyte_file_name_is_refused_rather_than_sliced() {
        // Twelve three-byte characters and one more byte put the 36-byte cut inside a character.
        let stem = format!("{}a", "あ".repeat(12));
        assert!(!in_task_tree(&format!(".tasks/{stem}.md")));
        assert!(check_tree_naming(&format!("{stem}.md")).is_err());
    }
}
