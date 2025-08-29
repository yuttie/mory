<template>
    <v-dialog
        v-bind:value="value"
        v-on:input="$emit('input', $event)"
        max-width="600px"
        persistent
    >
        <v-card>
            <v-card-title>
                <span class="text-h5">Change Parent</span>
            </v-card-title>
            <v-card-text>
                <div class="mb-3">
                    <p>Select a new parent for <strong>{{ taskTitle }}</strong>:</p>
                    <p class="text-caption text--secondary">
                        The task and all its subtasks will be moved under the selected parent.
                    </p>
                </div>
                
                <!-- Root option -->
                <v-card
                    outlined
                    class="mb-3 pa-2 d-flex align-center"
                    v-bind:class="{ 'blue lighten-5': selectedParent === null }"
                    style="cursor: pointer"
                    v-on:click="selectParent(null)"
                >
                    <v-icon class="mr-2">{{ mdiFolder }}</v-icon>
                    <span>Root (No Parent)</span>
                    <v-spacer />
                    <v-icon v-if="selectedParent === null" color="primary">{{ mdiCheck }}</v-icon>
                </v-card>

                <!-- Task tree for parent selection -->
                <div style="border: 1px solid #e0e0e0; border-radius: 4px; max-height: 400px; overflow-y: auto;">
                    <TaskTree
                        v-bind:items="filteredItems"
                        v-bind:open="openNodes"
                        v-bind:active="selectedParent"
                        v-on:update:open="openNodes = $event"
                        v-on:update:active="selectParent"
                        style="padding: 8px;"
                    />
                </div>
            </v-card-text>
            <v-card-actions>
                <v-spacer />
                <v-btn
                    text
                    v-on:click="$emit('input', false)"
                >
                    Cancel
                </v-btn>
                <v-btn
                    color="primary"
                    v-bind:disabled="!canMove"
                    v-on:click="confirmMove"
                >
                    Move Here
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { mdiFolder, mdiCheck } from '@mdi/js';

import TaskTree from './TaskTree.vue';
import type { UUID, ApiTreeNode } from '@/api/task';

// Props
const props = defineProps<{
    value: boolean;
    taskUuid: UUID | null;
    taskTitle?: string;
    items: ApiTreeNode[];
}>();

// Emits
const emit = defineEmits<{
    (e: 'input', value: boolean): void;
    (e: 'move', targetParent: UUID | null): void;
}>();

// Reactive state
const selectedParent = ref<UUID | null>(null);
const openNodes = ref<UUID[]>([]);

// Computed properties
const filteredItems = computed<ApiTreeNode[]>(() => {
    if (!props.taskUuid) return props.items;
    
    // Filter out the task being moved and its descendants
    function filterNode(node: ApiTreeNode): ApiTreeNode | null {
        if (node.uuid === props.taskUuid) {
            return null; // Exclude the task being moved
        }
        
        if (isDescendantOfTask(node.uuid)) {
            return null; // Exclude descendants of the task being moved
        }

        const filteredChildren = node.children
            ?.map(filterNode)
            .filter((child): child is ApiTreeNode => child !== null) || [];

        return {
            ...node,
            children: filteredChildren.length > 0 ? filteredChildren : undefined
        };
    }

    // Apply circular reference filtering to all items
    return props.items
        .map(filterNode)
        .filter((item): item is ApiTreeNode => item !== null);
});

// Helper function to check if a node is a descendant of the task being moved
function isDescendantOfTask(nodeUuid: UUID): boolean {
    if (!props.taskUuid) return false;
    
    // Find the task being moved in the tree
    function findTaskInTree(nodes: ApiTreeNode[], targetUuid: UUID): ApiTreeNode | null {
        for (const node of nodes) {
            if (node.uuid === targetUuid) {
                return node;
            }
            if (node.children) {
                const found = findTaskInTree(node.children, targetUuid);
                if (found) return found;
            }
        }
        return null;
    }
    
    const taskNode = findTaskInTree(props.items, props.taskUuid);
    if (!taskNode) return false;
    
    // Check if nodeUuid is a descendant of taskNode
    function isInSubtree(subtreeRoot: ApiTreeNode, targetUuid: UUID): boolean {
        if (!subtreeRoot.children) return false;
        
        for (const child of subtreeRoot.children) {
            if (child.uuid === targetUuid || isInSubtree(child, targetUuid)) {
                return true;
            }
        }
        return false;
    }
    
    return isInSubtree(taskNode, nodeUuid);
}

const canMove = computed<boolean>(() => {
    return props.taskUuid !== null;
});

// Methods
function selectParent(parentUuid: UUID | null): void {
    selectedParent.value = parentUuid;
}

function confirmMove(): void {
    if (canMove.value) {
        emit('move', selectedParent.value);
        emit('input', false);
    }
}

// Watch for dialog open to reset state
watch(() => props.value, (isOpen) => {
    if (isOpen) {
        selectedParent.value = null;
        // Open all root nodes by default for better visibility
        openNodes.value = props.items.map(item => item.uuid);
    }
});
</script>

<style scoped>
.v-card {
    overflow: visible;
}
</style>