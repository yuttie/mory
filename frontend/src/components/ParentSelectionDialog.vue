<template>
    <v-dialog
        v-bind:model-value="modelValue"
        v-on:update:model-value="$emit('update:modelValue', $event)"
        max-width="600px"
        persistent
    >
        <v-card>
            <v-card-title>
                <span class="text-h5">{{ mode === 'choose' ? 'Choose Parent' : 'Change Parent' }}</span>
            </v-card-title>
            <!-- A column, so that in a window too short for the dialog the tree gives up its height
                 before the buttons go off the bottom. -->
            <v-card-text class="d-flex flex-column">
                <!-- Spaced from what follows by its last paragraph's margin alone: as an item of
                     the column, it no longer merges that margin with one of its own. -->
                <div class="flex-shrink-0">
                    <p v-if="mode === 'choose'">
                        Select a parent for the new task:
                    </p>
                    <template v-else>
                        <p>Select a new parent for <strong>{{ taskTitle }}</strong>:</p>
                        <p class="text-caption text-medium-emphasis">
                            The task and all its subtasks will be moved under the selected parent.
                        </p>
                    </template>
                </div>
                
                <!-- Root option -->
                <v-card
                    variant="outlined"
                    class="mb-3 pa-2 d-flex align-center flex-shrink-0"
                    v-bind:class="{ 'bg-blue-lighten-5': selectedParent === null }"
                    style="cursor: pointer"
                    v-on:click="selectParent(null)"
                >
                    <v-icon class="mr-2">{{ mdiFolder }}</v-icon>
                    <span>Root (No Parent)</span>
                    <v-spacer />
                    <v-icon v-if="selectedParent === null" color="primary">{{ mdiCheck }}</v-icon>
                </v-card>

                <!-- For the tree below alone: the root above is no task, and is always there. Made
                     anew on each opening, so that what it last held, a search still waiting for
                     typing to pause included, is gone with it. -->
                <TaskTreeSearch
                    v-bind:key="openings"
                    v-model:search="search"
                    v-model:hidden-statuses="hiddenStatuses"
                    class="mb-2 flex-shrink-0"
                />

                <!-- Task tree for parent selection -->
                <!-- Positioned, so that it is on the offsetParent chain `revealSelected` walks. -->
                <div
                    ref="treeContainer"
                    class="tree-box"
                    style="position: relative; border: 1px solid #e0e0e0; border-radius: 4px; overflow-y: auto;"
                >
                    <div
                        v-if="filtered.items.length === 0 && candidates.length > 0"
                        class="text-medium-emphasis pa-4"
                    >
                        No tasks match.
                    </div>
                    <!-- Every root is open, so the closed tasks under them all would be drawn too. -->
                    <TaskTree
                        v-bind:items="filtered.items"
                        v-bind:open="open"
                        v-bind:active="selectedParent"
                        v-bind:highlight="terms"
                        v-bind:found="filtered.found"
                        v-bind:fold-closed="terms.length === 0"
                        v-on:update:open="open = $event"
                        v-on:update:active="selectParent"
                        style="padding: 8px;"
                    />
                </div>
            </v-card-text>
            <v-card-actions>
                <!-- A search or the status filter may leave the row chosen out of the tree, and the
                     button acts on it all the same. -->
                <span
                    v-bind:id="chosenId"
                    class="chosen-parent text-body-2 text-truncate"
                    v-bind:title="chosenPath"
                ><span class="text-medium-emphasis">Under:</span> {{ chosenName }}</span>
                <v-btn
                    variant="text"
                    v-on:click="$emit('update:modelValue', false)"
                >
                    Cancel
                </v-btn>
                <!-- Described by the label, or a screen reader would say only what the button does,
                     not where. -->
                <v-btn
                    color="primary"
                    v-bind:disabled="!canChoose"
                    v-bind:aria-describedby="chosenId"
                    v-on:click="confirm"
                >
                    {{ mode === 'choose' ? 'Choose' : 'Move Here' }}
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts" setup>
import { ref, computed, watch, nextTick, useId } from 'vue';
import { mdiFolder, mdiCheck } from '@mdi/js';

import TaskTree from './TaskTree.vue';
import TaskTreeSearch from './TaskTreeSearch.vue';
import type { UUID } from '@/api';
import { useLocalStorage } from '@/composables/localStorage';
import { useTaskTreeFilter } from '@/composables/taskTreeFilter';
import type { TaskTreeItem } from '@/task-forest';

// Props
const props = defineProps<{
    modelValue: boolean;
    // `move` for a task that exists, which choosing moves along with its subtasks; `choose` for one
    // not written yet, which choosing only places.
    mode: 'move' | 'choose';
    // The parent the task has now, `null` for none: where the dialog starts.
    parent: UUID | null;
    // The task being placed, left out of the tree with everything under it, since a task cannot go
    // under itself.
    exclude?: UUID;
    taskTitle?: string;
    items: TaskTreeItem[];
}>();

// Emits
const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
    (e: 'choose', parent: UUID | null): void;
}>();

// Reactive state
const selectedParent = ref<UUID | null>(null);
// The branches open while no search is under way.
const openNodes = ref<UUID[]>([]);
const treeContainer = ref<HTMLElement | null>(null);
// How many times the dialog has opened.
const openings = ref(0);
// The label's, which describes the button: one of its own for each dialog, as two may be mounted
// at once.
const chosenId = useId();
// The statuses left out, kept apart from the task tree's: the tree may leave out tasks not to be
// worked on yet, such as the backlog, where the parent looked for may well be.
const HIDDEN_STATUSES_KEY = 'parent-selection-hidden-statuses';
const hiddenStatuses = useLocalStorage<string[]>(HIDDEN_STATUSES_KEY, []);

// The tasks from a root down to `uuid`, itself included: null for one not in the tree.
function chainOf(items: TaskTreeItem[], uuid: UUID): TaskTreeItem[] | null {
    for (const item of items) {
        if (item.uuid === uuid) {
            return [item];
        }
        const below = chainOf(item.children ?? [], uuid);
        if (below !== null) {
            return [item, ...below];
        }
    }
    return null;
}

// The tasks from a root down to `uuid`'s parent: empty for a root task, null for one not in the
// tree.
function ancestorsOf(items: TaskTreeItem[], uuid: UUID): UUID[] | null {
    return chainOf(items, uuid)?.slice(0, -1).map((item) => item.uuid) ?? null;
}

// Computed properties
// The parent chosen and the tasks above it, root first: empty for none, null for one gone from the
// tree.
const chosenChain = computed<TaskTreeItem[] | null>(() => (
    selectedParent.value === null ? [] : chainOf(props.items, selectedParent.value)
));

// What the parent chosen is called, said beside the button that places the task there.
const chosenName = computed<string>(() => {
    const chosen = chosenChain.value?.at(-1);
    return chosen === undefined ? 'Root' : chosen.title || 'Untitled';
});

// Where it is, as tasks in different projects may share a title.
const chosenPath = computed<string>(() => {
    const chain = chosenChain.value ?? [];
    return chain.length === 0 ? 'Root (No Parent)' : chain.map((item) => item.title || 'Untitled').join(' › ');
});

// The current parent and the tasks above it, root first.
const parentChain = computed<UUID[]>(() => {
    if (props.parent === null) {
        return [];
    }
    return [...(ancestorsOf(props.items, props.parent) ?? []), props.parent];
});

// The tasks the task can go under.
const candidates = computed<TaskTreeItem[]>(() => {
    if (!props.exclude) return props.items;
    
    // Filter out the task being placed (descendants are automatically excluded)
    function filterNode(node: TaskTreeItem): TaskTreeItem | null {
        if (node.uuid === props.exclude) {
            return null; // Exclude the task being placed
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



const { search, terms, filtered, open, openAlso } = useTaskTreeFilter(candidates, hiddenStatuses, openNodes);

// Choosing the parent the task already has would do nothing, and the dialog opens on exactly that.
const canChoose = computed<boolean>(() => selectedParent.value !== props.parent);

// A parent chosen that leaves the tree while the dialog is open, as a sync may take one, gives way
// to the root: a move under it would fail, and the callers place a new task at the root instead, so
// the label and the button say what choosing does.
watch(chosenChain, (chain) => {
    if (chain === null) {
        selectedParent.value = null;
    }
});

// Methods  
function selectParent(parentUuid: UUID | null | undefined): void {
    // If tree deselects (parentUuid becomes undefined), auto-select root
    selectedParent.value = parentUuid === undefined ? null : parentUuid;
    // Its branch opens in the tree drawn without a search as well, as the task tree opens the way
    // to the task chosen there, or clearing the search it was found by would hide its row.
    if (parentUuid) {
        openAlso(ancestorsOf(props.items, parentUuid) ?? []);
    }
}

function confirm(): void {
    if (canChoose.value) {
        emit('choose', selectedParent.value);
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
    selectedParent.value = props.parent;
    // Without the last search, which could leave out the parent it starts from.
    search.value = '';
    openings.value++;
    // As the last picker left them, which may be another: the task editor's lives as long as the
    // Tasks view, a new task's and Quick add's only while their dialogs are open, and a write to
    // localStorage tells only the other tabs.
    try {
        hiddenStatuses.value = JSON.parse(localStorage.getItem(HIDDEN_STATUSES_KEY) ?? '[]');
    }
    catch {
        // A value that does not read leaves the statuses as this picker last had them.
    }
    // Every root is open for an overview; the current parent's ancestors are open too, or its row
    // would not be drawn at all.
    openNodes.value = [...new Set([
        ...props.items.map((item) => item.uuid),
        ...parentChain.value.slice(0, -1),
    ])];
    await nextTick();
    revealSelected();
});
</script>

<style scoped>
/* Scrolls, rather than push the buttons off a window too short even for the tree's least height. */
.v-card-text {
    min-height: 0;
    overflow-y: auto;
}

/* Of one height, however few rows a search leaves, or the dialog, centred, would move the field
   being typed into. Less in a window too short for it, down to a few rows. */
.tree-box {
    flex: 0 1 400px;
    min-height: 120px;
}

/* Taking the room the buttons leave, and cut short rather than push them out of the dialog: the
   overflow `text-truncate` hides lets it shrink below its text. */
.chosen-parent {
    flex: 1 1 0;
    padding-inline: 8px;
}
</style>