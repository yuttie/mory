<template>
    <v-dialog
        v-bind:model-value="modelValue"
        v-on:update:model-value="$emit('update:modelValue', $event)"
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
                    <p class="text-caption text-medium-emphasis">
                        The task and all its subtasks will be moved under the selected parent.
                    </p>
                </div>
                
                <!-- Root option -->
                <v-card
                    variant="outlined"
                    class="mb-3 pa-2 d-flex align-center"
                    v-bind:class="{ 'bg-blue-lighten-5': selectedParent === null }"
                    style="cursor: pointer"
                    v-on:click="selectParent(null)"
                >
                    <v-icon class="mr-2">{{ mdiFolder }}</v-icon>
                    <span>Root (No Parent)</span>
                    <v-spacer />
                    <v-icon v-if="selectedParent === null" color="primary">{{ mdiCheck }}</v-icon>
                </v-card>

                <!-- Task tree for parent selection -->
                <!-- Positioned, so that it is on the offsetParent chain `revealSelected` walks. -->
                <div
                    ref="treeContainer"
                    style="position: relative; border: 1px solid #e0e0e0; border-radius: 4px; max-height: 400px; overflow-y: auto;"
                >
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
                    variant="text"
                    v-on:click="$emit('update:modelValue', false)"
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
import { ref, computed, watch, nextTick } from 'vue';
import { mdiFolder, mdiCheck } from '@mdi/js';

import TaskTree from './TaskTree.vue';
import type { UUID } from '@/api';
import type { TaskTreeItem } from '@/task-forest';

// Props
const props = defineProps<{
    modelValue: boolean;
    taskUuid: UUID | null;
    taskTitle?: string;
    items: TaskTreeItem[];
}>();

// Emits
const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'move', targetParent: UUID | null): void;
}>();

// Reactive state
const selectedParent = ref<UUID | null>(null);
const openNodes = ref<UUID[]>([]);
const treeContainer = ref<HTMLElement | null>(null);

// The tasks from a root down to `uuid`'s parent: empty for a root task, null for one not in the
// tree.
function ancestorsOf(items: TaskTreeItem[], uuid: UUID): UUID[] | null {
    for (const item of items) {
        if (item.uuid === uuid) {
            return [];
        }
        const below = ancestorsOf(item.children ?? [], uuid);
        if (below !== null) {
            return [item.uuid, ...below];
        }
    }
    return null;
}

// Computed properties
const currentAncestors = computed<UUID[]>(() => {
    if (props.taskUuid === null) {
        return [];
    }
    return ancestorsOf(props.items, props.taskUuid) ?? [];
});

const currentParent = computed<UUID | null>(() => currentAncestors.value.at(-1) ?? null);

const filteredItems = computed<TaskTreeItem[]>(() => {
    if (!props.taskUuid) return props.items;
    
    // Filter out the task being moved (descendants are automatically excluded)
    function filterNode(node: TaskTreeItem): TaskTreeItem | null {
        if (node.uuid === props.taskUuid) {
            return null; // Exclude the task being moved
        }

        const filteredChildren = node.children
            ?.map(filterNode)
            .filter((child): child is TaskTreeItem => child !== null) || [];

        return {
            ...node,
            children: filteredChildren.length > 0 ? filteredChildren : undefined
        };
    }

    // Apply circular reference filtering to all items
    return props.items
        .map(filterNode)
        .filter((item): item is TaskTreeItem => item !== null);
});



// Moving to where the task already is would do nothing, and the dialog opens on exactly that.
const canMove = computed<boolean>(() => {
    return props.taskUuid !== null && selectedParent.value !== currentParent.value;
});

// Methods  
function selectParent(parentUuid: UUID | null | undefined): void {
    // If tree deselects (parentUuid becomes undefined), auto-select root
    selectedParent.value = parentUuid === undefined ? null : parentUuid;
}

function confirmMove(): void {
    if (canMove.value) {
        emit('move', selectedParent.value);
        emit('update:modelValue', false);
    }
}

// Scroll the tree so the selected row sits in its middle.
//
// Measured with offsetTop rather than getBoundingClientRect: this runs while the dialog is still
// scaling in, and the transform skews bounding boxes but not layout offsets.
function revealSelected(): void {
    const container = treeContainer.value;
    if (!container) {
        return;
    }
    const row = container.querySelector<HTMLElement>('.v-list-item--active');
    if (!row) {
        // A root task's parent is the card above the tree, so start the tree from its top.
        container.scrollTop = 0;
        return;
    }
    let top = 0;
    let el: HTMLElement | null = row;
    while (el !== null && el !== container) {
        top += el.offsetTop;
        el = el.offsetParent as HTMLElement | null;
    }
    container.scrollTop = top - (container.clientHeight - row.offsetHeight) / 2;
}

// Start from where the task is now, so its current parent is what the dialog shows first.
watch(() => props.modelValue, async (isOpen) => {
    if (!isOpen) {
        return;
    }
    selectedParent.value = currentParent.value;
    // Every root is open for an overview; the current parent's ancestors are open too, or its row
    // would not be drawn at all.
    openNodes.value = [...new Set([
        ...props.items.map((item) => item.uuid),
        ...currentAncestors.value.slice(0, -1),
    ])];
    await nextTick();
    revealSelected();
});
</script>

<style scoped>
.v-card {
    overflow: visible;
}
</style>