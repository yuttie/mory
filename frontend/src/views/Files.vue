<template>
    <div id="files" class="d-flex flex-column">
        <AppBarContent>
            <v-text-field
                v-model="queryText"
                variant="solo"
                single-line
                clearable
                v-on:click:clear="clearQuery"
                type="text"
                label="Search"
                autocomplete="off"
                hide-details="auto"
                ref="queryEl"
                class="ms-2 me-1 flex-grow-1"
            >
                <template v-slot:prepend-inner>
                    <v-icon>{{ mdiMagnify }}</v-icon>
                </template>
                <template v-slot:append>
                    <v-menu
                        v-model="showingTagList"
                        v-bind:close-on-content-click="false"
                        location="bottom"
                    >
                        <template v-slot:activator="{ props: menuProps }">
                            <v-icon-btn
                                v-bind:icon="mdiTag"
                                v-bind="menuProps"
                                class="mr-2"
                            ></v-icon-btn>
                        </template>
                        <v-card>
                            <v-card-text class="all-tags d-flex flex-row align-center flex-wrap">
                                <v-chip
                                    class="ma-1"
                                    v-for="tag of tags"
                                    v-bind:key="tag"
                                    v-bind:color="tagColor(tag)"
                                    v-bind:variant="tagOutlined(tag) ? 'outlined' : 'flat'"
                                    v-on:click="handleTagClick(tag, $event)"
                                >{{ tag }}</v-chip>
                            </v-card-text>
                        </v-card>
                    </v-menu>
                </template>
            </v-text-field>
        </AppBarContent>
        <div class="files-bar d-flex align-center">
            <!-- `exact`: every tab is the one route, and only the tab whose kind is the address's
                 own is current. Where they do not all fit, they scroll, and the current one is
                 brought into sight. -->
            <v-tabs
                v-bind:model-value="currentTab"
                color="primary"
                class="flex-grow-1"
            >
                <!-- On a phone, the width a tab is given at least would leave room for three. -->
                <v-tab
                    v-for="tab of TABS"
                    v-bind:key="tab.value"
                    v-bind:value="tab.value"
                    v-bind:to="tabRoute(tab.kind)"
                    v-bind:min-width="$vuetify.display.xs ? 0 : undefined"
                    exact
                >{{ tab.title }}</v-tab>
            </v-tabs>
            <v-icon-btn
                v-if="kind === 'media'"
                v-bind:icon="mediaLayout === 'grid' ? mdiViewListOutline : mdiViewGridOutline"
                v-bind:title="mediaLayout === 'grid' ? 'Show as a list' : 'Show as thumbnails'"
                v-bind:aria-label="mediaLayout === 'grid' ? 'Show as a list' : 'Show as thumbnails'"
                class="ml-1"
                v-on:click="mediaLayout = mediaLayout === 'grid' ? 'list' : 'grid'"
            ></v-icon-btn>
            <!-- An event's row is not a file to delete, and its file holds other events too. -->
            <v-icon-btn
                v-if="kind !== 'events'"
                v-bind:icon="mdiDelete"
                icon-color="pink"
                v-bind:disabled="selected.length === 0 || deleting"
                title="Delete the selected files"
                aria-label="Delete the selected files"
                v-on:click="deleteSelected"
                class="mx-1"
            ></v-icon-btn>
        </div>
        <v-defaults-provider v-bind:defaults="{ VPagination: { size: 'small' } }">
            <MediaGrid
                v-if="kind === 'media' && mediaLayout === 'grid'"
                v-model:selected="selected"
                v-model:sort-by="sortBy"
                v-bind:items="matchedEntries"
                class="flex-grow-1"
            />
            <v-data-table
                v-else
                ref="tableEl"
                v-bind:headers="headers"
                v-bind:items="matchedEntries"
                v-model="selected"
                v-model:sort-by="sortBy"
                v-model:page="page"
                v-bind:items-per-page="20"
                v-bind:items-per-page-options="[20, 50, 100, -1]"
                items-per-page-text=""
                v-bind:mobile-breakpoint="0"
                item-value="key"
                must-sort
                v-bind:show-select="kind !== 'events'"
                fixed-header
                class="file-table flex-grow-1"
            >
                <template v-slot:item.path="{ item }">
                    <div class="path" v-bind:title="item.title ?? item.path">
                        <v-icon class="mr-1" v-bind:color="item.iconColor">{{ item.icon }}</v-icon>
                        <router-link v-bind:to="item.to" class="truncate">{{ item.title ?? item.path }}</router-link>
                        <div
                            v-if="item.caption"
                            class="caption truncate text-caption text-medium-emphasis"
                        >{{ item.caption }}</div>
                    </div>
                </template>
                <template v-slot:item.note="{ item }">
                    <div
                        class="note"
                        v-bind:title="item.path"
                    >
                        <router-link
                            v-bind:to="item.to"
                            class="truncate"
                        >{{ item.note }}</router-link>
                    </div>
                </template>
                <template v-slot:item.newNote="{ item }">
                    <v-btn
                        v-bind:to="{ name: 'Create', query: { from: item.path } }"
                        v-bind:prepend-icon="mdiFileOutline"
                        variant="text"
                        size="small"
                        class="text-none"
                    >New note</v-btn>
                </template>
                <template v-slot:item.folder="{ item }">
                    <div class="folder text-no-wrap">{{ item.folder }}</div>
                </template>
                <template v-slot:item.status="{ item }">
                    <div class="text-no-wrap">{{ item.status }}</div>
                </template>
                <template
                    v-for="column of DATE_COLUMNS"
                    v-slot:[`item.${column}`]="{ item }"
                >
                    <div
                        v-if="item[column]"
                        v-bind:key="column"
                        class="text-no-wrap"
                        v-bind:class="item[column].color ? `text-${item[column].color}` : undefined"
                        v-bind:title="item[column].hint"
                    >{{ item[column].text }}</div>
                </template>
                <template v-slot:item.urgency="{ item }">
                    <v-chip
                        v-if="item.urgency && item.urgency.level !== 'none'"
                        size="x-small"
                    >{{ URGENCY_LABEL[item.urgency.level] }}</v-chip>
                </template>
                <template v-slot:item.time="{ item }">
                    <div class="modified text-no-wrap">{{ item.time.format('YYYY-MM-DD HH:mm:ss') }}</div>
                </template>
                <template v-slot:item.size="{ item }">
                    <div class="size text-no-wrap">{{ formatFileSize(item.size) }}</div>
                </template>
                <template v-slot:item.mimeType="{ item }">
                    <div class="mime-type text-no-wrap">{{ item.mimeType }}</div>
                </template>
                <template v-slot:item.tags="{ item }">
                    <div class="tags">
                        <v-chip
                            class="ma-1"
                            v-for="tag of item.tags"
                            v-bind:key="tag"
                            v-bind:color="tagColor(tag)"
                            v-bind:variant="tagOutlined(tag) ? 'outlined' : 'flat'"
                            v-on:click="handleTagClick(tag, $event)"
                        >{{ tag }}</v-chip>
                    </div>
                </template>
            </v-data-table>
        </v-defaults-provider>
        <v-overlay v-bind:model-value="isLoading" z-index="10" scrim="transparent" class="align-center justify-center">
            <v-progress-circular indeterminate color="blue-grey-lighten-3" size="64"></v-progress-circular>
        </v-overlay>
        <v-snackbar v-model="error" color="error" location="top" timeout="5000">{{ errorText }}</v-snackbar>
    </div>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import type { ComponentPublicInstance } from 'vue';

import { useRoute, useRouter } from 'vue-router';
import type { LocationQuery, RouteLocationRaw } from 'vue-router';
import type { DataTableHeader, DataTableSortItem } from 'vuetify';

import {
    mdiCalendarClock,
    mdiCheckboxMarkedOutline,
    mdiCogOutline,
    mdiDelete,
    mdiFileDocumentOutline,
    mdiFileOutline,
    mdiImageOutline,
    mdiMagnify,
    mdiTag,
    mdiViewGridOutline,
    mdiViewListOutline,
} from '@mdi/js';

import { compareTags } from '@/api';
import type { ListEntry2 } from '@/api';

import { useFilesStore } from '@/stores/files';
import { useTasksStore } from '@/stores/tasks';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { routeForMime } from '@/file-route';
import { EVENTS_DIR } from '@/event-note';
import { summarizeEvent } from '@/event-summary';
import type { EventStart } from '@/event-summary';
import { declaredEvents, fileKindOf, isOfKind, isTemplatePath, SYSTEM_DIR, templateNameOf } from '@/file-kinds';
import type { FileKind } from '@/file-kinds';
import { systemFilePurpose } from '@/system-files';
import { STATUS_KINDS, STATUS_LABEL } from '@/task';
import { statusColor } from '@/status-color';
import { statusIcon } from '@/status-icon';
import { taskDateCues } from '@/task-date-cues';
import type { TaskDateCue, TaskDateField } from '@/task-date-cues';
import { taskRoute } from '@/task-route';
import { compareUrgency, taskInstant, URGENCY_LABEL } from '@/urgency';
import type { Urgency } from '@/urgency';
import AppBarContent from '@/components/AppBarContent.vue';
import MediaGrid from '@/components/MediaGrid.vue';
import { useLocalStorage } from '@/composables/localStorage';
import { isInOverlay, isTyping, useShortcuts } from '@/keyboard';

import axios from 'axios';
import dayjs from 'dayjs';

// Each by what it lists alone, as the view's own name says they are files. What is written comes
// first, as the app's other views show it, then the files that serve it, and last those of the
// application and the rest, which a phone reaches only by scrolling.
const TABS: { kind: FileKind | null; value: string; title: string }[] = [
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
interface DateCell {
    text: string;
    hint: string;
    color?: string;
    instant?: number;
}

const DATE_COLUMNS = ['dueBy', 'deadline', 'starts'] as const;

// Text by the numbers in it as numbers, so "On 2 dates" comes before "On 10 dates".
const TEXT_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'accent' });

interface FileRow {
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

// The latest first: the files last changed, and the events last to start.
const DEFAULT_SORT: DataTableSortItem[] = [{ key: 'time', order: 'desc' }];
const EVENTS_SORT: DataTableSortItem[] = [{ key: 'starts', order: 'desc' }];

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Composables
const router = useRouter();
const route = useRoute();
const files = useFilesStore();
const tasks = useTasksStore();
const taskSettings = useTaskSettingsStore();

// The status colours and lead times the Tasks tab draws with.
void taskSettings.load();

// Reactive states
const queryText = ref('');
const isLoading = ref(false);
const error = ref(false);
const errorText = ref('');
const selected = ref([] as string[]);
// While the selection is being deleted, which a second press would ask to delete again.
const deleting = ref(false);
const showingTagList = ref(false);
// Each tab keeps its own sort, as each has columns of its own: one sorted by urgency would sort
// the notes by nothing.
const sortBys = reactive<Record<string, DataTableSortItem[]>>({});
// One table serves every tab, so the page and the scroll it is at would carry over to the next,
// where row 41 of one list has nothing to do with row 41 of another.
const page = ref(1);
// Thumbnails unless asked otherwise, as what tells one image from another is what it shows.
const mediaLayout = useLocalStorage<'grid' | 'list'>('files-media-layout', 'grid');

// Template Refs
const queryEl = ref<any>(null);
const tableEl = ref<ComponentPublicInstance | null>(null);

// Computed properties
const kind = computed(() => fileKindOf(route.params.kind));

const currentTab = computed(() => kind.value ?? 'all');

// The files the open tab lists, before the query narrows them.
const kindEntries = computed<ListEntry2[]>(() => {
    const open = kind.value;
    return open === null ? files.entries : files.entries.filter((entry) => isOfKind(entry, open));
});

const sortBy = computed<DataTableSortItem[]>({
    get: () => sortBys[currentTab.value] ?? (kind.value === 'events' ? EVENTS_SORT : DEFAULT_SORT),
    set: (value) => {
        sortBys[currentTab.value] = value;
    },
});

// What each tab's files have to tell apart: a task's progress, which a size or a type does not
// show, and the type of a medium, where every note and task is one kind of text.
const headers = computed<DataTableHeader<FileRow>[]>(() => {
    // Sorted by what it shows, rather than by a path the title hides.
    const title = { title: 'Title or Path', key: 'path', value: (row: FileRow) => row.title ?? row.path };
    const modified = { title: 'Modified', key: 'time', value: (row: FileRow) => row.time.valueOf() };
    const size = { title: 'Size', key: 'size' };
    const type = { title: 'Type', key: 'mimeType' };
    const tags = { title: 'Tags', key: 'tags', sortable: false };
    switch (kind.value) {
        case 'notes':
            return [title, { title: 'Folder', key: 'folder' }, modified, size, tags];
        case 'tasks':
            return [
                { ...title, title: 'Title' },
                { title: 'Status', key: 'status', value: (row: FileRow) => row.statusOrder, sort: missingLast('status', byNumber) },
                { title: 'Due by', key: 'dueBy', value: (row: FileRow) => row.dueBy?.instant, sort: missingLast('dueBy', byNumber) },
                { title: 'Deadline', key: 'deadline', value: (row: FileRow) => row.deadline?.instant, sort: missingLast('deadline', byNumber) },
                // Ascending from the calmest, as every other column starts from its least.
                { title: 'Urgency', key: 'urgency', sort: missingLast('urgency', (a: Urgency, b: Urgency) => compareUrgency(b, a)) },
                modified,
                tags,
            ];
        case 'media':
            return [title, modified, size, type];
        // What a template is for, next to it, as the Add menu offers it.
        case 'templates':
            return [{ ...title, title: 'Name' }, { title: '', key: 'newNote', sortable: false }, modified, size];
        // An event as its file declares it, however often that makes it happen: when it starts,
        // rather than when its file last changed. Tags are its note's, not its own.
        case 'events':
            return [
                { ...title, title: 'Event' },
                { title: 'Note', key: 'note' },
                { title: 'Starts', key: 'starts', value: (row: FileRow) => row.starts?.instant, sort: missingLast('starts', byNumber) },
                // A line of its own, as the date beside it has: wrapped, it broke an `until` date at
                // its hyphen.
                { title: 'Repeats', key: 'repeats', nowrap: true, sort: missingLast('repeats', byText) },
            ];
        case 'system':
            return [{ ...title, title: 'Path' }, { title: 'Used for', key: 'purpose', sort: missingLast('purpose', byText) }, modified, size];
        // Few files no other tab takes are notes, so few have tags.
        case 'others':
            return [{ ...title, title: 'Path' }, modified, size, type];
        default:
            return [title, modified, size, type, tags];
    }
});

const tags = computed(() => {
    const tags = new Set();
    for (const entry of kindEntries.value) {
        if (entry.metadata !== null) {
            if (Object.hasOwn(entry.metadata, 'tags') && Array.isArray(entry.metadata.tags)) {
                for (const tag of entry.metadata.tags.map(String)) {
                    tags.add(tag);
                }
            }
        }
    }
    return Array.from(tags).sort(compareTags as (a: any, b: any) => number) as string[];
});

const query = computed(() => {
    const queryPaths = new Set();
    const queryTags = new Set();
    const queryAny = new Set();
    for (const match of queryText.value.matchAll(/"([^"]+)"|([^\s]+)/g)) {
        const text = match[1] || match[2];
        if (text.startsWith('#')) {
            queryTags.add(text.slice(1));
        }
        else if (text.startsWith('/')) {
            queryPaths.add(text.slice(1));
        }
        else {
            queryAny.add(text);
        }
    }

    return {
        paths: queryPaths,
        tags: queryTags,
        any: queryAny,
    };
});

const matchedEntries = computed(() => {
    const matched: FileRow[] = [];

    const queryPaths: string[] = [...query.value.paths].map(x => x.toLowerCase());
    const queryTags: string[] = [...query.value.tags].map(x => x.toLowerCase());
    const queryAny: string[] = [...query.value.any].map(x => x.toLowerCase());

    for (const entry of kindEntries.value) {
        const entryPath = entry.path.toLowerCase();
        const entryTitle = titleOf(entry)?.toLowerCase() ?? "";
        const entryTags = (() => {
            if (entry.metadata === null) {
                return [];
            }
            else if (!Object.hasOwn(entry.metadata, 'tags')) {
                return [];
            }
            else if (!Array.isArray(entry.metadata.tags)) {
                return [];
            }
            else {
                return entry.metadata.tags.map((tag: any) => String(tag).toLowerCase());
            }
        })();
        // Check if all conditions are met or not
        if (queryPaths.some(kw => !entryPath.includes(kw))) {
            continue;
        }
        if (queryTags.some(tag => !entryTags.some(entryTag => entryTag.includes(tag)))) {
            continue;
        }
        // The rest may be anywhere in the file's path, tags or title, or in an event's name, so a
        // file can match by some of its events alone.
        const matchesAny = (...own: string[]) => queryAny.every(kw => entryPath.includes(kw)
            || entryTags.some(entryTag => entryTag.includes(kw))
            || entryTitle.includes(kw)
            || own.some(text => text.includes(kw)));
        if (kind.value === 'events') {
            matched.push(...eventRows(entry).filter(row => matchesAny(row.title?.toLowerCase() ?? '')));
        }
        else if (matchesAny()) {
            matched.push(fileRow(entry));
        }
    }

    return matched;
});

// Lifecycle hooks
onMounted(() => {
    document.title = `Files | ${import.meta.env.VITE_APP_NAME}`;

    load();
});

useShortcuts(handleKeydown);

// Methods
// A file by its path where its title would mislead: a template, as its heading is often only
// placeholders to fill in, a system file, which the application reads by its path, and a file no
// other tab takes, which is there for where it is or what it is named.
function titleOf(entry: ListEntry2): string | null {
    return kind.value === 'system' || kind.value === 'others' || isTemplatePath(entry.path) ? null : entry.title;
}

// The search goes along, so a query asked of every file can be put to one kind of them.
function tabRoute(tabKind: FileKind | null) {
    return { name: 'Files', params: { kind: tabKind }, query: route.query };
}

// A task as the task lists show it, and opening into its editor there. The listing describes a file
// the task tree may not have taken in yet, which is then listed as any other file is.
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
        tags: ((entry.metadata || {}).tags || []).map(String).sort(compareTags),
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

// Rows without a value go last whichever way the column is sorted: a task with no deadline is
// neither the most pressing nor the least, and a file the task tree left out has no status or
// urgency at all. Vuetify swaps the two values to sort descending, so the comparison has to know
// which way it sorts to keep them there.
function missingLast<T>(key: string, compare: (a: T, b: T) => number) {
    return (a: T | undefined, b: T | undefined): number => {
        if (a !== undefined && b !== undefined) {
            return compare(a, b);
        }
        if (a === b) {
            return 0;
        }
        const descending = sortBy.value.some((item) => item.key === key && item.order === 'desc');
        return (a === undefined) !== descending ? 1 : -1;
    };
}

function byNumber(a: number, b: number): number {
    return a - b;
}

function byText(a: string, b: string): number {
    return TEXT_ORDER.compare(a, b);
}

// An address with no search, or a malformed one, searches for nothing.
function queryTextOf(q: LocationQuery[string] | undefined): string {
    return typeof q === 'string' ? q : '';
}

function load() {
    isLoading.value = true;
    files.refresh()
        .then(loaded => {
            isLoading.value = false;

            // Check if metadata parse errors exist
            for (const entry of loaded) {
                if (entry.metadata !== null && Object.hasOwn(entry.metadata, 'error')) {
                    console.log(`Failed to parse metadata of ${entry.path}!`);
                    console.log(entry);
                }
            }
        }).catch(err => {
            if (err.response) {
                if (err.response.status === 401) {
                    // Unauthorized
                    emit('tokenExpired', () => load());
                }
                else {
                    error.value = true;
                    errorText.value = err.toString();
                    isLoading.value = false;
                    throw err;
                }
            }
            else {
                error.value = true;
                errorText.value = err.toString();
                isLoading.value = false;
                throw err;
            }
        });
}

function handleKeydown(e: KeyboardEvent) {
    if (isTyping(e) || isInOverlay(e)) {
        return;
    }
    if (e.key === '/') {
        queryEl.value?.focus();
        e.preventDefault();
    }
}

function clearQuery(_e: MouseEvent) {
    queryText.value = '';
}

function handleTagClick(tag: string, e: MouseEvent | KeyboardEvent) {
    if (e.ctrlKey) {
        toggleTag(tag);
    }
    else {
        if (query.value.tags.size === 1 && query.value.tags.has(tag)) {
            removeTag(tag);
        }
        else {
            selectSingleTag(tag);
        }
    }
}

function selectSingleTag(tag: string) {
    let hashtag = '#' + tag;
    if (/\s/.test(hashtag)) {
        hashtag = `"${hashtag}"`;
    }

    let queryElems = [...queryText.value.matchAll(/("[^"]+")|([^\s]+)/g)].map(x => x[1] || x[2]);
    queryElems = queryElems.filter(x => x === hashtag || !(x.startsWith('#') || x.startsWith('"#')));
    if (!query.value.tags.has(tag)) {
        queryElems.push(hashtag);
    }
    queryText.value = queryElems.join(' ');
}

function addTag(tag: string) {
    let hashtag = '#' + tag;
    if (/\s/.test(hashtag)) {
        hashtag = `"${hashtag}"`;
    }

    const queryElems = [...queryText.value.matchAll(/("[^"]+")|([^\s]+)/g)].map(x => x[1] || x[2]);
    if (!query.value.tags.has(tag)) {
        queryElems.push(hashtag);
    }

    queryText.value = queryElems.join(' ');
}

function removeTag(tag: string) {
    let hashtag = '#' + tag;
    if (/\s/.test(hashtag)) {
        hashtag = `"${hashtag}"`;
    }

    let queryElems = [...queryText.value.matchAll(/("[^"]+")|([^\s]+)/g)].map(x => x[1] || x[2]);
    queryElems = queryElems.filter(x => x !== hashtag);

    queryText.value = queryElems.join(' ');
}

function toggleTag(tag: string) {
    if (query.value.tags.has(tag)) {
        removeTag(tag);
    }
    else {
        addTag(tag);
    }
}

function tagOutlined(tag: string) {
    const queryTags: string[] = [...query.value.tags].map(x => x.toLowerCase());
    const queryAny: string[] = [...query.value.any].map(x => x.toLowerCase());
    if (queryTags.some(x => tag.toLowerCase().includes(x)) || queryAny.some(x => tag.toLowerCase().includes(x))) {
        return false;
    }
    else {
        return true;
    }
}

function tagColor(tag: string) {
    const queryTags: string[] = [...query.value.tags].map(x => x.toLowerCase());
    const queryAny: string[] = [...query.value.any].map(x => x.toLowerCase());
    if (queryTags.some(x => tag.toLowerCase().includes(x)) || queryAny.some(x => tag.toLowerCase().includes(x))) {
        return 'primary';
    }
    else {
        return 'normal';
    }
}

function formatFileSize(size: number) {
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    let i = 0;
    while (size >= 0.9 * 1024 && i < units.length - 1) {
        size /= 1024;
        i += 1;
    }
    if (i === 0) {
        return `${size.toFixed(0)} ${units[i]}`;
    }
    else {
        return `${size.toFixed(1)} ${units[i]}`;
    }
}

// One at a time, and a file deeper in before one further out, so a task selected together with
// its subtasks is deleted after them rather than refused for having them.
async function deleteSelected() {
    if (deleting.value) {
        return;
    }
    deleting.value = true;
    try {
        await deleteEach([...selected.value].sort((a, b) => b.split('/').length - a.split('/').length));
    }
    finally {
        deleting.value = false;
    }
}

async function deleteEach(paths: string[]) {
    for (const path of paths) {
        const id = tasks.idByPath(path);
        try {
            // A task as the task view deletes it, which refuses one with subtasks: they are in the
            // directory it names, which deleting its file would leave at the top of the tree.
            // Either store drops the entry from the shared list and invalidates its cache.
            const deleted = await (id === undefined ? files.remove(path) : tasks.remove(path));
            if (!deleted) {
                error.value = true;
                errorText.value = `Something wrong happened when deleting ${path}`;
            }
            else {
                // Gone, so a second press would only ask to delete it again, and be refused.
                selected.value = selected.value.filter((each) => each !== path);
            }
        }
        catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 401) {
                // Unauthorized. What is left is still selected, for the retry to delete.
                emit('tokenExpired', () => deleteSelected());
                return;
            }
            error.value = true;
            errorText.value = id === undefined
                ? String(err)
                : `Could not delete "${tasks.node(id)?.title || 'Untitled'}": ${err instanceof Error ? err.message : String(err)}`;
        }
    }
}

// Watchers
// Files selected on one tab and out of sight on the next would be deleted unseen.
watch(kind, () => {
    selected.value = [];
    page.value = 1;
    tableEl.value?.$el.querySelector('.v-table__wrapper')?.scrollTo(0, 0);
});

// So would media selected in one layout and shown in the other, which pages them by a different
// number: a page of thumbnails selected holds 30 files more than the first page of the list shows.
watch(mediaLayout, () => {
    selected.value = [];
});

// So would a file the search hides, which found again would come back selected.
watch(matchedEntries, (matched) => {
    const shown = new Set(matched.map((row) => row.key));
    if (selected.value.some((key) => !shown.has(key))) {
        selected.value = selected.value.filter((key) => shown.has(key));
    }
});

// The search is in the address, so going back or forth to another one brings that search back,
// rather than leaving the box and the rows to the last one typed. Whatever the box is set to here
// is what the address already says, so the watcher below writes nothing back, even for the address
// of a view this one is leaving for.
watch(() => route.query.q, (q) => {
    const routeText = queryTextOf(q);
    if (routeText !== queryText.value) {
        queryText.value = routeText;
    }
}, { immediate: true });

watch(queryText, (q: string | null) => {
    if (q === null) {
        q = '';
        // Workaround: 'clearable' <v-text-field> sets its model to null
        queryText.value = '';
    }
    if (q !== queryTextOf(route.query.q)) {
        router.replace({
            query: {
                ...route.query,
                q: q,
            },
        });
    }
});
</script>

<style scoped lang="scss">
#files {
    // The window less the layout's bars, as in the Calendar view: `height: 100%` resolves against
    // `v-main`, which grows with its contents, so a hundred rows scrolled the whole app.
    height: calc(100dvh - var(--v-layout-top, 0px) - var(--v-layout-bottom, 0px));
}

.files-bar {
    border-bottom: thin solid rgba(0, 0, 0, 0.12);
}

// A flex item does not shrink below its contents by default. Letting the table shrink leaves the
// rows to its own scrolling wrapper, so the toolbar above and the pagination footer below stay put.
.file-table,
.media-grid {
    min-height: 0;

    // On a 360 px phone the footer wrapped, taking a second row from the list. The small buttons
    // set above were not enough alone, so it also gives up spacing that is not a control: the
    // margin around each button, half the padding beside the page info, and the padding after the
    // per-page label this view leaves empty. Then even "2101-2170 of 2170" fits on one row.
    :deep(.v-pagination__list > li) {
        margin: 0;
    }

    :deep(.v-data-table-footer__info) {
        padding: 0 8px;
    }

    :deep(.v-data-table-footer__items-per-page > span:empty) {
        display: none;
    }
}

.all-tags {
    max-height: 30em;
    overflow-y: auto;
}

.path,
.note,
.modified,
.size,
.mime-type {
    user-select: text;
}

// The title's track asks for the whole title but can give all of it up, so the column widens as
// far as the table has room and the title is cut only at the column's own edge, never at a fixed
// width with room to spare. The floor is for a table wider than the screen, as the unwrapped tags
// often make it: every column then shrinks to its minimum, which here would be the icon alone.
// The icon's track is not `auto`, which would take the spare width and push the title right.
.path {
    display: grid;
    grid-template-columns: max-content minmax(0, max-content);
    align-items: center;
    min-width: 20em;
    white-space: nowrap;

    .caption {
        grid-column: 2;
    }
}

// An event's note, cut as a title is, to a lower floor: the event's name beside it says more.
.note {
    display: grid;
    grid-template-columns: minmax(0, max-content);
    min-width: 10em;
    white-space: nowrap;
}

.path,
.note {
    a {
        color: rgba(0, 0, 0, 0.87);
        text-decoration: none;

        &:hover {
            color: rgb(var(--v-theme-primary));
            text-decoration: underline;
        }
    }
}

.tags {
    white-space: nowrap;
}

.truncate {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
