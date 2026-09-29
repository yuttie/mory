//! The occurrences a note's `events:` block declares, where and when the calendar draws them.
//!
//! The Rust twin of `eventsFromEntries` in `frontend/src/events.ts`, for event alarms. moried
//! sends each alarm as a Web Push at its occurrence's start, because a service worker cannot wake
//! itself at a time of its own choosing -- so moried has to know the times itself.
//!
//! That makes this a third expander, which is exactly what `list_events` in `mcp/tools.rs`
//! declines to be: the two before it passed their own tests for a long time while disagreeing.
//! An alarm ringing at a time the calendar does not show is that disagreement made audible, so
//! this follows the frontend rule by rule, including where its behaviour is an accident of
//! JavaScript, and `fixtures/calendar/notes/` holds the two to each other. Change either one and
//! run both halves of that comparison.
//!
//! Only what decides whether an occurrence is drawn, and at what wall clock, is reproduced.
//! Colours and ends are read only as far as a bad one hides an occurrence, and categories not at
//! all: they change how an event is drawn, never when.
//!
//! Three JavaScript behaviours carry most of the weight, each easy to get subtly wrong:
//!
//!   * `dayjs(text)` reads a string with no offset as the reader's wall clock, through `Date`,
//!     which moves a time in a daylight-saving gap forward by the gap and reads an hour that
//!     happens twice as the first of the two. See `resolve_local`.
//!   * `dayjs.tz(text, zone)`, which a rule with `tz` goes through, starts from the offset the
//!     zone has *now*, so which of two repeated hours it picks depends on the season the reader
//!     is in. See `resolve_in_zone`, and `Reader::now`.
//!   * Every value is whatever the file said, and the frontend's `??` and `||` treat a `null`, an
//!     empty string and a zero each in their own way. `end:` left empty hides every instance and
//!     every generated occurrence of its event, and so it does here.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use chrono::{
    DateTime, Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, Offset,
    TimeZone, Timelike, Utc,
};
use chrono_tz::Tz as Zone;
use icalendar::{Frequency, NWeekday, Tz, Weekday, rrule::RRule};
use regex::Regex;
use serde_yaml::{Mapping, Value};

use crate::models::ListEntry;

/// Who the occurrences are drawn for. The calendar draws in its reader's zone, and so a note
/// without offsets means something different to each reader.
#[derive(Debug, Clone, Copy)]
pub struct Reader {
    pub zone: Zone,
    /// When the reading happens. Only `dayjs.tz` looks at it, to pick between two repeated hours.
    pub now: DateTime<Utc>,
}

/// Where an occurrence starts, as the reader's wall clock: a date for an all-day one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Start {
    Date(NaiveDate),
    Time(NaiveDateTime),
}

impl Start {
    /// The moment a timed occurrence starts; `None` for an all-day one, which has no moment.
    pub fn instant(&self, reader: &Reader) -> Option<DateTime<Utc>> {
        match self {
            Start::Date(_) => None,
            Start::Time(_) => Some(self.begins(reader)),
        }
    }

    /// When it begins: `dayjs(start)`, which reads a date as its first moment and resolves a wall
    /// clock as the calendar does.
    pub fn begins(&self, reader: &Reader) -> DateTime<Utc> {
        match self {
            Start::Date(date) => resolve_local(date.and_time(NaiveTime::MIN), reader.zone),
            Start::Time(wall) => resolve_local(*wall, reader.zone),
        }
    }
}

impl std::fmt::Display for Start {
    /// As `toWallClock` spells it: seconds only when there are some.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Start::Date(date) => write!(f, "{}", date.format("%Y-%m-%d")),
            Start::Time(wall) if wall.second() == 0 => write!(f, "{}", wall.format("%Y-%m-%d %H:%M")),
            Start::Time(wall) => write!(f, "{}", wall.format("%Y-%m-%d %H:%M:%S")),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence {
    pub path: String,
    pub name: String,
    pub start: Start,
    pub finished: bool,
    pub location: Option<String>,
}

/// Every occurrence the listing declares in `[from, to]`.
///
/// As in the frontend, the window bounds only what a rule generates: an event's own `start` and
/// its `instances` are returned wherever they fall, for the caller to pick from.
pub fn occurrences(
    entries: &[ListEntry],
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    reader: &Reader,
) -> Vec<Occurrence> {
    let window = from.timestamp_millis()..=to.timestamp_millis();
    let mut out = Vec::new();
    for entry in entries {
        let Some(Value::Mapping(metadata)) = &entry.metadata else {
            continue;
        };
        let path = entry.path.to_string_lossy();
        match metadata.get("events") {
            Some(Value::Mapping(declared)) => {
                for (key, detail) in declared {
                    if let (Some(name), Value::Mapping(detail)) = (key_name(key), detail) {
                        events_of_entry(&name, detail, &path, &window, reader, &mut out);
                    }
                }
            },
            // `Object.entries` of an array names each element by its index.
            Some(Value::Sequence(declared)) => {
                for (index, detail) in declared.iter().enumerate() {
                    if let Value::Mapping(detail) = detail {
                        events_of_entry(&index.to_string(), detail, &path, &window, reader, &mut out);
                    }
                }
            },
            _ => {},
        }
    }
    out
}

/// The first and last instants of the days `from` to `to`, in the reader's zone: what the
/// frontend makes of a window given as two dates.
pub fn day_window(from: NaiveDate, to: NaiveDate, reader: &Reader) -> (DateTime<Utc>, DateTime<Utc>) {
    let last = to.and_hms_milli_opt(23, 59, 59, 999).expect("a valid time");
    (resolve_local(from.and_time(NaiveTime::MIN), reader.zone), resolve_local(last, reader.zone))
}

// --- reading values as JavaScript does -----------------------------------------------------

/// A map key as the frontend names the event: JSON has only string keys, so a number is its text.
fn key_name(key: &Value) -> Option<String> {
    match key {
        Value::String(name) => Some(name.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

/// Whether JavaScript's `||` would take the value.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Sequence(_) | Value::Mapping(_) | Value::Tagged(_) => true,
    }
}

/// The value JavaScript's `??` leaves: `None` for a missing key and for `null` alike.
fn present(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| !value.is_null())
}

/// `asArray`: a list from whatever the frontmatter held.
fn as_array(value: Option<&Value>) -> &[Value] {
    match value {
        Some(Value::Sequence(list)) => list,
        _ => &[],
    }
}

// `dayjs`'s own parse, tried before it hands a string to `Date`. `[0-9]` rather than `\d`, which
// is any Unicode digit in Rust and only ASCII in JavaScript.
static DAYJS_PARSE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^([0-9]{4})[-/]?([0-9]{1,2})?[-/]?([0-9]{0,2})[Tt\s]*([0-9]{1,2})?:?([0-9]{1,2})?:?([0-9]{1,2})?[.:]?([0-9]+)?$",
    )
    .expect("a valid pattern")
});

// What `Date` is left to parse when `dayjs` gives up: in a note, an ISO datetime with an offset.
// V8 reads a good deal more than this, none of which a note holds.
static WITH_OFFSET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^\s*([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[Tt ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]+))?)?)?\s*(?:([Zz])|([+-])([0-9]{2}):?([0-9]{2}))\s*$",
    )
    .expect("a valid pattern")
});

// `WALL_CLOCK` in `frontend/src/recurrence.ts`: date, optional time, and an offset that is ignored.
static WALL_CLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?)?(?:\s*(?:Z|[+-][0-9]{2}:?[0-9]{2}))?$",
    )
    .expect("a valid pattern")
});

static HAS_OFFSET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:Z|[+-][0-9]{2}:?[0-9]{2})$").expect("a valid pattern"));

static DURATION_SHORT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\+([0-9.]+) *(y|M|w|d|h|m|s|ms)$").expect("a valid pattern"));

static DURATION_LONG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)^\+([0-9.]+) *(years?|months?|weeks?|days?|hours?|minutes?|seconds?|milliseconds?)$",
    )
    .expect("a valid pattern")
});

static BYDAY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(-?[0-9]+)?(sun|mon|tue|wed|thu|fri|sat)$").expect("a valid pattern")
});

/// A captured number; `None` when the group is absent or empty.
fn group(parts: &regex::Captures<'_>, i: usize) -> Option<i64> {
    parts.get(i).filter(|part| !part.as_str().is_empty())?.as_str().parse().ok()
}

/// `new Date(y, m, d, h, mi, s, ms)` and `Date.UTC` alike: out-of-range parts roll over into the
/// next larger one, and a two-digit year is in the 1900s.
fn make_date(year: i64, month: i64, day: i64, hour: i64, minute: i64, second: i64, ms: i64) -> Option<NaiveDateTime> {
    let year = if (0..=99).contains(&year) { 1900 + year } else { year };
    let year = year + month.div_euclid(12);
    let first = NaiveDate::from_ymd_opt(i32::try_from(year).ok()?, u32::try_from(month.rem_euclid(12) + 1).ok()?, 1)?;
    let offset = Duration::try_days(day - 1)?
        .checked_add(&Duration::try_hours(hour)?)?
        .checked_add(&Duration::try_minutes(minute)?)?
        .checked_add(&Duration::try_seconds(second)?)?
        .checked_add(&Duration::try_milliseconds(ms)?)?;
    first.and_time(NaiveTime::MIN).checked_add_signed(offset)
}

/// The instant a reader's wall clock names, as `Date` resolves one.
///
/// A time in a daylight-saving gap takes the offset from before the change, which moves it
/// forward by the gap: 02:30 on the spring-forward night is 03:30. A time that happens twice is
/// the first of the two.
fn resolve_local(wall: NaiveDateTime, zone: Zone) -> DateTime<Utc> {
    match zone.from_local_datetime(&wall) {
        LocalResult::Single(at) => at.with_timezone(&Utc),
        LocalResult::Ambiguous(first, second) => first.min(second).with_timezone(&Utc),
        LocalResult::None => {
            // A gap is at most a few hours, so the offset a day earlier is the one before it.
            let before = zone
                .offset_from_utc_datetime(&(wall - Duration::days(1)))
                .fix()
                .local_minus_utc();
            (wall - Duration::seconds(i64::from(before))).and_utc()
        },
    }
}

/// The offset `zone` has at `at`, in seconds east.
fn offset_at(zone: Zone, at_millis: i64) -> i64 {
    let at = DateTime::from_timestamp_millis(at_millis).unwrap_or_default().naive_utc();
    i64::from(zone.offset_from_utc_datetime(&at).fix().local_minus_utc())
}

/// `dayjs.tz(wall, zone)`: the instant a wall clock in `zone` names.
///
/// A port of the plugin's `fixOffset`, guess and all. Its first guess is the offset `zone` has
/// *now*, and in the hour that happens twice that guess decides which of the two it returns.
fn resolve_in_zone(wall: NaiveDateTime, zone: Zone, now: DateTime<Utc>) -> DateTime<Utc> {
    let local = wall.and_utc().timestamp_millis();
    let o0 = offset_at(zone, now.timestamp_millis());
    let mut guess = local - o0 * 1000;
    let o2 = offset_at(zone, guess);
    let millis = if o0 == o2 {
        guess
    } else {
        guess -= (o2 - o0) * 1000;
        let o3 = offset_at(zone, guess);
        // A gap: the offset changed, and the time is left where it was.
        if o2 == o3 { guess } else { local - o2.min(o3) * 1000 }
    };
    DateTime::from_timestamp_millis(millis).unwrap_or_default()
}

/// The wall clock an instant is at in the reader's zone.
fn wall_clock_at(at: DateTime<Utc>, zone: Zone) -> NaiveDateTime {
    at.with_timezone(&zone).naive_local()
}

/// `dayjs(text)`: the instant it names, or `None` where `isValid()` is false.
fn dayjs_parse(text: &str, zone: Zone) -> Option<DateTime<Utc>> {
    let ends_in_z = text.ends_with(['Z', 'z']);
    if !ends_in_z {
        if let Some(parts) = DAYJS_PARSE.captures(text) {
            // `d[2] - 1 || 0`, `d[3] || 1`: an absent month is January and an empty day the first,
            // while a day of `00` is the last of the month before.
            let number = |i: usize, default: i64| group(&parts, i).unwrap_or(default);
            let millis = parts.get(7).map_or("0", |part| part.as_str());
            let millis = millis[..millis.len().min(3)].parse::<i64>().ok()?;
            let wall = make_date(
                number(1, 0), number(2, 1) - 1, number(3, 1), number(4, 0), number(5, 0), number(6, 0),
                millis,
            )?;
            return Some(resolve_local(wall, zone));
        }
    }
    let parts = WITH_OFFSET.captures(text)?;
    let number = |i: usize| group(&parts, i).unwrap_or(0);
    let fraction = parts.get(7).map_or("0", |part| part.as_str());
    let millis = format!("{:0<3}", &fraction[..fraction.len().min(3)]).parse::<i64>().ok()?;
    let wall = make_date(number(1), number(2) - 1, number(3), number(4), number(5), number(6), millis)?;
    let offset = match parts.get(8) {
        Some(_) => 0,
        None => {
            let sign = if &parts[9] == "-" { -1 } else { 1 };
            sign * (number(10) * 3600 + number(11) * 60)
        },
    };
    Some((wall - Duration::seconds(offset)).and_utc())
}

/// `instantOf`: the moment a value names, for comparing two spellings of it.
fn instant_of(value: Option<&Value>, zone: Zone) -> Option<i64> {
    match value {
        Some(Value::String(text)) => dayjs_parse(text, zone).map(|at| at.timestamp_millis()),
        _ => None,
    }
}

/// `parseWallClock`: a datetime as written, offset ignored, and whether it has a time.
fn parse_wall_clock(text: &str) -> Option<(NaiveDateTime, bool)> {
    let parts = WALL_CLOCK.captures(text.trim())?;
    let number = |i: usize| group(&parts, i).unwrap_or(0);
    let wall = make_date(number(1), number(2) - 1, number(3), number(4), number(5), number(6), 0)?;
    Some((wall, parts.get(4).is_some()))
}

/// `toWallClock`: where the calendar draws a start. An offset is converted into the reader's
/// zone; a wall clock without one is already the reader's, and is taken as written.
pub(crate) fn to_wall_clock(text: &str, zone: Zone) -> Option<Start> {
    let Some((wall, has_time)) = parse_wall_clock(text) else {
        // The frontend hands such a string to the view as it stands. It passed `dayjs`, so read it
        // the way `dayjs` does.
        return dayjs_parse(text, zone).map(|at| Start::Time(wall_clock_at(at, zone)));
    };
    if !has_time {
        return Some(Start::Date(wall.date()));
    }
    if HAS_OFFSET.is_match(text) {
        if let Some(at) = dayjs_parse(text, zone) {
            // `format` has no milliseconds to show.
            let local = wall_clock_at(at, zone);
            return Some(Start::Time(local.with_nanosecond(0).unwrap_or(local)));
        }
    }
    Some(Start::Time(wall))
}

/// The value as JavaScript's `String()` would spell it, for the regexes that coerce their input.
fn as_js_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Sequence(list) => list
            .iter()
            .map(|item| match item {
                Value::Null => Some(String::new()),
                other => as_js_string(other),
            })
            .collect::<Option<Vec<_>>>()
            .map(|parts| parts.join(",")),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Null | Value::Mapping(_) | Value::Tagged(_) => None,
    }
}

/// Whether `normalizeEndTime` accepts `end`. The occurrence is dropped when it does not.
fn end_is_usable(end: Option<&Value>, zone: Zone) -> bool {
    let text = match end {
        None => return true,
        // `null` is not `undefined`: the frontend tries to read it, fails, and drops the
        // occurrence. That is what `end:` left empty does to an event's instances.
        Some(Value::Null) => return false,
        // Taken, and later stringified into an end nobody reads.
        Some(Value::Bool(_) | Value::Number(_)) => return true,
        Some(other) => match as_js_string(other) {
            Some(text) => text,
            None => return false,
        },
    };
    DURATION_SHORT.is_match(&text)
        || DURATION_LONG.is_match(&text)
        || dayjs_parse(&text, zone).is_some()
        // A bare time of day belongs to the start's date, which is always a date `dayjs` reads.
        || dayjs_parse(&format!("2000-01-01 {text}"), zone).is_some()
}

// --- events -----------------------------------------------------------------------------------

/// The instants, in milliseconds, a rule's occurrences are drawn within.
type Window = std::ops::RangeInclusive<i64>;

/// Where a start comes from: the note, or a rule that generated it.
#[derive(Clone, Copy)]
enum StartInput<'a> {
    Written(Option<&'a Value>),
    Generated(Start),
}

/// What an occurrence falls back to when its own field is missing: nothing for an event's own
/// start, and the event for its instances and for what its rule generates.
///
/// The frontend carries a series' end to each occurrence as a duration (`durationOf`), but only
/// whether an end is usable matters here, and that conversion never changes it.
#[derive(Default)]
struct Parent<'a> {
    end: Option<&'a Value>,
    color: Option<&'a Value>,
    location: Option<&'a Value>,
}

impl<'a> Parent<'a> {
    fn of(detail: &'a Mapping) -> Self {
        Parent { end: detail.get("end"), color: detail.get("color"), location: detail.get("location") }
    }
}

/// `buildOccurrence`, as far as it decides whether and where the occurrence is drawn. `own` is the
/// occurrence's own fields, when it has any.
fn build_occurrence(
    own: Option<&Mapping>,
    start: StartInput<'_>,
    parent: &Parent<'_>,
    event_name: &str,
    path: &str,
    reader: &Reader,
    out: &mut Vec<Occurrence>,
) {
    let get = |key: &str| own.and_then(|own| own.get(key));
    let start = match start {
        StartInput::Generated(start) => start,
        StartInput::Written(Some(Value::String(text))) if dayjs_parse(text, reader.zone).is_some() => {
            // Some whenever `dayjs` reads it.
            let Some(start) = to_wall_clock(text, reader.zone) else {
                return;
            };
            start
        },
        StartInput::Written(_) => return,
    };

    // `time.end ?? parent.end`
    if !end_is_usable(present(get("end")).or(parent.end), reader.zone) {
        return;
    }

    // `time.name || eventName`, then `validateEvent`, which refuses a name that is not a string.
    let name = match get("name").filter(|name| truthy(name)) {
        Some(Value::String(name)) => name.clone(),
        Some(_) => return,
        None => event_name.to_owned(),
    };
    // `time.color || parent.color || ...`: the rest are always strings, so only these can fail it.
    if let Some(color) = [get("color"), parent.color].into_iter().flatten().find(|color| truthy(color)) {
        if !color.is_string() {
            return;
        }
    }
    let location = [get("location"), parent.location]
        .into_iter()
        .flatten()
        .find(|location| truthy(location))
        .and_then(|location| location.as_str())
        .map(str::to_owned);

    out.push(Occurrence {
        path: path.to_owned(),
        name,
        start,
        // The views take any truthy value as finished: `finished: yes` is text in YAML 1.2.
        finished: get("finished").is_some_and(truthy),
        location,
    });
}

/// `eventsOfEntry`.
fn events_of_entry(
    event_name: &str,
    detail: &Mapping,
    path: &str,
    window: &Window,
    reader: &Reader,
    out: &mut Vec<Occurrence>,
) {
    // A key that is present counts even when it is `null`, as `!== undefined` does.
    if detail.contains_key("start") {
        if detail.contains_key("repeat") {
            expand_series(event_name, detail, path, window, reader, out);
        } else {
            let start = StartInput::Written(detail.get("start"));
            build_occurrence(Some(detail), start, &Parent::default(), event_name, path, reader, out);
        }
    }
    // `instances ?? times`, and only the entries that are objects.
    let listed = present(detail.get("instances")).or_else(|| detail.get("times"));
    let parent = Parent::of(detail);
    for occurrence in as_array(listed).iter().filter_map(Value::as_mapping) {
        let start = StartInput::Written(occurrence.get("start"));
        build_occurrence(Some(occurrence), start, &parent, event_name, path, reader, out);
    }
}

/// `expandSeries`.
fn expand_series(
    event_name: &str,
    detail: &Mapping,
    path: &str,
    window: &Window,
    reader: &Reader,
    out: &mut Vec<Occurrence>,
) {
    let zone = reader.zone;
    let expand = |from: NaiveDate, to: NaiveDate| {
        expand_rule(detail.get("repeat"), detail.get("start"), from, to, reader)
    };
    let local_date = |instant: i64| {
        wall_clock_at(DateTime::from_timestamp_millis(instant).unwrap_or_default(), zone).date()
    };

    let Some(generated) = expand(
        local_date(*window.start()) - Duration::days(2),
        local_date(*window.end()) + Duration::days(2),
    ) else {
        return;
    };

    let excluded: BTreeSet<i64> = as_array(detail.get("exclusions"))
        .iter()
        .filter_map(|exclusion| instant_of(Some(exclusion), zone))
        .collect();

    // Keyed by instant, the last of two for one instant winning, as `Map.set` does. The order
    // occurrences are drawn in is nobody's concern: every reader sorts them.
    let mut overrides: BTreeMap<i64, &Mapping> = BTreeMap::new();
    for adjustment in as_array(detail.get("overrides")).iter().filter_map(Value::as_mapping) {
        if let Some(instant) = instant_of(adjustment.get("at"), zone) {
            overrides.insert(instant, adjustment);
        }
    }

    let instant = |start: Start| start.begins(reader).timestamp_millis();
    let mut slots: BTreeMap<i64, Start> = BTreeMap::new();
    for start in generated {
        if window.contains(&instant(start)) {
            slots.insert(instant(start), start);
        }
    }

    // An override that moves its occurrence into the window from outside it: its slot was not
    // generated above, and is looked for over the days around it.
    for (at, adjustment) in &overrides {
        let Some(moved) = instant_of(adjustment.get("start"), zone) else {
            continue;
        };
        if slots.contains_key(at) || excluded.contains(at) || !window.contains(&moved) {
            continue;
        }
        let day = local_date(*at);
        let Some(around) = expand(day - Duration::days(1), day + Duration::days(1)) else {
            // The frontend gives up on the whole series here, before drawing any of it.
            return;
        };
        if let Some(start) = around.into_iter().find(|start| instant(*start) == *at) {
            slots.insert(*at, start);
        }
    }

    let parent = Parent::of(detail);
    for (at, generated) in slots {
        if excluded.contains(&at) {
            continue;
        }
        let adjustment = overrides.get(&at).copied();
        // `override?.start ?? occurrence`
        let start = match adjustment.and_then(|o| present(o.get("start"))) {
            Some(start) => StartInput::Written(Some(start)),
            None => StartInput::Generated(generated),
        };
        build_occurrence(adjustment, start, &parent, event_name, path, reader, out);
    }
}

// --- the rule -----------------------------------------------------------------------------------

fn weekday(name: &str) -> Option<Weekday> {
    match name {
        "sun" => Some(Weekday::Sun),
        "mon" => Some(Weekday::Mon),
        "tue" => Some(Weekday::Tue),
        "wed" => Some(Weekday::Wed),
        "thu" => Some(Weekday::Thu),
        "fri" => Some(Weekday::Fri),
        "sat" => Some(Weekday::Sat),
        _ => None,
    }
}

/// A zone by name, in any case, as `Intl` takes one.
fn zone_named(name: &str) -> Option<Zone> {
    name.parse().ok().or_else(|| {
        chrono_tz::TZ_VARIANTS.iter().copied().find(|zone| zone.name().eq_ignore_ascii_case(name))
    })
}

fn integer<T: TryFrom<i64>>(value: &Value) -> Option<T> {
    value.as_i64().and_then(|n| T::try_from(n).ok())
}

/// `expandRule`: the wall clock of every occurrence a rule generates within the days `[from, to]`,
/// in the reader's zone. `None` for any rule the frontend reports as unusable.
fn expand_rule(
    repeat: Option<&Value>,
    start: Option<&Value>,
    from: NaiveDate,
    to: NaiveDate,
    reader: &Reader,
) -> Option<Vec<Start>> {
    let Some(Value::Mapping(repeat)) = repeat else {
        return None;
    };
    let (anchor, has_time) = parse_wall_clock(start?.as_str()?)?;

    let freq = match repeat.get("freq")?.as_str()? {
        "daily" => Frequency::Daily,
        "weekly" => Frequency::Weekly,
        "monthly" => Frequency::Monthly,
        "yearly" => Frequency::Yearly,
        _ => return None,
    };
    let mut rule = RRule::new(freq);

    if let Some(byday) = repeat.get("byday") {
        let mut days = Vec::new();
        for day in byday.as_sequence()? {
            let parts = BYDAY.captures(day.as_str()?)?;
            let day = weekday(&parts[2])?;
            days.push(match parts.get(1) {
                None => NWeekday::Every(day),
                Some(ordinal) => {
                    let ordinal = ordinal.as_str().parse::<i16>().ok().filter(|n| *n != 0)?;
                    // "the third Wednesday" needs a period longer than a week to count within.
                    if freq == Frequency::Weekly {
                        return None;
                    }
                    NWeekday::Nth(ordinal, day)
                },
            });
        }
        rule = rule.by_weekday(days);
    }
    if let Some(interval) = repeat.get("interval") {
        rule = rule.interval(integer::<u16>(interval).filter(|n| *n > 0)?);
    }
    // rrule.js reads a `null` list as no list at all, and a single value as a list of one.
    let list = |value: &Value| match value {
        Value::Sequence(items) => items.clone(),
        single => vec![single.clone()],
    };
    if let Some(days) = present(repeat.get("bymonthday")) {
        rule = rule.by_month_day(list(days).iter().map(integer::<i8>).collect::<Option<_>>()?);
    }
    if let Some(months) = present(repeat.get("bymonth")) {
        let months = list(months)
            .iter()
            .map(|month| integer::<u8>(month).and_then(|n| chrono::Month::try_from(n).ok()))
            .collect::<Option<Vec<_>>>()?;
        rule = rule.by_month(&months);
    }
    // rrule.js falls back to Monday for a name it does not know, as `rrule` does for none.
    if let Some(day) = repeat.get("wkst").and_then(Value::as_str).and_then(weekday) {
        rule = rule.week_start(day);
    }
    if let Some(count) = present(repeat.get("count")) {
        rule = rule.count(integer::<u32>(count)?);
    }

    // Read only where something is converted with it, as the frontend reads it: an all-day rule
    // never is, so an unknown zone on one hides nothing. In any case, as `Intl` takes a name; `null`
    // and `''` reach `dayjs.tz` as no zone at all, which is the reader's.
    let zone: Option<Option<Zone>> = match repeat.get("tz") {
        None => None,
        Some(Value::Null) => Some(Some(reader.zone)),
        Some(Value::String(name)) if name.is_empty() => Some(Some(reader.zone)),
        Some(Value::String(name)) => Some(zone_named(name)),
        Some(_) => Some(None),
    };

    if let Some(until) = repeat.get("until") {
        let text = until.as_str()?;
        let (mut bound, until_has_time) = parse_wall_clock(text)?;
        // Compared in the rule's own frame, so an offset on it is read rather than ignored --
        // unlike `start`'s -- once there is a zone to read it into.
        if let Some(zone) = zone {
            if until_has_time && HAS_OFFSET.is_match(text) {
                let zone = zone?;
                let at = dayjs_parse(text, reader.zone)?;
                bound = wall_clock_at(at, zone).with_nanosecond(0)?;
            }
        }
        if !until_has_time {
            bound = bound.date().and_hms_opt(23, 59, 59)?;
        }
        rule = rule.until(Tz::UTC.from_utc_datetime(&bound));
    }

    let convert_into = match (has_time, zone) {
        (true, Some(zone)) => Some(zone?),
        _ => None,
    };

    let floating = |wall: NaiveDateTime| Tz::UTC.from_utc_datetime(&wall);
    let set = rule.build(floating(anchor)).ok()?;
    let generated = set
        .after(floating(from.and_time(NaiveTime::MIN)))
        .before(floating(to.and_hms_opt(23, 59, 59)?))
        .all(u16::MAX)
        .dates;

    Some(
        generated
            .into_iter()
            .map(|at| {
                let wall = at.naive_utc();
                match (has_time, convert_into) {
                    (false, _) => Start::Date(wall.date()),
                    (true, None) => Start::Time(wall),
                    // Into the reader's zone, to the minute: the frontend formats it `HH:mm`.
                    (true, Some(zone)) => {
                        let local = wall_clock_at(resolve_in_zone(wall, zone, reader.now), reader.zone);
                        Start::Time(local.with_second(0).and_then(|t| t.with_nanosecond(0)).unwrap_or(local))
                    },
                }
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOS_ANGELES: Zone = chrono_tz::America::Los_Angeles;

    fn reader() -> Reader {
        Reader { zone: LOS_ANGELES, now: "2024-01-15T00:00:00Z".parse().unwrap() }
    }

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

    /// What a reader in Los Angeles sees over 2024: `start  name`, in order.
    fn drawn(yaml: &str) -> Vec<String> {
        let reader = reader();
        let (from, to) = day_window(
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
            NaiveDate::from_ymd_opt(2024, 12, 31).unwrap(),
            &reader,
        );
        let mut shown: Vec<String> = occurrences(&[entry(yaml)], from, to, &reader)
            .iter()
            .map(|o| format!("{}  {}", o.start, o.name))
            .collect();
        shown.sort();
        shown
    }

    fn at(text: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M").unwrap()
    }

    #[test]
    fn a_local_time_in_a_gap_moves_forward_and_a_repeated_one_is_the_first() {
        // What `new Date(2024, 2, 10, 2, 30)` and `new Date(2024, 10, 3, 1, 30)` give in
        // Los Angeles.
        assert_eq!(resolve_local(at("2024-03-10 02:30"), LOS_ANGELES).to_rfc3339(), "2024-03-10T10:30:00+00:00");
        assert_eq!(resolve_local(at("2024-11-03 01:30"), LOS_ANGELES).to_rfc3339(), "2024-11-03T08:30:00+00:00");
    }

    #[test]
    fn a_repeated_hour_in_a_named_zone_depends_on_the_season_of_now() {
        let summer = "2024-07-01T00:00:00Z".parse().unwrap();
        let winter = "2024-01-01T00:00:00Z".parse().unwrap();
        assert_eq!(resolve_in_zone(at("2024-11-03 01:30"), LOS_ANGELES, summer).to_rfc3339(), "2024-11-03T08:30:00+00:00");
        assert_eq!(resolve_in_zone(at("2024-11-03 01:30"), LOS_ANGELES, winter).to_rfc3339(), "2024-11-03T09:30:00+00:00");
        // A gap moves forward, whatever the season.
        assert_eq!(resolve_in_zone(at("2024-03-10 02:30"), LOS_ANGELES, winter).to_rfc3339(), "2024-03-10T10:30:00+00:00");
    }

    #[test]
    fn a_start_with_an_offset_is_drawn_in_the_readers_zone() {
        assert_eq!(
            drawn("events: { Call: { start: '2024-05-01 10:00:00+09:00' } }"),
            ["2024-04-30 18:00  Call"],
        );
        assert_eq!(drawn("events: { Call: { start: '2024-05-01 10:00' } }"), ["2024-05-01 10:00  Call"]);
        assert_eq!(drawn("events: { Holiday: { start: '2024-05-01' } }"), ["2024-05-01  Holiday"]);
    }

    #[test]
    fn a_rule_is_expanded_with_its_exclusions_and_overrides() {
        let yaml = "
events:
    Standup:
        start: '2024-05-06 09:00'
        repeat: { freq: daily, count: 4 }
        exclusions: ['2024-05-07 09:00']
        overrides:
            - { at: '2024-05-08 09:00', start: '2024-05-08 10:30', name: Late standup }
";
        assert_eq!(drawn(yaml), [
            "2024-05-06 09:00  Standup",
            "2024-05-08 10:30  Late standup",
            "2024-05-09 09:00  Standup",
        ]);
    }

    #[test]
    fn a_rule_in_another_zone_is_converted_to_the_minute() {
        let yaml = "
events:
    Sync:
        start: '2024-05-06 09:00:30'
        repeat: { freq: weekly, count: 2, tz: Asia/Tokyo }
";
        assert_eq!(drawn(yaml), ["2024-05-05 17:00  Sync", "2024-05-12 17:00  Sync"]);
    }

    #[test]
    fn instances_are_drawn_under_their_own_names() {
        let yaml = "
events:
    Class:
        instances:
            - { start: '2024-05-01 09:00' }
            - { start: '2024-05-02 09:00', name: Exam }
            - { start: not a date }
";
        assert_eq!(drawn(yaml), ["2024-05-01 09:00  Class", "2024-05-02 09:00  Exam"]);
    }

    #[test]
    fn an_empty_end_hides_instances_and_occurrences_but_not_the_start() {
        // `end: null` is not `undefined` to the frontend, which reads it and fails.
        let yaml = "
events:
    Once: { start: '2024-05-01 09:00', end: null }
    Listed: { end: null, instances: [{ start: '2024-05-02 09:00' }] }
    Ruled: { start: '2024-05-03 09:00', end: null, repeat: { freq: daily, count: 2 } }
";
        assert_eq!(drawn(yaml), ["2024-05-01 09:00  Once"]);
    }

    #[test]
    fn a_name_or_colour_that_is_not_text_hides_the_occurrence() {
        let yaml = "
events:
    Numbered: { start: '2024-05-01 09:00', name: 5 }
    Painted: { start: '2024-05-01 10:00', color: 5 }
    Blank: { start: '2024-05-01 11:00', name: '' }
";
        assert_eq!(drawn(yaml), ["2024-05-01 11:00  Blank"]);
    }

    #[test]
    fn anything_truthy_is_finished_as_the_views_read_it() {
        let reader = reader();
        let (from, to) = day_window(
            NaiveDate::from_ymd_opt(2024, 5, 1).unwrap(),
            NaiveDate::from_ymd_opt(2024, 5, 1).unwrap(),
            &reader,
        );
        let entries = [entry("
events:
    Said yes: { start: '2024-05-01 09:00', finished: yes }
    Done: { start: '2024-05-01 10:00', finished: true }
    Not done: { start: '2024-05-01 11:00', finished: false }
    Empty: { start: '2024-05-01 12:00', finished: '' }
")];
        let mut finished: Vec<(String, bool)> =
            occurrences(&entries, from, to, &reader).into_iter().map(|o| (o.name, o.finished)).collect();
        finished.sort();
        assert_eq!(finished, [
            ("Done".to_owned(), true),
            ("Empty".to_owned(), false),
            ("Not done".to_owned(), false),
            ("Said yes".to_owned(), true),
        ]);
    }

    #[test]
    fn an_end_is_a_duration_a_datetime_or_a_time_of_day() {
        let yaml = "
events:
    A: { start: '2024-05-01 09:00', end: '+90m' }
    B: { start: '2024-05-01 10:00', end: '2024-05-01 11:00' }
    C: { start: '2024-05-01 11:00', end: '12:00' }
    D: { start: '2024-05-01 12:00', end: soon }
";
        assert_eq!(drawn(yaml), [
            "2024-05-01 09:00  A",
            "2024-05-01 10:00  B",
            "2024-05-01 11:00  C",
        ]);
    }

    #[test]
    fn an_override_moving_an_occurrence_into_the_window_is_found() {
        let reader = reader();
        let entries = [entry("
events:
    Review:
        start: '2024-05-06 09:00'
        repeat: { freq: weekly }
        overrides: [{ at: '2024-05-13 09:00', start: '2024-05-10 15:00' }]
")];
        let day = NaiveDate::from_ymd_opt(2024, 5, 10).unwrap();
        let (from, to) = day_window(day, day, &reader);
        let found: Vec<String> =
            occurrences(&entries, from, to, &reader).iter().map(|o| o.start.to_string()).collect();
        assert_eq!(found, ["2024-05-10 15:00"]);
    }
}
