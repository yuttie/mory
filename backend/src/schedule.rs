//! What rings when: the alarms due in a span of time, worked out from the listing.
//!
//! `push` sends them and keeps the loop that asks; this is the part that needs neither a network,
//! nor a database, nor a clock of its own, so each case of it is a listing, a span and a reader in
//! and a list of alarms out.
//!
//! When an occurrence starts is `note_events`' answer, which the fixtures in `fixtures/calendar/`
//! hold to the calendar's, and when it is rung for is `alarms`'.

use chrono::{DateTime, NaiveDate, Utc};

use crate::alarms::{self, Defaults, Reach, TaskDate, instants_of, task_dates};
use crate::models::ListEntry;
use crate::note_events::{self, Occurrence, Reader, Start};

/// When the occurrence an alarm is for starts: a moment, or a day for an all-day one.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Moment {
    At(DateTime<Utc>),
    Day(NaiveDate),
}

impl std::fmt::Display for Moment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Moment::At(at) => write!(f, "{}", at.to_rfc3339()),
            Moment::Day(day) => write!(f, "{}", day.format("%Y-%m-%d")),
        }
    }
}

/// One alarm: an occurrence, when it starts, and what the worker shows for it.
#[derive(Debug, Clone, PartialEq)]
pub struct Alarm {
    /// When it rings, which an occurrence may do more than once and at times of its own.
    pub at: DateTime<Utc>,
    pub name: String,
    pub path: String,
    pub location: Option<String>,
    /// When the occurrence starts, which tells two occurrences of a series apart.
    pub start: Moment,
}

/// What the scheduler works from, read again whenever a sync says the listing changed.
pub(crate) struct Schedule {
    entries: Vec<ListEntry>,
    /// What `.mory/calendars.yaml` says alarms ring at where a note does not.
    defaults: Defaults,
    /// How far from an occurrence any alarm in `entries` or `defaults` rings: asked of every note,
    /// so asked once here and not every minute.
    reach: Reach,
}

impl Schedule {
    pub(crate) fn new(entries: Vec<ListEntry>, defaults: Defaults) -> Self {
        let reach = Reach::of(&entries, &defaults);
        Schedule { entries, defaults, reach }
    }
}

/// What is rung for: an occurrence of an event, or one of a task's dates, with the alarms it rings
/// at already worked out. The two are told apart only in how their alarms are, which is a different
/// precedence for each.
struct Subject<'a> {
    specs: Vec<alarms::Spec>,
    start: Start,
    name: &'a str,
    path: &'a str,
    location: Option<&'a str>,
}

impl<'a> Subject<'a> {
    fn of_occurrence(occurrence: &'a Occurrence, defaults: &Defaults) -> Self {
        Subject {
            specs: defaults.specs_of(occurrence),
            start: occurrence.start,
            name: &occurrence.name,
            path: &occurrence.path,
            location: occurrence.location.as_deref(),
        }
    }

    fn of_date(date: &'a TaskDate, defaults: &Defaults) -> Self {
        Subject {
            specs: defaults.task_specs_of(date),
            start: date.start,
            name: &date.name,
            path: &date.path,
            location: None,
        }
    }

    /// Each alarm it rings after `after` and no later than `until`.
    fn alarms_between(&self, after: DateTime<Utc>, until: DateTime<Utc>, reader: &Reader) -> Vec<Alarm> {
        let moment = match self.start {
            Start::Date(day) => Moment::Day(day),
            Start::Time(_) => Moment::At(self.start.begins(reader)),
        };
        instants_of(&self.specs, self.start, reader)
            .into_iter()
            .filter(|at| after < *at && *at <= until)
            .map(|at| Alarm {
                at,
                name: self.name.to_owned(),
                path: self.path.to_owned(),
                location: self.location.map(str::to_owned),
                start: moment,
            })
            .collect()
    }
}

/// The alarms ringing after `after` and no later than `until`, soonest first.
///
/// An occurrence rings at what its `alarms` say, then its category, then the configuration; failing
/// all of them, at its start, if it is timed. One already marked finished needs no reminder.
pub(crate) fn alarms_between(
    schedule: &Schedule,
    after: DateTime<Utc>,
    until: DateTime<Utc>,
    reader: &Reader,
) -> Vec<Alarm> {
    let local_date = |at: DateTime<Utc>| at.with_timezone(&reader.zone).date_naive();
    // An alarm in the span belongs to an occurrence that starts as far after it as the longest
    // lead any alarm has, or as far before it as the longest lag.
    let (from, to) = note_events::day_window(
        local_date(after - schedule.reach.lag),
        local_date(until + schedule.reach.lead),
        reader,
    );
    let mut found = Vec::new();
    for occurrence in note_events::occurrences(&schedule.entries, from, to, reader) {
        if !occurrence.finished {
            let subject = Subject::of_occurrence(&occurrence, &schedule.defaults);
            found.extend(subject.alarms_between(after, until, reader));
        }
    }
    for date in task_dates(&schedule.entries, reader) {
        let subject = Subject::of_date(&date, &schedule.defaults);
        found.extend(subject.alarms_between(after, until, reader));
    }
    found.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.name.cmp(&b.name)));
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono_tz::Tz as Zone;

    const LOS_ANGELES: Zone = chrono_tz::America::Los_Angeles;

    fn entry(yaml: &str) -> ListEntry {
        ListEntry::note("note.md", yaml)
    }

    fn at(text: &str) -> DateTime<Utc> {
        text.parse().unwrap()
    }

    fn schedule_of(entries: impl IntoIterator<Item = ListEntry>) -> Schedule {
        Schedule::new(entries.into_iter().collect(), Defaults::default())
    }

    fn reader() -> Reader {
        Reader { zone: LOS_ANGELES, now: at("2024-05-01T00:00:00Z") }
    }

    #[test]
    fn alarms_are_the_timed_unfinished_occurrences_in_the_span() {
        let schedule = schedule_of([entry("
events:
    Standup:
        start: '2024-05-06 09:00'
        repeat: { freq: daily, count: 3 }
        location: Room 1
    Done: { start: '2024-05-06 09:30', finished: true }
    Holiday: { start: '2024-05-07' }
    Later: { start: '2024-05-06 10:00:00-07:00' }
")]);
        // 09:00 in Los Angeles is 16:00 UTC; the span starts exactly at the first, so it is left
        // out as already rung.
        let alarms = alarms_between(&schedule, at("2024-05-06T16:00:00Z"), at("2024-05-07T16:00:00Z"), &reader());
        let seen: Vec<(String, &str)> = alarms.iter().map(|a| (a.at.to_rfc3339(), a.name.as_str())).collect();
        assert_eq!(seen, [
            ("2024-05-06T17:00:00+00:00".to_owned(), "Later"),
            ("2024-05-07T16:00:00+00:00".to_owned(), "Standup"),
        ]);
        assert_eq!(alarms[1].location.as_deref(), Some("Room 1"));
    }

    #[test]
    fn a_wall_clock_rings_at_that_time_in_each_readers_zone() {
        let schedule = schedule_of([entry("events: { Call: { start: '2024-05-06 09:00' } }")]);
        let tokyo = Reader { zone: chrono_tz::Asia::Tokyo, now: at("2024-05-01T00:00:00Z") };
        let span = (at("2024-05-05T00:00:00Z"), at("2024-05-07T00:00:00Z"));
        assert_eq!(alarms_between(&schedule, span.0, span.1, &reader())[0].at, at("2024-05-06T16:00:00Z"));
        assert_eq!(alarms_between(&schedule, span.0, span.1, &tokyo)[0].at, at("2024-05-06T00:00:00Z"));
    }

    /// What a reader in Los Angeles is told over the span, as `at  name`.
    fn told(schedule: &Schedule, after: &str, until: &str) -> Vec<String> {
        alarms_between(schedule, at(after), at(until), &reader())
            .iter()
            .map(|alarm| format!("{}  {}", alarm.at.to_rfc3339(), alarm.name))
            .collect()
    }

    /// What `told` says of one note, under the defaults every note has.
    fn rung(yaml: &str, after: &str, until: &str) -> Vec<String> {
        told(&schedule_of([entry(yaml)]), after, until)
    }

    #[test]
    fn an_occurrence_rings_at_each_of_its_alarms() {
        let yaml = "
events:
    Review:
        start: '2024-05-06 09:00'
        alarms: [-1h, -10m, 0m, +5m]
";
        assert_eq!(rung(yaml, "2024-05-06T00:00:00Z", "2024-05-07T00:00:00Z"), [
            "2024-05-06T15:00:00+00:00  Review",
            "2024-05-06T15:50:00+00:00  Review",
            "2024-05-06T16:00:00+00:00  Review",
            "2024-05-06T16:05:00+00:00  Review",
        ]);
        // Only those in the span, the last of them counting and the first not.
        assert_eq!(rung(yaml, "2024-05-06T15:00:00Z", "2024-05-06T15:50:00Z"), [
            "2024-05-06T15:50:00+00:00  Review",
        ]);
    }

    #[test]
    fn an_occurrence_with_no_alarms_set_rings_at_its_start_and_an_all_day_one_stays_quiet() {
        let yaml = "
events:
    Call: { start: '2024-05-06 09:00' }
    Holiday: { start: '2024-05-06' }
    Quiet: { start: '2024-05-06 09:30', alarms: [] }
    Unset: { start: '2024-05-06 10:00', alarms: }
    Spoilt: { start: '2024-05-06 11:00', alarms: [10m] }
    Also spoilt: { start: '2024-05-06 12:00', alarms: [-5m, 10m] }
";
        assert_eq!(rung(yaml, "2024-05-06T00:00:00Z", "2024-05-07T00:00:00Z"), [
            "2024-05-06T16:00:00+00:00  Call",
            "2024-05-06T17:00:00+00:00  Unset",
            "2024-05-06T18:55:00+00:00  Also spoilt",
        ]);
    }

    #[test]
    fn an_all_day_event_rings_at_the_time_it_is_given() {
        let yaml = "
events:
    Birthday: { start: '2024-05-07', alarms: [-1d 18:00, 09:00] }
";
        assert_eq!(rung(yaml, "2024-05-06T00:00:00Z", "2024-05-08T00:00:00Z"), [
            "2024-05-07T01:00:00+00:00  Birthday",
            "2024-05-07T16:00:00+00:00  Birthday",
        ]);
    }

    #[test]
    fn an_alarm_is_set_for_an_override_an_instance_or_the_event() {
        let yaml = "
events:
    Standup:
        start: '2024-05-06 09:00'
        repeat: { freq: daily, count: 4 }
        alarms: [-10m]
        overrides:
            - { at: '2024-05-07 09:00', alarms: [] }
            - { at: '2024-05-08 09:00', alarms: [-1h, -5m] }
    Class:
        alarms: [-30m]
        instances:
            - { start: '2024-05-06 14:00' }
            - { start: '2024-05-06 15:00', alarms: [0m] }
";
        let rung = rung(yaml, "2024-05-05T00:00:00Z", "2024-05-10T00:00:00Z");
        assert_eq!(rung, [
            "2024-05-06T15:50:00+00:00  Standup",
            "2024-05-06T20:30:00+00:00  Class",
            "2024-05-06T22:00:00+00:00  Class",
            "2024-05-08T15:00:00+00:00  Standup",
            "2024-05-08T15:55:00+00:00  Standup",
            "2024-05-09T15:50:00+00:00  Standup",
        ]);
    }

    #[test]
    fn an_alarm_ahead_of_its_occurrences_window_is_still_found() {
        // Monday 2024-05-06 is generated by the rule, which is anchored a week earlier, and the
        // alarm is on the Friday before. A span inside that Friday would not expand the rule as far
        // as Monday if only the span were asked for.
        let yaml = "
events:
    Review: { start: '2024-04-29 09:00', repeat: { freq: weekly }, alarms: [-3d] }
";
        assert_eq!(rung(yaml, "2024-05-03T15:59:00Z", "2024-05-03T17:00:00Z"), [
            "2024-05-03T16:00:00+00:00  Review",
        ]);
        // And one that rings after its occurrence: Monday's, a day later.
        let after = "
events:
    Review: { start: '2024-04-29 09:00', repeat: { freq: weekly }, alarms: [+1d] }
";
        assert_eq!(rung(after, "2024-05-07T15:59:00Z", "2024-05-07T16:01:00Z"), [
            "2024-05-07T16:00:00+00:00  Review",
        ]);
    }

    #[test]
    fn the_configuration_sets_the_alarms_a_note_leaves_unsaid_and_the_window_follows() {
        let config = "
alarms: { all_day: [-1d 18:00] }
categories: { meeting: { alarms: [-3d] } }
";
        let defaults = crate::v2::parse_calendar_config(config).unwrap().alarm_defaults();
        // The Monday occurrence is generated, so only a window reaching it finds the Friday alarm,
        // although no note says anything of three days.
        let schedule = Schedule::new(vec![entry("
events:
    Review: { start: '2024-04-29 09:00', repeat: { freq: weekly }, category: meeting }
    Holiday: { start: '2024-05-07' }
    Own: { start: '2024-05-07 10:00', category: meeting, alarms: [-1h] }
")], defaults);
        assert_eq!(told(&schedule, "2024-05-03T15:59:00Z", "2024-05-07T20:00:00Z"), [
            "2024-05-03T16:00:00+00:00  Review",
            "2024-05-07T01:00:00+00:00  Holiday",
            "2024-05-07T16:00:00+00:00  Own",
        ]);
    }

    #[test]
    fn a_task_date_rings_as_due_or_deadline_after_the_task() {
        let defaults = crate::v2::parse_calendar_config("alarms: { due_by: [09:00], deadline: [-1d 18:00, -2h] }")
            .unwrap()
            .alarm_defaults();
        let mut task = entry("
task:
    due_by: 2024-05-10
    deadline: 2024-05-15 17:00:00-07:00
");
        task.path = ".tasks/6f1d3c2e-8a4b-4c57-9d1e-2b7a5f0e9c31.md".into();
        task.title = Some("Write the report".to_owned());
        let mut done = task.clone();
        done.path = ".tasks/0d9a7e54-1c3b-4f6a-8b2d-5e4c7a1f9b60.md".into();
        done.metadata = Some(serde_yaml::from_str("task: { due_by: 2024-05-10, status: { kind: done } }").unwrap());
        let schedule = Schedule::new(vec![task, done], defaults);
        let alarms = alarms_between(&schedule, at("2024-05-01T00:00:00Z"), at("2024-05-20T00:00:00Z"), &reader());
        let seen: Vec<(String, &str, String)> = alarms
            .iter()
            .map(|alarm| (alarm.at.to_rfc3339(), alarm.name.as_str(), alarm.start.to_string()))
            .collect();
        assert_eq!(seen, [
            ("2024-05-10T16:00:00+00:00".to_owned(), "Due: Write the report", "2024-05-10".to_owned()),
            ("2024-05-15T01:00:00+00:00".to_owned(), "Deadline: Write the report", "2024-05-16T00:00:00+00:00".to_owned()),
            ("2024-05-15T22:00:00+00:00".to_owned(), "Deadline: Write the report", "2024-05-16T00:00:00+00:00".to_owned()),
        ]);
    }
}
