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
