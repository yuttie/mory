//! Derived urgency. Golden fixtures in fixtures/urgency are shared with the frontend.
use std::collections::BTreeMap;
use std::sync::LazyLock;
use chrono::{LocalResult, NaiveDateTime, Offset, DateTime, Duration, NaiveDate, TimeZone, Utc, Days};
use chrono_tz::Tz;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_yaml::Value;

static LEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([0-9]+) *(weeks?|days?|w|d)$").unwrap());

pub fn lead_time_days(value: &Value) -> Option<u64> {
    let parts = LEAD.captures(value.as_str()?.trim())?;
    let amount: u64 = parts[1].parse().ok()?;
    let days = amount.checked_mul(if parts[2].starts_with('w') { 7 } else { 1 })?;
    (days <= 9_007_199_254_740_991).then_some(days)
}

pub fn importance(value: &Value) -> Option<&'static str> {
    match value.as_str() {
        Some("low") => Some("low"),
        Some("medium") => Some("medium"),
        Some("high") => Some("high"),
        _ => match value.as_f64() {
            Some(1.0 | 2.0) => Some("low"),
            Some(4.0) => Some("medium"),
            Some(5.0) => Some("high"),
            _ => None,
        },
    }
}

#[derive(Default, Debug, Deserialize, Clone)]
pub struct Settings {
    pub default_lead_time: Option<String>,
    #[serde(default)]
    pub lead_time_by_tag: BTreeMap<String, String>,
}

pub fn read_settings(value: &Value) -> (Settings, Vec<String>) {
    let mut settings = Settings::default();
    let mut problems = Vec::new();
    if value.is_null() {
        return (settings, problems);
    }
    let Some(root) = value.as_mapping() else {
        return (settings, vec!["Task settings must be a mapping.".into()]);
    };
    if root.contains_key("tasks") {
        return (settings, vec!["Legacy task data found in .mory/tasks.yaml; move it to tasks-v1.yaml. Settings ignored.".into()]);
    }
    if let Some(lead) = root.get("default_lead_time") {
        if lead_time_days(lead).is_some() {
            settings.default_lead_time = lead.as_str().map(str::to_owned);
        }
        else {
            problems.push("Invalid default_lead_time; use whole days or weeks, such as 7d or 2w.".into());
        }
    }
    if let Some(tags) = root.get("lead_time_by_tag") {
        if let Some(tags) = tags.as_mapping() {
            for (tag, lead) in tags {
                if let (Some(tag), Some(_)) = (tag.as_str(), lead_time_days(lead)) {
                    settings.lead_time_by_tag.insert(tag.into(), lead.as_str().unwrap().into());
                }
                else {
                    problems.push(format!("Invalid lead time for tag {}.", tag.as_str().unwrap_or("?")));
                }
            }
        }
        else {
            problems.push("lead_time_by_tag must be a mapping.".into());
        }
    }
    (settings, problems)
}

pub fn resolved_lead_time(task: &Value, tags: &[String], settings: &Settings) -> u64 {
    task.get("lead_time").and_then(lead_time_days)
        .or_else(|| tags.iter().filter_map(|tag| settings.lead_time_by_tag.get(tag))
            .filter_map(|text| lead_time_days(&Value::String(text.clone()))).max())
        .or_else(|| settings.default_lead_time.as_ref().and_then(|text| lead_time_days(&text.clone().into())))
        .unwrap_or(7)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Urgency {
    pub level: String,
    pub slack_ratio: Option<f64>,
    pub reference: Option<String>,
    pub actionable: bool,
    pub short_window: bool,
}

// Match the frontend's explicit policy for repeated and missing wall-clock times.
fn local_instant(wall: NaiveDateTime, zone: Tz) -> DateTime<Utc> {
    match zone.from_local_datetime(&wall) {
        LocalResult::Single(at) => at.with_timezone(&Utc),
        LocalResult::Ambiguous(a, b) => a.min(b).with_timezone(&Utc),
        LocalResult::None => {
            let offset = zone.offset_from_utc_datetime(&(wall - Duration::days(1))).fix().local_minus_utc();
            (wall - Duration::seconds(i64::from(offset))).and_utc()
        },
    }
}

/// The instant a task date names, as `taskInstant` in `frontend/src/urgency.ts` reads it: a bare
/// date in `zone`, through its last moment with `end`, a datetime at its offset, and one written
/// without an offset as the wall clock in `zone`, which is moried's, as the alarms and the calendar
/// tools read such a time. What a tool writes is held to `is_written` instead.
pub fn instant(value: Option<&Value>, zone: Tz, end: bool) -> Option<DateTime<Utc>> {
    let text = value?.as_str()?.trim();
    if text.len() == 10 {
        let date = NaiveDate::parse_from_str(text, "%Y-%m-%d").ok()?;
        if date.format("%Y-%m-%d").to_string() != text {
            return None;
        }
        let at = if end { date.and_hms_milli_opt(23, 59, 59, 999)? } else { date.and_hms_opt(0, 0, 0)? };
        return Some(local_instant(at, zone));
    }
    let parts = DATETIME.captures(text)?;
    if parts[2].parse::<u8>().ok()? > 23 || parts[3].parse::<u8>().ok()? > 59 || parts.get(4).is_some_and(|seconds| seconds.as_str().parse::<u8>().is_ok_and(|value| value > 59)) {
        return None;
    }
    let date = NaiveDate::parse_from_str(&parts[1], "%Y-%m-%d").ok()?;
    if date.format("%Y-%m-%d").to_string() != parts[1] {
        return None;
    }
    let Some(offset) = parts.get(6) else {
        let millis = parts.get(5).map_or(0, |fraction| format!("{:0<3}", &fraction.as_str()[1..]).parse().unwrap_or(0));
        let seconds = parts.get(4).map_or(Some(0), |seconds| seconds.as_str().parse().ok())?;
        let wall = date.and_hms_milli_opt(parts[2].parse().ok()?, parts[3].parse().ok()?, seconds, millis)?;
        return Some(local_instant(wall, zone));
    };
    let written = if parts.get(4).is_none() { format!("{}:00{}", &text[..16], offset.as_str()) } else { text.to_owned() };
    DateTime::parse_from_rfc3339(&written.replace(' ', "T")).ok().map(|dt| dt.with_timezone(&Utc))
}

static DATETIME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([0-9]{4}-[0-9]{2}-[0-9]{2})[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})?$").unwrap());

/// Whether a value is a task date as one is written: a bare date, or a datetime carrying its offset,
/// spelt as every reader of one takes it. The twin of `isWrittenTaskDate`.
///
/// `instant` reads more, and so do some of the other readers, but not all of them. The calendar and
/// the alarms (`note_events::task_date_start`) read no fraction of a second, and a bare date in the
/// years 0 to 99 as one in the 1900s, as `Date` does; the task editor's date field reads a datetime
/// in those years so too. White space parts them as well: before a bare date it hides the date from
/// the calendar, and after one it makes the date midnight in that field. A tool that wrote one of
/// those would report success for a date that is not drawn, rung or edited as written, so it is
/// refused here rather than read some other way. The calendar reads white space around a datetime
/// carrying its offset, but it is refused with the rest: nothing needs it.
pub fn is_written(text: &str) -> bool {
    let value = Value::String(text.to_owned());
    text.trim() == text
        && !text.starts_with("00")
        && instant(Some(&value), chrono_tz::UTC, false).is_some()
        && (text.len() == 10 || DATETIME.captures(text).is_some_and(|parts| parts.get(5).is_none() && parts.get(6).is_some()))
}

pub fn calculate(task: &Value, tags: &[String], settings: &Settings, now: DateTime<Utc>, zone: Tz) -> Urgency {
    let due = instant(task.get("due_by"), zone, true);
    let deadline = instant(task.get("deadline"), zone, true);
    // `??` in the web app: an `available_from:` left empty is null, and falls through to `start_at`.
    let available = instant(task.get("available_from").filter(|value| !value.is_null()).or_else(|| task.get("start_at")), zone, false);
    let mut result = Urgency {
        level: "none".into(), slack_ratio: None, reference: None,
        actionable: available.is_none_or(|at| at <= now), short_window: false,
    };
    let Some(mut reference) = due.into_iter().chain(deadline).min() else {
        return result;
    };
    if matches!(task.get("status").and_then(|s| s.get("kind")).and_then(Value::as_str), Some("done" | "canceled")) {
        return result;
    }
    let window_reference = reference;
    let lead = resolved_lead_time(task, tags, settings);
    if deadline.is_some_and(|at| at < now) {
        result.level = "overdue".into();
        reference = deadline.unwrap();
    }
    else if due.is_some_and(|at| at < now) {
        result.level = "target_missed".into();
        reference = deadline.or(due).unwrap();
    }
    let ratio = if lead == 0 {
        if reference == now { 0.0 } else if reference > now { f64::INFINITY } else { f64::NEG_INFINITY }
    } else {
        (reference - now).num_milliseconds() as f64 / 86_400_000.0 / lead as f64
    };
    if result.level == "none" {
        result.level = if ratio > 2.0 { "calm" } else if ratio > 1.0 { "notice" } else { "urgent" }.into();
    }
    result.slack_ratio = Some(ratio);
    result.reference = Some(reference.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    let begins = window_reference.with_timezone(&zone).naive_local().checked_sub_days(Days::new(lead)).map(|wall| local_instant(wall, zone));
    result.short_window = available.is_some_and(|at| begins.is_none_or(|begin| at > begin));
    result
}

pub fn compare(a: &Urgency, b: &Urgency) -> std::cmp::Ordering {
    fn rank(level: &str) -> u8 {
        match level { "overdue" => 5, "target_missed" => 4, "urgent" => 3, "notice" => 2, "calm" => 1, _ => 0 }
    }
    rank(&b.level).cmp(&rank(&a.level)).then_with(|| a.slack_ratio.unwrap_or(f64::INFINITY).total_cmp(&b.slack_ratio.unwrap_or(f64::INFINITY)))
}

pub fn local_zone() -> Tz {
    std::env::var("TZ").ok().and_then(|zone| zone.parse().ok()).unwrap_or(chrono_tz::Asia::Tokyo)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zero_leads_keep_infinite_slack_for_sorting() {
        let now = DateTime::parse_from_rfc3339("2026-10-04T00:00:00Z").unwrap().with_timezone(&Utc);
        let zero = calculate(&serde_yaml::from_str("deadline: 2026-10-01\nlead_time: 0d").unwrap(), &[], &Settings::default(), now, chrono_tz::Asia::Tokyo);
        let finite = calculate(&serde_yaml::from_str("deadline: 2026-10-01\nlead_time: 7d").unwrap(), &[], &Settings::default(), now, chrono_tz::Asia::Tokyo);
        assert_eq!(zero.slack_ratio, Some(f64::NEG_INFINITY));
        assert!(compare(&zero, &finite).is_lt());
        assert_eq!(serde_json::to_value(&zero).unwrap()["slack_ratio"], serde_json::Value::Null);
    }
    #[test]
    fn what_is_written_is_a_bare_date_or_a_datetime_carrying_its_offset() {
        for value in ["2026-10-04", "2026-10-04 10:00+09:00", "2026-10-04T10:00:00Z", "0100-01-01"] {
            assert!(is_written(value), "{value}");
        }
        for value in ["2026-10-04 10:00", "2026-10-04T10:00:00.5", "2026-02-30", "2026-10-04 24:00+09:00", ""] {
            assert!(!is_written(value), "{value}");
        }
        // Read by urgency, but not drawn, rung or edited as written: the calendar and the alarms
        // read no fraction of a second and no white space before a bare date, and an early year
        // as a later one, and the task editor's date field reads a space after a bare date as
        // midnight and a datetime in an early year as one in a later year.
        for value in ["2026-10-04T10:00:00.5Z", "2026-03-12T10:00:00.000+09:00", " 2026-12-01", "2026-12-01 ", "0050-01-01", "0050-01-01 10:00+09:00"] {
            assert!(!is_written(value), "{value:?}");
            assert!(instant(Some(&value.into()), chrono_tz::UTC, false).is_some(), "{value:?}");
        }
        for value in ["2026-10-04T10:00:00.5Z", "2026-03-12T10:00:00.000+09:00", " 2026-12-01"] {
            assert_eq!(crate::note_events::task_date_start(value, chrono_tz::UTC), None, "{value:?}");
        }
        let early = NaiveDate::from_ymd_opt(1950, 1, 1).unwrap();
        assert_eq!(crate::note_events::task_date_start("0050-01-01", chrono_tz::UTC), Some(crate::note_events::Start::Date(early)));
        // The calendar reads white space around a datetime carrying its offset, but a padded value
        // is refused all the same: nothing needs one.
        assert!(crate::note_events::task_date_start(" 2026-12-01 10:00+09:00", chrono_tz::UTC).is_some());
        assert!(!is_written(" 2026-12-01 10:00+09:00"));
        // What is not written so is still read, as the wall clock in the zone.
        let read = instant(Some(&"2026-10-04 10:00".into()), chrono_tz::America::New_York, true).unwrap();
        assert_eq!(read.to_rfc3339(), "2026-10-04T14:00:00+00:00");
    }

    #[test]
    fn shared_golden_fixtures() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!("../../fixtures/urgency/cases.json")).unwrap();
        for case in fixtures["cases"].as_array().unwrap() {
            let task: Value = serde_yaml::to_value(&case["task"]).unwrap();
            let tags: Vec<String> = serde_json::from_value(case["tags"].clone()).unwrap();
            let (settings, _) = read_settings(&serde_yaml::to_value(&case["settings"]).unwrap());
            let now = DateTime::parse_from_rfc3339(case["now"].as_str().unwrap()).unwrap().with_timezone(&Utc);
            let result = calculate(&task, &tags, &settings, now, case["zone"].as_str().unwrap().parse().unwrap());
            let expected: Urgency = serde_json::from_value(case["expected"].clone()).unwrap();
            assert_eq!(result.level, expected.level, "{}", case["name"]);
            assert_eq!(result.reference, expected.reference, "{}", case["name"]);
            assert_eq!(result.actionable, expected.actionable, "{}", case["name"]);
            assert_eq!(result.short_window, expected.short_window, "{}", case["name"]);
            match (result.slack_ratio, expected.slack_ratio) {
                (Some(a), Some(b)) => assert!((a - b).abs() < 1e-9, "{}: {a} != {b}", case["name"]),
                (Some(a), None) if !a.is_finite() => {},
                (a, b) => assert_eq!(a, b, "{}", case["name"]),
            }
        }
        for case in fixtures["importance"].as_array().unwrap() {
            assert_eq!(serde_json::to_value(importance(&serde_yaml::to_value(&case["value"]).unwrap())).unwrap(), case["expected"]);
        }
        for case in fixtures["grammar"].as_array().unwrap() {
            assert_eq!(serde_json::to_value(lead_time_days(&serde_yaml::to_value(&case["value"]).unwrap())).unwrap(), case["days"]);
        }
    }
}
