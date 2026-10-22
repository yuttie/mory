import { computed } from 'vue';
import type { Ref } from 'vue';

import type { RouteLocationRaw } from 'vue-router';

import {
    mdiCalendarClock,
    mdiCheckboxMarkedOutline,
    mdiCogOutline,
    mdiFileDocumentOutline,
    mdiFileOutline,
    mdiImageOutline,
} from '@mdi/js';

import dayjs from 'dayjs';

import { compareTags } from '@/api';
import type { ListEntry2 } from '@/api';

import { useFilesStore } from '@/stores/files';
import { useTasksStore } from '@/stores/tasks';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { routeForMime } from '@/file-route';
import { EVENTS_DIR } from '@/event-note';
import { summarizeEvent } from '@/event-summary';
import type { EventStart } from '@/event-summary';
import { declaredEvents, isOfKind, isTemplatePath, SYSTEM_DIR, templateNameOf } from '@/file-kinds';
import type { FileKind } from '@/file-kinds';
import { systemFilePurpose } from '@/system-files';
import { STATUS_KINDS, STATUS_LABEL } from '@/task';
import { statusColor } from '@/status-color';
import { statusIcon } from '@/status-icon';
import { taskDateCues } from '@/task-date-cues';
import type { TaskDateCue, TaskDateField } from '@/task-date-cues';
import { taskRoute } from '@/task-route';
import { taskInstant } from '@/urgency';
import type { Urgency } from '@/urgency';

// The files the Files view lists, a row each, and those its search leaves of them. The search
// dialog lists the same rows, so a file is found there by the words that find it in the view.

// Each by what it lists alone, as the view's own name says they are files. What is written comes
// first, as the app's other views show it, then the files that serve it, and last those of the
// application and the rest, which a phone reaches only by scrolling.
export const FILE_TABS: { kind: FileKind | null; value: string; title: string }[] = [
    { kind: null, value: 'all', title: 'All' },
    { kind: 'notes', value: 'notes', title: 'Notes' },
    { kind: 'tasks', value: 'tasks', title: 'Tasks' },
    { kind: 'events', value: 'events', title: 'Events' },
    { kind: 'media', value: 'media', title: 'Media' },
    { kind: 'templates', value: 'templates', title: 'Templates' },
    { kind: 'system', value: 'system', title: 'System' },
    { kind: 'others', value: 'others', title: 'Uncategorized' },
];

// A date as its note gives it, in the reader's zone where it has a time, with how far off it is to
// hover. A task's is coloured as the task lists colour it.
export interface DateCell {
    text: string;
    hint: string;
    color?: string;
    instant?: number;
}

export interface FileRow {
    // A file's path, or for one of the events it declares, the path and the event's name.
    key: string;
    path: string;
    size: number;
    mimeType: string;
    tags: string[];
    title: string | null;
    time: dayjs.Dayjs;
    icon: string;
    iconColor: string | null;
    to: RouteLocationRaw;
    // The directory a note is in, which its title does not say.
    folder?: string;
    // What the application reads a system file for.
    purpose?: string;
    // What the title alone does not say: the project a task is part of, from the task tree.
    caption?: string;
    status?: string;
    statusOrder?: number;
    dueBy?: DateCell;
    deadline?: DateCell;
    // An event's: the note it is declared in, by its title or else its path, when it starts, and
    // how it repeats.
    note?: string;
    starts?: DateCell;
    repeats?: string;
    urgency?: Urgency;
}

export interface FileQuery {
    paths: Set<string>;
    tags: Set<string>;
    any: Set<string>;
}

export function parseFileQuery(text: string): FileQuery {
    const queryPaths = new Set<string>();
    const queryTags = new Set<string>();
    const queryAny = new Set<string>();
    for (const match of text.matchAll(/"([^"]+)"|([^\s]+)/g)) {
        const word = match[1] || match[2];
        if (word.startsWith('#')) {
            queryTags.add(word.slice(1));
        }
        else if (word.startsWith('/')) {
            queryPaths.add(word.slice(1));
        }
        else {
            queryAny.add(word);
        }
    }

    return {
        paths: queryPaths,
        tags: queryTags,
        any: queryAny,
    };
}

// The tabs whose rows show their tags. An event's are its note's, not its own, and few files no
// other tab takes are notes, so few have tags.
export function tabShowsTags(kind: FileKind | null): boolean {
    return kind === null || kind === 'notes' || kind === 'tasks';
}

// Whether a row is one the query asks for, case aside. The query's words are lowered here, once a
// search, rather than again for each of the thousands of rows it is put to.
export function fileQueryMatcher(query: FileQuery, searchesTags: boolean): (row: FileRow) => boolean {
    const queryPaths = [...query.paths].map(x => x.toLowerCase());
    const queryTags = [...query.tags].map(x => x.toLowerCase());
    const queryAny = [...query.any].map(x => x.toLowerCase());

    return (row) => {
        // A path is asked for by name, so it is searched whether or not the row shows it.
        const rowPath = row.path.toLowerCase();
        if (queryPaths.some(kw => !rowPath.includes(kw))) {
            return false;
        }
        const rowTags = searchesTags ? row.tags.map((tag) => tag.toLowerCase()) : [];
        if (queryTags.some(tag => !rowTags.some(rowTag => rowTag.includes(tag)))) {
            return false;
        }
        // The rest only in the words the row shows, so nothing is listed for a title, a path or a
        // tag the tab hides: a template's heading, the path of a note shown by its title, or the
        // tags of the note an event is in.
        const shown = [row.title ?? row.path, row.caption, row.folder, row.note, row.purpose, row.repeats]
            .filter((text): text is string => text !== undefined)
            .map((text) => text.toLowerCase())
            .concat(rowTags);
        return queryAny.every(kw => shown.some(text => text.includes(kw)));
    };
}

// Tags given as anything but a list are none, as the tag list has them: frontmatter is whatever the
// file says.
function tagsOf(entry: ListEntry2): string[] {
    const tags: unknown = entry.metadata?.tags;
    return Array.isArray(tags) ? tags.map(String).sort(compareTags) : [];
}

// A task whose note gives no status is in the backlog, as the task view files it. One whose status
// is not a status is shown as written, after all the others.
function statusOf(statusKind: unknown): { status: string; statusOrder: number } {
    const known = STATUS_KINDS.find((each) => each === (statusKind ?? 'backlog'));
    return known === undefined
        ? { status: String(statusKind), statusOrder: STATUS_KINDS.length }
        : { status: STATUS_LABEL[known], statusOrder: STATUS_KINDS.indexOf(known) };
}

function dateCell(cues: TaskDateCue[], field: TaskDateField): DateCell | undefined {
    const cue = cues.find((each) => each.field === field);
    if (cue === undefined) {
        return undefined;
    }
    const value = cue.value.trim();
    const instant = taskInstant(value, dayjs.tz.guess(), true);
    const isDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value);
    return {
        text: instant === undefined || isDate ? value : dayjs(instant).format('YYYY-MM-DD HH:mm'),
        hint: cue.text,
        color: cue.color,
        instant,
    };
}

export function useFileRows(kind: Readonly<Ref<FileKind | null>>, queryText: Readonly<Ref<string>>) {
    const files = useFilesStore();
    const tasks = useTasksStore();
    // As the store last read them, which it does again whenever the listing moves. A view that
    // wants them read afresh as it opens loads them itself.
    const taskSettings = useTaskSettingsStore();

    // The files the open tab lists, before the query narrows them.
    const kindEntries = computed<ListEntry2[]>(() => {
        const open = kind.value;
        return open === null ? files.entries : files.entries.filter((entry) => isOfKind(entry, open));
    });

    const rows = computed<FileRow[]>(() => kindEntries.value.flatMap(
        (entry) => (kind.value === 'events' ? eventRows(entry) : [fileRow(entry)]),
    ));

    const query = computed(() => parseFileQuery(queryText.value));

    const isSearching = computed(() => query.value.paths.size + query.value.tags.size + query.value.any.size > 0);

    const matchedRows = computed(() => {
        // A tab that shows no tags has none to search.
        const searchesTags = tabShowsTags(kind.value);
        return rows.value.filter(fileQueryMatcher(query.value, searchesTags));
    });

    // A file by its path where its title would mislead: a template, as its heading is often only
    // placeholders to fill in, a system file, which the application reads by its path, and a file
    // no other tab takes, which is there for where it is or what it is named.
    function titleOf(entry: ListEntry2): string | null {
        return kind.value === 'system' || kind.value === 'others' || isTemplatePath(entry.path) ? null : entry.title;
    }

    // A task as the task lists show it, and opening into its editor there. The listing describes a
    // file the task tree may not have taken in yet, which is then listed as any other file is.
    function taskFields(path: string): Partial<FileRow> {
        const id = tasks.idByPath(path);
        const node = id === undefined ? undefined : tasks.node(id);
        if (id === undefined || node === undefined) {
            return {};
        }
        const task = node.metadata?.task ?? {};
        const statusKind = task.status?.kind;
        const cues = taskDateCues(task, node.metadata?.tags ?? [], taskSettings.settings, tasks.now);
        return {
            to: taskRoute(id),
            icon: statusIcon(statusKind, tasks.childrenOf(id).length > 0),
            iconColor: statusColor(statusKind, taskSettings.resolvedStatusColors) ?? null,
            caption: tasks.ancestorsOf(id).map((ancestor) => ancestor.title || 'Untitled').join(' › '),
            ...statusOf(statusKind),
            dueBy: dateCell(cues, 'due_by'),
            deadline: dateCell(cues, 'deadline'),
            urgency: tasks.urgency(id),
        };
    }

    function fileRow(entry: ListEntry2): FileRow {
        return {
            key: entry.path,
            to: routeForMime(entry.path, entry.mime_type),
            path: entry.path,
            size: entry.size,
            mimeType: entry.mime_type,
            tags: tagsOf(entry),
            title: titleOf(entry),
            time: dayjs(entry.time),
            ...(() => {
                if (entry.path.startsWith(".tasks/")) {
                    return { icon: mdiCheckboxMarkedOutline, iconColor: "#ffa600" };
                }
                else if (entry.path.startsWith(EVENTS_DIR)) {
                    return { icon: mdiCalendarClock, iconColor: "#b95050" };
                }
                else if (entry.path.startsWith(SYSTEM_DIR)) {
                    return { icon: mdiCogOutline, iconColor: "#757575" };
                }
                else if (isTemplatePath(entry.path)) {
                    return { icon: mdiFileDocumentOutline, iconColor: "#5fa3c4" };
                }
                else if (entry.mime_type.startsWith("image/")) {
                    return { icon: mdiImageOutline, iconColor: "#62b950" };
                }
                else if (entry.mime_type.startsWith("text/")) {
                    return { icon: mdiFileDocumentOutline, iconColor: "#5fa3c4" };
                }
                else {
                    return { icon: mdiFileOutline, iconColor: null };
                }
            })(),
            ...(kind.value === 'notes' ? { folder: entry.path.slice(0, Math.max(entry.path.lastIndexOf('/'), 0)) } : {}),
            ...(kind.value === 'tasks' ? taskFields(entry.path) : {}),
            ...(kind.value === 'system' ? { purpose: systemFilePurpose(entry.path) } : {}),
            // By the name the Add menu offers it as.
            ...(kind.value === 'templates' ? { title: templateNameOf(entry.path) } : {}),
        };
    }

    // One row for each event a file declares, however often it happens, opening the file.
    function eventRows(entry: ListEntry2): FileRow[] {
        const file = fileRow(entry);
        return declaredEvents(entry.metadata).map(([name, detail]) => {
            const summary = summarizeEvent(detail);
            return {
                ...file,
                key: JSON.stringify([entry.path, name]),
                title: name,
                icon: mdiCalendarClock,
                iconColor: '#b95050',
                note: file.title ?? entry.path,
                starts: summary.start === undefined ? undefined : eventCell(summary.start),
                repeats: summary.repeats,
            };
        });
    }

    function eventCell(start: EventStart): DateCell {
        return { text: start.text, hint: dayjs(start.instant).from(tasks.now), instant: start.instant };
    }

    return { kindEntries, query, isSearching, matchedRows };
}
