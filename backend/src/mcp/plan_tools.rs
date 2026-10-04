use std::collections::{BTreeMap, BTreeSet};
use rmcp::{model::CallToolResult, ErrorData};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use crate::models::{AppState, ListEntry};
use crate::plans::{self, Month, Origin, Outcome};
use super::{json_result, tool_error};

fn known_tasks(entries: &[ListEntry]) -> BTreeSet<String> {
    entries.iter().filter_map(|entry| {
        let (path, _) = crate::tasks::task_of(entry)?;
        let stem = path.strip_suffix(".md")?;
        let tail = stem.get(stem.len().checked_sub(36)?..)?;
        plans::task_uuid(tail).ok()
    }).collect()
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ListArgs { pub start: String, pub end: String }

pub async fn list_plan(state: &AppState, args: ListArgs) -> Result<CallToolResult, ErrorData> {
    let (from, to) = match (plans::date(&args.start), plans::date(&args.end)) {
        (Ok(from), Ok(to)) if from <= to => (from, to),
        _ => return Ok(tool_error("Use valid YYYY-MM-DD start and end, with start <= end.")),
    };
    let (commit, entries) = state.get_entries(None).await.map_err(|error| ErrorData::internal_error(error.to_string(), None))?;
    let known = known_tasks(&entries);
    let mut days = BTreeMap::new();
    let mut warnings = Vec::new();
    for entry in &entries {
        let path = entry.path.to_string_lossy();
        let Some(month) = path.strip_prefix(".mory/plans/").and_then(|path| path.strip_suffix(".yaml")) else { continue; };
        if month.len() != 7 || month < &args.start[..7] || month > &args.end[..7] { continue; }
        let Some((_, bytes)) = crate::find_entry_blob(state, &path).await else { continue; };
        let parsed = String::from_utf8(bytes).map_err(|error| error.to_string()).and_then(|text| plans::read(&text, month));
        match parsed {
            Ok(plan) => {
                for (day, list) in plan {
                    let date = plans::date(&day).unwrap();
                    if date < from || date > to { continue; }
                    for item in &list {
                        if !known.contains(&item.task) {
                            warnings.push(format!("Unknown task {} on {day}.", item.task));
                        }
                    }
                    days.insert(day, list);
                }
            },
            Err(error) => warnings.push(format!("{path}: {error}")),
        }
    }
    #[derive(Serialize)]
    struct Output { commit: String, days: Month, warnings: Vec<String> }
    json_result(&Output { commit: commit.to_string(), days, warnings })
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PlanArgs {
    pub date: String,
    /// The UUID at the end of the task filename, stable across moves.
    pub task: String,
    pub origin: Origin,
}
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ResultArgs {
    pub date: String,
    pub task: String,
    /// worked or missed; omit or null to clear to unrecorded.
    #[serde(default)]
    pub result: Option<Outcome>,
}
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UnplanArgs { pub date: String, pub task: String }

async fn edit(state: &AppState, day: &str, task: &str, mutation: impl FnOnce(&mut Month, &str) -> Result<(), String>) -> Result<CallToolResult, ErrorData> {
    if let Err(error) = plans::date(day) { return Ok(tool_error(error)); }
    let uuid = match plans::task_uuid(task) { Ok(uuid) => uuid, Err(error) => return Ok(tool_error(error)) };
    let month = &day[..7];
    let path = format!(".mory/plans/{month}.yaml");
    let blob = crate::find_entry_blob(state, &path).await;
    let expected = blob.as_ref().map(|(oid, _)| format!("\"{oid}\"")).unwrap_or_else(|| "absent".into());
    let mut plan = match blob {
        Some((_, bytes)) => match String::from_utf8(bytes).map_err(|error| error.to_string()).and_then(|text| plans::read(&text, month)) {
            Ok(plan) => plan,
            Err(error) => return Ok(tool_error(format!("{path} is invalid; fix it before writing: {error}"))),
        },
        None => Month::new(),
    };
    if let Err(error) = mutation(&mut plan, &uuid) { return Ok(tool_error(error)); }
    let content = serde_yaml::to_string(&plan).map_err(|error| ErrorData::internal_error(error.to_string(), None))?;
    let (_, entries) = state.get_entries(Some(".tasks/*")).await.map_err(|error| ErrorData::internal_error(error.to_string(), None))?;
    let unknown = !known_tasks(&entries).contains(&uuid);
    match state.save_note_checked(&path, content.as_bytes(), &format!("Update plan for {day}"), &expected).await {
        Ok(Some(commit)) => json_result(&serde_json::json!({ "path": path, "commit": commit.to_string(), "entries": plan.get(day), "unknown_task": unknown })),
        Ok(None) => Ok(tool_error("The plan changed during this edit; read it again and retry.")),
        Err(error) => Ok(tool_error(format!("The plan could not be written: {error}"))),
    }
}

pub async fn plan_task(state: &AppState, args: PlanArgs) -> Result<CallToolResult, ErrorData> {
    edit(state, &args.date, &args.task, |plan, uuid| { plan_entry(plan, &args.date, uuid, args.origin); Ok(()) }).await
}
pub async fn record_result(state: &AppState, args: ResultArgs) -> Result<CallToolResult, ErrorData> {
    edit(state, &args.date, &args.task, |plan, uuid| {
        let entry = plan.get_mut(&args.date).and_then(|entries| entries.iter_mut().find(|entry| entry.task == uuid));
        match entry { Some(entry) => { entry.result = args.result; Ok(()) }, None => Err("This task is not planned on that date.".into()) }
    }).await
}
pub async fn unplan_task(state: &AppState, args: UnplanArgs) -> Result<CallToolResult, ErrorData> {
    edit(state, &args.date, &args.task, |plan, uuid| {
        if let Some(entries) = plan.get_mut(&args.date) { entries.retain(|entry| entry.task != uuid); }
        Ok(())
    }).await
}

// Recording an interruption also records work when the day already contains the task.
fn plan_entry(plan: &mut Month, day: &str, uuid: &str, origin: Origin) {
    let worked = origin == Origin::Interruption;
    plans::put(plan, day, uuid, origin);
    if worked {
        if let Some(entry) = plan.get_mut(day).and_then(|entries| entries.iter_mut().find(|entry| entry.task == uuid)) {
            entry.result = Some(Outcome::Worked);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plans::Entry;

    #[test]
    fn mcp_interruption_records_work_without_changing_existing_origin_or_order() {
        let uuid = "4955857d-3267-4b94-83f2-538a428970d7";
        let other = "2a997a71-0d2b-4938-b8ff-5178c28a5ad9";
        let day = "2026-10-05";
        for result in [None, Some(Outcome::Missed)] {
            let mut plan = Month::new();
            plans::put(&mut plan, day, other, Origin::Planned);
            plans::put(&mut plan, day, uuid, Origin::Planned);
            plan.get_mut(day).unwrap()[1].result = result.clone();
            plan_entry(&mut plan, day, uuid, Origin::Planned);
            assert_eq!(plan[day][1].result, result);
            plan_entry(&mut plan, day, uuid, Origin::Interruption);
            plan_entry(&mut plan, day, uuid, Origin::Interruption);
            assert_eq!(plan[day], vec![
                Entry { task: other.into(), origin: Origin::Planned, result: None },
                Entry { task: uuid.into(), origin: Origin::Planned, result: Some(Outcome::Worked) },
            ]);
        }
    }
}
