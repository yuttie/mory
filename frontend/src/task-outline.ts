// A tree of tasks typed as an indented list, the way Emmet expands an abbreviation into markup:
//
//     - Write the report [to do, high, 3w, <=2026-12-01, !<=2026-12-08, #work]
//         - Gather the figures [2d]
//         - Draft ["Start from last year's"]
//
// Each line is a task, nested under the line above it that is indented less, with or without a
// list marker or a task list's box (`- [x]` is a task done). A list in brackets at the end of the
// line sets its fields:
//
// - a status that needs nothing more: `backlog`, `to do`, `in progress` or `done`;
// - an importance: `low`, `medium` or `high`;
// - a lead time: `3w`, `2d`, `10 days`;
// - `>=DATE` available from, `<=DATE` due by, `!<=DATE` the deadline, where DATE is
//   `YYYY-MM-DD`, or `YYYY-MM-DD HH:MM` with an offset or in the reader's zone;
// - `#tag`, as many as wanted;
// - a quoted string, the note's body, with JSON's escapes.
//
// Nothing here writes. The outline is read into tasks, a preview can show them, and `writesOf`
// renders them as notes, parents first, for the tasks store to write.

import dayjs from 'dayjs';

import { childTaskPath } from '@/task-forest';
import { type StatusKind, type Task, type UUID, STATUS_KINDS, STATUS_LABEL, hasFields, makeDefaultStatus, render } from '@/task';
import { type Importance, leadTimeDays, readImportance, taskInstant } from '@/urgency';

const LIST_MARKER = /^(?:[-*+]|[0-9]+[.)])(?:\s+|$)/;
// A task list's box, which the editor continues on Enter as it does a marker.
const TASK_BOX = /^\[([ xX])\](?:\s+|$)/;

// Each optional, so that a field a line leaves out is left out of the note rather than written
// empty, as the editor leaves it out.
export interface OutlineFields {
    status?: StatusKind;
    importance?: Importance;
    lead_time?: string;
    available_from?: string;
    due_by?: string;
    deadline?: string;
    tags: string[];
}

export interface OutlineTask {
    // 1-based, as an editor numbers lines.
    line: number;
    title: string;
    // What the task is written with: the line's fields, and Backlog where it gives no status.
    fields: OutlineFields & { status: StatusKind };
    note: string;
    children: OutlineTask[];
}

export interface OutlineProblem {
    line: number;
    message: string;
}

export interface Outline {
    tasks: OutlineTask[];
    problems: OutlineProblem[];
}

export function parseOutline(text: string): Outline {
    const tasks: OutlineTask[] = [];
    const problems: OutlineProblem[] = [];
    // The lines a following one may nest under, outermost first.
    const open: { column: number; task: OutlineTask }[] = [];

    text.split(/\r?\n/).forEach((source, index) => {
        const content = source.trimStart();
        const item = content.replace(LIST_MARKER, '');
        const box = item === content ? null : TASK_BOX.exec(item);
        const rest = box === null ? item : item.slice(box[0].length);
        // A blank line, or an item not written yet, as Enter leaves one: nothing to add, and
        // nothing wrong with it either.
        if (rest.trim() === '') {
            return;
        }
        const line = index + 1;
        const report = (message: string): void => { problems.push({ line, message }); };

        const column = indentationOf(source);
        // A line indented between two levels goes under the shallower one, as Markdown nests it.
        while (open.length > 0 && open[open.length - 1].column >= column) {
            open.pop();
        }
        const parent = open.at(-1)?.task;

        const { title, items } = splitLine(rest, report);
        // A ticked box is the status Done, given as the list would give it, so that one there too
        // is reported as given twice.
        const ticked: Item[] = box !== null && box[1] !== ' ' ? [{ quoted: false, text: 'done' }] : [];
        const own = readItems([...ticked, ...items], report);
        if (title === '') {
            report('The task has no title.');
        }

        const task: OutlineTask = {
            line,
            title,
            fields: { ...own.fields, status: own.fields.status ?? 'backlog' },
            note: own.notes.join('\n\n'),
            children: [],
        };
        (parent?.children ?? tasks).push(task);
        open.push({ column, task });
    });

    return { tasks, problems };
}

export function countTasks(tasks: readonly OutlineTask[]): number {
    return tasks.reduce((count, task) => count + 1 + countTasks(task.children), 0);
}

export interface TaskWrite {
    uuid: UUID;
    path: string;
    title: string;
    markdown: string;
}

// The notes an outline becomes, each parent before its children, so that every task is written
// after the one it sits under. `pathOf` places a task at the top of the outline.
export function writesOf(
    tasks: readonly OutlineTask[],
    pathOf: (uuid: UUID) => string,
    newUuid: () => UUID = () => crypto.randomUUID(),
): TaskWrite[] {
    const writes: TaskWrite[] = [];
    const visit = (task: OutlineTask, uuid: UUID, path: string): void => {
        writes.push({ uuid, path, title: task.title, markdown: render(taskOf(task, uuid)) });
        for (const child of task.children) {
            const id = newUuid();
            visit(child, id, childTaskPath(path, uuid, id));
        }
    };
    for (const task of tasks) {
        const id = newUuid();
        visit(task, id, pathOf(id));
    }
    return writes;
}

function taskOf(task: OutlineTask, uuid: UUID): Task {
    const { status, importance, lead_time, available_from, due_by, deadline, tags } = task.fields;
    return {
        uuid,
        title: task.title,
        tags,
        status: makeDefaultStatus(status),
        ...(importance !== undefined ? { importance } : {}),
        ...(lead_time !== undefined ? { lead_time } : {}),
        ...(available_from !== undefined ? { available_from } : {}),
        ...(due_by !== undefined ? { due_by } : {}),
        ...(deadline !== undefined ? { deadline } : {}),
        // The file ends with a newline, as one the editor saves does.
        note: task.note === '' || task.note.endsWith('\n') ? task.note : task.note + '\n',
    };
}

// Columns of leading whitespace, a tab reaching the next multiple of four. Any space counts, not
// only ASCII's: an IME types a full-width one, two columns wide, and a paste brings
// non-breaking ones, and a line indented with either would otherwise land at the top unannounced.
function indentationOf(line: string): number {
    let column = 0;
    for (const char of line) {
        if (char === '\t') {
            column += 4 - column % 4;
        }
        else if (char === '\u3000') {
            column += 2;
        }
        else if (/\s/.test(char)) {
            column += 1;
        }
        else {
            break;
        }
    }
    return column;
}

type Item = { quoted: true; raw: string } | { quoted: false; text: string };

// The title, and the items of the bracketed list that ends the line, if one does. A title may hold
// brackets of its own, so the list is the first `[` from which the rest of the line reads as one.
function splitLine(text: string, report: (message: string) => void): { title: string; items: Item[] } {
    const trimmed = text.trimEnd();
    if (!trimmed.endsWith(']')) {
        return { title: trimmed, items: [] };
    }
    for (let at = trimmed.indexOf('['); at !== -1; at = trimmed.indexOf('[', at + 1)) {
        const items = readList(trimmed.slice(at));
        if (items !== null) {
            return { title: trimmed.slice(0, at).trim(), items };
        }
    }
    report('The brackets that end the line are not a list of fields; check its quotes, or end a title that has brackets with an empty [].');
    return { title: trimmed, items: [] };
}

// The items of `[a, "b", c]`, or `null` unless the whole text is one such list.
function readList(text: string): Item[] | null {
    const items: Item[] = [];
    let at = 1;
    for (;;) {
        while (at < text.length && /\s/.test(text[at])) {
            at += 1;
        }
        if (text[at] === '"') {
            let end = at + 1;
            while (end < text.length && text[end] !== '"') {
                end += text[end] === '\\' ? 2 : 1;
            }
            if (end >= text.length) {
                return null;
            }
            items.push({ quoted: true, raw: text.slice(at, end + 1) });
            at = end + 1;
            while (at < text.length && /\s/.test(text[at])) {
                at += 1;
            }
        }
        else {
            const end = text.slice(at).search(/[,[\]]/);
            if (end === -1) {
                return null;
            }
            items.push({ quoted: false, text: text.slice(at, at + end).trim() });
            at += end;
        }
        if (text[at] === ',') {
            at += 1;
        }
        else if (text[at] === ']') {
            return at === text.length - 1 ? items : null;
        }
        else {
            return null;
        }
    }
}

const FIELD_NAMES: Record<Exclude<keyof OutlineFields, 'tags'>, string> = {
    status: 'status',
    importance: 'importance',
    lead_time: 'lead time',
    available_from: 'available-from date',
    due_by: 'due-by date',
    deadline: 'deadline',
};

// A name as the list may write it: in any case, with spaces, hyphens or underscores between words.
function wordOf(text: string): string {
    return text.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
}

// A status by its label or its kind, `To do`, `todo` or `to_do`, so that the words are those the
// app shows and the note holds rather than a list of its own to keep in step with them.
function statusNamed(word: string): StatusKind | undefined {
    const kind = STATUS_KINDS.find((candidate) => wordOf(STATUS_LABEL[candidate]) === word || wordOf(candidate) === word);
    return kind ?? (word === 'cancelled' ? 'canceled' : undefined);
}

function readItems(items: Item[], report: (message: string) => void): { fields: OutlineFields; notes: string[] } {
    const fields: OutlineFields = { tags: [] };
    const notes: string[] = [];
    // Words that are not fields, reported once the rest is read: a list none of whose items is a
    // field may be a title's own brackets.
    const unknown: string[] = [];

    function set<K extends Exclude<keyof OutlineFields, 'tags'>>(key: K, value: OutlineFields[K]): void {
        if (fields[key] !== undefined) {
            report(`The ${FIELD_NAMES[key]} is given twice.`);
            return;
        }
        fields[key] = value;
    }

    function setDate(key: 'available_from' | 'due_by' | 'deadline', text: string): void {
        const value = readDate(text);
        if (value === undefined) {
            report(`"${text}" is not a date; write YYYY-MM-DD, or YYYY-MM-DD HH:MM.`);
            return;
        }
        set(key, value);
    }

    for (const item of items) {
        if (item.quoted) {
            try {
                notes.push(JSON.parse(item.raw) as string);
            }
            catch {
                report(`The note ${item.raw} cannot be read; write a backslash as \\\\ and a tab as \\t.`);
            }
            continue;
        }
        const text = item.text;
        if (text === '') {
            continue;
        }
        const word = wordOf(text);
        const importance = readImportance(word);
        const status = statusNamed(word);
        if (text.startsWith('!<=')) {
            setDate('deadline', text.slice(3));
        }
        else if (text.startsWith('<=')) {
            setDate('due_by', text.slice(2));
        }
        else if (text.startsWith('>=')) {
            setDate('available_from', text.slice(2));
        }
        else if (text.startsWith('#')) {
            const tag = text.slice(1).trim();
            if (tag === '') {
                report('A tag needs a name after the #.');
            }
            else if (!fields.tags.includes(tag)) {
                fields.tags.push(tag);
            }
        }
        else if (importance !== undefined) {
            set('importance', importance);
        }
        else if (leadTimeDays(text.toLowerCase()) !== undefined) {
            // As the schema's pattern spells a unit, which is in lower case.
            set('lead_time', text.toLowerCase());
        }
        // A line has no place for a reason, so it gives only the statuses that need none. Done's
        // fields are the time it is written, and need nobody to give them.
        else if (status !== undefined && hasFields(status) && status !== 'done') {
            report(`${STATUS_LABEL[status]} needs a reason; give it in the task's editor once the task is added.`);
        }
        else if (status !== undefined) {
            set('status', status);
        }
        else {
            unknown.push(text);
        }
    }
    const read = items.filter((item) => item.quoted || item.text !== '').length - unknown.length;
    const hint = read === 0 ? ' A title that ends in brackets needs an empty [] after it.' : '';
    for (const text of unknown) {
        report(`"${text}" is not a property.${hint}`);
    }
    return { fields, notes };
}

// A due date as a task holds it: a bare date, or a time with its offset.
function readDate(text: string): string | undefined {
    const match = /^([0-9]{4}-[0-9]{2}-[0-9]{2})(?:[ T]([0-9]{2}:[0-9]{2}(?::[0-9]{2})?) *(Z|[+-][0-9]{2}:[0-9]{2})?)?$/.exec(text.trim());
    if (match === null) {
        return undefined;
    }
    const [, date, time, offset] = match;
    const value = time === undefined ? date : `${date} ${time}${offset ?? 'Z'}`;
    // Whether a task would read it as a date: only that is asked, so any zone does. Asked first, so
    // that dayjs below never sees a 2026-02-30 or a 25:00, which it would roll over into another.
    if (taskInstant(value, 'UTC') === undefined) {
        return undefined;
    }
    if (time === undefined || offset !== undefined) {
        return value;
    }
    // A time typed without an offset is in the reader's zone. One the zone skips moves forward, as
    // `taskInstant` reads it, rather than keeping the typed clock beside an offset that, paired
    // with it, names an hour earlier.
    return dayjs(`${date}T${time}`).format(time.length > 5 ? 'YYYY-MM-DD HH:mm:ssZ' : 'YYYY-MM-DD HH:mmZ');
}
