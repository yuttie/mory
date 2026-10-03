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
    static DATETIME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})$").unwrap());
    let parts = DATETIME.captures(text)?;
    if parts[1].parse::<u8>().ok()? > 23 || parts[2].parse::<u8>().ok()? > 59 || parts.get(3).is_some_and(|seconds| seconds.as_str().parse::<u8>().is_ok_and(|value| value > 59)) {
        return None;
    }
    let written = if parts.get(3).is_none() { format!("{}:00{}", &text[..16], &parts[4]) } else { text.to_owned() };
    DateTime::parse_from_rfc3339(&written.replace(' ', "T")).ok().map(|dt| dt.with_timezone(&Utc))
}

pub fn calculate(task: &Value, tags: &[String], settings: &Settings, now: DateTime<Utc>, zone: Tz) -> Urgency {
    let due = instant(task.get("due_by"), zone, true);
    let deadline = instant(task.get("deadline"), zone, true);
    let available = instant(task.get("available_from").or_else(|| task.get("start_at")), zone, false);
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
    let begins = reference.with_timezone(&zone).naive_local().checked_sub_days(Days::new(lead)).map(|wall| local_instant(wall, zone));
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
