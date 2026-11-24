<template>
    <EntryTree
        v-bind:items="rows"
        v-bind:open="open"
        v-bind:active="active"
        item-value="uuid"
        v-bind:route-for="rowRouteFor"
        v-bind:can-drag="movable ? canDrag : undefined"
        v-bind:can-drop="canDrop"
        v-on:update:open="$emit('update:open', $event)"
        v-on:update:active="onActive"
        v-on:choose="onChoose"
        v-on:drop="onDrop"
    >
        <template v-slot:prepend="{ item }">
            <v-icon v-if="isFold(item)">
                {{ item.shown < item.count ? mdiChevronDown : mdiChevronUp }}
            </v-icon>
            <!-- A folder for the subtasks the task holds, not the ones the row shows, which a
                 search or the statuses shown may leave out. -->
            <v-icon
                v-else
                v-bind:color="statusColor(item.metadata?.task?.status?.kind, taskSettings.resolvedStatusColors)"
            >
                {{ statusIcon(item.metadata?.task?.status?.kind, tasks.childrenOf(item.uuid).length > 0) }}
            </v-icon>
        </template>
        <template v-slot:title="{ item }">
            <span
                v-if="isFold(item)"
                class="text-medium-emphasis"
            >{{ item.title }}</span>
            <span
                v-else
                v-bind:title="item.title ?? undefined"
                v-bind:class="{ 'text-disabled': !tasks.ownUrgency(item.uuid).actionable }"
                v-bind:style="{ textDecorationLine: item.metadata?.task?.status?.kind === 'canceled' ? 'line-through' : 'none' }"
            >
                <template v-if="highlight !== undefined && highlight.length > 0 && found?.has(item.uuid)">
                    <template
                        v-for="(segment, index) of highlightTitle(item.title ?? '', highlight)"
                        v-bind:key="index"
                    >
                        <mark
                            v-if="segment.match"
                            class="task-tree-match"
                        >{{ segment.text }}</mark>
                        <template v-else>{{ segment.text }}</template>
                    </template>
                </template>
                <template v-else>{{ item.title }}</template>
            </span>
        </template>
        <template v-slot:append="{ item }">
            <!-- A fold stands for tasks and is none: there is nothing of its own to edit or add to. -->
            <template v-if="!isFold(item)">
                <span v-if="tasks.progress(item.uuid) !== undefined" class="task-progress mr-2">{{ Math.round(tasks.progress(item.uuid) ?? 0) }}%</span>
                <!-- Inside the row, which may be a link. Stopping the click keeps the row from routing,
                     but the browser would still follow the link, reloading the app, unless prevented. -->
                <v-icon-btn
                    v-if="showEdit"
                    v-bind:icon="mdiPencil"
                    variant="text"
                    title="Edit task"
                    v-on:click.stop.prevent="$emit('edit-task', item.uuid)"
                />
                <v-icon-btn
                    v-bind:icon="mdiPlus"
                    v-if="showAddChild"
                    variant="text"
                    class="add-child-btn"
                    title="Add child task"
                    v-on:click.stop.prevent="$emit('add-child-task', item.uuid)"
                ></v-icon-btn>
            </template>
            <!-- With some of its tasks drawn, a click on the row draws more, so folding them all
                 again needs a button of its own. -->
            <v-icon-btn
                v-else-if="item.shown > 0 && item.shown < item.count"
                v-bind:icon="mdiChevronUp"
                variant="text"
                v-bind:title="`Hide ${item.count} closed`"
                v-on:click.stop="onHide(item.uuid, $event)"
            />
        </template>
    </EntryTree>
</template>

<script lang="ts" setup>
import {
    mdiChevronDown,
    mdiChevronUp,
    mdiPencil,
    mdiPlus,
} from '@mdi/js';

import { computed, ref, watch } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

import EntryTree from '@/components/EntryTree.vue';
import { useTasksStore } from '@/stores/tasks';
import { useTaskSettingsStore } from '@/stores/taskSettings';
const tasks = useTasksStore();
const taskSettings = useTaskSettingsStore();
import type { UUID } from '@/api';
import type { TaskNode, TaskTreeItem } from '@/task-forest';
import { highlight as highlightTitle } from '@/task-tree-filter';
import { type TaskTreeRow, foldClosed as fold, isFold, isFoldId, shownForMore, shownToReach } from '@/task-tree-fold';
import { statusColor } from '@/status-color';
import { statusIcon } from '@/status-icon';

// Props
const props = defineProps<{
    items: TaskTreeItem[];
    open: UUID[];
    active?: UUID;
    // Off unless the parent handles `add-child-task`: a tree used only to pick a task, such as
    // the parent selection dialog's, would otherwise show a button that does nothing.
    showAddChild?: boolean;
    // Off unless the parent handles `edit-task`, as `showAddChild` is.
    showEdit?: boolean;
    // Where each row goes, making it a link; see EntryTree. Absent in a tree used to pick a task,
    // whose rows only report being chosen.
    routeFor?: (item: TaskNode) => RouteLocationRaw;
    // Whether a task can be dragged onto another to move it there. Off unless the parent handles
    // `move`, as `showAddChild` is.
    movable?: boolean;
    // Search terms to mark in the titles of the rows `found` holds, so a row shown for its own
    // title stands apart from one shown for what is under it.
    highlight?: string[];
    found?: ReadonlySet<string>;
    // Whether the closed tasks among each list of siblings are drawn as one row until it is
    // asked for them (see task-tree-fold.ts).
    foldClosed?: boolean;
}>();

// Emits
const emit = defineEmits<{
    (e: 'update:open', value: UUID[]): void;
    (e: 'update:active', value: UUID | undefined): void;
    (e: 'add-child-task', value: UUID): void;
    // The task the row is, to open in its editor, where choosing the row may go elsewhere.
    (e: 'edit-task', value: UUID): void;
    // The task `id` was dropped where it belongs under `parent`.
    (e: 'move', id: UUID, parent: UUID | null): void;
}>();

// State
// How many of its tasks each fold draws, by its id. Kept while the tree is shown, so a list changed
// by a save keeps what was drawn of it.
const shown = ref<ReadonlyMap<string, number>>(new Map());

// Computed properties
const folded = computed(() => props.foldClosed ? fold(props.items, shown.value) : undefined);

const rows = computed<TaskTreeRow[]>(() => folded.value?.rows ?? props.items);

// A fold goes nowhere. Made once, as `canDrag` is.
const rowRouteFor = computed(() => {
    const routeFor = props.routeFor;
    return routeFor === undefined ? undefined : (row: TaskTreeRow) => isFold(row) ? null : routeFor(row);
});

// Whether the tree is given the task chosen at all, drawn or behind a fold: the status filter or a
// search may leave it out, and give it back.
const holdsActive = computed<boolean>(() => props.active !== undefined && holds(props.items, props.active));

// The task chosen is drawn even when it is closed: when it is opened from a list or a link, when it
// was chosen among what a search found and the search is cleared, and when the status filter gives
// it back. Only then, though, not when it closes while chosen, as the status filter takes one away
// while closed tasks are hidden, nor after its fold is hidden.
watch([() => props.active, () => props.foldClosed, holdsActive], ([active]) => {
    if (active !== undefined) {
        reveal(active);
    }
}, { immediate: true });

// Methods
// Draws the task `id` if the tree holds it behind a fold, as it holds the items it was last given:
// the fold draws as many more as reach it.
function reveal(id: string) {
    const place = folded.value?.foldOf.get(id);
    const row = place === undefined ? undefined : folded.value?.folds.get(place.fold);
    if (place !== undefined && row !== undefined && row.shown <= place.index) {
        showFold(place.fold, shownToReach(row, place.index));
    }
}

function holds(items: readonly TaskTreeItem[], id: string): boolean {
    return items.some((item) => item.uuid === id || holds(item.children ?? [], id));
}

function showFold(id: string, count: number) {
    shown.value = new Map([...shown.value, [id, count]]);
}

function hideFold(id: string) {
    const next = new Map(shown.value);
    next.delete(id);
    shown.value = next;
}

// The next of its tasks, or once all of them are drawn, none.
function toggleFold(id: string) {
    const row = folded.value?.folds.get(id);
    if (row === undefined) {
        return;
    }
    if (row.shown < row.count) {
        showFold(id, shownForMore(row));
    }
    else {
        hideFold(id);
    }
}

// The button goes with the tasks it hides, and the focus it held would go to the page, so its row
// takes the focus first.
function onHide(id: string, event: MouseEvent) {
    const row = (event.target as Element).closest<HTMLElement>('[role="treeitem"]');
    if (row !== null && row.contains(document.activeElement)) {
        row.focus();
    }
    hideFold(id);
}

// A tree whose rows are not links reports a row chosen as active, and a fold is never active.
function onActive(id: UUID | undefined) {
    if (id !== undefined && isFoldId(id)) {
        toggleFold(id);
    }
    else {
        emit('update:active', id);
    }
}

function onChoose(id: string) {
    if (isFoldId(id)) {
        toggleFold(id);
    }
}

// Every task can move, and a fold is none. Declared once, as a function made in the template would
// be a new prop on every render.
function canDrag(id: string): boolean {
    return !isFoldId(id);
}

function canDrop(id: UUID, target: string): boolean {
    return tasks.parentForDrop(id, target) !== undefined;
}

function onDrop(id: UUID, target: string) {
    const parent = tasks.parentForDrop(id, target);
    if (parent !== undefined) {
        emit('move', id, parent);
    }
}

defineExpose({ reveal });
</script>

<style scoped lang="scss">
/* A highlighter's yellow, as the theme's primary is all but black. The text keeps its own colour,
   which says whether the task can be started yet. */
.task-tree-match {
    background-color: rgba(var(--v-theme-warning), 0.4);
    color: inherit;
    border-radius: 2px;
}
</style>
