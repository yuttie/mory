<template>
    <div id="tasks" class="d-flex flex-column">
        <v-toolbar flat border color="transparent" class="flex-grow-0">
            <v-toolbar-title>Legacy tasks (read-only)</v-toolbar-title>
            <v-switch v-model="hideDone" label="Hide done" hide-details></v-switch>
            <v-btn variant="text" title="Reload" v-on:click="load"><v-icon>{{ mdiReload }}</v-icon></v-btn>
            <v-text-field label="Search" clearable v-model="searchQuery" hide-details></v-text-field>
            <v-progress-linear absolute location="bottom" indeterminate v-bind:active="isLoading"></v-progress-linear>
        </v-toolbar>
        <v-alert v-if="noData" type="info">No legacy task data</v-alert>
        <div v-else class="groups-container flex-grow-1">
            <div class="groups">
                <v-card class="group">
                    <v-card-title>Scheduled</v-card-title>
                    <div class="task-list">
                        <div v-for="[date, dayTasks] of scheduledTasks" v-bind:key="date" v-bind:class="{ today: isToday(date) }">
                            <div class="date-header">{{ date }}</div>
                            <TaskListItem v-for="task of dayTasks" v-bind:key="task.id" v-bind:value="task" v-show="!hideDone || !task.done"></TaskListItem>
                        </div>
                    </div>
                </v-card>
                <v-card class="group">
                    <v-card-title>With Deadline</v-card-title>
                    <div class="task-list">
                        <TaskListItem v-for="[, , task] of tasksWithDeadline" v-bind:key="task.id" v-bind:value="task"></TaskListItem>
                    </div>
                </v-card>
                <v-card class="group">
                    <v-card-title>Backlog</v-card-title>
                    <div class="task-list">
                        <TaskListItem v-for="task of filteredTasks.backlog" v-bind:key="task.id" v-bind:value="task" v-show="!hideDone || !task.done"></TaskListItem>
                    </div>
                </v-card>
                <div class="separator"></div>
                <div class="custom-groups">
                    <v-card v-for="group of groups" v-bind:key="group.name" class="group">
                        <v-card-title>{{ group.name }}</v-card-title>
                        <div class="task-list">
                            <div v-for="date of Object.keys(groupedTasks[group.name].scheduled).sort().reverse()" v-bind:key="date">
                                <div class="date-header">{{ date }}</div>
                                <TaskListItem v-for="[, task] of groupedTasks[group.name].scheduled[date]" v-bind:key="task.id" v-bind:value="task" v-show="!hideDone || !task.done"></TaskListItem>
                            </div>
                            <div class="date-header">Backlog</div>
                            <TaskListItem v-for="[, task] of groupedTasks[group.name].backlog" v-bind:key="task.id" v-bind:value="task" v-show="!hideDone || !task.done"></TaskListItem>
                        </div>
                    </v-card>
                </div>
            </div>
        </div>
        <v-snackbar v-model="errorNotification" color="error" location="top">{{ errorNotificationText }}</v-snackbar>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { mdiReload } from '@mdi/js';
import { useLocalStorage } from '@/composables/localStorage';
import * as api from '@/api';
import type { Task } from '@/api';
import axios from 'axios';
import dayjs from 'dayjs';

const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();
const eTag = ref<string>();
const tasks = ref<api.TaskData['tasks']>({ backlog: [], scheduled: {} });
const groups = ref<api.TaskData['groups']>([]);
const searchQuery = ref('');
const isLoading = ref(false);
const noData = ref(false);
const hideDone = useLocalStorage('hide-done', true);
const errorNotification = ref(false);
const errorNotificationText = ref('');

const filteredTasks = computed(() => {
    const re = new RegExp((searchQuery.value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i");
    const processedTasks: api.TaskData["tasks"] = { backlog: [], scheduled: {} };
    processedTasks.backlog = tasks.value.backlog.filter((task) => re.test(task.name) || task.tags?.some((tag) => re.test(tag)));
    processedTasks.scheduled = {};
    for (const [date, dayTasks] of Object.entries(tasks.value.scheduled)) {
        processedTasks.scheduled[date] = dayTasks.filter((task) => re.test(task.name) || task.tags?.some((tag) => re.test(tag)));
    }
    return processedTasks;
});

const scheduledTasks = computed(() => {
    let dates = Object.keys(filteredTasks.value.scheduled);
    dates.sort((a, b) => a < b ? 1 : a > b ? -1 : 0);
    if (hideDone.value) {
        // Keep today, tomorrow, or other dates that have some undone tasks
        const today = dayjs().format('YYYY-MM-DD');
        const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
        dates = dates.filter(date => {
            return date === today || date === tomorrow || filteredTasks.value.scheduled[date].some(task => !task.done);
        });
    }
    return dates.map((date): [string, Task[]] => [date, filteredTasks.value.scheduled[date]]);
});

const tasksWithDeadline = computed(() => {
    const result: [string | null, number, Task][] = [];
    // Backlog
    for (const [i, task] of filteredTasks.value.backlog.entries()) {
        if (task.deadline) {
            result.push([null, i, task]);
        }
    }
    // Scheduled
    for (const [date, dayTasks] of Object.entries(filteredTasks.value.scheduled)) {
        for (const [i, task] of dayTasks.entries()) {
            if (task.deadline) {
                result.push([date, i, task]);
            }
        }
    }
    if (hideDone.value) {
        // Remove scheduled tasks which are done
        let i = 0;
        while (i < result.length) {
            let [_date, _i, task] = result[i];
            if (task.done) {
                result.splice(i, 1);
            }
            else {
                i += 1;
            }
        }
    }
    // Sort
    result.sort(([_date1, _i1, task1], [_date2, _i2, task2]) => {
        if (task1.done && !task2.done) {
            return +1;
        }
        else if (!task1.done && task2.done) {
            return -1;
        }
        else {
            const deadline1 = dayjs(task1.deadline);
            const deadline2 = dayjs(task2.deadline);
            if (deadline1.isAfter(deadline2)) {
                return -1;
            }
            else if (deadline2.isAfter(deadline1)) {
                return +1;
            }
            else {
                return 0;
            }
        }
    });
    return result;
});

const groupedTasks = computed(() => {
    type Grouped = {
        backlog: [number, Task][];
        scheduled: { [key: string]: [number, Task][] };
    };
    const result: { [key: string]: Grouped } = {};
    for (const group of groups.value) {
        const grouped: Grouped = {
            backlog: [],
            scheduled: {},
        };
        // Backlog
        for (const [i, task] of filteredTasks.value.backlog.entries()) {
            if ((task.tags || []).includes(group.filter)) {
                grouped.backlog.push([i, task]);
            }
        }
        // Scheduled
        for (const [date, dayTasks] of Object.entries(filteredTasks.value.scheduled)) {
            grouped.scheduled[date] = [];
            for (const [i, task] of dayTasks.entries()) {
                if ((task.tags || []).includes(group.filter)) {
                    grouped.scheduled[date].push([i, task]);
                }
            }
            // Remove if empty or all tasks are done
            const empty = grouped.scheduled[date].length === 0;
            const allDone = grouped.scheduled[date].every(([_, task]) => task.done);
            if (empty || hideDone.value && allDone) {
                delete grouped.scheduled[date];
            }
        }
        // Add
        result[group.name] = grouped;
    }
    return result;
});

onMounted(() => {
    document.title = `Legacy tasks | ${import.meta.env.VITE_APP_NAME}`;
    window.addEventListener('focus', load);
    void load();
});
onUnmounted(() => window.removeEventListener('focus', load));

function isToday(date: string): boolean {
    return date === dayjs().format('YYYY-MM-DD');
}

async function load(): Promise<void> {
    if (isLoading.value) {
        return;
    }
    isLoading.value = true;
    try {
        const [newETag, data] = await api.getTaskData(eTag.value);
        eTag.value = newETag;
        if (data !== null) {
            tasks.value = data.tasks;
            groups.value = data.groups;
            noData.value = false;
        }
    }
    catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            emit('tokenExpired', () => void load());
        }
        else if (axios.isAxiosError(error) && error.response?.status === 404) {
            tasks.value = { backlog: [], scheduled: {} };
            groups.value = [];
            eTag.value = undefined;
            noData.value = true;
        }
        else {
            errorNotificationText.value = String(error);
            errorNotification.value = true;
        }
    }
    finally {
        isLoading.value = false;
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
.custom-groups {
    display: flex;
    width: fit-content;
    height: 100%;
    gap: $space;
}
.group {
    display: flex;
    flex-direction: column;
    align-self: flex-start;
    max-height: 100%;
    width: $group-width;
}
.custom-groups .group {
    &.sortable-ghost {
        visibility: hidden;
    }
}
.handle {
    cursor: grab;
}
.task-list {
    overflow-y: auto;

    .date-header {
        padding: 2px 8px 0 8px;
    }
    .task-list-item {
        padding: 4px 8px;
    }
    div > .date-header {
        border-bottom: 2px solid #ddd;
        margin-bottom: 2px;
    }
    div + div > .date-header {
        margin-top: 12px;
    }
}
.separator {
    margin: 0 1em;
}
</style>
