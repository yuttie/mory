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
mod task_tools;
mod tools;

/// What every tool returns: text the model reads.
///
/// JSON rather than prose, because the paths in a result are what the next call is made with, and
/// a model has to be able to lift one out without guessing where it ends.
fn json_result<T: Serialize>(value: &T) -> Result<CallToolResult, ErrorData> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| ErrorData::internal_error(format!("could not encode the result: {e}"), None))?;
    Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
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
                       index and is always available; `semantic` and `hybrid` need embeddings \
                       enabled on this server and fall back to text with a warning when they \
                       are not; `grep` is a literal regular-expression scan. Start with \
                       `hybrid`, or `text` for an exact term.",
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
                       `.tasks/` or `projects/`.\n\nThe repository holds on the order of a \
                       thousand entries, so this is always a page: pass the `next_offset` a \
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
        description = "List the tasks under `.tasks/`, optionally filtered by status or tag. \
                       Each result carries the note's `task:` block exactly as the file \
                       declares it: status kind, progress, importance, urgency, and whichever \
                       of start_at, due_by, deadline and scheduled_dates it sets.\n\nStatuses \
                       are todo, in_progress, waiting, blocked, on_hold, done and canceled.",
        annotations(title = "List tasks", read_only_hint = true, open_world_hint = false)
    )]
    pub async fn list_tasks(
        &self,
        Parameters(args): Parameters<tools::ListTasksArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::list_tasks(&self.state, args).await
    }

    #[tool(
        name = "list_events",
        description = "List the calendar events the notes declare in their `events:` \
                       frontmatter, over a window of whole days.\n\nAn event carrying a \
                       `repeat` rule is returned with `recurs: true` and its rule, but its \
                       occurrences are NOT expanded -- read the rule and work the dates out \
                       from it. Every other event appears only when one of its declared \
                       occurrences falls inside the window. Events subscribed from an external \
                       calendar are a separate tool, list_imported_events.",
        annotations(title = "List events", read_only_hint = true, open_world_hint = false)
    )]
    pub async fn list_events(
        &self,
        Parameters(args): Parameters<tools::WindowArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::list_events(&self.state, args).await
    }

    #[tool(
        name = "list_imported_events",
        description = "List the events from the external calendars subscribed in \
                       `.mory/calendars.yaml`, expanded over a window of whole days.\n\nThese \
                       are a live view of someone else's calendar: they are read-only, they are \
                       not stored in the repository, and they must never be written into it. A \
                       calendar that could not be read is reported in `calendars` with its \
                       error rather than failing the call.",
        annotations(title = "List imported events", read_only_hint = true, open_world_hint = true)
    )]
    pub async fn list_imported_events(
        &self,
        Parameters(args): Parameters<tools::WindowArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::list_imported_events(&self.state, args).await
    }

    #[tool(
        name = "create_note",
        description = "Create a new note and commit it. Requires the notes:write scope.\n\nOmit \
                       `path` and it becomes `<uuid>.md` at the repository root, which is what \
                       the web app does. A path under `.tasks/` must end with a UUIDv4 -- \
                       `<uuid>.md` or `readable-name-<uuid>.md` -- because the task tree is \
                       derived from the paths. Fails rather than overwriting an existing file.",
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
                       Editing a task or an event means editing the YAML frontmatter of its \
                       note.",
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
                       scope.\n\nA note under `.tasks/` must keep a UUIDv4 at the end of its \
                       file name, so renaming a task usually means changing only the readable \
                       prefix in front of it. Fails rather than overwriting an existing file.",
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
                       is an ordinary note under `.tasks/` carrying a `task:` block. The schema \
                       requires status, progress, importance, urgency and scheduled_dates, so \
                       whatever is not given is filled in: status todo, progress 0, importance \
                       and urgency 3, no scheduled dates. The result echoes the whole file back \
                       so those defaults are visible.",
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
        description = "Change a task's status, progress, importance or urgency, editing its \
                       frontmatter in place. Requires the notes:write scope.\n\nThe rest of the \
                       note is untouched, comments and hand-formatting included. Changing \
                       status replaces the whole status block, so the keys the new one requires \
                       must come with it: `waiting` needs waiting_for, `blocked` needs \
                       blocked_by, `on_hold` needs hold_reason, `canceled` needs cancel_reason. \
                       `done` and `canceled` default their timestamp to now.",
        annotations(title = "Update a task", read_only_hint = false, destructive_hint = false,
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
                       the status to done with a completed_at of now unless one is given, and \
                       progress to 100 unless set_progress is false.",
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
        description = "Set or clear a task's start_at, due_by, deadline and scheduled_dates. \
                       Requires the notes:write scope.\n\nThese are bare dates (`2026-03-15`) \
                       or datetimes carrying their offset (`2026-03-15 09:00:00+09:00`). due_by \
                       and deadline are drawn on the calendar in their own colours, so they are \
                       events as well as fields.",
        annotations(title = "Set a task's dates", read_only_hint = false,
                    destructive_hint = false, idempotent_hint = true, open_world_hint = false)
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
        name = "read_note",
        description = "Read one note's full Markdown source, YAML frontmatter included, by the \
                       exact repository path a search result reported.",
        annotations(title = "Read a note", read_only_hint = true, open_world_hint = false)
    )]
    pub async fn read_note(
        &self,
        Parameters(args): Parameters<tools::ReadArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::read_note(&self.state, args).await
    }
}

// Naming the field is not cosmetic: left to its default the handler calls `Self::tool_router()`
// and rebuilds the whole router on every request.
#[tool_handler(router = self.tool_router)]
impl ServerHandler for Mory {
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
commit, so say what you changed in the message.

Structure comes from the paths, not from a database:
- `.tasks/` holds tasks, `.events/` holds calendar entries, `.mory/` holds configuration.
- Anything else is an ordinary note.
- A file name ends with a UUIDv4, optionally after a readable prefix: `my-note-<uuid>.md`. A \
directory name is a bare UUIDv4, and a note under one is a child of the note with that UUID. \
Keep that shape when creating files or they will not appear in the note tree.

Tasks and calendar entries are YAML frontmatter on an ordinary note -- a `task:` block or an \
`events:` map -- never separate records. Editing that frontmatter is how you change them.

Two things are easy to get wrong and expensive to fix:
- Datetimes carry their UTC offset (2025-10-06 13:00:00+09:00); plain dates are bare \
(2025-10-06). The one exception is `repeat.tz`, which is an IANA zone name.
- Weekdays in a recurrence rule are three letters (`wed`), not iCal's two, and may carry an \
ordinal: `3wed` is the third Wednesday of the month.

Start with search_notes to find a path, then read_note to read it.";

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
