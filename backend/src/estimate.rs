//! How long a task takes to work on, as `task.estimate` writes it: the Rust twin of
//! `estimateMinutes` in `frontend/src/estimate.ts`, for refusing an MCP write of one the web app
//! does not read. `fixtures/urgency/estimates.json` holds the two to each other.
use std::sync::LazyLock;
use regex::Regex;
use serde_yaml::Value;

static ESTIMATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:([0-9]+) *h)? *(?:([0-9]+) *m)?$").unwrap());

/// The minutes an estimate names: hours, minutes, or both (`3h`, `90m`, `1h 30m`).
pub fn estimate_minutes(value: &Value) -> Option<u64> {
    let parts = ESTIMATE.captures(value.as_str()?.trim())?;
    if parts.get(1).is_none() && parts.get(2).is_none() {
        return None;
    }
    let amount = |index: usize| parts.get(index).map_or(Some(0), |digits| digits.as_str().parse::<u64>().ok());
    let minutes = amount(1)?.checked_mul(60)?.checked_add(amount(2)?)?;
    // What JavaScript holds exactly, as the web app refuses the rest.
    (minutes <= 9_007_199_254_740_991).then_some(minutes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_estimate_as_the_web_app_does() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!("../../fixtures/urgency/estimates.json")).unwrap();
        for case in fixtures.as_array().unwrap() {
            assert_eq!(
                serde_json::to_value(estimate_minutes(&serde_yaml::to_value(&case["value"]).unwrap())).unwrap(),
                case["minutes"],
                "{}", case["value"],
            );
        }
    }
}
