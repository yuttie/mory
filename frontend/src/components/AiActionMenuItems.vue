<template>
    <template v-for="node of nodes" v-bind:key="node.action ? `action:${node.action.id}` : `group:${node.label}`">
        <template v-if="node.children">
            <v-list-item>
                <v-list-item-title>{{ node.label }}</v-list-item-title>
                <template v-slot:append>
                    <v-icon size="small">{{ mdiChevronRight }}</v-icon>
                </template>
                <v-menu
                    activator="parent"
                    submenu
                    open-on-hover
                >
                    <v-list density="compact">
                        <AiActionMenuItems
                            v-bind:nodes="node.children"
                            v-on:run="$emit('run', $event)"
                        ></AiActionMenuItems>
                    </v-list>
                </v-menu>
            </v-list-item>
        </template>
        <template v-else>
            <v-list-item v-on:click="$emit('run', node.action!)">
                <v-list-item-title>{{ node.label }}</v-list-item-title>
            </v-list-item>
        </template>
    </template>
</template>

<script lang="ts" setup>
import { mdiChevronRight } from '@mdi/js';

import type { AiAction, AiActionNode } from '@/ai-actions';

// Named explicitly so the component can resolve itself for the recursive
// rendering of nested groups.
defineOptions({ name: 'AiActionMenuItems' });

// Props
defineProps<{
    nodes: AiActionNode[];
}>();

// Emits
defineEmits<{
    (e: 'run', action: AiAction): void;
}>();
</script>
