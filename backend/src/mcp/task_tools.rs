//! The task tools. A task is a `task:` block in an ordinary note's frontmatter, so every one of
//! these is an in-place frontmatter edit rather than a record update.

use rmcp::{model::CallToolResult, ErrorData};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_yaml::Value;

use super::frontmatter::{self, Change};
use super::tools::{note_text, safe_path, write_note, WriteOutput};
use super::{json_result, tool_error};
use crate::models::AppState;

/// The closed union `frontend/src/metadata-schema.json` defines, and the companion keys each
/// member requires.
///
/// `additionalProperties: false` on every member is why changing status removes the whole
/// `status:` mapping first: a task that goes from `waiting` to `todo` carrying its old
/// `waiting_for` is not a valid task, and the web app validates against this schema.
const STATUS_KINDS: [&str; 7] = [
    "todo", "in_progress", "waiting", "blocked", "on_hold", "done", "canceled",
];

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateTaskArgs {
    /// The note's exact repository path.
    pub path: String,
    /// The commit message. Say what changed and why.
    pub message: String,

    /// `todo`, `in_progress`, `waiting`, `blocked`, `on_hold`, `done` or `canceled`. Changing it
    /// replaces the whole status, so the fields the new one needs must come with it.
    #[serde(default)]
    pub status: Option<String>,
    /// Required by `waiting`: what is being waited for.
    #[serde(default)]
    pub waiting_for: Option<String>,
    #[serde(default)]
    pub expected_by: Option<String>,
    #[serde(default)]
    pub contact: Option<String>,
    #[serde(default)]
    pub follow_up_at: Option<String>,
    /// Required by `blocked`: what is blocking it.
    #[serde(default)]
    pub blocked_by: Option<String>,
    /// Required by `on_hold`: why.
    #[serde(default)]
    pub hold_reason: Option<String>,
    #[serde(default)]
    pub review_at: Option<String>,
    /// Required by `done`. A date (`2026-03-15`) or a datetime carrying its offset
    /// (`2026-03-15 18:17:46+09:00`). Defaults to now when the status becomes `done`.
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub completion_note: Option<String>,
    /// Required by `canceled`, along with `cancel_reason`. Defaults to now.
    #[serde(default)]
    pub canceled_at: Option<String>,
    /// Required by `canceled`: why.
    #[serde(default)]
    pub cancel_reason: Option<String>,

    /// 0 to 100.
    #[serde(default)]
    pub progress: Option<f64>,
    /// 1 to 5, where 5 is most important.
    #[serde(default)]
    pub importance: Option<i64>,
    /// 1 to 5, where 5 is most urgent.
    #[serde(default)]
    pub urgency: Option<i64>,
}

/// The `status:` mapping a kind and its companions make, or why they do not make one.
///
/// One change setting the whole mapping, rather than a removal followed by several sets. Every
/// member of the union has `additionalProperties: false`, so the old keys have to go -- a task
/// that moves from `waiting` to `todo` still carrying its `waiting_for` is not a valid task --
/// and replacing the mapping wholesale does that while leaving `status:` where the author put it
/// among its siblings.
fn status_changes(args: &UpdateTaskArgs, kind: &str) -> Result<Vec<Change>, String> {
    if !STATUS_KINDS.contains(&kind) {
        return Err(format!(
            "{kind:?} is not a task status. Use one of: {}.",
            STATUS_KINDS.join(", "),
        ));
    }

    // Insertion order is the order these appear in the file, so `kind` leads.
    let mut status = serde_yaml::Mapping::new();
    status.insert("kind".into(), kind.into());
    let optional = |status: &mut serde_yaml::Mapping, pairs: &[(&str, &Option<String>)]| {
        for (key, value) in pairs {
            if let Some(value) = value {
                status.insert((*key).into(), value.as_str().into());
            }
        }
    };

    match kind {
        "waiting" => {
            let Some(waiting_for) = args.waiting_for.as_deref() else {
                return Err("`waiting` needs waiting_for: what is being waited for.".to_owned());
            };
            status.insert("waiting_for".into(), waiting_for.into());
            optional(
                &mut status,
                &[
                    ("expected_by", &args.expected_by),
                    ("contact", &args.contact),
                    ("follow_up_at", &args.follow_up_at),
                ],
            );
        },
        "blocked" => {
            let Some(blocked_by) = args.blocked_by.as_deref() else {
                return Err("`blocked` needs blocked_by: what is blocking it.".to_owned());
            };
            status.insert("blocked_by".into(), blocked_by.into());
        },
        "on_hold" => {
            let Some(hold_reason) = args.hold_reason.as_deref() else {
                return Err("`on_hold` needs hold_reason: why it is on hold.".to_owned());
            };
            status.insert("hold_reason".into(), hold_reason.into());
            optional(&mut status, &[("review_at", &args.review_at)]);
        },
        "done" => {
            let completed_at = args.completed_at.clone().unwrap_or_else(now_local);
            status.insert("completed_at".into(), completed_at.into());
            optional(&mut status, &[("completion_note", &args.completion_note)]);
        },
        "canceled" => {
            let Some(cancel_reason) = args.cancel_reason.as_deref() else {
                return Err("`canceled` needs cancel_reason: why it was cancelled.".to_owned());
            };
            let canceled_at = args.canceled_at.clone().unwrap_or_else(now_local);
            status.insert("canceled_at".into(), canceled_at.into());
            status.insert("cancel_reason".into(), cancel_reason.into());
        },
        // `todo` and `in_progress` carry nothing but their kind.
        _ => {},
    }
    Ok(vec![Change::set(&["task", "status"], Value::Mapping(status))])
}

/// Now, spelled the way the notes spell a datetime: local wall clock carrying its own offset.
///
/// The offset is not decoration. A task completed at 18:17 in Tokyo and one completed at 18:17
/// in London are different moments, and a bare datetime cannot say which this was.
fn now_local() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S%:z").to_string()
}

/// The numeric fields, with the bounds the schema puts on them.
fn measure_changes(args: &UpdateTaskArgs) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    if let Some(progress) = args.progress {
        if !(0.0..=100.0).contains(&progress) {
            return Err(format!("progress must be between 0 and 100, not {progress}."));
        }
        // An integral percentage is written as an integer, which is how every task in the
        // repository spells it.
        if progress.fract() == 0.0 {
            changes.push(Change::set(&["task", "progress"], progress as i64));
        }
        else {
            changes.push(Change::set(&["task", "progress"], progress));
        }
    }
    for (name, value) in [("importance", args.importance), ("urgency", args.urgency)] {
        if let Some(value) = value {
            if !(1..=5).contains(&value) {
                return Err(format!("{name} must be between 1 and 5, not {value}."));
            }
            changes.push(Change::set(&["task", name], value));
        }
    }
    Ok(changes)
}

pub async fn update_task(
    state: &AppState,
    args: UpdateTaskArgs,
) -> Result<CallToolResult, ErrorData> {
    let path = match safe_path(&args.path) {
        Ok(path) => path,
        Err(message) => return Ok(tool_error(message)),
    };
    let Some(text) = note_text(state, &path).await? else {
        return Ok(tool_error(format!(
            "No note at {path:?}. Use list_tasks or search_notes to find one.",
        )));
    };

    let mut changes = match measure_changes(&args) {
        Ok(changes) => changes,
        Err(message) => return Ok(tool_error(message)),
    };
    if let Some(kind) = args.status.as_deref() {
        match status_changes(&args, kind) {
            Ok(status) => changes.extend(status),
            Err(message) => return Ok(tool_error(message)),
        }
    }
    if changes.is_empty() {
        return Ok(tool_error(
            "Nothing to change. Pass at least one of status, progress, importance or urgency.",
        ));
    }

    let edited = match frontmatter::apply(&text, &changes) {
        Ok(edited) => edited,
        Err(e) => return Ok(tool_error(e.to_string())),
    };
    if edited == text {
        return Ok(tool_error(format!(
            "{path:?} already says all of that, so nothing was committed.",
        )));
    }
    write_note(state, &path, &edited, &args.message).await
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CompleteTaskArgs {
    /// The note's exact repository path.
    pub path: String,
    /// The commit message.
    pub message: String,
    /// When it was finished. A date, or a datetime carrying its offset. Defaults to now.
    #[serde(default)]
    pub completed_at: Option<String>,
    /// An optional note about how it went.
    #[serde(default)]
    pub completion_note: Option<String>,
    /// Whether to set progress to 100 as well. Defaults to true.
    #[serde(default)]
    pub set_progress: Option<bool>,
}

pub async fn complete_task(
    state: &AppState,
    args: CompleteTaskArgs,
) -> Result<CallToolResult, ErrorData> {
    update_task(
        state,
        UpdateTaskArgs {
            path: args.path,
            message: args.message,
            status: Some("done".to_owned()),
            completed_at: args.completed_at,
            completion_note: args.completion_note,
            progress: args.set_progress.unwrap_or(true).then_some(100.0),
            ..empty_update()
        },
    )
    .await
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CancelTaskArgs {
    /// The note's exact repository path.
    pub path: String,
    /// The commit message.
    pub message: String,
    /// Why it was cancelled. The schema requires this.
    pub cancel_reason: String,
    /// When. A date, or a datetime carrying its offset. Defaults to now.
    #[serde(default)]
    pub canceled_at: Option<String>,
}

pub async fn cancel_task(
    state: &AppState,
    args: CancelTaskArgs,
) -> Result<CallToolResult, ErrorData> {
    update_task(
        state,
        UpdateTaskArgs {
            path: args.path,
            message: args.message,
            status: Some("canceled".to_owned()),
            canceled_at: args.canceled_at,
            cancel_reason: Some(args.cancel_reason),
            ..empty_update()
        },
    )
    .await
}

/// An `UpdateTaskArgs` with nothing set, so the wrappers above can name only what they mean.
fn empty_update() -> UpdateTaskArgs {
    UpdateTaskArgs {
        path: String::new(),
        message: String::new(),
        status: None,
        waiting_for: None,
        expected_by: None,
        contact: None,
        follow_up_at: None,
        blocked_by: None,
        hold_reason: None,
        review_at: None,
        completed_at: None,
        completion_note: None,
        canceled_at: None,
        cancel_reason: None,
        progress: None,
        importance: None,
        urgency: None,
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetTaskDatesArgs {
    /// The note's exact repository path.
    pub path: String,
    /// The commit message.
    pub message: String,
    /// When work on it starts.
    #[serde(default)]
    pub start_at: Option<String>,
    /// When it should be finished by.
    #[serde(default)]
    pub due_by: Option<String>,
    /// The hard deadline.
    #[serde(default)]
    pub deadline: Option<String>,
    /// The days it is scheduled on, as bare dates. An empty list clears them.
    #[serde(default)]
    pub scheduled_dates: Option<Vec<String>>,
    /// Dates to remove entirely: any of `start_at`, `due_by`, `deadline`, `scheduled_dates`.
    #[serde(default)]
    pub clear: Option<Vec<String>>,
}

const DATE_KEYS: [&str; 4] = ["start_at", "due_by", "deadline", "scheduled_dates"];

pub async fn set_task_dates(
    state: &AppState,
    args: SetTaskDatesArgs,
) -> Result<CallToolResult, ErrorData> {
    let path = match safe_path(&args.path) {
        Ok(path) => path,
        Err(message) => return Ok(tool_error(message)),
    };
    let Some(text) = note_text(state, &path).await? else {
        return Ok(tool_error(format!("No note at {path:?}.")));
    };

    let mut changes = Vec::new();
    for key in args.clear.as_deref().unwrap_or_default() {
        if !DATE_KEYS.contains(&key.as_str()) {
            return Ok(tool_error(format!(
                "{key:?} is not a task date. Clear one of: {}.",
                DATE_KEYS.join(", "),
            )));
        }
        changes.push(Change::remove(&["task", key]));
    }
    for (key, value) in [
        ("start_at", &args.start_at),
        ("due_by", &args.due_by),
        ("deadline", &args.deadline),
    ] {
        if let Some(value) = value {
            changes.push(Change::set(&["task", key], value.as_str()));
        }
    }
    if let Some(dates) = &args.scheduled_dates {
        changes.push(Change::set(
            &["task", "scheduled_dates"],
            Value::Sequence(dates.iter().map(|date| Value::String(date.clone())).collect()),
        ));
    }
    if changes.is_empty() {
        return Ok(tool_error(
            "Nothing to change. Pass a date to set, or name one in `clear`.",
        ));
    }

    let edited = match frontmatter::apply(&text, &changes) {
        Ok(edited) => edited,
        Err(e) => return Ok(tool_error(e.to_string())),
    };
    if edited == text {
        return Ok(tool_error(format!(
            "{path:?} already says all of that, so nothing was committed.",
        )));
    }
    write_note(state, &path, &edited, &args.message).await
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateTaskArgs {
    /// The task's title, which becomes the note's `#` heading.
    pub title: String,
    /// The commit message.
    pub message: String,
    /// Where to put it. Omit for `.tasks/<uuid>.md`. A readable prefix is welcome, but the name
    /// must still end with a UUIDv4.
    #[serde(default)]
    pub path: Option<String>,
    /// Markdown to put under the heading.
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// Defaults to `todo`.
    #[serde(default)]
    pub status: Option<String>,
    /// Defaults to 0.
    #[serde(default)]
    pub progress: Option<f64>,
    /// 1 to 5. Defaults to 3.
    #[serde(default)]
    pub importance: Option<i64>,
    /// 1 to 5. Defaults to 3.
    #[serde(default)]
    pub urgency: Option<i64>,
    #[serde(default)]
    pub start_at: Option<String>,
    #[serde(default)]
    pub due_by: Option<String>,
    #[serde(default)]
    pub deadline: Option<String>,
    #[serde(default)]
    pub scheduled_dates: Option<Vec<String>>,
    /// Required when `status` is `waiting`.
    #[serde(default)]
    pub waiting_for: Option<String>,
    /// Required when `status` is `blocked`.
    #[serde(default)]
    pub blocked_by: Option<String>,
    /// Required when `status` is `on_hold`.
    #[serde(default)]
    pub hold_reason: Option<String>,
    /// Required when `status` is `canceled`.
    #[serde(default)]
    pub cancel_reason: Option<String>,
}

#[derive(Debug, Serialize)]
struct CreatedTask {
    #[serde(flatten)]
    written: WriteOutput,
    /// The whole file as it was written, so the caller can see what the defaults filled in.
    content: String,
}

pub async fn create_task(
    state: &AppState,
    args: CreateTaskArgs,
) -> Result<CallToolResult, ErrorData> {
    // Nothing is being preserved here, so this one note is written outright rather than edited.
    // The schema requires all five of status, progress, importance, urgency and
    // scheduled_dates, so every one of them gets a value whether the caller named it or not.
    let update = UpdateTaskArgs {
        path: String::new(),
        message: String::new(),
        status: Some(args.status.clone().unwrap_or_else(|| "todo".to_owned())),
        waiting_for: args.waiting_for.clone(),
        blocked_by: args.blocked_by.clone(),
        hold_reason: args.hold_reason.clone(),
        cancel_reason: args.cancel_reason.clone(),
        progress: Some(args.progress.unwrap_or(0.0)),
        importance: Some(args.importance.unwrap_or(3)),
        urgency: Some(args.urgency.unwrap_or(3)),
        ..empty_update()
    };
    let mut changes = match measure_changes(&update) {
        Ok(changes) => changes,
        Err(message) => return Ok(tool_error(message)),
    };
    match status_changes(&update, update.status.as_deref().unwrap_or("todo")) {
        Ok(status) => changes.extend(status),
        Err(message) => return Ok(tool_error(message)),
    }
    if let Some(tags) = &args.tags {
        changes.push(Change::set(
            &["tags"],
            Value::Sequence(tags.iter().map(|tag| Value::String(tag.clone())).collect()),
        ));
    }
    for (key, value) in [
        ("start_at", &args.start_at),
        ("due_by", &args.due_by),
        ("deadline", &args.deadline),
    ] {
        if let Some(value) = value {
            changes.push(Change::set(&["task", key], value.as_str()));
        }
    }
    let dates = args.scheduled_dates.clone().unwrap_or_default();
    changes.push(Change::set(
        &["task", "scheduled_dates"],
        Value::Sequence(dates.into_iter().map(Value::String).collect()),
    ));

    let path = match args.path {
        Some(path) => match super::tools::writable_path(&path) {
            Ok(path) => path,
            Err(message) => return Ok(tool_error(message)),
        },
        // UUIDv4, matching the frontend: `entries_to_tree` drops every other version, and a task
        // the tree cannot place is a task the app cannot show.
        None => format!(".tasks/{}.md", uuid::Uuid::new_v4()),
    };
    if crate::find_entry_blob(state, &path).await.is_some() {
        return Ok(tool_error(format!("{path:?} already exists.")));
    }

    let body = match args.body.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
        Some(body) => format!("# {}\n\n{}\n", args.title.trim(), body),
        None => format!("# {}\n", args.title.trim()),
    };
    let content = match frontmatter::apply(&body, &changes) {
        Ok(content) => content,
        Err(e) => return Ok(tool_error(e.to_string())),
    };

    match state.save_note(&path, content.as_bytes(), &args.message).await {
        Ok(commit) => json_result(&CreatedTask {
            written: WriteOutput {
                path,
                commit: commit.to_string(),
                message: args.message,
            },
            content,
        }),
        Err(e) => {
            tracing::error!("MCP create_task failed for {}: {:?}", path, e);
            Ok(tool_error(format!("{path:?} could not be written: {e:#}")))
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(path: &str) -> UpdateTaskArgs {
        UpdateTaskArgs {
            path: path.to_owned(),
            message: "m".to_owned(),
            ..empty_update()
        }
    }

    fn apply(text: &str, changes: &[Change]) -> String {
        frontmatter::apply(text, changes).expect("the edit should apply")
    }

    const TASK: &str = "---\n\
                        tags:\n    - work\n\
                        task:\n\
                        \x20   status:\n\
                        \x20       kind: waiting\n\
                        \x20       waiting_for: a reply\n\
                        \x20       contact: someone\n\
                        \x20   progress: 20\n\
                        \x20   importance: 3\n\
                        \x20   urgency: 2\n\
                        \x20   scheduled_dates: []\n\
                        ---\n\n# A task\n";

    /// Every member of the union has `additionalProperties: false`, so a task that moves from
    /// `waiting` to `todo` carrying its old `waiting_for` is not a valid task.
    #[test]
    fn changing_status_takes_the_old_status_keys_with_it() {
        let changes = status_changes(&args("t.md"), "todo").expect("todo needs nothing");
        let edited = apply(TASK, &changes);
        assert!(edited.contains("        kind: todo\n"), "{edited}");
        assert!(!edited.contains("waiting_for"), "{edited}");
        assert!(!edited.contains("contact"), "{edited}");
        // Everything outside the status block is untouched.
        assert!(edited.contains("    progress: 20\n"));
        assert!(edited.contains("tags:\n    - work\n"));
        assert!(edited.ends_with("---\n\n# A task\n"));
    }

    #[test]
    fn a_status_that_needs_a_companion_key_says_so() {
        for (kind, wanted) in [
            ("waiting", "waiting_for"),
            ("blocked", "blocked_by"),
            ("on_hold", "hold_reason"),
            ("canceled", "cancel_reason"),
        ] {
            let error = status_changes(&args("t.md"), kind)
                .expect_err("{kind} should require its companion");
            assert!(error.contains(wanted), "{kind}: {error}");
        }
        // And the two that need nothing.
        assert!(status_changes(&args("t.md"), "todo").is_ok());
        assert!(status_changes(&args("t.md"), "in_progress").is_ok());
        assert!(status_changes(&args("t.md"), "procrastinating").is_err());
    }

    #[test]
    fn done_and_canceled_stamp_themselves_when_no_time_is_given() {
        let changes = status_changes(&args("t.md"), "done").expect("done defaults its time");
        let edited = apply(TASK, &changes);
        let stamped = edited
            .lines()
            .find(|line| line.contains("completed_at:"))
            .expect("a completed_at was written");
        // Local wall clock carrying its own offset, which is what the notes use and what a bare
        // datetime cannot express.
        let value = stamped.split_once("completed_at: ").unwrap().1;
        assert!(
            chrono::DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%:z").is_ok(),
            "{value:?} is not a datetime carrying an offset",
        );
    }

    #[test]
    fn a_measure_outside_its_bounds_is_refused() {
        for (progress, importance, urgency) in [
            (Some(101.0), None, None),
            (Some(-1.0), None, None),
            (None, Some(0), None),
            (None, Some(6), None),
            (None, None, Some(0)),
        ] {
            let mut a = args("t.md");
            a.progress = progress;
            a.importance = importance;
            a.urgency = urgency;
            assert!(measure_changes(&a).is_err(), "{progress:?} {importance:?} {urgency:?}");
        }
    }

    /// The notes write a whole percentage as an integer, and a task rewritten as `progress: 50.0`
    /// would read as an app-touched file even though nothing else changed.
    #[test]
    fn a_whole_percentage_is_written_as_an_integer() {
        let mut a = args("t.md");
        a.progress = Some(50.0);
        assert!(apply(TASK, &measure_changes(&a).unwrap()).contains("    progress: 50\n"));
        a.progress = Some(12.5);
        assert!(apply(TASK, &measure_changes(&a).unwrap()).contains("    progress: 12.5\n"));
    }
}
