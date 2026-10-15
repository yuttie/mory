//! The task tools. A task is a `task:` block in an ordinary note's frontmatter, so every one of
//! these is an in-place frontmatter edit rather than a record update.

use rmcp::{model::CallToolResult, ErrorData};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_yaml::Value;

use super::frontmatter::{self, Change};
use super::tools::{alarm_list, commit_edit, note_to_edit, safe_path, WriteOutput};
use super::{json_result, tool_error};
use crate::models::AppState;
use crate::note_time::now_local;
use crate::tasks::{TaskField, STATUS_KINDS};

/// What `create_task` writes when the caller names no status. The web app's editor starts a new
/// task in the backlog too: To do is a commitment made by moving it there.
const NEW_TASK_STATUS: &str = "backlog";

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateTaskArgs {
    /// The note's exact repository path.
    pub path: String,
    /// The commit message. Say what changed and why.
    pub message: String,

    /// `backlog`, `todo`, `in_progress`, `waiting`, `blocked`, `on_hold`, `done` or `canceled`.
    /// Changing it replaces the whole status, so the fields the new one needs must come with it.
    /// Setting the status the task already has changes only the fields given.
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

    /// low, medium or high; use clear_importance to return to unrated.
    #[serde(default)]
    pub importance: Option<Importance>,
    #[serde(default)]
    pub clear_importance: bool,
    /// Whole calendar days or weeks, such as 14d or 2w.
    #[serde(default)]
    pub lead_time: Option<String>,
    #[serde(default)]
    pub clear_lead_time: bool,
}

/// The `status:` mapping a kind and its companions make, or why they do not make one.
///
/// One change setting the whole mapping, rather than a removal followed by several sets. Every
/// member of the union has `additionalProperties: false`, so the old keys have to go -- a task
/// that moves from `waiting` to `todo` still carrying its `waiting_for` is not a valid task --
/// and replacing the mapping wholesale does that while leaving `status:` where the author put it
/// among its siblings.
///
/// Setting the kind the task already has changes only what `args` gives, and keeps the rest of
/// `current`: completing a done task again must not move its `completed_at` to now and drop its
/// `completion_note`, which is the record of when and how it was done.
fn status_changes(args: &UpdateTaskArgs, kind: &str, current: Option<&serde_yaml::Mapping>) -> Result<Vec<Change>, String> {
    if !STATUS_KINDS.contains(&kind) {
        return Err(format!(
            "{kind:?} is not a task status. Use one of: {}.",
            STATUS_KINDS.join(", "),
        ));
    }
    for (key, value) in [
        ("completed_at", &args.completed_at),
        ("canceled_at", &args.canceled_at),
        ("expected_by", &args.expected_by),
        ("follow_up_at", &args.follow_up_at),
        ("review_at", &args.review_at),
    ] {
        if let Some(value) = value {
            validate_task_date(key, value)?;
        }
    }

    // Insertion order is the order these appear in the file, so `kind` leads.
    let mut status = serde_yaml::Mapping::new();
    status.insert("kind".into(), kind.into());
    if let Some(current) = current.filter(|current| current.get("kind").and_then(Value::as_str) == Some(kind)) {
        status.extend(current.iter().map(|(key, value)| (key.clone(), value.clone())));
    }
    let has = |status: &serde_yaml::Mapping, key: &str| status.get(key).is_some_and(|value| !value.is_null());
    let optional = |status: &mut serde_yaml::Mapping, pairs: &[(&str, &Option<String>)]| {
        for (key, value) in pairs {
            if let Some(value) = value {
                status.insert((*key).into(), value.as_str().into());
            }
        }
    };

    match kind {
        "waiting" => {
            match args.waiting_for.as_deref() {
                Some(waiting_for) => { status.insert("waiting_for".into(), waiting_for.into()); },
                None if has(&status, "waiting_for") => {},
                None => return Err("`waiting` needs waiting_for: what is being waited for.".to_owned()),
            }
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
            match args.blocked_by.as_deref() {
                Some(blocked_by) => { status.insert("blocked_by".into(), blocked_by.into()); },
                None if has(&status, "blocked_by") => {},
                None => return Err("`blocked` needs blocked_by: what is blocking it.".to_owned()),
            }
        },
        "on_hold" => {
            match args.hold_reason.as_deref() {
                Some(hold_reason) => { status.insert("hold_reason".into(), hold_reason.into()); },
                None if has(&status, "hold_reason") => {},
                None => return Err("`on_hold` needs hold_reason: why it is on hold.".to_owned()),
            }
            optional(&mut status, &[("review_at", &args.review_at)]);
        },
        "done" => {
            match args.completed_at.clone() {
                Some(completed_at) => { status.insert("completed_at".into(), completed_at.into()); },
                None if has(&status, "completed_at") => {},
                None => { status.insert("completed_at".into(), now_local().into()); },
            }
            optional(&mut status, &[("completion_note", &args.completion_note)]);
        },
        "canceled" => {
            if args.cancel_reason.is_none() && !has(&status, "cancel_reason") {
                return Err("`canceled` needs cancel_reason: why it was cancelled.".to_owned());
            }
            match args.canceled_at.clone() {
                Some(canceled_at) => { status.insert("canceled_at".into(), canceled_at.into()); },
                None if has(&status, "canceled_at") => {},
                None => { status.insert("canceled_at".into(), now_local().into()); },
            }
            optional(&mut status, &[("cancel_reason", &args.cancel_reason)]);
        },
        // `backlog`, `todo` and `in_progress` carry nothing but their kind.
        _ => {},
    }
    Ok(vec![Change::set(&["task", "status"], Value::Mapping(status))])
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Importance { Low, Medium, High }

impl Importance {
    fn text(&self) -> &'static str {
        match self { Self::Low => "low", Self::Medium => "medium", Self::High => "high" }
    }
}

fn measure_changes(args: &UpdateTaskArgs) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    if args.clear_importance {
        changes.push(Change::remove(&["task", "importance"]));
    }
    if let Some(importance) = &args.importance {
        changes.push(Change::set(&["task", "importance"], importance.text()));
    }
    if args.clear_lead_time {
        changes.push(Change::remove(&["task", "lead_time"]));
    }
    if let Some(lead) = &args.lead_time {
        if crate::urgency::lead_time_days(&lead.clone().into()).is_none() {
            return Err("lead_time must be whole days or weeks, such as 14d or 2w.".into());
        }
        changes.push(Change::set(&["task", "lead_time"], lead.trim()));
    }
    Ok(changes)
}

pub async fn update_task(
    state: &AppState,
    args: UpdateTaskArgs,
) -> Result<CallToolResult, ErrorData> {
    let path = match safe_path(&args.path).and_then(task_path) {
        Ok(path) => path,
        Err(message) => return Ok(tool_error(message)),
    };
    let Some(note) = note_to_edit(state, &path).await? else {
        return Ok(tool_error(format!(
            "No note at {path:?}. Use list_tasks or search_notes to find one.",
        )));
    };

    let mut changes = match measure_changes(&args) {
        Ok(changes) => changes,
        Err(message) => return Ok(tool_error(message)),
    };
    if let Some(kind) = args.status.as_deref() {
        let current = frontmatter::value(&note.0);
        let current = current.as_ref().and_then(|root| root.get("task")?.get("status")?.as_mapping());
        match status_changes(&args, kind, current) {
            Ok(status) => changes.extend(status),
            Err(message) => return Ok(tool_error(message)),
        }
    }
    if changes.is_empty() {
        return Ok(tool_error(
            "Nothing to change. Pass status, importance or lead_time, or clear_importance/clear_lead_time. Urgency and progress are derived; use plan_task for planning.",
        ));
    }

    commit_edit(state, &path, &note, &changes, &args.message).await
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
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
            ..empty_update()
        },
    )
    .await
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
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

/// Refuses a path outside the task tree, where a `task:` block makes no task: neither the web app
/// nor `list_tasks` would show it.
fn task_path(path: String) -> Result<String, String> {
    if crate::tasks::in_task_tree(&path) {
        return Ok(path);
    }
    Err(format!(
        "{path:?} is not in the task tree, so a `task:` block there would not make it a task. \
         Tasks live under `.tasks/`, named by a UUIDv4; list_tasks lists them, and create_task \
         makes one.",
    ))
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
        importance: None,
        clear_importance: false,
        lead_time: None,
        clear_lead_time: false,
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SetTaskDatesArgs {
    /// The note's exact repository path.
    pub path: String,
    /// The commit message.
    pub message: String,
    /// When work on it starts.
    #[serde(default)]
    pub available_from: Option<String>,
    /// When it should be finished by.
    #[serde(default)]
    pub due_by: Option<String>,
    /// The hard deadline.
    #[serde(default)]
    pub deadline: Option<String>,
    /// When `due_by` rings, as a list: offsets from it (`-1h` before, `+1h` after, in w, d, h, m
    /// or s) or times on its day (`09:00`, `-1d 18:00`). Nothing rings for it unless the config
    /// says so. An empty list silences it; name `due_by_alarms` in `clear` to go back to the
    /// config's.
    #[serde(default)]
    pub due_by_alarms: Option<Vec<String>>,
    /// When `deadline` rings, written as `due_by_alarms` is.
    #[serde(default)]
    pub deadline_alarms: Option<Vec<String>>,
    /// Dates to remove entirely: any of `available_from`, `due_by`, `deadline`;
    /// or `due_by_alarms` or `deadline_alarms`, to remove the alarms set for one.
    #[serde(default)]
    pub clear: Option<Vec<String>>,
}

/// What `clear` may name that is a date of its own.
const DATE_KEYS: [&str; 3] = ["available_from", "due_by", "deadline"];

/// What `clear` may name to remove the alarms set for one date, and the date each is for.
const ALARM_KEYS: [(&str, TaskField); 2] =
    [("due_by_alarms", TaskField::DueBy), ("deadline_alarms", TaskField::Deadline)];

/// Where a task keeps the alarms for one of its dates: `task.alarms.due_by`.
fn alarms_path(date: &str) -> [&str; 3] {
    ["task", "alarms", date]
}

/// The keys under `task.alarms` in a note, as it is now.
fn alarm_keys(text: &str) -> Vec<String> {
    frontmatter::value(text)
        .and_then(|root| root.get("task")?.get("alarms")?.as_mapping().cloned())
        .map(|alarms| alarms.keys().filter_map(|key| key.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

/// What `clear` names: the changes that remove dates, and the dates whose alarms are to go.
fn read_clear(args: &SetTaskDatesArgs) -> Result<(Vec<Change>, Vec<&'static str>), String> {
    let mut removals = Vec::new();
    let mut cleared_alarms = Vec::new();
    for key in args.clear.as_deref().unwrap_or_default() {
        if let Some((_, field)) = ALARM_KEYS.iter().find(|(name, _)| name == key) {
            cleared_alarms.push(field.key());
        }
        else if DATE_KEYS.contains(&key.as_str()) {
            removals.push(Change::remove(&["task", key]));
            if key == "available_from" {
                removals.push(Change::remove(&["task", "start_at"]));
            }
        }
        else {
            let known = DATE_KEYS.into_iter().chain(ALARM_KEYS.map(|(name, _)| name));
            return Err(format!(
                "{key:?} is not a task date. Clear one of: {}.",
                known.collect::<Vec<_>>().join(", "),
            ));
        }
    }
    Ok((removals, cleared_alarms))
}

/// The changes that remove the alarms of `cleared` dates from the note `text`.
///
/// A task whose alarms all go loses `alarms` itself, not just what was under it, which the editor
/// would leave behind as an empty key: setting alarms and clearing them again then leaves the note
/// as it was.
fn alarm_removals(cleared: &[&str], text: &str) -> Vec<Change> {
    if cleared.is_empty() {
        return Vec::new();
    }
    let left = alarm_keys(text).into_iter().any(|key| !cleared.contains(&key.as_str()));
    if left {
        cleared.iter().map(|date| Change::remove(&alarms_path(date))).collect()
    }
    else {
        vec![Change::remove(&["task", "alarms"])]
    }
}

/// The changes that set the alarms `args` gives for a date.
fn alarm_sets(args: &SetTaskDatesArgs) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    for (field, alarms) in [
        (TaskField::DueBy, &args.due_by_alarms),
        (TaskField::Deadline, &args.deadline_alarms),
    ] {
        if let Some(alarms) = alarms {
            changes.push(Change::set(&alarms_path(field.key()), alarm_list(alarms)?));
        }
    }
    Ok(changes)
}

fn validate_task_date(key: &str, value: &str) -> Result<(), String> {
    if crate::urgency::instant(Some(&Value::String(value.to_owned())), crate::urgency::local_zone(), false).is_none() {
        return Err(format!("{key}: use a valid YYYY-MM-DD date or a datetime with its UTC offset."));
    }
    Ok(())
}

/// The changes that set the dates `args` gives.
fn date_sets(args: &SetTaskDatesArgs) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    for (key, value) in [
        ("available_from", &args.available_from),
        ("due_by", &args.due_by),
        ("deadline", &args.deadline),
    ] {
        if let Some(value) = value {
            validate_task_date(key, value)?;
            if key == "available_from" {
                changes.push(Change::remove(&["task", "start_at"]));
            }
            changes.push(Change::set(&["task", key], value.as_str()));
        }
    }
    Ok(changes)
}

/// The changes a `SetTaskDatesArgs` asks for, under `task`, to the note `text`.
///
/// What is cleared goes first, so that a request which clears a date and sets it in the same call
/// ends up setting it.
fn date_changes(args: &SetTaskDatesArgs, text: &str) -> Result<Vec<Change>, String> {
    let (mut changes, cleared_alarms) = read_clear(args)?;
    changes.extend(alarm_removals(&cleared_alarms, text));
    changes.extend(alarm_sets(args)?);
    changes.extend(date_sets(args)?);
    Ok(changes)
}

pub async fn set_task_dates(
    state: &AppState,
    args: SetTaskDatesArgs,
) -> Result<CallToolResult, ErrorData> {
    let path = match safe_path(&args.path).and_then(task_path) {
        Ok(path) => path,
        Err(message) => return Ok(tool_error(message)),
    };
    let Some(note) = note_to_edit(state, &path).await? else {
        return Ok(tool_error(format!("No note at {path:?}.")));
    };

    let changes = match date_changes(&args, &note.0) {
        Ok(changes) => changes,
        Err(message) => return Ok(tool_error(message)),
    };
    if changes.is_empty() {
        return Ok(tool_error(
            "Nothing to change. Pass a date or its alarms to set, or name one in `clear`.",
        ));
    }

    commit_edit(state, &path, &note, &changes, &args.message).await
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
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
    /// Defaults to `backlog`.
    #[serde(default)]
    pub status: Option<String>,
    /// low, medium or high. Omit to leave unrated.
    #[serde(default)]
    pub importance: Option<Importance>,
    /// How long the work needs before its date, in whole days or weeks: `14d`, `2w`. Omit for
    /// the longest `.mory/tasks.yaml` sets for one of its tags, else that file's default, else 7d.
    #[serde(default)]
    pub lead_time: Option<String>,
    /// When it can be started. A bare date, or a datetime carrying its offset.
    #[serde(default)]
    pub available_from: Option<String>,
    /// The soft target, written as `available_from` is.
    #[serde(default)]
    pub due_by: Option<String>,
    /// The hard cutoff, written as `available_from` is.
    #[serde(default)]
    pub deadline: Option<String>,
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
    // A new task carries a status; unrated importance and inherited lead time stay absent.
    let update = UpdateTaskArgs {
        path: String::new(),
        message: String::new(),
        status: Some(args.status.clone().unwrap_or_else(|| NEW_TASK_STATUS.to_owned())),
        waiting_for: args.waiting_for.clone(),
        blocked_by: args.blocked_by.clone(),
        hold_reason: args.hold_reason.clone(),
        cancel_reason: args.cancel_reason.clone(),
        importance: args.importance.clone(),
        lead_time: args.lead_time.clone(),
        ..empty_update()
    };
    let mut changes = match measure_changes(&update) {
        Ok(changes) => changes,
        Err(message) => return Ok(tool_error(message)),
    };
    changes.push(Change::set(&["created_at"], now_local()));
    match status_changes(&update, update.status.as_deref().unwrap_or(NEW_TASK_STATUS), None) {
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
        ("available_from", &args.available_from),
        ("due_by", &args.due_by),
        ("deadline", &args.deadline),
    ] {
        if let Some(value) = value {
            if let Err(error) = validate_task_date(key, value) {
                return Ok(tool_error(error));
            }
            changes.push(Change::set(&["task", key], value.as_str()));
        }
    }
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

    match state.save_note_checked(&path, content.as_bytes(), &args.message, "absent").await {
        Ok(Some(commit)) => json_result(&CreatedTask {
            written: WriteOutput {
                path,
                commit: commit.to_string(),
                message: args.message,
            },
            content,
        }),
        Ok(None) => Ok(tool_error(format!("{path:?} was created while this call was being made."))),
        Err(e) => {
            tracing::error!("MCP create_task failed for {}: {:?}", path, e);
            Ok(tool_error(format!("{path:?} could not be written: {e:#}")))
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changing_availability_removes_the_legacy_fallback() {
        let before = "---\ntask:\n    status: {kind: todo}\n    start_at: 2026-10-15\n---\n# T\n";
        let mut args: SetTaskDatesArgs = serde_json::from_value(serde_json::json!({"path": "unused", "message": "Test", "clear": ["available_from"]})).unwrap();
        let after = frontmatter::apply(before, &date_changes(&args, before).unwrap()).unwrap();
        assert!(!after.contains("start_at"));
        args.available_from = Some("2026-10-16".into());
        let after = frontmatter::apply(before, &date_changes(&args, before).unwrap()).unwrap();
        assert!(!after.contains("start_at"));
        assert!(after.contains("available_from: 2026-10-16"));
    }
    #[test]
    fn task_dates_are_accepted_only_when_urgency_can_read_them() {
        for date in ["2026-02-30", "2026-13-01", "2026-10-15 12:00", ""] {
            assert!(validate_task_date("deadline", date).is_err());
        }
        for date in ["2026-10-15", "2026-10-15 12:00+09:00", "2026-10-15T12:00:00Z"] {
            assert!(validate_task_date("deadline", date).is_ok());
        }
    }

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
        let changes = status_changes(&args("t.md"), "todo", None).expect("todo needs nothing");
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
            let error = status_changes(&args("t.md"), kind, None)
                .expect_err("{kind} should require its companion");
            assert!(error.contains(wanted), "{kind}: {error}");
        }
        // And the three that need nothing.
        assert!(status_changes(&args("t.md"), "backlog", None).is_ok());
        assert!(status_changes(&args("t.md"), "todo", None).is_ok());
        assert!(status_changes(&args("t.md"), "in_progress", None).is_ok());
        assert!(status_changes(&args("t.md"), "procrastinating", None).is_err());
    }

    /// Completing a done task again, or cancelling a canceled one, keeps the record of when and
    /// how, and changes only what is given.
    #[test]
    fn setting_the_status_a_task_has_keeps_its_record() {
        let done = "---\ntask:\n    status:\n        kind: done\n        completed_at: 2020-01-01 10:00:00+09:00\n        completion_note: shipped\n---\n";
        let current = |text: &str| frontmatter::value(text).unwrap()["task"]["status"].as_mapping().cloned();
        let again = status_changes(&args("t.md"), "done", current(done).as_ref()).expect("done again");
        assert_eq!(apply(done, &again), done, "nothing to change");
        let noted = UpdateTaskArgs { completion_note: Some("shipped twice".into()), ..args("t.md") };
        let edited = apply(done, &status_changes(&noted, "done", current(done).as_ref()).unwrap());
        assert_eq!(edited, done.replace("note: shipped", "note: shipped twice"));

        let canceled = "---\ntask:\n    status:\n        kind: canceled\n        canceled_at: 2020-01-01\n        cancel_reason: moot\n---\n";
        assert!(status_changes(&args("t.md"), "canceled", current(canceled).as_ref()).is_ok(), "the reason is kept");
        let at = UpdateTaskArgs { canceled_at: Some("2020-01-02".into()), ..args("t.md") };
        assert_eq!(apply(canceled, &status_changes(&at, "canceled", current(canceled).as_ref()).unwrap()), canceled.replace("2020-01-01", "2020-01-02"));
        // Another kind still starts afresh.
        let reopened = apply(done, &status_changes(&args("t.md"), "todo", current(done).as_ref()).unwrap());
        assert!(!reopened.contains("completed_at"), "{reopened}");
    }

    #[test]
    fn a_task_tool_edits_only_the_task_tree() {
        let uuid = "4955857d-3267-4b94-83f2-538a428970d7";
        assert!(task_path(format!(".tasks/report-{uuid}.md")).is_ok());
        assert!(task_path(format!(".tasks/{uuid}/{uuid}.md")).is_ok());
        for outside in [format!("notes/{uuid}.md"), "ideas.md".to_owned(), ".tasks/report.md".to_owned()] {
            assert!(task_path(outside.clone()).unwrap_err().contains("task tree"), "{outside}");
        }
    }

    /// The status's own dates follow the notes' convention, as the arguments describe them.
    #[test]
    fn a_status_date_is_a_date_or_a_datetime_carrying_its_offset() {
        for (kind, bad) in [
            ("done", UpdateTaskArgs { completed_at: Some("yesterday-ish".into()), ..args("t.md") }),
            ("done", UpdateTaskArgs { completed_at: Some("2026-03-15 18:17".into()), ..args("t.md") }),
            ("canceled", UpdateTaskArgs { canceled_at: Some("2026-02-30".into()), cancel_reason: Some("moot".into()), ..args("t.md") }),
            ("waiting", UpdateTaskArgs { waiting_for: Some("a reply".into()), follow_up_at: Some("next week".into()), ..args("t.md") }),
            ("on_hold", UpdateTaskArgs { hold_reason: Some("later".into()), review_at: Some("soon".into()), ..args("t.md") }),
        ] {
            assert!(status_changes(&bad, kind, None).is_err(), "{kind}");
        }
        let good = UpdateTaskArgs { waiting_for: Some("a reply".into()), expected_by: Some("2026-03-15".into()), follow_up_at: Some("2026-03-16 09:00:00+09:00".into()), ..args("t.md") };
        assert!(status_changes(&good, "waiting", None).is_ok());
    }

    #[test]
    fn done_and_canceled_stamp_themselves_when_no_time_is_given() {
        let changes = status_changes(&args("t.md"), "done", None).expect("done defaults its time");
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
    fn legacy_arguments_are_refused_and_named_importance_is_checked() {
        for (key, value) in [("urgency", serde_json::json!(3)), ("progress", serde_json::json!(50)), ("scheduled_dates", serde_json::json!([])), ("start_at", serde_json::json!("2026-10-01"))] {
            let mut args = serde_json::json!({ "title": "T", "message": "create" });
            args[key] = value;
            assert!(serde_json::from_value::<CreateTaskArgs>(args).is_err(), "accepted {key}");
        }
        assert!(serde_json::from_value::<CreateTaskArgs>(serde_json::json!({"title":"T", "message":"m", "importance":3})).is_err());
        let mut a = args("t.md");
        a.importance = Some(Importance::High);
        assert!(apply(TASK, &measure_changes(&a).unwrap()).contains("importance: high"));
        a.lead_time = Some("-2w".into());
        assert!(measure_changes(&a).is_err());
    }

    fn dates(json: serde_json::Value) -> SetTaskDatesArgs {
        let mut args = json;
        args["path"] = "t.md".into();
        args["message"] = "m".into();
        serde_json::from_value(args).expect("valid arguments")
    }

    fn alarms_of(note: &str) -> serde_yaml::Value {
        frontmatter::value(note).expect("valid YAML")["task"]["alarms"].clone()
    }

    fn yaml(text: &str) -> serde_yaml::Value {
        serde_yaml::from_str(text).unwrap()
    }

    /// The alarms of a date are a mapping under `task`, which a task written before alarms existed
    /// does not have.
    #[test]
    fn the_alarms_of_a_date_are_written_under_task_alarms() {
        let args = dates(serde_json::json!({
            "due_by_alarms": ["09:00"],
            "deadline_alarms": ["-1d 18:00", "-2h"],
        }));
        let edited = apply(TASK, &date_changes(&args, TASK).expect("valid changes"));
        assert!(edited.contains("    alarms:\n"), "{edited}");
        assert_eq!(alarms_of(&edited), yaml("{ due_by: ['09:00'], deadline: ['-1d 18:00', '-2h'] }"));
        // Everything else about the task is where it was.
        assert!(edited.contains("        waiting_for: a reply\n"));
        assert!(edited.contains("    scheduled_dates: []\n"));
    }

    #[test]
    fn the_alarms_of_a_date_can_silence_it_or_be_cleared() {
        let silenced = apply(TASK, &date_changes(&dates(serde_json::json!({ "due_by_alarms": [] })), TASK).unwrap());
        assert_eq!(alarms_of(&silenced), yaml("{ due_by: [] }"));

        // The only one goes with `alarms` itself, so the note is as it was before there were any.
        let clear = |what: &str| dates(serde_json::json!({ "clear": [what] }));
        let cleared = apply(&silenced, &date_changes(&clear("due_by_alarms"), &silenced).unwrap());
        assert_eq!(cleared, TASK);

        // With another left, only its own goes.
        let both = apply(
            TASK,
            &date_changes(&dates(serde_json::json!({ "due_by_alarms": ["09:00"], "deadline_alarms": [] })), TASK).unwrap(),
        );
        let cleared = apply(&both, &date_changes(&clear("due_by_alarms"), &both).unwrap());
        assert_eq!(alarms_of(&cleared), yaml("{ deadline: [] }"));
        let cleared = apply(
            &both,
            &date_changes(&dates(serde_json::json!({ "clear": ["due_by_alarms", "deadline_alarms"] })), &both).unwrap(),
        );
        assert_eq!(cleared, TASK);

        // A note with none has nothing to clear, and clearing a date does not name its alarms.
        assert!(date_changes(&clear("due_by_alarms"), TASK).is_ok());
        assert!(date_changes(&clear("due_by"), TASK).is_ok());
        assert!(date_changes(&clear("alarms"), TASK).is_err());
    }

    /// A request that clears a date and sets it in the same call means to set it, so what it
    /// clears is removed before what it sets is written, whichever of the two comes first in the
    /// arguments. The note has to hold them already: the editor drops a removal of what is not
    /// there before it starts.
    #[test]
    fn what_a_request_clears_goes_before_what_it_sets() {
        let had = apply(
            TASK,
            &date_changes(&dates(serde_json::json!({ "due_by": "2026-09-01", "deadline_alarms": ["-2h"] })), TASK)
                .expect("valid changes"),
        );
        let args = dates(serde_json::json!({
            "due_by": "2026-10-01",
            "deadline_alarms": ["-1h"],
            "clear": ["due_by", "deadline_alarms"],
        }));
        let edited = apply(&had, &date_changes(&args, &had).expect("valid changes"));
        assert!(edited.contains("    due_by: 2026-10-01\n"), "{edited}");
        assert_eq!(alarms_of(&edited), yaml("{ deadline: ['-1h'] }"));
    }

    #[test]
    fn an_alarm_that_is_not_one_is_refused_for_a_date_as_for_an_event() {
        let error = date_changes(&dates(serde_json::json!({ "deadline_alarms": ["2h"] })), TASK)
            .expect_err("a sign is required");
        assert!(error.contains("needs a sign"), "{error}");
    }

}
