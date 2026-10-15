//! The event tools. An event is an entry in a note's `events:` map, keyed by its name, so these
//! are frontmatter edits like the task tools.
//!
//! Three details are what a model gets wrong unaided, so each is checked rather than trusted:
//! weekdays are three letters and may carry an ordinal, `repeat.tz` is an IANA zone name and
//! never an offset, and a datetime carries its offset while a date is bare.

use std::sync::LazyLock;

use chrono_tz::Tz;
use regex::Regex;
use rmcp::{model::CallToolResult, ErrorData};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_yaml::{Mapping, Value};

use super::frontmatter::{self, Change};
use super::tools::{alarm_list, edited_note, note_to_edit, safe_path, write_note};
use super::tool_error;
use crate::models::AppState;
use crate::note_events;

/// Three letters, not iCal's two, optionally after an ordinal: `3wed` is the third Wednesday,
/// `-1fri` the last Friday. This is what separates "the third Wednesday of each month" from
/// "every three weeks on Wednesday".
const WEEKDAYS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FREQUENCIES: [&str; 4] = ["daily", "weekly", "monthly", "yearly"];

/// A moment as the notes spell one: a bare date, or a datetime carrying its offset.
///
/// The calendar reads a datetime without an offset too, as the reader's wall clock, which is why
/// such a value has to be refused here rather than left for the calendar to catch: it would be
/// drawn, at an hour that moves with whoever reads it. Read with the reader the task dates are
/// checked with, so the two kinds of date follow one rule.
fn check_when(key: &str, value: &str) -> Result<(), String> {
    check_unpadded(key, value)?;
    let text = Value::String(value.to_owned());
    if crate::urgency::instant(Some(&text), crate::urgency::local_zone(), false).is_none() {
        return Err(format!(
            "{key} {value:?} is neither a bare date (`2026-03-12`) nor a datetime carrying its \
             offset (`2026-03-12 19:00:00+09:00`).",
        ));
    }
    Ok(())
}

/// Refuses white space around a value. The readers trim it, but the calendar does not: an `end`
/// of `"+90m "` is dropped with its occurrence.
fn check_unpadded(key: &str, value: &str) -> Result<(), String> {
    if value.trim() != value {
        return Err(format!("{key} {value:?} has white space around it; leave it out."));
    }
    Ok(())
}

/// A duration, as `normalizeEndTime` in `frontend/src/events.ts` reads one: `+90m`, `+1.5h`,
/// `+2 days`. Its own pattern takes `[\d.]+`, so `+.h` too, which `parseFloat` makes `NaN`, and
/// the calendar an end of "Invalid Date"; this one needs a digit.
static DURATION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^\+([0-9]+(?:\.[0-9]*)?|\.[0-9]+) *(y|M|w|d|h|m|s|ms|(?i:years?|months?|weeks?|days?|hours?|minutes?|seconds?|milliseconds?))$",
    )
    .unwrap()
});

/// The longest duration an `end` may give, in days. An end past the year 9999 is one the calendar
/// cannot draw, and no event lasts a thousand years.
const LONGEST_DAYS: f64 = 1000.0 * 366.0;

/// How many days a duration `DURATION` matches is, roughly: enough to tell one that is absurd.
fn duration_days(value: &str) -> Option<f64> {
    let captures = DURATION.captures(value)?;
    let amount: f64 = captures[1].parse().ok()?;
    let per = match &captures[2] {
        "y" => 366.0,
        "M" => 31.0,
        "w" => 7.0,
        "d" => 1.0,
        "h" => 1.0 / 24.0,
        "m" => 1.0 / 1440.0,
        "s" => 1.0 / 86_400.0,
        "ms" => 1.0 / 86_400_000.0,
        long => match long.to_ascii_lowercase().trim_end_matches('s') {
            "year" => 366.0,
            "month" => 31.0,
            "week" => 7.0,
            "day" => 1.0,
            "hour" => 1.0 / 24.0,
            "minute" => 1.0 / 1440.0,
            "second" => 1.0 / 86_400.0,
            _ => 1.0 / 86_400_000.0,
        },
    };
    Some(amount * per)
}

/// A time of day, which belongs to the start's date, or the next one when it would precede it.
static TIME_OF_DAY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$").unwrap());

/// An `end`: a moment as `check_when` takes one, a time of day, or a duration from the start.
fn check_end(value: &str) -> Result<(), String> {
    check_unpadded("end", value)?;
    if let Some(days) = duration_days(value) {
        if days > LONGEST_DAYS {
            return Err(format!("end {value:?} is more than a thousand years after the start."));
        }
        return Ok(());
    }
    if TIME_OF_DAY.is_match(value) || check_when("`end`", value).is_ok() {
        return Ok(());
    }
    Err(format!(
        "end {value:?} is none of a duration (`+90m`, `+1.5h`), a time of day (`18:30`), a bare \
         date, or a datetime carrying its offset.",
    ))
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Repeat {
    /// `daily`, `weekly`, `monthly` or `yearly`.
    pub freq: String,
    #[serde(default)]
    pub interval: Option<i64>,
    /// Weekdays as three letters, optionally after an ordinal: `wed`, `3wed`, `-1fri`. An
    /// ordinal needs `freq: monthly` or `yearly`.
    #[serde(default)]
    pub byday: Option<Vec<String>>,
    /// Days of the month, 1 to 31 or -31 to -1.
    #[serde(default)]
    pub bymonthday: Option<Vec<i64>>,
    /// Months, 1 to 12.
    #[serde(default)]
    pub bymonth: Option<Vec<i64>>,
    /// The week's first day, as three letters.
    #[serde(default)]
    pub wkst: Option<String>,
    /// An IANA zone name such as `Asia/Tokyo`. Never an offset: a zone maps a date to an offset,
    /// and a series crossing a daylight-saving boundary needs the name to do it.
    #[serde(default)]
    pub tz: Option<String>,
    /// When the series stops. Mutually exclusive with `count`.
    #[serde(default)]
    pub until: Option<String>,
    /// How many occurrences. Mutually exclusive with `until`.
    #[serde(default)]
    pub count: Option<i64>,
}

impl Repeat {
    fn to_value(&self) -> Result<Value, String> {
        if !FREQUENCIES.contains(&self.freq.as_str()) {
            return Err(format!(
                "{:?} is not a frequency. Use one of: {}.",
                self.freq,
                FREQUENCIES.join(", "),
            ));
        }
        if self.until.is_some() && self.count.is_some() {
            return Err("A rule has `until` or `count`, never both.".to_owned());
        }
        // `note_events` holds an interval in a `u16`, and the web app refuses a rule past it.
        if self.interval.is_some_and(|interval| !(1..=65_535).contains(&interval)) {
            return Err("`interval` must be a whole number from 1 to 65535.".to_owned());
        }

        let mut repeat = Mapping::new();
        repeat.insert("freq".into(), self.freq.as_str().into());
        if let Some(interval) = self.interval {
            repeat.insert("interval".into(), interval.into());
        }
        if let Some(byday) = &self.byday {
            let mut days = Vec::with_capacity(byday.len());
            for day in byday {
                days.push(Value::String(check_weekday(day, &self.freq)?));
            }
            repeat.insert("byday".into(), Value::Sequence(days));
        }
        if let Some(bymonthday) = &self.bymonthday {
            if let Some(bad) = bymonthday.iter().find(|day| **day == 0 || day.abs() > 31) {
                return Err(format!("{bad} is not a day of the month."));
            }
            repeat.insert(
                "bymonthday".into(),
                Value::Sequence(bymonthday.iter().map(|day| (*day).into()).collect()),
            );
        }
        if let Some(bymonth) = &self.bymonth {
            if let Some(bad) = bymonth.iter().find(|month| !(1i64..=12).contains(month)) {
                return Err(format!("{bad} is not a month."));
            }
            repeat.insert(
                "bymonth".into(),
                Value::Sequence(bymonth.iter().map(|month| (*month).into()).collect()),
            );
        }
        if let Some(wkst) = &self.wkst {
            let lowered = wkst.to_ascii_lowercase();
            if !WEEKDAYS.contains(&lowered.as_str()) {
                return Err(format!(
                    "`wkst` is a weekday as three letters: {}.",
                    WEEKDAYS.join(", "),
                ));
            }
            repeat.insert("wkst".into(), lowered.into());
        }
        if let Some(tz) = &self.tz {
            check_timezone(tz)?;
            repeat.insert("tz".into(), tz.as_str().into());
        }
        if let Some(until) = &self.until {
            check_when("`until`", until)?;
            repeat.insert("until".into(), until.as_str().into());
        }
        if let Some(count) = self.count {
            if count < 1 {
                return Err("`count` must be at least 1.".to_owned());
            }
            repeat.insert("count".into(), count.into());
        }
        Ok(Value::Mapping(repeat))
    }
}

/// A weekday, with its ordinal if it has one.
fn check_weekday(day: &str, freq: &str) -> Result<String, String> {
    let lowered = day.trim().to_ascii_lowercase();
    // Checked, because three bytes back can land inside a multibyte character, and `day` is
    // whatever the model sent. A split there cannot end in a weekday anyway, so the whole of it
    // goes to the name and is refused as one.
    let (ordinal, name) = lowered
        .split_at_checked(lowered.len().saturating_sub(3))
        .unwrap_or(("", &lowered));
    if !WEEKDAYS.contains(&name) {
        return Err(format!(
            "{day:?} is not a weekday. These are three letters, not iCal's two: {}. An ordinal \
             may come first, as in `3wed` or `-1fri`.",
            WEEKDAYS.join(", "),
        ));
    }
    if !ordinal.is_empty() {
        // As `toWeekday` in `frontend/src/recurrence.ts` reads one: digits after an optional
        // minus, never a plus, and never zero, which rrule throws on.
        let digits = ordinal.strip_prefix('-').unwrap_or(ordinal);
        if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(format!("{day:?} has an ordinal that is not a number, such as `3` or `-1`."));
        }
        if digits.bytes().all(|byte| byte == b'0') {
            return Err(format!("{day:?} has an ordinal of zero; the first is `1`, the last `-1`."));
        }
        // An ordinal picks a weekday within a period, so there has to be a period to pick within.
        if freq != "monthly" && freq != "yearly" {
            return Err(format!(
                "{day:?} carries an ordinal, which needs `freq: monthly` or `yearly`. For \
                 \"every three weeks on Wednesday\", use `freq: weekly` with `interval: 3` and \
                 a plain `wed`.",
            ));
        }
    }
    Ok(lowered)
}

/// An IANA zone name, checked by asking chrono to resolve it.
///
/// An offset here would be silently wrong rather than loudly wrong: it works until the series
/// crosses a daylight-saving boundary, and then every occurrence after it is an hour out.
fn check_timezone(tz: &str) -> Result<(), String> {
    if tz.starts_with(['+', '-']) || tz.contains(':') || tz.eq_ignore_ascii_case("z") {
        return Err(format!(
            "`tz` is an IANA zone name such as `Asia/Tokyo`, not the offset {tz:?}. A zone maps \
             a date to an offset, which is what a rule crossing a daylight-saving change needs.",
        ));
    }
    if tz.parse::<chrono_tz::Tz>().is_err() {
        return Err(format!(
            "{tz:?} is not an IANA zone name. They look like `Asia/Tokyo` or `Europe/London`.",
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EventArgs {
    /// The note's exact repository path.
    pub path: String,
    /// The event's name, which is its key in the note's `events:` map.
    pub name: String,
    /// The commit message.
    pub message: String,

    /// The event's own occurrence, apart from any it lists under `instances`. A bare date for a
    /// whole day (`2026-03-12`), or a datetime carrying its offset (`2026-03-12 19:00:00+09:00`).
    /// The shape is what makes it an all-day event. An event that lists its occurrences needs
    /// none.
    #[serde(default)]
    pub start: Option<String>,
    /// When it ends: a datetime, a bare time of day, or a duration such as `+1.5h`.
    #[serde(default)]
    pub end: Option<String>,
    #[serde(default)]
    pub finished: Option<bool>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    /// The id of an event category configured under `categories:` in `.mory/calendars.yaml`.
    /// The web app draws the event in the category's colour, unless the event sets its own, and
    /// with the category's name template. Must be configured already; `list_events` lists them.
    #[serde(default)]
    pub category: Option<String>,
    /// When it rings, as a list: offsets from the start (`-10m` before it, `+1h` after, in w, d,
    /// h, m or s) or times on the start's day (`09:00`, `-1d 18:00`). The sign is required, so
    /// `10m` is refused. Without one it rings at its start if it is timed, never if all-day,
    /// unless its category or the config says otherwise. An empty list silences it; name
    /// `alarms` in `clear` to go back to the category's and the config's.
    #[serde(default)]
    pub alarms: Option<Vec<String>>,
    /// A recurrence rule.
    #[serde(default)]
    pub repeat: Option<Repeat>,
    /// Occurrences the rule generates that should not happen. Matched by instant, not by
    /// spelling: `2026-01-30 10:00:00+09:00` and the same moment written another way are the
    /// same occurrence.
    #[serde(default)]
    pub exclusions: Option<Vec<String>>,
    /// Occurrences to add to the event's list of them, each with its own `start`: for an event
    /// that happens on dates no rule describes, such as the next meeting of a committee. They
    /// join the list the event keeps, `instances` or the older `times`, where their date puts
    /// them: newest or oldest first as the list runs, as the note's other lists run when it is too
    /// short to show, else newest first; at the end of a list in no order. Taking one out with
    /// `remove_instances` and adding it here moves it.
    #[serde(default)]
    pub add_instances: Option<Vec<Instance>>,
    /// Occurrences to take off the event's list, named by their `start`. Matched by instant, so
    /// the note's own spelling (`2025-03-14 16:00`) and the same moment with its offset both
    /// name it; a bare date names a whole-day occurrence, never one at midnight.
    #[serde(default)]
    pub remove_instances: Option<Vec<String>>,
    /// Keys to remove from the event entirely.
    #[serde(default)]
    pub clear: Option<Vec<String>>,
}

const EVENT_KEYS: [&str; 14] = [
    "start", "end", "finished", "color", "note", "location", "url", "category", "alarms", "repeat",
    "exclusions", "overrides", "instances", "times",
];

/// One occurrence in an event's list of them.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Instance {
    /// When it starts: a bare date for a whole day, or a datetime carrying its offset.
    pub start: String,
    /// When it ends: a datetime, a bare time of day, or a duration such as `+1.5h`.
    #[serde(default)]
    pub end: Option<String>,
    #[serde(default)]
    pub finished: Option<bool>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    /// What this occurrence is called, in place of the event's name.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    /// When this occurrence rings, in place of the event's `alarms`, and spelt as they are.
    #[serde(default)]
    pub alarms: Option<Vec<String>>,
}

impl Instance {
    /// The entry as the list holds it, its keys in the order the schema lists them.
    fn to_value(&self) -> Result<Value, String> {
        check_when("An instance's `start`", &self.start)?;
        let mut entry = Mapping::new();
        entry.insert("start".into(), self.start.as_str().into());
        if let Some(end) = &self.end {
            check_end(end)?;
            entry.insert("end".into(), end.as_str().into());
        }
        if let Some(finished) = self.finished {
            entry.insert("finished".into(), finished.into());
        }
        for (key, value) in [
            ("color", &self.color),
            ("note", &self.note),
            ("name", &self.name),
            ("location", &self.location),
            ("url", &self.url),
        ] {
            if let Some(value) = value {
                entry.insert(key.into(), value.as_str().into());
            }
        }
        if let Some(alarms) = &self.alarms {
            entry.insert("alarms".into(), alarm_list(alarms)?);
        }
        Ok(Value::Mapping(entry))
    }
}

/// The changes an `EventArgs` asks for, under `events.<name>`.
fn event_changes(args: &EventArgs) -> Result<Vec<Change>, String> {
    let mut changes = Vec::new();
    for key in args.clear.as_deref().unwrap_or_default() {
        if !EVENT_KEYS.contains(&key.as_str()) {
            return Err(format!(
                "{key:?} is not an event key. Clear one of: {}.",
                EVENT_KEYS.join(", "),
            ));
        }
        changes.push(Change::remove(&["events", &args.name, key]));
    }

    let mut set = |key: &str, value: Value| {
        changes.push(Change::set(&["events", &args.name, key], value));
    };
    if let Some(start) = &args.start {
        check_when("`start`", start)?;
        set("start", start.as_str().into());
    }
    if let Some(end) = &args.end {
        check_end(end)?;
        set("end", end.as_str().into());
    }
    if let Some(finished) = args.finished {
        set("finished", finished.into());
    }
    for (key, value) in [
        ("color", &args.color),
        ("note", &args.note),
        ("location", &args.location),
        ("url", &args.url),
        ("category", &args.category),
    ] {
        if let Some(value) = value {
            set(key, value.as_str().into());
        }
    }
    if let Some(alarms) = &args.alarms {
        set("alarms", alarm_list(alarms)?);
    }
    if let Some(repeat) = &args.repeat {
        set("repeat", repeat.to_value()?);
    }
    if let Some(exclusions) = &args.exclusions {
        for at in exclusions {
            check_when("An exclusion", at)?;
        }
        set(
            "exclusions",
            Value::Sequence(exclusions.iter().map(|at| Value::String(at.clone())).collect()),
        );
    }
    Ok(changes)
}

/// The list edits `add_instances` and `remove_instances` ask for.
///
/// Worked out against the event as the note declares it, since which list an occurrence joins,
/// and where in it, depends on what is listed already. Each list edit is an item inserted or
/// removed in place, so the items around it keep their lines, flow style and comments included.
///
/// A start the note writes without an offset is read in `zone`, which is moried's own: the one
/// reader the server has, and the zone `list_tasks` reads a task's dates in.
fn instance_changes(args: &EventArgs, event: Option<&Value>, usual: Order, zone: Tz) -> Result<Vec<Change>, String> {
    let adds = args.add_instances.as_deref().unwrap_or_default();
    let removes = args.remove_instances.as_deref().unwrap_or_default();
    if adds.is_empty() && removes.is_empty() {
        return Ok(Vec::new());
    }
    let drawn = drawn_list(event);
    if let Some(key) = args.clear.iter().flatten().find(|key| Some(key.as_str()) == drawn) {
        return Err(format!("Clear `{key}` or change its occurrences, not both at once."));
    }
    let starts_at = |item: &Value| note_events::instant_of(item.get("start"), zone);
    // The calendar draws `2024-05-01` all day and `2024-05-01 00:00:00+09:00` at midnight: the
    // same instant, two occurrences.
    let starts = |start: Option<&Value>, at: i64, whole_day: bool| {
        note_events::instant_of(start, zone) == Some(at) && is_date_only(start) == whole_day
    };
    let is = |item: &Value, at: i64, whole_day: bool| starts(item.get("start"), at, whole_day);
    // The event's own occurrence as the edit leaves it, which the calendar draws beside the list.
    let own_start = match &args.start {
        Some(start) => Some(Value::String(start.clone())),
        None if args.clear.iter().flatten().any(|key| key == "start") => None,
        None => event.and_then(|event| event.get("start")).cloned(),
    };

    // The list as it stands, edited here as the note will be, so that each index is the one the
    // change before it left. Its order is read before any of that: a newest-first list that a
    // removal leaves holding one item no longer shows it.
    let mut lists: Vec<(&str, Vec<Value>, Order)> = Vec::new();
    if let Some(key) = drawn {
        let Some(list) = event.and_then(|event| event.get(key)?.as_sequence()) else {
            return Err(format!(
                "`{key}` in {:?} is not a list of occurrences. Use read_note and update_note to \
                 repair it.",
                args.name,
            ));
        };
        let order = if list.len() < 2 { usual } else { order_of(list, starts_at) };
        lists.push((key, list.clone(), order));
    }
    let mut changes = Vec::new();

    for start in removes {
        // The reader is as lenient as `dayjs`, which takes `2024-05`, `20240501` and `2024/05/01`
        // for the first of May; a name that vague is more likely a mistake than that day.
        let dated = NAMED_START.is_match(start);
        let Some(at) = note_events::instant_of(Some(&Value::String(start.clone())), zone).filter(|_| dated) else {
            return Err(format!(
                "{start:?} is not a moment. Name an occurrence by its `start`, as the note writes \
                 it or with its offset.",
            ));
        };
        let whole_day = is_date_only(Some(&Value::String(start.clone())));
        let mut found = false;
        for (key, list, _) in &mut lists {
            while let Some(index) = list.iter().position(|item| is(item, at, whole_day)) {
                list.remove(index);
                changes.push(Change::remove_item(&["events", &args.name, key], index));
                found = true;
            }
        }
        if !found {
            let listed: Vec<&str> = lists
                .iter()
                .flat_map(|(_, list, _)| list.iter().filter_map(|item| item.get("start")?.as_str()))
                .collect();
            if listed.is_empty() {
                return Err(format!("{:?} lists no occurrences to remove.", args.name));
            }
            return Err(format!(
                "{:?} lists no occurrence starting at {start:?}. Those it lists start at: {}.",
                args.name,
                listed.join(", "),
            ));
        }
    }

    // New occurrences join the list the calendar draws, so an event is never given a second list
    // by being added to.
    if !adds.is_empty() && lists.is_empty() {
        lists.push(("instances", Vec::new(), usual));
    }
    for instance in adds {
        let value = instance.to_value()?;
        let Some(at) = starts_at(&value) else {
            return Err(format!("An instance's `start` {:?} could not be read.", instance.start));
        };
        let whole_day = is_date_only(value.get("start"));
        if lists.iter().any(|(_, list, _)| list.iter().any(|item| is(item, at, whole_day))) {
            return Err(format!(
                "{:?} already lists an occurrence starting at {:?}. To change it, name it in \
                 `remove_instances` as well.",
                args.name, instance.start,
            ));
        }
        if starts(own_start.as_ref(), at, whole_day) {
            return Err(format!(
                "{:?} starts at {:?} itself, so an occurrence listed there would be drawn twice.",
                args.name, instance.start,
            ));
        }
        let (key, list, order) = &mut lists[0];
        let index = place_for(list, at, *order, starts_at);
        list.insert(index, value.clone());
        changes.push(Change::insert(&["events", &args.name, key], index, value));
    }
    Ok(changes)
}

/// Whether a start is a bare date, as `isDateOnly` in `frontend/src/events.ts` tells one.
fn is_date_only(start: Option<&Value>) -> bool {
    start.and_then(Value::as_str).is_some_and(|text| {
        let text = text.trim();
        text.len() == 10
            && text.bytes().enumerate().all(|(index, byte)| {
                if index == 4 || index == 7 { byte == b'-' } else { byte.is_ascii_digit() }
            })
    })
}

/// Which of an event's lists the calendar draws, as `occurrencesOf` in `frontend/src/api.ts` picks
/// it: `instances` unless it is missing or null, else the older `times`. The other is never drawn,
/// so the tools neither search it nor add to it, and an occurrence there does not count as one.
fn drawn_list(event: Option<&Value>) -> Option<&'static str> {
    let event = event?;
    ["instances", "times"].into_iter().find(|key| event.get(*key).is_some_and(|value| !value.is_null()))
}

/// How an occurrence to remove is named: its whole date, then its time if it has one.
static NAMED_START: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:$|[ T][0-9])").unwrap());

/// The order a list keeps its occurrences in. The notes keep both.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Order {
    Ascending,
    Descending,
    /// Neither, or a start that cannot be read.
    None,
}

fn order_of(list: &[Value], starts_at: impl Fn(&Value) -> Option<i64>) -> Order {
    let Some(starts) = list.iter().map(starts_at).collect::<Option<Vec<_>>>() else {
        return Order::None;
    };
    if starts.is_sorted() {
        Order::Ascending
    }
    else if starts.is_sorted_by(|a, b| a >= b) {
        Order::Descending
    }
    else {
        Order::None
    }
}

/// The order taken for a list too short to show one: the order most of the note's other lists
/// keep, else newest first, as 113 of the 152 ordered lists in the real notes do.
fn usual_order(events: Option<&Value>, name: &str, zone: Tz) -> Order {
    let starts_at = |item: &Value| note_events::instant_of(item.get("start"), zone);
    let (mut ascending, mut descending) = (0, 0);
    for (key, event) in events.and_then(Value::as_mapping).into_iter().flatten() {
        let list = drawn_list(Some(event)).and_then(|drawn| event.get(drawn)?.as_sequence());
        let Some(list) = list.filter(|list| list.len() > 1 && key.as_str() != Some(name)) else {
            continue;
        };
        match order_of(list, starts_at) {
            Order::Ascending => ascending += 1,
            Order::Descending => descending += 1,
            Order::None => {},
        }
    }
    if ascending > descending { Order::Ascending } else { Order::Descending }
}

/// Where an occurrence starting at `at` goes in `list`: where its date puts it in the list's
/// order, or at the end of a list that keeps none.
fn place_for(list: &[Value], at: i64, order: Order, starts_at: impl Fn(&Value) -> Option<i64>) -> usize {
    let mut starts = list.iter().map(starts_at);
    let next = match order {
        Order::Ascending => starts.position(|start| start.is_some_and(|start| start > at)),
        Order::Descending => starts.position(|start| start.is_some_and(|start| start < at)),
        Order::None => None,
    };
    next.unwrap_or(list.len())
}

/// Refuses a category `.mory/calendars.yaml` does not configure.
///
/// The web app would draw the event without it and report it as unknown, so an unconfigured id is
/// a typo or an invention either way. A nested id must be configured itself, as the web app
/// requires: were its parent enough, a misspelt child would never be reported.
fn check_category(id: &str, configured: &[String]) -> Result<(), String> {
    if configured.iter().any(|configured| configured == id) {
        return Ok(());
    }
    if configured.is_empty() {
        return Err(format!(
            "No event categories are configured, so {id:?} would be reported as unknown. They \
             are defined under `categories:` in `.mory/calendars.yaml`, which the web app's \
             settings edit.",
        ));
    }
    Err(format!(
        "{id:?} is not a configured event category. Use one of: {}.",
        configured.join(", "),
    ))
}

/// Whether the note already declares an event by this name.
fn has_event(text: &str, name: &str) -> bool {
    event_in(text, name).is_some()
}

fn event_in(text: &str, name: &str) -> Option<Value> {
    frontmatter::value(text).and_then(|root| root.get("events")?.as_mapping()?.get(name).cloned())
}

/// What is wrong with an event's shape, in the terms `frontend/src/metadata-schema.json` sets
/// with its `anyOf` and `dependencies`: something to draw, and a rule under what adjusts it.
///
/// Stricter than the schema in one place: an empty list of instances satisfies it, but draws
/// nothing, so it does not count as an occurrence here, and nor does a list the calendar does not
/// draw.
fn shape_faults(event: Option<&Value>) -> Vec<&'static str> {
    let Some(event) = event else {
        return Vec::new();
    };
    // An event whose last key went is `null` rather than an empty mapping, and has as little.
    let empty = Mapping::new();
    let event = event.as_mapping().unwrap_or(&empty);
    let has = |key: &str| event.get(key).is_some_and(|value| !value.is_null());
    let wrapped = Value::Mapping(event.clone());
    let listed = drawn_list(Some(&wrapped)).is_some_and(|key| {
        event.get(key).and_then(Value::as_sequence).is_some_and(|list| !list.is_empty())
    });
    let mut faults = Vec::new();
    if !has("start") && !listed {
        faults.push(
            "It would have nothing to draw: no `start` and no listed occurrence. Use \
             remove_event to remove an event.",
        );
    }
    if has("repeat") && !has("start") {
        faults.push("A `repeat` rule recurs from the event's `start`, so it needs one.");
    }
    if has("exclusions") && !has("repeat") {
        faults.push("`exclusions` take occurrences out of a `repeat` rule, so they need one.");
    }
    if has("overrides") && !has("repeat") {
        faults.push("`overrides` change occurrences of a `repeat` rule, so they need one.");
    }
    faults
}

/// Refuses an edit that leaves the event in a shape the schema forbids.
///
/// Only a fault the edit brings is refused. A note already in such a shape was written by hand
/// or by an older app, and refusing every later edit to it would leave a model only update_note,
/// which checks nothing.
fn check_shape(text: &str, edited: &str, name: &str) -> Result<(), String> {
    let before = shape_faults(event_in(text, name).as_ref());
    let after = shape_faults(event_in(edited, name).as_ref());
    let brought: Vec<_> = after.into_iter().filter(|fault| !before.contains(fault)).collect();
    if brought.is_empty() {
        return Ok(());
    }
    Err(format!("{name:?} was not changed. {}", brought.join(" ")))
}

pub async fn add_event(state: &AppState, args: EventArgs) -> Result<CallToolResult, ErrorData> {
    let path = match safe_path(&args.path) {
        Ok(path) => path,
        Err(message) => return Ok(tool_error(message)),
    };
    let Some((text, expected)) = note_to_edit(state, &path).await? else {
        return Ok(tool_error(format!("No note at {path:?}.")));
    };
    if has_event(&text, &args.name) {
        return Ok(tool_error(format!(
            "{:?} already declares an event named {:?}. Use update_event to change it.",
            path, args.name,
        )));
    }
    // An event with no time is not an event; a rule alone has nothing to recur from.
    if args.start.is_none() && args.add_instances.as_ref().is_none_or(Vec::is_empty) {
        return Ok(tool_error(
            "A new event needs a `start`, or occurrences in `add_instances`: a bare date for a \
             whole day, or a datetime carrying its offset.",
        ));
    }
    apply_event(state, &path, &text, &expected, &args).await
}

pub async fn update_event(state: &AppState, args: EventArgs) -> Result<CallToolResult, ErrorData> {
    let path = match safe_path(&args.path) {
        Ok(path) => path,
        Err(message) => return Ok(tool_error(message)),
    };
    let Some((text, expected)) = note_to_edit(state, &path).await? else {
        return Ok(tool_error(format!("No note at {path:?}.")));
    };
    if !has_event(&text, &args.name) {
        return Ok(tool_error(format!(
            "{:?} declares no event named {:?}. Use list_events to see what it has, or add_event \
             to make one.",
            path, args.name,
        )));
    }
    apply_event(state, &path, &text, &expected, &args).await
}

async fn apply_event(
    state: &AppState,
    path: &str,
    text: &str,
    expected: &str,
    args: &EventArgs,
) -> Result<CallToolResult, ErrorData> {
    if let Some(category) = &args.category {
        let config = match crate::v2::read_calendar_config(state).await {
            Ok(config) => config,
            Err(e) => {
                return Ok(tool_error(format!(
                    "Could not read `.mory/calendars.yaml` to check the category: {e:#}",
                )));
            }
        };
        if let Err(message) = check_category(category, &config.category_ids()) {
            return Ok(tool_error(message));
        }
    }
    match edited_event(text, path, args, crate::urgency::local_zone()) {
        Ok(edited) => write_note(state, path, &edited, &args.message, expected).await,
        Err(reason) => Ok(tool_error(reason)),
    }
}

/// The note `text` becomes under `args`, or why it cannot. All of an event edit but the checks
/// that need the repository.
fn edited_event(text: &str, path: &str, args: &EventArgs, zone: Tz) -> Result<String, String> {
    let mut changes = event_changes(args)?;
    let events = frontmatter::value(text).and_then(|root| root.get("events").cloned());
    let usual = usual_order(events.as_ref(), &args.name, zone);
    changes.extend(instance_changes(args, event_in(text, &args.name).as_ref(), usual, zone)?);
    if changes.is_empty() {
        return Err(
            "Nothing to change. Pass a field to set, an occurrence to add or remove, or a key to \
             `clear`."
                .to_owned(),
        );
    }
    let edited = edited_note(text, &changes, path)?;
    check_shape(text, &edited, &args.name)?;
    Ok(edited)
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RemoveEventArgs {
    /// The note's exact repository path.
    pub path: String,
    /// The event's name, as it is keyed in the note's `events:` map.
    pub name: String,
    /// The commit message.
    pub message: String,
}

pub async fn remove_event(
    state: &AppState,
    args: RemoveEventArgs,
) -> Result<CallToolResult, ErrorData> {
    let path = match safe_path(&args.path) {
        Ok(path) => path,
        Err(message) => return Ok(tool_error(message)),
    };
    let Some((text, expected)) = note_to_edit(state, &path).await? else {
        return Ok(tool_error(format!("No note at {path:?}.")));
    };
    if !has_event(&text, &args.name) {
        return Ok(tool_error(format!(
            "{:?} declares no event named {:?}.",
            path, args.name,
        )));
    }

    let edited = match frontmatter::apply(&text, &[Change::remove(&["events", &args.name])]) {
        Ok(edited) => edited,
        Err(e) => return Ok(tool_error(e.to_string())),
    };
    write_note(state, &path, &edited, &args.message, &expected).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repeat(freq: &str, byday: &[&str]) -> Repeat {
        Repeat {
            freq: freq.to_owned(),
            interval: None,
            byday: (!byday.is_empty())
                .then(|| byday.iter().map(|d| (*d).to_owned()).collect()),
            bymonthday: None,
            bymonth: None,
            wkst: None,
            tz: None,
            until: None,
            count: None,
        }
    }

    /// iCal's two-letter weekdays are the thing a model reaches for, and they are wrong here.
    #[test]
    fn a_two_letter_weekday_is_refused_with_the_three_letter_spelling() {
        let error = repeat("weekly", &["WE"]).to_value().expect_err("WE is iCal's");
        assert!(error.contains("three letters"), "{error}");
        assert!(error.contains("wed"), "{error}");

        assert!(repeat("weekly", &["wed"]).to_value().is_ok());
        assert!(repeat("weekly", &["WED"]).to_value().is_ok(), "case is forgiven");
    }

    /// Three bytes from the end of `月1` is inside `月`, where a plain split panics.
    #[test]
    fn a_weekday_in_another_script_is_refused_rather_than_split() {
        for day in ["月1", "水曜日", "1水"] {
            let error = repeat("monthly", &[day]).to_value().expect_err("not a weekday");
            assert!(error.contains("three letters"), "{day}: {error}");
        }
    }

    /// What separates "the third Wednesday of each month" from "every three weeks on Wednesday".
    #[test]
    fn an_ordinal_weekday_needs_a_period_to_pick_within() {
        assert!(repeat("monthly", &["3wed"]).to_value().is_ok());
        assert!(repeat("yearly", &["-1fri"]).to_value().is_ok());

        let error = repeat("weekly", &["3wed"]).to_value().expect_err("weekly has no period");
        assert!(error.contains("monthly"), "{error}");
        assert!(error.contains("interval: 3"), "{error}");
    }

    /// An offset here is silently wrong: it works until the series crosses a DST boundary.
    #[test]
    fn a_timezone_must_be_a_zone_name_and_never_an_offset() {
        assert!(check_timezone("Asia/Tokyo").is_ok());
        assert!(check_timezone("Europe/London").is_ok());
        assert!(check_timezone("UTC").is_ok());

        for offset in ["+09:00", "-08:00", "Z", "+0900"] {
            let error = check_timezone(offset).expect_err("{offset} is an offset");
            assert!(error.contains("IANA"), "{offset}: {error}");
        }
        assert!(check_timezone("Middle/Earth").is_err());
    }

    #[test]
    fn a_rule_has_until_or_count_but_never_both() {
        let mut rule = repeat("daily", &[]);
        rule.until = Some("2026-12-31".to_owned());
        assert!(rule.to_value().is_ok());
        rule.count = Some(10);
        assert!(rule.to_value().is_err());
        rule.until = None;
        assert!(rule.to_value().is_ok());
    }

    #[test]
    fn the_out_of_range_parts_of_a_rule_are_refused() {
        let mut rule = repeat("monthly", &[]);
        rule.bymonthday = Some(vec![0]);
        assert!(rule.to_value().is_err());
        rule.bymonthday = Some(vec![32]);
        assert!(rule.to_value().is_err());
        rule.bymonthday = Some(vec![-1, 15]);
        assert!(rule.to_value().is_ok());

        let mut rule = repeat("yearly", &[]);
        rule.bymonth = Some(vec![13]);
        assert!(rule.to_value().is_err());
        rule.bymonth = Some(vec![1, 12]);
        assert!(rule.to_value().is_ok());

        assert!(repeat("fortnightly", &[]).to_value().is_err());
    }

    /// The rule's keys come out in the order the schema lists them, which is the order they are
    /// written by hand.
    #[test]
    fn a_rule_is_written_in_the_order_it_is_read() {
        let mut rule = repeat("weekly", &["mon", "wed"]);
        rule.interval = Some(2);
        rule.tz = Some("Asia/Tokyo".to_owned());
        let Value::Mapping(mapping) = rule.to_value().expect("valid") else {
            panic!("a rule is a mapping");
        };
        let keys = mapping
            .keys()
            .filter_map(|key| key.as_str())
            .collect::<Vec<_>>();
        assert_eq!(keys, ["freq", "interval", "byday", "tz"]);
    }

    #[test]
    fn a_category_must_be_configured_and_names_the_ones_that_are() {
        let configured = ["meeting", "meeting/1on1", "trip"].map(String::from);
        assert!(check_category("meeting", &configured).is_ok());
        assert!(check_category("meeting/1on1", &configured).is_ok());

        let error = check_category("meetnig", &configured).expect_err("a typo");
        assert!(error.contains("meeting, meeting/1on1, trip"), "{error}");
        // Its parent being configured is not enough, as in the web app.
        assert!(check_category("meeting/1no1", &configured).is_err());

        let error = check_category("meeting", &[]).expect_err("none configured");
        assert!(error.contains(".mory/calendars.yaml"), "{error}");
    }

    fn alarms_args(alarms: serde_json::Value) -> EventArgs {
        serde_json::from_value(serde_json::json!({
            "path": "a.md",
            "name": "Standup",
            "message": "m",
            "alarms": alarms,
        }))
        .expect("valid arguments")
    }

    #[test]
    fn alarms_are_written_as_given_and_an_empty_list_silences() {
        let note = "---\nevents:\n    Standup:\n        start: 2026-09-23 09:00:00+09:00\n---\n";
        let edited = frontmatter::apply(
            note,
            &event_changes(&alarms_args(serde_json::json!(["-10m", "-1d 18:00", "09:00", "+1 hour"])))
                .expect("valid changes"),
        )
        .expect("an edit");
        let parsed = frontmatter::value(&edited).expect("valid YAML");
        let written: Vec<&str> = parsed["events"]["Standup"]["alarms"]
            .as_sequence()
            .unwrap()
            .iter()
            .map(|alarm| alarm.as_str().unwrap())
            .collect();
        assert_eq!(written, ["-10m", "-1d 18:00", "09:00", "+1 hour"]);

        let silenced = frontmatter::apply(
            note,
            &event_changes(&alarms_args(serde_json::json!([]))).expect("valid changes"),
        )
        .expect("an edit");
        assert!(silenced.contains("alarms: []"), "{silenced}");
    }

    /// An entry the scheduler and the web app would both drop rings nothing, so it is refused
    /// with the grammar rather than written.
    #[test]
    fn an_alarm_that_is_not_one_is_refused_with_the_grammar() {
        for bad in ["10m", "soon", "-10 mins", "-1d 25:00", "-2y"] {
            let error = event_changes(&alarms_args(serde_json::json!(["-5m", bad]))).expect_err(bad);
            assert!(error.contains(&format!("{bad:?}")), "{bad}: {error}");
            assert!(error.contains("`-10m`"), "{error}");
        }
        let error = event_changes(&alarms_args(serde_json::json!(["10m"]))).expect_err("unsigned");
        assert!(error.contains("needs a sign"), "{error}");
    }

    #[test]
    fn alarms_can_be_cleared_like_any_other_key() {
        let args: EventArgs = serde_json::from_value(serde_json::json!({
            "path": "a.md", "name": "Standup", "message": "m", "clear": ["alarms"],
        }))
        .expect("valid arguments");
        let edited = frontmatter::apply(
            "---\nevents:\n    Standup:\n        start: 2026-09-23\n        alarms: [-10m]\n---\n",
            &event_changes(&args).expect("valid changes"),
        )
        .expect("an edit");
        assert!(!edited.contains("alarms"), "{edited}");
    }

    #[test]
    fn a_category_is_written_and_cleared_like_any_other_key() {
        let args: EventArgs = serde_json::from_value(serde_json::json!({
            "path": "a.md",
            "name": "Weekly sync",
            "message": "m",
            "category": "meeting",
        }))
        .expect("valid arguments");
        let edited = frontmatter::apply(
            "---\nevents:\n    Weekly sync:\n        start: 2026-09-23\n---\n",
            &event_changes(&args).expect("valid changes"),
        )
        .expect("an edit");
        assert!(edited.contains("category: meeting"), "{edited}");

        let args: EventArgs = serde_json::from_value(serde_json::json!({
            "path": "a.md",
            "name": "Weekly sync",
            "message": "m",
            "clear": ["category"],
        }))
        .expect("valid arguments");
        assert!(event_changes(&args).is_ok());
    }

    fn event(fields: serde_json::Value) -> EventArgs {
        let mut args = serde_json::json!({ "path": "a.md", "name": "Standup", "message": "m" });
        args.as_object_mut().unwrap().extend(fields.as_object().unwrap().clone());
        serde_json::from_value(args).expect("valid arguments")
    }

    /// A datetime with no offset would be drawn at an hour that moves with whoever reads it, so
    /// it is refused with both spellings that are right.
    #[test]
    fn a_moment_is_a_bare_date_or_a_datetime_carrying_its_offset() {
        for start in ["2026-03-12", "2026-03-12 19:00:00+09:00", "2026-03-12 19:00+09:00", "2026-03-12T10:00:00Z"] {
            assert!(event_changes(&event(serde_json::json!({ "start": start }))).is_ok(), "{start}");
        }
        for start in ["2026-03-12 19:00", "2026-03-12 19:00:00", "2026-02-30", "tomorrow", "19:00"] {
            let error = event_changes(&event(serde_json::json!({ "start": start })))
                .expect_err("not a moment as the notes spell one");
            assert!(error.contains("+09:00"), "{start}: {error}");
        }

        let rule = |until: &str| serde_json::json!({ "repeat": { "freq": "weekly", "until": until } });
        assert!(event_changes(&event(rule("2026-12-31"))).is_ok());
        assert!(event_changes(&event(rule("2026-12-31 23:59"))).is_err());

        let exclusions = |at: &str| serde_json::json!({ "exclusions": ["2026-03-19 19:00:00+09:00", at] });
        assert!(event_changes(&event(exclusions("2026-03-26"))).is_ok());
        assert!(event_changes(&event(exclusions("2026-03-26 19:00"))).is_err());
    }

    /// `end` takes the three spellings `normalizeEndTime` reads, as well as a moment.
    #[test]
    fn an_end_is_a_moment_a_time_of_day_or_a_duration() {
        for end in [
            "2026-03-12 20:30:00+09:00", "2026-03-14", "20:30", "9:05", "20:30:15",
            "+90m", "+1.5h", "+2 days", "+1 Week", "+1M",
        ] {
            assert!(event_changes(&event(serde_json::json!({ "end": end }))).is_ok(), "{end}");
        }
        for end in ["2026-03-12 20:30", "24:00", "90m", "+1 fortnight", "later"] {
            let error = event_changes(&event(serde_json::json!({ "end": end })))
                .expect_err("not an end");
            assert!(error.contains("duration"), "{end}: {error}");
        }
    }

    /// The web app drops each of these with its occurrence, refuses the rule, or draws the end
    /// as "Invalid Date", which the calendar throws on, so none is written.
    #[test]
    fn a_value_the_calendar_cannot_read_is_refused() {
        for end in ["+.h", "+..m", "+.d", "+99999999999999999999y", "+1001y", "+90m ", " 18:30", "+١h"] {
            assert!(check_end(end).is_err(), "{end:?}");
        }
        for end in ["+1.h", "+.5h", "+1000y", "+500 years", "+90 Minutes"] {
            assert!(check_end(end).is_ok(), "{end:?}");
        }
        for start in [" 2026-09-24", "2026-09-24 "] {
            assert!(event_changes(&event(serde_json::json!({ "start": start }))).is_err(), "{start:?}");
        }
        for day in ["+1wed", "0wed", "-0fri", "-wed"] {
            assert!(repeat("monthly", &[day]).to_value().is_err(), "{day}");
        }
        assert!(repeat("monthly", &["01wed"]).to_value().is_ok(), "as toWeekday reads it");
        let mut rule = repeat("daily", &[]);
        rule.interval = Some(65_536);
        assert!(rule.to_value().is_err());
        rule.interval = Some(65_535);
        assert!(rule.to_value().is_ok());
    }

    fn edit_and_check(note: &str, fields: serde_json::Value) -> Result<String, String> {
        edited_event(note, "a.md", &event(fields), chrono_tz::Asia::Tokyo)
    }

    /// Clearing what an event occurs at leaves nothing to draw, and clearing a rule strands what
    /// adjusts it. Both are what the schema forbids, so neither is written.
    #[test]
    fn an_edit_that_breaks_the_event_shape_is_refused() {
        let lone = "---\nevents:\n    Standup:\n        start: 2026-09-23\n---\n";
        let error = edit_and_check(lone, serde_json::json!({ "clear": ["start"] }))
            .expect_err("nothing left to draw");
        assert!(error.contains("remove_event"), "{error}");

        let listed = "---\nevents:\n    Standup:\n        start: 2026-09-23\n        times:\n            - start: 2026-09-30\n---\n";
        assert!(edit_and_check(listed, serde_json::json!({ "clear": ["start"] })).is_ok());

        let ruled = "---\nevents:\n    Standup:\n        start: 2026-09-23\n        repeat:\n            freq: weekly\n        exclusions:\n            - 2026-09-30\n---\n";
        let error = edit_and_check(ruled, serde_json::json!({ "clear": ["repeat"] }))
            .expect_err("exclusions without a rule");
        assert!(error.contains("`exclusions`"), "{error}");
        let error = edit_and_check(ruled, serde_json::json!({ "clear": ["start"] }))
            .expect_err("a rule without a start");
        assert!(error.contains("`repeat`"), "{error}");
        assert!(edit_and_check(ruled, serde_json::json!({ "clear": ["repeat", "exclusions"] })).is_ok());
    }

    /// An argument the tools do not know would be dropped, and the rest committed as if it had
    /// been written.
    #[test]
    fn an_argument_the_tools_do_not_know_is_refused() {
        let base = serde_json::json!({ "path": "a.md", "name": "Standup", "message": "m" });
        for (key, value) in [
            ("instances", serde_json::json!([{ "start": "2026-09-30" }])),
            ("tz", serde_json::json!("Asia/Tokyo")),
            ("add_instances", serde_json::json!([{ "start": "2026-09-30", "category": "meeting" }])),
            ("repeat", serde_json::json!({ "freq": "weekly", "byweekday": ["wed"] })),
        ] {
            let mut args = base.clone();
            args.as_object_mut().unwrap().insert(key.into(), value);
            let error = serde_json::from_value::<EventArgs>(args).expect_err(key).to_string();
            assert!(error.contains("unknown field"), "{key}: {error}");
        }
        let mut args = base;
        args.as_object_mut().unwrap().insert("recursive".into(), true.into());
        assert!(serde_json::from_value::<RemoveEventArgs>(args).is_err());
    }

    /// Shaped as real notes keep a series: newest first, under the older `times`, its starts
    /// written without an offset.
    const LISTED: &str = "---\nevents:\n    Standup:\n        times:\n            - start: 2025-09-09 10:00\n              end: 11:30\n            - { start: 2024-09-30 13:00, end: +1h }\n---\n";

    fn starts(note: &str) -> Vec<String> {
        let event = event_in(note, "Standup").expect("the event");
        ["instances", "times"]
            .into_iter()
            .flat_map(|key| {
                let list = event.get(key).and_then(Value::as_sequence).cloned().unwrap_or_default();
                list.into_iter().map(move |item| format!("{key} {}", item["start"].as_str().unwrap()))
            })
            .collect()
    }

    /// An occurrence joins the list the event keeps, where its date puts it in whichever order
    /// the list is in.
    #[test]
    fn an_occurrence_joins_the_list_in_its_order() {
        let newer = edit_and_check(LISTED, serde_json::json!({
            "add_instances": [{ "start": "2026-01-15 10:00:00+09:00", "end": "+1h" }],
        }))
        .expect("an addition");
        assert_eq!(starts(&newer), ["times 2026-01-15 10:00:00+09:00", "times 2025-09-09 10:00", "times 2024-09-30 13:00"]);
        assert!(newer.contains("            - { start: 2024-09-30 13:00, end: +1h }\n"), "{newer}");

        let between = edit_and_check(LISTED, serde_json::json!({ "add_instances": [{ "start": "2025-01-10" }] }))
            .expect("an addition");
        assert_eq!(starts(&between), ["times 2025-09-09 10:00", "times 2025-01-10", "times 2024-09-30 13:00"]);

        let oldest_first = "---\nevents:\n    Standup:\n        instances:\n            - start: 2026-01-08\n            - start: 2026-01-15\n---\n";
        let both = edit_and_check(oldest_first, serde_json::json!({
            "add_instances": [{ "start": "2026-01-22" }, { "start": "2026-01-01" }],
        }))
        .expect("two additions");
        assert_eq!(
            starts(&both),
            ["instances 2026-01-01", "instances 2026-01-08", "instances 2026-01-15", "instances 2026-01-22"],
        );
    }

    /// An event without a list is given one under the current spelling, entry keys in the
    /// schema's order and every value checked as the event's own would be.
    #[test]
    fn an_occurrence_is_written_and_checked_like_the_event() {
        let lone = "---\nevents:\n    Standup:\n        start: 2026-09-23\n---\n";
        let after = edit_and_check(lone, serde_json::json!({
            "add_instances": [{ "start": "2026-09-30 09:00:00+09:00", "location": "Room 4", "end": "+30m", "alarms": ["-10m"] }],
        }))
        .expect("a first occurrence");
        assert!(
            after.ends_with("        instances:\n            - start: 2026-09-30 09:00:00+09:00\n              end: +30m\n              location: Room 4\n              alarms:\n                  - -10m\n---\n"),
            "{after}",
        );

        for (bad, says) in [
            (serde_json::json!({ "start": "2026-09-30 09:00" }), "+09:00"),
            (serde_json::json!({ "start": "2026-09-30", "end": "later" }), "duration"),
            (serde_json::json!({ "start": "2026-09-30", "alarms": ["10m"] }), "needs a sign"),
        ] {
            let error = edit_and_check(lone, serde_json::json!({ "add_instances": [bad] })).expect_err("refused");
            assert!(error.contains(says), "{error}");
        }
    }

    /// The note's own spelling and the moment with its offset name the same occurrence, and
    /// taking one out while adding another is a move, in one commit.
    #[test]
    fn an_occurrence_is_removed_by_its_moment() {
        for spelling in ["2024-09-30 13:00", "2024-09-30 13:00:00+09:00", "2024-09-30T04:00:00Z"] {
            let after = edit_and_check(LISTED, serde_json::json!({ "remove_instances": [spelling] }))
                .expect("a removal");
            assert_eq!(after, LISTED.replace("            - { start: 2024-09-30 13:00, end: +1h }\n", ""), "{spelling}");
        }

        let moved = edit_and_check(LISTED, serde_json::json!({
            "remove_instances": ["2025-09-09 10:00"],
            "add_instances": [{ "start": "2025-09-10 10:00:00+09:00", "end": "11:30" }],
        }))
        .expect("a move");
        assert_eq!(starts(&moved), ["times 2025-09-10 10:00:00+09:00", "times 2024-09-30 13:00"]);
    }

    #[test]
    fn a_list_edit_that_cannot_be_made_says_why() {
        let error = edit_and_check(LISTED, serde_json::json!({ "remove_instances": ["2025-09-10 10:00"] }))
            .expect_err("not listed");
        assert!(error.contains("2025-09-09 10:00, 2024-09-30 13:00"), "{error}");

        let error = edit_and_check(LISTED, serde_json::json!({ "add_instances": [{ "start": "2025-09-09 10:00:00+09:00" }] }))
            .expect_err("listed already");
        assert!(error.contains("remove_instances"), "{error}");

        let error = edit_and_check(LISTED, serde_json::json!({
            "clear": ["times"], "add_instances": [{ "start": "2026-01-15" }],
        }))
        .expect_err("both at once");
        assert!(error.contains("not both"), "{error}");

        // Taking every occurrence from an event that has nothing else leaves it nothing to draw.
        let error = edit_and_check(LISTED, serde_json::json!({
            "remove_instances": ["2025-09-09 10:00", "2024-09-30 13:00"],
        }))
        .expect_err("nothing left");
        assert!(error.contains("remove_event"), "{error}");
    }

    /// The calendar draws `instances` when an event has both lists, so that is the list edited,
    /// and the one that has to keep an occurrence.
    #[test]
    fn the_list_edited_is_the_one_the_calendar_draws() {
        let both = "---\nevents:\n    Standup:\n        instances:\n            - start: 2026-01-08\n        times:\n            - start: 2025-01-08\n---\n";
        let error = edit_and_check(both, serde_json::json!({ "remove_instances": ["2026-01-08"] }))
            .expect_err("times is not drawn");
        assert!(error.contains("remove_event"), "{error}");
        let error = edit_and_check(both, serde_json::json!({ "remove_instances": ["2025-01-08"] }))
            .expect_err("not in the drawn list");
        assert!(error.contains("Those it lists start at: 2026-01-08."), "{error}");
        let added = edit_and_check(both, serde_json::json!({ "add_instances": [{ "start": "2025-01-08" }] }))
            .expect("not a duplicate of what is not drawn");
        assert_eq!(starts(&added), ["instances 2026-01-08", "instances 2025-01-08", "times 2025-01-08"]);

        // An empty `instances` hides `times`, so it is the one added to.
        let hidden = both.replace("        instances:\n            - start: 2026-01-08\n", "        instances: []\n");
        let added = edit_and_check(&hidden, serde_json::json!({ "add_instances": [{ "start": "2026-01-15" }] }))
            .expect("an addition");
        assert_eq!(starts(&added), ["instances 2026-01-15", "times 2025-01-08"]);
        // Clearing the list the calendar does not draw is no conflict.
        assert!(edit_and_check(both, serde_json::json!({ "clear": ["times"], "add_instances": [{ "start": "2026-01-15" }] })).is_ok());
    }

    /// A whole day and midnight on it are the same instant, and two occurrences on the calendar.
    #[test]
    fn a_whole_day_is_not_midnight() {
        let mixed = "---\nevents:\n    Standup:\n        instances:\n            - start: 2024-05-01\n            - start: 2024-05-01 00:00:00+09:00\n              location: Room 4\n            - start: 2024-05-08\n---\n";
        let removed = edit_and_check(mixed, serde_json::json!({ "remove_instances": ["2024-05-01"] })).expect("a removal");
        assert_eq!(starts(&removed), ["instances 2024-05-01 00:00:00+09:00", "instances 2024-05-08"]);
        let removed = edit_and_check(mixed, serde_json::json!({ "remove_instances": ["2024-04-30T15:00:00Z"] })).expect("a removal");
        assert_eq!(starts(&removed), ["instances 2024-05-01", "instances 2024-05-08"]);
        let lone = "---\nevents:\n    Standup:\n        instances:\n            - start: 2024-05-01\n---\n";
        let added = edit_and_check(lone, serde_json::json!({ "add_instances": [{ "start": "2024-05-01 00:00:00+09:00" }] }))
            .expect("not a duplicate");
        assert_eq!(starts(&added), ["instances 2024-05-01", "instances 2024-05-01 00:00:00+09:00"]);
    }

    /// A list of one shows no order, so it takes the note's, or the notes'.
    #[test]
    fn a_list_too_short_to_show_an_order_takes_the_notes() {
        let one = "    Retro:\n        times:\n            - start: 2026-01-08\n";
        let add = serde_json::json!({ "add_instances": [{ "start": "2026-01-15" }, { "start": "2026-01-01" }] });
        let alone = format!("---\nevents:\n{one}---\n");
        let newest_first = edited_event(&alone, "a.md", &EventArgs { name: "Retro".into(), ..event(add.clone()) }, chrono_tz::Asia::Tokyo)
            .expect("additions");
        assert!(newest_first.contains("- start: 2026-01-15\n            - start: 2026-01-08\n            - start: 2026-01-01\n"), "{newest_first}");

        let beside = format!("---\nevents:\n    Standup:\n        times:\n            - start: 2025-01-01\n            - start: 2025-01-08\n{one}---\n");
        let oldest_first = edited_event(&beside, "a.md", &EventArgs { name: "Retro".into(), ..event(add) }, chrono_tz::Asia::Tokyo)
            .expect("additions");
        assert!(oldest_first.contains("- start: 2026-01-01\n            - start: 2026-01-08\n            - start: 2026-01-15\n"), "{oldest_first}");
    }

    #[test]
    fn an_occurrence_to_remove_is_named_by_its_whole_date() {
        let listed = "---\nevents:\n    Standup:\n        instances:\n            - start: 2024-05-01\n            - start: 2024-05-08\n---\n";
        for vague in ["2024-05", "20240501", "2024-5-1", "2024/05/01", " 2024-05-01", "2024-05-01x"] {
            let error = edit_and_check(listed, serde_json::json!({ "remove_instances": [vague] })).expect_err(vague);
            assert!(error.contains("is not a moment"), "{vague}: {error}");
        }
        assert!(edit_and_check(listed, serde_json::json!({ "remove_instances": ["2024-05-01"] })).is_ok());
    }

    /// The calendar draws an event's own `start` beside the occurrences it lists.
    #[test]
    fn an_occurrence_at_the_events_own_start_is_refused() {
        let lone = "---\nevents:\n    Standup:\n        start: 2026-09-23 09:00\n---\n";
        let error = edit_and_check(lone, serde_json::json!({ "add_instances": [{ "start": "2026-09-23 09:00:00+09:00" }] }))
            .expect_err("drawn twice");
        assert!(error.contains("drawn twice"), "{error}");
        // Moving the event's own occurrence into its list is no duplicate.
        let moved = edit_and_check(lone, serde_json::json!({
            "start": "2026-09-16 09:00:00+09:00", "add_instances": [{ "start": "2026-09-23 09:00:00+09:00" }],
        }))
        .expect("a move");
        assert_eq!(starts(&moved), ["instances 2026-09-23 09:00:00+09:00"]);
        assert!(edit_and_check(lone, serde_json::json!({ "add_instances": [{ "start": "2026-09-23" }] })).is_ok());
    }

    /// A note already out of shape is not the edit's doing, and refusing every later edit to it
    /// would leave only update_note.
    #[test]
    fn a_fault_the_note_already_had_does_not_block_an_edit() {
        let stranded = "---\nevents:\n    Standup:\n        start: 2026-09-23\n        exclusions:\n            - 2026-09-30\n---\n";
        let edited = edit_and_check(stranded, serde_json::json!({ "location": "Room 4" }))
            .expect("the stray exclusions were there before");
        assert!(edited.contains("location: Room 4"), "{edited}");
    }
}
