//! What `.mory/calendars.yaml` holds that moried or the web app does not read.
//!
//! The file is written by hand as well as by the web app's settings, and each reader takes what it
//! can and leaves the rest: moried a subscription it cannot read, the web app an alarm that is not
//! one or a colour that is not text. Left out quietly, such a value looks set and does nothing,
//! so a write through MCP that holds one is refused with this list, which names the same values
//! the web app's health page reports (`readCalendarConfiguration` in
//! `frontend/src/calendar-configuration.ts`). `fixtures/calendar/configurations.yaml` holds the
//! two to each other by where each value is: `calendars[2]`, `categories.meeting.alarms`.

use serde_yaml::{Mapping, Value};

use crate::alarms::Spec;
use crate::note_events::key_name;

/// A value one of the readers does not take, by where it is in the file.
#[derive(Debug, Clone, PartialEq)]
pub struct Unread {
    pub at: String,
    pub message: String,
}

const TOP_LEVEL: [&str; 4] = ["calendars", "task_dates", "alarms", "categories"];
const SUBSCRIPTION: [&str; 6] = ["id", "name", "url", "color", "enabled", "description"];
const TASK_DATES: [&str; 2] = ["due_by", "deadline"];
const ALARM_KINDS: [&str; 4] = ["timed", "all_day", "due_by", "deadline"];
const CATEGORY: [&str; 3] = ["color", "name", "alarms"];

/// Every value in the file that a reader leaves out, or why the file cannot be read at all.
pub fn unread(text: &str) -> Result<Vec<Unread>, String> {
    crate::v2::parse_calendar_config(text).map_err(|e| format!("{e:#}"))?;
    let document: Value = serde_yaml::from_str(text).unwrap_or(Value::Null);
    let Some(document) = document.as_mapping() else {
        return Ok(Vec::new());
    };
    let mut found = Vec::new();
    let mut note = |at: String, message: String| found.push(Unread { at, message });

    unknown_keys(document, &TOP_LEVEL, "", &mut note);

    match document.get("calendars") {
        None | Some(Value::Null) => {},
        Some(Value::Sequence(entries)) => {
            for (index, entry) in entries.iter().enumerate() {
                let at = format!("calendars[{index}]");
                if let Err(reason) = crate::v2::read_subscription(entry) {
                    note(at, format!("{reason}; the calendar is left out"));
                    continue;
                }
                let entry = entry.as_mapping().expect("a subscription is a mapping");
                if !matches!(entry.get("description"), None | Some(Value::Null | Value::String(_))) {
                    note(format!("{at}.description"), "is not text".to_owned());
                }
                unknown_keys(entry, &SUBSCRIPTION, &format!("{at}."), &mut note);
            }
        },
        Some(_) => note("calendars".to_owned(), "is not a list of subscriptions".to_owned()),
    }

    if let Some(block) = block(document, "task_dates", "a mapping of due_by and deadline to colours", &mut note) {
        for field in TASK_DATES {
            if !matches!(block.get(field), None | Some(Value::Null | Value::String(_))) {
                note(format!("task_dates.{field}"), "is not a colour".to_owned());
            }
        }
        unknown_keys(block, &TASK_DATES, "task_dates.", &mut note);
    }

    if let Some(block) = block(document, "alarms", "a mapping of kinds to the alarms they ring at", &mut note) {
        for kind in ALARM_KINDS {
            alarm_values(block.get(kind), &format!("alarms.{kind}"), &mut note);
        }
        unknown_keys(block, &ALARM_KINDS, "alarms.", &mut note);
    }

    if let Some(block) = block(document, "categories", "a mapping of category ids", &mut note) {
        for (id, entry) in block {
            let Some(id) = key_name(id) else {
                note("categories".to_owned(), "names a category by something that is not text".to_owned());
                continue;
            };
            let at = format!("categories.{id}");
            let entry = match entry {
                Value::Null => continue,
                Value::Mapping(entry) => entry,
                _ => {
                    note(at, "is not a mapping, so the category is not configured".to_owned());
                    continue;
                },
            };
            for field in ["color", "name"] {
                if !matches!(entry.get(field), None | Some(Value::Null | Value::String(_))) {
                    note(format!("{at}.{field}"), "is not text".to_owned());
                }
            }
            alarm_values(entry.get("alarms"), &format!("{at}.alarms"), &mut note);
            unknown_keys(entry, &CATEGORY, &format!("{at}."), &mut note);
        }
    }

    Ok(found)
}

/// The block under `key` if it is a mapping; one that is neither that nor empty is noted.
fn block<'a>(
    document: &'a Mapping,
    key: &str,
    shape: &str,
    note: &mut impl FnMut(String, String),
) -> Option<&'a Mapping> {
    match document.get(key) {
        None | Some(Value::Null) => None,
        Some(Value::Mapping(block)) => Some(block),
        Some(_) => {
            note(key.to_owned(), format!("is not {shape}"));
            None
        },
    }
}

/// Each entry of an `alarms:` value that `Spec::list_from` drops.
fn alarm_values(value: Option<&Value>, at: &str, note: &mut impl FnMut(String, String)) {
    let entries = match value {
        None | Some(Value::Null) => return,
        Some(Value::Sequence(entries)) => &entries[..],
        Some(single) => std::slice::from_ref(single),
    };
    for entry in entries {
        let reason = match entry.as_str() {
            Some(text) => Spec::parse(text).err(),
            None => Some(format!("{} is not an alarm", serde_json::to_string(entry).unwrap_or_default())),
        };
        if let Some(reason) = reason {
            note(at.to_owned(), reason);
        }
    }
}

fn unknown_keys(mapping: &Mapping, known: &[&str], prefix: &str, note: &mut impl FnMut(String, String)) {
    for key in mapping.keys() {
        let name = key_name(key).unwrap_or_else(|| serde_json::to_string(key).unwrap_or_default());
        if !known.contains(&name.as_str()) {
            note(format!("{prefix}{name}"), "is read by neither moried nor the web app".to_owned());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Case {
        name: String,
        text: String,
        unread: Vec<String>,
    }

    /// The values each case leaves out, by where they are, as `calendar-configuration.spec.ts`
    /// requires the web app to report them.
    #[test]
    fn the_unread_values_are_the_fixtures() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/calendar/configurations.yaml");
        let cases: Vec<Case> =
            serde_yaml::from_str(&std::fs::read_to_string(path).expect("a readable fixture")).expect("cases");
        assert!(!cases.is_empty());
        for case in cases {
            let found = unread(&case.text).unwrap_or_else(|e| panic!("{}: {e}", case.name));
            // As a set: which values, not in which order or how many mistakes each holds.
            let at: std::collections::BTreeSet<_> = found.iter().map(|unread| unread.at.clone()).collect();
            let expected: std::collections::BTreeSet<_> = case.unread.into_iter().collect();
            assert_eq!(at, expected, "{}: {found:?}", case.name);
        }
    }

    /// A file that is not YAML, or not a mapping, has nothing in it to tell apart.
    #[test]
    fn a_file_read_as_nothing_is_refused_whole() {
        assert!(unread("calendars: [unclosed").is_err());
        assert!(unread("- id: work\n").is_err());
        assert_eq!(unread(""), Ok(Vec::new()));
        assert_eq!(unread("# nothing yet\n"), Ok(Vec::new()));
    }
}
