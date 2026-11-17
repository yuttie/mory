//! What is on over some days: every occurrence the notes declare, the imported ones no note claims,
//! and each task's due date and deadline, in one list, in one zone, in order.
//!
//! The calendar works this out in the browser, from three sources a caller would otherwise have to
//! fetch and reconcile itself: `eventsFromEntries` for the notes, which `note_events` follows rule
//! by rule, the subscribed feeds `v2::imported_events` expands, and `taskDatesFromEntries` for the
//! tasks. Each is read here through the function that already reads it, so nothing is expanded a
//! second way.
//!
//! What is new is how the three meet, `mergeImported`'s part: a note converted from an imported
//! event is drawn in its place. That rule is copied here, with one difference made on purpose. The
//! calendar takes a note's claim only from an occurrence it draws in the window it was asked for,
//! so a note that moved its occurrence out of that window gives the feed's original back. A
//! calendar asks for a month either side of what it shows and rarely meets that; an agenda of one
//! day would meet it whenever someone moved a meeting to another day. Here a claim is read from
//! the note's declaration, and holds wherever its occurrences fall.

use std::collections::BTreeSet;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde_yaml::Value;

use crate::ical::ImportedEvent;
use crate::models::ListEntry;
use crate::note_events::{self, Reader, Start};
use crate::tasks::{date_texts, task_of, task_status_of, TaskField};

/// How long before the window an occurrence may start and still be on in it. An occurrence is on
/// over the days it spans, so a trip that began last week is on today; but expanding a rule from
/// the beginning of time to find the ones that might still be running is not affordable, so this
/// looks back a month. A longer one that began before then is missed.
pub const LOOKBACK_DAYS: i64 = 31;

/// One thing that is on.
#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    /// Where it starts, as moried's wall clock: a date for a whole day.
    pub start: Start,
    /// Where it ends, as the calendar draws it. `None` for no end.
    pub end: Option<Start>,
    pub name: String,
    pub location: Option<String>,
    pub source: Source,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    /// An occurrence a note declares.
    Note {
        path: String,
        /// The key the event has in the note's `events:` map.
        event: String,
        category: Option<String>,
        finished: bool,
    },
    /// An occurrence of a subscribed calendar's event that no note claims.
    Imported {
        calendar: String,
        uid: String,
        recurrence_id: String,
        note: Option<String>,
        url: Option<String>,
    },
    /// A task's due date or deadline, which the calendar draws as an event of its own.
    Task {
        path: String,
        field: TaskField,
        /// The task's `status.kind`: a date of one that is done or canceled is settled.
        status: Option<String>,
    },
}

/// Who an agenda is drawn for.
///
/// The notes are read as moried reads them, a time written without an offset in moried's own zone,
/// where `update_event` matches it and `list_tasks` reads a task's dates: read in another, it would
/// name a moment those tools do not. `zone` only picks the days of the window and the offset each
/// time is given with. A whole day is the same date in any zone, so it is
/// placed in `zone`, and is on the days its dates name there.
#[derive(Debug, Clone, Copy)]
pub struct View {
    /// moried's reader: `zone` is moried's own.
    pub reader: Reader,
    pub zone: chrono_tz::Tz,
}

impl View {
    /// The days `[from, to]` in the view's zone, as the instants they begin and end at.
    pub fn days(&self, from: NaiveDate, to: NaiveDate) -> (DateTime<Utc>, DateTime<Utc>) {
        note_events::day_window(from, to, &Reader { zone: self.zone, ..self.reader })
    }

    /// When an occurrence begins: a time where moried reads it, and a date at the first moment of
    /// its day in the view's zone.
    pub fn begins(&self, start: Start) -> DateTime<Utc> {
        match start {
            Start::Date(date) => self.days(date, date).0,
            Start::Time(_) => start.begins(&self.reader),
        }
    }

    /// What to expand the notes over to find the occurrences that start in the days `[from, to]`:
    /// two days more on each side. `note_events` bounds a rule's whole days by where they begin in
    /// moried's zone, and a zone can be 26 hours from another; what does not start in the days is
    /// for the caller to drop.
    pub fn reach(&self, from: NaiveDate, to: NaiveDate) -> (DateTime<Utc>, DateTime<Utc>) {
        self.days(from - Duration::days(2), to + Duration::days(2))
    }
}

/// The instants the subscribed calendars are asked for over the days `[from, to]`: from
/// `LOOKBACK_DAYS` before them, for what began earlier and runs into them, to a day after them.
///
/// A feed keeps some of what it holds by the date in its own zone rather than by instant -- an
/// all-day event begins at midnight there, and an occurrence whose series it does not publish is
/// kept by its own date -- and that zone may be most of a day from the view's: an occurrence in
/// Sydney at 01:00 on the 12th is on the 11th in Tokyo. What is not on is dropped afterwards.
pub fn feed_window(from: NaiveDate, to: NaiveDate, view: &View) -> (DateTime<Utc>, DateTime<Utc>) {
    view.days(from - Duration::days(LOOKBACK_DAYS), to + Duration::days(1))
}

/// When an occurrence is over, as `eventEndsAt` has it: the end it is given, the whole of its last
/// day if that is a date, and the end of the day it starts on, in the view's zone, if it has none.
/// Never before its own start, which an instance that inherits its event's literal end can
/// otherwise be.
fn over_at(start: Start, end: Option<Start>, view: &View) -> DateTime<Utc> {
    let begins = view.begins(start);
    let over = match end {
        Some(Start::Date(date)) => view.days(date, date).1,
        Some(time) => view.begins(time),
        None => {
            let day = begins.with_timezone(&view.zone).date_naive();
            view.days(day, day).1
        },
    };
    over.max(begins)
}

/// Whether an occurrence is on at any moment of the window: it starts in it, or starts before it
/// and is not over when it begins. One that ends at the window's first midnight is over by then,
/// as the calendar has it, which does not draw an event on the day it ends at 00:00.
fn is_on(start: Start, end: Option<Start>, window: (DateTime<Utc>, DateTime<Utc>), view: &View) -> bool {
    let begins = view.begins(start);
    begins <= window.1 && (window.0 <= begins || window.0 < over_at(start, end, view))
}

/// JavaScript's template coercion of a value `mergeImported` keys on: text as itself, a number or
/// a boolean as it prints. Anything else names no imported event, whose identifiers are all text.
fn key_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Null => Some("null".to_owned()),
        _ => None,
    }
}

/// The imported events the notes claim: whole series by calendar and `uid`, and single occurrences
/// by those and the instant `recurrence_id` names, or its text where it names none.
#[derive(Default)]
struct Claims {
    series: BTreeSet<(String, String)>,
    occurrences: BTreeSet<(String, String, Result<i64, String>)>,
}

impl Claims {
    /// Every claim the listing's `ical:` blocks make, whatever the window.
    fn of(entries: &[ListEntry], reader: &Reader) -> Self {
        let mut claims = Claims::default();
        for entry in entries {
            // A list of events as well as a map of them, as the calendar reads either.
            for (_, detail) in note_events::declared_events(entry) {
                let Some(Value::Mapping(ical)) = detail.get("ical") else {
                    continue;
                };
                // `event.uid === undefined` claims nothing; `null` is not undefined, and is coerced.
                let Some(uid) = ical.get("uid").and_then(key_text) else {
                    continue;
                };
                // `calendar ?? ''`
                let calendar = match ical.get("calendar") {
                    None | Some(Value::Null) => String::new(),
                    Some(calendar) => match key_text(calendar) {
                        Some(calendar) => calendar,
                        None => continue,
                    },
                };
                match ical.get("recurrence_id") {
                    None => {
                        claims.series.insert((calendar, uid));
                    },
                    Some(at) => {
                        let Some(key) = occurrence_key(at, reader) else {
                            continue;
                        };
                        claims.occurrences.insert((calendar, uid, key));
                    },
                }
            }
        }
        claims
    }

    fn claim(&self, event: &ImportedEvent, reader: &Reader) -> bool {
        let series = (event.calendar.clone(), event.uid.clone());
        if self.series.contains(&series) {
            return true;
        }
        let Some(key) = occurrence_key(&Value::String(event.recurrence_id.clone()), reader) else {
            return false;
        };
        self.occurrences.contains(&(series.0, series.1, key))
    }
}

/// `instantOf(recurrenceId) ?? recurrenceId`: two spellings of one moment are one occurrence.
fn occurrence_key(value: &Value, reader: &Reader) -> Option<Result<i64, String>> {
    match note_events::instant_of(Some(value), reader.zone) {
        Some(instant) => Some(Ok(instant)),
        None => key_text(value).map(Err),
    }
}

/// Everything on in the days `[from, to]`: `entries` is the listing, `imported` what the subscribed
/// calendars hold over `feed_window`. Sorted by when each starts.
pub fn assemble(
    entries: &[ListEntry],
    imported: &[ImportedEvent],
    from: NaiveDate,
    to: NaiveDate,
    view: &View,
) -> Vec<Item> {
    let window = view.days(from, to);
    let mut items = Vec::new();

    let (look_from, look_to) = view.reach(from - Duration::days(LOOKBACK_DAYS), to);
    for occurrence in note_events::occurrences(entries, look_from, look_to, &view.reader) {
        if !is_on(occurrence.start, occurrence.end, window, view) {
            continue;
        }
        items.push(Item {
            start: occurrence.start,
            end: occurrence.end,
            name: occurrence.name,
            location: occurrence.location,
            source: Source::Note {
                path: occurrence.path,
                event: occurrence.event,
                category: occurrence.category,
                finished: occurrence.finished,
            },
        });
    }

    let claims = Claims::of(entries, &view.reader);
    for event in imported {
        if claims.claim(event, &view.reader) {
            continue;
        }
        // The backend writes every start and end the calendar reads.
        let Some(start) = note_events::to_wall_clock(&event.start, view.reader.zone) else {
            continue;
        };
        let end = event.end.as_deref().and_then(|end| note_events::to_wall_clock(end, view.reader.zone));
        if !is_on(start, end, window, view) {
            continue;
        }
        items.push(Item {
            start,
            end,
            name: event.name.clone(),
            location: event.location.clone(),
            source: Source::Imported {
                calendar: event.calendar.clone(),
                uid: event.uid.clone(),
                recurrence_id: event.recurrence_id.clone(),
                note: event.note.clone(),
                url: event.url.clone(),
            },
        });
    }

    for entry in entries {
        let Some((path, task)) = task_of(entry) else {
            continue;
        };
        for (field, text) in date_texts(task) {
            let Some(start) = note_events::task_date_start(text, view.reader.zone) else {
                continue;
            };
            if !is_on(start, None, window, view) {
                continue;
            }
            items.push(Item {
                start,
                end: None,
                // `entry.title ?? entry.path`, as the calendar names it.
                name: entry.title.clone().unwrap_or_else(|| path.to_string()),
                location: None,
                source: Source::Task {
                    path: path.to_string(),
                    field,
                    status: task_status_of(entry.metadata.as_ref()),
                },
            });
        }
    }

    // A whole day before anything timed on it, then by name, so that the same items always come
    // in the same order.
    items.sort_by(|a, b| {
        view.begins(a.start)
            .cmp(&view.begins(b.start))
            .then_with(|| matches!(b.start, Start::Date(_)).cmp(&matches!(a.start, Start::Date(_))))
            .then_with(|| a.name.cmp(&b.name))
    });
    items
}

/// The agenda for the days `[from, to]`, read from the listing at HEAD and the subscribed feeds.
pub struct Agenda {
    /// The commit the listing describes.
    pub commit: git2::Oid,
    pub items: Vec<Item>,
    /// Each subscribed calendar, with the error it was read with if it could not be.
    pub calendars: Vec<crate::v2::CalendarReport>,
    /// Why no calendar could be read at all, which leaves the notes and tasks to stand alone.
    pub calendars_error: Option<String>,
    /// One line for each subscription left out because it could not be read.
    pub configuration_errors: Vec<String>,
    /// Set when a series had more occurrences than one expansion returns, so some may be missing.
    pub truncated: bool,
}

pub async fn agenda(
    state: &crate::models::AppState,
    from: NaiveDate,
    to: NaiveDate,
    view: &View,
) -> anyhow::Result<Agenda> {
    let (commit, entries) = state.get_entries(None).await?;

    let (look_from, look_to) = feed_window(from, to, view);
    let (calendars, imported, truncated, calendars_error, configuration_errors) =
        match crate::v2::imported_events(state, look_from.fixed_offset(), look_to.fixed_offset()).await {
            Ok(response) => {
                (response.calendars, response.events, response.truncated, None, response.configuration_errors)
            },
            Err(e) => (Vec::new(), Vec::new(), false, Some(format!("{e:#}")), Vec::new()),
        };

    Ok(Agenda {
        commit,
        items: assemble(&entries, &imported, from, to, view),
        calendars,
        calendars_error,
        configuration_errors,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono_tz::Tz as Zone;

    const TOKYO: Zone = chrono_tz::Asia::Tokyo;

    /// moried in Tokyo, and an agenda shown there.
    fn tokyo() -> View {
        shown_in(TOKYO)
    }

    /// moried in Tokyo, and an agenda shown in `zone`.
    fn shown_in(zone: Zone) -> View {
        View { reader: Reader { zone: TOKYO, now: "2026-11-11T00:00:00Z".parse().unwrap() }, zone }
    }

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    fn note(path: &str, yaml: &str) -> ListEntry {
        let blob = format!("---\n{yaml}\n---\n");
        let (metadata, title) = crate::extract_metadata(blob.as_bytes(), "text/markdown");
        ListEntry {
            path: path.into(),
            size: blob.len(),
            mime_type: "text/markdown".to_owned(),
            metadata,
            title,
            time: "2026-11-01T00:00:00+00:00".parse().unwrap(),
            binary: false,
            unread: Vec::new(),
        }
    }

    fn imported(calendar: &str, uid: &str, start: &str, end: Option<&str>) -> ImportedEvent {
        ImportedEvent {
            calendar: calendar.to_owned(),
            uid: uid.to_owned(),
            recurrence_id: start.to_owned(),
            name: uid.to_owned(),
            start: start.to_owned(),
            end: end.map(str::to_owned),
            note: None,
            location: None,
            url: None,
        }
    }

    /// `start  end  name` for each item, in order.
    fn lines(items: &[Item]) -> Vec<String> {
        items
            .iter()
            .map(|item| {
                let end = item.end.map_or_else(|| "-".to_owned(), |end| end.to_string());
                format!("{}  {end}  {}", item.start, item.name)
            })
            .collect()
    }

    #[test]
    fn the_three_sources_meet_in_one_zone_in_order() {
        let entries = [
            note("dentist.md", "events:\n    Dentist:\n        start: 2026-11-11 17:00:00+09:00\n        end: +1h"),
            note(
                ".tasks/report-6f1c1d0e-5b1a-4c3e-9a7b-1f2e3d4c5b6a.md",
                "task:\n    title: Report\n    due_by: 2026-11-10",
            ),
        ];
        let feed = [
            imported("work", "standup", "2026-11-10 01:00:00+00:00", Some("2026-11-10 01:15:00+00:00")),
            imported("work", "holiday", "2026-11-11", Some("2026-11-11")),
        ];
        let items = assemble(&entries, &feed, day("2026-11-10"), day("2026-11-11"), &tokyo());
        assert_eq!(lines(&items), [
            "2026-11-10  -  .tasks/report-6f1c1d0e-5b1a-4c3e-9a7b-1f2e3d4c5b6a.md",
            "2026-11-10 10:00  2026-11-10 10:15  standup",
            "2026-11-11  2026-11-11  holiday",
            "2026-11-11 17:00  2026-11-11 18:00  Dentist",
        ]);
        assert!(matches!(items[0].source, Source::Task { field: TaskField::DueBy, .. }));
    }

    #[test]
    fn a_whole_day_comes_first_and_a_name_settles_the_rest() {
        let entries = [note(
            "a.md",
            "events:
    At midnight:
        start: 2026-11-10 00:00:00+09:00
    Whole day:
        start: 2026-11-10
    b:
        start: 2026-11-10 10:00:00+09:00
    a:
        start: 2026-11-10 10:00:00+09:00
",
        )];
        let items = assemble(&entries, &[], day("2026-11-10"), day("2026-11-10"), &tokyo());
        assert_eq!(lines(&items), [
            "2026-11-10  -  Whole day",
            "2026-11-10 00:00  -  At midnight",
            "2026-11-10 10:00  -  a",
            "2026-11-10 10:00  -  b",
        ]);
    }

    #[test]
    fn only_what_is_on_in_the_window_is_listed() {
        let entries = [note(
            "a.md",
            "events:
    Day before:
        start: 2026-11-09 23:00:00+09:00
    Running into it:
        start: 2026-11-09 23:00:00+09:00
        end: 2026-11-10 01:00:00+09:00
    Until midnight:
        start: 2026-11-09 23:00:00+09:00
        end: +1h
    Over as it begins:
        start: 2026-11-10 00:00:00+09:00
        end: +0m
    Trip:
        start: 2026-11-05
        end: 2026-11-12
    Monthly:
        start: 2026-06-08 15:00:00+09:00
        repeat:
            freq: monthly
            byday: 2mon
    Day after:
        start: 2026-11-12
",
        )];
        let feed = [
            // A feed's occurrence the day before, as a feed spells it in UTC: the 9th in Tokyo.
            imported("work", "early", "2026-11-09 07:00:00+00:00", None),
            // Over at the window's first midnight, where the calendar stops drawing it.
            imported("work", "late", "2026-11-09 14:00:00+00:00", Some("2026-11-09 15:00:00+00:00")),
        ];
        let items = assemble(&entries, &feed, day("2026-11-10"), day("2026-11-11"), &tokyo());
        assert_eq!(lines(&items), [
            "2026-11-05  2026-11-12  Trip",
            "2026-11-09 23:00  2026-11-10 01:00  Running into it",
            "2026-11-10 00:00  2026-11-10 00:00  Over as it begins",
        ]);
    }

    #[test]
    fn a_zone_moves_the_days_and_never_a_time_written_without_an_offset() {
        // moried is in Tokyo, which reads the breakfast at 08:00 there whatever zone is asked for.
        let entries = [note(
            "a.md",
            "events:
    Breakfast:
        start: 2026-11-10 08:00
    Holiday:
        start: 2026-11-10
    Rest:
        start: 2026-11-11
        repeat: { freq: daily, count: 1 }
",
        )];
        let on = |from: &str, to: &str, view: &View| lines(&assemble(&entries, &[], day(from), day(to), view));
        assert_eq!(on("2026-11-10", "2026-11-10", &tokyo()), [
            "2026-11-10  -  Holiday",
            "2026-11-10 08:00  -  Breakfast",
        ]);
        // In UTC it is 23:00 the day before, and over when that day is. A whole day is on its own
        // date in any zone, a rule's as well.
        let utc = shown_in(chrono_tz::UTC);
        assert_eq!(on("2026-11-09", "2026-11-09", &utc), ["2026-11-10 08:00  -  Breakfast"]);
        assert_eq!(on("2026-11-10", "2026-11-10", &utc), ["2026-11-10  -  Holiday"]);
        assert_eq!(on("2026-11-11", "2026-11-11", &utc), ["2026-11-11  -  Rest"]);
        // As far behind Tokyo as a zone gets, where the rule's day begins 23 hours after it does
        // in Tokyo, and as far ahead.
        assert_eq!(on("2026-11-11", "2026-11-11", &shown_in(chrono_tz::Etc::GMTPlus12)), ["2026-11-11  -  Rest"]);
        assert_eq!(on("2026-11-11", "2026-11-11", &shown_in(chrono_tz::Pacific::Kiritimati)), ["2026-11-11  -  Rest"]);
    }

    #[test]
    fn a_feed_is_read_far_enough_for_a_zone_ahead_of_the_view() {
        // An occurrence of a series the feed does not publish, which the feed keeps by its own
        // date: the 12th in Sydney, and the 11th, 23:00, in Tokyo.
        let calendar = crate::ical::parse_calendar(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//mory tests//EN\r\nBEGIN:VEVENT\r\n\
             UID:sydney@example\r\nRECURRENCE-ID;TZID=Australia/Sydney:20261112T010000\r\n\
             DTSTART;TZID=Australia/Sydney:20261112T010000\r\n\
             DTEND;TZID=Australia/Sydney:20261112T020000\r\nSUMMARY:Late call\r\n\
             END:VEVENT\r\nEND:VCALENDAR\r\n",
        )
        .unwrap();
        let (from, to) = (day("2026-11-10"), day("2026-11-11"));
        let (look_from, look_to) = feed_window(from, to, &tokyo());
        let feed = crate::ical::expand(&calendar, "work", look_from.fixed_offset(), look_to.fixed_offset());
        assert_eq!(lines(&assemble(&[], &feed.events, from, to, &tokyo())), [
            "2026-11-11 23:00  2026-11-12 00:00  Late call",
        ]);
    }

    #[test]
    fn a_note_claims_the_series_or_the_occurrence_it_was_converted_from() {
        let entries = [note(
            ".events/converted.md",
            "events:
    Weekly:
        start: 2026-11-10 10:00:00+09:00
        ical: { calendar: work, uid: weekly }
    Moved:
        start: 2026-11-20 10:00:00+09:00
        ical: { calendar: work, uid: monthly, recurrence_id: 2026-11-10 01:00:00Z }
",
        )];
        let feed = [
            imported("work", "weekly", "2026-11-10 01:00:00+00:00", None),
            // The same series on another calendar is someone else's copy, and still drawn.
            imported("team", "weekly", "2026-11-10 01:00:00+00:00", None),
            // Claimed by instant, though the note spells it another way, and moved out of the
            // window: it must not come back.
            imported("work", "monthly", "2026-11-10 10:00:00+09:00", None),
            imported("work", "monthly", "2026-11-11 10:00:00+09:00", None),
        ];
        let items = assemble(&entries, &feed, day("2026-11-10"), day("2026-11-11"), &tokyo());
        assert_eq!(lines(&items), [
            "2026-11-10 10:00  -  Weekly",
            "2026-11-10 10:00  -  weekly",
            "2026-11-11 10:00  -  monthly",
        ]);
        assert!(matches!(&items[1].source, Source::Imported { calendar, .. } if calendar == "team"));

        // `events:` as a list, which the calendar reads by index, claims as a map does.
        let entries = [note(
            ".events/listed.md",
            "events:\n    - start: 2026-11-10 10:00:00+09:00\n      ical: { calendar: work, uid: weekly }",
        )];
        let items = assemble(&entries, &feed[..1], day("2026-11-10"), day("2026-11-11"), &tokyo());
        assert_eq!(lines(&items), ["2026-11-10 10:00  -  0"]);
    }

    #[test]
    fn a_settled_task_date_is_listed_with_its_status() {
        let entries = [note(
            ".tasks/done-6f1c1d0e-5b1a-4c3e-9a7b-1f2e3d4c5b6a.md",
            "task:\n    deadline: 2026-11-10 18:00:00+09:00\n    status:\n        kind: done\n        completed_at: 2026-11-09 12:00:00+09:00",
        )];
        let items = assemble(&entries, &[], day("2026-11-10"), day("2026-11-10"), &tokyo());
        assert_eq!(lines(&items), ["2026-11-10 18:00  -  .tasks/done-6f1c1d0e-5b1a-4c3e-9a7b-1f2e3d4c5b6a.md"]);
        assert!(matches!(
            &items[0].source,
            Source::Task { field: TaskField::Deadline, status: Some(status), .. } if status == "done",
        ));
    }
}
