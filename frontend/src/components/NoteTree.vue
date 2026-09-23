<template>
    <div
        class="note-tree"
        v-on:click.capture="onClickInTree"
        v-on:keydown.capture="onKeydownInTree"
    >
        <EntryTree
            v-bind:items="items"
            v-bind:open="open"
            v-bind:active="active"
            item-value="id"
            open-on-click
            v-on:update:open="open = $event"
            v-on:update:active="onActivate"
        >
            <template v-slot:prepend="{ item }">
                <v-icon>
                    {{ item.children ? mdiFolder : mdiFileDocumentOutline }}
                </v-icon>
            </template>
        </EntryTree>
        <v-btn
            v-if="remaining > 0"
            variant="text"
            class="show-older"
            block
            v-on:click="showOlder"
        >
            Show older ({{ remaining.toLocaleString() }})
        </v-btn>
    </div>
</template>

<script lang="ts" setup>
// A tree of note files, ordered by recency.
//
// The repository this was built for is mostly flat -- 1,560 of 2,170 files sit directly at the
// root -- so a plain path tree would ask the drawer to render some 1,592 rows at mount. Vuetify
// renders a closed branch's children not at all, so depth costs nothing and width is the whole
// price: the tree holds the entire forest but shows a window of the most recently touched roots,
// widened a step at a time.
//
// It is therefore a way back to what you were just working on, not a way to browse everything.
// Exhaustive browsing belongs to Files and Search, which is why the prefix and the window sizes
// are props rather than baked in.

import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { mdiFileDocumentOutline, mdiFolder } from '@mdi/js';

import EntryTree from '@/components/EntryTree.vue';
import { useEntrySubset } from '@/composables/entrySubset';
import {
    NOTE_TREE_INITIAL_ROWS,
    NOTE_TREE_ROW_INCREMENT,
    loadConfigValue,
} from '@/config';
import { ancestors, toNestedForest } from '@/forest';
import { buildNoteForest, noteRouteFor } from '@/note-forest';
import type { NoteNode, NoteTreeItem } from '@/note-forest';

// Props
const props = withDefaults(defineProps<{
    // The part of the repository to show. '' is the whole of it.
    prefix?: string;
    initialRows?: number;
    rowIncrement?: number;
}>(), {
    prefix: '',
    initialRows: undefined,
    rowIncrement: undefined,
});

// Composables
const route = useRoute();
const router = useRouter();
const subset = useEntrySubset(props.prefix);

// Reactive states
const initialRows = props.initialRows
    ?? loadConfigValue('note-tree-initial-rows', NOTE_TREE_INITIAL_ROWS);
const rowIncrement = props.rowIncrement
    ?? loadConfigValue('note-tree-row-increment', NOTE_TREE_ROW_INCREMENT);

const open = ref<string[]>([]);
// How many roots are shown. Deliberately not reset when the listing changes: a press should not
// be undone by someone saving a note.
const visibleRoots = ref<number>(initialRows);

// Computed properties
const forest = computed(() => buildNoteForest(subset.entries.value, props.prefix));

const items = computed<NoteTreeItem[]>(() => toNestedForest<NoteNode, NoteTreeItem>(
    forest.value,
    forest.value.roots.slice(0, visibleRoots.value),
    (node, children) => {
        const target = noteRouteFor(node);
        const item: NoteTreeItem = {
            ...node,
            ...(target !== null ? { props: { to: target } } : {}),
        };
        return children === undefined ? item : { ...item, children };
    },
));

const remaining = computed(() => Math.max(0, forest.value.roots.length - visibleRoots.value));

// The file the app is currently showing, if any. The repeatable route segment arrives as an
// array of path components.
const activePath = computed<string | null>(() => {
    if (route.name !== 'Note' && route.name !== 'Media') {
        return null;
    }
    const path = route.params.path;
    const joined = Array.isArray(path) ? path.join('/') : path;
    return joined === undefined || joined === '' ? null : joined;
});

const active = computed<string | undefined>(() =>
    (activePath.value !== null && forest.value.byId.has(activePath.value))
        ? activePath.value
        : undefined);

// Methods
function showOlder() {
    visibleRoots.value += rowIncrement;
}

// Bring the open file into view: expand the branches above it, and widen the window far enough to
// reach the root it hangs from. Without the second part a note opened from Search would be marked
// active while sitting outside the rows the drawer renders.
function reveal(path: string | null) {
    if (path === null) {
        return;
    }
    const chain = forest.value.byId.has(path) ? ancestors(forest.value, path) : [];
    if (chain.length > 0) {
        const missing = chain.filter((id) => !open.value.includes(id));
        if (missing.length > 0) {
            open.value = [...open.value, ...missing];
        }
    }
    if (!forest.value.byId.has(path)) {
        return;
    }
    const rootId = chain.length > 0 ? chain[chain.length - 1] : path;
    const index = forest.value.roots.indexOf(rootId);
    if (index >= visibleRoots.value) {
        visibleRoots.value = index + 1;
    }
}

// Which kind of input is being served, watched on the way down so that it is known by the time
// the row reports its activation -- which says only that a row was activated, never by what.
//
// A click is the anchor's own business: vue-router follows a plain left click, and deliberately
// leaves a Ctrl-, Shift- or middle-click to the browser, which opens a new tab or window and must
// not move this one. The keyboard is the caller the tree still navigates for, because v-treeview
// handles Enter itself and the keypress never reaches the anchor.
let clicking = false;

function onClickInTree() {
    clicking = true;
}

function onKeydownInTree() {
    clicking = false;
}

function onActivate(id: string | undefined) {
    if (id === undefined || clicking) {
        return;
    }
    const node = forest.value.byId.get(id);
    if (node === undefined) {
        return;
    }
    const target = noteRouteFor(node);
    // A directory only opens. And a row activated *because* the route already points at it must
    // not navigate again, or revealing would bounce straight back into a push.
    if (target === null || router.resolve(target).path === route.path) {
        return;
    }
    router.push(target);
}

// Lifecycle hooks
onMounted(async () => {
    await subset.init();
    reveal(activePath.value);
});

// Watchers
watch([activePath, forest], () => reveal(activePath.value));
</script>

<style scoped lang="scss">
.note-tree {
    .show-older {
        // Reads as a continuation of the list rather than a call to action.
        opacity: 0.7;
        text-transform: none;
    }
}
</style>
