use std::collections::{BTreeMap, BTreeSet};
use rmcp::{model::CallToolResult, ErrorData};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use crate::models::{AppState, ListEntry};
use crate::plans::{self, Month, Origin, Outcome};
use super::{json_result, tool_error};

/// A task a plan names, as `list_plan` reports it: enough to read it or act on it without first
/// paging through `list_tasks` for the UUID.
#[derive(Debug, PartialEq, Serialize)]
struct PlannedTask {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
}

/// Every task in the tree, keyed by the UUID its file name ends with. The web app finds a task by
/// its path alone, so a note there without a `task:` block is still one a plan can name.
fn known_tasks(entries: &[ListEntry]) -> BTreeMap<String, PlannedTask> {
    entries.iter().filter_map(|entry| {
        let path = entry.path.to_string_lossy();
        if !crate::tasks::in_task_tree(&path) { return None; }
        let stem = path.strip_suffix(".md")?;
        let tail = stem.get(stem.len().checked_sub(36)?..)?;
        let uuid = plans::task_uuid(tail).ok()?;
        let task = PlannedTask {
            path: path.into_owned(),
            title: entry.title.clone(),
            status: crate::tasks::task_status_of(entry.metadata.as_ref()),
        };
        Some((uuid, task))
    }).collect()
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ListArgs {
    /// The first day, `YYYY-MM-DD`.
    pub start: String,
    /// The last day, `YYYY-MM-DD`, included.
    pub end: String,
}

pub async fn list_plan(state: &AppState, args: ListArgs) -> Result<CallToolResult, ErrorData> {
    let (from, to) = match (plans::date(&args.start), plans::date(&args.end)) {
        (Ok(from), Ok(to)) if from <= to => (from, to),
        _ => return Ok(tool_error("Use valid YYYY-MM-DD start and end, with start <= end.")),
    };
    let (commit, entries) = state.get_entries(None).await.map_err(|error| ErrorData::internal_error(error.to_string(), None))?;
    let mut known = known_tasks(&entries);
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
                        if !known.contains_key(&item.task) {
                            warnings.push(format!("Unknown task {} on {day}.", item.task));
                        }
                    }
                    days.insert(day, list);
                }
            },
            Err(error) => warnings.push(format!("{path}: {error}")),
        }
    }
    let planned = days.values().flatten().map(|item| item.task.as_str()).collect::<BTreeSet<_>>();
    known.retain(|uuid, _| planned.contains(uuid.as_str()));
    #[derive(Serialize)]
    struct Output { commit: String, days: Month, tasks: BTreeMap<String, PlannedTask>, warnings: Vec<String> }
    json_result(&Output { commit: commit.to_string(), days, tasks: known, warnings })
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PlanArgs {
    /// The day, `YYYY-MM-DD`.
    pub date: String,
    /// The UUIDv4 the task's file name ends with, which stays the same when the task is moved
    /// or renamed: `.tasks/report-<uuid>.md` is `<uuid>`.
    pub task: String,
    /// `planned`, or `interruption` for work that came up unplanned, which is recorded as worked.
    pub origin: Origin,
}
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ResultArgs {
    /// The day, `YYYY-MM-DD`.
    pub date: String,
    /// The task's UUIDv4, as `plan_task` takes it.
    pub task: String,
    /// `worked` or `missed`. Omit, or pass null, to make the entry unrecorded again.
    #[serde(default)]
    pub result: Option<Outcome>,
}
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UnplanArgs {
    /// The day, `YYYY-MM-DD`.
    pub date: String,
    /// The task's UUIDv4, as `plan_task` takes it.
    pub task: String,
}

async fn edit(state: &AppState, day: &str, task: &str, mutation: impl FnOnce(&mut Month, &str) -> Result<(), String>) -> Result<CallToolResult, ErrorData> {
    if let Err(error) = plans::date(day) { return Ok(tool_error(error)); }
    let uuid = match plans::task_uuid(task) { Ok(uuid) => uuid, Err(error) => return Ok(tool_error(error)) };
    let month = &day[..7];
    let path = format!(".mory/plans/{month}.yaml");
    let blob = crate::find_entry_blob(state, &path).await;
    let expected = blob.as_ref().map(|(oid, _)| format!("\"{oid}\"")).unwrap_or_else(|| "absent".into());
    let plan = match blob {
        Some((_, bytes)) => match String::from_utf8(bytes).map_err(|error| error.to_string()).and_then(|text| plans::read(&text, month)) {
            Ok(plan) => plan,
            Err(error) => return Ok(tool_error(format!("{path} is invalid; fix it before writing: {error}"))),
        },
        None => Month::new(),
    };
    let plan = match edited(plan, day, &uuid, mutation) { Ok(plan) => plan, Err(error) => return Ok(tool_error(error)) };
    let content = plans::write(&plan);
    let (_, entries) = state.get_entries(Some(".tasks/*")).await.map_err(|error| ErrorData::internal_error(error.to_string(), None))?;
    let unknown = !known_tasks(&entries).contains_key(&uuid);
    match state.save_note_checked(&path, content.as_bytes(), &format!("Update plan for {day}"), &expected).await {
        Ok(Some(commit)) => json_result(&serde_json::json!({ "path": path, "commit": commit.to_string(), "entries": plan.get(day), "unknown_task": unknown })),
        Ok(None) => Ok(tool_error("The plan changed during this edit; read it again and retry.")),
        Err(error) => Ok(tool_error(format!("The plan could not be written: {error}"))),
    }
}

/// The month as `mutation` leaves it, refused when that is the month it was: Git would take the
/// unchanged file as a commit of its own, and a month with no file would gain one holding `{}`.
fn edited(mut plan: Month, day: &str, uuid: &str, mutation: impl FnOnce(&mut Month, &str) -> Result<(), String>) -> Result<Month, String> {
    let before = plan.clone();
    mutation(&mut plan, uuid)?;
    if plan == before {
        return Err(format!("The plan for {day} already says that, so nothing was committed."));
    }
    Ok(plan)
}

pub async fn plan_task(state: &AppState, args: PlanArgs) -> Result<CallToolResult, ErrorData> {
    edit(state, &args.date, &args.task, |plan, uuid| { plan_entry(plan, &args.date, uuid, args.origin); Ok(()) }).await
}
pub async fn record_result(state: &AppState, args: ResultArgs) -> Result<CallToolResult, ErrorData> {
    edit(state, &args.date, &args.task, |plan, uuid| record_entry(plan, &args.date, uuid, args.result)).await
}
pub async fn unplan_task(state: &AppState, args: UnplanArgs) -> Result<CallToolResult, ErrorData> {
    edit(state, &args.date, &args.task, |plan, uuid| unplan_entry(plan, &args.date, uuid)).await
}

fn record_entry(plan: &mut Month, day: &str, uuid: &str, result: Option<Outcome>) -> Result<(), String> {
    let entry = plan.get_mut(day).and_then(|entries| entries.iter_mut().find(|entry| entry.task == uuid));
    let Some(entry) = entry else { return Err("This task is not planned on that date.".into()); };
    // An interruption is work that came up and was done, so the web app offers Missed only for a
    // planned entry.
    if entry.origin == Origin::Interruption && result == Some(Outcome::Missed) {
        return Err("An interruption was worked on by definition; `missed` is for a planned entry. Use unplan_task if it did not happen.".into());
    }
    entry.result = result;
    Ok(())
}

fn unplan_entry(plan: &mut Month, day: &str, uuid: &str) -> Result<(), String> {
    let entries = plan.get_mut(day).filter(|entries| entries.iter().any(|entry| entry.task == uuid));
    let Some(entries) = entries else { return Err("This task is not planned on that date.".into()); };
    entries.retain(|entry| entry.task != uuid);
    Ok(())
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
    fn a_planned_task_is_named_by_the_uuid_its_file_name_ends_with() {
        let uuid = "4955857d-3267-4b94-83f2-538a428970d7";
        let other = "2a997a71-0d2b-4938-b8ff-5178c28a5ad9";
        let entries = [
            ListEntry {
                title: Some("Report".to_owned()),
                ..ListEntry::note(&format!(".tasks/report-{uuid}.md"), "task: {status: {kind: todo}}")
            },
            // Not in the task tree, so not a task a plan can name.
            ListEntry::note(&format!("notes/{uuid}.md"), "task: {status: {kind: todo}}"),
            // In the tree without a block: the web app lists it, untitled and with no status.
            ListEntry::note(&format!(".tasks/{uuid}/draft-{other}.md"), "created_at: 2026-10-01"),
        ];
        let known = known_tasks(&entries);
        assert_eq!(known.len(), 2);
        assert_eq!(known[other], PlannedTask { path: format!(".tasks/{uuid}/draft-{other}.md"), title: None, status: None });
        assert_eq!(known[uuid], PlannedTask {
            path: format!(".tasks/report-{uuid}.md"),
            title: Some("Report".to_owned()),
            status: Some("todo".to_owned()),
        });
    }

    #[test]
    fn an_edit_that_changes_nothing_is_refused() {
        let uuid = "4955857d-3267-4b94-83f2-538a428970d7";
        let day = "2026-10-05";
        let mut plan = Month::new();
        plans::put(&mut plan, day, uuid, Origin::Planned);
        let unchanged = |result: Result<Month, String>| result.expect_err("nothing changed").contains("nothing was committed");
        assert!(unchanged(edited(plan.clone(), day, uuid, |plan, uuid| { plan_entry(plan, day, uuid, Origin::Planned); Ok(()) })));
        assert!(unchanged(edited(plan.clone(), day, uuid, |plan, uuid| record_entry(plan, day, uuid, None))));
        // Taking off what is not there names why, rather than committing the month as it was.
        let absent = edited(Month::new(), day, uuid, |plan, uuid| unplan_entry(plan, day, uuid));
        assert_eq!(absent, Err("This task is not planned on that date.".to_owned()));
        let elsewhere = edited(plan.clone(), "2026-10-06", uuid, |plan, uuid| unplan_entry(plan, "2026-10-06", uuid));
        assert_eq!(elsewhere, Err("This task is not planned on that date.".to_owned()));
        let recorded = edited(plan.clone(), day, uuid, |plan, uuid| record_entry(plan, day, uuid, Some(Outcome::Worked))).unwrap();
        assert_eq!(recorded[day][0].result, Some(Outcome::Worked));
        assert_eq!(edited(plan, day, uuid, |plan, uuid| unplan_entry(plan, day, uuid)).unwrap()[day], vec![]);
    }

    #[test]
    fn an_interruption_is_not_missed() {
        let uuid = "4955857d-3267-4b94-83f2-538a428970d7";
        let day = "2026-10-05";
        let mut plan = Month::new();
        plans::put(&mut plan, day, uuid, Origin::Interruption);
        assert!(record_entry(&mut plan, day, uuid, Some(Outcome::Missed)).unwrap_err().contains("planned entry"));
        assert_eq!(plan[day][0].result, Some(Outcome::Worked));
        record_entry(&mut plan, day, uuid, None).unwrap();
        assert_eq!(plan[day][0].result, None);
    }

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
