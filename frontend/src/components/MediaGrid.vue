<!-- The media files as thumbnails: the grid the Files view offers in place of its table, selected,
     sorted and paged as the table is. -->
<template>
    <v-data-iterator
        v-model="selected"
        v-model:sort-by="sortBy"
        v-bind:items="items"
        v-bind:custom-key-sort="CUSTOM_KEY_SORT"
        v-bind:items-per-page="50"
        item-value="path"
        must-sort
        class="media-grid"
    >
        <!-- The table's header row, for a grid: what selects the page, and what sorts it. -->
        <template #header="{ items: pageItems, isSelected, selectAll, toggleSort }">
            <div class="grid-header d-flex align-center">
                <v-checkbox-btn
                    v-bind:model-value="pageItems.length > 0 && isSelected([...pageItems])"
                    v-bind:indeterminate="!isSelected([...pageItems]) && pageItems.some((item) => isSelected(item))"
                    v-bind:disabled="pageItems.length === 0"
                    aria-label="Select the page"
                    class="flex-grow-0 ml-1"
                    v-on:update:model-value="selectAll(!isSelected([...pageItems]))"
                />
                <v-btn
                    v-for="column of SORTABLE"
                    v-bind:key="column.key"
                    v-bind:append-icon="sortIcon(column.key)"
                    v-bind:active="sortIcon(column.key) !== undefined"
                    variant="text"
                    class="text-none px-2"
                    v-on:click="toggleSort(column)"
                >
                    {{ column.title }}
                </v-btn>
            </div>
        </template>
        <template #default="{ items: pageItems, isSelected, toggleSelect }">
            <div class="tiles">
                <div
                    v-for="(item, index) of pageItems"
                    v-bind:key="item.raw.path"
                    class="tile"
                    v-bind:class="{ selected: isSelected(item) }"
                >
                    <router-link
                        v-bind:to="item.raw.to"
                        v-bind:title="item.raw.path"
                        class="tile-link"
                    >
                        <div class="thumbnail">
                            <!-- From where the media view shows it, and only once in sight. -->
                            <img
                                v-if="isImage(item.raw) && !failed.has(item.raw.path)"
                                v-bind:src="apiFilesUrl + encodePath(item.raw.path)"
                                alt=""
                                loading="lazy"
                                decoding="async"
                                v-on:error="failed.add(item.raw.path)"
                            >
                            <v-icon
                                v-else
                                v-bind:icon="placeholderOf(item.raw)"
                                size="48"
                                color="medium-emphasis"
                            />
                        </div>
                        <div class="name">
                            {{ nameOf(item.raw.path) }}
                        </div>
                    </router-link>
                    <v-checkbox-btn
                        v-bind:model-value="isSelected(item)"
                        v-bind:aria-label="`Select ${nameOf(item.raw.path)}`"
                        class="tile-select"
                        v-on:click.stop="toggleSelect(item, index, $event)"
                    />
                </div>
            </div>
        </template>
        <template #no-data>
            <div class="no-data text-medium-emphasis">
                No media files
            </div>
        </template>
        <template #footer>
            <v-data-table-footer
                v-bind:items-per-page-options="[20, 50, 100, -1]"
                items-per-page-text=""
            />
        </template>
    </v-data-iterator>
</template>

<script lang="ts" setup>
import { reactive } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { DataTableSortItem } from 'vuetify';

import {
    mdiArrowDown,
    mdiArrowUp,
    mdiFileOutline,
    mdiFilePdfBox,
    mdiFileVideoOutline,
    mdiImageBrokenVariant,
} from '@mdi/js';

import type { Dayjs } from 'dayjs';

import { apiFilesUrl } from '@/api-url';
import { encodePath } from '@/encode-path';

export interface MediaItem {
    path: string;
    mimeType: string;
    size: number;
    time: Dayjs;
    to: RouteLocationRaw;
}

// The table's columns, as the headers Vuetify sorts by.
const SORTABLE = [
    { key: 'path', title: 'Path', value: null, sortable: true },
    { key: 'time', title: 'Modified', value: null, sortable: true },
    { key: 'size', title: 'Size', value: null, sortable: true },
    { key: 'mimeType', title: 'Type', value: null, sortable: true },
];

// Unsorted, Vuetify would compare the times as the text they print as, the weekday first.
const CUSTOM_KEY_SORT = {
    time: (a: Dayjs, b: Dayjs) => a.valueOf() - b.valueOf(),
};

// Props
defineProps<{
    items: MediaItem[];
}>();

const selected = defineModel<string[]>('selected', { required: true });
const sortBy = defineModel<DataTableSortItem[]>('sortBy', { required: true });

// Reactive states
// The images that could not be loaded, drawn as broken rather than as an empty square.
const failed = reactive(new Set<string>());

// Methods
function sortIcon(key: string): string | undefined {
    const order = sortBy.value.find((item) => item.key === key)?.order;
    return order === 'asc' ? mdiArrowUp : order === 'desc' ? mdiArrowDown : undefined;
}

function isImage(item: MediaItem): boolean {
    return item.mimeType.startsWith('image/');
}

// A video or a PDF would have to be fetched whole to draw a frame or a page of it.
function placeholderOf(item: MediaItem): string {
    if (isImage(item)) {
        return mdiImageBrokenVariant;
    }
    if (item.mimeType.startsWith('video/')) {
        return mdiFileVideoOutline;
    }
    if (item.mimeType === 'application/pdf') {
        return mdiFilePdfBox;
    }
    return mdiFileOutline;
}

function nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}
</script>

<style scoped lang="scss">
// A column as the table is, so the header and the footer stay put while the tiles scroll between
// them. The tiles' wrapper is Vuetify's own, between the header and the footer, with no class.
.media-grid {
    display: flex;
    flex-direction: column;
    min-height: 0;

    > .grid-header + * {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
    }
}

.grid-header {
    gap: 4px;
    padding: 4px 8px 4px 4px;
    border-bottom: thin solid rgba(0, 0, 0, 0.12);
}

.tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
    padding: 8px;
}

.tile {
    position: relative;
    border-radius: 4px;

    &.selected {
        outline: 2px solid rgb(var(--v-theme-primary));
    }
}

.tile-link {
    display: block;
    color: inherit;
    text-decoration: none;

    &:hover .name {
        color: rgb(var(--v-theme-primary));
        text-decoration: underline;
    }
}

// Square, and the whole of each image shown: a screenshot or a diagram cut to a square would lose
// what tells it apart.
.thumbnail {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.04);
    overflow: hidden;

    img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }
}

.name {
    padding: 4px 2px 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.875rem;
}

// Over the image's corner, where a dark or busy image would otherwise hide it.
.tile-select {
    position: absolute;
    top: 4px;
    left: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.8);
}

.no-data {
    padding: 16px;
    text-align: center;
}
</style>
