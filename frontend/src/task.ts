import YAML from 'yaml';
import { nowLocal } from '@/time';
import { type Importance, readImportance } from '@/urgency';

import { stringifyWithFlowAlarms } from '@/frontmatter';
import { type TaskAlarms, alarmValueProblems } from '@/alarms';
import type { UUID } from '@/api';
import {
    columnOf,
    editFrontmatter,
    hasKey,
    indentBlock,
    lineEnding,
    parsesTo,
    quoteIndentedText,
    sameValue,
    splice,
    stringifyQuotingIndented,
} from '@/frontmatter';

export { UUID };

export interface BacklogStatus {
    kind: 'backlog';
}

export interface TodoStatus {
    kind: 'todo';
}

export interface InProgressStatus {
    kind: 'in_progress';
}

export interface WaitingStatus {
    kind: 'waiting';
    waiting_for: string;
    expected_by?: string;
    contact?: string;
    follow_up_at?: string;
}

export interface BlockedStatus {
    kind: 'blocked';
    blocked_by: string;
}

export interface OnHoldStatus {
    kind: 'on_hold';
    hold_reason: string;
    review_at?: string;
}

export interface DoneStatus {
    kind: 'done';
    completed_at: string; // ISO datetime
    completion_note?: string;
}

export interface CanceledStatus {
    kind: 'canceled';
    canceled_at: string; // ISO datetime
    cancel_reason: string;
}

export type Status =
    | BacklogStatus
    | TodoStatus
    | InProgressStatus
    | WaitingStatus
    | BlockedStatus
    | OnHoldStatus
    | DoneStatus
    | CanceledStatus;

export type StatusKind = Status['kind'];

export const STATUS_LABEL: Record<StatusKind, string> = {
    backlog: 'Backlog',
    todo: 'To do',
    in_progress: 'In progress',
    waiting: 'Waiting',
    blocked: 'Blocked',
    on_hold: 'On hold',
    done: 'Done',
    canceled: 'Canceled',
};

// Every status, in the order they are listed and drawn.
export const STATUS_KINDS = Object.keys(STATUS_LABEL) as StatusKind[];

// Backlog is To do not yet committed to, so the two trade places freely and Backlog can go
// anywhere To do can.
export const STATUS_TRANSITION = {
    backlog: ['todo', 'in_progress', 'waiting', 'blocked', 'on_hold', 'done', 'canceled'],
    todo: ['backlog', 'in_progress', 'waiting', 'blocked', 'on_hold', 'done', 'canceled'],
    in_progress: ['waiting', 'blocked', 'on_hold', 'done', 'canceled'],
    waiting: ['in_progress', 'blocked', 'on_hold', 'done', 'canceled'],
    blocked: ['in_progress', 'waiting', 'on_hold', 'done', 'canceled'],
    on_hold: ['in_progress', 'waiting', 'blocked', 'done', 'canceled'],
    done: [],
    canceled: [],
} as const satisfies Record<StatusKind, readonly StatusKind[]>;

// A task's status as every reader takes it: a mapping whose `kind` is one of `STATUS_KINDS`. A
// note in the task tree is a task by its path alone -- the tree, `TaskHierarchy` and the plans all
// count it -- so one without a status is still a task, only one none of them knows the status of:
// `missing` when nothing is written, which the editor can fill in, and `unread` with why when
// something is written that no reader takes, which a save would replace. The web app draws a task
// without one as Backlog, and `list_tasks` lists it without one.
export type StatusReading =
    | { status: Status }
    | { missing: string }
    | { unread: string };

function isMapping(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readStatus(metadata: unknown): StatusReading {
    if (metadata === null || metadata === undefined) {
        return { missing: 'Has no frontmatter, so no task: block.' };
    }
    if (!isMapping(metadata)) {
        return { unread: 'Its frontmatter is not a mapping.' };
    }
    const task = metadata.task;
    if (task === null || task === undefined) {
        return { missing: 'Has no task: block.' };
    }
    if (!isMapping(task)) {
        return { unread: `Its task: is ${JSON.stringify(task)}, not a mapping.` };
    }
    const status = task.status;
    if (status === null || status === undefined) {
        return { missing: 'Its task: block has no status.' };
    }
    if (!isMapping(status) || !(STATUS_KINDS as unknown[]).includes(status.kind)) {
        return { unread: `Its status ${JSON.stringify(status)} has no kind among ${STATUS_KINDS.join(', ')}.` };
    }
    return { status: status as unknown as Status };
}

// The keys the task editor has a field for and rewrites on a save, as a note names them.
// `start_at` is the older spelling of `available_from`, read where that is unset.
export const EDITOR_KEYS = ['tags', 'importance', 'lead_time', 'available_from', 'start_at', 'due_by', 'deadline', 'alarms'] as const;
export type EditorKey = typeof EDITOR_KEYS[number];

const ALARM_KEYS = new Set(['due_by', 'deadline']);

// The keys of a note's frontmatter whose value the task editor does not read, each with the value
// as written. Its field would show such a key as empty and the save would write that empty back,
// so the editor shows the field empty, keeps the value as written (`render`), and refuses a save
// that changes the field. `tags` is at the top level, the rest under `task:`. A numeric
// `importance` is the older task model's, read as low, medium or high or as unrated, and dropped
// on purpose, so it is not among them.
export function unreadEditorKeys(metadata: unknown): Partial<Record<EditorKey, string>> {
    const unread: Partial<Record<EditorKey, string>> = {};
    if (!isMapping(metadata)) {
        return unread;
    }
    const set = (value: unknown) => value !== undefined && value !== null;
    const tags = metadata.tags;
    if (set(tags) && !(Array.isArray(tags) && tags.every((tag) => typeof tag === 'string'))) {
        unread.tags = JSON.stringify(tags);
    }
    const task = isMapping(metadata.task) ? metadata.task : {};
    if (set(task.importance) && typeof task.importance !== 'number' && readImportance(task.importance) === undefined) {
        unread.importance = JSON.stringify(task.importance);
    }
    if (set(task.lead_time) && typeof task.lead_time !== 'string') {
        unread.lead_time = JSON.stringify(task.lead_time);
    }
    // A date is the editor's as a string, which the date field shows as written, empty or not as
    // a date included; an empty one is read as unset, and saved as unset.
    for (const key of ['available_from', 'due_by', 'deadline'] as const) {
        if (set(task[key]) && typeof task[key] !== 'string') {
            unread[key] = JSON.stringify(task[key]);
        }
    }
    if (!set(task.available_from) && set(task.start_at) && typeof task.start_at !== 'string') {
        unread.start_at = JSON.stringify(task.start_at);
    }
    const alarms = task.alarms;
    if (set(alarms) && (!isMapping(alarms)
        || Object.keys(alarms).some((key) => !ALARM_KEYS.has(key))
        || [...ALARM_KEYS].some((key) => alarmValueProblems(alarms[key]).length > 0))) {
        unread.alarms = JSON.stringify(alarms);
    }
    return unread;
}

export interface Task {
    created_at?: string;
    uuid: UUID;
    title: string;
    tags: string[];
    // Absent only for a note in the task tree that holds none yet (`readStatus`), which `render`
    // refuses to write until one is chosen.
    status?: Status;
    importance?: Importance;
    available_from?: string;
    lead_time?: string;
    // The note as it was read, which a save edits rather than regenerates, and the ETag it was read
    // at, which the save is checked against so that it cannot undo a change made since.
    source?: string;
    etag?: string;
    due_by?: string;
    deadline?: string;
    // When `due_by` and `deadline` ring, where this task says so; `render` has to write it, or a
    // save from the editor would delete it.
    alarms?: TaskAlarms;
    // What the note holds between its frontmatter and its title, which the editor does not show:
    // `render` writes the title first and then the note, so without this a save would drop it.
    beforeTitle?: string;
    // The keys the note holds in a shape the editor does not read (`unreadEditorKeys`): `render`
    // writes each as the source had it, whatever the task says.
    unread?: Partial<Record<EditorKey, string>>;
    note: string;
}

export function nextOptions(from: StatusKind): readonly StatusKind[] {
    return STATUS_TRANSITION[from] ?? [];
}

// The statuses that carry fields besides their kind, which `TaskStatusFields` shows. The rest are
// their kind alone.
const KINDS_WITH_FIELDS: ReadonlySet<StatusKind> = new Set<StatusKind>(['waiting', 'blocked', 'on_hold', 'done', 'canceled']);

export function hasFields(kind: StatusKind): boolean {
    return KINDS_WITH_FIELDS.has(kind);
}

// What a task switched to `kind` starts with. Done and Canceled say when, and that is now.
export function makeDefaultStatus(kind: StatusKind): Status {
    const now = nowLocal();
    switch (kind) {
        case 'backlog': return { kind: 'backlog' };
        case 'todo': return { kind: 'todo' };
        case 'in_progress': return { kind: 'in_progress' };
        case 'waiting': return { kind: 'waiting', waiting_for: '' };
        case 'blocked': return { kind: 'blocked', blocked_by: '' };
        case 'on_hold': return { kind: 'on_hold', hold_reason: '' };
        case 'done': return { kind: 'done', completed_at: now };
        case 'canceled': return { kind: 'canceled', canceled_at: now, cancel_reason: '' };
    }
}

// A status as a note is to hold it: an optional field left empty is left out, rather than written
// as an empty string or as the null a cleared field gives, which the schema does not allow.
export function withoutBlanks(status: Status): Status {
    return Object.fromEntries(Object.entries(status).filter(
        ([, value]) => value !== null && value !== undefined && String(value).trim() !== '',
    )) as Status;
}

export function canTransition(from: StatusKind, to: StatusKind): boolean {
    if (to === from) { return true; }  // Allow no-op (same status)
    return nextOptions(from).includes(to);
}

export function render(task: Task): string {
    if (task.status === undefined) {
        throw new Error('A task is written with a status.');
    }
    const metadata = {
        created_at: task.created_at ?? nowLocal(),
        task: {
            status: task.status,
            ...(task.importance ? { importance: task.importance } : {}),
            ...(task.available_from ? { available_from: task.available_from } : {}),
            ...(task.lead_time ? { lead_time: task.lead_time } : {}),
            ...(task.due_by ? { due_by: task.due_by } : {}),
            ...(task.deadline ? { deadline: task.deadline } : {}),
            ...(task.alarms && Object.keys(task.alarms).length > 0 ? { alarms: task.alarms } : {}),
        },
        tags: task.tags,
    };
    let frontmatter = stringifyWithFlowAlarms(metadata, { indent: 4 });
    // A note without frontmatter, or with an empty one, has nothing in it to keep, and is written
    // the frontmatter above. A note in the task tree can be either before it is given a status.
    if (task.source && /^---\r?\n/.test(task.source)) {
        editFrontmatter(task.source, (source) => {
            const doc = YAML.parseDocument(source);
            // Nothing but comments, if anything: they are kept, above the frontmatter written.
            if (doc.errors.length === 0 && doc.contents === null) {
                if (source.trim() !== '') {
                    const written = source.trimEnd() + '\n' + frontmatter;
                    if (!parsesTo(written, YAML.parse(frontmatter))) {
                        throw new Error('Saving the task would change other frontmatter.');
                    }
                    frontmatter = written;
                }
                return source;
            }
            if (doc.errors.length > 0 || !YAML.isMap(doc.contents)) {
                throw new Error('The original frontmatter must be a valid mapping.');
            }
            const original = doc.toJS();
            // A note without a `task:` block, or with an empty one, is given the whole block.
            const blockless = original.task === undefined || original.task === null;
            const originalTask = blockless ? {} : original.task;
            if (typeof originalTask !== 'object' || Array.isArray(originalTask)) {
                throw new Error('The original task must be a mapping.');
            }
            if (blockless) {
                doc.set('task', doc.createNode({}));
            }
            const nextTask = { ...originalTask, ...metadata.task };
            for (const key of ['urgency', 'progress', 'scheduled_dates', 'start_at', 'importance', 'available_from', 'lead_time', 'due_by', 'deadline', 'alarms']) {
                if (!(key in metadata.task)) {
                    delete nextTask[key];
                }
            }
            // What the editor did not read it writes as it was, rather than as the empty field
            // that stood in for it.
            const unread = new Set(Object.keys(task.unread ?? {}));
            for (const key of unread) {
                if (key !== 'tags' && key in originalTask) {
                    nextTask[key] = originalTask[key];
                }
            }
            // The editor writes a date's alarms only with the date, so clearing one takes its
            // alarms with it. Those of a date the note never gave it, or gave in a shape it does not
            // read, ring at nothing yet and have no box there, but they are the note's: a save that
            // leaves that date unset leaves them as written.
            const alarms = originalTask.alarms;
            if (!unread.has('alarms') && isMapping(alarms)) {
                const kept = new Set<string>(['due_by', 'deadline'].filter((field) => alarms[field] !== undefined
                    && (unread.has(field) || !originalTask[field]) && !(field in metadata.task)));
                if (kept.size > 0) {
                    const written: Record<string, unknown> = isMapping(nextTask.alarms) ? nextTask.alarms : {};
                    // In the note's order, so that one kept as it was is written as it was.
                    nextTask.alarms = Object.fromEntries(Object.keys({ ...alarms, ...written })
                        .filter((field) => kept.has(field) || field in written)
                        .map((field) => [field, kept.has(field) ? alarms[field] : written[field]]));
                }
            }
            const createdAt = task.created_at ?? original.created_at ?? metadata.created_at;
            const tags = unread.has('tags') ? original.tags : task.tags;
            // Set only where it changes, so a value kept keeps its spelling: `[work]` stays flow.
            if (!sameValue(original.created_at, createdAt)) {
                doc.set('created_at', createdAt);
            }
            if (!sameValue(original.tags, tags)) {
                doc.set('tags', tags);
            }
            // Editing known fields keeps other frontmatter and YAML comments available to the editor.
            for (const key of Object.keys(originalTask)) {
                if (!(key in nextTask)) {
                    doc.deleteIn(['task', key]);
                }
            }
            for (const [key, value] of Object.entries(nextTask)) {
                if (!sameValue(originalTask[key], value)) {
                    doc.setIn(['task', key], value);
                }
            }
            quoteIndentedText(doc);
            // The whole document is written again, so every flow collection takes one spacing: the
            // one a new task is written with (`stringifyWithFlowAlarms`), so `[work]` stays `[work]`.
            frontmatter = doc.toString({ indent: 4, lineWidth: 0, flowCollectionPadding: false });
            const expected = { ...original, created_at: createdAt, tags, task: nextTask };
            if (!parsesTo(frontmatter, expected)) {
                throw new Error('Saving the task would change other frontmatter.');
            }
            return source;
        });
    }
    return '---\n' + frontmatter + '---\n'
        + (task.beforeTitle ? `\n${task.beforeTitle}\n` : '')
        + (task.title ? `\n# ${task.title}\n` : '')
        + `\n${task.note}`;
}

// A note with its task's status replaced, and every other byte left alone.
//
// `render` regenerates the whole file, which suits the editor: it holds every field it writes. A
// status change from anywhere else holds only the status, and regenerating would cost the rest --
// comments, the author's layout, and any key `render` does not know, such as an `events:` block.
// So only the `status:` value is rewritten, as the MCP server does, and the result is parsed again
// and refused unless it differs from the original in the status alone.
//
// The whole old mapping goes, not just `kind`: every member of the schema's union is closed, so a
// `waiting_for` left behind under `kind: todo` would make the task invalid.
export function replaceStatus(markdown: string, status: Status): string {
    return editFrontmatter(markdown, (yaml) => replaceStatusInYaml(yaml, status));
}

function replaceStatusInYaml(source: string, status: Status): string {
    const doc = YAML.parseDocument(source);
    if (doc.errors.length > 0) {
        throw new Error(`The frontmatter is not valid YAML: ${doc.errors[0].message}`);
    }
    const root = doc.contents;
    const taskPair = YAML.isMap(root) ? root.items.find((pair) => hasKey(pair, 'task')) : undefined;
    const task = taskPair?.value;
    // A flow-style `task: {...}` would need the whole mapping rewritten; nothing writes one.
    if (!taskPair?.key.range || !YAML.isMap(task) || task.flow || !task.range) {
        throw new Error('The frontmatter has no block `task:` mapping to change the status in.');
    }

    const eol = lineEnding(source);
    const taskColumn = columnOf(source, task.range[0]);
    // The author's indentation step, so the new lines sit the way theirs do.
    const step = taskColumn - columnOf(source, taskPair.key.range[0]);
    // Anything undefined is dropped here as `YAML.stringify` drops it, so the check below compares
    // against what is actually written.
    const value = JSON.parse(JSON.stringify(status)) as Status;
    const before = doc.toJS();
    // Already so: the note is left as it is, rather than given the same status spelt afresh -- and
    // committed with nothing changed, which is what a write of the same text becomes.
    if (sameValue(before.task.status, value)) {
        return source;
    }
    const block = stringifyQuotingIndented(value, { indent: step, lineWidth: 0 });

    const pair = task.items.find((p) => hasKey(p, 'status'));
    let edited: string;
    if (pair === undefined) {
        // First, where `render` puts it. The key that was first moves down a line and keeps its
        // column.
        const at = task.range[0];
        const inserted = 'status:' + eol + indentBlock(block, taskColumn + step, eol) + eol + ' '.repeat(taskColumn);
        edited = splice(source, at, at, inserted);
    }
    else if (YAML.isMap(pair.value) && pair.value.range) {
        const [from, to] = pair.value.range;
        if (pair.value.flow) {
            const flow = YAML.stringify(value, { collectionStyle: 'flow', lineWidth: 0 }).trimEnd();
            edited = splice(source, from, to, flow);
        }
        else {
            // The range starts at the first key's column and runs to the end of the last line.
            const column = columnOf(source, from);
            const tail = source.slice(from, to).endsWith('\n') ? eol : '';
            edited = splice(source, from, to, indentBlock(block, column, eol).slice(column) + tail);
        }
    }
    else if (pair.key.range && YAML.isNode(pair.value) && pair.value.range) {
        // Named without a mapping, as `status:` or `status: null`: rewritten as a block under the
        // key.
        const from = pair.key.range[0];
        const to = pair.value.range[1];
        const tail = source.slice(from, to).endsWith('\n') ? eol : '';
        const replaced = 'status:' + eol + indentBlock(block, columnOf(source, from) + step, eol) + tail;
        edited = splice(source, from, to, replaced);
    }
    else {
        throw new Error('The task\'s status is written in a form this edit does not handle.');
    }

    if (!parsesTo(edited, { ...before, task: { ...before.task, status: value } })) {
        throw new Error('Changing the status in place would have changed more than the status.');
    }
    return edited;
}
