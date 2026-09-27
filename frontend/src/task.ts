import YAML from 'yaml';
import dayjs from 'dayjs';

import type { UUID } from '@/api';

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

export interface Task {
    uuid: UUID;
    title: string;
    tags: string[];
    status: Status;
    progress: number;
    importance: number;
    urgency: number;
    start_at?: string;
    due_by?: string;
    deadline?: string;
    scheduled_dates: string[];
    note: string;
}

export function nextOptions(from: Status): readonly StatusKind[] {
    return STATUS_TRANSITION[from.kind] ?? [];
}

// What a task switched to `kind` starts with. Done and Canceled say when, and that is now.
export function makeDefaultStatus(kind: StatusKind): Status {
    const now = dayjs().format().replace('T', ' ');
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

export function canTransition(from: Status, to: StatusKind): boolean {
    if (to === from.kind) { return true; }  // Allow no-op (same status)
    return nextOptions(from).includes(to);
}

export function render(task: Task): string {
    const metadata = {
        task: {
            status: task.status,
            progress: task.progress,
            importance: task.importance,
            urgency: task.urgency,
            ...(task.start_at ? { start_at: task.start_at } : {}),
            ...(task.due_by ? { due_by: task.due_by } : {}),
            ...(task.deadline ? { deadline: task.deadline } : {}),
            scheduled_dates: task.scheduled_dates,
        },
        tags: task.tags,
    };
    return '---\n' + YAML.stringify(metadata, { indent: 4 }) + '---\n' + (task.title ? `\n# ${task.title}\n` : '') + (`\n${task.note}`);
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
    const opening = /^---\r?\n/.exec(markdown);
    if (opening === null) {
        throw new Error('The note has no frontmatter.');
    }
    const start = opening[0].length;
    const closingFence = /^---[ \t]*\r?$/gm;
    closingFence.lastIndex = start;
    const closing = closingFence.exec(markdown);
    if (closing === null) {
        throw new Error('The note\'s frontmatter is never closed.');
    }
    const edited = replaceStatusInYaml(markdown.slice(start, closing.index), status);
    return markdown.slice(0, start) + edited + markdown.slice(closing.index);
}

function replaceStatusInYaml(source: string, status: Status): string {
    const doc = YAML.parseDocument(source);
    if (doc.errors.length > 0) {
        throw new Error(`The frontmatter is not valid YAML: ${doc.errors[0].message}`);
    }
    const root = doc.contents;
    const taskPair = YAML.isMap(root) ? root.items.find((pair) => isKey(pair.key, 'task')) : undefined;
    const taskKey = taskPair?.key;
    const task = taskPair?.value;
    // A flow-style `task: {...}` would need the whole mapping rewritten; nothing writes one.
    if (!YAML.isNode(taskKey) || !taskKey.range || !YAML.isMap(task) || task.flow || !task.range) {
        throw new Error('The frontmatter has no block `task:` mapping to change the status in.');
    }

    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const columnOf = (offset: number) => offset - (source.lastIndexOf('\n', offset - 1) + 1);
    const taskColumn = columnOf(task.range[0]);
    // The author's indentation step, so the new lines sit the way theirs do.
    const step = taskColumn - columnOf(taskKey.range[0]);
    // Anything undefined is dropped here as `YAML.stringify` drops it, so the check below compares
    // against what is actually written.
    const value = JSON.parse(JSON.stringify(status)) as Status;
    const before = doc.toJS();
    // Already so: the note is left as it is, rather than given the same status spelt afresh -- and
    // committed with nothing changed, which is what a write of the same text becomes.
    if (sameValue(before.task.status, value)) {
        return source;
    }
    const block = YAML.stringify(value, { indent: step, lineWidth: 0 });

    const pair = task.items.find((p) => isKey(p.key, 'status'));
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
            const column = columnOf(from);
            const tail = source.slice(from, to).endsWith('\n') ? eol : '';
            edited = splice(source, from, to, indentBlock(block, column, eol).slice(column) + tail);
        }
    }
    else if (YAML.isNode(pair.key) && pair.key.range && YAML.isNode(pair.value) && pair.value.range) {
        // Named without a mapping, as `status:` or `status: null`: rewritten as a block under the
        // key.
        const from = pair.key.range[0];
        const to = pair.value.range[1];
        const tail = source.slice(from, to).endsWith('\n') ? eol : '';
        const replaced = 'status:' + eol + indentBlock(block, columnOf(from) + step, eol) + tail;
        edited = splice(source, from, to, replaced);
    }
    else {
        throw new Error('The task\'s status is written in a form this edit does not handle.');
    }

    const result = YAML.parseDocument(edited);
    const expected = { ...before, task: { ...before.task, status: value } };
    if (result.errors.length > 0 || !sameValue(result.toJS(), expected)) {
        throw new Error('Changing the status in place would have changed more than the status.');
    }
    return edited;
}

function isKey(key: unknown, name: string): boolean {
    return YAML.isScalar(key) && key.value === name;
}

function splice(text: string, from: number, to: number, replacement: string): string {
    return text.slice(0, from) + replacement + text.slice(to);
}

// Indents every line of a block `YAML.stringify` wrote, leaving blank lines blank.
function indentBlock(block: string, column: number, eol: string): string {
    return block.trimEnd()
        .split('\n')
        .map((line) => line === '' ? line : ' '.repeat(column) + line)
        .join(eol);
}

// Deep equality over the values YAML parses to, ignoring the order of a mapping's keys.
function sameValue(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
            a.every((item, i) => sameValue(item, b[i]));
    }
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
        const aRecord = a as Record<string, unknown>;
        const bRecord = b as Record<string, unknown>;
        const aKeys = Object.keys(aRecord);
        return aKeys.length === Object.keys(bRecord).length &&
            aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue(aRecord[key], bRecord[key]));
    }
    return Object.is(a, b);
}
