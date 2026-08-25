<template>
    <v-btn
        icon
        variant="text"
        rounded="0"
        v-bind:loading="running"
        v-bind:disabled="running"
        title="AI Actions"
    >
        <v-icon>{{ mdiAutoFix }}</v-icon>
        <v-menu
            activator="parent"
            v-on:update:model-value="onMenuToggle"
        >
            <v-list density="compact">
                <v-list-item v-on:click="$emit('adHoc')">
                    <v-list-item-title>Ad hoc&hellip;</v-list-item-title>
                </v-list-item>
                <v-divider></v-divider>
                <template v-if="nodes.length === 0">
                    <v-list-item disabled>
                        <v-list-item-title class="text-medium-emphasis">
                            No AI Actions defined
                        </v-list-item-title>
                    </v-list-item>
                </template>
                <template v-else>
                    <AiActionMenuItems
                        v-bind:nodes="nodes"
                        v-on:run="$emit('run', $event)"
                    ></AiActionMenuItems>
                </template>
            </v-list>
        </v-menu>
    </v-btn>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { mdiAutoFix } from '@mdi/js';

import AiActionMenuItems from './AiActionMenuItems.vue';
import { buildAiActionTree } from '@/ai-actions';
import type { AiAction } from '@/ai-actions';

// Props
const props = defineProps<{
    actions: AiAction[];
    running: boolean;
}>();

// Emits
const emit = defineEmits<{
    (e: 'run', action: AiAction): void;
    (e: 'adHoc'): void;
    (e: 'open'): void;
}>();

// Computed properties
const nodes = computed(() => buildAiActionTree(props.actions));

// Methods
function onMenuToggle(isOpen: boolean): void {
    if (isOpen) {
        // So actions added from the Config screen show up without a reload.
        emit('open');
    }
}
</script>
