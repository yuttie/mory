<template>
    <div id="tasks" class="d-flex" v-bind:class="{ 'flex-column': !$vuetify.breakpoint.mdAndUp, 'flex-row': $vuetify.breakpoint.mdAndUp }">
        <template v-if="store.isLoaded">
            <div class="d-flex flex-column task-tree-container"><!-- NOTE: Necessary for <TaskTree> to have vertical scrollbar -->
                <TaskTree
                    v-bind:items="store.forestWithTags"
                    v-bind:active="activeNodeId"
                    v-bind:open.sync="openNodes"
                    v-on:update:active="onTaskSelectionChangeInTree"
                    style="flex: 1 1 0"
                />
            </div>
            <div class="item-view d-flex flex-column">
                <div class="d-flex flex-row">
                    <v-tabs 
                        v-bind:value="itemViewTab"
                        v-on:change="onTabChange"
                    >
                        <v-tab
                            v-if="newTaskPath || selectedNode && !isTagGroupSelected"
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
                    v-bind:value="itemViewTab"
                    class="d-flex flex-column"
                    style="flex: 1 1 0; background: transparent;"
                >
                    <v-tab-item v-if="newTaskPath || selectedNode && !isTagGroupSelected" value="selected">
                        <TaskEditorNext
                            ref="taskEditorRef"
                            v-bind:task-path="newTaskPath ?? selectedNode.path"
                            v-bind:known-tags="knownTags"
                            v-bind:known-contacts="knownContacts"
                            v-bind:parent-task-title="newTaskPath && selectedNode ? selectedNode.title : undefined"
                            v-bind:selected-tag="newTaskPath && selectedNode && isTagGroupSelected ? selectedTagName : undefined"
                            class="ma-4"
                            v-on:save="onSelectedTaskSave"
                            v-on:delete="onSelectedTaskDelete"
                            v-on:cancel="onNewTaskCancel"
                        />
                    </v-tab-item>
                    <v-tab-item value="descendants">
                        <v-toolbar flat outlined dense class="flex-grow-0">
                            <!-- View mode selector -->
                            <v-btn-toggle
                                v-bind:value="descendantsViewMode"
                                v-on:change="onViewModeChange"
                                dense
                            >
                                <v-btn
                                    v-for="{ text, icon, value } of viewModeOptions"
                                    v-bind:value="value"
                                >
                                    <v-icon>{{ icon }}</v-icon>
                                    <span v-if="$vuetify.breakpoint.mdAndUp">{{ text }}</span>
                                </v-btn>
                            </v-btn-toggle>
                            <!-- New task button -->
                            <v-btn
                                title="Add"
                                outlined
                                class="ml-3"
                                v-bind:class="{ 'pa-0': !$vuetify.breakpoint.mdAndUp }"
                                v-on:click="newTask"
                            >
                                <v-icon>{{ mdiPlus }}</v-icon>
                                <span v-if="$vuetify.breakpoint.mdAndUp">Add</span>
                            </v-btn>
                        </v-toolbar>
                        <div class="groups-container flex-grow-1">
                            <!-- Status view -->
                            <div v-if="descendantsViewMode === 'status'" class="groups">
                                <v-card dense class="group">
                                    <v-card-title>To do</v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of taskStatuses.todo"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                                <v-card dense class="group">
                                    <v-card-title>In progress</v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of taskStatuses.inProgress"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                                <v-card dense class="group">
                                    <v-card-title>Waiting</v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of taskStatuses.waiting"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                                <v-card dense class="group">
                                    <v-card-title>Blocked</v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of taskStatuses.blocked"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                                <v-card dense class="group">
                                    <v-card-title>On hold</v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of taskStatuses.onHold"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                                <v-card dense class="group">
                                    <v-card-title>Done</v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of taskStatuses.done"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                                <v-card dense class="group">
                                    <v-card-title>Canceled</v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of taskStatuses.canceled"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                            </div>
                            <!-- Schedule view -->
                            <div v-else-if="descendantsViewMode === 'schedule'" class="groups">
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
                            <!-- Eisenhower Matrix view -->
                            <div v-else-if="descendantsViewMode === 'eisenhower'" class="eisenhower-matrix">
                                <v-card class="quadrant urgent-important">
                                    <v-card-title class="quadrant-header">
                                        <span class="quadrant-title">Do First</span>
                                        <span class="quadrant-subtitle">Urgent & Important</span>
                                    </v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of eisenhowerQuadrants.doFirst"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                                <v-card class="quadrant important-not-urgent">
                                    <v-card-title class="quadrant-header">
                                        <span class="quadrant-title">Schedule</span>
                                        <span class="quadrant-subtitle">Important, Not Urgent</span>
                                    </v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of eisenhowerQuadrants.schedule"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                                <v-card class="quadrant urgent-not-important">
                                    <v-card-title class="quadrant-header">
                                        <span class="quadrant-title">Delegate</span>
                                        <span class="quadrant-subtitle">Urgent, Not Important</span>
                                    </v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of eisenhowerQuadrants.delegate"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                                <v-card class="quadrant not-urgent-not-important">
                                    <v-card-title class="quadrant-header">
                                        <span class="quadrant-title">Eliminate</span>
                                        <span class="quadrant-subtitle">Not Urgent, Not Important</span>
                                    </v-card-title>
                                    <div class="task-list">
                                        <TaskListItemNext
                                            v-for="task of eisenhowerQuadrants.eliminate"
                                            v-bind:key="task.uuid"
                                            v-bind:value="task"
                                            v-on:click="onTaskListItemClick(task.uuid)"
                                        />
                                    </div>
                                </v-card>
                            </div>
                        </div>
                    </v-tab-item>
                </v-tabs-items>
            </div>
        </template>
        <v-overlay v-bind:value="store.isLoading" z-index="20">
            <v-progress-circular indeterminate size="64" />
        </v-overlay>
        <v-snackbar v-model="error" color="error" top timeout="5000">{{ error }}</v-snackbar>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';

import {
    mdiCalendarMultiselectOutline,
    mdiGridLarge,
    mdiPlus,
    mdiTrafficLightOutline,
} from '@mdi/js';

import { type TreeNodeRecord } from '@/stores/taskForest';
import { useTaggedTaskForestStore } from '@/stores/taggedTaskForest';

import * as api from '@/api';
import { type UUID, type StatusKind, type Task, render } from '@/task';
import axios from 'axios';
import dayjs from 'dayjs';

// Stores
const store = useTaggedTaskForestStore();

// Router
const router = useRouter();
const route = useRoute();

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Reactive states
const taskEditorRef = ref<any>(null);
const openNodes = ref<UUID[]>([]);
const newTaskPath = ref<string | null>(null);
const error = ref<string | null>(null);

// URL-derived state (single source of truth)
const selectedNode = computed<TreeNodeRecord | undefined>(() => {
    if (route.name === 'TasksNextWithParams' && route.params.selectedNodeId) {
        const nodeId = route.params.selectedNodeId === '_' ? undefined : route.params.selectedNodeId;
        return nodeId ? store.node(nodeId) : undefined;
    }
    return undefined;
});

const itemViewTab = computed<string>(() => {
    if (route.name === 'TasksNextWithParams' && route.params.tab) {
        return route.params.tab;
    }
    return 'descendants';
});

const descendantsViewMode = computed<'status' | 'schedule' | 'eisenhower'>(() => {
    if (route.name === 'TasksNextWithParams' && route.params.viewMode) {
        return route.params.viewMode as 'status' | 'schedule' | 'eisenhower';
    }
    return 'status';
});

// Computed properties
const activeNodeId = computed<string | undefined>(() => {
    return selectedNode.value?.uuid;
});

const isTagGroupSelected = computed<boolean>(() => {
    return activeNodeId.value?.startsWith('tag-group-') ?? false;
});

const selectedTagName = computed<string | null>(() => {
    if (activeNodeId.value && isTagGroupSelected.value) {
        return selectedNode.value.uuid.replace('tag-group-', '');
    }
    return null;
});

const taskStatuses = computed<TreeNodeRecord[]>(() => {
    let targetTasks;
    if (isTagGroupSelected.value && selectedTagName.value) {
        // Show tasks from the selected tag group
        targetTasks = store.childrenOf(`tag-group-${selectedTagName.value}`);
    }
    else {
        // Show tasks based on selected node (descendants or all tasks)
        targetTasks = selectedNode.value && !isTagGroupSelected.value
            ? store.flattenDescendants(selectedNode.value.uuid)
            : store.allTasks;
    }

    const statuses = {
        todo: [] as TreeNodeRecord[],
        inProgress: [] as TreeNodeRecord[],
        waiting: [] as TreeNodeRecord[],
        blocked: [] as TreeNodeRecord[],
        onHold: [] as TreeNodeRecord[],
        done: [] as TreeNodeRecord[],
        canceled: [] as TreeNodeRecord[],
    };

    for (const task of targetTasks) {
        const kind: StatusKind = task.metadata?.task?.status?.kind ?? 'todo';
        switch (kind) {
            case 'todo': statuses.todo.push(task); break;
            case 'in_progress': statuses.inProgress.push(task); break;
            case 'waiting': statuses.waiting.push(task); break;
            case 'blocked': statuses.blocked.push(task); break;
            case 'on_hold': statuses.onHold.push(task); break;
            case 'done': statuses.done.push(task); break;
            case 'canceled': statuses.canceled.push(task); break;
        }
    }

    return statuses;
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
        targetTasks = store.childrenOf(`tag-group-${selectedTagName.value}`);
    }
    else {
        // Show tasks based on selected node (descendants or all tasks)
        targetTasks = selectedNode.value && !isTagGroupSelected.value
            ? store.flattenDescendants(selectedNode.value.uuid)
            : store.allTasks;
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
    for (const node of store.allTasks) {
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
    for (const node of store.allTasks) {
        const contact = node.metadata?.task?.status?.contact;
        if (contact && contact.trim() !== '') {
            contactCounts.set(contact, (contactCounts.get(contact) ?? 0) + 1);
        }
    }
    return Array.from(contactCounts)
        .sort(([_contact1, count1], [_contact2, count2]) => count2 - count1);
});

// Eisenhower Matrix computed properties
const eisenhowerQuadrants = computed(() => {
    let targetTasks;
    if (isTagGroupSelected.value && selectedTagName.value) {
        // Show tasks from the selected tag group
        targetTasks = store.childrenOf(`tag-group-${selectedTagName.value}`);
    }
    else {
        // Show tasks based on selected node (descendants or all tasks)
        targetTasks = selectedNode.value && !isTagGroupSelected.value
            ? store.flattenDescendants(selectedNode.value.uuid)
            : store.allTasks;
    }

    const quadrants = {
        doFirst: [] as TreeNodeRecord[],      // High importance, High urgency
        schedule: [] as TreeNodeRecord[],     // High importance, Low urgency
        delegate: [] as TreeNodeRecord[],     // Low importance, High urgency
        eliminate: [] as TreeNodeRecord[],    // Low importance, Low urgency
    };

    for (const task of targetTasks) {
        const importance = task.metadata?.task?.importance ?? 3;
        const urgency = task.metadata?.task?.urgency ?? 3;
        const isHighImportance = importance >= 4;
        const isHighUrgency = urgency >= 4;

        if (isHighImportance && isHighUrgency) {
            quadrants.doFirst.push(task);
        } else if (isHighImportance && !isHighUrgency) {
            quadrants.schedule.push(task);
        } else if (!isHighImportance && isHighUrgency) {
            quadrants.delegate.push(task);
        } else {
            quadrants.eliminate.push(task);
        }
    }

    return quadrants;
});

const viewModeOptions = computed(() => [
    { text: 'Status View', icon: mdiTrafficLightOutline, value: 'status' },
    { text: 'Schedule View', icon: mdiCalendarMultiselectOutline, value: 'schedule' },
    { text: 'Eisenhower Matrix', icon: mdiGridLarge, value: 'eisenhower' },
]);

// URL management functions
function navigateToState(selectedNodeId?: string, tab?: string, viewMode?: string) {
    const params = {
        selectedNodeId: selectedNodeId || '_',
        tab: tab || 'descendants',
        viewMode: viewMode || 'status'
    };
    
    router.push({
        name: 'TasksNextWithParams',
        params: params
    }).catch(err => {
        // Ignore navigation duplicated errors
        if (err.name !== 'NavigationDuplicated') {
            // eslint-disable-next-line no-console
            console.error('Router navigation error:', err);
        }
    });
}

// Watchers for opening tree nodes when selected node changes
watch(selectedNode, (node) => {
    if (node) {
        // Open tree up to the corresponding item
        const next = new Set(openNodes.value);
        let parent = store.parentOf(node.uuid);
        while (parent) {
            next.add(parent);
            parent = store.parentOf(parent);
        }
        openNodes.value = [...next];
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

// Event handlers for UI interactions
function onTabChange(newTab: string) {
    navigateToState(selectedNode.value?.uuid, newTab, descendantsViewMode.value);
}

function onViewModeChange(newViewMode: string) {
    navigateToState(selectedNode.value?.uuid, itemViewTab.value, newViewMode);
}

// Methods
function onTaskSelectionChangeInTree(id: UUID | undefined) {
    const tab = (id && !id.startsWith('tag-group-')) ? 'selected' : 'descendants';
    navigateToState(id, tab, descendantsViewMode.value);
}

function onTaskListItemClick(id: UUID) {
    // Navigate to selected task
    navigateToState(id, 'selected', descendantsViewMode.value);
}

function newTask() {
    // Navigate to selected tab first
    navigateToState(selectedNode.value?.uuid, 'selected', descendantsViewMode.value);
    // Then generate new UUID and set path for the task
    const taskUuid = crypto.randomUUID();
    newTaskPath.value = getNewTaskPath(taskUuid);
}

function getNewTaskPath(taskUuid: string): string {
    let parentDir;
    if (selectedNode.value && !isTagGroupSelected.value) {
        // Create a task under the selected one (but not under tag groups)
        const selected = selectedNode.value;
        const idx = selected.path.lastIndexOf('/');
        parentDir = selected.path.slice(0, idx) + '/' + selected.uuid;
    }
    else {
        // Create a task under the root (for tag groups or no selection)
        parentDir = '.tasks';
    }
    return parentDir + '/' + taskUuid + '.md';
}

function updateNewTaskParent() {
    if (!newTaskPath.value) return;

    // Extract the UUID from the current newTaskPath
    const pathParts = newTaskPath.value.split('/');
    const filename = pathParts[pathParts.length - 1];
    const taskUuid = filename.replace('.md', '');

    // Update the path with the new parent but same UUID
    newTaskPath.value = getNewTaskPath(taskUuid);
}

// Watch for new task creation to update parent when selectedNode changes
watch(selectedNode, () => {
    if (newTaskPath.value) {
        updateNewTaskParent();
    }
});

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
        store.addNodeLocal(parentUuid, node);
        // Select the task and navigate to it
        newTaskPath.value = null;
        navigateToState(task.uuid, 'selected', descendantsViewMode.value);
        // Refresh the store
        await store.refresh();
    }
    else if (selectedNode.value) {
        // Update the existing one
        await api.addNote(selectedNode.value.path, markdown);
        // Update the store locally for immediate update
        store.replaceNodeLocal(node);
        // Refresh the store
        await store.refresh();
    }
    // Refresh task editor manually because its task-path prop retains the same value
    taskEditorRef.value.refresh();
}

async function onSelectedTaskDelete(path: string) {
    // Look up UUID by path
    const uuid = store.idByPath(path);
    if (!uuid) {
        return;
    }
    // Delete the task
    await api.deleteNote(path);
    // Update the store locally for immediate update
    store.deleteLeafLocal(uuid);
    // Unselect by navigating to no selection
    if (activeNodeId.value === uuid) {
        navigateToState(undefined, 'descendants', descendantsViewMode.value);
    }
    // Refresh the store
    await store.refresh();
}

function onNewTaskCancel() {
    // Clear the new task path and return to descendants view
    newTaskPath.value = null;
    navigateToState(selectedNode.value?.uuid, 'descendants', descendantsViewMode.value);
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
        await store.refresh();
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

/* Mobile responsive adjustments for main container */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    #tasks {
        padding: 4px;
    }
}

.task-tree {
    width: 300px;
    overflow: hidden auto;
}

.task-tree-container {
    width: 300px;
}

/* Mobile responsive adjustments */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .task-tree-container {
        width: 100%;
        max-height: 200px;
        min-height: 150px;
    }

    .task-tree {
        width: 100%;
    }
}

.item-view {
    flex: 1 1 0;
    background: #B0BEC5;
}

/* Mobile responsive adjustments for item view */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .item-view {
        min-height: 0; /* Allow shrinking on mobile */
    }
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

/* Mobile responsive adjustments for groups */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .groups {
        flex-direction: column;
        width: 100%;
        padding: $space / 2;
        gap: $space / 2;
    }

    .group {
        width: 100%;
        max-height: 300px;
    }
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

/* Eisenhower Matrix styles */
.eisenhower-matrix {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: $space;
    padding: $space;
    height: 100%;
}

.matrix-row {
    display: flex;
    gap: $space;
    flex: 1 1 0;
}

/* Mobile responsive adjustments for Eisenhower matrix */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .eisenhower-matrix {
        padding: $space / 2;
        gap: $space / 2;
    }

    .matrix-row {
        flex-direction: column;
        flex: none;
    }
}

.quadrant {
    display: flex;
    flex-direction: column;
    max-height: 100%;
    overflow: auto;
}

/* Mobile responsive adjustments for quadrants */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .quadrant {
        flex: none;
        max-height: 250px;
        min-height: 200px;
    }
}

.quadrant-header {
    flex-direction: column;
    align-items: flex-start !important;
    padding-bottom: 8px;
}

.quadrant-title {
    font-weight: 600;
    font-size: 1.1em;
}

.quadrant-subtitle {
    font-size: 0.85em;
    color: rgba(0, 0, 0, 0.6);
    font-weight: 400;
}

/* Color coding for quadrants */
.urgent-important {
    border-left: 4px solid #f44336; /* Red - Critical */
}

.important-not-urgent {
    border-left: 4px solid #2196f3; /* Blue - Important */
}

.urgent-not-important {
    border-left: 4px solid #ff9800; /* Orange - Delegate */
}

.not-urgent-not-important {
    border-left: 4px solid #9e9e9e; /* Gray - Eliminate */
}
</style>
