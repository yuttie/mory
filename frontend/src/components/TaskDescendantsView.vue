<template>
    <div>
        <v-toolbar flat outlined dense class="flex-grow-0">
            <!-- New task button -->
            <v-btn
                title="Add"
                outlined
                v-bind:class="{ 'pa-0': !$vuetify.breakpoint.mdAndUp }"
                v-on:click="onNewTask"
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
    </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';

import {
    mdiPlus,
} from '@mdi/js';

import { type TreeNodeRecord, useTaskForestStore } from '@/stores/taskForest';
import { type UUID } from '@/task';
import TaskListItemNext from '@/components/TaskListItemNext.vue';
import dayjs from 'dayjs';

// Composables
const store = useTaskForestStore();

// Props
const props = defineProps<{
    selectedNode?: TreeNodeRecord;
}>();

// Emits
const emit = defineEmits<{
    (e: 'newTask'): void;
    (e: 'taskClick', taskId: UUID): void;
}>();

// Computed properties
const backlog = computed<TreeNodeRecord[]>(() => {
    const backlog = [];
    const targetTasks = props.selectedNode
        ? store.flattenDescendants(props.selectedNode.uuid)
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
    const targetTasks = props.selectedNode
        ? store.flattenDescendants(props.selectedNode.uuid)
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

// Methods
function onNewTask() {
    emit('newTask');
}

function onTaskListItemClick(id: UUID) {
    emit('taskClick', id);
}

function isToday(date: string) {
    return date === dayjs().format('YYYY-MM-DD');
}

function isTomorrow(date: string) {
    return date === dayjs().add(1, 'day').format('YYYY-MM-DD');
}
</script>

<style scoped lang="scss">
$group-width: 270px;
$space: 12px;

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
</style>