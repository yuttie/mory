<template>
    <EntryTree
        v-bind:items="items"
        v-bind:open="open"
        v-bind:active="active"
        item-value="uuid"
        v-bind:route-for="routeFor"
        v-bind:can-drag="movable ? canDrag : undefined"
        v-bind:can-drop="canDrop"
        v-on:update:open="$emit('update:open', $event)"
        v-on:update:active="$emit('update:active', $event)"
        v-on:drop="onDrop"
    >
        <template v-slot:prepend="{ item }">
            <v-icon v-if="item.metadata?.tag_group">
                {{ mdiTag }}
            </v-icon>
            <!-- A folder for the subtasks the task holds, not the ones the row shows, which a
                 search or the statuses shown may leave out. -->
            <v-icon v-else v-bind:color="statusColor(item.metadata?.task?.status?.kind, taskSettings.resolvedStatusColors)">
                {{ statusIcon(item.metadata?.task?.status?.kind, tasks.childrenOf(item.uuid).length > 0) }}
            </v-icon>
        </template>
        <template v-slot:title="{ item }">
            <span
                v-bind:title="item.title ?? undefined"
                v-bind:class="{ 'text-disabled': !item.metadata?.tag_group && !tasks.ownUrgency(item.uuid).actionable }"
                v-bind:style="{ textDecorationLine: item.metadata?.task?.status?.kind === 'canceled' ? 'line-through' : 'none' }"
            >
                <!-- Not a tag group's name, which a search never finds: the group is there for
                     the tasks in it. -->
                <template v-if="highlight !== undefined && highlight.length > 0 && !item.metadata?.tag_group">
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
            <span v-if="tasks.progress(item.uuid) !== undefined" class="task-progress mr-2">{{ Math.round(tasks.progress(item.uuid) ?? 0) }}%</span>
            <!-- Inside the row, which may be a link. Stopping the click keeps the row from routing,
                 but the browser would still follow the link, reloading the app, unless prevented. -->
            <!-- A tag group is no task to edit. -->
            <v-icon-btn
                v-if="showEdit && !item.metadata?.tag_group"
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
                v-bind:title="item.metadata?.tag_group ? 'Add task' : 'Add child task'"
                v-on:click.stop.prevent="$emit('add-child-task', item.uuid)"
            ></v-icon-btn>
        </template>
    </EntryTree>
</template>

<script lang="ts" setup>
import {
    mdiPencil,
    mdiPlus,
    mdiTag,
} from '@mdi/js';

import type { RouteLocationRaw } from 'vue-router';

import EntryTree from '@/components/EntryTree.vue';
import { isTagGroupId, useTasksStore } from '@/stores/tasks';
import { useTaskSettingsStore } from '@/stores/taskSettings';
const tasks = useTasksStore();
const taskSettings = useTaskSettingsStore();
import type { UUID } from '@/api';
import type { TaskTreeItem } from '@/task-forest';
import { highlight as highlightTitle } from '@/task-tree-filter';
import { statusColor } from '@/status-color';
import { statusIcon } from '@/status-icon';

// Props
defineProps<{
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
    routeFor?: (item: TaskTreeItem) => RouteLocationRaw;
    // Whether a task can be dragged onto another to move it there. Off unless the parent handles
    // `move`, as `showAddChild` is.
    movable?: boolean;
    // Search terms to mark in the titles, so a row shown for what it holds stands apart from one
    // shown for its own title.
    highlight?: string[];
}>();

// Emits
const emit = defineEmits<{
    (e: 'update:open', value: UUID[]): void;
    (e: 'update:active', value: UUID | undefined): void;
    // For a tag group, the group's id: the new task is a root task carrying that tag, since a
    // group is not a task to nest it under.
    (e: 'add-child-task', value: UUID): void;
    // The task the row is, to open in its editor, where choosing the row may go elsewhere.
    (e: 'edit-task', value: UUID): void;
    // The task `id` was dropped where it belongs under `parent`.
    (e: 'move', id: UUID, parent: UUID | null): void;
}>();

// Methods
// A tag group only arranges the tree: it is no task, and there is nothing to move.
function canDrag(id: UUID): boolean {
    return !isTagGroupId(id);
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
