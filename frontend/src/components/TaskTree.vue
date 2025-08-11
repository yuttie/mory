<template>
    <v-treeview
        v-bind:items="items"
        v-on:update:active="$emit('change', $event[0])"
        item-key="uuid"
        item-text="title"
        activatable
        dense
        open-all
        return-object
        class="task-tree"
    >
        <template v-slot:prepend="{ item, open }">
            <v-icon v-if="item.children" dense>
                {{ open ? mdiFolderOpen : mdiFolder }}
            </v-icon>
            <v-icon v-else dense>
                {{ item.metadata.task.status === 'completed' ? mdiCheckboxMarkedOutline : mdiCheckboxBlankOutline }}
            </v-icon>
        </template>
    </v-treeview>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, set, del } from 'vue';
import type { Ref } from 'vue';

import {
    mdiCheckboxBlankOutline,
    mdiCheckboxMarkedOutline,
    mdiFolder,
    mdiFolderOpen,
} from '@mdi/js';

import * as api from '@/api';
import type { TreeNode } from '@/api';

// Props
const props = defineProps<{
  items: TreeNode[];
}>();

// Emits
const emit = defineEmits<{
    (e: 'change', value: TreeNode): void;
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
