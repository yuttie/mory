<template>
    <EntryTree
        v-bind:items="items"
        v-bind:open="open"
        v-bind:active="active"
        item-value="uuid"
        v-on:update:open="$emit('update:open', $event)"
        v-on:update:active="$emit('update:active', $event)"
    >
        <template v-slot:prepend="{ item }">
            <v-icon v-if="item.metadata?.tag_group" size="small">
                {{ mdiTag }}
            </v-icon>
            <v-icon v-else-if="item.children" size="small" v-bind:color="getTaskColor(item)">
                {{ item.metadata?.task?.status?.kind === 'done' ? mdiFolderCheck : item.metadata?.task?.status?.kind === 'canceled' ? mdiFolderOff : mdiFolder }}
            </v-icon>
            <v-icon v-else size="small" v-bind:color="getTaskColor(item)">
                {{ item.metadata?.task?.status?.kind === 'done' ? mdiCheckboxMarkedOutline : item.metadata?.task?.status?.kind === 'canceled' ? mdiCheckboxBlankOffOutline : mdiCheckboxBlankOutline }}
            </v-icon>
        </template>
        <template v-slot:title="{ item }">
            <span
                v-bind:title="item.title ?? undefined"
                v-bind:style="{ textDecorationLine: item.metadata?.task?.status?.kind === 'canceled' ? 'line-through' : 'none' }"
            >
                {{ item.title }}
            </span>
        </template>
        <template v-slot:append="{ item }">
            <v-btn
                v-if="!item.metadata?.tag_group"
                variant="flat"
                size="x-small"
                class="add-child-btn"
                title="Add child task"
                v-on:click.stop="$emit('add-child-task', item.uuid)"
            >
                <v-icon size="small">{{ mdiPlus }}</v-icon>
            </v-btn>
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

import EntryTree from '@/components/EntryTree.vue';
import type { UUID } from '@/api';
import type { TaskTreeItem } from '@/task-forest';

function getTaskColor(item: TaskTreeItem): string | undefined {
    switch (item.metadata?.task?.status?.kind) {
        case "todo":
            return "blue-grey";
        case "in_progress":
            return "blue";
        case "waiting":
            return "orange";
        case "blocked":
            return "red";
        case "on_hold":
            return "purple";
        case "done":
            return "green";
        case "canceled":
            return "grey";
    }
}

// Props
defineProps<{
    items: TaskTreeItem[];
    open: UUID[];
    active?: UUID;
}>();

// Emits
defineEmits<{
    (e: 'update:open', value: UUID[]): void;
    (e: 'update:active', value: UUID | undefined): void;
    (e: 'add-child-task', value: UUID): void;
}>();
</script>
