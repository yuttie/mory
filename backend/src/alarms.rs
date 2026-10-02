//! When each alarm rings.
//!
//! `note_events` says when an occurrence starts; this says when, relative to that, a note wants to
//! be told. An `alarms:` list is written in the note, beside the event or the occurrence it
//! belongs to, so it stays readable and editable with nothing but a text editor.
//!
//! An alarm is one of two spellings, each a string:
//!
//!   * an offset from the start, `[+-]N unit`: `-10m`, `+1h`, `-2 days`, `0m`. The units are
//!     `w d h m s` and `weeks days hours minutes seconds`. The sign is required unless N is 0, so
//!     that a bare `10m` is reported rather than read as "ten minutes after".
//!   * a time on the start's day, `[[+-]N d|w ]HH:MM`: `09:00`, `-1d 18:00`.
//!
//! `d` and `w` count calendar days in the reader's zone, so a 09:00 event with `-1d` rings at 09:00
//! the day before across a daylight-saving change, and take whole numbers. `h m s` count elapsed
//! time and may be decimal. An all-day event starts at the first moment of its day.
//!
//! Where a note says nothing, `.mory/calendars.yaml` may: for a category of event, and then for all
//! timed or all all-day ones. See `Defaults`.
//!
//! A task's `due_by` and `deadline` ring too, though they are not events: the calendar draws them as
//! events, and `taskDatesFromEntries` decides which notes and which values count. See `task_dates`.
//!
//! `frontend/src/alarms.ts` is this grammar's twin, and `fixtures/calendar/notes/alarms.md` holds
//! the two to each other: both spell each alarm they accept the same way (see `Spec`'s `Display`).
//! `Defaults` has a twin too, in `resolveCategory` and `eventsFromEntries`, which the same fixtures
//! hold to it. Change either one and run both halves of that comparison.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::LazyLock;

use chrono::{DateTime, Duration, NaiveTime, Utc};
use regex::Regex;
use serde_yaml::{Mapping, Value};

use crate::models::ListEntry;
use crate::note_events::{Occurrence, Reader, Start, key_name, present, task_date_start};
use crate::tasks::{date_texts, is_over, task_of, task_status_of, TaskField};

/// The furthest from its start an alarm may be set. Anything further is a typo or worse: the
/// scheduler widens what it expands by the furthest alarm any note declares, and a note must not be
/// able to make that unbounded.
const MAX_DAYS: u64 = 366;
const MAX_SHIFT_SECONDS: f64 = MAX_DAYS as f64 * 86_400.0;

/// What an alarm is, for whoever wrote one that is not. The reason it was refused comes before it.
const GRAMMAR: &str = "An alarm is an offset from the start, such as `-10m` before it or `+1h` \
                       after, in w, d, h, m or s; or a time on the start's day, such as `09:00` or \
                       `-1d 18:00`.";

// `[0-9]` rather than `\d`, which is any Unicode digit in Rust and only ASCII in JavaScript.
static DAYS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^([+-]?)([0-9]+) *(weeks?|days?|w|d)$").expect("a valid pattern")
});

static ELAPSED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^([+-]?)([0-9]+(?:\.[0-9]+)?) *(hours?|minutes?|seconds?|h|m|s)$")
        .expect("a valid pattern")
});

static CLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:([+-]?)([0-9]+) *(weeks?|days?|w|d) +)?([0-9]{2}):([0-9]{2})$")
        .expect("a valid pattern")
});

/// When one alarm rings, relative to the start of the occurrence it is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Spec {
    /// Whole calendar days from the start, keeping its wall clock.
    Days(i64),
    /// Elapsed time from the start.
    Elapsed(Duration),
    /// A time of day on the start's date, moved by whole days.
    At { days: i64, time: NaiveTime },
}

impl Spec {
    /// The alarm at the start itself: what an event rings at when nothing says otherwise.
    pub const AT_START: Spec = Spec::Elapsed(Duration::zero());

    pub fn parse(text: &str) -> Result<Spec, String> {
        let text = text.trim();
        if let Some(parts) = DAYS.captures(text) {
            return Ok(Spec::Days(Self::whole_days(text, &parts[1], &parts[2], &parts[3])?));
        }
        if let Some(parts) = ELAPSED.captures(text) {
            let amount: f64 = parts[2].parse().map_err(|_| format!("{text:?} is not a number of units"))?;
            let per_unit = match parts[3].chars().next() {
                Some('h') => 3_600.0,
                Some('m') => 60.0,
                _ => 1.0,
            };
            let sign = Self::sign(text, &parts[1], amount == 0.0)?;
            if amount * per_unit > MAX_SHIFT_SECONDS {
                return Err(too_far(text));
            }
            return Ok(Spec::Elapsed(Duration::milliseconds(sign * (amount * per_unit * 1000.0).round() as i64)));
        }
        if let Some(parts) = CLOCK.captures(text) {
            let days = match parts.get(2) {
                None => 0,
                Some(count) => Self::whole_days(text, &parts[1], count.as_str(), &parts[3])?,
            };
            let time = parts[4]
                .parse()
                .ok()
                .zip(parts[5].parse().ok())
                .and_then(|(hour, minute)| NaiveTime::from_hms_opt(hour, minute, 0))
                .ok_or_else(|| format!("{text:?} is not a time of day"))?;
            return Ok(Spec::At { days, time });
        }
        // No examples: `check_list` follows this with `GRAMMAR`, which has them. The web app's
        // `parseAlarm` is read on its own, so its message carries them.
        Err(format!("{text:?} is in neither spelling"))
    }

    /// A signed count of whole days, as `-2 days` and `+1w` say it. Counted in integers, so that a
    /// count too large for one is too far like any other and not a number that is not one.
    fn whole_days(text: &str, written: &str, count: &str, unit: &str) -> Result<i64, String> {
        let per_unit = if unit.starts_with('w') { 7 } else { 1 };
        let days = count.parse::<u64>().ok().and_then(|count| count.checked_mul(per_unit));
        let sign = Self::sign(text, written, days == Some(0))?;
        match days {
            Some(days) if days <= MAX_DAYS => Ok(sign * days as i64),
            _ => Err(too_far(text)),
        }
    }

    /// `1` or `-1` for the sign written, which is required unless the amount is zero.
    fn sign(text: &str, written: &str, is_zero: bool) -> Result<i64, String> {
        match written {
            "-" => Ok(-1),
            "+" => Ok(1),
            _ if is_zero => Ok(1),
            _ => Err(format!("{text:?} needs a sign: -{text} is before the start, +{text} after it")),
        }
    }

    /// The instant it rings for an occurrence starting at `start`; `None` where the arithmetic
    /// leaves the calendar, which an alarm held to a year cannot, but nothing here may panic on.
    pub fn instant(&self, start: Start, reader: &Reader) -> Option<DateTime<Utc>> {
        match *self {
            Spec::Elapsed(by) => start.begins(reader).checked_add_signed(by),
            Spec::Days(days) => {
                let moved = start.wall().checked_add_signed(Duration::try_days(days)?)?;
                Some(Start::Time(moved).begins(reader))
            },
            Spec::At { days, time } => {
                let day = start.wall().date().checked_add_signed(Duration::try_days(days)?)?;
                Some(Start::Time(day.and_time(time)).begins(reader))
            },
        }
    }

    /// How far from its start it can ring: (lead, lag), neither negative.
    ///
    /// Whole days are counted a day more than they come to in the direction they point, which
    /// covers a daylight-saving change. A time of day can fall anywhere on the day it names, so it
    /// is counted to either end of that day.
    fn spread(&self) -> (Duration, Duration) {
        let days = |n: i64| Duration::days(n.max(0));
        match *self {
            Spec::Elapsed(by) => ((-by).max(Duration::zero()), by.max(Duration::zero())),
            Spec::Days(n) => (days(-n + i64::from(n < 0)), days(n + i64::from(n > 0))),
            Spec::At { days: n, .. } => (days(1 - n), days(1 + n)),
        }
    }
}

impl fmt::Display for Spec {
    /// The spelling both sides settle on, whatever the note wrote: `-1.5h` and `-90 minutes` are
    /// both `-90m`. Whole-second amounts take the largest of `h m s` that divides them, and the
    /// rest are milliseconds, which no note spells.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {
            Spec::Days(days) => write!(f, "{days:+}d"),
            Spec::Elapsed(by) => {
                let ms = by.num_milliseconds();
                match ms {
                    0 => write!(f, "+0m"),
                    _ if ms % 3_600_000 == 0 => write!(f, "{:+}h", ms / 3_600_000),
                    _ if ms % 60_000 == 0 => write!(f, "{:+}m", ms / 60_000),
                    _ if ms % 1000 == 0 => write!(f, "{:+}s", ms / 1000),
                    _ => write!(f, "{ms:+}ms"),
                }
            },
            Spec::At { days: 0, time } => write!(f, "{}", time.format("%H:%M")),
            Spec::At { days, time } => write!(f, "{days:+}d {}", time.format("%H:%M")),
        }
    }
}

fn too_far(text: &str) -> String {
    format!("{text:?} is more than a year from the start")
}

/// An `alarms:` list as a person or a model typed it, each entry checked against the grammar the
/// scheduler and the web app read it by, and trimmed as it will be written.
///
/// An entry that is not an alarm is dropped by both readers, so one written would silently ring
/// nothing; refusing it says why instead. They are written as given, not respelled: `-90 minutes`
/// is the author's own phrase.
pub fn check_list(alarms: &[String]) -> Result<Vec<String>, String> {
    alarms
        .iter()
        .map(|alarm| {
            Spec::parse(alarm).map_err(|reason| format!("Not an alarm: {reason}. {GRAMMAR}"))?;
            Ok(alarm.trim().to_owned())
        })
        .collect()
}

impl Spec {
    /// The alarms a note's `alarms:` value holds: a list, or a single string for a list of one, as
    /// `byday` is read. An entry that is not a valid alarm is dropped and the rest stand; the web app
    /// is what reports it. Anything else is no alarm at all, which is what `alarms: []` silences with.
    pub fn list_from(value: &Value) -> Vec<Spec> {
        let parse = |value: &Value| value.as_str().and_then(|text| Spec::parse(text).ok());
        match value {
            Value::Sequence(items) => items.iter().filter_map(parse).collect(),
            single => parse(single).into_iter().collect(),
        }
    }
}

/// What `.mory/calendars.yaml` says an occurrence rings at where its note says nothing.
///
/// A category of event can name alarms of its own, and nested ids inherit as they do for colour:
/// `meeting/1on1` takes them from `meeting` unless it sets its own. The id the event names must
/// itself be configured, as in `resolveCategory`, so that a misspelt `meeting/1no1` is not quietly
/// a meeting. Failing that, the `timed` or the `all_day` list the occurrence's shape asks for, and
/// failing that the built-in default.
///
/// Every value is `None` when the file does not set it. That is not the same as an empty list,
/// which silences.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Defaults {
    timed: Option<Vec<Spec>>,
    all_day: Option<Vec<Spec>>,
    /// For a task's due date, and for its deadline: none at all unless set, since a date a task
    /// merely has is not an appointment to be reminded of.
    due_by: Option<Vec<Spec>>,
    deadline: Option<Vec<Spec>>,
    /// Every configured category, with the alarms it sets itself if it does.
    categories: BTreeMap<String, Option<Vec<Spec>>>,
}

/// The categories a `categories:` block configures, each by its id and with the mapping that sets
/// its things, if it has one, in the file's order: `readCategories` in the frontend reads the same
/// rule. A category with nothing after its id is configured and sets nothing; one that is not a
/// mapping is not configured at all, and nor is one whose id is not a scalar. An id that is a
/// number or a flag is its text, as JSON has only string keys.
///
/// What counts as configured is decided here and only here, for the alarms a category sets and for
/// the tools that check an id against it, so a model is never told a category exists that the
/// calendar then reports as unknown.
pub(crate) fn configured_categories(
    block: Option<&Mapping>,
) -> impl Iterator<Item = (String, Option<&Mapping>)> {
    block.into_iter().flatten().filter_map(|(id, entry)| {
        let entry = match entry {
            Value::Null => None,
            Value::Mapping(entry) => Some(entry),
            _ => return None,
        };
        Some((key_name(id)?, entry))
    })
}

/// The two blocks of the calendar configuration that alarms are read from, each as declared. They
/// are both mappings, and named so that neither is put where the other goes.
#[derive(Debug, Clone, Copy, Default)]
pub struct Blocks<'a> {
    pub alarms: Option<&'a Mapping>,
    pub categories: Option<&'a Mapping>,
}

impl Defaults {
    /// The `alarms:` and `categories:` blocks of the calendar configuration. Hand-written, so
    /// whatever is not usable is not there, as `readCategories` reads them in the frontend: a
    /// category with nothing after its id is configured and sets nothing, and one that is not a
    /// mapping is not configured at all.
    pub fn read(Blocks { alarms, categories }: Blocks) -> Defaults {
        let set = |key: &str| alarms.and_then(|alarms| present(alarms.get(key))).map(Spec::list_from);
        let categories = configured_categories(categories)
            .map(|(id, entry)| (id, entry.and_then(|entry| present(entry.get("alarms"))).map(Spec::list_from)))
            .collect();
        Defaults {
            timed: set("timed"),
            all_day: set("all_day"),
            due_by: set("due_by"),
            deadline: set("deadline"),
            categories,
        }
    }

    /// The alarms an occurrence rings at.
    ///
    /// Its own list if it has one -- an override, an instance or the event itself -- else the
    /// event's, as `note_events` already resolved. Then its category's, then the configured list
    /// for its shape. Otherwise an alarm at the start of a timed occurrence, which is what every
    /// note had before alarms could be set, and none for an all-day one.
    pub fn specs_of(&self, occurrence: &Occurrence) -> Vec<Spec> {
        if let Some(declared) = &occurrence.alarms {
            return Spec::list_from(declared);
        }
        let in_category = occurrence.category.as_deref().and_then(|id| self.category_alarms(id));
        if let Some(specs) = in_category {
            return specs.to_vec();
        }
        match occurrence.start {
            Start::Time(_) => self.timed.clone().unwrap_or_else(|| vec![Spec::AT_START]),
            Start::Date(_) => self.all_day.clone().unwrap_or_default(),
        }
    }

    /// The alarms a task's date rings at: the task's own list for it if it has one, else the
    /// configured one, else none.
    pub fn task_specs_of(&self, date: &TaskDate) -> Vec<Spec> {
        if let Some(declared) = &date.alarms {
            return Spec::list_from(declared);
        }
        match date.field {
            TaskField::DueBy => self.due_by.clone().unwrap_or_default(),
            TaskField::Deadline => self.deadline.clone().unwrap_or_default(),
        }
    }

    /// What the category `id` sets, from the nearest of it and its ancestors that sets anything.
    /// `None` for an id that is not configured, whatever its ancestors say.
    fn category_alarms(&self, id: &str) -> Option<&[Spec]> {
        self.categories.get(id)?;
        lineage(id).into_iter().find_map(|ancestor| self.categories.get(ancestor)?.as_deref())
    }

    /// Every alarm it names for an event, for `Reach`. A task's dates are not expanded from a rule,
    /// so what rings for them needs no looking ahead.
    fn specs(&self) -> impl Iterator<Item = &Spec> {
        [&self.timed, &self.all_day]
            .into_iter()
            .chain(self.categories.values())
            .flatten()
            .flatten()
    }
}

/// A category id and its ancestors, nearest first: `a/b/c`, `a/b`, `a`. `categoryLineage` in the
/// frontend, which a leading slash does not make an ancestor of.
fn lineage(id: &str) -> Vec<&str> {
    let mut found = vec![id];
    let mut end = id.len();
    while let Some(slash) = id[..end].rfind('/') {
        if slash == 0 {
            break;
        }
        found.push(&id[..slash]);
        end = slash;
    }
    found
}

/// How far before and after an occurrence's start any alarm in the listing rings: the longest
/// lead, and the longest lag.
///
/// A rule is expanded over a window, and an alarm a week before its occurrence is only found if the
/// window reaches a week past where the alarm is wanted. Read once per listing rather than every
/// minute: it asks about every note.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Reach {
    /// How long before the start an alarm rings.
    pub lead: Duration,
    /// How long after the start an alarm rings.
    pub lag: Duration,
}

impl Reach {
    pub fn of(entries: &[ListEntry], defaults: &Defaults) -> Reach {
        let mut reach = Reach::default();
        for spec in defaults.specs() {
            reach.include(spec);
        }
        for entry in entries {
            if let Some(events) = entry.metadata.as_ref().and_then(|metadata| metadata.get("events")) {
                reach.scan(events);
            }
        }
        reach
    }

    pub fn include(&mut self, spec: &Spec) {
        let (lead, lag) = spec.spread();
        self.lead = self.lead.max(lead);
        self.lag = self.lag.max(lag);
    }

    /// Every `alarms:` anywhere in `value`. Looked for at any depth rather than at the places
    /// `note_events` reads one from, so that a place it learns to read cannot be missed here.
    fn scan(&mut self, value: &Value) {
        match value {
            Value::Mapping(map) => {
                for (key, value) in map {
                    if key.as_str() == Some("alarms") && !value.is_mapping() {
                        for spec in Spec::list_from(value) {
                            self.include(&spec);
                        }
                    }
                    else {
                        self.scan(value);
                    }
                }
            },
            Value::Sequence(items) => items.iter().for_each(|item| self.scan(item)),
            _ => {},
        }
    }
}

/// What a notification calls a task's date.
fn label(field: TaskField) -> &'static str {
    match field {
        TaskField::DueBy => "Due",
        TaskField::Deadline => "Deadline",
    }
}

/// One of a task's dates, as far as ringing for it goes.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskDate {
    pub path: String,
    /// `Due: …` or `Deadline: …`, after the task as the calendar names it.
    pub name: String,
    pub field: TaskField,
    pub start: Start,
    /// The task's own `alarms:` for this date, as written.
    pub alarms: Option<Value>,
}

/// Every due date and deadline in the listing that is still to come: those of tasks that are neither
/// done nor canceled, which the calendar draws struck through and nobody needs telling of.
///
/// Which notes count and which values do is `taskDatesFromEntries`' answer, which this follows: a
/// note in the task tree with a `task:` mapping, and a string that `dayjs` reads. Nothing is
/// expanded, since a task has at most one of each.
pub fn task_dates(entries: &[ListEntry], reader: &Reader) -> Vec<TaskDate> {
    let mut found = Vec::new();
    for entry in entries {
        let Some((path, task)) = task_of(entry) else {
            continue;
        };
        if is_over(task_status_of(entry.metadata.as_ref()).as_deref()) {
            continue;
        }
        // `entry.title ?? entry.path`
        let title = entry.title.as_deref().unwrap_or(&path);
        let own = task.get("alarms").and_then(Value::as_mapping);
        for (field, text) in date_texts(task) {
            let Some(start) = task_date_start(text, reader.zone) else {
                continue;
            };
            found.push(TaskDate {
                path: path.to_string(),
                name: format!("{}: {title}", label(field)),
                field,
                start,
                alarms: present(own.and_then(|own| own.get(field.key()))).cloned(),
            });
        }
    }
    found
}

/// The instants an occurrence rings at, each once however many of its specs name the same one.
pub fn instants_of(specs: &[Spec], start: Start, reader: &Reader) -> BTreeSet<DateTime<Utc>> {
    specs.iter().filter_map(|spec| spec.instant(start, reader)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::NaiveDate;
    use chrono_tz::Tz as Zone;

    const LOS_ANGELES: Zone = chrono_tz::America::Los_Angeles;

    fn reader() -> Reader {
        Reader { zone: LOS_ANGELES, now: "2024-01-15T00:00:00Z".parse().unwrap() }
    }

    /// The defaults a `.mory/calendars.yaml` gives, through the same reading the scheduler uses.
    fn defaults(yaml: &str) -> Defaults {
        crate::v2::parse_calendar_config(yaml).unwrap().alarm_defaults()
    }

    fn spec(text: &str) -> Spec {
        Spec::parse(text).unwrap_or_else(|e| panic!("{text}: {e}"))
    }

    /// The grammar's cases, which `frontend/src/alarms.spec.ts` and `metadata-schema.spec.ts` read
    /// as well, so that the readers cannot come to disagree unseen.
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Grammar {
        canonical: Vec<(String, String)>,
        refused: Vec<String>,
        too_far: Vec<String>,
        at_the_limit: Vec<String>,
    }

    fn grammar() -> Grammar {
        serde_json::from_str(include_str!("../../fixtures/calendar/alarm-grammar.json"))
            .expect("a readable fixture")
    }

    fn time(text: &str) -> Start {
        Start::Time(chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M").unwrap())
    }

    fn date(text: &str) -> Start {
        Start::Date(NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap())
    }

    fn rings(text: &str, start: Start) -> String {
        spec(text).instant(start, &reader()).unwrap().to_rfc3339()
    }

    #[test]
    fn an_alarm_is_spelt_one_way_whatever_it_was_written_as() {
        for (written, canonical) in grammar().canonical {
            assert_eq!(spec(&written).to_string(), canonical, "{written}");
        }
    }

    #[test]
    fn an_offset_without_a_sign_is_refused_and_not_read_as_after() {
        let refused = Spec::parse("10m").unwrap_err();
        assert!(refused.contains("needs a sign"), "{refused}");
        assert!(Spec::parse("1d 09:00").is_err());
        // Zero is neither before nor after.
        assert!(Spec::parse("0m").is_ok());
        assert!(Spec::parse("0d 09:00").is_ok());
    }

    #[test]
    fn a_list_is_checked_and_trimmed_but_not_respelled() {
        let list = |alarms: &[&str]| alarms.iter().map(|alarm| alarm.to_string()).collect::<Vec<_>>();
        assert_eq!(check_list(&list(&[" -90 minutes ", "09:00"])), Ok(list(&["-90 minutes", "09:00"])));
        assert_eq!(check_list(&[]), Ok(Vec::new()));

        // The reason the entry was refused, and once what an alarm is.
        let refused = check_list(&list(&["-10m", "soon"])).unwrap_err();
        assert!(refused.starts_with("Not an alarm: \"soon\" is in neither spelling."), "{refused}");
        assert_eq!(refused.matches("An alarm is").count(), 1, "{refused}");
        let refused = check_list(&list(&["10m"])).unwrap_err();
        assert!(refused.contains("needs a sign"), "{refused}");
    }

    #[test]
    fn what_is_not_an_alarm_is_refused() {
        let grammar = grammar();
        for text in grammar.refused.iter().chain(&grammar.too_far) {
            assert!(Spec::parse(text).is_err(), "{text:?} should be refused");
        }
        for text in &grammar.too_far {
            let refused = Spec::parse(text).unwrap_err();
            assert!(refused.contains("more than a year"), "{text:?}: {refused}");
        }
        // A year is as far as an alarm goes.
        for text in &grammar.at_the_limit {
            assert!(Spec::parse(text).is_ok(), "{text:?} should be accepted");
        }
    }

    #[test]
    fn a_time_of_day_is_on_the_start_day_moved_by_whole_days() {
        // 2024-05-06 is a Monday, 09:00 and 18:00 in Los Angeles being 16:00 and 01:00 UTC.
        let start = time("2024-05-06 14:30");
        assert_eq!(rings("09:00", start), "2024-05-06T16:00:00+00:00");
        assert_eq!(rings("-1d 18:00", start), "2024-05-06T01:00:00+00:00");
        assert_eq!(rings("-1d 18:00", date("2024-05-06")), "2024-05-06T01:00:00+00:00");
        assert_eq!(rings("+1d 09:00", date("2024-05-06")), "2024-05-07T16:00:00+00:00");
    }

    #[test]
    fn hours_minutes_and_seconds_are_elapsed_time_and_days_are_not() {
        // The clocks go forward in Los Angeles at 02:00 on 2024-03-10, so 09:00 that day is 16:00 UTC
        // and 09:00 the day before 17:00. A day before is still 09:00; 24 hours before is not.
        let start = time("2024-03-10 09:00");
        assert_eq!(rings("0m", start), "2024-03-10T16:00:00+00:00");
        assert_eq!(rings("-1d", start), "2024-03-09T17:00:00+00:00");
        assert_eq!(rings("-24h", start), "2024-03-09T16:00:00+00:00");
        assert_eq!(rings("-1w", start), "2024-03-03T17:00:00+00:00");
        // They go back at 02:00 on 2024-11-03, and 09:00 that day is 17:00 UTC.
        let start = time("2024-11-03 09:00");
        assert_eq!(rings("-1d", start), "2024-11-02T16:00:00+00:00");
        assert_eq!(rings("-24h", start), "2024-11-02T17:00:00+00:00");
        assert_eq!(rings("+90m", start), "2024-11-03T18:30:00+00:00");
    }

    #[test]
    fn an_all_day_event_starts_with_its_day() {
        let start = date("2024-05-06");
        assert_eq!(rings("0m", start), "2024-05-06T07:00:00+00:00");
        assert_eq!(rings("-6h", start), "2024-05-06T01:00:00+00:00");
        assert_eq!(rings("-1d", start), "2024-05-05T07:00:00+00:00");
    }

    #[test]
    fn a_time_in_a_gap_moves_forward() {
        // 02:30 on 2024-03-10 does not exist in Los Angeles, and is 03:30 as `resolve_local` says.
        assert_eq!(rings("02:30", date("2024-03-10")), "2024-03-10T10:30:00+00:00");
        assert_eq!(rings("-1d 02:30", date("2024-03-11")), "2024-03-10T10:30:00+00:00");
    }

    #[test]
    fn a_list_drops_what_is_not_an_alarm_and_a_string_is_a_list_of_one() {
        let list = |yaml: &str| -> Vec<String> {
            let value: Value = serde_yaml::from_str(yaml).unwrap();
            Spec::list_from(&value).iter().map(Spec::to_string).collect()
        };
        assert_eq!(list("[-10m, 09:00, -1d 18:00]"), ["-10m", "09:00", "-1d 18:00"]);
        assert_eq!(list("[-10m, 10m, 5, null, [-1h], bogus, -5m]"), ["-10m", "-5m"]);
        assert_eq!(list("-1d 18:00"), ["-1d 18:00"]);
        assert!(list("[]").is_empty());
        assert!(list("10m").is_empty());
        assert!(list("5").is_empty());
        assert!(list("{ at: -10m }").is_empty());
    }

    /// What each occurrence of `note` rings at under the configuration `config`, as
    /// `start  name  spec|spec` in order.
    fn resolved(config: &str, note: &str) -> Vec<String> {
        let defaults = defaults(config);
        let entry = ListEntry::note("note.md", note);
        let reader = reader();
        let (from, to) = crate::note_events::day_window(
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
            NaiveDate::from_ymd_opt(2024, 12, 31).unwrap(),
            &reader,
        );
        let mut lines: Vec<String> = crate::note_events::occurrences(&[entry], from, to, &reader)
            .iter()
            .map(|occurrence| {
                let specs: Vec<String> = defaults.specs_of(occurrence).iter().map(Spec::to_string).collect();
                format!("{}  {}  {}", occurrence.start, occurrence.name, if specs.is_empty() { "none".into() } else { specs.join("|") })
            })
            .collect();
        lines.sort();
        lines
    }

    const CONFIG: &str = "
alarms: { timed: [-5m], all_day: [-1d 18:00] }
categories:
    meeting: { color: red, alarms: [-10m] }
    meeting/1on1: { alarms: [-15m, 0m] }
    meeting/standup: { color: blue }
    meeting/quiet: { alarms: [] }
    unset:
    kin/child: { alarms: [-2h] }
    kin/child/grandchild:
    a/b/c: { alarms: [-1h] }
    a/b/c/d:
";

    #[test]
    fn each_step_of_the_precedence_wins_over_those_after_it() {
        let note = "
events:
    Own list: { start: '2024-05-06 09:00', category: meeting, alarms: [-1m] }
    Own list silences: { start: '2024-05-06 09:01', category: meeting, alarms: [] }
    Own list beats an event's: { start: '2024-05-06 09:02', alarms: [-1h], instances: [{ start: '2024-05-06 10:02', alarms: [-2m] }] }
    The event's list: { start: '2024-05-06 09:03', category: meeting/1on1, alarms: [-1h] }
    A category: { start: '2024-05-06 09:04', category: meeting }
    A nested category: { start: '2024-05-06 09:05', category: meeting/1on1 }
    A category that sets none: { start: '2024-05-06 09:06', category: meeting/standup }
    A category that silences: { start: '2024-05-06 09:07', category: meeting/quiet }
    A category with nothing: { start: '2024-05-06 09:08', category: unset }
    A category misspelt: { start: '2024-05-06 09:09', category: meeting/1no1 }
    A category not text: { start: '2024-05-06 09:10', category: 5 }
    A category not configured: { start: '2024-05-06 09:11', category: nowhere }
    A parent that is not configured: { start: '2024-05-06 09:12', category: kin }
    Through two ancestors: { start: '2024-05-06 09:13', category: kin/child/grandchild }
    Past an ancestor that is not configured: { start: '2024-05-06 09:14', category: a/b/c/d }
    A configured id without its parents: { start: '2024-05-06 09:15', category: a/b }
    No category: { start: '2024-05-06 09:16' }
    An all-day one: { start: '2024-05-06' }
    An all-day one in a category: { start: '2024-05-07', category: meeting }
    An all-day one with its own: { start: '2024-05-08', alarms: [09:00] }
";
        assert_eq!(resolved(CONFIG, note), [
            "2024-05-06  An all-day one  -1d 18:00",
            "2024-05-06 09:00  Own list  -1m",
            "2024-05-06 09:01  Own list silences  none",
            "2024-05-06 09:02  Own list beats an event's  -1h",
            "2024-05-06 09:03  The event's list  -1h",
            "2024-05-06 09:04  A category  -10m",
            "2024-05-06 09:05  A nested category  -15m|+0m",
            "2024-05-06 09:06  A category that sets none  -10m",
            "2024-05-06 09:07  A category that silences  none",
            "2024-05-06 09:08  A category with nothing  -5m",
            "2024-05-06 09:09  A category misspelt  -5m",
            "2024-05-06 09:10  A category not text  -5m",
            "2024-05-06 09:11  A category not configured  -5m",
            "2024-05-06 09:12  A parent that is not configured  -5m",
            "2024-05-06 09:13  Through two ancestors  -2h",
            "2024-05-06 09:14  Past an ancestor that is not configured  -1h",
            "2024-05-06 09:15  A configured id without its parents  -5m",
            "2024-05-06 09:16  No category  -5m",
            "2024-05-06 10:02  Own list beats an event's  -2m",
            "2024-05-07  An all-day one in a category  -10m",
            "2024-05-08  An all-day one with its own  09:00",
        ]);
    }

    #[test]
    fn a_category_belongs_to_the_whole_event_and_its_alarms_to_each_occurrence() {
        let note = "
events:
    Series:
        start: '2024-05-06 09:00'
        repeat: { freq: daily, count: 3 }
        category: meeting
        overrides:
            - { at: '2024-05-07 09:00', alarms: [-1h] }
            - { at: '2024-05-08 09:00', category: unset, location: Room 2 }
    Listed:
        category: meeting/1on1
        instances: [{ start: '2024-05-10 09:00' }, { start: '2024-05-11 09:00', category: unset }]
";
        assert_eq!(resolved(CONFIG, note), [
            "2024-05-06 09:00  Series  -10m",
            "2024-05-07 09:00  Series  -1h",
            "2024-05-08 09:00  Series  -10m",
            "2024-05-10 09:00  Listed  -15m|+0m",
            "2024-05-11 09:00  Listed  -15m|+0m",
        ]);
    }

    #[test]
    fn with_nothing_configured_a_timed_occurrence_rings_at_its_start_and_an_all_day_one_never() {
        let note = "events: { Timed: { start: '2024-05-06 09:00', category: meeting }, Day: { start: '2024-05-07' } }";
        let built_in = ["2024-05-06 09:00  Timed  +0m", "2024-05-07  Day  none"];
        assert_eq!(resolved("", note), built_in);
        assert_eq!(resolved("calendars: []", note), built_in);
        // A key left empty is not set, and falls through as an empty `category:` does.
        assert_eq!(resolved("alarms:\n    timed:\n    all_day:\n", note), built_in);
        // Silenced is not the same: an empty list is a setting.
        assert_eq!(resolved("alarms: { timed: [], all_day: [09:00] }", note), [
            "2024-05-06 09:00  Timed  none",
            "2024-05-07  Day  09:00",
        ]);
        // A single string is a list of one, and an entry that is not an alarm is dropped.
        assert_eq!(resolved("alarms: { timed: -1h, all_day: [bogus, -6h] }", note), [
            "2024-05-06 09:00  Timed  -1h",
            "2024-05-07  Day  -6h",
        ]);
    }

    #[test]
    fn a_configuration_that_is_not_usable_sets_nothing() {
        let note = "events: { Timed: { start: '2024-05-06 09:00', category: a }, Day: { start: '2024-05-07', category: b } }";
        let built_in = ["2024-05-06 09:00  Timed  +0m", "2024-05-07  Day  none"];
        // Blocks that are not mappings, and categories that are not either, set nothing and are not
        // configured.
        for config in [
            "alarms: 5\ncategories: [a, b]",
            "alarms: [timed]\ncategories: 5",
            "categories: { a: 5, b: [alarms] }",
        ] {
            assert_eq!(resolved(config, note), built_in, "{config}");
        }
        // A value that is there but holds no usable alarm is a setting all the same, an empty one,
        // as it is in a note: nothing is rung, and the web app is what says why.
        let silent = ["2024-05-06 09:00  Timed  none", "2024-05-07  Day  none"];
        assert_eq!(resolved("alarms: { timed: 5, all_day: { at: -1h } }", note), silent);
        assert_eq!(resolved("categories: { a: { alarms: [10m] }, b: { alarms: soon } }", note), silent);
    }

    const TASK: &str = ".tasks/6f1d3c2e-8a4b-4c57-9d1e-2b7a5f0e9c31.md";
    const OTHER_TASK: &str = ".tasks/0d9a7e54-1c3b-4f6a-8b2d-5e4c7a1f9b60.md";

    /// What each of the tasks' dates rings at under `config`, as `start  name  spec|spec`.
    fn task_lines(config: &str, tasks: &[(&str, Option<&str>, &str)]) -> Vec<String> {
        let defaults = defaults(config);
        let entries: Vec<ListEntry> = tasks
            .iter()
            .map(|(path, title, yaml)| ListEntry {
                title: title.map(str::to_owned),
                ..ListEntry::note(path, yaml)
            })
            .collect();
        let mut lines: Vec<String> = task_dates(&entries, &reader())
            .iter()
            .map(|date| {
                let specs: Vec<String> = defaults.task_specs_of(date).iter().map(Spec::to_string).collect();
                format!("{}  {}  {}", date.start, date.name, if specs.is_empty() { "none".into() } else { specs.join("|") })
            })
            .collect();
        lines.sort();
        lines
    }

    #[test]
    fn a_tasks_dates_ring_by_its_own_list_then_the_configuration_and_otherwise_not_at_all() {
        let dates = "task: { due_by: 2024-05-10, deadline: '2024-05-15 17:00:00+09:00' }";
        let own = "task: { due_by: '2024-05-11 10:00', deadline: 2024-05-16, alarms: { due_by: [-2h], deadline: [] } }";
        let tasks = [(TASK, Some("Write"), dates), (OTHER_TASK, Some("Read"), own)];
        // Nothing is configured, and a date a task merely has is not an appointment: only what a
        // task itself says rings. 17:00 in Tokyo is 01:00 in Los Angeles.
        assert_eq!(task_lines("", &tasks), [
            "2024-05-10  Due: Write  none",
            "2024-05-11 10:00  Due: Read  -2h",
            "2024-05-15 01:00  Deadline: Write  none",
            "2024-05-16  Deadline: Read  none",
        ]);
        let config = "alarms: { due_by: [09:00], deadline: [-1d 18:00, -2h], timed: [-5m] }";
        assert_eq!(task_lines(config, &tasks), [
            "2024-05-10  Due: Write  09:00",
            "2024-05-11 10:00  Due: Read  -2h",
            "2024-05-15 01:00  Deadline: Write  -1d 18:00|-2h",
            "2024-05-16  Deadline: Read  none",
        ]);
        // A task's list may be a string, and an empty `alarms:` for a date inherits.
        let loose = "task: { due_by: 2024-05-10, deadline: 2024-05-12, alarms: { due_by: -1d 18:00, deadline: } }";
        assert_eq!(task_lines(config, &[(TASK, None, loose)]), [
            "2024-05-10  Due: .tasks/6f1d3c2e-8a4b-4c57-9d1e-2b7a5f0e9c31.md  -1d 18:00",
            "2024-05-12  Deadline: .tasks/6f1d3c2e-8a4b-4c57-9d1e-2b7a5f0e9c31.md  -1d 18:00|-2h",
        ]);
    }

    #[test]
    fn only_the_dates_of_a_task_still_to_do_in_the_task_tree_ring() {
        let due = |status: &str| format!("task: {{ due_by: 2024-05-10, {status} }}");
        let tasks = [
            (TASK, Some("Open"), due("status: { kind: todo }")),
            (OTHER_TASK, Some("Done"), due("status: { kind: done }")),
            (".tasks/11111111-2222-4333-8444-555555555555.md", Some("Canceled"), due("status: { kind: canceled }")),
            // Not a status the views settle on.
            (".tasks/11111111-2222-4333-8444-555555555556.md", Some("Odd"), due("status: { kind: waiting }")),
            (".tasks/11111111-2222-4333-8444-555555555557.md", Some("Old"), due("status: done")),
            // A note elsewhere is not a task, whatever it holds, and nor is one in a directory that
            // is not a task's.
            ("notes/note.md", Some("Not a task"), due("x: 1")),
            (".tasks/directory/11111111-2222-4333-8444-555555555558.md", Some("Lost"), due("x: 1")),
            (".tasks/not-a-uuid.md", Some("Unnamed"), due("x: 1")),
        ];
        let tasks: Vec<(&str, Option<&str>, &str)> =
            tasks.iter().map(|(path, title, yaml)| (*path, *title, yaml.as_str())).collect();
        assert_eq!(task_lines("", &tasks), [
            "2024-05-10  Due: Odd  none",
            "2024-05-10  Due: Old  none",
            "2024-05-10  Due: Open  none",
        ]);
    }

    #[test]
    fn a_value_the_calendar_cannot_draw_as_a_date_does_not_ring() {
        let tasks = [(TASK, Some("T"), "
task:
    due_by: soon
    deadline: 2024-05-12 09:00
")];
        assert_eq!(task_lines("", &tasks), ["2024-05-12 09:00  Deadline: T  none"]);
        for value in ["5", "null", "[2024-05-10]", "{ at: 2024-05-10 }", "true"] {
            let yaml = format!("task: {{ due_by: {value}, deadline: {value} }}");
            assert!(task_lines("", &[(TASK, Some("T"), yaml.as_str())]).is_empty(), "{value}");
        }
        // Neither a mapping for `task:` nor for its `alarms:` is anything to ring by.
        assert!(task_lines("", &[(TASK, Some("T"), "task: 5")]).is_empty());
        assert!(task_lines("", &[(TASK, Some("T"), "task: [due_by]")]).is_empty());
        let config = "alarms: { due_by: [09:00] }";
        assert_eq!(task_lines(config, &[(TASK, Some("T"), "task: { due_by: 2024-05-10, alarms: [-1h] }")]), [
            "2024-05-10  Due: T  09:00",
        ]);
    }

    #[test]
    fn a_category_id_is_its_ancestors_nearest_first() {
        assert_eq!(lineage("a/b/c"), ["a/b/c", "a/b", "a"]);
        assert_eq!(lineage("a"), ["a"]);
        assert_eq!(lineage("/a"), ["/a"]);
        assert_eq!(lineage("a//b"), ["a//b", "a/", "a"]);
        assert_eq!(lineage(""), [""]);
    }

    #[test]
    fn the_reach_is_the_furthest_alarm_in_either_direction() {
        let entry = |yaml: &str| ListEntry::note("note.md", yaml);
        let none = Defaults::default();
        assert_eq!(Reach::of(&[entry("events: { A: { start: '2024-05-06 09:00' } }")], &none), Reach::default());
        let reach = Reach::of(&[
            entry("events: { A: { start: '2024-05-06 09:00', alarms: [-10m, +2h] } }"),
            entry("events: { B: { start: '2024-05-06', overrides: [{ at: x, alarms: -3h }], instances: [{ alarms: [-1w] }] } }"),
            entry("tags: [alarms]"),
        ], &none);
        // A week, and the day more that whole days are counted with.
        assert_eq!(reach.lead, Duration::days(8));
        assert_eq!(reach.lag, Duration::hours(2));
        // An event that happens to be called `alarms` is looked into, not mistaken for a list.
        let named = Reach::of(&[entry("events: { alarms: { start: '2024-05-06 09:00', alarms: -2h } }")], &none);
        assert_eq!(named.lead, Duration::hours(2));
        // A time of day on the day before can be anywhere in it, which is up to two days early.
        let at = Reach::of(&[entry("events: { A: { start: '2024-05-06', alarms: [-1d 18:00] } }")], &none);
        assert_eq!((at.lead, at.lag), (Duration::days(2), Duration::zero()));
        // What the configuration sets counts as well, before any note names it.
        let configured = defaults("alarms: { timed: [-1h], all_day: [+2h] }\ncategories: { a: { alarms: [-3d] } }");
        let reach = Reach::of(&[], &configured);
        assert_eq!((reach.lead, reach.lag), (Duration::days(4), Duration::hours(2)));
    }
}
