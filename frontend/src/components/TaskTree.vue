<template>
    <EntryTree
        v-bind:items="items"
        v-bind:open="open"
        v-bind:active="active"
        item-value="uuid"
        v-bind:route-for="routeFor"
        v-on:update:open="$emit('update:open', $event)"
        v-on:update:active="$emit('update:active', $event)"
    >
        <template v-slot:prepend="{ item }">
            <v-icon v-if="item.metadata?.tag_group">
                {{ mdiTag }}
            </v-icon>
            <v-icon v-else-if="item.children" v-bind:color="statusColor(item.metadata?.task?.status?.kind)">
                {{ item.metadata?.task?.status?.kind === 'done' ? mdiFolderCheck : item.metadata?.task?.status?.kind === 'canceled' ? mdiFolderOff : mdiFolder }}
            </v-icon>
            <v-icon v-else v-bind:color="statusColor(item.metadata?.task?.status?.kind)">
                {{ item.metadata?.task?.status?.kind === 'done' ? mdiCheckboxMarkedOutline : item.metadata?.task?.status?.kind === 'canceled' ? mdiCheckboxBlankOffOutline : mdiCheckboxBlankOutline }}
            </v-icon>
        </template>
        <template v-slot:title="{ item }">
            <span
                v-bind:title="item.title ?? undefined"
                v-bind:class="{ 'text-disabled': !item.metadata?.tag_group && !tasks.ownUrgency(item.uuid).actionable }"
                v-bind:style="{ textDecorationLine: item.metadata?.task?.status?.kind === 'canceled' ? 'line-through' : 'none' }"
            >
                {{ item.title }}
            </span>
        </template>
        <template v-slot:append="{ item }">
            <span v-if="tasks.progress(item.uuid) !== undefined" class="task-progress mr-2">{{ Math.round(tasks.progress(item.uuid) ?? 0) }}%</span>
            <!-- Inside the row, which may be a link. Stopping the click keeps the row from routing,
                 but the browser would still follow the link, reloading the app, unless prevented. -->
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
    mdiCheckboxBlankOffOutline,
    mdiCheckboxBlankOutline,
    mdiCheckboxMarkedOutline,
    mdiFolder,
    mdiFolderCheck,
    mdiFolderOff,
    mdiPlus,
    mdiTag,
} from '@mdi/js';

import type { RouteLocationRaw } from 'vue-router';

import EntryTree from '@/components/EntryTree.vue';
import { useTasksStore } from '@/stores/tasks';
const tasks = useTasksStore();
import type { UUID } from '@/api';
import type { TaskTreeItem } from '@/task-forest';
import { statusColor } from '@/status-color';

// Props
defineProps<{
    items: TaskTreeItem[];
    open: UUID[];
    active?: UUID;
    // Off unless the parent handles `add-child-task`: a tree used only to pick a task, such as
    // the parent selection dialog's, would otherwise show a button that does nothing.
    showAddChild?: boolean;
    // Where each row goes, making it a link; see EntryTree. Absent in a tree used to pick a task,
    // whose rows only report being chosen.
    routeFor?: (item: TaskTreeItem) => RouteLocationRaw;
}>();

// Emits
defineEmits<{
    (e: 'update:open', value: UUID[]): void;
    (e: 'update:active', value: UUID | undefined): void;
    // For a tag group, the group's id: the new task is a root task carrying that tag, since a
    // group is not a task to nest it under.
    (e: 'add-child-task', value: UUID): void;
}>();
</script>
