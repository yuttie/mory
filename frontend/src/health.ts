// What is wrong in the repository, gathered in one place.
//
// Each view reports the problems it meets in its own way and only while it is open: the calendar
// what lies in the months it draws, a note its own frontmatter, the settings their own files. A
// note no view happens to show can stay broken unnoticed. The checks here walk the whole listing
// instead, reusing the derivations the views draw from, so they report what those views would.

import Ajv from 'ajv';
import type { DefinedError } from 'ajv';

import type { AlarmDefaults } from '@/alarms';
import type { ListEntry2 } from '@/api';
import { eventsFromEntries, taskDatesFromEntries } from '@/events';
import type { EventCategories, EventError, EventWindow } from '@/events';
import metadataSchema from '@/metadata-schema.json';
import { isTaskPath, taskDirectoryOf, taskUuidOf } from '@/task-forest';

export type HealthSeverity = 'error' | 'warning';

export interface HealthProblem {
    severity: HealthSeverity;
    message: string;
    /// The file at fault, for a link to it; absent for one that is not a file of its own.
    path?: string;
}

const validateMetadata = new Ajv().compile(metadataSchema);

/// Describes a value from the frontmatter as it was written, whatever its type.
function describeValue(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined) {
        return '(missing)';
    }
    return JSON.stringify(value) ?? String(value);
}

// The listing stands a mapping holding `error` alone in for frontmatter moried could not read
// (`extract_metadata` in `backend/src/main.rs`).
function unreadableReason(metadata: unknown): string | null {
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
        return null;
    }
    const keys = Object.keys(metadata);
    const error = (metadata as Record<string, unknown>).error;
    return keys.length === 1 && typeof error === 'string' ? error : null;
}

/// Frontmatter that is not YAML, and frontmatter that `metadata-schema.json` refuses: what the note
/// view shows above one note, for every note.
export function frontmatterProblems(entries: readonly ListEntry2[]): HealthProblem[] {
    const problems: HealthProblem[] = [];
    for (const entry of entries) {
        if (entry.metadata === null) {
            continue;
        }
        const unreadable = unreadableReason(entry.metadata);
        if (unreadable !== null) {
            problems.push({ severity: 'error', message: `The frontmatter cannot be read: ${unreadable}`, path: entry.path });
            continue;
        }
        if (validateMetadata(entry.metadata)) {
            continue;
        }
        for (const error of validateMetadata.errors as DefinedError[]) {
            // Only says that none of the alternatives fit, which the errors of each already say.
            if (error.keyword === 'oneOf') {
                continue;
            }
            const detail = error.keyword === 'additionalProperties' ? `: ${error.params.additionalProperty}` : '';
            problems.push({
                severity: 'error',
                message: `${error.instancePath || '/'}: ${error.message ?? 'is invalid'}${detail}`,
                path: entry.path,
            });
        }
    }
    return problems;
}

/// The events and task dates the calendar would refuse within `window`. A series is expanded only
/// over the window, so a mistake that only an occurrence outside it meets is not found.
export function eventProblems(
    entries: readonly ListEntry2[],
    window: EventWindow,
    options: { categories?: EventCategories; alarmDefaults?: AlarmDefaults } = {},
): HealthProblem[] {
    const errors: EventError[] = [
        ...eventsFromEntries(entries, window, options).errors,
        ...taskDatesFromEntries(entries, window, { alarmDefaults: options.alarmDefaults }).errors,
    ];
    // A bad `end` on a series is met once per occurrence, and is one mistake to fix.
    const seen = new Set<string>();
    const problems: HealthProblem[] = [];
    for (const [property, value, eventName, path] of errors) {
        const message = `Invalid ${property} "${describeValue(value)}" of "${eventName}"`;
        const key = `${path}\0${message}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        problems.push({ severity: 'error', message, path });
    }
    return problems;
}

// What the older task model stored, which the task editor drops on its next save.
const LEGACY_TASK_KEYS = ['urgency', 'progress', 'scheduled_dates', 'start_at'];

/// Files under `.tasks/` the task tree leaves out or places other than where they are, and tasks
/// still holding the older model's keys.
export function taskProblems(entries: readonly ListEntry2[]): HealthProblem[] {
    const problems: HealthProblem[] = [];
    const covered = new Set<string>();
    for (const entry of entries) {
        const directory = taskDirectoryOf(entry.path);
        if (directory !== null) {
            covered.add(directory);
        }
    }
    for (const entry of entries) {
        // Only notes: an attachment beside a task is not meant to be one.
        if (!isTaskPath(entry.path) || !entry.path.endsWith('.md')) {
            continue;
        }
        if (taskUuidOf(entry.path) === null) {
            problems.push({
                severity: 'warning',
                message: 'Not in the task tree: every directory under .tasks/ must be a UUIDv4, and the file name must end with one.',
                path: entry.path,
            });
            continue;
        }
        const parent = entry.path.slice(0, entry.path.lastIndexOf('/'));
        if (parent !== '.tasks' && !covered.has(parent)) {
            problems.push({
                severity: 'warning',
                message: `Its parent task is missing, so it is shown at the top level: no task file covers ${parent}/.`,
                path: entry.path,
            });
        }
        const task = entry.metadata?.task;
        if (typeof task === 'object' && task !== null && !Array.isArray(task)) {
            const record = task as Record<string, unknown>;
            const legacy = LEGACY_TASK_KEYS.filter((key) => Object.hasOwn(record, key));
            if (typeof record.importance === 'number') {
                legacy.push('importance (as a number)');
            }
            if (legacy.length > 0) {
                problems.push({
                    severity: 'warning',
                    message: `Holds keys of the older task model, which are ignored and dropped on the next save: ${legacy.join(', ')}.`,
                    path: entry.path,
                });
            }
        }
    }
    return problems;
}
