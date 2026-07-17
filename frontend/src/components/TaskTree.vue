<template>
    <v-treeview
        v-bind:items="items"
        v-on:update:opened="$emit('update:open', $event)"
        v-on:update:activated="$emit('update:active', $event[0])"
        v-bind:opened="open"
        v-bind:activated="(active ?? '') !== '' ? [active] : []"
        item-value="uuid"
        item-title="title"
        activatable
        density="compact"
        class="task-tree"
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
                v-bind:title="item.title"
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
    </v-treeview>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted } from 'vue';

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

import type { UUID, ApiTreeNode } from '@/api/task';

function getTaskColor(item): string {
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
const props = defineProps<{
    items: ApiTreeNode[];
    open: UUID[];
    active?: UUID;
}>();

// Emits
const emit = defineEmits<{
    (e: 'update:open', value: UUID[]): void;
    (e: 'update:active', value: UUID | undefined): void;
    (e: 'add-child-task', value: UUID): void;
}>();

// Reactive states

// Computed properties

// Lifecycle hooks
onMounted(() => {
});

onUnmounted(() => {
});

// Methods
</script>

<style scoped lang="scss">
.task-tree {
    :deep(.v-treeview-item) {
        &:not(:hover) .v-list-item__append {
            display: none;
        }
    }
}
</style>
