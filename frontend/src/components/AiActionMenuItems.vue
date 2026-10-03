<template>
    <template v-for="node of nodes" v-bind:key="node.action ? `action:${node.action.id}` : `group:${node.label}`">
        <template v-if="node.children">
            <v-list-item
                link
                v-bind:title="node.label"
                v-on:click.stop="setGroupVisible(node.label, true)"
            >
                <template v-slot:append>
                    <v-icon>{{ mdiChevronRight }}</v-icon>
                </template>
                <v-menu
                    v-bind:model-value="visibleGroups.has(node.label)"
                    v-on:update:model-value="setGroupVisible(node.label, $event)"
                    activator="parent"
                    submenu
                    open-on-hover
                >
                    <v-list>
                        <AiActionMenuItems
                            v-bind:nodes="node.children"
                            v-on:run="$emit('run', $event)"
                        ></AiActionMenuItems>
                    </v-list>
                </v-menu>
            </v-list-item>
        </template>
        <template v-else>
            <v-list-item
                v-bind:title="node.label"
                v-on:click="$emit('run', node.action!)"
            ></v-list-item>
        </template>
    </template>
</template>

<script lang="ts" setup>
import { reactive } from 'vue';
import { mdiChevronRight } from '@mdi/js';

import type { AiAction, AiActionNode } from '@/ai-actions';

// Named explicitly so the component can resolve itself for the recursive
// rendering of nested groups.
defineOptions({ name: 'AiActionMenuItems' });

// Reactive states
//
// Which groups' submenus are open, by label, which is unique among siblings and each level is its
// own instance. A group row is `link` so that it is focusable, which a row with no destination is
// not, and the keyboard can reach it. Its click is stopped and the submenu opened by hand: left to
// bubble, the click reaches the menu around this one, which closes on a click in its content, and
// `open-on-hover` turns off opening on click, so a tap would only close both menus.
const visibleGroups = reactive(new Set<string>());

function setGroupVisible(label: string, visible: boolean) {
    if (visible) {
        visibleGroups.add(label);
    }
    else {
        visibleGroups.delete(label);
    }
}

// Props
defineProps<{
    nodes: AiActionNode[];
}>();

// Emits
defineEmits<{
    (e: 'run', action: AiAction): void;
}>();
</script>
