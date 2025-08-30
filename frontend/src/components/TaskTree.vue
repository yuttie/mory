<template>
    <v-treeview
        v-bind:items="items"
        v-on:update:open="$emit('update:open', $event)"
        v-on:update:active="$emit('update:active', $event[0])"
        v-bind:open="open"
        v-bind:active="(active ?? '') !== '' ? [active] : []"
        item-key="uuid"
        item-text="title"
        activatable
        dense
        class="task-tree"
    >
        <template v-slot:prepend="{ item, open }">
            <v-icon v-if="item.metadata?.tag_group" dense>
                {{ mdiTag }}
            </v-icon>
            <v-icon v-else-if="item.children" dense>
                {{ item.metadata?.task?.status?.kind === 'done' ? mdiFolderCheck : item.metadata?.task?.status?.kind === 'canceled' ? mdiFolderOff : mdiFolder }}
            </v-icon>
            <v-icon v-else dense>
                {{ item.metadata?.task?.status?.kind === 'done' ? mdiCheckboxMarkedOutline : item.metadata?.task?.status?.kind === 'canceled' ? mdiCheckboxBlankOffOutline : mdiCheckboxBlankOutline }}
            </v-icon>
        </template>
        <template v-slot:label="{ item, open }">
            <span v-bind:style="{ textDecorationLine: item.metadata?.task?.status?.kind === 'canceled' ? 'line-through' : 'none' }">
                {{ item.title }}
            </span>
        </template>
    </v-treeview>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, set, del } from 'vue';
import type { Ref } from 'vue';

import {
    mdiCheckboxBlankOffOutline,
    mdiCheckboxBlankOutline,
    mdiCheckboxMarkedOutline,
    mdiFolder,
    mdiFolderCheck,
    mdiFolderOff,
    mdiTag,
} from '@mdi/js';

import type { UUID, ApiTreeNode } from '@/api/task';

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
</style>
