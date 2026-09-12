//! The tools themselves, kept apart from the router so each one reads as what it does.

use rmcp::{model::CallToolResult, ErrorData};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{json_result, tool_error};
use crate::models::AppState;
use crate::search::{run_search, validate_search_request, SearchRequest};

/// The largest note this will return in one call.
///
/// Notes are prose and nothing like this large, but the repository also holds images and the
/// occasional generated file, and a tool must not be able to spend a whole context window by
/// being pointed at one.
const MAX_NOTE_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchArgs {
    /// The query. Bare words match anywhere; `path:`, `title:` and `body:` restrict a term;
    /// `+` requires and `-` excludes; `"a phrase"` matches words in order.
    pub query: String,
    /// `text` (default), `semantic`, `hybrid`, or `grep`.
    #[serde(default)]
    pub mode: Option<String>,
    /// How many results to return, 1 to 100. Defaults to 20.
    #[serde(default)]
    pub limit: Option<usize>,
}

/// One result, trimmed to what a model actually uses.
///
/// The full HTTP response carries index status, blob and passage identities and per-source
/// scores; none of that helps a model decide what to read next, and all of it costs tokens.
#[derive(Debug, Serialize)]
struct Hit {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end_line: Option<usize>,
    snippet: String,
}

#[derive(Debug, Serialize)]
struct SearchOutput {
    /// Which modes actually ran. It can differ from what was asked for -- a hybrid search on a
    /// server without embeddings runs text only -- and `warnings` says why.
    executed_modes: Vec<String>,
    /// The commit the results describe, so a caller can tell two searches apart.
    commit: String,
    hits: Vec<Hit>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    warnings: Vec<String>,
}

pub async fn search_notes(
    state: &AppState,
    args: SearchArgs,
) -> Result<CallToolResult, ErrorData> {
    let mode = match args.mode.as_deref().unwrap_or("text") {
        "text" => crate::search::query::SearchMode::Text,
        "semantic" => crate::search::query::SearchMode::Semantic,
        "hybrid" => crate::search::query::SearchMode::Hybrid,
        "grep" => crate::search::query::SearchMode::Grep,
        other => {
            return Ok(tool_error(format!(
                "{other:?} is not a search mode. Use text, semantic, hybrid or grep.",
            )))
        },
    };

    let request = SearchRequest {
        query: args.query,
        mode,
        limit: args.limit.unwrap_or(20),
    };
    // The same bounds the HTTP endpoint applies, reported as something the model can correct
    // rather than as a server fault.
    if let Err(failure) = validate_search_request(&request) {
        return Ok(tool_error(failure.message));
    }

    match run_search(state, request).await {
        Ok(response) => json_result(&SearchOutput {
            executed_modes: response
                .executed_modes
                .iter()
                .map(|mode| format!("{mode:?}").to_lowercase())
                .collect(),
            commit: response.commit,
            hits: response
                .hits
                .into_iter()
                .map(|hit| Hit {
                    path: hit.path,
                    title: hit.title,
                    start_line: hit.start_line,
                    end_line: hit.end_line,
                    snippet: hit.snippet,
                })
                .collect(),
            warnings: response
                .warnings
                .into_iter()
                .map(|warning| warning.message)
                .collect(),
        }),
        // A busy index or a malformed query is the caller's to retry or rephrase, so it is a
        // tool-level error carrying the same stable code the HTTP API returns.
        Err(failure) => Ok(tool_error(format!("{} ({})", failure.message, failure.code))),
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReadArgs {
    /// The exact repository path, as a search result reported it: `notes/thing-<uuid>.md`.
    pub path: String,
}

#[derive(Debug, Serialize)]
struct ReadOutput {
    path: String,
    content: String,
    /// Present only when the note was longer than this tool will return in one call.
    #[serde(skip_serializing_if = "Option::is_none")]
    truncated_at_bytes: Option<usize>,
}

pub async fn read_note(state: &AppState, args: ReadArgs) -> Result<CallToolResult, ErrorData> {
    let path = args.path.trim().trim_start_matches('/');
    if path.is_empty() {
        return Ok(tool_error("A path is required."));
    }

    let Some((_, bytes)) = crate::find_entry_blob(state, path).await else {
        return Ok(tool_error(format!(
            "No file at {path:?}. Paths are exact and relative to the repository root; \
             use search_notes to find one.",
        )));
    };

    // Reading an image as text would produce a page of replacement characters and teach the
    // model nothing, so say what the file is instead.
    let mime = crate::guess_mime_from_path(path);
    if mime.starts_with("image/") || mime.starts_with("video/") || mime.starts_with("audio/") {
        return Ok(tool_error(format!(
            "{path:?} is {mime}, not text. This tool reads notes.",
        )));
    }

    let truncated = bytes.len() > MAX_NOTE_BYTES;
    let content = match std::str::from_utf8(&bytes) {
        Ok(text) if !truncated => text.to_owned(),
        // Truncating mid-character is what `from_utf8_lossy` is for; the boundary is arbitrary
        // anyway and one replacement character at the very end costs nothing.
        Ok(text) => text.chars().take(MAX_NOTE_BYTES).collect(),
        Err(_) => {
            return Ok(tool_error(format!(
                "{path:?} is not UTF-8 text, so it cannot be read as a note.",
            )))
        },
    };

    json_result(&ReadOutput {
        path: path.to_owned(),
        content,
        truncated_at_bytes: truncated.then_some(MAX_NOTE_BYTES),
    })
}

// ---------------------------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------------------------

/// The default and maximum page for every listing tool.
///
/// The repository holds roughly 1,600 entries. Handing a model all of them costs a large part of
/// a context window and tells it almost nothing, so a page is the only shape offered.
const DEFAULT_PAGE: usize = 50;
const MAX_PAGE: usize = 500;

fn page_size(requested: Option<usize>) -> usize {
    requested.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE)
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListNotesArgs {
    /// Only paths starting with this, e.g. `.tasks/` or `projects/`. Omit for the whole
    /// repository.
    #[serde(default)]
    pub path_prefix: Option<String>,
    /// How many to return, 1 to 500. Defaults to 50.
    #[serde(default)]
    pub limit: Option<usize>,
    /// How many to skip. Pass the `next_offset` of the previous call to continue.
    #[serde(default)]
    pub offset: Option<usize>,
}

#[derive(Debug, Serialize)]
struct NoteSummary {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    /// Last modified, as Git attributes it.
    modified: String,
    size: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tags: Vec<String>,
    /// Present when the note carries a `task:` block, so a listing says which notes are tasks
    /// without a second call.
    #[serde(skip_serializing_if = "Option::is_none")]
    task_status: Option<String>,
}

#[derive(Debug, Serialize)]
struct ListOutput<T> {
    commit: String,
    total: usize,
    items: Vec<T>,
    /// Absent when this page was the last.
    #[serde(skip_serializing_if = "Option::is_none")]
    next_offset: Option<usize>,
}

/// The `tags:` list, ignoring anything that is not a list of strings.
///
/// Frontmatter is whatever the file said, so a malformed value means "no tags here" rather than
/// an error that would lose the other 1,599 entries.
fn tags_of(metadata: Option<&serde_yaml::Value>) -> Vec<String> {
    metadata
        .and_then(|value| value.get("tags"))
        .and_then(|tags| tags.as_sequence())
        .map(|tags| {
            tags.iter()
                .filter_map(|tag| tag.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// The `task.status.kind` of a note, when it has one.
fn task_status_of(metadata: Option<&serde_yaml::Value>) -> Option<String> {
    metadata?
        .get("task")?
        .get("status")?
        .get("kind")?
        .as_str()
        .map(str::to_owned)
}

fn summarize(entry: &crate::models::ListEntry) -> NoteSummary {
    NoteSummary {
        path: entry.path.to_string_lossy().into_owned(),
        title: entry.title.clone(),
        modified: entry.time.to_rfc3339(),
        size: entry.size,
        tags: tags_of(entry.metadata.as_ref()),
        task_status: task_status_of(entry.metadata.as_ref()),
    }
}

pub async fn list_notes(
    state: &AppState,
    args: ListNotesArgs,
) -> Result<CallToolResult, ErrorData> {
    let (commit, mut entries) = match state.get_entries(None).await {
        Ok(listing) => listing,
        Err(e) => {
            tracing::error!("MCP list_notes could not read the listing: {:?}", e);
            return Err(ErrorData::internal_error(
                "the note listing could not be read".to_owned(),
                None,
            ));
        },
    };

    if let Some(prefix) = args.path_prefix.as_deref().map(|p| p.trim_start_matches('/')) {
        entries.retain(|entry| entry.path.to_string_lossy().starts_with(prefix));
    }
    // Newest first: a model asking "what is here" almost always wants what was touched last.
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.time));

    let total = entries.len();
    let offset = args.offset.unwrap_or(0).min(total);
    let limit = page_size(args.limit);
    let items = entries[offset..].iter().take(limit).map(summarize).collect::<Vec<_>>();
    let next_offset = (offset + items.len() < total).then_some(offset + items.len());

    json_result(&ListOutput { commit: commit.to_string(), total, items, next_offset })
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListTasksArgs {
    /// Only tasks in this state: `todo`, `in_progress`, `waiting`, `blocked`, `on_hold`, `done`
    /// or `canceled`. Omit for every state.
    #[serde(default)]
    pub status: Option<String>,
    /// Only tasks carrying this tag.
    #[serde(default)]
    pub tag: Option<String>,
    /// How many to return, 1 to 500. Defaults to 50.
    #[serde(default)]
    pub limit: Option<usize>,
    /// How many to skip. Pass the `next_offset` of the previous call to continue.
    #[serde(default)]
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
struct TaskSummary {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    /// The `task:` block exactly as the file declares it, not a re-derived view of it.
    task: serde_json::Value,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tags: Vec<String>,
}

const TASK_STATUSES: [&str; 7] = [
    "todo", "in_progress", "waiting", "blocked", "on_hold", "done", "canceled",
];

pub async fn list_tasks(
    state: &AppState,
    args: ListTasksArgs,
) -> Result<CallToolResult, ErrorData> {
    if let Some(status) = args.status.as_deref() {
        if !TASK_STATUSES.contains(&status) {
            return Ok(tool_error(format!(
                "{status:?} is not a task status. Use one of: {}.",
                TASK_STATUSES.join(", "),
            )));
        }
    }

    let (commit, entries) = match state.get_entries(Some(".tasks/*")).await {
        Ok(listing) => listing,
        Err(e) => {
            tracing::error!("MCP list_tasks could not read the listing: {:?}", e);
            return Err(ErrorData::internal_error(
                "the task listing could not be read".to_owned(),
                None,
            ));
        },
    };

    let mut tasks = Vec::new();
    for entry in &entries {
        let Some(block) = entry.metadata.as_ref().and_then(|value| value.get("task")) else {
            continue;
        };
        // A note whose `task:` is malformed is skipped rather than failing the call, for the same
        // reason the calendar does it: frontmatter is whatever the file said.
        let Ok(task) = serde_json::to_value(block) else {
            tracing::debug!("Skipping an unreadable task block in {}", entry.path.display());
            continue;
        };
        if let Some(wanted) = args.status.as_deref() {
            if task_status_of(entry.metadata.as_ref()).as_deref() != Some(wanted) {
                continue;
            }
        }
        let tags = tags_of(entry.metadata.as_ref());
        if let Some(wanted) = args.tag.as_deref() {
            if !tags.iter().any(|tag| tag == wanted) {
                continue;
            }
        }
        tasks.push((
            entry.time,
            TaskSummary {
                path: entry.path.to_string_lossy().into_owned(),
                title: entry.title.clone(),
                task,
                tags,
            },
        ));
    }

    tasks.sort_by_key(|(time, _)| std::cmp::Reverse(*time));
    let total = tasks.len();
    let offset = args.offset.unwrap_or(0).min(total);
    let limit = page_size(args.limit);
    let items = tasks[offset..]
        .iter()
        .take(limit)
        .map(|(_, task)| task)
        .cloned()
        .collect::<Vec<_>>();
    let next_offset = (offset + items.len() < total).then_some(offset + items.len());

    json_result(&ListOutput { commit: commit.to_string(), total, items, next_offset })
}

// ---------------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize, JsonSchema)]
pub struct WindowArgs {
    /// The first day of the window, `YYYY-MM-DD`.
    pub start: String,
    /// The last day of the window, `YYYY-MM-DD`.
    pub end: String,
}

/// The `YYYY-MM-DD` every event value begins with, whatever else it carries.
///
/// Filtering on the date rather than the instant means an event within a few hours of a window
/// edge can fall on the wrong side of it. That is the honest resolution available here: the
/// window itself is given in bare dates, and taking offsets into account would imply a precision
/// the request does not have.
fn leading_date(value: &str) -> Option<chrono::NaiveDate> {
    let trimmed = value.trim();
    let head = trimmed.get(..10)?;
    chrono::NaiveDate::parse_from_str(head, "%Y-%m-%d").ok()
}

#[derive(Debug, Serialize)]
struct EventSummary {
    path: String,
    /// The key this event has in the note's `events:` map.
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    note_title: Option<String>,
    /// The declared occurrence starts that fall inside the window.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    occurrences_in_window: Vec<String>,
    /// True when this event carries a `repeat` rule, whose occurrences are *not* expanded here.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    recurs: bool,
    /// The `events:` entry exactly as the note declares it.
    declaration: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct EventsOutput {
    commit: String,
    window: (String, String),
    events: Vec<EventSummary>,
    /// Said once per call rather than trusted to the tool description, because a recurring event
    /// listed without occurrences is exactly the result a model would otherwise misread.
    note: &'static str,
}

/// Every occurrence start an event declares outright: its own `start`, and each entry of
/// `instances` (or its older spelling `times`).
///
/// What a `repeat` rule generates is deliberately not computed. Two expanders already exist --
/// `backend/src/ical.rs` for feeds and `frontend/src/recurrence.ts` for notes -- and they passed
/// their own tests for a long time while disagreeing about nearly every real feed. A third one
/// here, with nothing comparing it to the frontend, would be a disagreement nobody could see.
fn declared_starts(event: &serde_yaml::Value) -> Vec<String> {
    let mut starts = Vec::new();
    if let Some(start) = event.get("start").and_then(|v| v.as_str()) {
        starts.push(start.to_owned());
    }
    for key in ["instances", "times"] {
        let Some(list) = event.get(key).and_then(|v| v.as_sequence()) else {
            continue;
        };
        starts.extend(
            list.iter()
                .filter_map(|instance| instance.get("start")?.as_str())
                .map(str::to_owned),
        );
    }
    starts
}

pub async fn list_events(
    state: &AppState,
    args: WindowArgs,
) -> Result<CallToolResult, ErrorData> {
    let (Some(from), Some(to)) = (leading_date(&args.start), leading_date(&args.end)) else {
        return Ok(tool_error("start and end must both be dates, as YYYY-MM-DD."));
    };
    if to < from {
        return Ok(tool_error("The window ends before it starts."));
    }

    let (commit, entries) = match state.get_entries(None).await {
        Ok(listing) => listing,
        Err(e) => {
            tracing::error!("MCP list_events could not read the listing: {:?}", e);
            return Err(ErrorData::internal_error(
                "the note listing could not be read".to_owned(),
                None,
            ));
        },
    };

    let mut events = Vec::new();
    for entry in &entries {
        // `events:` is very often null in a real note; a missing or unusable block is simply a
        // note with no events, never an error that would lose the rest of the calendar.
        let Some(declared) = entry
            .metadata
            .as_ref()
            .and_then(|value| value.get("events"))
            .and_then(|value| value.as_mapping())
        else {
            continue;
        };

        for (name, event) in declared {
            let Some(name) = name.as_str() else {
                continue;
            };
            let recurs = event.get("repeat").is_some_and(|value| !value.is_null());
            let occurrences_in_window = declared_starts(event)
                .into_iter()
                .filter(|start| {
                    leading_date(start).is_some_and(|date| from <= date && date <= to)
                })
                .collect::<Vec<_>>();
            // A recurring event is always listed: nothing here knows which of its occurrences
            // fall in the window, so leaving it out would be a claim this cannot make.
            if !recurs && occurrences_in_window.is_empty() {
                continue;
            }
            let Ok(declaration) = serde_json::to_value(event) else {
                tracing::debug!("Skipping an unreadable event in {}", entry.path.display());
                continue;
            };
            events.push(EventSummary {
                path: entry.path.to_string_lossy().into_owned(),
                name: name.to_owned(),
                note_title: entry.title.clone(),
                occurrences_in_window,
                recurs,
                declaration,
            });
        }
    }

    events.sort_by(|a, b| {
        a.occurrences_in_window
            .first()
            .cmp(&b.occurrences_in_window.first())
            .then_with(|| a.path.cmp(&b.path))
            .then_with(|| a.name.cmp(&b.name))
    });

    json_result(&EventsOutput {
        commit: commit.to_string(),
        window: (from.to_string(), to.to_string()),
        events,
        note: "Events marked `recurs` carry a repeat rule whose occurrences are not expanded \
               here; read `declaration.repeat` and work out the dates from it. Every other event \
               is listed only when a declared occurrence falls inside the window.",
    })
}

pub async fn list_imported_events(
    state: &AppState,
    args: WindowArgs,
) -> Result<CallToolResult, ErrorData> {
    let (from, to) = match crate::ical::parse_window(&args.start, &args.end) {
        Ok(window) => window,
        Err(e) => return Ok(tool_error(format!("{e:#}"))),
    };

    match crate::v2::imported_events(state, from, to).await {
        Ok(response) => json_result(&response),
        Err(e) => {
            tracing::error!("MCP list_imported_events failed: {:?}", e);
            Ok(tool_error(format!(
                "The subscribed calendars could not be read: {e:#}",
            )))
        },
    }
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/// 600 KB of legacy YAML held together by anchors and aliases (`&a1` / `*a1`), which a naive
/// parse-and-serialize round-trip silently expands into independent copies. Nothing here writes
/// it; it is readable through `read_note` like any other file.
const READ_ONLY_PATHS: [&str; 1] = [".mory/tasks.yaml"];

/// Where the task tree's naming rules apply.
///
/// `entries_to_tree` derives the forest from the paths, so a file here named outside the
/// convention makes the whole task tree unbuildable for the web app.
const TASKS_DIR: &str = ".tasks/";

/// Check a path a tool was asked to touch, and return it in its canonical spelling.
///
/// Traversal is refused rather than normalised away: a caller that wrote `../` meant something,
/// and quietly writing somewhere else would be worse than saying no.
pub fn safe_path(path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("A path is required.".to_owned());
    }
    if path.starts_with('/') {
        return Err(format!(
            "{path:?} is absolute. Paths are relative to the repository root.",
        ));
    }
    if path.contains('\\') {
        return Err(format!("{path:?} must use / as its separator."));
    }
    for component in path.split('/') {
        if component.is_empty() {
            return Err(format!("{path:?} has an empty path component."));
        }
        if component == "." || component == ".." {
            return Err(format!("{path:?} must not contain . or .. components."));
        }
    }
    if path.contains('\0') {
        return Err(format!("{path:?} contains a null byte."));
    }
    if READ_ONLY_PATHS.contains(&path) {
        return Err(format!(
            "{path:?} is read-only through MCP. It is legacy YAML using anchors and aliases \
             that a rewrite would silently expand into independent copies.",
        ));
    }
    Ok(path.to_owned())
}

/// `safe_path`, plus the naming rules for a path content is about to *land* on.
///
/// Only destinations are held to this. A file already named outside the convention has already
/// broken the task tree, and the tools that would repair it -- renaming it to a conforming name,
/// or deleting it -- must not be the ones refused.
pub fn writable_path(path: &str) -> Result<String, String> {
    let path = safe_path(path)?;
    if let Some(rest) = path.strip_prefix(TASKS_DIR) {
        check_tree_naming(rest)?;
    }
    Ok(path)
}

/// The naming `entries_to_tree` needs: every directory component a bare UUIDv4, and the file
/// stem ending in one, optionally after a readable prefix.
fn check_tree_naming(rest: &str) -> Result<(), String> {
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
    if stem.len() < 36 || !is_uuid_v4(&stem[stem.len() - 36..]) {
        return Err(format!("The file name {file:?} does not end with a UUIDv4. {advice}"));
    }
    Ok(())
}

fn is_uuid_v4(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .is_ok_and(|parsed| parsed.get_version() == Some(uuid::Version::Random))
}

#[derive(Debug, Serialize)]
pub struct WriteOutput {
    pub path: String,
    /// The commit this write made, so a caller can point at it afterwards.
    pub commit: String,
    pub message: String,
}

/// A note's text at HEAD, or `None` when there is no such file.
///
/// Non-UTF-8 is an `Err`, not a `None`: it is a real failure of an operation that named an
/// existing path, and the difference matters to the caller.
pub async fn note_text(state: &AppState, path: &str) -> Result<Option<String>, ErrorData> {
    let Some((_, bytes)) = crate::find_entry_blob(state, path).await else {
        return Ok(None);
    };
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| ErrorData::invalid_params(format!("{path} is not UTF-8 text"), None))
}

/// Commit an edited note and report where it landed.
pub async fn write_note(
    state: &AppState,
    path: &str,
    content: &str,
    message: &str,
) -> Result<CallToolResult, ErrorData> {
    match state.save_note(path, content.as_bytes(), message).await {
        Ok(commit) => json_result(&WriteOutput {
            path: path.to_owned(),
            commit: commit.to_string(),
            message: message.to_owned(),
        }),
        Err(e) => {
            tracing::error!("MCP could not write {}: {:?}", path, e);
            Ok(tool_error(format!("{path:?} could not be written: {e:#}")))
        },
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateNoteArgs {
    /// The full Markdown source, YAML frontmatter included.
    pub content: String,
    /// The commit message. Say what changed and why.
    pub message: String,
    /// Where to put it. Omit for `<uuid>.md` at the repository root, which is what the web app
    /// does. A path under `.tasks/` must follow the UUID naming the task tree is built from.
    #[serde(default)]
    pub path: Option<String>,
}

pub async fn create_note(
    state: &AppState,
    args: CreateNoteArgs,
) -> Result<CallToolResult, ErrorData> {
    // UUIDv4 rather than v7, matching the frontend's `crypto.randomUUID()`: `entries_to_tree`
    // rejects every other version, so a v7 name would break the tree it appears in.
    let path = match args.path {
        Some(path) => match writable_path(&path) {
            Ok(path) => path,
            Err(message) => return Ok(tool_error(message)),
        },
        None => format!("{}.md", uuid::Uuid::new_v4()),
    };

    // Creating over an existing note would be a silent overwrite; update_note is the tool that
    // says it is replacing something.
    if crate::find_entry_blob(state, &path).await.is_some() {
        return Ok(tool_error(format!(
            "{path:?} already exists. Use update_note to replace its content.",
        )));
    }

    match state.save_note(&path, args.content.as_bytes(), &args.message).await {
        Ok(commit) => json_result(&WriteOutput {
            path,
            commit: commit.to_string(),
            message: args.message,
        }),
        Err(e) => {
            tracing::error!("MCP create_note failed for {}: {:?}", path, e);
            Ok(tool_error(format!("{path:?} could not be written: {e:#}")))
        },
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateNoteArgs {
    /// The exact repository path of the note to replace.
    pub path: String,
    /// The full Markdown source that replaces it, frontmatter included. This is not a patch:
    /// read the note first and send back the whole file.
    pub content: String,
    /// The commit message. Say what changed and why.
    pub message: String,
}

pub async fn update_note(
    state: &AppState,
    args: UpdateNoteArgs,
) -> Result<CallToolResult, ErrorData> {
    // `safe_path`, not `writable_path`: the name is already whatever it is, and refusing to edit
    // the content of a badly-named note would help nobody.
    let path = match safe_path(&args.path) {
        Ok(path) => path,
        Err(message) => return Ok(tool_error(message)),
    };
    if crate::find_entry_blob(state, &path).await.is_none() {
        return Ok(tool_error(format!(
            "No file at {path:?}. Use create_note to make one, or search_notes to find the path.",
        )));
    }

    match state.save_note(&path, args.content.as_bytes(), &args.message).await {
        Ok(commit) => json_result(&WriteOutput {
            path,
            commit: commit.to_string(),
            message: args.message,
        }),
        Err(e) => {
            tracing::error!("MCP update_note failed for {}: {:?}", path, e);
            Ok(tool_error(format!("{path:?} could not be written: {e:#}")))
        },
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeleteNoteArgs {
    /// The exact repository path of the note to delete.
    pub path: String,
    /// The commit message. Say why it went.
    pub message: String,
}

pub async fn delete_note(
    state: &AppState,
    args: DeleteNoteArgs,
) -> Result<CallToolResult, ErrorData> {
    // Deleting a file named outside the convention is one of the two ways to repair a broken
    // task tree, so the naming rules must not stand in its way.
    let path = match safe_path(&args.path) {
        Ok(path) => path,
        Err(message) => return Ok(tool_error(message)),
    };

    match state.delete_note(&path, &args.message).await {
        Ok(Some(commit)) => json_result(&WriteOutput {
            path,
            commit: commit.to_string(),
            message: args.message,
        }),
        Ok(None) => Ok(tool_error(format!("No file at {path:?}, so nothing was deleted."))),
        Err(e) => {
            tracing::error!("MCP delete_note failed for {}: {:?}", path, e);
            Ok(tool_error(format!("{path:?} could not be deleted: {e:#}")))
        },
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RenameNoteArgs {
    /// The note's current repository path.
    pub from: String,
    /// Where it should be. A path under `.tasks/` must keep the UUID naming the task tree is
    /// built from, so renaming a task usually means changing only the readable prefix.
    pub to: String,
    /// The commit message. Omit for "Rename <from> to <to>", which is what the web app writes.
    #[serde(default)]
    pub message: Option<String>,
}

pub async fn rename_note(
    state: &AppState,
    args: RenameNoteArgs,
) -> Result<CallToolResult, ErrorData> {
    // The source is only checked for safety -- renaming a badly-named task into a conforming
    // name is the other way to repair a broken tree -- but it is still checked, because renaming
    // *out of* a read-only path removes it just as surely as deleting it. The destination is
    // where content lands, so it gets the full rules.
    let (from, to) = match (safe_path(&args.from), writable_path(&args.to)) {
        (Ok(from), Ok(to)) => (from, to),
        (Err(message), _) | (_, Err(message)) => return Ok(tool_error(message)),
    };
    if from == to {
        return Ok(tool_error("The source and destination are the same path."));
    }
    if crate::find_entry_blob(state, &to).await.is_some() {
        return Ok(tool_error(format!("{to:?} already exists.")));
    }

    let message = args
        .message
        .unwrap_or_else(|| format!("Rename {from} to {to}"));
    match state.rename_note(&from, &to, &message).await {
        Ok(Some(commit)) => json_result(&WriteOutput {
            path: to,
            commit: commit.to_string(),
            message,
        }),
        Ok(None) => Ok(tool_error(format!("No file at {from:?}, so nothing was renamed."))),
        Err(e) => {
            tracing::error!("MCP rename_note failed for {} -> {}: {:?}", from, to, e);
            Ok(tool_error(format!("{from:?} could not be renamed: {e:#}")))
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn yaml(text: &str) -> serde_yaml::Value {
        serde_yaml::from_str(text).expect("the fixture should be YAML")
    }

    /// Frontmatter is whatever the file said, so every one of these has to be a shrug rather than
    /// an error that would lose the other 1,599 entries.
    #[test]
    fn a_malformed_tags_value_reads_as_no_tags() {
        assert_eq!(tags_of(Some(&yaml("tags: [a, b]"))), vec!["a", "b"]);
        assert_eq!(tags_of(Some(&yaml("tags:"))), Vec::<String>::new());
        assert_eq!(tags_of(Some(&yaml("tags: a string"))), Vec::<String>::new());
        assert_eq!(tags_of(Some(&yaml("tags: [1, a, true]"))), vec!["a"]);
        assert_eq!(tags_of(Some(&yaml("other: 1"))), Vec::<String>::new());
        assert_eq!(tags_of(None), Vec::<String>::new());
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
    fn a_leading_date_is_read_from_every_spelling_an_event_uses() {
        let date = |y, m, d| chrono::NaiveDate::from_ymd_opt(y, m, d);
        assert_eq!(leading_date("2026-03-12"), date(2026, 3, 12));
        assert_eq!(leading_date("2026-03-12 19:00"), date(2026, 3, 12));
        assert_eq!(leading_date("2026-03-12 19:00:00+09:00"), date(2026, 3, 12));
        assert_eq!(leading_date("  2026-03-12T19:00:00Z "), date(2026, 3, 12));

        assert_eq!(leading_date("tomorrow"), None);
        assert_eq!(leading_date("2026-13-01"), None);
        assert_eq!(leading_date("2026-03"), None);
        // Slicing ten bytes must not split a character.
        assert_eq!(leading_date("日本語日本語日本語日本語"), None);
    }

    #[test]
    fn declared_starts_collects_the_base_and_both_spellings_of_instances() {
        assert_eq!(
            declared_starts(&yaml("start: 2026-03-12 19:00")),
            vec!["2026-03-12 19:00"],
        );
        assert_eq!(
            declared_starts(&yaml(
                "start: 2026-01-01\n\
                 instances:\n  - start: 2026-02-01\n\
                 times:\n  - start: 2026-03-01",
            )),
            vec!["2026-01-01", "2026-02-01", "2026-03-01"],
        );
        // An instance with no start of its own declares nothing this can filter on.
        assert_eq!(
            declared_starts(&yaml("instances:\n  - at: 2026-02-01\n    color: red")),
            Vec::<String>::new(),
        );
        assert_eq!(
            declared_starts(&yaml("repeat:\n  freq: weekly")),
            Vec::<String>::new(),
        );
    }

    #[test]
    fn a_path_that_escapes_the_repository_is_refused_rather_than_normalised() {
        for bad in [
            "../../etc/passwd",
            "notes/../../etc/passwd",
            "/etc/passwd",
            "./note.md",
            "a//b.md",
            "",
            "   ",
            "windows\\path.md",
        ] {
            assert!(safe_path(bad).is_err(), "accepted {bad:?}");
        }
        assert_eq!(safe_path("  notes/a.md  ").as_deref(), Ok("notes/a.md"));
        // A name that merely *contains* dots is fine; only whole components are traversal.
        assert_eq!(safe_path("..hidden.md").as_deref(), Ok("..hidden.md"));
    }

    #[test]
    fn the_legacy_task_yaml_is_read_only() {
        assert!(safe_path(".mory/tasks.yaml").is_err());
        // Its neighbours are not.
        assert!(safe_path(".mory/calendars.yaml").is_ok());
    }

    /// The task tree is derived from the paths, so a name outside the convention makes the whole
    /// forest unbuildable for the web app.
    #[test]
    fn a_task_path_must_carry_the_uuid_the_tree_is_built_from() {
        assert!(writable_path(".tasks/1f8c4a2e-3d5b-4e7a-9c1d-2b6f8a0e4d33.md").is_ok());
        assert!(writable_path(".tasks/readable-1f8c4a2e-3d5b-4e7a-9c1d-2b6f8a0e4d33.md").is_ok());
        let nested = concat!(
            ".tasks/1f8c4a2e-3d5b-4e7a-9c1d-2b6f8a0e4d33",
            "/child-3a7d9e12-4b8c-4f6a-9d2e-1c5b7a3f8e04.md",
        );
        assert!(writable_path(nested).is_ok(), "rejected {nested:?}");

        assert!(writable_path(".tasks/my-task.md").is_err());
        // UUIDv7, which `parse_uuid_v4` rejects -- the frontend mints v4 for exactly this reason.
        assert!(writable_path(".tasks/01973561-7832-720d-8707-d117baabd452.md").is_err());
        // A parent directory that is not a bare UUIDv4.
        assert!(
            writable_path(".tasks/project/1f8c4a2e-3d5b-4e7a-9c1d-2b6f8a0e4d33.md").is_err(),
        );

        // Outside `.tasks/` the convention does not apply: ordinary notes are free-form.
        assert!(writable_path("anything.md").is_ok());
        assert!(writable_path("folder/anything.md").is_ok());
    }

    /// A file already named outside the convention has already broken the tree; the two tools
    /// that could repair it must not be the ones refused.
    #[test]
    fn a_badly_named_task_can_still_be_renamed_or_deleted() {
        assert!(safe_path(".tasks/my-task.md").is_ok());
        assert!(writable_path(".tasks/my-task.md").is_err());
    }

    #[test]
    fn a_page_is_clamped_rather_than_refused() {
        assert_eq!(page_size(None), DEFAULT_PAGE);
        assert_eq!(page_size(Some(0)), 1);
        assert_eq!(page_size(Some(10)), 10);
        assert_eq!(page_size(Some(100_000)), MAX_PAGE);
    }
}
