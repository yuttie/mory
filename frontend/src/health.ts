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
import { taskInstant } from '@/urgency';

export type HealthSeverity = 'error' | 'warning';

export interface HealthProblem {
    severity: HealthSeverity;
    message: string;
    /// The file at fault, for a link to it; absent for one that is not a file of its own.
    path?: string;
}

/// One thing verified, said as what holds when it passes, so a check without problems reads as a
/// statement of what was found true.
export interface HealthCheck {
    id: string;
    title: string;
    /// What is verified and why it matters, for a reader wondering what an OK covers.
    description: string;
    problems: HealthProblem[];
}

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

// `verbose` hands each error the value it is about, for a message to quote, and `allErrors` names
// every property at fault rather than the first.
const ajv = new Ajv({ verbose: true, allErrors: true });
const validateMetadata = ajv.compile(metadataSchema);

const definitions = metadataSchema.definitions as Record<string, { oneOf?: { $ref: string }[]; properties?: { kind?: { const?: string } } }>;

// Each status kind's own schema. A status is one of eight alternatives, told apart by `kind`, and
// Ajv reports how the value fails every one of them: a `done` missing `completed_at` came out as
// nine lines, most about other kinds. Checked against the one its kind names, it is one line.
const statusValidators = new Map((definitions['task-status'].oneOf ?? []).map(({ $ref }) => [
    definitions[$ref.slice('#/definitions/'.length)].properties?.kind?.const ?? '',
    ajv.compile({ definitions, $ref }),
]));

// A message for a schema error, without the path it is at.
function schemaMessage(error: DefinedError): string {
    switch (error.keyword) {
        // A pattern is a regular expression no reader should have to parse, such as the alarm
        // grammar's: the value it refused says more.
        case 'pattern':
            return `is not in the form it should be: "${describeValue(error.data)}"`;
        case 'additionalProperties':
            return `must not have ${error.params.additionalProperty}`;
        case 'enum':
            return `must be one of ${error.params.allowedValues.join(', ')}`;
        default:
            return error.message ?? 'is invalid';
    }
}

function isAtOrUnder(path: string, at: string): boolean {
    return path === at || path.startsWith(`${at}/`);
}

// The errors as a reader needs them, by path.
//
// Where a value may take one of several shapes, Ajv reports how it fails each: `tags: a` must be
// null, must be an array. Branches through a `$ref` cannot be traced back to their `oneOf` by schema
// path, so they are told apart by where they are: a type mismatch at the alternatives' own path is
// a shape the value did not take, and when some other error sits there or below, the value did take
// one and that error says what is wrong with it. When only type mismatches are left, they become
// one line naming the shapes. An `anyOf` of required keys becomes one line naming them. `known`
// are errors found apart from these, which count as being below an alternative as these do.
function readableErrors(
    errors: readonly DefinedError[],
    known: readonly { at: string }[] = [],
): { at: string; message: string }[] {
    const dropped = new Set<DefinedError>();
    const added: { at: string; message: string }[] = [];
    for (const alternative of errors) {
        if (alternative.keyword !== 'oneOf' && alternative.keyword !== 'anyOf') {
            continue;
        }
        dropped.add(alternative);
        const at = alternative.instancePath;
        const branches = errors.filter((error) => error.schemaPath.startsWith(`${alternative.schemaPath}/`));
        if (branches.length > 0 && branches.every((error) => error.keyword === 'required')) {
            branches.forEach((error) => dropped.add(error));
            const keys = branches.map((error) => (error.keyword === 'required' ? error.params.missingProperty : ''));
            added.push({ at, message: `must have one of ${keys.join(', ')}` });
            continue;
        }
        const types = errors.filter((error) => error.keyword === 'type' && error.instancePath === at);
        types.forEach((error) => dropped.add(error));
        // What an alternative within this one became counts as well, whichever was met first.
        const deeper = errors.some((error) => !dropped.has(error) && isAtOrUnder(error.instancePath, at))
            || [...added, ...known].some((error) => isAtOrUnder(error.at, at));
        if (!deeper && types.length > 0) {
            const names = [...new Set(types.map((error) => (error.keyword === 'type' ? String(error.params.type) : '')))];
            // Null is how an empty value reads, which says nothing about what to write.
            const shapes = names.length > 1 ? names.filter((name) => name !== 'null') : names;
            added.push({ at, message: `must be ${shapes.join(' or ')}` });
        }
    }
    return [
        ...errors.filter((error) => !dropped.has(error)).map((error) => ({ at: error.instancePath, message: schemaMessage(error) })),
        ...added,
    ];
}

// A task's status checked against the schema its kind names, or `null` when there is no status to
// check: no task, or a task without one, which the whole schema reports as missing.
function statusErrors(metadata: unknown): { at: string; message: string }[] | null {
    const task = (metadata as Record<string, unknown>).task;
    if (typeof task !== 'object' || task === null || Array.isArray(task) || !Object.hasOwn(task, 'status')) {
        return null;
    }
    const status: unknown = (task as Record<string, unknown>).status;
    const at = '/task/status';
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
        return [{ at, message: 'must be a mapping with a kind' }];
    }
    const kind: unknown = (status as Record<string, unknown>).kind;
    const validate = typeof kind === 'string' ? statusValidators.get(kind) : undefined;
    if (validate === undefined) {
        return [{ at: `${at}/kind`, message: `must be one of ${[...statusValidators.keys()].join(', ')}` }];
    }
    if (validate(status)) {
        return [];
    }
    return readableErrors(validate.errors as DefinedError[]).map((error) => ({ at: at + error.at, message: error.message }));
}

function isLegacyTaskKey(error: DefinedError): boolean {
    if (error.keyword === 'additionalProperties' && error.instancePath === '/task') {
        return LEGACY_TASK_KEYS.includes(error.params.additionalProperty);
    }
    return error.instancePath === '/task/importance' && typeof error.data === 'number';
}

/// What `metadata-schema.json` finds wrong with a note's frontmatter, one line per mistake.
function schemaProblems(metadata: unknown): string[] {
    if (validateMetadata(metadata)) {
        return [];
    }
    // The older task model's keys are the task-model check's: the schema refuses them, but the app
    // still reads some, and one mistake is reported once.
    let errors = (validateMetadata.errors as DefinedError[]).filter((error) => !isLegacyTaskKey(error));
    // They are still why the task is refused, and the `oneOf` around it must not read as though
    // nothing below it were wrong.
    const legacy = (validateMetadata.errors as DefinedError[]).filter(isLegacyTaskKey).map((error) => ({ at: error.instancePath }));
    const status = statusErrors(metadata);
    if (status !== null) {
        errors = errors.filter((error) => !isAtOrUnder(error.instancePath, '/task/status'));
    }
    const lines = [...readableErrors(errors, [...legacy, ...(status ?? [])]), ...(status ?? [])].map(({ at, message }) => `${at || '/'}: ${message}`);
    return [...new Set(lines)];
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
export function frontmatterChecks(entries: readonly ListEntry2[]): HealthCheck[] {
    const unreadable: HealthProblem[] = [];
    const invalid: HealthProblem[] = [];
    for (const entry of entries) {
        if (entry.metadata === null) {
            continue;
        }
        const reason = unreadableReason(entry.metadata);
        if (reason !== null) {
            unreadable.push({ severity: 'error', message: reason, path: entry.path });
            continue;
        }
        for (const message of schemaProblems(entry.metadata)) {
            invalid.push({ severity: 'error', message, path: entry.path });
        }
    }
    return [
        {
            id: 'frontmatter-yaml',
            title: 'Frontmatter is valid YAML',
            description: 'A note whose frontmatter cannot be parsed has no tags, events or task as far as the app can tell.',
            problems: unreadable,
        },
        {
            id: 'frontmatter-schema',
            title: 'Frontmatter follows metadata-schema.json',
            description: 'created_at, tags, events and task have the shapes the schema gives them, as the note view checks for one note.',
            problems: invalid,
        },
    ];
}

// Which check an error from the event derivations belongs to, by the property it names. A task's
// dates are named by their field.
const EVENT_CHECKS: { id: string; title: string; description: string; properties: string[] }[] = [
    {
        id: 'event-times',
        title: 'Every event has a start and end the calendar can read',
        description: 'Each event names a start, a list of instances or both; a start is a date or a datetime, and an end is one too, or a time of day or a duration.',
        properties: ['start', 'end'],
    },
    {
        id: 'event-repeat',
        title: 'Recurrence rules can be expanded',
        description: 'Each repeat: rule is one rrule accepts: a known freq, weekdays as three letters with an optional ordinal, a known tz.',
        properties: ['repeat'],
    },
    {
        id: 'event-adjustments',
        title: 'Exclusions and overrides each name an occurrence',
        description: 'Each exclusion and override matches an occurrence its rule generates. One that matches none is almost always a mistyped date.',
        properties: ['exclusions', 'overrides', 'at'],
    },
    {
        id: 'event-category',
        title: 'Event categories are configured',
        description: 'Each category: names one configured under categories: in .mory/calendars.yaml, its own id and not only a parent\'s.',
        properties: ['category'],
    },
    {
        id: 'event-alarms',
        title: 'Alarms follow the alarm grammar',
        description: 'Each alarm on an event, an override, an instance or a task\'s dates is an offset such as -10m or a time such as -1d 18:00. Anything else is dropped and never rings.',
        properties: ['alarms'],
    },
    {
        id: 'task-dates',
        title: 'Task due dates and deadlines can be drawn',
        description: 'Each due_by and deadline is a value the calendar reads as a moment, to draw it and ring its alarms. Whether urgency reads it too is a task check.',
        properties: ['due_by', 'deadline'],
    },
];

/// The events and task dates the calendar would refuse within `window`. A series is expanded only
/// over the window, so a mistake that only an occurrence outside it meets is not found.
export function eventChecks(
    entries: readonly ListEntry2[],
    window: EventWindow,
    options: { categories?: EventCategories; alarmDefaults?: AlarmDefaults } = {},
): HealthCheck[] {
    const errors: EventError[] = [
        ...eventsFromEntries(entries, window, options).errors,
        ...taskDatesFromEntries(entries, window, { alarmDefaults: options.alarmDefaults }).errors,
    ];
    const checks: HealthCheck[] = EVENT_CHECKS.map(({ id, title, description }) => ({ id, title, description, problems: [] }));
    // Without the configuration every category would look unknown, so `categoryOf` checks none, and
    // an OK would claim what was never looked at.
    if (options.categories === undefined) {
        checks.find((check) => check.id === 'event-category')?.problems.push({
            severity: 'warning',
            message: 'Not verified: the categories in .mory/calendars.yaml could not be read.',
        });
    }
    const checkOf = new Map(EVENT_CHECKS.flatMap(({ properties }, index) =>
        properties.map((property) => [property, checks[index]] as const)));
    // A bad `end` on a series is met once per occurrence, and is one mistake to fix.
    const seen = new Set<string>();
    for (const [property, value, eventName, path] of errors) {
        const message = `Invalid ${property} "${describeValue(value)}" of "${eventName}"`;
        const key = `${path}\0${message}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        // A property no check names yet is still a problem the calendar met, and lands with the
        // times rather than nowhere.
        (checkOf.get(property) ?? checks[0]).problems.push({ severity: 'error', message, path });
    }
    return checks;
}

// The dates a task's urgency is worked out from, which `taskInstant` must read.
const TASK_DATE_KEYS = ['due_by', 'deadline', 'available_from'];

// What the older task model stored, which the task editor rewrites on its next save.
const LEGACY_TASK_KEYS = ['urgency', 'progress', 'scheduled_dates', 'start_at'];

/// Files under `.tasks/` the task tree leaves out or places other than where they are, and tasks
/// still holding the older model's keys.
export function taskChecks(entries: readonly ListEntry2[]): HealthCheck[] {
    const misnamed: HealthProblem[] = [];
    const orphaned: HealthProblem[] = [];
    const legacy: HealthProblem[] = [];
    const unreadDates: HealthProblem[] = [];
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
            misnamed.push({ severity: 'warning', message: 'Not in the task tree.', path: entry.path });
            continue;
        }
        const parent = entry.path.slice(0, entry.path.lastIndexOf('/'));
        if (parent !== '.tasks' && !covered.has(parent)) {
            orphaned.push({
                severity: 'warning',
                message: `Shown at the top level: no task file covers ${parent}/.`,
                path: entry.path,
            });
        }
        const task = entry.metadata?.task;
        if (typeof task === 'object' && task !== null && !Array.isArray(task)) {
            const record = task as Record<string, unknown>;
            const keys = LEGACY_TASK_KEYS.filter((key) => Object.hasOwn(record, key));
            if (typeof record.importance === 'number') {
                keys.push('importance (as a number)');
            }
            if (keys.length > 0) {
                legacy.push({ severity: 'warning', message: `Holds ${keys.join(', ')}.`, path: entry.path });
            }
            for (const key of TASK_DATE_KEYS) {
                const value = record[key];
                // Whether a value is read does not depend on the zone, only the instant it names.
                if (value !== undefined && value !== null && taskInstant(value, 'UTC') === undefined) {
                    unreadDates.push({ severity: 'error', message: `${key} "${describeValue(value)}" is not read.`, path: entry.path });
                }
            }
        }
    }
    return [
        {
            id: 'task-names',
            title: 'Task files are named for the task tree',
            description: 'Each note under .tasks/ has a file name ending with a UUIDv4, in directories each named by a bare UUIDv4. The tree leaves out any other.',
            problems: misnamed,
        },
        {
            id: 'task-parents',
            title: 'Every subtask\'s parent task exists',
            description: 'A task in .tasks/<uuid>/ has a task file for <uuid> beside that directory. Without one it is shown at the top level instead.',
            problems: orphaned,
        },
        {
            id: 'task-date-values',
            title: 'Task dates are ones urgency can read',
            description: 'Each due_by, deadline and available_from is a bare date or a datetime carrying its offset, such as 2026-10-21 or 2026-10-21 09:00+09:00. Urgency ignores any other, and the MCP tools refuse it.',
            problems: unreadDates,
        },
        {
            id: 'task-model',
            title: 'Tasks hold only the current task model',
            description: 'No task keeps what the older task model stored. start_at is read as available_from and a numeric importance as low, medium or high where it maps to one; urgency, progress and scheduled_dates are ignored. The task editor writes them as the current model on its next save.',
            problems: legacy,
        },
    ];
}

/// What the stores report of the files under `.mory/`, each file a check of its own.
export function settingsChecks(reports: {
    calendarsPath: string;
    /// The calendar store's errors. Only those of the file, prefixed with its path, are taken: those
    /// of a feed describe the last window a view loaded, if any, and the feeds are asked afresh.
    calendarErrors: readonly string[];
    /// One line per feed that could not be read, or why the feeds could not be asked at all.
    feedErrors: readonly string[];
    tasksPath: string;
    taskSettingsProblems: readonly string[];
    /// Every file the listing holds under `.mory/plans/`.
    planPaths: readonly string[];
    /// Each unreadable month's error, by `YYYY-MM`.
    planErrors: Readonly<Record<string, string>>;
}): HealthCheck[] {
    const prefix = `${reports.calendarsPath}: `;
    const calendars: HealthProblem[] = reports.calendarErrors
        .filter((message) => message.startsWith(prefix))
        .map((message) => ({ severity: 'error', message: message.slice(prefix.length), path: reports.calendarsPath }));
    return [
        {
            id: 'calendars-settings',
            title: `${reports.calendarsPath} reads cleanly`,
            description: 'Its alarms: defaults and categories: are each what they should be. What is not is ignored, and saving the calendar settings removes it.',
            problems: calendars,
        },
        {
            id: 'calendar-feeds',
            title: 'Subscribed calendars load',
            description: 'Each enabled feed in .mory/calendars.yaml can be fetched and read by moried. moried keeps a feed it fetched for an hour by default, so a feed fixed since is seen when that runs out.',
            problems: reports.feedErrors.map((message) => ({ severity: 'error', message })),
        },
        {
            id: 'tasks-settings',
            title: `${reports.tasksPath} reads cleanly`,
            description: 'default_lead_time, lead_time_by_tag and status_colors are each what they should be, and the file holds no legacy task data.',
            problems: reports.taskSettingsProblems.map((message) => ({ severity: 'error', message, path: reports.tasksPath })),
        },
        {
            id: 'plans',
            title: 'Every day plan reads cleanly',
            description: 'Each file under .mory/plans/ is named for a month and holds a plan the app can read. One that does not is refused whole, and cannot be planned in until fixed.',
            problems: planProblems(reports.planPaths, reports.planErrors),
        },
    ];
}

/// The month a file under `.mory/plans/` holds the plan of, or `null` for one no plan is read from.
export function planMonthOf(path: string): string | null {
    return /^\.mory\/plans\/([0-9]{4}-(?:0[1-9]|1[0-2]))\.yaml$/.exec(path)?.[1] ?? null;
}

// Only listed files: the store keeps a month's error after its file is deleted, and that one has
// nothing left to fix.
function planProblems(paths: readonly string[], errors: Readonly<Record<string, string>>): HealthProblem[] {
    const problems: HealthProblem[] = [];
    for (const path of paths) {
        const month = planMonthOf(path);
        if (month === null) {
            problems.push({ severity: 'warning', message: 'Never read as a day plan: a plan is named for its month, as YYYY-MM.yaml.', path });
        }
        // Read rather than asked with `Object.hasOwn`: the store's errors are reactive, and Vue does
        // not track an own-property check, so a month failing after the first look went unseen.
        else if (errors[month] !== undefined) {
            problems.push({ severity: 'error', message: errors[month], path });
        }
    }
    return problems;
}

/// The checks `run` makes, or one failed check in their place when it throws.
///
/// The checks read whatever the files hold, and the page is where a reader learns what is broken:
/// one check meeting something it did not expect must not take the others, or the page, with it.
export function guardChecks(id: string, title: string, run: () => HealthCheck[]): HealthCheck[] {
    try {
        return run();
    }
    catch (error) {
        return [{
            id,
            title,
            description: 'These checks stopped on an error of their own, so what they verify is unknown.',
            problems: [{ severity: 'error', message: `The checks could not run: ${error instanceof Error ? error.message : String(error)}` }],
        }];
    }
}
