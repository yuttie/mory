//! What the backend knows of the task tree: which paths are in it, a task's status, and which of
//! its fields are dates.
//!
//! The web app derives the tree from the paths under `.tasks/` (`taskUuidOf` in
//! `frontend/src/task-forest.ts`), and a note outside the naming it needs is not a task there.
//! The MCP tools and the alarm scheduler both have to agree with it about which notes are tasks, so
//! the checks live here rather than in either.

use std::borrow::Cow;

use serde_yaml::{Mapping, Value};

use crate::models::ListEntry;

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

/// Every kind a task's `status` can take: the closed union `frontend/src/metadata-schema.json`
/// defines, each member requiring companion keys of its own.
pub(crate) const STATUS_KINDS: [&str; 8] = [
    "backlog", "todo", "in_progress", "waiting", "blocked", "on_hold", "done", "canceled",
];

/// Whether a status kind is one the task has finished with. The calendar draws such a task struck
/// through, and nothing rings for it.
pub(crate) fn is_over(kind: Option<&str>) -> bool {
    matches!(kind, Some("done" | "canceled"))
}

/// Which of a task's two dates the calendar draws as events, and the scheduler rings for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskField {
    DueBy,
    Deadline,
}

impl TaskField {
    pub(crate) const ALL: [TaskField; 2] = [TaskField::DueBy, TaskField::Deadline];

    /// The key it has under `task:`, and under `task.alarms:`.
    pub(crate) fn key(self) -> &'static str {
        match self {
            TaskField::DueBy => "due_by",
            TaskField::Deadline => "deadline",
        }
    }
}

/// A note in the task tree that carries a `task:` mapping, with its path and that mapping.
///
/// This is the whole of which notes the calendar draws task dates for: a `task:` block on any
/// other path is not in the tree, and one that is not a mapping holds no dates.
pub(crate) fn task_of(entry: &ListEntry) -> Option<(Cow<'_, str>, &Mapping)> {
    let path = entry.path.to_string_lossy();
    if !in_task_tree(&path) {
        return None;
    }
    match entry.metadata.as_ref()?.get("task")? {
        Value::Mapping(task) => Some((path, task)),
        _ => None,
    }
}

/// The dates a task holds, as written. A value that is not a string is a task without that date,
/// because frontmatter is whatever the file said; whether the string is a date is for the caller,
/// since the calendar window and the scheduler read it differently.
pub(crate) fn date_texts(task: &Mapping) -> impl Iterator<Item = (TaskField, &str)> {
    TaskField::ALL
        .into_iter()
        .filter_map(|field| Some((field, task.get(field.key())?.as_str()?)))
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

/// The frontend attaches only to a file covering the immediate directory. Missing
/// parents re-root children; metadata is not required to occupy a place in the tree.
pub(crate) struct TaskHierarchy {
    pub valid: Vec<bool>,
    pub children: Vec<Vec<usize>>,
}

impl TaskHierarchy {
    pub fn new(entries: &[ListEntry]) -> Self {
        use std::collections::{BTreeMap, BTreeSet};
        let mut ids = BTreeMap::new();
        let mut covers = BTreeMap::new();
        for (index, entry) in entries.iter().enumerate() {
            if !in_task_tree(&entry.path.to_string_lossy()) { continue; }
            let Some(stem) = entry.path.file_stem().and_then(|stem| stem.to_str()) else { continue; };
            let Some(id) = stem.len().checked_sub(36).and_then(|cut| stem.get(cut..)) else { continue; };
            let Ok(uuid) = uuid::Uuid::parse_str(id) else { continue; };
            if uuid.get_variant() != uuid::Variant::RFC4122 { continue; }
            ids.entry(id.to_owned()).or_insert(index);
            covers.entry(entry.path.with_extension("")).or_insert(id.to_owned());
        }
        let mut parents = vec![None; entries.len()];
        let mut valid = vec![false; entries.len()];
        for &index in ids.values() {
            valid[index] = true;
            parents[index] = entries[index].path.parent().and_then(|dir| covers.get(dir)).and_then(|id| ids.get(id)).copied();
        }
        let mut children = vec![Vec::new(); entries.len()];
        for &index in ids.values() {
            let mut seen = BTreeSet::from([index]);
            let mut ancestor = parents[index];
            let mut cycle = false;
            while let Some(parent) = ancestor {
                if !seen.insert(parent) { cycle = true; break; }
                ancestor = parents[parent];
            }
            if !cycle {
                if let Some(parent) = parents[index] { children[parent].push(index); }
            }
        }
        Self { valid, children }
    }

    pub fn descendants(&self, index: usize) -> Vec<usize> {
        let mut pending = self.children[index].clone();
        let mut result = Vec::new();
        while let Some(child) = pending.pop() {
            result.push(child);
            pending.extend(&self.children[child]);
        }
        result
    }
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
