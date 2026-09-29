//! Event alarms, sent as Web Push.
//!
//! A service worker cannot wait for a meeting an hour away: Chrome stops one that has been idle
//! for 30 seconds, and every timer it set goes with it. Nothing but a push message wakes a stopped
//! worker at a time of someone else's choosing, so moried works out when each alarm is due and
//! sends one then; the worker only shows it. No page needs to be open, and each subscribed browser
//! is sent each alarm once, however many tabs it has.
//!
//! As little is kept as Web Push allows. The VAPID key pair is derived from `MORIED_SECRET`, as the
//! OAuth artefacts are signed with it, so it needs no configuration of its own -- and rotating the
//! secret ends every subscription along with every session. The subscriptions themselves have to
//! be kept somewhere, and are kept in `cache.sqlite`: each page load registers its browser's
//! subscription afresh, so the table is as disposable as the rest of the cache. Delete it, and each
//! browser is sent alarms again from the next time it opens mory.
//!
//! When an occurrence starts is `note_events`' answer, which the fixtures in `fixtures/calendar/`
//! hold to the calendar's.
//!
//! The scheduler must not talk to the database while nothing changes: production logs at debug,
//! and `sqlx` logs every statement there. It keeps the listing and the subscriptions in memory, and
//! reads them again only when a sync or a handler says they changed.

use std::collections::{HashMap, HashSet};
use std::time::Duration as StdDuration;

use anyhow::{Context, Result, bail};
use axum::http::{HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::{Json, extract};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};
use chrono_tz::Tz as Zone;
use git2::Oid;
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tokio::sync::Notify;
use web_push_native::jwt_simple::algorithms::{
    ECDSAP256PublicKeyLike, ES256KeyPair,
};
use web_push_native::{Auth, WebPushBuilder, p256::PublicKey};

use crate::models::{AppError, AppState, ListEntry};
use crate::note_events::{self, Reader};

/// How far ahead each look at the schedule reaches, and so how long the scheduler sleeps when
/// nothing is due sooner: an alarm further off is found by a later look. Also how soon a commit
/// made outside moried is noticed.
const CHECK_INTERVAL: StdDuration = StdDuration::from_secs(60);

/// How long one push service may take to answer before the alarms behind it are sent regardless.
const SEND_TIMEOUT: StdDuration = StdDuration::from_secs(10);

/// How late an alarm may still be sent, and how long a push service may hold it for a browser that
/// is offline. A meeting announced ten minutes in is still worth hearing about; one announced when
/// a laptop wakes the next morning is not.
const LATE_LIMIT: StdDuration = StdDuration::from_secs(10 * 60);

/// What the page and the scheduler share: the key the browser subscribes with, and a way to tell
/// the scheduler that the subscriptions changed.
pub struct Push {
    key_pair: ES256KeyPair,
    /// The public half, as a browser's `applicationServerKey` takes it: uncompressed, base64url.
    public_key: String,
    /// Who a push service contacts about this sender. RFC 8292 wants a `mailto:` or a URL.
    contact: String,
    subscriptions_changed: Notify,
}

impl Push {
    pub fn from_env() -> Result<Self> {
        let secret = std::env::var("MORIED_SECRET").context("MORIED_SECRET must be set")?;
        let email = std::env::var("MORIED_USER_EMAIL").context("MORIED_USER_EMAIL must be set")?;
        Self::derive(secret.as_bytes(), format!("mailto:{email}"))
    }

    /// The key pair `secret` stands for. The same secret always gives the same pair, which is what
    /// lets a restarted moried keep sending to the browsers that subscribed before.
    fn derive(secret: &[u8], contact: String) -> Result<Self> {
        let hkdf = Hkdf::<Sha256>::new(Some(b"moried web push"), secret);
        // A P-256 private key is a scalar below the group order, which 32 random bytes miss with a
        // probability of about 2^-32; the counter only makes the loop well-defined when they do.
        for counter in 0..=u8::MAX {
            let mut scalar = [0u8; 32];
            hkdf.expand(&[b"vapid key pair ".as_slice(), &[counter]].concat(), &mut scalar)
                .expect("32 bytes is a valid HKDF-SHA256 output length");
            if let Ok(key_pair) = ES256KeyPair::from_bytes(&scalar) {
                let public_key =
                    URL_SAFE_NO_PAD.encode(key_pair.public_key().public_key().to_bytes_uncompressed());
                return Ok(Push { key_pair, public_key, contact, subscriptions_changed: Notify::new() });
            }
        }
        bail!("no VAPID key pair could be derived from MORIED_SECRET")
    }
}

// --- subscriptions --------------------------------------------------------------------------

/// A browser's subscription, as `PushSubscription.toJSON()` gives it, with the zone it reads
/// the calendar in.
#[derive(Debug, Clone, Deserialize)]
pub struct SubscriptionRequest {
    pub endpoint: String,
    pub keys: SubscriptionKeys,
    /// An IANA zone name. A note without offsets means a different moment in every zone, and the
    /// alarm should ring when the calendar in this browser shows the event.
    pub zone: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EndpointRequest {
    pub endpoint: String,
}

/// A subscription moried can send to.
#[derive(Debug, Clone)]
struct Subscription {
    /// As the browser gave it, which is how the table knows it.
    endpoint: String,
    /// The push service's host: enough for a log line to tell which browser's service failed,
    /// where the endpoint is a credential to send that browser notifications.
    host: String,
    /// The endpoint and the browser's keys, parsed once into what sends to them.
    builder: WebPushBuilder,
    zone: Zone,
}

fn decode(value: &str) -> Option<Vec<u8>> {
    // Browsers leave the padding off, but base64url with it is still base64url.
    URL_SAFE_NO_PAD.decode(value.trim_end_matches('=')).ok()
}

impl Subscription {
    fn parse(endpoint: &str, p256dh: &str, auth: &str, zone: &str) -> Result<Self> {
        // Parsed as the type it is sent to, so that nothing is stored that could never be sent.
        let uri = endpoint.parse::<Uri>().context("the endpoint is not a URL")?;
        // A push service is always reached over TLS, and moried should not be made to post to
        // anything else on a browser's say-so.
        if uri.scheme_str() != Some("https") {
            bail!("the endpoint is not an https URL");
        }
        let host = uri.host().context("the endpoint names no host")?.to_owned();
        let ua_public = decode(p256dh)
            .and_then(|bytes| PublicKey::from_sec1_bytes(&bytes).ok())
            .context("keys.p256dh is not a P-256 public key")?;
        let ua_auth = decode(auth)
            .filter(|bytes| bytes.len() == 16)
            .map(|bytes| Auth::clone_from_slice(&bytes))
            .context("keys.auth is not 16 bytes")?;
        let zone = zone.parse::<Zone>().ok().context("zone is not an IANA zone name")?;
        let builder = WebPushBuilder::new(uri, ua_public, ua_auth).with_valid_duration(LATE_LIMIT);
        Ok(Subscription { endpoint: endpoint.to_owned(), host, builder, zone })
    }
}

async fn load_subscriptions(state: &AppState) -> Vec<Subscription> {
    let rows = sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT endpoint, p256dh, auth, zone FROM push_subscription;",
        )
        .fetch_all(&state.cache_db)
        .await;
    match rows {
        Ok(rows) => rows
            .into_iter()
            // Stored only after the same parse succeeded, so a row that fails it now is one
            // written by hand, and is better skipped than fatal.
            .filter_map(|(endpoint, p256dh, auth, zone)| Subscription::parse(&endpoint, &p256dh, &auth, &zone).ok())
            .collect(),
        Err(e) => {
            tracing::error!("Failed to read the push subscriptions: {:?}", e);
            Vec::new()
        },
    }
}

async fn forget(state: &AppState, endpoint: &str) -> Result<()> {
    sqlx::query("DELETE FROM push_subscription WHERE endpoint = ?;")
        .bind(endpoint)
        .execute(&state.cache_db_writer)
        .await?;
    Ok(())
}

/// `GET /v2/push/key`: the key a browser subscribes with.
pub async fn get_key(extract::State(state): extract::State<AppState>) -> Json<String> {
    Json(state.push.public_key.clone())
}

/// `PUT /v2/push/subscription`: send this browser the alarms. Each page load sends its own again,
/// which is what refills the table after the cache is deleted.
pub async fn put_subscription(
    extract::State(state): extract::State<AppState>,
    Json(request): Json<SubscriptionRequest>,
) -> Result<Response, AppError> {
    let SubscriptionRequest { endpoint, keys, zone } = request;
    if let Err(e) = Subscription::parse(&endpoint, &keys.p256dh, &keys.auth, &zone) {
        return Ok((StatusCode::BAD_REQUEST, e.to_string()).into_response());
    }
    sqlx::query(
            "INSERT INTO push_subscription (endpoint, p256dh, auth, zone, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(endpoint) DO UPDATE SET
                 p256dh = excluded.p256dh,
                 auth = excluded.auth,
                 zone = excluded.zone,
                 updated_at = excluded.updated_at;",
        )
        .bind(&endpoint)
        .bind(&keys.p256dh)
        .bind(&keys.auth)
        .bind(&zone)
        .bind(Utc::now().timestamp())
        .execute(&state.cache_db_writer)
        .await?;
    state.push.subscriptions_changed.notify_one();
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// `DELETE /v2/push/subscription`: stop sending this browser alarms.
pub async fn delete_subscription(
    extract::State(state): extract::State<AppState>,
    Json(request): Json<EndpointRequest>,
) -> Result<StatusCode, AppError> {
    forget(&state, &request.endpoint).await?;
    state.push.subscriptions_changed.notify_one();
    Ok(StatusCode::NO_CONTENT)
}

// --- alarms ---------------------------------------------------------------------------------

/// One alarm: an occurrence, when it starts, and what the worker shows for it.
#[derive(Debug, Clone, PartialEq)]
pub struct Alarm {
    pub at: DateTime<Utc>,
    pub name: String,
    pub path: String,
    pub location: Option<String>,
}

/// What the service worker is sent, and shows.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct Payload {
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    /// Tells two sends of the same alarm apart from two alarms, so that a repeat replaces the
    /// notification rather than adding one.
    tag: String,
    /// The note to open when the notification is clicked.
    path: String,
}

impl Alarm {
    fn payload(&self) -> Payload {
        Payload {
            title: self.name.clone(),
            body: self.location.clone(),
            tag: format!("{}#{}@{}", self.path, self.name, self.at.to_rfc3339()),
            path: self.path.clone(),
        }
    }
}

/// The occurrences starting after `after` and no later than `until`, soonest first.
///
/// An all-day event has no moment to ring at, and one already marked finished needs no reminder.
pub fn alarms_between(
    entries: &[ListEntry],
    after: DateTime<Utc>,
    until: DateTime<Utc>,
    reader: &Reader,
) -> Vec<Alarm> {
    let local_date = |at: DateTime<Utc>| at.with_timezone(&reader.zone).date_naive();
    let (from, to) = note_events::day_window(local_date(after), local_date(until), reader);
    let mut alarms: Vec<Alarm> = note_events::occurrences(entries, from, to, reader)
        .into_iter()
        .filter(|occurrence| !occurrence.finished)
        .filter_map(|occurrence| {
            let at = occurrence.start.instant(reader)?;
            (after < at && at <= until).then_some(Alarm {
                at,
                name: occurrence.name,
                path: occurrence.path,
                location: occurrence.location,
            })
        })
        .collect();
    alarms.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.name.cmp(&b.name)));
    alarms
}

/// What became of one push.
#[derive(Debug, PartialEq)]
enum Delivery {
    Sent,
    /// The browser unsubscribed, or subscribed with a key this server no longer holds. Sending
    /// again cannot succeed, so the subscription is forgotten.
    Gone,
    Failed,
}

/// The push that carries `payload` to one browser: encrypted for it, and signed as this server.
fn request(push: &Push, subscription: &Subscription, payload: &Payload) -> Result<reqwest::Request> {
    let request = subscription
        .builder
        .clone()
        .with_vapid(&push.key_pair, &push.contact)
        .build(serde_json::to_vec(payload)?)?;
    let mut request = reqwest::Request::try_from(request)?;
    *request.timeout_mut() = Some(SEND_TIMEOUT);
    // A phone dozing on battery holds back a normal-urgency push; an alarm must not wait.
    request.headers_mut().insert("Urgency", HeaderValue::from_static("high"));
    Ok(request)
}

/// What a push service's answer says of the subscription.
fn delivery_of(status: StatusCode) -> Delivery {
    if status.is_success() {
        Delivery::Sent
    }
    // 404 and 410 for a subscription that has ended; 403 for one made with another key, as after
    // `MORIED_SECRET` is rotated.
    else if matches!(status.as_u16(), 403 | 404 | 410) {
        Delivery::Gone
    }
    else {
        Delivery::Failed
    }
}

async fn deliver(
    client: &reqwest::Client,
    push: &Push,
    subscription: &Subscription,
    payload: &Payload,
) -> Delivery {
    let response = match request(push, subscription, payload) {
        Ok(request) => client.execute(request).await.map_err(anyhow::Error::from),
        Err(e) => Err(e),
    };
    match response {
        Ok(response) => {
            let delivery = delivery_of(response.status());
            if delivery == Delivery::Failed {
                tracing::warn!(
                    "The push service at {} refused an alarm: {}",
                    subscription.host,
                    response.status(),
                );
            }
            delivery
        },
        Err(e) => {
            tracing::warn!("Failed to send an alarm to {}: {:?}", subscription.host, e);
            Delivery::Failed
        },
    }
}

/// What one look at the schedule found: the alarms due now, each with the browsers to send it to,
/// and when the next one after them is due.
struct Plan<'a> {
    due: Vec<(Alarm, Vec<&'a Subscription>)>,
    next: Option<DateTime<Utc>>,
}

/// The alarms due in `(after, now]` for each zone's browsers, and the first due after `now` within
/// `CHECK_INTERVAL`. One more than `LATE_LIMIT` late is let pass.
fn plan<'a>(
    listing: &[ListEntry],
    subscriptions: &'a [Subscription],
    after: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Plan<'a> {
    let mut by_zone: HashMap<Zone, Vec<&Subscription>> = HashMap::new();
    for subscription in subscriptions {
        by_zone.entry(subscription.zone).or_default().push(subscription);
    }
    let mut plan = Plan { due: Vec::new(), next: None };
    for (zone, group) in by_zone {
        for alarm in alarms_between(listing, after, now + CHECK_INTERVAL, &Reader { zone, now }) {
            if alarm.at > now {
                plan.next = Some(plan.next.map_or(alarm.at, |next| next.min(alarm.at)));
                break;
            }
            if alarm.at >= now - LATE_LIMIT {
                plan.due.push((alarm, group.clone()));
            }
        }
    }
    plan
}

/// Sends each due alarm to its browsers, and returns the endpoints their push services reported
/// ended. One reported ended is not sent the alarms after it.
async fn send(state: &AppState, due: &[(Alarm, Vec<&Subscription>)]) -> HashSet<String> {
    let mut gone = HashSet::new();
    for (alarm, group) in due {
        let payload = alarm.payload();
        let mut sent = 0;
        for subscription in group {
            if gone.contains(&subscription.endpoint) {
                continue;
            }
            match deliver(&state.http_client, &state.push, subscription, &payload).await {
                Delivery::Sent => sent += 1,
                Delivery::Gone => {
                    gone.insert(subscription.endpoint.clone());
                },
                Delivery::Failed => {},
            }
        }
        tracing::info!(
            "Sent the alarm for {:?} in {} to {} of {} browsers",
            alarm.name,
            alarm.path,
            sent,
            group.len(),
        );
    }
    gone
}

pub fn spawn(state: AppState) {
    tokio::spawn(run(state));
}

async fn run(state: AppState) {
    let mut subscriptions = load_subscriptions(&state).await;
    // The listing, read again only once a sync says it moved.
    let mut entries: Option<Vec<ListEntry>> = None;
    let mut done = state.cache_sync.done.clone();
    // The HEAD a nudge was sent for, with what the last sync had reached then.
    let mut nudged_for: Option<(Oid, Option<Oid>)> = None;
    // Alarms up to here have been sent or let pass. From now, so that a restart does not send
    // what was due while moried was down.
    let mut checked_up_to = Utc::now();

    loop {
        // A commit made outside moried, such as a push to the repository, moves HEAD without a
        // save to nudge the cache. Compared with what the last sync reached rather than asked of
        // the database, which would log.
        if let Ok(head) = state.head_commit_id() {
            let synced = *done.borrow();
            if Some(head) != synced && nudged_for != Some((head, synced)) {
                nudged_for = Some((head, synced));
                state.nudge_cache().await;
            }
        }

        let now = Utc::now();
        let mut next = None;
        if !subscriptions.is_empty() {
            if entries.is_none() {
                match state.read_entries(None).await {
                    Ok((_, listing)) => entries = Some(listing),
                    Err(e) => tracing::error!("The alarm scheduler could not read the listing: {:?}", e),
                }
            }
            // Without a listing, what fell due is still unsent: look at the span again next time,
            // rather than pass over it as though it held nothing.
            let Some(listing) = entries.as_deref() else {
                wait(&state, &mut done, &mut subscriptions, &mut entries, CHECK_INTERVAL).await;
                continue;
            };
            let plan = plan(listing, &subscriptions, checked_up_to, now);
            next = plan.next;
            let gone = send(&state, &plan.due).await;
            if !gone.is_empty() {
                for endpoint in &gone {
                    if let Err(e) = forget(&state, endpoint).await {
                        tracing::error!("Failed to forget an ended push subscription: {:?}", e);
                    }
                }
                tracing::info!("Forgot {} push subscriptions their browsers ended", gone.len());
                subscriptions.retain(|subscription| !gone.contains(&subscription.endpoint));
            }
        }
        // Never back: a clock stepped back would otherwise send what was already sent.
        checked_up_to = checked_up_to.max(now);

        // An alarm that came due while the others were being sent is due now, not in a minute.
        let sleep = next.map_or(CHECK_INTERVAL, |next| (next - Utc::now()).to_std().unwrap_or_default());
        wait(&state, &mut done, &mut subscriptions, &mut entries, sleep).await;
    }
}

/// Sleeps for `sleep`, or until the subscriptions or the listing change, and takes the change in.
async fn wait(
    state: &AppState,
    done: &mut tokio::sync::watch::Receiver<Option<Oid>>,
    subscriptions: &mut Vec<Subscription>,
    entries: &mut Option<Vec<ListEntry>>,
    sleep: StdDuration,
) {
    // A closed channel would report a change on every call and spin the loop, so stop listening to
    // it, as `search` does. Only shutdown drops the sender.
    let sync_open = done.has_changed().is_ok();
    tokio::select! {
        () = tokio::time::sleep(sleep) => {},
        () = state.push.subscriptions_changed.notified() => {
            *subscriptions = load_subscriptions(state).await;
        },
        _ = done.changed(), if sync_open => {
            *entries = None;
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOS_ANGELES: Zone = chrono_tz::America::Los_Angeles;

    fn entry(yaml: &str) -> ListEntry {
        ListEntry {
            path: "note.md".into(),
            size: 1,
            mime_type: "text/markdown".to_owned(),
            metadata: Some(serde_yaml::from_str(yaml).expect("valid YAML")),
            title: None,
            time: "2024-01-01T00:00:00+00:00".parse().unwrap(),
        }
    }

    fn at(text: &str) -> DateTime<Utc> {
        text.parse().unwrap()
    }

    fn reader() -> Reader {
        Reader { zone: LOS_ANGELES, now: at("2024-05-01T00:00:00Z") }
    }

    #[test]
    fn the_same_secret_always_derives_the_same_key() {
        let one = Push::derive(b"secret", "mailto:a@example.invalid".into()).unwrap();
        let again = Push::derive(b"secret", "mailto:a@example.invalid".into()).unwrap();
        let other = Push::derive(b"another secret", "mailto:a@example.invalid".into()).unwrap();
        assert_eq!(one.public_key, again.public_key);
        assert_ne!(one.public_key, other.public_key);
        // Uncompressed P-256: a tag byte and two 32-byte coordinates.
        assert_eq!(decode(&one.public_key).unwrap().len(), 65);
    }

    #[test]
    fn alarms_are_the_timed_unfinished_occurrences_in_the_span() {
        let entries = [entry("
events:
    Standup:
        start: '2024-05-06 09:00'
        repeat: { freq: daily, count: 3 }
        location: Room 1
    Done: { start: '2024-05-06 09:30', finished: true }
    Holiday: { start: '2024-05-07' }
    Later: { start: '2024-05-06 10:00:00-07:00' }
")];
        // 09:00 in Los Angeles is 16:00 UTC; the span starts exactly at the first, so it is left
        // out as already rung.
        let alarms = alarms_between(&entries, at("2024-05-06T16:00:00Z"), at("2024-05-07T16:00:00Z"), &reader());
        let seen: Vec<(String, &str)> = alarms.iter().map(|a| (a.at.to_rfc3339(), a.name.as_str())).collect();
        assert_eq!(seen, [
            ("2024-05-06T17:00:00+00:00".to_owned(), "Later"),
            ("2024-05-07T16:00:00+00:00".to_owned(), "Standup"),
        ]);
        assert_eq!(alarms[1].location.as_deref(), Some("Room 1"));
    }

    #[test]
    fn a_wall_clock_rings_at_that_time_in_each_readers_zone() {
        let entries = [entry("events: { Call: { start: '2024-05-06 09:00' } }")];
        let tokyo = Reader { zone: chrono_tz::Asia::Tokyo, now: at("2024-05-01T00:00:00Z") };
        let span = (at("2024-05-05T00:00:00Z"), at("2024-05-07T00:00:00Z"));
        assert_eq!(alarms_between(&entries, span.0, span.1, &reader())[0].at, at("2024-05-06T16:00:00Z"));
        assert_eq!(alarms_between(&entries, span.0, span.1, &tokyo)[0].at, at("2024-05-06T00:00:00Z"));
    }

    fn subscription_in(zone: Zone) -> Subscription {
        let (_, p256dh, _, auth) = subscription_keys();
        let endpoint = format!("https://push.example/{}", zone.name());
        Subscription::parse(&endpoint, &p256dh, &auth, zone.name()).unwrap()
    }

    fn names(plan: &Plan<'_>) -> Vec<(String, Vec<Zone>)> {
        let mut due: Vec<(String, Vec<Zone>)> = plan
            .due
            .iter()
            .map(|(alarm, group)| (alarm.name.clone(), group.iter().map(|s| s.zone).collect()))
            .collect();
        due.sort_by(|a, b| a.0.cmp(&b.0));
        due
    }

    #[test]
    fn a_plan_sends_what_is_due_lets_a_late_one_pass_and_finds_the_next() {
        let entries = [entry("
events:
    Too late: { start: '2024-05-06 09:45:00+00:00' }
    Late but in time: { start: '2024-05-06 09:55:00+00:00' }
    Now: { start: '2024-05-06 10:00:00+00:00' }
    Next: { start: '2024-05-06 10:00:30+00:00' }
    After the lookahead: { start: '2024-05-06 10:05:00+00:00' }
")];
        let subscriptions = [subscription_in(LOS_ANGELES)];
        let plan = plan(&entries, &subscriptions, at("2024-05-06T09:30:00Z"), at("2024-05-06T10:00:00Z"));
        assert_eq!(names(&plan), [
            ("Late but in time".to_owned(), vec![LOS_ANGELES]),
            ("Now".to_owned(), vec![LOS_ANGELES]),
        ]);
        assert_eq!(plan.next, Some(at("2024-05-06T10:00:30Z")));
    }

    #[test]
    fn a_plan_sends_a_wall_clock_to_the_browsers_whose_zone_it_is_due_in() {
        let entries = [entry("events: { Call: { start: '2024-05-06 09:00' } }")];
        let tokyo = chrono_tz::Asia::Tokyo;
        let subscriptions = [subscription_in(LOS_ANGELES), subscription_in(tokyo)];
        // 09:00 in Tokyo; still the night before in Los Angeles.
        let plan = plan(&entries, &subscriptions, at("2024-05-05T23:59:00Z"), at("2024-05-06T00:00:30Z"));
        assert_eq!(names(&plan), [("Call".to_owned(), vec![tokyo])]);
        assert_eq!(plan.next, None);
    }

    fn subscription_keys() -> (web_push_native::p256::SecretKey, String, Auth, String) {
        let secret = web_push_native::p256::SecretKey::from_slice(&[7u8; 32]).unwrap();
        let public = URL_SAFE_NO_PAD.encode(secret.public_key().to_sec1_bytes());
        let auth = Auth::clone_from_slice(&[9u8; 16]);
        let auth_text = URL_SAFE_NO_PAD.encode(auth.as_slice());
        (secret, public, auth, auth_text)
    }

    #[test]
    fn a_subscription_must_be_https_with_real_keys_and_a_zone() {
        let (_, p256dh, _, auth) = subscription_keys();
        let ok = |endpoint: &str, p256dh: &str, auth: &str, zone: &str| {
            Subscription::parse(endpoint, p256dh, auth, zone).is_ok()
        };
        assert!(ok("https://push.example/abc", &p256dh, &auth, "Asia/Tokyo"));
        assert!(ok("https://push.example/abc", &format!("{p256dh}="), &format!("{auth}=="), "UTC"));
        assert!(!ok("http://push.example/abc", &p256dh, &auth, "Asia/Tokyo"));
        // A URL, but not one a request can be sent to: stored, it would fail every send for good.
        assert!(!ok("https://push.example/a b", &p256dh, &auth, "Asia/Tokyo"));
        assert!(!ok("https://push.example/abc", "AAAA", &auth, "Asia/Tokyo"));
        assert!(!ok("https://push.example/abc", &p256dh, "AAAA", "Asia/Tokyo"));
        assert!(!ok("https://push.example/abc", &p256dh, &auth, "+09:00"));
    }

    #[test]
    fn an_alarm_is_encrypted_for_the_browser_and_signed_as_this_server() {
        let push = Push::derive(b"secret", "mailto:a@example.invalid".into()).unwrap();
        let (ua_secret, _, ua_auth, _) = subscription_keys();
        let subscription = subscription_in(LOS_ANGELES);
        let alarm = Alarm {
            at: at("2024-05-06T16:00:00Z"),
            name: "Standup".into(),
            path: "notes/standup.md".into(),
            location: Some("Room 1".into()),
        };

        let request = request(&push, &subscription, &alarm.payload()).unwrap();
        assert_eq!(request.url().as_str(), "https://push.example/America/Los_Angeles");
        let headers = request.headers();
        assert_eq!(headers["urgency"], "high");
        assert_eq!(headers["ttl"], "600");
        let authorization = headers["authorization"].to_str().unwrap();
        assert!(authorization.starts_with("vapid t="), "{authorization}");
        assert!(authorization.ends_with(&format!("k={}", push.public_key)), "{authorization}");

        // Only the browser holding the subscription's secret can read it.
        let body = request.body().and_then(reqwest::Body::as_bytes).unwrap().to_vec();
        let plain = web_push_native::decrypt(body, &ua_secret, &ua_auth).unwrap();
        let payload: Payload = serde_json::from_slice(&plain).unwrap();
        assert_eq!(payload, alarm.payload());
        assert_eq!(payload.title, "Standup");
        assert_eq!(payload.body.as_deref(), Some("Room 1"));
    }

    #[test]
    fn an_ended_subscription_is_reported_gone() {
        for (status, expected) in [
            (StatusCode::CREATED, Delivery::Sent),
            (StatusCode::GONE, Delivery::Gone),
            (StatusCode::NOT_FOUND, Delivery::Gone),
            (StatusCode::FORBIDDEN, Delivery::Gone),
            (StatusCode::TOO_MANY_REQUESTS, Delivery::Failed),
        ] {
            assert_eq!(delivery_of(status), expected, "{status}");
        }
    }
}
