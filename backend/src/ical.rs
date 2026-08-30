//! Turning an iCalendar feed into the events mory draws, and into the note one converts to.
//!
//! Three things about real feeds shape this module, all of them observed in Google's own output
//! rather than inferred from RFC 5545:
//!
//!   * A **modified occurrence** of a series is its own `VEVENT`, sharing the series `UID` and
//!     carrying a `RECURRENCE-ID` naming the occurrence it replaces. In the public Rust releases
//!     calendar that is three of five `VEVENT`s, so it is the common case and not an edge one.
//!   * A **deleted** occurrence may arrive either as an `EXDATE` or as one of those overrides with
//!     `STATUS:CANCELLED`. Both mean "this date does not happen", so both become an exclusion.
//!   * `DTEND` is **exclusive**, and for an all-day event that means the day after the last one.
//!     mory's `end` is inclusive, so an all-day end is pulled back a day on the way in.
//!
//! Expansion is delegated to `rrule`, through `icalendar`'s `recurrence` feature, which already
//! assembles `DTSTART`/`RRULE`/`RDATE`/`EXDATE` into an `RRuleSet` and applies RFC 5545 §3.6.1 --
//! with no `RRULE`, `DTSTART` is itself the single occurrence.
//!
//! Known limits, each a silent wrong answer if forgotten:
//!
//!   * A second `RRULE` on one `VEVENT` cannot be seen. `icalendar`'s parser keeps repeated
//!     properties only for a fixed list, and `RRULE` is not on it, so the extra line is dropped
//!     before this module runs. Nothing here can detect or report it.
//!   * `VTIMEZONE` is ignored. A `TZID` is resolved against the IANA database, so a feed using a
//!     Windows zone name -- Outlook's `W. Europe Standard Time` -- fails to expand even though the
//!     feed defines the zone itself. Such a series is reported rather than silently dropped.

use std::collections::BTreeMap;

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Duration, FixedOffset, NaiveDate, Offset, TimeZone};
// `rrule` and its `Tz` reach us through `icalendar`'s `recurrence` feature, which re-exports them.
// Resolving a `TZID` goes through `CalendarDateTime::try_into_utc`, so the IANA database is never
// named directly and `chrono-tz` stays a transitive dependency rather than a declared one.
use icalendar::{
    Calendar, CalendarDateTime, Component, DatePerhapsTime, Event, EventLike, Frequency, NWeekday,
    RRuleSet, Tz, Weekday,
};
use serde::Serialize;

/// How many occurrences one series may contribute before the expansion is cut short.
///
/// `RRuleSet::all` needs a bound, and an open-ended daily rule read over a wide window would
/// otherwise be limited only by `rrule`'s own 100 000-iteration ceiling.
const MAX_OCCURRENCES: u16 = 1_000;

/// One occurrence, as the calendar draws it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ImportedEvent {
    pub calendar: String,
    pub uid: String,
    /// The occurrence's own start, always present.
    ///
    /// Not only for the overrides a feed marks with `RECURRENCE-ID`: a note converted from a
    /// single occurrence records this to say which occurrence it claims, and shadowing compares
    /// it. Emitting it only for feed overrides would leave every rule-generated occurrence
    /// unshadowable.
    pub recurrence_id: String,
    pub name: String,
    pub start: String,
    pub end: Option<String>,
    pub note: Option<String>,
    pub location: Option<String>,
    pub url: Option<String>,
}

/// A recurrence rule in mory's own dialect.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Repeat {
    pub freq: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval: Option<u16>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub byday: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub bymonthday: Vec<i8>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub bymonth: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wkst: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tz: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
}

/// A change to one occurrence a rule generates.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Override {
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
}

/// Everything conversion needs to write a note for a whole series.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SeriesDefinition {
    pub name: String,
    pub start: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<String>,
    /// `None` when the feed's rule cannot be said in the dialect, which is what makes conversion
    /// fall back to listing occurrences instead.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat: Option<Repeat>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub exclusions: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub overrides: Vec<Override>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// iCal properties mory has no key for. Written into the note's body, so conversion loses
    /// nothing a person can read.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub unmapped: BTreeMap<String, String>,
}

/// Everything one feed contributed over one window.
#[derive(Debug, Default)]
pub struct Expansion {
    pub events: Vec<ImportedEvent>,
    pub series: BTreeMap<String, SeriesDefinition>,
    /// Series that could not be expanded at all, named for reporting rather than dropped.
    pub warnings: Vec<String>,
    /// Whether any series hit `MAX_OCCURRENCES`.
    pub limited: bool,
}

pub fn parse_calendar(ics: &str) -> Result<Calendar> {
    ics.parse::<Calendar>()
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("failed to parse the calendar")
}

// --- datetime formatting -------------------------------------------------------------------

/// mory's datetime spelling: local time carrying its offset, with a space rather than a `T`.
///
/// Matches what the frontend writes for a task's `completed_at`, which is
/// `dayjs().format().replace('T', ' ')`.
fn format_datetime(value: DateTime<FixedOffset>) -> String {
    value.format("%Y-%m-%d %H:%M:%S%:z").to_string()
}

fn format_date(value: NaiveDate) -> String {
    value.format("%Y-%m-%d").to_string()
}

fn to_fixed_offset(value: DateTime<Tz>) -> DateTime<FixedOffset> {
    // The offset in force on this date in this zone, which is what mory records: an instant plus
    // the offset that applied when it happens, not the zone it was derived from.
    value.with_timezone(&value.offset().fix())
}

/// Whether this event is all-day, which is exactly whether its start is a DATE rather than a
/// DATE-TIME. There is no separate flag: the value's shape says it, in the feed and in the note.
fn is_all_day(event: &Event) -> bool {
    matches!(event.get_start(), Some(DatePerhapsTime::Date(_)))
}

fn date_of(value: &DatePerhapsTime) -> Option<NaiveDate> {
    match value {
        DatePerhapsTime::Date(date) => Some(*date),
        DatePerhapsTime::DateTime(CalendarDateTime::Utc(utc)) => Some(utc.date_naive()),
        DatePerhapsTime::DateTime(CalendarDateTime::Floating(naive)) => Some(naive.date()),
        DatePerhapsTime::DateTime(CalendarDateTime::WithTimezone { date_time, .. }) => {
            Some(date_time.date())
        }
    }
}

/// The end of one occurrence, in mory's spelling.
///
/// iCal's `DTEND` is exclusive. For a timed event that is simply the end instant; for an all-day
/// event it is the day *after* the last, which mory writes inclusively, so a day comes back off.
fn occurrence_end(event: &Event, start: DateTime<Tz>) -> Option<String> {
    let Some(end) = event.get_end() else {
        // RFC 5545 allows DURATION in place of DTEND, and it is the shape that maps most directly
        // onto mory's own `end: +1h`.
        let duration = parse_duration(event.property_value("DURATION")?)?;
        return Some(format_datetime(to_fixed_offset(start + duration)));
    };
    if is_all_day(event) {
        let last = date_of(&end)?.pred_opt()?;
        return Some(format_date(last));
    }
    let start_utc = start.with_timezone(&chrono::Utc);
    let end_utc = match &end {
        DatePerhapsTime::DateTime(date_time) => date_time.try_into_utc()?,
        DatePerhapsTime::Date(date) => chrono::Utc.from_utc_datetime(&date.and_hms_opt(0, 0, 0)?),
    };
    // Carried as a duration so every occurrence of a series gets its own end rather than the
    // first occurrence's literal one.
    let length = end_utc.signed_duration_since(start_utc);
    Some(format_datetime(to_fixed_offset(start + length)))
}

/// An RFC 5545 `DURATION`, which is ISO 8601 restricted to whole units and no months or years.
fn parse_duration(value: &str) -> Option<Duration> {
    let value = value.trim();
    let (sign, rest) = match value.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, value.strip_prefix('+').unwrap_or(value)),
    };
    let rest = rest.strip_prefix('P')?;
    let (date_part, time_part) = match rest.split_once('T') {
        Some((date, time)) => (date, Some(time)),
        None => (rest, None),
    };

    let mut seconds: i64 = 0;
    let mut number = String::new();
    for c in date_part.chars() {
        if c.is_ascii_digit() {
            number.push(c);
            continue;
        }
        let amount: i64 = number.parse().ok()?;
        number.clear();
        seconds += match c {
            'W' => amount * 7 * 24 * 3600,
            'D' => amount * 24 * 3600,
            _ => return None,
        };
    }
    if !number.is_empty() {
        return None;
    }
    if let Some(time_part) = time_part {
        for c in time_part.chars() {
            if c.is_ascii_digit() {
                number.push(c);
                continue;
            }
            let amount: i64 = number.parse().ok()?;
            number.clear();
            seconds += match c {
                'H' => amount * 3600,
                'M' => amount * 60,
                'S' => amount,
                _ => return None,
            };
        }
        if !number.is_empty() {
            return None;
        }
    }
    Some(Duration::seconds(sign * seconds))
}

/// A DATE or DATE-TIME property in mory's spelling: a bare date, or local time with its offset.
///
/// Rendered in the series' own zone rather than UTC, so an override reads the way the feed wrote
/// it and lines up with the occurrence it names.
fn format_date_perhaps_time(value: &DatePerhapsTime, tz: Tz) -> Option<String> {
    match value {
        DatePerhapsTime::Date(date) => Some(format_date(*date)),
        DatePerhapsTime::DateTime(date_time) => Some(format_datetime(to_fixed_offset(
            date_time.try_into_utc()?.with_timezone(&tz),
        ))),
    }
}

fn format_occurrence(event: &Event, occurrence: DateTime<Tz>) -> String {
    if is_all_day(event) {
        format_date(occurrence.date_naive())
    } else {
        format_datetime(to_fixed_offset(occurrence))
    }
}

// --- the rule, in mory's dialect -----------------------------------------------------------

fn weekday_name(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Sun => "sun",
        Weekday::Mon => "mon",
        Weekday::Tue => "tue",
        Weekday::Wed => "wed",
        Weekday::Thu => "thu",
        Weekday::Fri => "fri",
        Weekday::Sat => "sat",
    }
}

fn frequency_name(frequency: Frequency) -> Option<&'static str> {
    match frequency {
        Frequency::Daily => Some("daily"),
        Frequency::Weekly => Some("weekly"),
        Frequency::Monthly => Some("monthly"),
        Frequency::Yearly => Some("yearly"),
        // Sub-daily rules have no place in a calendar of notes, and the dialect cannot say them.
        Frequency::Hourly | Frequency::Minutely | Frequency::Secondly => None,
    }
}

/// The feed's rule as a `repeat:` block, or `None` when the dialect cannot express it.
///
/// `None` is a supported outcome, not a failure: conversion then writes the occurrences out
/// instead of the rule. Returning a rule that means something slightly different would be far
/// worse, which is why `wkst` is carried rather than assumed -- Google emits `WKST=SU` on nearly
/// every weekly rule with an interval, while `rrule` defaults to Monday.
pub fn to_repeat(set: &RRuleSet) -> Option<Repeat> {
    let rules = set.get_rrule();
    if rules.len() != 1 {
        return None;
    }
    let rule = &rules[0];

    // The parts the dialect has no word for. `by_hour`/`by_minute`/`by_second` are deliberately
    // not among them: rrule fills those in from DTSTART on every rule, so treating them as
    // author-specified would reject even `FREQ=WEEKLY;BYDAY=TH`.
    if !rule.get_by_set_pos().is_empty()
        || !rule.get_by_week_no().is_empty()
        || !rule.get_by_year_day().is_empty()
    {
        return None;
    }

    let mut byday = Vec::new();
    for weekday in rule.get_by_weekday() {
        match weekday {
            NWeekday::Every(day) => byday.push(weekday_name(*day).to_string()),
            NWeekday::Nth(n, day) => byday.push(format!("{n}{}", weekday_name(*day))),
        }
    }

    let interval = rule.get_interval();
    let dtstart = set.get_dt_start();

    Some(Repeat {
        freq: frequency_name(rule.get_freq())?.to_string(),
        interval: if interval == 1 { None } else { Some(interval) },
        byday,
        bymonthday: rule.get_by_month_day().to_vec(),
        bymonth: rule.get_by_month().to_vec(),
        wkst: Some(weekday_name(rule.get_week_start()).to_string()),
        tz: iana_name_of(dtstart),
        until: rule.get_until().map(|until| format_datetime(to_fixed_offset(*until))),
        count: rule.get_count(),
    })
}

/// The IANA zone a series is anchored in, when that is worth recording.
///
/// A zone maps a date to an offset -- America/Los_Angeles is -07:00 in June and -08:00 in January
/// -- so a rule whose occurrences cross a daylight-saving change cannot be expanded from an offset
/// alone. This is the one value in the format that is a name rather than an offset, and it is
/// omitted for UTC and for a floating local time, where there is nothing to say.
fn iana_name_of(dtstart: &DateTime<Tz>) -> Option<String> {
    match dtstart.timezone() {
        Tz::Tz(tz) => Some(tz.name().to_string()),
        Tz::Local(_) => None,
    }
}

// --- grouping and expansion ------------------------------------------------------------------

struct Series<'a> {
    base: Option<&'a Event>,
    overrides: Vec<&'a Event>,
}

fn is_cancelled(event: &Event) -> bool {
    event
        .property_value("STATUS")
        .is_some_and(|status| status.eq_ignore_ascii_case("CANCELLED"))
}

fn unmapped_properties(event: &Event) -> BTreeMap<String, String> {
    // Everything mory has no key for, so conversion can spill it into the note's body rather than
    // discard it. The mapped ones are omitted; the noise ones carry nothing a reader wants.
    const MAPPED: [&str; 12] = [
        "UID", "SUMMARY", "DESCRIPTION", "LOCATION", "URL", "DTSTART", "DTEND", "RRULE",
        "EXDATE", "RDATE", "RECURRENCE-ID", "DURATION",
    ];
    const NOISE: [&str; 6] = ["DTSTAMP", "SEQUENCE", "CREATED", "LAST-MODIFIED", "STATUS", "CLASS"];

    let mut unmapped = BTreeMap::new();
    for (key, property) in event.properties() {
        if MAPPED.contains(&key.as_str()) || NOISE.contains(&key.as_str()) {
            continue;
        }
        unmapped.insert(key.to_lowercase(), property.value().to_string());
    }
    for (key, properties) in event.multi_properties() {
        if MAPPED.contains(&key.as_str()) {
            continue;
        }
        let joined = properties
            .iter()
            .map(|p| p.value().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        unmapped.insert(key.to_lowercase(), joined);
    }
    unmapped
}

/// Every occurrence in `[from, to]`, plus what conversion would need to write each series down.
pub fn expand(
    calendar: &Calendar,
    calendar_id: &str,
    from: DateTime<FixedOffset>,
    to: DateTime<FixedOffset>,
) -> Expansion {
    let mut grouped: BTreeMap<String, Series<'_>> = BTreeMap::new();

    for event in calendar.calendar_events() {
        let uid = match event.get_uid() {
            Some(uid) => uid.to_string(),
            None => continue,
        };
        let slot = grouped.entry(uid).or_insert(Series { base: None, overrides: Vec::new() });
        if event.get_recurrence_id().is_some() {
            slot.overrides.push(event.event());
        } else {
            slot.base = Some(event.event());
        }
    }
    let mut expansion = Expansion::default();
    for (uid, series) in grouped {
        let base = match series.base {
            Some(base) => base,
            // Overrides with no base: the series itself is outside whatever the feed published,
            // so each override stands alone as its own occurrence.
            None => {
                for event in &series.overrides {
                    if is_cancelled(event) {
                        continue;
                    }
                    if let Some(occurrence) = standalone(event, calendar_id, &uid, from, to) {
                        expansion.events.push(occurrence);
                    }
                }
                continue;
            }
        };

        if let Err(warning) = expand_series(
            base, &series.overrides, calendar, calendar_id, &uid, from, to, &mut expansion,
        ) {
            expansion.warnings.push(warning);
        }
    }
    expansion
}

/// A value that identifies one occurrence, for matching an override against what a rule generated.
///
/// An instant for a timed occurrence and a date for an all-day one, so two spellings of the same
/// moment -- which the feed and the rule expansion routinely differ in -- still meet.
fn recurrence_key(value: &DatePerhapsTime) -> Option<String> {
    match value {
        DatePerhapsTime::Date(date) => Some(format_date(*date)),
        DatePerhapsTime::DateTime(date_time) => {
            Some(date_time.try_into_utc()?.timestamp().to_string())
        }
    }
}

fn occurrence_key(event: &Event, occurrence: DateTime<Tz>) -> String {
    if is_all_day(event) {
        format_date(occurrence.date_naive())
    } else {
        occurrence.timestamp().to_string()
    }
}

fn standalone(
    event: &Event,
    calendar_id: &str,
    uid: &str,
    from: DateTime<FixedOffset>,
    to: DateTime<FixedOffset>,
) -> Option<ImportedEvent> {
    let start = event.get_start()?;
    let date = date_of(&start)?;
    if date < from.date_naive() || date > to.date_naive() {
        return None;
    }
    let at = match &start {
        DatePerhapsTime::Date(day) => format_date(*day),
        _ => format_date(date),
    };
    Some(ImportedEvent {
        calendar: calendar_id.to_string(),
        uid: uid.to_string(),
        recurrence_id: at.clone(),
        name: event.get_summary().unwrap_or("(untitled)").to_string(),
        start: at,
        end: None,
        note: event.get_description().map(str::to_string),
        location: event.get_location().map(str::to_string),
        url: event.get_url().map(str::to_string),
    })
}

#[allow(clippy::too_many_arguments)]
fn expand_series(
    base: &Event,
    overrides: &[&Event],
    calendar: &Calendar,
    calendar_id: &str,
    uid: &str,
    from: DateTime<FixedOffset>,
    to: DateTime<FixedOffset>,
    into: &mut Expansion,
) -> Result<(), String> {
    let calendar_event = calendar
        .calendar_events()
        .find(|candidate| candidate.get_uid() == Some(uid)
            && candidate.get_recurrence_id().is_none())
        .ok_or_else(|| format!("{uid}: the series vanished between grouping and expansion"))?;

    // Through `CalendarEvent` rather than the bare event, so an all-day DTSTART is anchored to the
    // feed's own X-WR-TIMEZONE instead of to whatever zone this server happens to run in.
    let set = calendar_event
        .get_recurrence()
        .map_err(|e| format!("{uid}: {e}"))?;

    let result = set
        .clone()
        .after(from.with_timezone(&Tz::UTC))
        .before(to.with_timezone(&Tz::UTC))
        .all(MAX_OCCURRENCES);
    if result.limited {
        into.limited = true;
    }

    // A cancelled override is a deletion, exactly like an EXDATE, and both must reach the note as
    // an exclusion -- Google uses whichever it likes.
    let mut replacements: BTreeMap<String, &Event> = BTreeMap::new();
    let mut cancelled: Vec<String> = Vec::new();
    let mut exclusions: Vec<String> = Vec::new();
    for event in overrides {
        let Some(recurrence_id) = event.get_recurrence_id() else { continue };
        let Some(key) = recurrence_key(&recurrence_id) else { continue };
        if is_cancelled(event) {
            cancelled.push(key.clone());
            if let Some(spelling) = date_of(&recurrence_id) {
                exclusions.push(match recurrence_id {
                    DatePerhapsTime::Date(day) => format_date(day),
                    _ => format_date(spelling),
                });
            }
            continue;
        }
        replacements.insert(key, event);
    }

    let mut occurrences_in_window = 0_usize;
    for occurrence in &result.dates {
        let key = occurrence_key(base, *occurrence);
        if cancelled.contains(&key) {
            continue;
        }
        let at = format_occurrence(base, *occurrence);
        let source = replacements.get(&key).copied().unwrap_or(base);

        let (start, end) = match replacements.get(&key) {
            // A replaced occurrence carries its own times, which may differ from the one it
            // replaces -- that is usually why it exists.
            Some(replacement) => {
                let start = replacement
                    .get_start()
                    .and_then(|value| date_of(&value).map(|d| (value, d)));
                match start {
                    Some((value, day)) => (
                        match value {
                            DatePerhapsTime::Date(_) => format_date(day),
                            _ => format_occurrence(replacement, *occurrence),
                        },
                        occurrence_end(replacement, *occurrence),
                    ),
                    None => (at.clone(), occurrence_end(base, *occurrence)),
                }
            }
            None => (at.clone(), occurrence_end(base, *occurrence)),
        };

        occurrences_in_window += 1;
        into.events.push(ImportedEvent {
            calendar: calendar_id.to_string(),
            uid: uid.to_string(),
            recurrence_id: at,
            name: source.get_summary().unwrap_or("(untitled)").to_string(),
            start,
            end,
            note: source.get_description().map(str::to_string),
            location: source.get_location().map(str::to_string),
            url: source.get_url().map(str::to_string),
        });
    }

    // EXDATEs the feed declared, alongside the cancelled overrides collected above.
    let dtstart_tz = set.get_dt_start().timezone();
    if let Some(exdates) = base.multi_properties().get("EXDATE") {
        for property in exdates {
            if let Some(value) = DatePerhapsTime::from_property(property) {
                if let Some(day) = date_of(&value) {
                    exclusions.push(match &value {
                        DatePerhapsTime::Date(_) => format_date(day),
                        // Written in the series' own zone rather than UTC. The frontend matches
                        // exclusions by instant either way, so this is for whoever reads the note.
                        DatePerhapsTime::DateTime(date_time) => match date_time.try_into_utc() {
                            Some(utc) => format_datetime(to_fixed_offset(
                                utc.with_timezone(&dtstart_tz),
                            )),
                            None => format_date(day),
                        },
                    });
                }
            }
        }
    }

    // Every override the feed declared, not only those the window happens to cover. Converting a
    // series has to describe the whole series: building this from the windowed loop silently
    // dropped the renamed occurrences either side of the month being looked at, so a converted
    // series lost the very titles that made those occurrences worth keeping.
    let mut collected_overrides: Vec<Override> = Vec::new();
    for event in overrides {
        if is_cancelled(event) {
            continue;
        }
        let Some(recurrence_id) = event.get_recurrence_id() else { continue };
        let Some(at) = format_date_perhaps_time(&recurrence_id, dtstart_tz) else { continue };
        let start = event.get_start().and_then(|value| format_date_perhaps_time(&value, dtstart_tz));
        collected_overrides.push(Override {
            at: at.clone(),
            name: event.get_summary().map(str::to_string),
            start: match &start {
                Some(start) if *start != at => Some(start.clone()),
                _ => None,
            },
            end: event
                .get_end()
                .and_then(|value| format_date_perhaps_time(&value, dtstart_tz))
                .or_else(|| event.property_value("DURATION").map(str::to_string)),
            note: event.get_description().map(str::to_string),
            location: event.get_location().map(str::to_string),
        });
    }
    collected_overrides.sort_by(|a, b| a.at.cmp(&b.at));

    // Only for a series that actually showed up: `series` exists so the popup can convert what the
    // user is looking at, and a feed of hundreds of one-off events would otherwise describe every
    // one of them on every request, whatever window was asked for.
    if occurrences_in_window == 0 {
        return Ok(());
    }

    let dtstart = set.get_dt_start();
    into.series.insert(
        uid.to_string(),
        SeriesDefinition {
            name: base.get_summary().unwrap_or("(untitled)").to_string(),
            start: format_occurrence(base, *dtstart),
            end: occurrence_end(base, *dtstart),
            repeat: to_repeat(&set),
            exclusions,
            overrides: collected_overrides,
            note: base.get_description().map(str::to_string),
            location: base.get_location().map(str::to_string),
            url: base.get_url().map(str::to_string),
            unmapped: unmapped_properties(base),
        },
    );
    Ok(())
}

/// Parse the `start`/`end` a request asks for: a bare date, read as the whole day, in UTC.
pub fn parse_window(from: &str, to: &str) -> Result<(DateTime<FixedOffset>, DateTime<FixedOffset>)> {
    let start = NaiveDate::parse_from_str(from, "%Y-%m-%d").context("invalid start")?;
    let end = NaiveDate::parse_from_str(to, "%Y-%m-%d").context("invalid end")?;
    if end < start {
        bail!("the window ends before it starts");
    }
    let utc = FixedOffset::east_opt(0).unwrap();
    Ok((
        utc.from_utc_datetime(&start.and_hms_opt(0, 0, 0).unwrap()),
        utc.from_utc_datetime(&(end + Duration::days(1)).and_hms_opt(0, 0, 0).unwrap()),
    ))
}
