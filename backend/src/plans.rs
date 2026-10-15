//! Ordered execution records, kept in Git as one YAML file per month.
use std::collections::{BTreeMap, BTreeSet};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Origin { Planned, Interruption }
impl Origin {
    fn text(&self) -> &'static str {
        match self { Self::Planned => "planned", Self::Interruption => "interruption" }
    }
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Outcome { Worked, Missed }
impl Outcome {
    fn text(&self) -> &'static str {
        match self { Self::Worked => "worked", Self::Missed => "missed" }
    }
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub task: String,
    pub origin: Origin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Outcome>,
}
pub type Month = BTreeMap<String, Vec<Entry>>;

pub fn date(text: &str) -> Result<NaiveDate, String> {
    // `%Y` also takes a sign and a fifth digit, and a month named from such a day is a file
    // name neither side reads back; `isPlanDate` holds the web app to the same ten characters.
    let shaped = text.len() == 10 && text.bytes().enumerate().all(|(index, byte)| if index == 4 || index == 7 { byte == b'-' } else { byte.is_ascii_digit() });
    let date = NaiveDate::parse_from_str(text, "%Y-%m-%d").ok().filter(|_| shaped).ok_or_else(|| "Use a valid date in YYYY-MM-DD format.".to_owned())?;
    if date.format("%Y-%m-%d").to_string() != text {
        return Err("Use a valid date in YYYY-MM-DD format.".into());
    }
    Ok(date)
}

pub fn task_uuid(text: &str) -> Result<String, String> {
    let uuid = uuid::Uuid::parse_str(text).map_err(|_| "A task reference must be a UUIDv4.".to_owned())?;
    if uuid.get_version() != Some(uuid::Version::Random) || uuid.get_variant() != uuid::Variant::RFC4122 || text.len() != 36 {
        return Err("A task reference must be a UUIDv4.".into());
    }
    Ok(uuid.to_string())
}

pub fn read(text: &str, month: &str) -> Result<Month, String> {
    let parsed: serde_yaml::Value = serde_yaml::from_str(text).map_err(|error| error.to_string())?;
    if let Some(days) = parsed.as_mapping() {
        // `serde_yaml` reads a null as an empty list, which `readPlan` refuses.
        if let Some((day, _)) = days.iter().find(|(_, entries)| entries.is_null()) {
            return Err(format!("Invalid plan day {} in {month}.", day.as_str().unwrap_or("?")));
        }
        for entries in days.values().filter_map(serde_yaml::Value::as_sequence) {
            for entry in entries {
                if entry.get("result").is_some_and(serde_yaml::Value::is_null) {
                    return Err("Omit result for an unrecorded entry; null is not a result.".into());
                }
            }
        }
    }
    let mut plan: Month = if parsed.is_null() { Month::new() } else { serde_yaml::from_value(parsed).map_err(|error| error.to_string())? };
    for (day, entries) in &mut plan {
        date(day)?;
        if !day.starts_with(&format!("{month}-")) {
            return Err(format!("Plan day {day} does not belong to {month}."));
        }
        let mut seen = BTreeSet::new();
        for entry in entries {
            entry.task = task_uuid(&entry.task)?;
            if !seen.insert(entry.task.clone()) {
                return Err(format!("Duplicate task {} on {day}.", entry.task));
            }
        }
    }
    Ok(plan)
}

/// A month as the web app writes it: days in date order, entries in theirs, under the four-space
/// indent `YAML.stringify` gives a sequence. `serde_yaml` puts a sequence's items at its key's
/// column instead, so each side rewrote the whole file after the other had touched it.
/// `fixtures/plans/written.json` holds this to `writePlan` in `frontend/src/plans.ts`.
///
/// Written by hand because every value is one `read` accepts -- a date, a UUID, or one of the two
/// enums -- and each of those is a plain scalar that needs no quoting.
pub fn write(plan: &Month) -> String {
    if plan.is_empty() {
        return "{}\n".to_owned();
    }
    let mut text = String::new();
    for (day, entries) in plan {
        if entries.is_empty() {
            text.push_str(&format!("{day}: []\n"));
            continue;
        }
        text.push_str(&format!("{day}:\n"));
        for entry in entries {
            text.push_str(&format!("    - task: {}\n", entry.task));
            text.push_str(&format!("      origin: {}\n", entry.origin.text()));
            if let Some(result) = &entry.result {
                text.push_str(&format!("      result: {}\n", result.text()));
            }
        }
    }
    text
}

pub fn put(plan: &mut Month, day: &str, task: &str, origin: Origin) {
    let entries = plan.entry(day.into()).or_default();
    if !entries.iter().any(|entry| entry.task == task) {
        let result = (origin == Origin::Interruption).then_some(Outcome::Worked);
        entries.push(Entry { task: task.into(), origin, result });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const UUID: &str = "4955857d-3267-4b94-83f2-538a428970d7";
    #[test]
    fn shared_validation_fixtures() {
        let cases: serde_json::Value = serde_json::from_str(include_str!("../../fixtures/plans/cases.json")).unwrap();
        for case in cases.as_array().unwrap() {
            assert_eq!(read(case["yaml"].as_str().unwrap(), "2026-10").is_ok(), case["valid"].as_bool().unwrap(), "{}", case["name"]);
        }
    }
    #[test]
    fn shared_writing_fixtures() {
        let cases: serde_json::Value = serde_json::from_str(include_str!("../../fixtures/plans/written.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let plan: Month = serde_json::from_value(case["plan"].clone()).unwrap();
            let yaml = case["yaml"].as_str().unwrap();
            assert_eq!(write(&plan), yaml, "{}", case["name"]);
            assert_eq!(read(yaml, "2026-10").unwrap(), plan, "{}", case["name"]);
        }
    }
    #[test]
    fn plans_preserve_order_history_and_unknown_references() {
        let mut plan = Month::new();
        put(&mut plan, "2026-10-05", UUID, Origin::Planned);
        put(&mut plan, "2026-10-05", UUID, Origin::Interruption);
        assert_eq!(plan["2026-10-05"].len(), 1);
        assert_eq!(plan["2026-10-05"][0].result, None);
        put(&mut plan, "2026-10-06", UUID, Origin::Interruption);
        assert_eq!(plan["2026-10-06"][0].result, Some(Outcome::Worked));
        let text = write(&plan);
        assert_eq!(read(&text, "2026-10").unwrap(), plan);
        assert!(read(&text, "2026-11").is_err());
    }
    #[test]
    fn malformed_plans_are_refused_instead_of_dropped() {
        for day in ["2026-02-30", "2026-8-9", "../../foo", "2026-13-01", "+12026-10-05", "-0001-10-05", "+2026-10-05"] {
            assert!(date(day).is_err());
        }
        for entries in [format!("- task: {UUID}\n  origin: planned\n  extra: x"), format!("- task: {UUID}\n  origin: planned\n  result: null"), format!("- task: {UUID}\n  origin: planned\n- task: {UUID}\n  origin: planned"), "- task: bad\n  origin: planned".into()] {
            let text = format!("2026-10-05:\n{}", entries.lines().map(|line| format!("    {line}\n")).collect::<String>());
            assert!(read(&text, "2026-10").is_err(), "{text}");
        }
    }
}
