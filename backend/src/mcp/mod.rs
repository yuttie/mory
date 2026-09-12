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
    tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, tower::StreamableHttpService,
        StreamableHttpServerConfig,
    },
    ErrorData, ServerHandler,
};
use serde::Serialize;

use crate::models::AppState;

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
                       repository path of each match, which read_note then reads.\n\n\
                       The query language is small and deliberate: bare words match anywhere, \
                       `path:`, `title:` and `body:` restrict a term to one field, `+` requires \
                       a term and `-` excludes it, and \"a phrase\" matches words in order. \
                       Boolean syntax such as (a OR b) is not accepted.\n\n\
                       Modes: `text` is the local index and is always available; `semantic` and \
                       `hybrid` need embeddings enabled on this server and fall back to text \
                       with a warning when they are not; `grep` is a literal regular-expression \
                       scan. Start with `hybrid`, or `text` for an exact term.",
        annotations(title = "Search notes", read_only_hint = true, open_world_hint = false)
    )]
    pub async fn search_notes(
        &self,
        Parameters(args): Parameters<tools::SearchArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        tools::search_notes(&self.state, args).await
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
