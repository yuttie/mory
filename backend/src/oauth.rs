//! An OAuth 2.1 authorization server, just large enough for an MCP client to connect.
//!
//! claude.ai and ChatGPT both refuse a static bearer token for a connector added by URL, so
//! serving MCP to them means being an authorization server as well as a resource server. This is
//! the smallest thing that satisfies the 2026-07-28 MCP authorization spec: authorization code
//! with PKCE S256, dynamic client registration, client ID metadata documents, refresh-token
//! rotation, and the two discovery documents.
//!
//! **Every artefact is a stateless JWT** signed with `MORIED_SECRET` and told apart by a `typ`
//! claim -- `mcp_client`, `mcp_code`, `mcp_access`, `mcp_refresh`. A registered `client_id` is
//! itself a signed JWT carrying that client's redirect URIs, so registration stores nothing and a
//! client re-registering on every fresh connection costs nothing. Nothing here survives in
//! `cache.sqlite`, which matters because that database may hold only disposable data.
//!
//! The trade-offs this buys, stated plainly:
//!
//! - **There is no revocation list.** Revoking every issued token means rotating `MORIED_SECRET`,
//!   which also ends the web session. For a single-user personal tool that is the trust boundary
//!   already in place.
//! - **An authorization code can be replayed within its 60-second life.** Single use would need
//!   state. PKCE means a replay still needs the original verifier, which never leaves the client.
//!
//! MCP is off unless `MORIED_PUBLIC_URL` is set: without it none of these routes are registered
//! and an existing deployment behaves exactly as before.

use std::collections::HashMap;
use std::env;
use std::iter::once;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use axum::{
    body::Body,
    error_handling::HandleErrorLayer,
    extract,
    http::{header, Method, Request, StatusCode},
    middleware::Next,
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
    BoxError, Json, Router,
};
use base64::Engine;
use chrono::Utc;
use jsonwebtoken as jwt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tower::ServiceBuilder;
use tower_http::{cors, cors::CorsLayer, sensitive_headers::SetSensitiveHeadersLayer, trace::TraceLayer};

use crate::models::AppState;

/// Lifetimes. An authorization code is redeemed within seconds of being issued; the access token
/// matches what Claude expects to refresh around; the refresh token outlives a month of idleness.
const CODE_TTL: chrono::TimeDelta = chrono::TimeDelta::seconds(60);
const ACCESS_TTL: chrono::TimeDelta = chrono::TimeDelta::hours(1);
const REFRESH_TTL: chrono::TimeDelta = chrono::TimeDelta::days(30);
/// A registered client must outlive every refresh token issued to it, or a client that has been
/// connected for a month would be turned away at the moment it tries to refresh.
const CLIENT_TTL: chrono::TimeDelta = chrono::TimeDelta::days(365);

pub const SCOPE_READ: &str = "notes:read";
pub const SCOPE_WRITE: &str = "notes:write";
const SCOPE_OFFLINE: &str = "offline_access";
const SUPPORTED_SCOPES: [&str; 3] = [SCOPE_READ, SCOPE_WRITE, SCOPE_OFFLINE];

/// At most this many redirect URIs per client, and this long a name.
const MAX_REDIRECT_URIS: usize = 10;
const MAX_CLIENT_NAME: usize = 200;

/// A client ID metadata document must be small and must arrive quickly: every OAuth endpoint has
/// to answer well inside Claude's ten-second discovery timeout, and this is the only one of them
/// that touches the network.
const MAX_CIMD_BYTES: usize = 64 * 1024;
const CIMD_TIMEOUT: Duration = Duration::from_secs(5);
const CIMD_CACHE_TTL: Duration = Duration::from_secs(300);

/// Everything the OAuth and MCP routes derive from the environment.
///
/// `issuer` is `MORIED_PUBLIC_URL` joined with `MORIED_ROOT_PATH` and stripped of its trailing
/// slash, so it is the site root for the ordinary `MORIED_ROOT_PATH=/` deployment and
/// path-bearing behind a reverse proxy. That second case is deliberate: for a path-bearing issuer
/// RFC 8414 defines `https://host/api/.well-known/openid-configuration` as the last fallback, and
/// that one URL is reachable through the `/api/` rule a deployment already has -- so discovery
/// still works when the operator adds no new proxy rule at all.
#[derive(Clone, Debug)]
pub struct McpConfig {
    /// The `MORIED_ROOT_PATH` this server is mounted under, leading and trailing slash included.
    pub root_path: String,
    pub issuer: String,
    /// The canonical MCP endpoint. Access tokens are audience-bound to exactly this string, and
    /// it must equal the URL the user types into the connector dialog.
    pub resource: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: String,
    /// Where `WWW-Authenticate` points a client that arrives without a token.
    pub resource_metadata: String,
}

impl AccessClaims {
    pub fn has_scope(&self, wanted: &str) -> bool {
        self.scope.split_whitespace().any(|scope| scope == wanted)
    }
}

impl McpConfig {
    /// `None` when `MORIED_PUBLIC_URL` is unset, which is what turns MCP off entirely.
    pub fn from_env() -> Result<Option<Self>> {
        let Ok(public_url) = env::var("MORIED_PUBLIC_URL") else {
            return Ok(None);
        };
        let public_url = public_url.trim().trim_end_matches('/').to_owned();
        if public_url.is_empty() {
            return Ok(None);
        }
        let parsed = reqwest::Url::parse(&public_url)
            .context("MORIED_PUBLIC_URL is not a URL")?;
        if parsed.scheme() != "https" && parsed.host_str() != Some("localhost") {
            bail!("MORIED_PUBLIC_URL must be an https:// URL, or http://localhost for testing");
        }

        let root_path = env::var("MORIED_ROOT_PATH").unwrap_or_else(|_| "/".to_owned());
        // The same invariants `main` asserts, restated here because this runs before it.
        if !root_path.starts_with('/') || !root_path.ends_with('/') {
            bail!("MORIED_ROOT_PATH must start and end with '/'");
        }

        let base = format!("{}{}", public_url, root_path);
        let issuer = base.trim_end_matches('/').to_owned();
        let resource = format!("{}v2/mcp", base);
        Ok(Some(Self {
            resource_metadata: format!(
                "{}/.well-known/oauth-protected-resource{}v2/mcp",
                public_url, root_path,
            ),
            root_path,
            issuer,
            resource,
            authorization_endpoint: format!("{}oauth/authorize", base),
            token_endpoint: format!("{}oauth/token", base),
            registration_endpoint: format!("{}oauth/register", base),
        }))
    }
}

/// What a client ID metadata document fetch produced, and when.
struct CachedClient {
    client: RegisteredClient,
    fetched_at: Instant,
}

/// The config plus the small in-memory caches the endpoints share.
#[derive(Clone)]
pub struct OauthState {
    pub config: Arc<McpConfig>,
    pub app: AppState,
    cimd_cache: Arc<Mutex<HashMap<String, CachedClient>>>,
}

impl OauthState {
    pub fn new(config: Arc<McpConfig>, app: AppState) -> Self {
        Self {
            config,
            app,
            cimd_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

fn secret() -> Result<String> {
    env::var("MORIED_SECRET").context("MORIED_SECRET is not set")
}

fn encode<T: Serialize>(claims: &T) -> Result<String> {
    let secret = secret()?;
    jwt::encode(
        &jwt::Header::new(jwt::Algorithm::HS256),
        claims,
        &jwt::EncodingKey::from_secret(secret.as_ref()),
    )
    .context("failed to sign a token")
}

/// Decode and check everything that does not depend on which endpoint is asking.
///
/// `audience` is `None` for the artefacts that are not audience-bound (a client registration, an
/// authorization code); the access and refresh tokens name the canonical MCP URL, as RFC 8707
/// and the MCP spec require, so a token minted for this server cannot be replayed at another.
fn decode<T: serde::de::DeserializeOwned>(
    token: &str,
    issuer: &str,
    audience: Option<&str>,
) -> Result<T> {
    let secret = secret()?;
    let mut validation = jwt::Validation::new(jwt::Algorithm::HS256);
    validation.set_issuer(&[issuer]);
    validation.set_required_spec_claims(&["exp", "iss"]);
    match audience {
        Some(audience) => validation.set_audience(&[audience]),
        // Left on, the default rejects any token that merely *carries* an `aud`.
        None => validation.validate_aud = false,
    }
    let data = jwt::decode::<T>(
        token,
        &jwt::DecodingKey::from_secret(secret.as_ref()),
        &validation,
    )
    .context("the token is not valid")?;
    Ok(data.claims)
}

fn now() -> i64 {
    Utc::now().timestamp()
}

/// A registered client, carried inside its own `client_id`.
#[derive(Debug, Serialize, Deserialize)]
struct ClientClaims {
    typ: String,
    iss: String,
    exp: i64,
    iat: i64,
    name: String,
    uris: Vec<String>,
}

/// An authorization code. Everything the token endpoint must check is in here, which is what
/// lets the code be redeemed without any server-side record of having issued it.
#[derive(Debug, Serialize, Deserialize)]
struct CodeClaims {
    typ: String,
    iss: String,
    exp: i64,
    sub: String,
    /// The `client_id` this was issued to, verbatim.
    cid: String,
    /// The exact redirect URI used, which the token request must repeat.
    red: String,
    /// The PKCE challenge; the verifier arrives at the token endpoint.
    chal: String,
    /// The resource the eventual access token will be bound to.
    res: String,
    scope: String,
    /// Random, so two codes issued in the same second are different tokens.
    jti: String,
}

/// An access or refresh token. `typ` is what keeps one from being used as the other.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessClaims {
    pub typ: String,
    pub iss: String,
    pub exp: i64,
    pub sub: String,
    pub aud: String,
    pub cid: String,
    pub scope: String,
    /// Random, so no two tokens are the same string. Without it every claim here is
    /// deterministic and two refreshes within one second returned byte-identical tokens, which
    /// made the rotation below a no-op.
    pub jti: String,
}

// ---------------------------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------------------------

/// A client, however it identified itself.
#[derive(Clone, Debug)]
struct RegisteredClient {
    name: String,
    redirect_uris: Vec<String>,
}

impl RegisteredClient {
    /// Whether every redirect URI this client declared is a loopback address.
    ///
    /// Such a client is something running on the machine in front of the user rather than a
    /// hosted service, which is worth saying on the consent page: the authorization lands on
    /// whatever is listening on that port.
    fn is_loopback_only(&self) -> bool {
        self.redirect_uris.iter().all(|uri| {
            reqwest::Url::parse(uri).is_ok_and(|url| is_loopback_redirect(&url))
        })
    }

    /// The registered URI matching `requested`, or `None`.
    ///
    /// Exact string match, with one exception the specs require: a loopback redirect matches
    /// port-agnostically (RFC 8252 §7.3), because a native client binds whatever ephemeral port
    /// it can get and cannot know it at registration time. Without this Claude Code cannot
    /// connect at all.
    fn match_redirect(&self, requested: &str) -> Option<String> {
        if self.redirect_uris.iter().any(|uri| uri == requested) {
            return Some(requested.to_owned());
        }
        let wanted = reqwest::Url::parse(requested).ok()?;
        if !is_loopback_redirect(&wanted) {
            return None;
        }
        self.redirect_uris.iter().find_map(|uri| {
            let registered = reqwest::Url::parse(uri).ok()?;
            let same_host_ignoring_port = is_loopback_redirect(&registered)
                && registered.scheme() == wanted.scheme()
                && registered.host_str() == wanted.host_str()
                && registered.path() == wanted.path()
                && registered.query() == wanted.query();
            same_host_ignoring_port.then(|| requested.to_owned())
        })
    }
}

fn is_loopback_redirect(url: &reqwest::Url) -> bool {
    if url.scheme() != "http" {
        return false;
    }
    match url.host_str() {
        Some("localhost") => true,
        Some(host) => {
            let literal = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(host);
            literal.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
        },
        None => false,
    }
}

/// Whether a URI is one this server will ever redirect an authorization to.
///
/// `https://` anywhere, or `http://` on loopback. A public client redirecting over plain http to
/// somewhere that is not the user's own machine would hand the code to the network.
fn is_acceptable_redirect_uri(uri: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(uri) else {
        return false;
    };
    if url.fragment().is_some() {
        return false;
    }
    url.scheme() == "https" || is_loopback_redirect(&url)
}

// ---------------------------------------------------------------------------------------------
// Dynamic client registration (RFC 7591)
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RegistrationRequest {
    #[serde(default)]
    redirect_uris: Vec<String>,
    client_name: Option<String>,
}

#[derive(Debug, Serialize)]
struct RegistrationResponse {
    client_id: String,
    client_id_issued_at: i64,
    redirect_uris: Vec<String>,
    client_name: String,
    token_endpoint_auth_method: &'static str,
    grant_types: Vec<&'static str>,
    response_types: Vec<&'static str>,
    scope: String,
}

#[derive(Debug, Serialize)]
struct OauthErrorBody {
    error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_description: Option<String>,
}

fn oauth_error(status: StatusCode, error: &str, description: &str) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, "no-store")],
        Json(OauthErrorBody {
            error: error.to_owned(),
            error_description: Some(description.to_owned()),
        }),
    )
        .into_response()
}

pub async fn post_register(
    extract::State(state): extract::State<OauthState>,
    payload: std::result::Result<Json<RegistrationRequest>, extract::rejection::JsonRejection>,
) -> Response {
    let Ok(Json(request)) = payload else {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_client_metadata",
            "The registration request must be a JSON object.",
        );
    };

    if request.redirect_uris.is_empty() || request.redirect_uris.len() > MAX_REDIRECT_URIS {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_redirect_uri",
            "Between one and ten redirect URIs are required.",
        );
    }
    if let Some(bad) = request.redirect_uris.iter().find(|uri| !is_acceptable_redirect_uri(uri)) {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_redirect_uri",
            &format!("{bad} is not an https:// URI or a loopback http:// URI."),
        );
    }

    let name = request
        .client_name
        .unwrap_or_else(|| "an unnamed client".to_owned())
        .chars()
        .take(MAX_CLIENT_NAME)
        .collect::<String>();
    let issued_at = now();
    let claims = ClientClaims {
        typ: "mcp_client".to_owned(),
        iss: state.config.issuer.clone(),
        iat: issued_at,
        exp: issued_at + CLIENT_TTL.num_seconds(),
        name: name.clone(),
        uris: request.redirect_uris.clone(),
    };
    let client_id = match encode(&claims) {
        Ok(client_id) => client_id,
        Err(e) => {
            tracing::error!("Failed to issue a client_id: {:?}", e);
            return oauth_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "The registration could not be signed.",
            );
        },
    };

    tracing::info!("Registered the MCP client {:?}", name);
    (
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(RegistrationResponse {
            client_id,
            client_id_issued_at: issued_at,
            redirect_uris: request.redirect_uris,
            client_name: name,
            token_endpoint_auth_method: "none",
            grant_types: vec!["authorization_code", "refresh_token"],
            response_types: vec!["code"],
            scope: SUPPORTED_SCOPES.join(" "),
        }),
    )
        .into_response()
}

// ---------------------------------------------------------------------------------------------
// Client ID metadata documents
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ClientIdMetadataDocument {
    client_id: String,
    #[serde(default)]
    client_name: Option<String>,
    #[serde(default)]
    redirect_uris: Vec<String>,
}

/// Resolve a `client_id` to the client it names.
///
/// Two spellings are accepted. A registered client is a signed `mcp_client` JWT and needs no
/// network at all. A client ID metadata document is an `https://` URL naming a JSON document
/// that describes the client -- which is how Claude Code identifies itself, and what the
/// 2026-07-28 spec prefers over registration.
async fn resolve_client(state: &OauthState, client_id: &str) -> Result<RegisteredClient> {
    if client_id.starts_with("https://") {
        return fetch_client_id_metadata(state, client_id).await;
    }
    let claims: ClientClaims = decode(client_id, &state.config.issuer, None)
        .context("the client_id is not one this server issued")?;
    if claims.typ != "mcp_client" {
        bail!("the client_id is not a client registration");
    }
    Ok(RegisteredClient {
        name: claims.name,
        redirect_uris: claims.uris,
    })
}

async fn fetch_client_id_metadata(state: &OauthState, url: &str) -> Result<RegisteredClient> {
    if let Some(cached) = state.cimd_cache.lock().unwrap().get(url) {
        if cached.fetched_at.elapsed() < CIMD_CACHE_TTL {
            return Ok(cached.client.clone());
        }
    }

    let parsed = reqwest::Url::parse(url).context("the client_id is not a URL")?;
    // The same guard the calendar feeds go through: a client_id is a URL a stranger chose, and
    // fetching it must not become a way to probe this host's private network.
    if !crate::v2::is_fetchable_feed_url(&parsed) {
        bail!("a client_id URL must be https:// on a public host");
    }

    let response = state
        .app
        .http_client
        .get(parsed)
        .header(header::ACCEPT, "application/json")
        .timeout(CIMD_TIMEOUT)
        .send()
        .await
        .context("the client_id document could not be fetched")?;
    if !response.status().is_success() {
        bail!("the client_id document responded {}", response.status());
    }
    if response.content_length().is_some_and(|len| len as usize > MAX_CIMD_BYTES) {
        bail!("the client_id document is too large");
    }
    let body = response.text().await.context("the client_id document is not text")?;
    if body.len() > MAX_CIMD_BYTES {
        bail!("the client_id document is too large");
    }
    let document: ClientIdMetadataDocument =
        serde_json::from_str(&body).context("the client_id document is not valid JSON")?;

    // A document that names a different client_id is describing someone else.
    if document.client_id != url {
        bail!("the client_id document declares a different client_id");
    }
    if document.redirect_uris.is_empty() || document.redirect_uris.len() > MAX_REDIRECT_URIS {
        bail!("the client_id document declares no usable redirect URIs");
    }
    if let Some(bad) = document.redirect_uris.iter().find(|uri| !is_acceptable_redirect_uri(uri)) {
        bail!("the client_id document declares the unusable redirect URI {bad}");
    }

    let client = RegisteredClient {
        name: document
            .client_name
            .unwrap_or_else(|| url.to_owned())
            .chars()
            .take(MAX_CLIENT_NAME)
            .collect(),
        redirect_uris: document.redirect_uris,
    };
    state.cimd_cache.lock().unwrap().insert(
        url.to_owned(),
        CachedClient { client: client.clone(), fetched_at: Instant::now() },
    );
    Ok(client)
}

// ---------------------------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------------------------

/// The authorization request, as it arrives on the query string and again in the consent form.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct AuthorizeRequest {
    #[serde(default)]
    pub response_type: String,
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub redirect_uri: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub code_challenge: Option<String>,
    #[serde(default)]
    pub code_challenge_method: Option<String>,
    #[serde(default)]
    pub resource: Option<String>,
}

/// The consent form: the authorization request, plus what the user typed.
#[derive(Debug, Deserialize)]
pub struct ConsentForm {
    #[serde(flatten)]
    request: AuthorizeRequest,
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
    /// Present when the user pressed Allow; absent when they pressed Deny.
    #[serde(default)]
    approve: Option<String>,
}

/// An authorization request that cannot be answered.
///
/// The distinction matters: until the client and its redirect URI are known to be genuine there
/// is nowhere safe to send an error, so it has to be shown to the user instead. Redirecting an
/// error to an unverified URI is how an open redirector is built.
enum AuthorizeRejection {
    Page { status: StatusCode, message: String },
    Redirect { uri: String, error: &'static str, description: String, state: Option<String> },
}

impl IntoResponse for AuthorizeRejection {
    fn into_response(self) -> Response {
        match self {
            AuthorizeRejection::Page { status, message } => {
                (status, Html(error_page(&message))).into_response()
            },
            AuthorizeRejection::Redirect { uri, error, description, state } => {
                let mut params = vec![
                    ("error", error),
                    ("error_description", description.as_str()),
                ];
                if let Some(state) = &state {
                    params.push(("state", state));
                }
                match build_redirect(&uri, &params) {
                    Ok(location) => Redirect::to(&location).into_response(),
                    Err(e) => {
                        tracing::error!("Failed to build an error redirect: {:?}", e);
                        (
                            StatusCode::BAD_REQUEST,
                            Html(error_page("The redirect URI could not be used.")),
                        )
                            .into_response()
                    },
                }
            },
        }
    }
}

/// Append query parameters to a redirect URI, keeping whatever it already carried.
///
/// The parameters go on the query string rather than the fragment because this server issues
/// authorization codes only; OAuth 2.1 has no response type that would want a fragment.
fn build_redirect(uri: &str, params: &[(&str, &str)]) -> Result<String> {
    let mut url = reqwest::Url::parse(uri).context("the redirect URI is not a URL")?;
    {
        let mut pairs = url.query_pairs_mut();
        for (name, value) in params {
            pairs.append_pair(name, value);
        }
    }
    Ok(url.into())
}

/// What the request asked for, once it is known to be answerable.
struct ApprovedRequest {
    client: RegisteredClient,
    redirect_uri: String,
    scope: String,
    resource: String,
    code_challenge: String,
    state: Option<String>,
}

/// Validate an authorization request as far as it can be validated without the user.
///
/// The order is the point. The client and the redirect URI are settled first, because every
/// later failure is reported by redirecting to that URI; a failure before that is shown as a
/// page instead.
async fn check_authorize_request(
    state: &OauthState,
    request: &AuthorizeRequest,
) -> std::result::Result<ApprovedRequest, AuthorizeRejection> {
    let page = |status: StatusCode, message: &str| AuthorizeRejection::Page {
        status,
        message: message.to_owned(),
    };

    if request.client_id.is_empty() {
        return Err(page(StatusCode::BAD_REQUEST, "The request names no client."));
    }
    let client = match resolve_client(state, &request.client_id).await {
        Ok(client) => client,
        Err(e) => {
            tracing::debug!("Unknown client {:?}: {:#}", request.client_id, e);
            return Err(page(
                StatusCode::BAD_REQUEST,
                "This client is not one this server recognises. \
                 Try removing and re-adding the connector.",
            ));
        },
    };

    let redirect_uri = match request.redirect_uri.as_deref() {
        Some(requested) => match client.match_redirect(requested) {
            Some(uri) => uri,
            None => {
                tracing::debug!("Client {:?} asked for the unregistered redirect {requested}", client.name);
                return Err(page(
                    StatusCode::BAD_REQUEST,
                    "This client asked to be sent somewhere it has not registered.",
                ));
            },
        },
        // Omitting it is only unambiguous when the client registered exactly one.
        None if client.redirect_uris.len() == 1 => client.redirect_uris[0].clone(),
        None => {
            return Err(page(
                StatusCode::BAD_REQUEST,
                "This client registered several redirect URIs and named none of them.",
            ))
        },
    };

    let redirect = |error: &'static str, description: String| AuthorizeRejection::Redirect {
        uri: redirect_uri.clone(),
        error,
        description,
        state: request.state.clone(),
    };

    if request.response_type != "code" {
        return Err(redirect(
            "unsupported_response_type",
            "This server issues authorization codes only.".to_owned(),
        ));
    }
    if request.code_challenge_method.as_deref() != Some("S256") {
        return Err(redirect(
            "invalid_request",
            "PKCE with code_challenge_method=S256 is required.".to_owned(),
        ));
    }
    let Some(code_challenge) = request.code_challenge.clone().filter(|c| !c.is_empty()) else {
        return Err(redirect(
            "invalid_request",
            "A code_challenge is required.".to_owned(),
        ));
    };

    // Absent, `scope` means the read/write pair plus a refresh token, which is what a connector
    // wants and what the consent page then says out loud.
    let scope = match request.scope.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(requested) => {
            if let Some(bad) = requested
                .split_whitespace()
                .find(|scope| !SUPPORTED_SCOPES.contains(scope))
            {
                return Err(redirect(
                    "invalid_scope",
                    format!("This server does not grant the scope {bad}."),
                ));
            }
            requested.split_whitespace().collect::<Vec<_>>().join(" ")
        },
        None => SUPPORTED_SCOPES.join(" "),
    };

    // RFC 8707: the token must be bound to the resource it will be presented to, and this server
    // serves exactly one.
    let resource = match request.resource.as_deref().map(str::trim).filter(|r| !r.is_empty()) {
        Some(requested) if canonical_resource_matches(requested, &state.config.resource) => {
            state.config.resource.clone()
        },
        Some(requested) => {
            return Err(redirect(
                "invalid_target",
                format!(
                    "This server issues tokens for {} only, not {requested}.",
                    state.config.resource,
                ),
            ))
        },
        None => state.config.resource.clone(),
    };

    Ok(ApprovedRequest {
        client,
        redirect_uri,
        scope,
        resource,
        code_challenge,
        state: request.state.clone(),
    })
}

/// Whether a requested resource names this server's MCP endpoint.
///
/// A trailing slash is the one difference tolerated: clients disagree about whether the canonical
/// URI carries one, and refusing over it would be a connection failure with no useful message.
fn canonical_resource_matches(requested: &str, canonical: &str) -> bool {
    requested.trim_end_matches('/') == canonical.trim_end_matches('/')
}

pub async fn get_authorize(
    extract::State(state): extract::State<OauthState>,
    extract::Query(request): extract::Query<AuthorizeRequest>,
) -> Response {
    match check_authorize_request(&state, &request).await {
        Ok(approved) => Html(consent_page(&state, &request, &approved, None)).into_response(),
        Err(rejection) => rejection.into_response(),
    }
}

pub async fn post_authorize(
    extract::State(state): extract::State<OauthState>,
    extract::Form(form): extract::Form<ConsentForm>,
) -> Response {
    let approved = match check_authorize_request(&state, &form.request).await {
        Ok(approved) => approved,
        Err(rejection) => return rejection.into_response(),
    };

    if form.approve.is_none() {
        return AuthorizeRejection::Redirect {
            uri: approved.redirect_uri,
            error: "access_denied",
            description: "The request was declined.".to_owned(),
            state: approved.state,
        }
        .into_response();
    }

    if !credentials_are_valid(&form.username, &form.password) {
        tracing::warn!("A failed MCP consent for the client {:?}", approved.client.name);
        return (
            StatusCode::UNAUTHORIZED,
            Html(consent_page(
                &state,
                &form.request,
                &approved,
                Some("That username and password did not match."),
            )),
        )
            .into_response();
    }

    let claims = CodeClaims {
        typ: "mcp_code".to_owned(),
        iss: state.config.issuer.clone(),
        exp: now() + CODE_TTL.num_seconds(),
        sub: form.username,
        cid: form.request.client_id.clone(),
        red: approved.redirect_uri.clone(),
        chal: approved.code_challenge,
        res: approved.resource,
        scope: approved.scope,
        jti: uuid::Uuid::new_v4().to_string(),
    };
    let code = match encode(&claims) {
        Ok(code) => code,
        Err(e) => {
            tracing::error!("Failed to issue an authorization code: {:?}", e);
            return AuthorizeRejection::Redirect {
                uri: approved.redirect_uri,
                error: "server_error",
                description: "The authorization code could not be signed.".to_owned(),
                state: approved.state,
            }
            .into_response();
        },
    };

    tracing::info!("Authorized the MCP client {:?}", approved.client.name);
    let mut params = vec![("code", code.as_str())];
    if let Some(client_state) = &approved.state {
        params.push(("state", client_state));
    }
    match build_redirect(&approved.redirect_uri, &params) {
        Ok(location) => {
            ([(header::CACHE_CONTROL, "no-store")], Redirect::to(&location)).into_response()
        },
        Err(e) => {
            tracing::error!("Failed to build the success redirect: {:?}", e);
            (
                StatusCode::BAD_REQUEST,
                Html(error_page("The redirect URI could not be used.")),
            )
                .into_response()
        },
    }
}

/// The same argon2 check `post_login` makes, against the one configured user.
fn credentials_are_valid(username: &str, password: &str) -> bool {
    let (Ok(expected_user), Ok(hash)) =
        (env::var("MORIED_USER_NAME"), env::var("MORIED_USER_HASH"))
    else {
        tracing::error!("MORIED_USER_NAME or MORIED_USER_HASH is not set");
        return false;
    };
    if username != expected_user {
        return false;
    }
    argon2::verify_encoded(&hash, password.as_bytes()).unwrap_or(false)
}

// ---------------------------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct TokenRequest {
    #[serde(default)]
    grant_type: String,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    redirect_uri: Option<String>,
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    code_verifier: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    resource: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TokenResponse {
    access_token: String,
    token_type: &'static str,
    expires_in: i64,
    refresh_token: String,
    scope: String,
}

pub async fn post_token(
    extract::State(state): extract::State<OauthState>,
    extract::Form(request): extract::Form<TokenRequest>,
) -> Response {
    let granted = match request.grant_type.as_str() {
        "authorization_code" => grant_authorization_code(&state.config, &request),
        "refresh_token" => grant_refresh_token(&state.config, &request),
        other => {
            return oauth_error(
                StatusCode::BAD_REQUEST,
                "unsupported_grant_type",
                &format!("This server does not support the {other} grant."),
            )
        },
    };

    let granted = match granted {
        Ok(granted) => granted,
        Err(failure) => return failure.into_response(),
    };

    match issue_tokens(&state.config, &granted) {
        Ok(tokens) => (
            [
                (header::CACHE_CONTROL, "no-store"),
                (header::PRAGMA, "no-cache"),
            ],
            Json(tokens),
        )
            .into_response(),
        Err(e) => {
            tracing::error!("Failed to sign the tokens: {:?}", e);
            oauth_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "The tokens could not be signed.",
            )
        },
    }
}

/// Mint the access/refresh pair for a grant that has already been checked.
///
/// The refresh token is rotated: every refresh hands back a distinct token, dated from now, so a
/// connection that stays in use never rests on the token it was first given. Being stateless, this
/// server cannot also *invalidate* the token that was spent -- it stays valid until it expires.
/// Cutting a client off before then means rotating `MORIED_SECRET`.
fn issue_tokens(config: &McpConfig, granted: &Granted) -> Result<TokenResponse> {
    let issued = now();
    let access = AccessClaims {
        typ: "mcp_access".to_owned(),
        iss: config.issuer.clone(),
        exp: issued + ACCESS_TTL.num_seconds(),
        sub: granted.subject.clone(),
        aud: granted.resource.clone(),
        cid: granted.client_id.clone(),
        scope: granted.scope.clone(),
        jti: uuid::Uuid::new_v4().to_string(),
    };
    let refresh = AccessClaims {
        typ: "mcp_refresh".to_owned(),
        exp: issued + REFRESH_TTL.num_seconds(),
        jti: uuid::Uuid::new_v4().to_string(),
        ..access.clone()
    };
    Ok(TokenResponse {
        access_token: encode(&access)?,
        token_type: "Bearer",
        expires_in: ACCESS_TTL.num_seconds(),
        refresh_token: encode(&refresh)?,
        scope: granted.scope.clone(),
    })
}

/// A token request that cannot be granted, in the shape RFC 6749 §5.2 defines.
#[derive(Debug)]
struct TokenFailure {
    error: &'static str,
    description: String,
}

impl TokenFailure {
    fn new(error: &'static str, description: impl Into<String>) -> Self {
        Self { error, description: description.into() }
    }
}

impl IntoResponse for TokenFailure {
    fn into_response(self) -> Response {
        let status = match self.error {
            "invalid_client" => StatusCode::UNAUTHORIZED,
            _ => StatusCode::BAD_REQUEST,
        };
        oauth_error(status, self.error, &self.description)
    }
}

/// What a grant established: who, for which client, with what permission, at which resource.
struct Granted {
    subject: String,
    client_id: String,
    scope: String,
    resource: String,
}

fn grant_authorization_code(
    config: &McpConfig,
    request: &TokenRequest,
) -> std::result::Result<Granted, TokenFailure> {
    let Some(code) = request.code.as_deref() else {
        return Err(TokenFailure::new("invalid_request", "A code is required."));
    };
    let Some(verifier) = request.code_verifier.as_deref() else {
        return Err(TokenFailure::new("invalid_request", "A code_verifier is required."));
    };

    let claims: CodeClaims = decode(code, &config.issuer, None)
        .map_err(|e| {
            tracing::debug!("Rejected an authorization code: {:#}", e);
            TokenFailure::new("invalid_grant", "The authorization code is not valid.")
        })?;
    if claims.typ != "mcp_code" {
        return Err(TokenFailure::new("invalid_grant", "That token is not an authorization code."));
    }

    // The code was issued to one client, for one redirect URI. Both must be repeated, which is
    // what stops a code intercepted in one client's redirect from being spent by another.
    if request.client_id.as_deref() != Some(claims.cid.as_str()) {
        return Err(TokenFailure::new(
            "invalid_grant",
            "The authorization code was issued to a different client.",
        ));
    }
    // Omitting `redirect_uri` is allowed only when the authorization request omitted it too;
    // here it was always resolved to a concrete URI, so it must be repeated.
    if request.redirect_uri.as_deref() != Some(claims.red.as_str()) {
        return Err(TokenFailure::new(
            "invalid_grant",
            "The redirect URI does not match the one the code was issued for.",
        ));
    }
    if let Some(requested) = request.resource.as_deref().filter(|r| !r.is_empty()) {
        if !canonical_resource_matches(requested, &claims.res) {
            return Err(TokenFailure::new(
                "invalid_target",
                "The resource does not match the one the code was issued for.",
            ));
        }
    }
    if !pkce_matches(verifier, &claims.chal) {
        return Err(TokenFailure::new("invalid_grant", "The code_verifier does not match."));
    }

    Ok(Granted {
        subject: claims.sub,
        client_id: claims.cid,
        scope: claims.scope,
        resource: claims.res,
    })
}

fn grant_refresh_token(
    config: &McpConfig,
    request: &TokenRequest,
) -> std::result::Result<Granted, TokenFailure> {
    let Some(token) = request.refresh_token.as_deref() else {
        return Err(TokenFailure::new("invalid_request", "A refresh_token is required."));
    };

    // A refresh token is audience-bound like an access token, so validation names the resource.
    let claims: AccessClaims = decode(token, &config.issuer, Some(&config.resource))
        .map_err(|e| {
            tracing::debug!("Rejected a refresh token: {:#}", e);
            TokenFailure::new("invalid_grant", "The refresh token is not valid.")
        })?;
    if claims.typ != "mcp_refresh" {
        return Err(TokenFailure::new("invalid_grant", "That token is not a refresh token."));
    }
    if let Some(client_id) = request.client_id.as_deref() {
        if client_id != claims.cid {
            return Err(TokenFailure::new(
                "invalid_grant",
                "The refresh token was issued to a different client.",
            ));
        }
    }

    // A refresh may narrow the scope it carries, never widen it (RFC 6749 §6).
    let scope = match request.scope.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(requested) => {
            let held = claims.scope.split_whitespace().collect::<Vec<_>>();
            if let Some(bad) = requested.split_whitespace().find(|s| !held.contains(s)) {
                return Err(TokenFailure::new(
                    "invalid_scope",
                    format!("The refresh token does not carry the scope {bad}."),
                ));
            }
            requested.split_whitespace().collect::<Vec<_>>().join(" ")
        },
        None => claims.scope.clone(),
    };

    Ok(Granted {
        subject: claims.sub,
        client_id: claims.cid,
        scope,
        resource: claims.aud,
    })
}

/// PKCE S256: the challenge is the base64url-unpadded SHA-256 of the verifier.
fn pkce_matches(verifier: &str, challenge: &str) -> bool {
    if !(43..=128).contains(&verifier.len()) {
        return false;
    }
    let digest = Sha256::digest(verifier.as_bytes());
    let computed = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
    // Length-independent comparison is pointless here -- the challenge is public -- but the
    // trailing-padding tolerance is not: some clients send the padded spelling.
    computed == challenge.trim_end_matches('=')
}

// ---------------------------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------------------------

#[derive(Serialize)]
struct ProtectedResourceMetadata<'a> {
    resource: &'a str,
    authorization_servers: [&'a str; 1],
    scopes_supported: [&'a str; 3],
    bearer_methods_supported: [&'a str; 1],
}

#[derive(Serialize)]
struct AuthorizationServerMetadata<'a> {
    issuer: &'a str,
    authorization_endpoint: &'a str,
    token_endpoint: &'a str,
    registration_endpoint: &'a str,
    response_types_supported: [&'a str; 1],
    grant_types_supported: [&'a str; 2],
    code_challenge_methods_supported: [&'a str; 1],
    token_endpoint_auth_methods_supported: [&'a str; 1],
    scopes_supported: [&'a str; 3],
    client_id_metadata_document_supported: bool,
}

async fn get_protected_resource_metadata(
    extract::State(state): extract::State<OauthState>,
) -> Response {
    Json(ProtectedResourceMetadata {
        resource: &state.config.resource,
        authorization_servers: [&state.config.issuer],
        scopes_supported: SUPPORTED_SCOPES,
        bearer_methods_supported: ["header"],
    })
    .into_response()
}

async fn get_authorization_server_metadata(
    extract::State(state): extract::State<OauthState>,
) -> Response {
    Json(AuthorizationServerMetadata {
        issuer: &state.config.issuer,
        authorization_endpoint: &state.config.authorization_endpoint,
        token_endpoint: &state.config.token_endpoint,
        registration_endpoint: &state.config.registration_endpoint,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: SUPPORTED_SCOPES,
        client_id_metadata_document_supported: true,
    })
    .into_response()
}

// ---------------------------------------------------------------------------------------------
// Resource server
// ---------------------------------------------------------------------------------------------

/// Reject anything reaching `/v2/mcp` without a valid, audience-bound access token.
///
/// The 401 carries the `resource_metadata` pointer RFC 9728 defines, which is how a connector
/// added by URL alone discovers where to authorize.
pub async fn mcp_auth(
    extract::State(state): extract::State<OauthState>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let presented = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty());

    let Some(token) = presented else {
        return unauthorized(&state, "A bearer token is required.");
    };
    let claims: AccessClaims =
        match decode(token, &state.config.issuer, Some(&state.config.resource)) {
            Ok(claims) => claims,
            Err(e) => {
                tracing::debug!("Rejected an MCP access token: {:#}", e);
                return unauthorized(&state, "The access token is not valid.");
            },
        };
    if claims.typ != "mcp_access" {
        return unauthorized(&state, "That token is not an access token.");
    }
    if !claims.has_scope(SCOPE_READ) {
        return forbidden(&state, "This token does not carry the notes:read scope.");
    }

    // Tools read the granted scopes from here, which is what lets a read-only token run the read
    // tools and be refused by the write ones.
    req.extensions_mut().insert(Arc::new(claims));
    next.run(req).await
}

fn www_authenticate(state: &OauthState, error: &str, description: &str) -> String {
    format!(
        "Bearer error=\"{error}\", error_description=\"{description}\", \
         resource_metadata=\"{}\", scope=\"{} {}\"",
        state.config.resource_metadata, SCOPE_READ, SCOPE_WRITE,
    )
}

fn unauthorized(state: &OauthState, description: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [(
            header::WWW_AUTHENTICATE,
            www_authenticate(state, "invalid_token", description),
        )],
        Json(OauthErrorBody {
            error: "invalid_token".to_owned(),
            error_description: Some(description.to_owned()),
        }),
    )
        .into_response()
}

fn forbidden(state: &OauthState, description: &str) -> Response {
    (
        StatusCode::FORBIDDEN,
        [(
            header::WWW_AUTHENTICATE,
            www_authenticate(state, "insufficient_scope", description),
        )],
        Json(OauthErrorBody {
            error: "insufficient_scope".to_owned(),
            error_description: Some(description.to_owned()),
        }),
    )
        .into_response()
}

// ---------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// The one stylesheet both pages share. Self-contained: the backend serves no static files, and
/// a consent page that depends on where the Vue app is deployed would be a page that sometimes
/// arrives unstyled.
const PAGE_STYLE: &str = "\
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center;
  justify-content: center; background: #f4f4f5; color: #18181b;
  font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
main { background: #fff; max-width: 26rem; width: calc(100% - 2rem); margin: 2rem 1rem;
  padding: 1.75rem; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
h1 { font-size: 1.15rem; margin: 0 0 1rem; }
dl { margin: 0 0 1.25rem; display: grid; grid-template-columns: auto 1fr; gap: .4rem .75rem; }
dt { color: #52525b; }
dd { margin: 0; overflow-wrap: anywhere; }
ul { margin: .25rem 0 1.25rem; padding-left: 1.25rem; }
label { display: block; margin-bottom: .75rem; }
label span { display: block; color: #52525b; margin-bottom: .25rem; }
input[type=text], input[type=password] { width: 100%; box-sizing: border-box; padding: .5rem;
  border: 1px solid #d4d4d8; border-radius: 6px; font: inherit; background: #fff; color: inherit; }
.actions { display: flex; gap: .75rem; margin-top: 1.25rem; }
button { flex: 1; padding: .6rem; border-radius: 6px; border: 1px solid transparent;
  font: inherit; cursor: pointer; }
button[name=approve] { background: #2563eb; color: #fff; }
button.secondary { background: transparent; border-color: #d4d4d8; color: inherit; }
.warn { background: #fef3c7; color: #713f12; padding: .6rem .75rem; border-radius: 6px;
  margin-bottom: 1rem; }
.error { background: #fee2e2; color: #7f1d1d; padding: .6rem .75rem; border-radius: 6px;
  margin-bottom: 1rem; }
@media (prefers-color-scheme: dark) {
  body { background: #18181b; color: #f4f4f5; }
  main { background: #27272a; box-shadow: none; }
  dt, label span { color: #a1a1aa; }
  input[type=text], input[type=password] { background: #18181b; border-color: #3f3f46; }
  .warn { background: #422006; color: #fde68a; }
  .error { background: #450a0a; color: #fecaca; }
}";

fn page(title: &str, body: &str) -> String {
    format!(
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <title>{}</title><style>{}</style></head><body><main>{}</main></body></html>",
        escape(title),
        PAGE_STYLE,
        body,
    )
}

fn error_page(message: &str) -> String {
    page(
        "Authorization failed — mory",
        &format!("<h1>Authorization failed</h1><p>{}</p>", escape(message)),
    )
}

/// What each scope actually permits, in the terms the user thinks in.
fn describe_scope(scope: &str) -> &'static str {
    match scope {
        SCOPE_READ => "Read your notes, tasks and calendar",
        SCOPE_WRITE => "Create, edit, rename and delete notes",
        SCOPE_OFFLINE => "Stay connected without asking you again",
        _ => "An unrecognised permission",
    }
}

fn consent_page(
    state: &OauthState,
    request: &AuthorizeRequest,
    approved: &ApprovedRequest,
    error: Option<&str>,
) -> String {
    // Showing the redirect host is a spec MUST: it is the only part of the request that says
    // where the authorization actually ends up, and it is not implied by the client's name.
    let redirect_host = reqwest::Url::parse(&approved.redirect_uri)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| approved.redirect_uri.clone());

    let scopes = approved
        .scope
        .split_whitespace()
        .map(|scope| {
            format!(
                "<li>{} <small>({})</small></li>",
                escape(describe_scope(scope)),
                escape(scope),
            )
        })
        .collect::<String>();

    let loopback_warning = if approved.client.is_loopback_only() {
        "<p class=\"warn\">This client redirects to your own machine. \
         Approve it only if you just started it yourself.</p>"
    } else {
        ""
    };
    let error_banner = error
        .map(|message| format!("<p class=\"error\">{}</p>", escape(message)))
        .unwrap_or_default();

    // Every parameter travels on as a hidden field, so the POST is validated against exactly the
    // request the user was shown rather than anything the form could smuggle past them.
    let mut hidden = String::new();
    let mut carry = |name: &str, value: &str| {
        hidden.push_str(&format!(
            "<input type=\"hidden\" name=\"{}\" value=\"{}\">",
            name,
            escape(value),
        ));
    };
    carry("response_type", &request.response_type);
    carry("client_id", &request.client_id);
    carry("redirect_uri", &approved.redirect_uri);
    carry("scope", &approved.scope);
    carry("resource", &approved.resource);
    carry("code_challenge", &approved.code_challenge);
    carry("code_challenge_method", "S256");
    if let Some(client_state) = &approved.state {
        carry("state", client_state);
    }

    page(
        "Connect to mory",
        &format!(
            "<h1>Connect {name} to mory</h1>\
             {error_banner}{loopback_warning}\
             <dl><dt>Application</dt><dd>{name}</dd>\
             <dt>Redirects to</dt><dd>{host}</dd>\
             <dt>Notes</dt><dd>{resource}</dd></dl>\
             <p>It is asking to:</p><ul>{scopes}</ul>\
             <form method=\"post\" action=\"{action}\">{hidden}\
             <label><span>Username</span>\
             <input type=\"text\" name=\"username\" autocomplete=\"username\" autofocus required></label>\
             <label><span>Password</span>\
             <input type=\"password\" name=\"password\" autocomplete=\"current-password\" required></label>\
             <div class=\"actions\">\
             <button type=\"submit\" name=\"approve\" value=\"yes\">Allow</button>\
             <button type=\"submit\" class=\"secondary\">Deny</button></div></form>",
            name = escape(&approved.client.name),
            host = escape(&redirect_host),
            resource = escape(&state.config.resource),
            action = escape(&state.config.authorization_endpoint),
            error_banner = error_banner,
            loopback_warning = loopback_warning,
            scopes = scopes,
            hidden = hidden,
        ),
    )
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

/// The OAuth endpoints and the discovery documents, relative to `MORIED_ROOT_PATH`.
pub fn routes(state: OauthState) -> Router {
    Router::new()
        .route("/oauth/register", post(post_register))
        .route(
            "/oauth/authorize",
            get(get_authorize).post(post_authorize).layer(consent_throttle()),
        )
        .route("/oauth/token", post(post_token))
        .merge(well_known_routes())
        .with_state(state)
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(SetSensitiveHeadersLayer::new(once(header::AUTHORIZATION)))
                // Deliberately wider than the app's own CORS policy, and deliberately without
                // credentials: RFC 8414 and RFC 9728 both expect these documents to be readable
                // by a browser-based client from any origin, and none of them is a URL where a
                // cookie would mean anything.
                .layer(
                    CorsLayer::new()
                        .allow_origin(cors::Any)
                        .allow_methods([Method::GET, Method::POST])
                        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]),
                ),
        )
}

/// One authorization attempt every few seconds, shedding the rest.
///
/// This is the same stack `/login` has carried since long before MCP, for the same reason: both
/// endpoints verify the one configured password against the one argon2 hash, and an unthrottled
/// one is a guessing oracle. Without it this endpoint answered ten wrong passwords in 565 ms.
///
/// It covers the `GET` as well as the `POST`, which closes a second hole: resolving a `client_id`
/// that is a URL fetches that URL, so an unthrottled authorize endpoint is also a way to make
/// this server hammer somebody else's.
///
/// The limit is global rather than per-caller, again matching `/login`. For a single-user app
/// reached through one reverse proxy there is no per-caller to speak of, and the cost of being
/// wrong about that is a legitimate retry waiting a few seconds.
fn consent_throttle() -> impl tower::Layer<
    axum::routing::Route,
    Service = impl tower::Service<
        axum::http::Request<Body>,
        Response = Response,
        Error = std::convert::Infallible,
        Future = impl Send,
    > + Clone
              + Send,
> + Clone
       + Send {
    ServiceBuilder::new()
        .layer(HandleErrorLayer::new(|_: BoxError| async {
            // Too many requests
            StatusCode::SERVICE_UNAVAILABLE
        }))
        .load_shed()
        .buffer(1) // Required to make it Clone.
        .rate_limit(1, Duration::from_secs(3))
}

/// The discovery documents at the site root, for a deployment mounted below it.
///
/// Only the *suffixed* spellings belong here, and that distinction is the whole point. RFC 8414
/// §3.3 says a client that fetched metadata from a URL built out of an issuer must reject the
/// document unless its `issuer` is exactly the issuer it started from. With
/// `MORIED_ROOT_PATH=/api/` this server's issuer is `https://host/api`, so
/// `/.well-known/oauth-authorization-server/api` is its document -- and the bare
/// `/.well-known/oauth-authorization-server` is the document of `https://host`, which this server
/// is not. Answering there with a path-bearing issuer is a mismatch a conformant client must
/// refuse; a 404 is both honest and more useful, because it lets the client fall through to a
/// fallback that does match.
///
/// The same reasoning applies to the protected-resource document: the bare path describes the
/// resource `https://host`, not `https://host/api/v2/mcp`.
///
/// A client that follows the `resource_metadata` pointer never needs any of these, and neither
/// does one that walks RFC 8414's fallbacks down to `{root_path}.well-known/openid-configuration`
/// -- which the `/api/` rule a deployment already has will serve. They are here for the
/// deployment that adds the recommended `/.well-known/*` proxy rule, which puts discovery on
/// every client's first-choice path.
///
/// Only for a non-root `MORIED_ROOT_PATH`. At `/` the issuer *is* the site root, so the bare
/// paths are correct and `routes` already serves them.
pub fn site_root_routes(state: OauthState) -> Router {
    let root = state.config.root_path.trim_end_matches('/').to_owned();
    Router::new()
        // What RFC 9728 asks for: the resource's path, inserted after the document name.
        .route(
            &format!("/.well-known/oauth-protected-resource{root}/v2/mcp"),
            get(get_protected_resource_metadata),
        )
        // RFC 8414's first two fallbacks for a path-bearing issuer.
        .route(
            &format!("/.well-known/oauth-authorization-server{root}"),
            get(get_authorization_server_metadata),
        )
        .route(
            &format!("/.well-known/openid-configuration{root}"),
            get(get_authorization_server_metadata),
        )
        .with_state(state)
        .layer(
            ServiceBuilder::new()
                .layer(TraceLayer::new_for_http())
                .layer(
                    CorsLayer::new()
                        .allow_origin(cors::Any)
                        .allow_methods([Method::GET]),
                ),
        )
}

/// The discovery documents at the paths a client reaches relative to wherever this is mounted.
///
/// Both spellings of the protected-resource document are served: the bare one a client guesses
/// at, and the one suffixed with the resource's path below the mount, which is the RFC 9728
/// spelling as seen from inside `MORIED_ROOT_PATH`.
fn well_known_routes() -> Router<OauthState> {
    Router::new()
        .route(
            "/.well-known/oauth-protected-resource",
            get(get_protected_resource_metadata),
        )
        .route(
            "/.well-known/oauth-protected-resource/v2/mcp",
            get(get_protected_resource_metadata),
        )
        .route(
            "/.well-known/oauth-authorization-server",
            get(get_authorization_server_metadata),
        )
        .route(
            "/.well-known/openid-configuration",
            get(get_authorization_server_metadata),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(uris: &[&str]) -> RegisteredClient {
        RegisteredClient {
            name: "A client".to_owned(),
            redirect_uris: uris.iter().map(|uri| (*uri).to_owned()).collect(),
        }
    }

    /// Every discovery URL a client ever sees is derived here, and a client compares `resource`
    /// to the URL it was given byte for byte.
    ///
    /// This is the one test that mutates the environment it reads back. Both variables belong to
    /// `main` and to `McpConfig::from_env`, neither of which any other test calls, so the
    /// parallel suite cannot see the window where they are set.
    #[test]
    fn the_config_derives_every_url_from_the_public_url_and_the_root_path() {
        let derive = |public: &str, root: &str| {
            env::set_var("MORIED_PUBLIC_URL", public);
            env::set_var("MORIED_ROOT_PATH", root);
            McpConfig::from_env().expect("the config should parse").expect("MCP should be on")
        };

        let mounted = derive("https://notes.example.com", "/api/");
        assert_eq!(mounted.issuer, "https://notes.example.com/api");
        assert_eq!(mounted.resource, "https://notes.example.com/api/v2/mcp");
        assert_eq!(
            mounted.authorization_endpoint,
            "https://notes.example.com/api/oauth/authorize",
        );
        assert_eq!(
            mounted.resource_metadata,
            "https://notes.example.com/.well-known/oauth-protected-resource/api/v2/mcp",
        );

        // At the site root the issuer is the origin itself, with no trailing slash.
        let at_root = derive("https://notes.example.com/", "/");
        assert_eq!(at_root.issuer, "https://notes.example.com");
        assert_eq!(at_root.resource, "https://notes.example.com/v2/mcp");
        assert_eq!(
            at_root.resource_metadata,
            "https://notes.example.com/.well-known/oauth-protected-resource/v2/mcp",
        );

        // Unset, and MCP is off: no route is registered and nothing changes for a deployment
        // that has never heard of it.
        env::remove_var("MORIED_PUBLIC_URL");
        assert!(McpConfig::from_env().expect("the config should parse").is_none());

        // A plaintext origin that is not loopback would put every token on the wire.
        env::set_var("MORIED_PUBLIC_URL", "http://notes.example.com");
        assert!(McpConfig::from_env().is_err());
        env::remove_var("MORIED_PUBLIC_URL");
        env::remove_var("MORIED_ROOT_PATH");
    }

    #[test]
    fn a_registered_redirect_uri_matches_exactly() {
        let client = client(&["https://claude.ai/api/mcp/auth_callback"]);
        assert_eq!(
            client.match_redirect("https://claude.ai/api/mcp/auth_callback").as_deref(),
            Some("https://claude.ai/api/mcp/auth_callback"),
        );
        assert!(client.match_redirect("https://claude.ai/api/mcp/other").is_none());
        assert!(client.match_redirect("https://evil.example/api/mcp/auth_callback").is_none());
    }

    /// RFC 8252 §7.3: a native client binds an ephemeral port it cannot know in advance, so the
    /// port is the one part of a loopback redirect that must not have to match.
    #[test]
    fn a_loopback_redirect_matches_on_any_port() {
        let client = client(&["http://localhost/callback"]);
        assert_eq!(
            client.match_redirect("http://localhost:57321/callback").as_deref(),
            Some("http://localhost:57321/callback"),
        );
        assert_eq!(
            client.match_redirect("http://localhost/callback").as_deref(),
            Some("http://localhost/callback"),
        );
        // The relaxation is about the port and nothing else.
        assert!(client.match_redirect("http://localhost:57321/elsewhere").is_none());
        assert!(client.match_redirect("http://127.0.0.1:57321/callback").is_none());
        assert!(client.match_redirect("https://localhost/callback").is_none());
    }

    #[test]
    fn a_non_loopback_http_redirect_is_never_accepted() {
        assert!(is_acceptable_redirect_uri("https://claude.ai/api/mcp/auth_callback"));
        assert!(is_acceptable_redirect_uri("http://localhost:1410/callback"));
        assert!(is_acceptable_redirect_uri("http://127.0.0.1:1410/callback"));
        assert!(is_acceptable_redirect_uri("http://[::1]:1410/callback"));

        assert!(!is_acceptable_redirect_uri("http://example.com/callback"));
        assert!(!is_acceptable_redirect_uri("ftp://example.com/callback"));
        assert!(!is_acceptable_redirect_uri("not a url"));
        // A fragment cannot be preserved once the code is appended.
        assert!(!is_acceptable_redirect_uri("https://example.com/cb#frag"));
    }

    /// The one vector from RFC 7636 appendix B.
    #[test]
    fn pkce_s256_matches_the_specs_own_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        assert!(pkce_matches(verifier, challenge));
        assert!(pkce_matches(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM="));
        assert!(!pkce_matches(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cN"));
        // Too short to be a verifier at all.
        assert!(!pkce_matches("short", challenge));
    }

    #[test]
    fn a_redirect_keeps_the_query_the_uri_already_carried() {
        let location = build_redirect(
            "https://claude.ai/api/mcp/auth_callback?tenant=abc",
            &[("code", "a.b.c"), ("state", "xy z&=")],
        )
        .expect("the URI is a URL");
        let url = reqwest::Url::parse(&location).expect("the result is a URL");
        let pairs = url.query_pairs().collect::<Vec<_>>();
        assert_eq!(pairs[0], ("tenant".into(), "abc".into()));
        assert_eq!(pairs[1], ("code".into(), "a.b.c".into()));
        assert_eq!(pairs[2], ("state".into(), "xy z&=".into()));
    }

    #[test]
    fn a_resource_matches_regardless_of_a_trailing_slash() {
        let canonical = "https://notes.example.com/api/v2/mcp";
        assert!(canonical_resource_matches(canonical, canonical));
        assert!(canonical_resource_matches("https://notes.example.com/api/v2/mcp/", canonical));
        assert!(!canonical_resource_matches("https://notes.example.com/api/v2/mc", canonical));
        assert!(!canonical_resource_matches("https://evil.example/api/v2/mcp", canonical));
    }

    #[test]
    fn the_consent_page_escapes_what_a_client_chose_for_itself() {
        let escaped = escape("<script>alert('x')</script> & \"quoted\"");
        assert!(!escaped.contains('<'));
        assert!(!escaped.contains('>'));
        assert_eq!(
            escaped,
            "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quoted&quot;",
        );
    }

    /// `MORIED_SECRET` is process-wide, so every test that signs anything shares one value.
    ///
    /// Nothing else in the suite reads it -- the one other test that touches
    /// `token_is_valid` returns before the variable is consulted -- so setting it once is safe.
    fn with_secret() {
        use std::sync::Once;
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            env::set_var("MORIED_SECRET", "a-test-secret-that-is-not-a-real-one");
        });
    }

    fn test_config() -> McpConfig {
        McpConfig {
            root_path: "/api/".to_owned(),
            issuer: "https://notes.example.com/api".to_owned(),
            resource: "https://notes.example.com/api/v2/mcp".to_owned(),
            authorization_endpoint: "https://notes.example.com/api/oauth/authorize".to_owned(),
            token_endpoint: "https://notes.example.com/api/oauth/token".to_owned(),
            registration_endpoint: "https://notes.example.com/api/oauth/register".to_owned(),
            resource_metadata:
                "https://notes.example.com/.well-known/oauth-protected-resource/api/v2/mcp"
                    .to_owned(),
        }
    }

    /// RFC 7636 appendix B again, from the client's side.
    const VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const CHALLENGE: &str = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    fn mint_code(config: &McpConfig, client_id: &str, redirect: &str, scope: &str) -> String {
        encode(&CodeClaims {
            typ: "mcp_code".to_owned(),
            iss: config.issuer.clone(),
            exp: now() + CODE_TTL.num_seconds(),
            sub: "yuta".to_owned(),
            cid: client_id.to_owned(),
            red: redirect.to_owned(),
            chal: CHALLENGE.to_owned(),
            res: config.resource.clone(),
            scope: scope.to_owned(),
            jti: uuid::Uuid::new_v4().to_string(),
        })
        .expect("the code should sign")
    }

    fn code_request(code: &str, client_id: &str, redirect: &str) -> TokenRequest {
        TokenRequest {
            grant_type: "authorization_code".to_owned(),
            code: Some(code.to_owned()),
            redirect_uri: Some(redirect.to_owned()),
            client_id: Some(client_id.to_owned()),
            code_verifier: Some(VERIFIER.to_owned()),
            refresh_token: None,
            scope: None,
            resource: None,
        }
    }

    const REDIRECT: &str = "https://claude.ai/api/mcp/auth_callback";

    #[test]
    fn a_code_becomes_an_audience_bound_access_token() {
        with_secret();
        let config = test_config();
        let code = mint_code(&config, "client-1", REDIRECT, "notes:read notes:write");

        let granted = grant_authorization_code(&config, &code_request(&code, "client-1", REDIRECT))
            .unwrap_or_else(|e| panic!("the grant should succeed: {}", e.description));
        let tokens = issue_tokens(&config, &granted).expect("the tokens should sign");

        let access: AccessClaims = decode(&tokens.access_token, &config.issuer, Some(&config.resource))
            .expect("the access token should validate against its own resource");
        assert_eq!(access.typ, "mcp_access");
        assert_eq!(access.sub, "yuta");
        assert_eq!(access.scope, "notes:read notes:write");
        assert_eq!(tokens.token_type, "Bearer");

        // Audience binding is the point: the same token must not validate for another server.
        assert!(
            decode::<AccessClaims>(
                &tokens.access_token,
                &config.issuer,
                Some("https://elsewhere.example/v2/mcp"),
            )
            .is_err(),
            "an access token must not validate against a resource it was not minted for",
        );
    }

    #[test]
    fn a_code_is_bound_to_its_client_redirect_and_verifier() {
        with_secret();
        let config = test_config();
        let code = mint_code(&config, "client-1", REDIRECT, "notes:read");

        let wrong_client = grant_authorization_code(
            &config,
            &code_request(&code, "client-2", REDIRECT),
        );
        assert_eq!(wrong_client.err().map(|e| e.error), Some("invalid_grant"));

        let wrong_redirect = grant_authorization_code(
            &config,
            &code_request(&code, "client-1", "https://claude.ai/elsewhere"),
        );
        assert_eq!(wrong_redirect.err().map(|e| e.error), Some("invalid_grant"));

        let mut wrong_verifier = code_request(&code, "client-1", REDIRECT);
        wrong_verifier.code_verifier = Some("x".repeat(43));
        assert_eq!(
            grant_authorization_code(&config, &wrong_verifier).err().map(|e| e.error),
            Some("invalid_grant"),
        );
    }

    /// A code from another issuer, or signed with another secret, must not be spendable here.
    #[test]
    fn a_code_from_elsewhere_is_refused() {
        with_secret();
        let config = test_config();
        let mut other = test_config();
        other.issuer = "https://someone-else.example".to_owned();
        let code = mint_code(&other, "client-1", REDIRECT, "notes:read");

        assert_eq!(
            grant_authorization_code(&config, &code_request(&code, "client-1", REDIRECT))
                .err()
                .map(|e| e.error),
            Some("invalid_grant"),
        );
    }

    #[test]
    fn a_refresh_rotates_the_token_and_cannot_widen_its_scope() {
        with_secret();
        let config = test_config();
        let code = mint_code(&config, "client-1", REDIRECT, "notes:read");
        let granted = grant_authorization_code(&config, &code_request(&code, "client-1", REDIRECT))
            .expect("the grant should succeed");
        let first = issue_tokens(&config, &granted).expect("the tokens should sign");

        let refresh = |scope: Option<&str>| TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            redirect_uri: None,
            client_id: Some("client-1".to_owned()),
            code_verifier: None,
            refresh_token: Some(first.refresh_token.clone()),
            scope: scope.map(str::to_owned),
            resource: None,
        };

        let granted = grant_refresh_token(&config, &refresh(None))
            .unwrap_or_else(|e| panic!("the refresh should succeed: {}", e.description));
        let second = issue_tokens(&config, &granted).expect("the tokens should sign");
        assert_eq!(granted.scope, "notes:read");
        assert_ne!(
            first.refresh_token, second.refresh_token,
            "the refresh token must be rotated, not handed back unchanged",
        );

        assert_eq!(
            grant_refresh_token(&config, &refresh(Some("notes:read notes:write")))
                .err()
                .map(|e| e.error),
            Some("invalid_scope"),
            "a refresh must never widen the scope it carries",
        );
    }

    /// The `typ` claim is the only thing separating the four artefacts, so it has to hold.
    #[test]
    fn one_kind_of_token_cannot_stand_in_for_another() {
        with_secret();
        let config = test_config();
        let code = mint_code(&config, "client-1", REDIRECT, "notes:read");
        let granted = grant_authorization_code(&config, &code_request(&code, "client-1", REDIRECT))
            .expect("the grant should succeed");
        let tokens = issue_tokens(&config, &granted).expect("the tokens should sign");

        // An access token presented where a refresh token belongs.
        let as_refresh = TokenRequest {
            grant_type: "refresh_token".to_owned(),
            code: None,
            redirect_uri: None,
            client_id: Some("client-1".to_owned()),
            code_verifier: None,
            refresh_token: Some(tokens.access_token.clone()),
            scope: None,
            resource: None,
        };
        assert_eq!(
            grant_refresh_token(&config, &as_refresh).err().map(|e| e.error),
            Some("invalid_grant"),
        );

        // And a refresh token presented as an authorization code.
        assert_eq!(
            grant_authorization_code(
                &config,
                &code_request(&tokens.refresh_token, "client-1", REDIRECT),
            )
            .err()
            .map(|e| e.error),
            Some("invalid_grant"),
        );
    }

    /// A registered `client_id` carries its own redirect URIs, which is what lets registration
    /// store nothing at all.
    #[test]
    fn a_registered_client_id_round_trips_through_its_own_signature() {
        with_secret();
        let config = test_config();
        let issued = now();
        let client_id = encode(&ClientClaims {
            typ: "mcp_client".to_owned(),
            iss: config.issuer.clone(),
            iat: issued,
            exp: issued + CLIENT_TTL.num_seconds(),
            name: "Claude".to_owned(),
            uris: vec![REDIRECT.to_owned()],
        })
        .expect("the client_id should sign");

        let claims: ClientClaims =
            decode(&client_id, &config.issuer, None).expect("it should validate");
        assert_eq!(claims.typ, "mcp_client");
        assert_eq!(claims.uris, vec![REDIRECT.to_owned()]);

        // Tampering with the payload breaks the signature.
        let mut tampered = client_id.clone();
        tampered.replace_range(20..21, if &client_id[20..21] == "a" { "b" } else { "a" });
        assert!(decode::<ClientClaims>(&tampered, &config.issuer, None).is_err());
    }

    #[test]
    fn a_client_is_loopback_only_when_every_uri_is() {
        assert!(client(&["http://localhost/cb", "http://127.0.0.1/cb"]).is_loopback_only());
        assert!(!client(&["http://localhost/cb", "https://claude.ai/cb"]).is_loopback_only());
        assert!(!client(&["https://claude.ai/cb"]).is_loopback_only());
    }
}
