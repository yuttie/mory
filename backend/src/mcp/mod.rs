//! The MCP server, mounted on the same axum router as everything else.
//!
//! Tools call the internal functions the HTTP handlers call, so an MCP read sees exactly the
//! listing the web app sees and an MCP write is an ordinary Git commit. There is no second
//! source of truth and no second cache.
//!
//! The transport is Streamable HTTP at `{MORIED_ROOT_PATH}v2/mcp`, which is what a connector
//! added by URL in claude.ai or ChatGPT speaks. `oauth::mcp_auth` sits in front of it, so by the
//! time a tool runs the request carried a valid access token bound to that exact URL.

use std::sync::Arc;

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerInfo},
    service::RequestContext,
    tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, tower::StreamableHttpService,
        StreamableHttpServerConfig,
    },
    ErrorData, RoleServer, ServerHandler,
};
use serde::Serialize;

use crate::models::AppState;
use crate::oauth::{AccessClaims, SCOPE_WRITE};

pub(crate) mod frontmatter;
mod event_tools;
mod task_tools;
mod plan_tools;
pub(crate) mod tools;

/// What every tool returns: one JSON object, as `structuredContent` and again as the text.
///
/// JSON rather than prose, because the paths in a result are what the next call is made with, and
/// a model has to be able to lift one out without guessing where it ends.
///
/// Both fields carry the whole result because clients disagree about which one reaches the model:
/// some forward only the text, some only `structuredContent`, and some both. Whichever a client
/// picks, nothing is missing from it -- every remark a result makes is a field of the object, never
/// a text block of its own. The text is compact rather than pretty-printed: a client that forwards
/// it pays for every byte of indentation, and one that cuts long results short cuts them sooner.
///
/// The text is encoded from `value` itself rather than from the object, because this crate's
/// `serde_json::Map` sorts its keys: a result's own order puts `path` before the `declaration`
/// it belongs to, and the explanatory `note` last.
fn json_result<T: Serialize>(value: &T) -> Result<CallToolResult, ErrorData> {
    let encoding_failed =
        |e: serde_json::Error| ErrorData::internal_error(format!("could not encode the result: {e}"), None);
    let text = serde_json::to_string(value).map_err(encoding_failed)?;
    let object = serde_json::to_value(value).map_err(encoding_failed)?;
    // Every protocol version up to 2025-11-25 takes only an object as `structuredContent`. Every
    // result here is a struct or a `json!` object, so anything else is a mistake in this module,
    // not something a caller sent.
    if !object.is_object() {
        return Err(ErrorData::internal_error("a tool result must be a JSON object".to_owned(), None));
    }
    // Not `CallToolResult::structured`, which would encode the object once more for a text block
    // in sorted order, only for it to be replaced.
    let mut result = CallToolResult::success(vec![ContentBlock::text(text)]);
    result.structured_content = Some(object);
    Ok(result)
}

/// A failure the caller should see and can act on.
///
/// MCP renders a tool-level error's text to the model and hides a protocol error's, so anything
/// the model could respond to -- a path that does not exist, a query it should rephrase --
/// belongs here rather than in an `Err(ErrorData)`.
fn tool_error(message: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(message.into())])
}

/// Whether the token this request arrived with carries a scope.
///
/// `mcp_auth` has already required `notes:read` and put the claims in the HTTP request's
/// extensions; rmcp passes the whole `http::request::Parts` through to the tool. A request with
/// no claims at all cannot happen behind that middleware, but it is treated as un-granted rather
/// than assumed granted: a write must never be the thing that depends on a `.unwrap()`.
fn granted(context: &RequestContext<RoleServer>, scope: &str) -> bool {
    context
        .extensions
        .get::<axum::http::request::Parts>()
        .and_then(|parts| parts.extensions.get::<Arc<AccessClaims>>())
        .is_some_and(|claims| claims.has_scope(scope))
}

/// The refusal a write tool returns when its token is read-only.
fn needs_write_scope() -> CallToolResult {
    tool_error(
        "This connection was granted read-only access. Reconnect and approve the \
         notes:write scope to change anything.",
    )
}

/// The MCP server's view of mory. Cloned per session; `AppState` is itself a handle.
#[derive(Clone)]
pub struct Mory {
    state: AppState,
    tool_router: ToolRouter<Mory>,
}

#[tool_router]
impl Mory {
    pub fn new(state: AppState) -> Self {
        Self { state, tool_router: Self::tool_router() }
    }

    #[tool(
        name = "search_notes",
        description = "Search the notes by text, meaning, or regular expression. Returns the \
                       repository path of each match, which read_note then reads.\n\nThe query \
                       language is small and deliberate: bare words match anywhere, `path:`, \
                       `title:` and `body:` restrict a term to one field, `+` requires a term \
                       and `-` excludes it, and \"a phrase\" matches words in order. Boolean \
                       syntax such as (a OR b) is not accepted.\n\nModes: `text` is the local \
                       index and is always available; `hybrid` needs embeddings enabled on \
                       this server and falls back to text with a warning when they are off or \
                       unavailable, where `semantic` fails instead; `grep` runs `git grep` over \
                       every text file, frontmatter and \
                       `.mory/` included. Start with `hybrid`, or `text` for an exact term.\
                       \n\nIn `grep` mode the query language above does not apply: the whole \
                       query is one case-sensitive POSIX basic regular expression. `.`, `*`, \
                       `[0-9]`, `^` and `$` work as usual, but alternation, `+`, `?` and \
                       groups need a backslash (`due_by\\|deadline`, `[0-9]\\+d`, \
                       `\\(high\\|low\\)$`); written bare they match themselves, so a pattern \
                       in another dialect finds nothing rather than failing.",
        annotations(title = "Search notes", read_only_hint = true, open_world_hint = false)
    )]
    pub async fn search_notes(
        &self,
        Parameters(args): Parameters<tools::SearchArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::search_notes(&self.state, args).await
    }

    #[tool(
        name = "list_notes",
        description = "List the notes in the repository, newest first, with their titles, tags \
                       and task status. Optionally restricted to a path prefix such as \
                       `.tasks/` or `projects/`.\n\nThe repository holds a few thousand \
                       files, so this is always a page: pass the `next_offset` a \
                       result reports to continue. To find something specific, search_notes is \
                       the better tool.",
        annotations(title = "List notes", read_only_hint = true, open_world_hint = false)
    )]
    pub async fn list_notes(
        &self,
        Parameters(args): Parameters<tools::ListNotesArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::list_notes(&self.state, args).await
    }

    #[tool(
        name = "list_tasks",
        description = "List the tasks under `.tasks/`, optionally filtered by status or tag.\n\n\
                       Each result carries the note's `task:` block as the web app reads it: \
                       its status, and whichever of importance (low, medium or high), \
                       lead_time, estimate, available_from, due_by, deadline and alarms it sets. Keys \
                       an older task model wrote are read as the web app reads them: a numeric \
                       importance as low (1 or 2), medium (4) or high (5) and 3 as unrated, \
                       start_at as available_from, and urgency, progress and scheduled_dates \
                       not at all.\n\nBeside it are two values \
                       derived from the tree, which no tool sets. `urgency.level` is overdue \
                       (the deadline has passed), target_missed (due_by has), urgent, notice \
                       or calm (within one lead time of the nearer date, within two, or \
                       further), or none (no date, or the task is done or canceled); an open \
                       task is at least as urgent as its most urgent open subtask. With the \
                       level come `reference`, the date it is measured against, `slack_ratio`, \
                       the time left until then in lead times, `actionable`, whether \
                       available_from has come, and `short_window`, whether available_from \
                       leaves less than one lead time before the date. `progress`, on a task \
                       with subtasks, is the percentage of its leaf subtasks that are done, \
                       canceled ones left out.\n\nStatuses are backlog, todo, in_progress, \
                       waiting, blocked, on_hold, done and canceled. A note in the task tree is \
                       a task by its path, so one without a `task:` block, or whose block holds \
                       no status, is listed too, with `task` as written (null where there is \
                       none); the web app draws it as Backlog, but a status filter matches only a \
                       status the note writes.",
        annotations(title = "List tasks", read_only_hint = true, open_world_hint = false)
    )]
    pub async fn list_tasks(
        &self,
        Parameters(args): Parameters<tools::ListTasksArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::list_tasks(&self.state, args).await
    }

    #[tool(
        name = "list_agenda",
        description = "List what is on over a window of whole days, as the calendar shows it: \
                       every occurrence the notes' `events:` declare, recurring ones expanded; the \
                       events of the subscribed calendars, less those a note converted from them \
                       stands in for; and each task's due_by and deadline. One list, sorted by \
                       start, every time in one zone. Use this to answer what is on, or when the \
                       user is free; list_events and list_imported_events are for editing and \
                       converting.\n\nAn item is listed if any part of it falls in the window, so \
                       one that began before it and runs into it is listed too, if it began at \
                       most 31 days before. A time carries the zone's offset, and a whole day is a \
                       bare date: an `end` that is one is the last day included. An item without \
                       `end` has none.\n\n`source` says where each comes from. A `note` item \
                       carries its `path` and `event`, the key update_event edits it by, its \
                       `category` id, and `finished`. An `imported` one carries the subscribed \
                       `calendar` and its `calendar_name`, and is read-only; the calendar's \
                       `description` in `calendars`, where the user wrote one, says whose events it \
                       holds. With `details`, it also carries its description as `note`, its link \
                       as `url`, and its `uid` and `recurrence_id`. A `task` one carries its \
                       `path`, which `field` it is, and the task's `status`, which is settled when \
                       done or canceled. The same meeting on two calendars is two items, and \
                       nothing is merged. Names are as written, without a category's template. A \
                       note's own description is in the note, which read_note returns.",
        annotations(title = "List agenda", read_only_hint = true, open_world_hint = true)
    )]
    pub async fn list_agenda(
        &self,
        Parameters(args): Parameters<tools::AgendaArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::list_agenda(&self.state, args).await
    }

    #[tool(
        name = "list_events",
        description = "List the calendar events the notes declare in their `events:` frontmatter, \
                       over a window of whole days, each with its declaration as written and the \
                       occurrences of it that start inside the window, as the calendar draws them: \
                       a `repeat` rule's expanded, with its exclusions and overrides applied. An \
                       event with none in the window is not listed.\n\nEach task due_by and \
                       deadline inside the window is listed too, under `task_dates`: the calendar \
                       draws them as events, so a question about what is coming up needs them. The \
                       event categories configured in `.mory/calendars.yaml` are listed under \
                       `categories`, as declared, and the config's `alarms`, saying when events \
                       and task dates ring where a note does not. Events subscribed from an \
                       external calendar are a separate tool, list_imported_events.\n\nThis is the \
                       declarations, for editing them. To ask what is on, use list_agenda.",
        annotations(title = "List events", read_only_hint = true, open_world_hint = false)
    )]
    pub async fn list_events(
        &self,
        Parameters(args): Parameters<tools::EventsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::list_events(&self.state, args).await
    }

    #[tool(
        name = "list_imported_events",
        description = "List the events from the external calendars subscribed in \
                       `.mory/calendars.yaml`, expanded over a window of whole days and a day \
                       either side of it in UTC: each feed keeps its own zone, so the window is \
                       widened rather than cut in one, and events from just outside the days \
                       asked for may be listed too. Each time carries the offset of the zone its \
                       feed gives it. Check a `start` against the days meant.\n\nThese \
                       are a live view of someone else's calendar: they are read-only, they are \
                       not stored in the repository, and they must never be written into it. A \
                       calendar that could not be read is reported in `calendars` with its \
                       error rather than failing the call. A calendar's `description`, where the \
                       user wrote one, says what it holds: whose events they are, and which of \
                       them are the user's own.\n\nAn event the user has converted \
                       into a note under `.events/` is still listed here. The note, which \
                       list_events returns, names the original in its `ical` (`uid`, and \
                       `recurrence_id` for one occurrence), and the calendar draws only the \
                       note, so count such an event once.\n\nEach occurrence is listed on its \
                       own. The whole definition of the series it belongs to is returned under \
                       `series`, keyed by `uid`, only with `include_series`.\n\nTo ask what is \
                       on, use list_agenda, which keeps to the days asked for in one zone, \
                       expands the notes too and leaves out what a note claims.",
        annotations(title = "List imported events", read_only_hint = true, open_world_hint = true)
    )]
    pub async fn list_imported_events(
        &self,
        Parameters(args): Parameters<tools::ImportedEventsArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::list_imported_events(&self.state, args).await
    }

    #[tool(
        name = "create_note",
        description = "Create a new note and commit it. Requires the notes:write scope.\n\nOmit \
                       `path` and it becomes `<uuid>.md` at the repository root, which is what \
                       the web app does. A path under `.tasks/` must end with a UUIDv4 -- \
                       `<uuid>.md` or `readable-name-<uuid>.md` -- because the task tree is \
                       derived from the paths. Fails rather than overwriting an existing file.\
                       \n\nA Markdown note without `created_at` in its frontmatter is given one \
                       of now, as the web app gives a new note, and one whose frontmatter does \
                       not read as a YAML mapping is refused, as is one whose fences are not \
                       lines that are exactly `---`. So is a `.mory/calendars.yaml` holding a \
                       value moried or the web app would leave out, as update_note says.",
        annotations(title = "Create a note", read_only_hint = false, destructive_hint = false,
                    idempotent_hint = false, open_world_hint = false)
    )]
    pub async fn create_note(
        &self,
        Parameters(args): Parameters<tools::CreateNoteArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        tools::create_note(&self.state, args).await
    }

    #[tool(
        name = "update_note",
        description = "Replace a note's entire content and commit it. Requires the notes:write \
                       scope.\n\nThis is not a patch: read_note first and send the whole file \
                       back, frontmatter included, or everything you did not send is lost. \
                       It also writes over anything changed in the note since you read it. A \
                       file read_note does not return whole -- one longer than it returns, an \
                       image, or text not in UTF-8 -- is refused, since it cannot have been \
                       read whole. A Markdown note sent without `created_at` keeps the one it \
                       had, or is given one of now. `.mory/calendars.yaml` is refused while it \
                       holds a value moried or the web app would leave out -- a subscription \
                       without a text `id` and `url`, an `enabled` other than true or false, an \
                       alarm outside the grammar, a key neither reads -- and the refusal names \
                       each.\
                       \n\nTo change a task or an event, use the task and event tools instead: \
                       they edit its frontmatter in place, in one step, and check what they \
                       write, where this checks only that the frontmatter it is sent reads as a \
                       YAML mapping between fences that are lines exactly `---`. Those tools \
                       refuse a note whose fences are not, so this is the tool that fixes one.",
        annotations(title = "Update a note", read_only_hint = false, destructive_hint = true,
                    idempotent_hint = true, open_world_hint = false)
    )]
    pub async fn update_note(
        &self,
        Parameters(args): Parameters<tools::UpdateNoteArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        tools::update_note(&self.state, args).await
    }

    #[tool(
        name = "rename_note",
        description = "Move a note to another path and commit it. Requires the notes:write \
                       scope.\n\nA task keeps the UUIDv4 its file name ends with, since the \
                       day plans name it by that UUID and its subtasks live in the directory it \
                       names: renaming one means changing only the readable prefix in front of \
                       it. Fails rather than overwriting an existing file, and refuses to move \
                       onto `.mory/calendars.yaml` a file update_note would refuse to write there.",
        annotations(title = "Rename a note", read_only_hint = false, destructive_hint = false,
                    idempotent_hint = false, open_world_hint = false)
    )]
    pub async fn rename_note(
        &self,
        Parameters(args): Parameters<tools::RenameNoteArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        tools::rename_note(&self.state, args).await
    }

    #[tool(
        name = "delete_note",
        description = "Delete a note and commit the deletion. Requires the notes:write \
                       scope.\n\nThe content stays in the Git history, so this is recoverable, \
                       but the note leaves the app. Ask before deleting anything you were not \
                       explicitly told to delete.",
        annotations(title = "Delete a note", read_only_hint = false, destructive_hint = true,
                    idempotent_hint = true, open_world_hint = false)
    )]
    pub async fn delete_note(
        &self,
        Parameters(args): Parameters<tools::DeleteNoteArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        tools::delete_note(&self.state, args).await
    }

    #[tool(
        name = "create_task",
        description = "Create a task and commit it. Requires the notes:write scope.\n\nA task \
                       is an ordinary note under `.tasks/` carrying a `task:` block. It needs \
                       a title that is not blank, and a status, which defaults to backlog. \
                       importance is low, \
                       medium or high, or left out for an unrated task. lead_time is how long \
                       the work needs before its date, in whole days or weeks (`14d`, `2w`); \
                       left out, it is the longest `.mory/tasks.yaml` sets for one of its tags, \
                       else that file's default, else 7d. estimate is how long the work itself \
                       takes, in hours and minutes (`3h`, `90m`, `1h 30m`), which the web app \
                       fills a planned day with. available_from is \
                       when it can be started, due_by the soft target and deadline the hard \
                       cutoff.\n\nUrgency and progress are worked out from these and cannot be \
                       set. To put it on a day's plan, use plan_task. The result echoes the \
                       whole file back so the defaults are visible.",
        annotations(title = "Create a task", read_only_hint = false, destructive_hint = false,
                    idempotent_hint = false, open_world_hint = false)
    )]
    pub async fn create_task(
        &self,
        Parameters(args): Parameters<task_tools::CreateTaskArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        task_tools::create_task(&self.state, args).await
    }

    #[tool(
        name = "update_task",
        description = "Change a task's status, optional importance, lead_time or estimate, editing its \
                       frontmatter in place. Requires the notes:write scope.\n\nThe rest of the \
                       note is untouched, comments and hand-formatting included. Changing \
                       status replaces the whole status block, so the keys the new one requires \
                       must come with it: `waiting` needs waiting_for, `blocked` needs \
                       blocked_by, `on_hold` needs hold_reason, `canceled` needs cancel_reason, \
                       and none of them may be blank, as the web app's task editor will not \
                       save one. \
                       `done` and `canceled` default their timestamp to now. Setting the status \
                       a task already has changes only the keys given and keeps the rest.",
        annotations(title = "Update a task", read_only_hint = false, destructive_hint = true,
                    idempotent_hint = true, open_world_hint = false)
    )]
    pub async fn update_task(
        &self,
        Parameters(args): Parameters<task_tools::UpdateTaskArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        task_tools::update_task(&self.state, args).await
    }

    #[tool(
        name = "complete_task",
        description = "Mark a task done and commit it. Requires the notes:write scope.\n\nSets \
                       the status to done with a completed_at of now unless one is given. A \
                       task already done keeps its completed_at and completion_note unless new \
                       ones are given, so completing it again with nothing new is refused, and \
                       nothing is committed. A parent's progress follows from it.",
        annotations(title = "Complete a task", read_only_hint = false, destructive_hint = false,
                    idempotent_hint = true, open_world_hint = false)
    )]
    pub async fn complete_task(
        &self,
        Parameters(args): Parameters<task_tools::CompleteTaskArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        task_tools::complete_task(&self.state, args).await
    }

    #[tool(
        name = "cancel_task",
        description = "Cancel a task and commit it. Requires the notes:write scope.\n\nThe \
                       schema requires a reason, which is the point: a cancelled task with no \
                       reason is indistinguishable later from one that was forgotten.",
        annotations(title = "Cancel a task", read_only_hint = false, destructive_hint = false,
                    idempotent_hint = true, open_world_hint = false)
    )]
    pub async fn cancel_task(
        &self,
        Parameters(args): Parameters<task_tools::CancelTaskArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        task_tools::cancel_task(&self.state, args).await
    }

    #[tool(
        name = "set_task_dates",
        description = "Set or clear a task's available_from, due_by and deadline, and when the \
                       last two ring. Requires the notes:write scope.\n\nThe dates say when the \
                       task can start and when it is due; which day it is worked on is a day \
                       plan's, set with plan_task. They are bare dates (`2026-03-15`) \
                       or datetimes carrying their offset (`2026-03-15 09:00:00+09:00`), with \
                       no fraction of a second: the calendar draws no such date. due_by \
                       and deadline are drawn on the calendar in their own colours, so they are \
                       events as well as fields: list_agenda lists them with the rest of what is \
                       on, and list_events under `task_dates`. \
                       `due_by_alarms` and `deadline_alarms` say when each rings, as offsets \
                       (`-1h`) or times on its day (`09:00`, `-1d 18:00`).",
        annotations(title = "Set a task's dates", read_only_hint = false,
                    destructive_hint = true, idempotent_hint = true, open_world_hint = false)
    )]
    pub async fn set_task_dates(
        &self,
        Parameters(args): Parameters<task_tools::SetTaskDatesArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        task_tools::set_task_dates(&self.state, args).await
    }

    #[tool(
        name = "add_event",
        description = "Add a calendar event to a note's `events:` frontmatter and commit it. \
                       Requires the notes:write scope.\n\nThe note must exist already; for an \
                       event with a note of its own, make one under `.events/` with create_note \
                       first. An event is keyed by its name in that \
                       map, so the name must not already be taken. It needs a `start`, or a \
                       list of occurrences in `add_instances`, each with its own `start`, for \
                       one that happens on dates no rule describes. A bare date makes an \
                       all-day occurrence, a datetime carrying its offset a timed one, and the \
                       shape is the only thing that says which. `end` may be a datetime, a bare \
                       time of day, or a duration such as `+1.5h`.\n\nIn \
                       a `repeat` rule, weekdays are three letters (`wed`), not iCal's two, and \
                       may carry an ordinal: `3wed` is the third Wednesday, which needs `freq: \
                       monthly` or `yearly`. `tz` is an IANA zone name such as `Asia/Tokyo`, \
                       never an offset. A rule recurs from the event's `start`, so it needs one, \
                       and `exclusions` take occurrences out of a rule, so they need a \
                       `repeat`. A rule the calendar would expand nothing of is refused: an \
                       ordinal past what its period counts (`-6fri`), `bymonthday` under \
                       `freq: weekly`, months that have none of its days, or an `until` before \
                       the `start`.\n\n`category` names an event category configured in \
                       `.mory/calendars.yaml`, which list_events lists; one that is not \
                       configured is refused rather than invented.\n\n`alarms` says when it \
                       rings, as offsets from the start (`-10m`, `+1h`) or times on its day \
                       (`09:00`, `-1d 18:00`); the sign is required, and `[]` silences it.",
        annotations(title = "Add an event", read_only_hint = false, destructive_hint = false,
                    idempotent_hint = false, open_world_hint = false)
    )]
    pub async fn add_event(
        &self,
        Parameters(args): Parameters<event_tools::EventArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        event_tools::add_event(&self.state, args).await
    }

    #[tool(
        name = "update_event",
        description = "Change a calendar event already declared in a note's `events:` \
                       frontmatter. Requires the notes:write scope.\n\nOnly the fields given \
                       are changed; name keys in `clear` to remove them. The rest of the note, \
                       comments and hand-formatting included, is untouched. The same spelling \
                       rules as add_event apply: three-letter weekdays with an optional \
                       ordinal, a rule the calendar can expand, an IANA zone name for `tz`, \
                       offsets on datetimes and none on dates, a `category` that is already \
                       configured, and `alarms` as offsets \
                       or times on the day, with `clear: [\"alarms\"]` to go back to the \
                       category's and the config's.\n\nMany events list their occurrences one \
                       by one, under `instances` or the older `times`, rather than by a rule. \
                       To add one or take one out, use `add_instances` and `remove_instances`, \
                       not `start`, which is the event's own occurrence apart from that list. \
                       An occurrence to remove is named by its `start`, matched by instant, \
                       and every occurrence listed at that moment goes. Removing one and adding \
                       another in the same call replaces it in one commit; the new one has only \
                       the fields `add_instances` gives it, so repeat any of the old one's to \
                       keep them. The other occurrences are left as the note wrote them.\
                       \n\nA rule's `overrides`, which change one occurrence it generates, can \
                       be cleared here but not written. To move or change one occurrence of a \
                       rule, exclude it -- `exclusions` is set whole, so send those it has too \
                       -- and list what replaces it with `add_instances`, or write an override \
                       with read_note and update_note.",
        annotations(title = "Update an event", read_only_hint = false, destructive_hint = true,
                    idempotent_hint = true, open_world_hint = false)
    )]
    pub async fn update_event(
        &self,
        Parameters(args): Parameters<event_tools::EventArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        event_tools::update_event(&self.state, args).await
    }

    #[tool(
        name = "remove_event",
        description = "Remove one event from a note's `events:` frontmatter and commit it. \
                       Requires the notes:write scope.\n\nThe note itself stays; only that \
                       entry in the map goes. Events from a subscribed external calendar are \
                       not in any note and cannot be removed this way.",
        annotations(title = "Remove an event", read_only_hint = false, destructive_hint = true,
                    idempotent_hint = true, open_world_hint = false)
    )]
    pub async fn remove_event(
        &self,
        Parameters(args): Parameters<event_tools::RemoveEventArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        event_tools::remove_event(&self.state, args).await
    }

    #[tool(
        name = "read_note",
        description = "Read one note's Markdown source, YAML frontmatter included, by the \
                       exact repository path a search result reported.\n\nA file over 256 KiB \
                       is cut there, at a character boundary, and `truncated_at_bytes` says how \
                       much was returned; search_notes in `grep` mode still finds text in the \
                       rest.",
        annotations(title = "Read a note", read_only_hint = true, open_world_hint = false)
    )]
    pub async fn read_note(
        &self,
        Parameters(args): Parameters<tools::ReadArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::read_note(&self.state, args).await
    }

    #[tool(
        name = "list_plan",
        description = "Read the day plans between two dates, both included.\n\nA day plan is \
                       the ordered list of tasks to work on that day. Each entry names its task \
                       by the UUIDv4 its file name ends with, says whether it was `planned` or \
                       an `interruption`, and carries its `result` once one is recorded: \
                       `worked`, meaning effort went into it that day rather than that it is \
                       done, or `missed`. The web app's Collect undone marks each open task's \
                       unrecorded entry on a past day missed and plans it again for today.\n\n\
                       `tasks` gives the path, title and status of each task the window's \
                       plans name, keyed by its UUID; a note without a title, or a task that \
                       names no status, leaves that field out. A UUID that names no task, or a \
                       month's file that cannot be read, is reported in `warnings` rather than \
                       failing the call.",
        annotations(title = "List day plans", read_only_hint = true, open_world_hint = false)
    )]
    pub async fn list_plan(
        &self,
        Parameters(args): Parameters<plan_tools::ListArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        plan_tools::list_plan(&self.state, args).await
    }

    #[tool(
        name = "plan_task",
        description = "Add a task to a day's plan and commit it. Requires the notes:write \
                       scope.\n\nThe task goes to the end of the day's list, and a task \
                       already on it stays where it is: a day lists a task once. `planned` \
                       leaves its result unrecorded; `interruption` is for work that came up \
                       unplanned, and records it as worked -- on an entry already there too, \
                       whose origin and place are kept. A call that would leave the plan as it \
                       was is refused, and nothing is committed.\n\nA UUID that names no task \
                       is planned all the same, and the result says so with `unknown_task`.",
        annotations(title = "Plan a task", read_only_hint = false, destructive_hint = false,
                    idempotent_hint = true, open_world_hint = false)
    )]
    pub async fn plan_task(
        &self,
        Parameters(args): Parameters<plan_tools::PlanArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        plan_tools::plan_task(&self.state, args).await
    }

    #[tool(
        name = "record_plan_result",
        description = "Record how a task on a day's plan went, and commit it. Requires the \
                       notes:write scope.\n\n`worked` says effort went into it that day, not \
                       that it is done: complete_task says that. `missed` says it was planned \
                       and not worked on, so an `interruption` cannot be missed. Omit `result` \
                       to make the entry unrecorded again. The task must already be on that \
                       day's plan, and a result it already has is refused rather than \
                       committed again.",
        annotations(title = "Record a plan result", read_only_hint = false,
                    destructive_hint = true, idempotent_hint = true, open_world_hint = false)
    )]
    pub async fn record_plan_result(
        &self,
        Parameters(args): Parameters<plan_tools::ResultArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        plan_tools::record_result(&self.state, args).await
    }

    #[tool(
        name = "unplan_task",
        description = "Take a task off one day's plan and commit it. Requires the notes:write \
                       scope.\n\nThe entry goes with its result, so a record of work done is \
                       lost from the plan; the task itself, and the rest of the day, are \
                       untouched. A UUID that names no task can be taken off too; one the day \
                       does not list is refused.",
        annotations(title = "Remove a plan entry", read_only_hint = false,
                    destructive_hint = true, idempotent_hint = true, open_world_hint = false)
    )]
    pub async fn unplan_task(
        &self,
        Parameters(args): Parameters<plan_tools::UnplanArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if !granted(&context, SCOPE_WRITE) {
            return Ok(needs_write_scope());
        }
        plan_tools::unplan_task(&self.state, args).await
    }
}

// Naming the field is not cosmetic: left to its default the handler calls `Self::tool_router()`
// and rebuilds the whole router on every request.
#[tool_handler(router = self.tool_router)]
impl ServerHandler for Mory {
    async fn call_tool(
        &self,
        request: rmcp::model::CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<rmcp::model::CallToolResponse, ErrorData> {
        if let Some(message) = obsolete_task_arguments(&request.name, request.arguments.as_ref()) {
            return Ok(tool_error(message).into());
        }
        let call = rmcp::handler::server::tool::ToolCallContext::new(self, request, context);
        self.tool_router.call(call).await
    }

    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new("mory", env!("CARGO_PKG_VERSION"))
                    .with_title("mory notes")
                    .with_description(
                        "One person's notes, stored as Markdown files in a Git repository.",
                    ),
            )
            .with_instructions(INSTRUCTIONS)
    }
}

/// What a model needs to know about this repository before its first call.
///
/// Written for the model rather than the user: the things it would otherwise have to discover by
/// trial and error, and the places where guessing produces a file the user has to repair by hand.
const INSTRUCTIONS: &str = "\
mory is one person's notes, stored as Markdown files in a Git repository. Every write is a \
commit. Most write tools take its message, so say in it what you changed; the plan tools write \
their own.

Structure comes from the paths, not from a database:
- `.tasks/` holds tasks, `.events/` holds calendar entries, `.mory/` holds configuration and, \
under `.mory/plans/`, the day plans.
- Anything else is an ordinary note, named freely. Its children are the notes in the directory \
named as it is without `.md`: `ideas.md` is the parent of `ideas/draft.md`.
- Under `.tasks/` the naming is strict, because the task tree is derived from it: a file name \
ends with a UUIDv4, optionally after a readable prefix (`report-<uuid>.md`), and a subtask lives \
in a directory named by its parent's bare UUID (`.tasks/<uuid>/`). A task named any other way is \
not in the task tree.

Tasks and calendar entries are YAML frontmatter on an ordinary note -- a `task:` block or an \
`events:` map -- never separate records. Change them with the task tools (create_task, \
update_task, complete_task, cancel_task, set_task_dates) and the event tools (add_event, \
update_event, remove_event): they check what they write and change only the keys they are \
given, leaving the rest of the note as it was. update_note rewrites the whole file without \
those checks, so keep it for what those tools cannot do. Day plans are the one exception: \
which tasks are worked on which day is kept apart from the tasks, in one file a month, and \
changed with the plan tools rather than update_note.

Two things are easy to get wrong and expensive to fix:
- Datetimes carry their UTC offset (2025-10-06 13:00:00+09:00), to the second at most; plain \
dates are bare (2025-10-06). The one exception is `repeat.tz`, which is an IANA zone name. Many older notes \
write a time without an offset (2025-10-06 13:00): the tools read it in moried's own zone, \
whatever `tz` a call asks for, and list_agenda called without `tz` names that zone in its `tz`. \
Write new ones with the offset.
- Weekdays in a recurrence rule are three letters (`wed`), not iCal's two, and may carry an \
ordinal: `3wed` is the third Wednesday of the month.

Start with search_notes to find a path, then read_note to read it. To ask what is on, use \
list_agenda: it lists the notes' events, the subscribed calendars' and the tasks' dates together, \
as the calendar shows them.";

fn obsolete_task_arguments(name: &str, arguments: Option<&serde_json::Map<String, serde_json::Value>>) -> Option<String> {
    if !matches!(name, "create_task" | "update_task" | "set_task_dates") {
        return None;
    }
    let arguments = arguments?;
    let replacements = [
        ("start_at", "start_at was renamed to available_from."),
        ("scheduled_dates", "scheduled_dates was removed; use plan_task(date, task, origin)."),
        ("urgency", "urgency is derived from dates and lead_time; set those instead."),
        ("progress", "progress is derived from descendant statuses; update their status instead."),
    ];
    let messages: Vec<_> = replacements.iter().filter(|(key, _)| arguments.contains_key(*key) || arguments.get("clear").and_then(serde_json::Value::as_array).is_some_and(|keys| keys.iter().any(|value| value.as_str() == Some(*key)))).map(|(_, message)| *message).collect();
    (!messages.is_empty()).then(|| messages.join(" "))
}

#[cfg(test)]
mod result_tests {
    use super::*;

    #[test]
    fn a_result_is_the_same_compact_object_twice() {
        #[derive(Serialize)]
        struct Output {
            path: &'static str,
            items: Vec<u8>,
        }
        let result = json_result(&Output { path: "a.md", items: vec![1, 2] }).unwrap();
        let structured = result.structured_content.clone().expect("structuredContent is set");
        assert_eq!(structured, serde_json::json!({"path": "a.md", "items": [1, 2]}));
        let [block] = result.content.as_slice() else {
            panic!("one text block, not {:?}", result.content);
        };
        let text = &block.as_text().expect("a text block").text;
        assert_eq!(text, r#"{"path":"a.md","items":[1,2]}"#, "compact, in the result's own order");
        assert_eq!(serde_json::from_str::<serde_json::Value>(text).unwrap(), structured);
        assert_eq!(result.is_error, Some(false));
    }

    #[test]
    fn a_result_that_is_not_an_object_is_refused() {
        assert!(json_result(&vec![1, 2]).is_err());
    }
}

#[cfg(test)]
mod argument_tests {
    use super::*;

    /// Whether a property's schema admits `null`: as a type of its own, or as one alternative.
    fn admits_null(schema: &serde_json::Value) -> bool {
        let names_null = |value: &serde_json::Value| match value {
            serde_json::Value::String(name) => name == "null",
            serde_json::Value::Array(names) => names.iter().any(|name| name == "null"),
            _ => false,
        };
        schema.get("type").is_some_and(names_null)
            || ["anyOf", "oneOf"].iter().any(|key| {
                schema.get(*key).and_then(serde_json::Value::as_array).is_some_and(|options| options.iter().any(admits_null))
            })
    }

    // Some clients send `null` for each argument the model left out, as one that writes a tool for
    // OpenAI's strict mode does, which lists every field as required. Taken as left out, it does
    // what leaving the argument out does, rather than fail the call.
    #[test]
    fn every_optional_argument_takes_null() {
        let mut refused = Vec::new();
        for tool in Mory::tool_router().list_all() {
            let schema = serde_json::Value::Object((*tool.input_schema).clone());
            let required: Vec<&str> = schema["required"].as_array().map_or_else(Vec::new, |names| names.iter().filter_map(serde_json::Value::as_str).collect());
            for (name, property) in schema["properties"].as_object().into_iter().flatten() {
                if !required.contains(&name.as_str()) && !admits_null(property) {
                    refused.push(format!("{}.{}", tool.name, name));
                }
            }
        }
        assert_eq!(refused, Vec::<String>::new());
    }

    #[test]
    fn a_flag_sent_as_null_is_left_unset() {
        let args: crate::mcp::task_tools::UpdateTaskArgs = serde_json::from_value(serde_json::json!({
            "path": "a.md", "message": "m", "clear_importance": null, "clear_lead_time": true,
        })).unwrap();
        assert_eq!((args.clear_importance, args.clear_lead_time), (None, Some(true)));
    }
    #[test]
    fn obsolete_task_arguments_name_the_replacements() {
        for (key, replacement) in [("start_at", "available_from"), ("scheduled_dates", "plan_task"), ("urgency", "lead_time"), ("progress", "status")] {
            let arguments = serde_json::json!({key: null});
            assert!(obsolete_task_arguments("create_task", arguments.as_object()).unwrap().contains(replacement));
            assert!(obsolete_task_arguments("update_task", arguments.as_object()).unwrap().contains(replacement));
        }
        assert!(obsolete_task_arguments("set_task_dates", serde_json::json!({"clear": ["start_at"]}).as_object()).unwrap().contains("available_from"));
        assert!(obsolete_task_arguments("create_note", serde_json::json!({"start_at": null}).as_object()).is_none());
    }
}

/// The tower service to mount at `{MORIED_ROOT_PATH}v2/mcp`.
pub fn service(
    state: AppState,
    public_url: &str,
) -> StreamableHttpService<Mory, LocalSessionManager> {
    StreamableHttpService::new(
        move || Ok(Mory::new(state.clone())),
        Arc::new(LocalSessionManager::default()),
        transport_config(public_url),
    )
}

/// How the Streamable HTTP transport is configured for this deployment.
///
/// Three settings here are the difference between working and silently refusing everything:
///
/// - `allowed_hosts` defaults to loopback only, as a defence against DNS rebinding attacks on a
///   server running on someone's laptop. Every request from claude.ai is rejected until the
///   public authority is in this list. A reverse proxy that rewrites `Host` to an internal name
///   needs that name here too, which is what `MORIED_MCP_ALLOWED_HOSTS` is for.
/// - `allowed_origins` stays empty, which turns `Origin` validation off: connector traffic is
///   server-side from Anthropic rather than from a browser, so there is no `Origin` to match.
/// - `legacy_session_mode` is turned off, and with it `json_response` takes effect: a tool call
///   becomes one JSON request and one JSON response, with no session to keep. Every tool here
///   reads or writes the repository and holds nothing between calls, so there is no state a
///   session would carry -- and a stateless endpoint survives a restart of this process without
///   the client having to notice.
fn transport_config(public_url: &str) -> StreamableHttpServerConfig {
    let mut allowed_hosts = vec![
        "localhost".to_owned(),
        "127.0.0.1".to_owned(),
        "::1".to_owned(),
    ];
    if let Ok(url) = reqwest::Url::parse(public_url) {
        if let Some(host) = url.host_str() {
            allowed_hosts.push(host.to_owned());
            if let Some(port) = url.port() {
                allowed_hosts.push(format!("{host}:{port}"));
            }
        }
    }
    if let Ok(extra) = std::env::var("MORIED_MCP_ALLOWED_HOSTS") {
        allowed_hosts.extend(
            extra
                .split(',')
                .map(str::trim)
                .filter(|host| !host.is_empty())
                .map(str::to_owned),
        );
    }
    tracing::info!("MCP accepts these Host values: {:?}", allowed_hosts);

    StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_allowed_hosts(allowed_hosts)
        .with_allowed_origins(Vec::<String>::new())
}
