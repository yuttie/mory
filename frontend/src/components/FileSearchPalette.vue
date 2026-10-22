<template>
    <!-- The focus stays in the search field, where every key the palette answers is typed. A press
         anywhere else in it, on a tab or a file, would take the focus there and leave the arrows
         to it, so it is kept from moving: the click still lands. -->
    <v-card
        class="file-search d-flex flex-column"
        v-on:mousedown="keepFocus"
    >
        <v-text-field
            ref="fieldEl"
            v-model="queryText"
            variant="solo"
            flat
            single-line
            label="Search"
            placeholder="Title, #tag or /path"
            autocomplete="off"
            hide-details
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            v-bind:aria-controls="LIST_ID"
            v-bind:aria-activedescendant="activeOption && optionId(activeOption)"
            v-bind:prepend-inner-icon="mdiMagnify"
            class="flex-grow-0"
            v-on:keydown="onKeydown"
        ></v-text-field>
        <v-progress-linear
            v-bind:active="files.isLoading"
            indeterminate
            color="primary"
            height="2"
        ></v-progress-linear>
        <!-- Tab moves between them, so none takes the focus from the field. Each as wide as its
             title, so that on a computer's screen all of them are in sight at once. -->
        <v-tabs
            v-model="tab"
            color="primary"
            density="compact"
            class="flex-grow-0 flex-shrink-0"
        >
            <v-tab
                v-for="each of FILE_TABS"
                v-bind:key="each.value"
                v-bind:value="each.value"
                min-width="0"
                tabindex="-1"
            >{{ each.title }}</v-tab>
        </v-tabs>
        <v-divider></v-divider>
        <v-list
            v-bind:id="LIST_ID"
            ref="listEl"
            role="listbox"
            aria-label="Files"
            tabindex="-1"
            density="compact"
            class="file-search__list"
            v-bind:class="{ 'py-0': options.length === 0 }"
        >
            <v-list-item
                v-for="(option, index) of options"
                v-bind:id="optionId(option)"
                v-bind:key="option.key"
                v-bind:active="index === activeIndex"
                v-bind:title="option.title"
                v-bind:subtitle="option.subtitle"
                role="option"
                v-bind:aria-selected="index === activeIndex"
                tabindex="-1"
                color="primary"
                v-on:click="emit('choose', option.to)"
                v-on:mousemove="activeIndex = index"
            >
                <template v-slot:prepend>
                    <v-icon v-bind:color="option.iconColor ?? undefined">{{ option.icon }}</v-icon>
                </template>
                <template
                    v-if="option.row !== null && $vuetify.display.smAndUp"
                    v-slot:append
                >
                    <div class="file-search__aside">
                        <v-chip
                            v-for="tag of shownTags(option.row)"
                            v-bind:key="tag"
                            size="x-small"
                            class="ml-1"
                        >{{ tag }}</v-chip>
                        <span class="text-caption text-medium-emphasis ml-2">{{ sortedOn(option.row) }}</span>
                    </div>
                </template>
            </v-list-item>
        </v-list>
        <!-- Outside the list, which holds only its options, and there before anything is said in
             it, for a screen reader to say it when it is. -->
        <div role="status">
            <div
                v-if="matchedRows.length === 0"
                class="px-4 py-2 text-medium-emphasis"
            >{{ isSearching ? 'Nothing matches.' : 'Nothing to list.' }}</div>
        </div>
        <div
            v-if="errorText !== null"
            class="px-4 py-2 text-caption text-error"
        >{{ errorText }}</div>
        <v-divider class="d-none d-sm-block"></v-divider>
        <div class="file-search__keys d-none d-sm-flex text-caption text-medium-emphasis">
            <span><kbd>↑</kbd> <kbd>↓</kbd> to move</span>
            <span><kbd>Enter</kbd> to open</span>
            <span><kbd>Tab</kbd> for another kind</span>
            <span><kbd>Esc</kbd> to close</span>
        </div>
    </v-card>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import type { RouteLocationRaw } from 'vue-router';
import type { VList, VTextField } from 'vuetify/components';

import { mdiFolderOutline, mdiMagnify } from '@mdi/js';
import axios from 'axios';

import { useAppStore } from '@/stores/app';
import { useFilesStore } from '@/stores/files';
import { FILE_TABS, tabShowsTags, useFileRows } from '@/composables/fileRows';
import type { FileRow } from '@/composables/fileRows';
import { isSearchKey } from '@/keyboard';

interface Option {
    key: string;
    to: RouteLocationRaw;
    title: string;
    subtitle?: string;
    icon: string;
    iconColor: string | null;
    // The file it opens, or `null` for the option that opens the search in the Files view.
    row: FileRow | null;
}

const LIST_ID = 'file-search-list';

// As many as a search for a word or two leaves, without building a row for each of 2,000 files on
// every key. The rest are a press away, in the Files view.
const SHOWN_ROWS = 50;

const emit = defineEmits<{
    (e: 'choose', to: RouteLocationRaw): void;
    (e: 'close'): void;
}>();

const appStore = useAppStore();
const files = useFilesStore();

const queryText = ref('');
const tab = ref(FILE_TABS[0].value);
const activeIndex = ref(0);
const errorText = ref<string | null>(null);

const fieldEl = ref<VTextField | null>(null);
const listEl = ref<VList | null>(null);

const kind = computed(() => FILE_TABS.find((each) => each.value === tab.value)?.kind ?? null);

const { isSearching, matchedRows } = useFileRows(kind, queryText);

const options = computed<Option[]>(() => {
    const rows = [...matchedRows.value].sort(latestFirst).slice(0, SHOWN_ROWS).map((row): Option => ({
        key: row.key,
        to: row.to,
        title: row.title ?? row.path,
        subtitle: detailsOf(row),
        icon: row.icon,
        iconColor: row.iconColor,
        row,
    }));
    if (matchedRows.value.length === 0) {
        return rows;
    }
    const query = queryText.value.trim();
    return [...rows, {
        // No path is empty, so no file takes this key.
        key: '',
        to: { name: 'Files', params: { kind: kind.value }, query: query === '' ? {} : { q: query } },
        title: `Show all ${matchedRows.value.length.toLocaleString()} in Files`,
        icon: mdiFolderOutline,
        iconColor: null,
        row: null,
    }];
});

const activeOption = computed<Option | undefined>(() => options.value[activeIndex.value]);

onMounted(() => {
    // At once, rather than once the field is seen on screen, which Vuetify's `autofocus` waits for:
    // what had the focus would take the keys typed in between, as a note being written its text.
    inputElement()?.focus();
    listFiles();
});

// The listing in memory, which the views sync as they open, synced first only when it is not known
// to be current, as after a save. Not synced again regardless, as the Files view does as it opens:
// a sync replaces the listing even when nothing has changed, and the view under the dialog then
// works out all it shows again, which over Home with 700 tasks held the page for 0.7 s in Chromium
// and 1.7 s in Firefox at each opening.
function listFiles(): void {
    files.list().then(() => {
        errorText.value = null;
    }).catch((error) => {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            appStore.invalidateToken(listFiles);
            return;
        }
        errorText.value = `Could not list the files: ${error instanceof Error ? error.message : String(error)}`;
    });
}

// The latest first, as the Files view sorts each tab until told otherwise: the files last changed,
// and the events last to start, with those that have no start after the rest.
function latestFirst(a: FileRow, b: FileRow): number {
    if (kind.value === 'events') {
        const [startA, startB] = [a.starts?.instant, b.starts?.instant];
        if (startA === undefined || startB === undefined) {
            return (startA === undefined ? 1 : 0) - (startB === undefined ? 1 : 0);
        }
        return startB - startA;
    }
    return b.time.valueOf() - a.time.valueOf();
}

// What the Files view shows of a row beside its title, other than when it was changed or starts,
// which is what the list is sorted on, and the tags.
function detailsOf(row: FileRow): string | undefined {
    const details = [
        row.caption,
        row.folder,
        row.note,
        row.purpose,
        row.status,
        row.dueBy && `Due by ${row.dueBy.text}`,
        row.deadline && `Deadline ${row.deadline.text}`,
        row.repeats,
    ].filter((text): text is string => typeof text === 'string' && text !== '');
    return details.length === 0 ? undefined : details.join(' · ');
}

function shownTags(row: FileRow): string[] {
    return tabShowsTags(kind.value) ? row.tags : [];
}

function sortedOn(row: FileRow): string {
    if (kind.value === 'events') {
        return row.starts?.text ?? '';
    }
    return row.time.format('YYYY-MM-DD HH:mm');
}

function inputElement(): HTMLInputElement | null {
    return fieldEl.value?.$el.querySelector('input') ?? null;
}

function keepFocus(event: MouseEvent): void {
    if (!(event.target instanceof Node && inputElement()?.contains(event.target))) {
        event.preventDefault();
    }
}

function onKeydown(event: KeyboardEvent): void {
    // A key typed into an input method chooses or commits what it offers, as Enter commits a word.
    // Escape gives up the word, and is kept from Vuetify, which would close the dialog with it.
    if (event.isComposing) {
        if (event.key === 'Escape') {
            event.stopPropagation();
        }
        return;
    }
    // Once for each press, as the key opens the dialog. Repeated, it is still the dialog's, not the
    // browser's.
    if (isSearchKey(event)) {
        event.preventDefault();
        if (!event.repeat) {
            emit('close');
        }
        return;
    }
    // To the next kind rather than to the next control: the field is the only one taking the focus.
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        moveTab(event.shiftKey ? -1 : 1);
        return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return;
    }
    switch (event.key) {
        case 'ArrowDown':
            moveTo(wrap(activeIndex.value + 1));
            break;
        case 'ArrowUp':
            moveTo(wrap(activeIndex.value - 1));
            break;
        case 'PageDown':
            moveTo(Math.min(activeIndex.value + pageSize(), options.value.length - 1));
            break;
        case 'PageUp':
            moveTo(Math.max(activeIndex.value - pageSize(), 0));
            break;
        case 'Enter':
            if (activeOption.value !== undefined) {
                emit('choose', activeOption.value.to);
            }
            break;
        default:
            return;
    }
    event.preventDefault();
}

// Round from the last to the first and back, as a palette's list does.
function wrap(index: number): number {
    const count = options.value.length;
    return count === 0 ? 0 : (index + count) % count;
}

// By the file and the kind it is listed under, so that a screen reader says which is chosen
// whenever another is: by place, the first of each search and each kind would have the same ID, and
// none would be said. The key escaped, as an ID cannot hold the spaces a path may, and so is `%`,
// so that no two keys come to share one.
function optionId(option: Option): string {
    const key = option.key.replace(/[%\s]/g, (character) => (
        `%${character.charCodeAt(0).toString(16).padStart(4, '0')}`
    ));
    return `file-search-option-${tab.value}-${key}`;
}

// The row of the option chosen, as drawn.
function activeRow(): HTMLElement | null {
    return activeOption.value === undefined ? null : document.getElementById(optionId(activeOption.value));
}

// One fewer than the list shows, so the option moved from is still in sight.
function pageSize(): number {
    const list = listEl.value?.$el as HTMLElement | undefined;
    const row = activeRow();
    if (!list || !row || row.offsetHeight === 0) {
        return 1;
    }
    return Math.max(1, Math.floor(list.clientHeight / row.offsetHeight) - 1);
}

function moveTo(index: number): void {
    activeIndex.value = index;
    void nextTick(() => {
        activeRow()?.scrollIntoView({ block: 'nearest' });
    });
}

function moveTab(step: number): void {
    const at = FILE_TABS.findIndex((each) => each.value === tab.value);
    tab.value = FILE_TABS[(at + step + FILE_TABS.length) % FILE_TABS.length].value;
}

// A new search, or another kind, starts from its first file. A sync changes the files under the
// same search, and the one chosen stays chosen wherever that moves it, for Enter to open the file
// that was in sight; only once it has gone is the one now in its place chosen.
watch([options, queryText, tab], ([now, query, kind], [before, queryBefore, kindBefore]) => {
    if (query !== queryBefore || kind !== kindBefore) {
        activeIndex.value = 0;
        (listEl.value?.$el as HTMLElement | undefined)?.scrollTo(0, 0);
        return;
    }
    const chosen = before[activeIndex.value]?.key;
    const at = chosen === undefined ? -1 : now.findIndex((option) => option.key === chosen);
    moveTo(at === -1 ? Math.max(0, Math.min(activeIndex.value, now.length - 1)) : at);
});
</script>

<style scoped lang="scss">
.file-search {
    max-height: 100%;
}

.file-search__list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;

    // The highlight is where the arrows have moved to, at once: fading in, it trailed a row or two
    // behind a held key.
    :deep(.v-list-item__overlay) {
        transition: none;
    }
}

.file-search__aside {
    display: flex;
    align-items: center;
    white-space: nowrap;
}

.file-search__keys {
    gap: 16px;
    padding: 8px 16px;

    kbd {
        padding: 0 4px;
        border: thin solid rgba(0, 0, 0, 0.24);
        border-radius: 4px;
        font-family: inherit;
    }
}
</style>
