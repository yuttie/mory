<template>
    <div id="tasks" class="d-flex flex-row">
        <template v-if="taggedForest.isLoaded">
            <div class="d-flex flex-column"><!-- NOTE: Necessary for <TaskTree> to have vertical scrollbar -->
                <TaskTree
                    v-bind:items="taggedForest.forestWithTags"
                    v-bind:active="activeNodeId"
                    v-bind:open.sync="openNodes"
                    v-on:update:active="onTaskSelectionChangeInTree"
                    style="flex: 1 1 0"
                />
            </div>
            <div class="item-view d-flex flex-column">
                <div class="d-flex flex-row">
                    <v-tabs v-model="itemViewTab">
                        <v-tab
                            v-if="(newTaskPath ?? selectedNode) && !isTagGroupSelected"
                            tab-value="selected"
                        >
                            {{ newTaskPath ? 'New' : 'Selected' }}
                        </v-tab>
                        <v-tab tab-value="descendants">
                            {{ isTagGroupSelected ? 'Tagged Tasks' : selectedNode ? 'Descendants' : 'All tasks' }}
                        </v-tab>
                    </v-tabs>
                </div>
                <v-tabs-items
                    v-model="itemViewTab"
                    class="d-flex flex-column"
                    style="flex: 1 1 0; background: transparent;"
                >
                    <v-tab-item v-if="(newTaskPath ?? selectedNode) && !isTagGroupSelected" value="selected">
                        <TaskEditorNext
                            ref="taskEditorRef"
                            v-bind:task-path="newTaskPath ?? selectedNode.path"
                            v-bind:known-tags="knownTags"
                            v-bind:known-contacts="knownContacts"
                            class="ma-4"
                            v-on:save="onSelectedTaskSave"
                            v-on:delete="onSelectedTaskDelete"
                        />
                    </v-tab-item>
                    <v-tab-item value="descendants">
                        <v-toolbar flat outlined dense class="flex-grow-0" v-if="!isTagGroupSelected">
                            <!-- New task button -->
                            <v-btn
                                title="Add"
                                outlined
                                v-bind:class="{ 'pa-0': !$vuetify.breakpoint.mdAndUp }"
                                v-on:click="newTask"
                            >
                                <v-icon>{{ mdiPlus }}</v-icon>
                                <span v-if="$vuetify.breakpoint.mdAndUp">Add</span>
                            </v-btn>
                        </v-toolbar>
                        <div class="groups-container flex-grow-1">
                            <div class="groups">
                                <v-card dense class="group">
                                    <v-card-title>Backlog</v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of backlog"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                                <v-card class="group">
                                    <v-card-title>Scheduled</v-card-title>
                                    <div class="task-list">
                                        <div
                                            v-for="[date, dayTasks] of Object.entries(scheduled)"
                                            v-bind:key="date"
                                            v-bind:class="{ today: isToday(date) }"
                                        >
                                            <div class="date-header d-flex flex-row">
                                                <span>{{ isToday(date) ? `Today (${date})` : isTomorrow(date) ? `Tomorrow (${date})` : date }}</span>
                                            </div>
                                            <TaskListItemNext
                                                v-for="task of dayTasks"
                                                v-bind:key="task.uuid"
                                                v-bind:value="task"
                                                v-on:click="onTaskListItemClick(task.uuid)"
                                            />
                                        </div>
                                    </div>
                                </v-card>
                            </div>
                        </div>
                    </v-tab-item>
                </v-tabs-items>
            </div>
        </template>
        <v-overlay v-bind:value="taggedForest.isLoading" z-index="20">
            <v-progress-circular indeterminate size="64" />
        </v-overlay>
        <v-snackbar v-model="error" color="error" top timeout="5000">{{ error }}</v-snackbar>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

import {
    mdiPlus,
} from '@mdi/js';

import { type TreeNodeRecord } from '@/stores/taskForest';
import { useTaggedTaskForestStore } from '@/stores/taggedTaskForest';

import * as api from '@/api';
import { type UUID, type Task, render } from '@/task';
import axios from 'axios';
import dayjs from 'dayjs';

// Stores
const taggedForest = useTaggedTaskForestStore();

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Reactive states
const taskEditorRef = ref<any>(null);
const itemViewTab = ref<string>('descendants');
const selectedNode = ref<TreeNodeRecord | undefined>(undefined);
const openNodes = ref<UUID[]>([]);
const newTaskPath = ref<string | null>(null);
const error = ref<string | null>(null);

// Computed properties
const activeNodeId = computed<string | undefined>(() => {
    return selectedNode.value?.uuid;
});

const isTagGroupSelected = computed<boolean>(() => {
    return selectedNode.value?.uuid?.startsWith('tag-group-') ?? false;
});

const selectedTagName = computed<string | null>(() => {
    if (isTagGroupSelected.value && selectedNode.value?.uuid) {
        return selectedNode.value.uuid.replace('tag-group-', '');
    }
    return null;
});

const backlog = computed<TreeNodeRecord[]>(() => {
    const backlog = [];
    let targetTasks;

    if (isTagGroupSelected.value && selectedTagName.value) {
        // Show tasks from the selected tag group
        targetTasks = taggedForest.childrenOf(`tag-group-${selectedTagName.value}`);
    } else {
        // Show tasks based on selected node (descendants or all tasks)
        targetTasks = selectedNode.value && !isTagGroupSelected.value
            ? taggedForest.flattenDescendants(selectedNode.value.uuid)
            : taggedForest.allTasks;
    }

    for (const t of targetTasks) {
        if (!t.metadata?.task?.scheduled_dates?.length) {
            backlog.push(t);
        }
    }
    return backlog;
});

const scheduled = computed<Record<string, TreeNodeRecord[]>>(() => {
    // Keep today, tomorrow, or other dates that have some undone tasks
    const today = dayjs().format('YYYY-MM-DD');
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const scheduled: Record<string, TreeNodeRecord[]> = {
        [today]: [],
        [tomorrow]: [],
    };

    let targetTasks;
    if (isTagGroupSelected.value && selectedTagName.value) {
        // Show tasks from the selected tag group
        targetTasks = taggedForest.childrenOf(`tag-group-${selectedTagName.value}`);
    } else {
        // Show tasks based on selected node (descendants or all tasks)
        targetTasks = selectedNode.value && !isTagGroupSelected.value
            ? taggedForest.flattenDescendants(selectedNode.value.uuid)
            : taggedForest.allTasks;
    }

    for (const t of targetTasks) {
        if (t.metadata?.task?.scheduled_dates) {
            for (const date of t.metadata.task.scheduled_dates) {
                scheduled[date] ??= [];
                scheduled[date].push(t);
            }
        }
    }
    return scheduled;
});

const knownTags = computed<[string, number][]>(() => {
    // Collect tags
    const tagCounts = new Map();
    for (const node of taggedForest.allTasks) {
        for (const tag of node.metadata?.tags ?? []) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
    }
    return Array.from(tagCounts)
        .sort(([_tag1, count1], [_tag2, count2]) => count2 - count1);
});

const knownContacts = computed<[string, number][]>(() => {
    // Collect contacts
    const contactCounts = new Map();
    for (const node of taggedForest.allTasks) {
        const contact = node.metadata?.task?.status?.contact;
        if (contact && contact.trim() !== '') {
            contactCounts.set(contact, (contactCounts.get(contact) ?? 0) + 1);
        }
    }
    return Array.from(contactCounts)
        .sort(([_contact1, count1], [_contact2, count2]) => count2 - count1);
});

// Watchers
watch(selectedNode, (node) => {
    if (node && !node.uuid.startsWith('tag-group-')) {
        // Open 'selected' tab when a regular task is selected
        itemViewTab.value = 'selected';
    }
    else {
        // Open 'descendants' tab when nothing is selected or a tag group is selected
        itemViewTab.value = 'descendants';
    }
});

// Lifecycle hooks
onMounted(async () => {
    document.title = `Tasks | ${import.meta.env.VITE_APP_NAME}`;
    window.addEventListener('focus', load);
    await load();
});

onUnmounted(() => {
    window.removeEventListener('focus', load);
});

// Methods
function onTaskSelectionChangeInTree(id: UUID | undefined) {
    if (id && id.startsWith('tag-group-')) {
        // Handle tag group selection - get the virtual node from the tagged forest wrapper
        selectedNode.value = taggedForest.node(id);
        return;
    }

    // Handle regular task selection
    selectedNode.value = id ? taggedForest.node(id) : undefined;
}

function onTaskListItemClick(id: UUID) {
    selectedNode.value = taggedForest.node(id);
    // Open tree up to the corresponding item
    const next = new Set(openNodes.value);
    let parent = taggedForest.parentOf(id);
    while (parent) {
        next.add(parent);
        parent = taggedForest.parentOf(parent);
    }
    openNodes.value = [...next];
}

function newTask() {
    let parentDir;
    if (selectedNode.value && !selectedNode.value.uuid.startsWith('tag-group-')) {
        // Create a task under the selected one (but not under tag groups)
        const selected = selectedNode.value;
        const idx = selected.path.lastIndexOf('/');
        parentDir = selected.path.slice(0, idx) + '/' + selected.uuid;
    }
    else {
        // Create a task under the root
        parentDir = '.tasks';
    }
    newTaskPath.value = parentDir + '/' + crypto.randomUUID() + '.md';
    // Clear tag group selection and show 'selected' tab
    selectedNode.value = undefined;
    itemViewTab.value = 'selected';
}

async function onSelectedTaskSave(task: Task) {
    const path = newTaskPath.value ?? selectedNode.value?.path;
    if (!path) {
        return;
    }
    const node: TreeNodeRecord = {
        uuid: task.uuid,
        name: null,
        path: path,
        size: 0,
        mime_type: 'text/markdown',
        metadata: {
            task: {
                status: task.status,
                progress: task.progress,
                importance: task.importance,
                urgency: task.urgency,
                ...(task.start_at ? { start_at: task.start_at } : {}),
                ...(task.due_by ? { due_by: task.due_by } : {}),
                ...(task.deadline ? { deadline: task.deadline } : {}),
                scheduled_dates: task.scheduled_dates,
            },
            tags: task.tags,
        },
        title: task.title,
        mtime: '',
    };
    const markdown = render(task);
    if (newTaskPath.value) {
        // Create a new one
        await api.addNote(newTaskPath.value, markdown);
        // Update the store locally for immediate update
        const i = newTaskPath.value.lastIndexOf('/');
        const parentPath = newTaskPath.value.slice(0, i);
        const j = parentPath.lastIndexOf('/');
        const parentUuid = j === -1 ? null : parentPath.slice(j + 1);
        taggedForest.addNodeLocal(parentUuid, node);
        // Select the task
        newTaskPath.value = null;
        selectedNode.value = taggedForest.node(task.uuid);
        // Show 'selected' tab
        itemViewTab.value = 'selected';
        // Refresh the store
        await taggedForest.refresh();
    }
    else if (selectedNode.value) {
        // Update the existing one
        await api.addNote(selectedNode.value.path, markdown);
        // Update the store locally for immediate update
        taggedForest.replaceNodeLocal(node);
        // Refresh the store
        await taggedForest.refresh();
    }
    // Refresh task editor manually because its task-path prop retains the same value
    taskEditorRef.value.refresh();
}

async function onSelectedTaskDelete(path: string) {
    // Look up UUID by path
    const uuid = taggedForest.idByPath(path);
    if (!uuid) {
        return;
    }
    // Delete the task
    await api.deleteNote(path);
    // Update the store locally for immediate update
    taggedForest.deleteLeafLocal(uuid);
    // Unselect
    if (selectedNode.value?.uuid === uuid) {
        selectedNode.value = undefined;
    }
    // Refresh the store
    await taggedForest.refresh();
}

function isToday(date: string) {
    return date === dayjs().format('YYYY-MM-DD');
}

function isTomorrow(date: string) {
    return date === dayjs().add(1, 'day').format('YYYY-MM-DD');
}

async function load() {
    error.value = null;
    try {
        await taggedForest.refresh();
    }
    catch (e) {
        if (axios.isAxiosError(e) && e.response?.status === 401) {
            // Unauthorized
            emit('tokenExpired', () => load());
            return;
        }
        // Unhandled errors
        error.value = e.toString();
    }
}
</script>

<style scoped lang="scss">
$group-width: 270px;
$space: 12px;

#tasks {
    height: 100%;
    user-select: none;
}

.task-tree {
    width: 300px;
    overflow: hidden auto;
}

.item-view {
    flex: 1 1 0;
    background: #B0BEC5;
}

.groups-container {
    flex: 1 1 0;
    overflow-x: auto;
    overflow-y: hidden;
}

.groups {
    display: flex;
    width: fit-content;
    height: 100%;
    gap: $space;
    padding: $space;
}

.group {
    display: flex;
    flex-direction: column;
    align-self: flex-start;
    max-height: 100%;
    width: $group-width;
}

.task-list {
    overflow-y: auto;

    .date-header {
        padding: 2px 8px 0 8px;
    }
    div > .date-header {
        border-bottom: 2px solid #ddd;
        margin-bottom: 2px;
    }
    div + div > .date-header {
        margin-top: 12px;
    }
}

:deep(.item-view .v-window__container) {
    flex: 1 1 0;
}

:deep(.item-view .v-window-item) {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
}
</style>
