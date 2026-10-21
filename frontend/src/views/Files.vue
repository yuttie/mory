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
                >{{ $vuetify.display.xs ? tab.short : tab.title }}</v-tab>
            </v-tabs>
            <v-icon-btn
                v-if="kind === 'media'"
                v-bind:icon="mediaLayout === 'grid' ? mdiViewListOutline : mdiViewGridOutline"
                v-bind:title="mediaLayout === 'grid' ? 'Show as a list' : 'Show as thumbnails'"
                v-bind:aria-label="mediaLayout === 'grid' ? 'Show as a list' : 'Show as thumbnails'"
                class="ml-1"
                v-on:click="mediaLayout = mediaLayout === 'grid' ? 'list' : 'grid'"
            ></v-icon-btn>
            <v-icon-btn
                v-bind:icon="mdiDelete"
                icon-color="pink"
                v-bind:disabled="selected.length === 0"
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
                v-bind:headers="headers"
                v-bind:items="matchedEntries"
                v-model="selected"
                v-model:sort-by="sortBy"
                v-bind:items-per-page="20"
                v-bind:items-per-page-options="[20, 50, 100, -1]"
                items-per-page-text=""
                v-bind:mobile-breakpoint="0"
                item-value="path"
                must-sort
                show-select
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

import { useRoute, useRouter } from 'vue-router';
import type { RouteLocationRaw } from 'vue-router';
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
import { nextOccurrences, summarizeEvents } from '@/event-summary';
import type { EventStart } from '@/event-summary';
import { fileKindOf, isOfKind, isTemplatePath, SYSTEM_DIR, templateNameOf } from '@/file-kinds';
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

import dayjs from 'dayjs';

// The full title is cut short on a phone, where more of them are then in sight at once.
const TABS: { kind: FileKind | null; value: string; title: string; short: string }[] = [
    { kind: null, value: 'all', title: 'All files', short: 'All' },
    { kind: 'notes', value: 'notes', title: 'Notes', short: 'Notes' },
    { kind: 'tasks', value: 'tasks', title: 'Tasks', short: 'Tasks' },
    { kind: 'media', value: 'media', title: 'Media files', short: 'Media' },
    { kind: 'templates', value: 'templates', title: 'Templates', short: 'Templates' },
    { kind: 'events', value: 'events', title: 'Events', short: 'Events' },
    { kind: 'system', value: 'system', title: 'System files', short: 'System' },
    { kind: 'others', value: 'others', title: 'Uncategorized', short: 'Uncategorized' },
];

// A date as its note gives it, in the reader's zone where it has a time, with how far off it is to
// hover. A task's is coloured as the task lists colour it.
interface DateCell {
    text: string;
    hint: string;
    color?: string;
    instant?: number;
}

const DATE_COLUMNS = ['dueBy', 'deadline', 'starts', 'next'] as const;

interface FileRow {
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
    // An event note's: when its events start, how they repeat, and when one next happens.
    starts?: DateCell;
    repeats?: string;
    next?: DateCell;
    urgency?: Urgency;
}

const DEFAULT_SORT: DataTableSortItem[] = [{ key: 'time', order: 'desc' }];

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
const showingTagList = ref(false);
// Each tab keeps its own sort, as each has columns of its own: one sorted by urgency would sort
// the notes by nothing.
const sortBys = reactive<Record<string, DataTableSortItem[]>>({});
// Thumbnails unless asked otherwise, as what tells one image from another is what it shows.
const mediaLayout = useLocalStorage<'grid' | 'list'>('files-media-layout', 'grid');

// Template Refs
const queryEl = ref<any>(null);

// Computed properties
const kind = computed(() => fileKindOf(route.params.kind));

const currentTab = computed(() => kind.value ?? 'all');

// The files the open tab lists, before the query narrows them.
const kindEntries = computed<ListEntry2[]>(() => {
    const open = kind.value;
    return open === null ? files.entries : files.entries.filter((entry) => isOfKind(entry, open));
});

// Expanded apart from the rows, so that typing a search does not expand every rule again. The clock
// is the task lists', which moves on each minute.
const nextOccurrence = computed(() => kind.value === 'events'
    ? nextOccurrences(kindEntries.value, tasks.now)
    : new Map<string, EventStart>());

const sortBy = computed<DataTableSortItem[]>({
    get: () => sortBys[currentTab.value] ?? DEFAULT_SORT,
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
                { title: 'Status', key: 'status', value: (row: FileRow) => row.statusOrder },
                { title: 'Due by', key: 'dueBy', value: (row: FileRow) => row.dueBy?.instant, sort: missingLast('dueBy') },
                { title: 'Deadline', key: 'deadline', value: (row: FileRow) => row.deadline?.instant, sort: missingLast('deadline') },
                // Ascending from the calmest, as every other column starts from its least.
                { title: 'Urgency', key: 'urgency', sort: (a: Urgency, b: Urgency) => compareUrgency(b, a) },
                modified,
                tags,
            ];
        case 'media':
            return [title, modified, size, type];
        // What a template is for, next to it, as the Add menu offers it.
        case 'templates':
            return [{ ...title, title: 'Name' }, { title: '', key: 'newNote', sortable: false }, modified, size];
        // When, rather than how large: an event note is found by the day it is about.
        case 'events':
            return [
                title,
                { title: 'Starts', key: 'starts', value: (row: FileRow) => row.starts?.instant, sort: missingLast('starts') },
                // A line of its own, as the dates beside it have: wrapped, it broke an `until` date
                // at its hyphen.
                { title: 'Repeats', key: 'repeats', nowrap: true },
                { title: 'Next', key: 'next', value: (row: FileRow) => row.next?.instant, sort: missingLast('next') },
                modified,
                tags,
            ];
        case 'system':
            return [title, { title: 'Used for', key: 'purpose' }, modified, size];
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
    const matched = [];

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
        if (queryAny.some(kw => !entryPath.includes(kw) && !entryTags.some(entryTag => entryTag.includes(kw)) && !entryTitle.includes(kw))) {
            continue;
        }
        // OK, this entry matches all the queries
        matched.push({
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
            ...(kind.value === 'events' ? eventFields(entry) : {}),
            // By the name the Add menu offers it as.
            ...(kind.value === 'templates' ? { title: templateNameOf(entry.path) } : {}),
        });
    }

    return matched;
});

// Lifecycle hooks
onMounted(() => {
    document.title = `Files | ${import.meta.env.VITE_APP_NAME}`;

    load();

    if (route.query.q) {
        queryText.value = route.query.q as string;
    }
});

useShortcuts(handleKeydown);

// Methods
// A template by its path, as its heading is often only placeholders to fill in.
function titleOf(entry: ListEntry2): string | null {
    return isTemplatePath(entry.path) ? null : entry.title;
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

function eventFields(entry: ListEntry2): Partial<FileRow> {
    const summary = summarizeEvents(entry.metadata?.events);
    const next = nextOccurrence.value.get(entry.path);
    return {
        starts: summary.start === undefined ? undefined : eventCell(summary.start),
        repeats: summary.repeats,
        next: next === undefined ? undefined : eventCell(next),
    };
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
// neither the most pressing nor the least. Vuetify swaps the two values to sort descending, so the
// comparison has to know which way it sorts to keep them there.
function missingLast(key: string) {
    return (a: number | undefined, b: number | undefined): number => {
        if (a !== undefined && b !== undefined) {
            return a - b;
        }
        if (a === b) {
            return 0;
        }
        const descending = sortBy.value.some((item) => item.key === key && item.order === 'desc');
        return (a === undefined) !== descending ? 1 : -1;
    };
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

function deleteSelected() {
    for (const path of selected.value) {
        // The store drops the entry from the shared list and invalidates its cache.
        files.remove(path)
            .then(deleted => {
                if (!deleted) {
                    error.value = true;
                    errorText.value = `Something wrong happened when deleting ${path}`;
                }
            }).catch(err => {
                if (err.response) {
                    if (err.response.status === 401) {
                        // Unauthorized
                        emit('tokenExpired', () => deleteSelected());
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
}

// Watchers
// Files selected on one tab and out of sight on the next would be deleted unseen.
watch(kind, () => {
    selected.value = [];
});

watch(queryText, (q: string | null) => {
    if (q === null) {
        q = '';
        // Workaround: 'clearable' <v-text-field> sets its model to null
        queryText.value = '';
    }
    if (q !== route.query.q) {
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
