//! The event tools. An event is an entry in a note's `events:` map, keyed by its name, so these
//! are frontmatter edits like the task tools.
//!
//! Three details are what a model gets wrong unaided, so each is checked rather than trusted:
//! weekdays are three letters and may carry an ordinal, `repeat.tz` is an IANA zone name and
//! never an offset, and a datetime carries its offset while a date is bare.

use rmcp::{model::CallToolResult, ErrorData};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_yaml::{Mapping, Value};

use super::frontmatter::{self, Change};
use super::tools::{note_text, safe_path, write_note};
use super::tool_error;
use crate::models::AppState;

/// Three letters, not iCal's two, optionally after an ordinal: `3wed` is the third Wednesday,
/// `-1fri` the last Friday. This is what separates "the third Wednesday of each month" from
/// "every three weeks on Wednesday".
const WEEKDAYS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FREQUENCIES: [&str; 4] = ["daily", "weekly", "monthly", "yearly"];

#[derive(Debug, Deserialize, JsonSchema)]
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
        if self.interval.is_some_and(|interval| interval < 1) {
            return Err("`interval` must be at least 1.".to_owned());
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
    let (ordinal, name) = lowered.split_at(lowered.len().saturating_sub(3));
    if !WEEKDAYS.contains(&name) {
        return Err(format!(
            "{day:?} is not a weekday. These are three letters, not iCal's two: {}. An ordinal \
             may come first, as in `3wed` or `-1fri`.",
            WEEKDAYS.join(", "),
        ));
    }
    if !ordinal.is_empty() {
        if ordinal.parse::<i32>().is_err() {
            return Err(format!("{day:?} has an ordinal that is not a number."));
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
pub struct EventArgs {
    /// The note's exact repository path.
    pub path: String,
    /// The event's name, which is its key in the note's `events:` map.
    pub name: String,
    /// The commit message.
    pub message: String,

    /// When it starts. A bare date for a whole day (`2026-03-12`), or a datetime carrying its
    /// offset (`2026-03-12 19:00:00+09:00`). The shape is what makes it an all-day event.
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
    /// A recurrence rule.
    #[serde(default)]
    pub repeat: Option<Repeat>,
    /// Occurrences the rule generates that should not happen. Matched by instant, not by
    /// spelling: `2026-01-30 10:00:00+09:00` and the same moment written another way are the
    /// same occurrence.
    #[serde(default)]
    pub exclusions: Option<Vec<String>>,
    /// Keys to remove from the event entirely.
    #[serde(default)]
    pub clear: Option<Vec<String>>,
}

const EVENT_KEYS: [&str; 9] = [
    "start", "end", "finished", "color", "note", "location", "url", "repeat", "exclusions",
];

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
        set("start", start.as_str().into());
    }
    if let Some(end) = &args.end {
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
    ] {
        if let Some(value) = value {
            set(key, value.as_str().into());
        }
    }
    if let Some(repeat) = &args.repeat {
        set("repeat", repeat.to_value()?);
    }
    if let Some(exclusions) = &args.exclusions {
        set(
            "exclusions",
            Value::Sequence(exclusions.iter().map(|at| Value::String(at.clone())).collect()),
        );
    }
    Ok(changes)
}

/// Whether the note already declares an event by this name.
fn has_event(text: &str, name: &str) -> bool {
    let block = frontmatter::Note::parse(text).block;
    serde_yaml::from_str::<Value>(&block)
        .ok()
        .and_then(|root| root.get("events")?.as_mapping()?.get(name).cloned())
        .is_some()
}

pub async fn add_event(state: &AppState, args: EventArgs) -> Result<CallToolResult, ErrorData> {
    let path = match safe_path(&args.path) {
        Ok(path) => path,
        Err(message) => return Ok(tool_error(message)),
    };
    let Some(text) = note_text(state, &path).await? else {
        return Ok(tool_error(format!("No note at {path:?}.")));
    };
    if has_event(&text, &args.name) {
        return Ok(tool_error(format!(
            "{:?} already declares an event named {:?}. Use update_event to change it.",
            path, args.name,
        )));
    }
    // An event with no time is not an event; a rule alone has nothing to recur from.
    if args.start.is_none() {
        return Ok(tool_error(
            "A new event needs a `start`: a bare date for a whole day, or a datetime carrying \
             its offset.",
        ));
    }
    apply_event(state, &path, &text, &args).await
}

pub async fn update_event(state: &AppState, args: EventArgs) -> Result<CallToolResult, ErrorData> {
    let path = match safe_path(&args.path) {
        Ok(path) => path,
        Err(message) => return Ok(tool_error(message)),
    };
    let Some(text) = note_text(state, &path).await? else {
        return Ok(tool_error(format!("No note at {path:?}.")));
    };
    if !has_event(&text, &args.name) {
        return Ok(tool_error(format!(
            "{:?} declares no event named {:?}. Use list_events to see what it has, or add_event \
             to make one.",
            path, args.name,
        )));
    }
    apply_event(state, &path, &text, &args).await
}

async fn apply_event(
    state: &AppState,
    path: &str,
    text: &str,
    args: &EventArgs,
) -> Result<CallToolResult, ErrorData> {
    let changes = match event_changes(args) {
        Ok(changes) => changes,
        Err(message) => return Ok(tool_error(message)),
    };
    if changes.is_empty() {
        return Ok(tool_error("Nothing to change. Pass a field to set, or name one in `clear`."));
    }
    let edited = match frontmatter::apply(text, &changes) {
        Ok(edited) => edited,
        Err(e) => return Ok(tool_error(e.to_string())),
    };
    if edited == text {
        return Ok(tool_error(format!(
            "{path:?} already says all of that, so nothing was committed.",
        )));
    }
    write_note(state, path, &edited, &args.message).await
}

#[derive(Debug, Deserialize, JsonSchema)]
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
    let Some(text) = note_text(state, &path).await? else {
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
    write_note(state, &path, &edited, &args.message).await
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
}
