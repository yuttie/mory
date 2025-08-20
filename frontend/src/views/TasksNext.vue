<template>
    <div id="tasks" class="d-flex flex-row">
        <template v-if="store.isLoaded">
            <div class="d-flex flex-column"><!-- NOTE: Necessary for <TaskTree> to have vertical scrollbar -->
                <TaskTree
                    v-bind:items="store.forest"
                    v-bind:active="selectedNode?.uuid"
                    v-bind:open.sync="openNodes"
                    v-on:update:active="onTaskSelectionChangeInTree"
                    style="flex: 1 1 0"
                />
            </div>
            <div class="item-view d-flex flex-column">
                <div class="d-flex flex-row">
                    <v-tabs v-model="itemViewTab">
                        <v-tab
                            v-if="newTaskPath ?? selectedNode"
                            tab-value="selected"
                        >
                            {{ newTaskPath ? 'New' : 'Selected' }}
                        </v-tab>
                        <v-tab tab-value="descendants">
                            {{ selectedNode ? 'Descendants' : 'All tasks' }}
                        </v-tab>
                    </v-tabs>
                </div>
                <v-tabs-items
                    v-model="itemViewTab"
                    class="d-flex flex-column"
                    style="flex: 1 1 0; background: transparent;"
                >
                    <v-tab-item v-if="newTaskPath ?? selectedNode" value="selected">
                        <TaskEditorNext
                            ref="taskEditorRef"
                            v-bind:task-path="newTaskPath ?? selectedNode.path"
                            v-bind:known-tags="knownTags"
                            class="ma-4"
                            v-on:save="onSelectedTaskSave"
                            v-on:delete="onSelectedTaskDelete"
                        />
                    </v-tab-item>
                    <v-tab-item value="descendants">
                        <v-toolbar flat outlined dense class="flex-grow-0">
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
                            
                            <v-spacer />
                            
                            <!-- Auto-create issues button -->
                            <v-btn
                                title="Auto-create issues from notes"
                                outlined
                                v-bind:loading="autoCreatingIssues"
                                v-bind:disabled="autoCreatingIssues"
                                v-bind:class="{ 'pa-0': !$vuetify.breakpoint.mdAndUp }"
                                v-on:click="showAutoIssueDialog = true"
                            >
                                <v-icon>{{ mdiAutorenew }}</v-icon>
                                <span v-if="$vuetify.breakpoint.mdAndUp">Auto Issues</span>
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
        <v-overlay v-bind:value="store.isLoading" z-index="20">
            <v-progress-circular indeterminate size="64" />
        </v-overlay>
        <v-snackbar v-model="error" color="error" top timeout="5000">{{ error }}</v-snackbar>
        
        <!-- Auto Issue Creation Dialog -->
        <v-dialog v-model="showAutoIssueDialog" max-width="600px" persistent>
            <v-card>
                <v-card-title>
                    <span class="headline">Auto-Create Issues</span>
                </v-card-title>
                <v-card-text>
                    <div v-if="!autoIssuePreviewLoading && !autoCreatingIssues">
                        <p>Scan your notes for actionable items (TODO, FIXME, BUG, ACTION) and automatically create tasks.</p>
                        
                        <v-expansion-panels v-if="previewIssues.length > 0" class="mb-4">
                            <v-expansion-panel>
                                <v-expansion-panel-header>
                                    Preview: {{ previewIssues.length }} issues found
                                </v-expansion-panel-header>
                                <v-expansion-panel-content>
                                    <div v-for="issue in previewIssues.slice(0, 10)" :key="issue.sourceFile + issue.lineNumber" class="mb-2">
                                        <div class="d-flex align-center">
                                            <v-chip small :color="issue.type === 'bug' || issue.type === 'fixme' ? 'red' : issue.type === 'todo' || issue.type === 'action' ? 'blue' : 'grey'" dark class="mr-2">
                                                {{ issue.type.toUpperCase() }}
                                            </v-chip>
                                            <span class="font-weight-medium">{{ issue.title }}</span>
                                        </div>
                                        <div class="text-caption text--secondary ml-8">
                                            {{ issue.sourceFile }}:{{ issue.lineNumber }}
                                        </div>
                                    </div>
                                    <div v-if="previewIssues.length > 10" class="text-caption">
                                        ...and {{ previewIssues.length - 10 }} more
                                    </div>
                                </v-expansion-panel-content>
                            </v-expansion-panel>
                        </v-expansion-panels>
                        
                        <div v-else-if="previewIssues.length === 0 && !autoIssuePreviewLoading">
                            <v-alert type="info" dense>
                                No actionable items found in your notes.
                            </v-alert>
                        </div>
                    </div>
                    
                    <div v-if="autoIssuePreviewLoading" class="text-center">
                        <v-progress-circular indeterminate />
                        <div class="mt-2">Scanning notes...</div>
                    </div>
                    
                    <div v-if="autoCreatingIssues" class="text-center">
                        <v-progress-circular indeterminate />
                        <div class="mt-2">Creating {{ previewIssues.length }} tasks...</div>
                    </div>
                    
                    <div v-if="autoIssueResult" class="mt-4">
                        <v-alert v-if="autoIssueResult.createdTasks.length > 0" type="success" dense>
                            Successfully created {{ autoIssueResult.createdTasks.length }} tasks!
                        </v-alert>
                        <v-alert v-if="autoIssueResult.errors.length > 0" type="warning" dense>
                            {{ autoIssueResult.errors.length }} errors occurred during creation.
                        </v-alert>
                    </div>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn text v-on:click="closeAutoIssueDialog">Cancel</v-btn>
                    <v-btn 
                        color="primary" 
                        v-bind:disabled="previewIssues.length === 0 || autoCreatingIssues"
                        v-bind:loading="autoCreatingIssues"
                        v-on:click="createAutoIssues"
                    >
                        Create {{ previewIssues.length }} Tasks
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

import {
    mdiPlus,
    mdiAutorenew,
} from '@mdi/js';

import TaskEditorNext from '@/components/TaskEditorNext.vue';
import TaskListItemNext from '@/components/TaskListItemNext.vue';
import { type TreeNodeRecord, useTaskForestStore } from '@/stores/taskForest';

import * as api from '@/api';
import { type UUID, type Task, render } from '@/task';
import { autoIssueService } from '@/services/autoIssueService';
import type { DetectedIssue, AutoIssueResult } from '@/services/autoIssueService';
import axios from 'axios';
import dayjs from 'dayjs';

// Composables
const store = useTaskForestStore();

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

// Auto-issue creation states
const showAutoIssueDialog = ref<boolean>(false);
const autoIssuePreviewLoading = ref<boolean>(false);
const autoCreatingIssues = ref<boolean>(false);
const previewIssues = ref<DetectedIssue[]>([]);
const autoIssueResult = ref<AutoIssueResult | null>(null);

// Computed properties
const backlog = computed<TreeNodeRecord[]>(() => {
    const backlog = [];
    const targetTasks = selectedNode.value
        ? store.flattenDescendants(selectedNode.value.uuid)
        : store.allTasks;
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
    const targetTasks = selectedNode.value
        ? store.flattenDescendants(selectedNode.value.uuid)
        : store.allTasks;
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

// Watchers
watch(selectedNode, (node) => {
    if (node) {
        // Open 'selected' tab when a task is selected
        itemViewTab.value = 'selected';
    }
    else {
        // Open 'descendants' tab when nothing is selected
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
    selectedNode.value = id ? store.node(id) : undefined;
}

function onTaskListItemClick(id: UUID) {
    selectedNode.value = store.node(id);
    // Open tree up to the corresponding item
    const next = new Set(openNodes.value);
    let parent = store.parentOf(id);
    while (parent) {
        next.add(parent);
        parent = store.parentOf(parent);
    }
    openNodes.value = [...next];
}

function newTask() {
    let parentDir;
    if (selectedNode.value) {
        // Create a task under the selected one
        const selected = selectedNode.value;
        const idx = selected.path.lastIndexOf('/');
        parentDir = selected.path.slice(0, idx) + '/' + selected.uuid;
    }
    else {
        // Create a task under the root
        parentDir = '.tasks';
    }
    newTaskPath.value = parentDir + '/' + crypto.randomUUID() + '.md';
    // Show 'selected' tab
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
        store.addNodeLocal(parentUuid, node);
        // Select the task
        newTaskPath.value = null;
        selectedNode.value = store.node(task.uuid);
        // Show 'selected' tab
        itemViewTab.value = 'selected';
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
    // Unselect
    if (selectedNode.value?.uuid === uuid) {
        selectedNode.value = undefined;
    }
    // Refresh the store
    await store.refresh();
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

// Auto-issue creation methods
watch(showAutoIssueDialog, async (newValue) => {
    if (newValue) {
        await previewAutoIssues();
    }
});

async function previewAutoIssues() {
    autoIssuePreviewLoading.value = true;
    autoIssueResult.value = null;
    try {
        previewIssues.value = await autoIssueService.previewIssues();
    } catch (e) {
        error.value = `Error previewing issues: ${e instanceof Error ? e.message : String(e)}`;
        previewIssues.value = [];
    } finally {
        autoIssuePreviewLoading.value = false;
    }
}

async function createAutoIssues() {
    autoCreatingIssues.value = true;
    try {
        autoIssueResult.value = await autoIssueService.scanAndCreateIssues();
        
        if (autoIssueResult.value.createdTasks.length > 0) {
            // Refresh the store to show new tasks
            await store.refresh();
        }
        
        if (autoIssueResult.value.errors.length > 0) {
            console.warn('Auto-issue creation errors:', autoIssueResult.value.errors);
        }
    } catch (e) {
        error.value = `Error creating auto-issues: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
        autoCreatingIssues.value = false;
    }
}

function closeAutoIssueDialog() {
    showAutoIssueDialog.value = false;
    previewIssues.value = [];
    autoIssueResult.value = null;
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
