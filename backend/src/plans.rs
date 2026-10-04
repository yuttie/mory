//! Ordered execution records, kept in Git as one YAML file per month.
use std::collections::{BTreeMap, BTreeSet};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Origin { Planned, Interruption }
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Outcome { Worked, Missed }
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
    let date = NaiveDate::parse_from_str(text, "%Y-%m-%d").map_err(|_| "Use a valid date in YYYY-MM-DD format.".to_owned())?;
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
    fn plans_preserve_order_history_and_unknown_references() {
        let mut plan = Month::new();
        put(&mut plan, "2026-10-05", UUID, Origin::Planned);
        put(&mut plan, "2026-10-05", UUID, Origin::Interruption);
        assert_eq!(plan["2026-10-05"].len(), 1);
        assert_eq!(plan["2026-10-05"][0].result, None);
        put(&mut plan, "2026-10-06", UUID, Origin::Interruption);
        assert_eq!(plan["2026-10-06"][0].result, Some(Outcome::Worked));
        let text = serde_yaml::to_string(&plan).unwrap();
        assert_eq!(read(&text, "2026-10").unwrap(), plan);
        assert!(read(&text, "2026-11").is_err());
    }
    #[test]
    fn malformed_plans_are_refused_instead_of_dropped() {
        for day in ["2026-02-30", "2026-8-9", "../../foo", "2026-13-01"] {
            assert!(date(day).is_err());
        }
        for entries in [format!("- task: {UUID}\n  origin: planned\n  extra: x"), format!("- task: {UUID}\n  origin: planned\n  result: null"), format!("- task: {UUID}\n  origin: planned\n- task: {UUID}\n  origin: planned"), "- task: bad\n  origin: planned".into()] {
            let text = format!("2026-10-05:\n{}", entries.lines().map(|line| format!("    {line}\n")).collect::<String>());
            assert!(read(&text, "2026-10").is_err(), "{text}");
        }
    }
}
