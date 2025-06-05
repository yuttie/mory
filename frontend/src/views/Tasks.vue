<template>
    <div id="tasks" class="d-flex flex-column">
        <v-toolbar flat outlined dense class="flex-grow-0">
            <!-- New task button -->
            <v-dialog
                max-width="600px"
                persistent
                v-model="newTaskDialog"
            >
                <template v-slot:activator="{ on, attrs }">
                    <v-btn
                        text
                        title="Add task"
                        v-bind="{ ...attrs, class: { 'pa-0': !$vuetify.breakpoint.mdAndUp } }"
                        v-on="on"
                    >
                        <v-icon>mdi-checkbox-marked-circle-plus-outline</v-icon>
                        <span v-if="$vuetify.breakpoint.mdAndUp">Task</span>
                    </v-btn>
                </template>
                <v-card>
                    <v-card-actions>
                        <v-spacer></v-spacer>
                        <v-btn
                            text
                            color="primary"
                            v-on:click="add(false)"
                            v-bind:disabled="newTask.name.length === 0"
                        >
                            <v-icon>mdi-plus-box-multiple-outline</v-icon>
                            <span v-if="$vuetify.breakpoint.smAndUp">Add & New</span>
                        </v-btn>
                        <v-btn
                            text
                            color="primary"
                            v-on:click="add"
                            v-bind:disabled="newTask.name.length === 0"
                        >
                            <v-icon>mdi-plus-box-outline</v-icon>
                            <span v-if="$vuetify.breakpoint.smAndUp">Add</span>
                        </v-btn>
                        <v-btn
                            icon
                            v-on:click="closeNewTaskDialog"
                        ><v-icon>mdi-close</v-icon></v-btn>
                    </v-card-actions>
                    <v-card-text>
                        <TaskEditor v-model="newTask" v-bind:knownTags="knownTags"></TaskEditor>
                    </v-card-text>
                </v-card>
            </v-dialog>

            <!-- New group button -->
            <v-dialog
                max-width="600px"
                persistent
                v-model="newGroupDialog"
            >
                <template v-slot:activator="{ on, attrs }">
                    <v-btn
                        text
                        title="Add group"
                        v-bind="{ ...attrs, class: { 'pa-0': !$vuetify.breakpoint.mdAndUp } }"
                        v-on="on"
                    >
                        <v-icon>mdi-format-list-group-plus</v-icon>
                        <span v-if="$vuetify.breakpoint.mdAndUp">Group</span>
                    </v-btn>
                </template>
                <v-card>
                    <v-card-actions>
                        <v-spacer></v-spacer>
                        <v-btn
                            text
                            color="primary"
                            v-on:click="addGroup"
                            v-bind:disabled="newGroupName.length === 0 || newGroupFilter.length === 0"
                        >
                            <v-icon>mdi-plus-box-outline</v-icon>
                            <span v-if="$vuetify.breakpoint.smAndUp">Add</span>
                        </v-btn>
                        <v-btn
                            icon
                            v-on:click="closeNewGroupDialog"
                        ><v-icon>mdi-close</v-icon></v-btn>
                    </v-card-actions>
                    <v-card-text>
                        <v-text-field
                            label="Name"
                            autofocus
                            prepend-icon="mdi-pencil"
                            v-model="newGroupName"
                        ></v-text-field>
                        <v-text-field
                            label="Tag"
                            prepend-icon="mdi-tag-outline"
                            v-model="newGroupFilter"
                        ></v-text-field>
                    </v-card-text>
                </v-card>
            </v-dialog>

            <!-- Collect undone button -->
            <v-btn
                text
                title="Collect undone"
                v-bind:class="{ 'pa-0': !$vuetify.breakpoint.mdAndUp }"
                v-on:click="collectUndone"
            >
                <v-icon>mdi-checkbox-multiple-blank-outline</v-icon>
                <span v-if="$vuetify.breakpoint.mdAndUp">Collect Undone</span>
            </v-btn>

            <!-- Hide done toggle -->
            <v-switch
                v-model="hideDone"
                v-bind:label="$vuetify.breakpoint.mdAndUp ? 'Hide done' : null"
                hide-details
            ></v-switch>

            <!-- Reload button -->
            <v-btn
                text
                title="Reload"
                v-bind:class="{ 'pa-0': !$vuetify.breakpoint.mdAndUp }"
                v-on:click="loadIfNotEditing"
            >
                <v-icon>mdi-reload</v-icon>
                <span v-if="$vuetify.breakpoint.mdAndUp">Reload</span>
            </v-btn>

            <!-- Search text box -->
            <v-text-field
                dense
                label="Search"
                clearable
                v-model="searchQuery"
                hide-details
            ></v-text-field>

            <!-- Progress bar for loading data -->
            <v-progress-linear
                absolute
                bottom
                indeterminate
                color="primary"
                v-bind:active="isLoading"
            ></v-progress-linear>
        </v-toolbar>
        <v-dialog
            max-width="600px"
            persistent
            v-if="editTarget"
            v-model="editTaskDialog"
            v-bind:activator="editTaskDialogActivator"
        >
            <v-card>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn
                        text
                        v-on:click="openNewTaskDialogWithSelection"
                    >
                        <v-icon>mdi-plus-box-outline</v-icon>
                        <span v-if="$vuetify.breakpoint.smAndUp">Add similar...</span>
                    </v-btn>
                    <v-btn
                        text
                        color="error"
                        v-on:click="removeSelected"
                    >
                        <v-icon>mdi-delete</v-icon>
                        <span v-if="$vuetify.breakpoint.smAndUp">Delete</span>
                    </v-btn>
                    <v-btn
                        text
                        color="primary"
                        v-on:click="updateSelected"
                        v-bind:disabled="editTarget.name.length === 0"
                    >
                        <v-icon>mdi-content-save</v-icon>
                        <span v-if="$vuetify.breakpoint.smAndUp">Save</span>
                    </v-btn>
                    <v-btn
                        icon
                        v-on:click="closeEditTaskDialog"
                    ><v-icon>mdi-close</v-icon></v-btn>
                </v-card-actions>
                <v-card-text>
                    <TaskEditor v-model="editTarget" v-bind:knownTags="knownTags"></TaskEditor>
                </v-card-text>
            </v-card>
        </v-dialog>
        <div class="groups-container flex-grow-1">
            <div class="groups">
                <v-card class="group">
                    <v-card-title>Scheduled</v-card-title>
                    <div class="task-list">
                        <div
                            v-for="[date, dayTasks] of scheduledTasks"
                            v-bind:key="date"
                            v-bind:class="{ today: isToday(date) }"
                        >
                            <div class="date-header">
                                <span>{{ isToday(date) ? `Today (${date})` : date }}</span>
                                <v-btn
                                    text
                                    x-small
                                    v-on:click="sortDailyTasks(date)"
                                >Sort</v-btn>
                                <v-btn
                                    text
                                    x-small
                                    v-on:click="moveUndoneToToday(date)"
                                >Move to today</v-btn>
                            </div>
                            <draggable
                                group="tasks"
                                v-bind:value="dayTasks"
                                v-on:input="onDraggableInput(date, $event)"
                                v-bind:delay="500"
                                v-bind:delay-on-touch-only="true"
                                v-on:end="save"
                            >
                                <TaskListItem
                                    v-for="(task, index) of dayTasks"
                                    v-bind:key="task.id"
                                    v-bind:value="task"
                                    v-on:click="showEditTaskDialog(date, index, task, $event);"
                                    v-on:done-toggle="$set(task, 'done', $event); save();"
                                ></TaskListItem>
                            </draggable>
                        </div>
                    </div>
                </v-card>
                <v-card dense class="group">
                    <v-card-title>With Deadline</v-card-title>
                    <div class="task-list">
                        <TaskListItem
                            v-for="[date, index, task] of tasksWithDeadline"
                            v-bind:key="task.id"
                            v-bind:value="task"
                            v-on:click="showEditTaskDialog(date, index, task, $event);"
                            v-on:done-toggle="$set(task, 'done', $event); save();"
                        ></TaskListItem>
                    </div>
                </v-card>
                <v-card dense class="group">
                    <v-card-title>Backlog</v-card-title>
                    <draggable
                        class="task-list"
                        group="tasks"
                        v-model="filteredTasks.backlog"
                        v-bind:delay="500"
                        v-bind:delay-on-touch-only="true"
                        v-on:end="save"
                    >
                        <TaskListItem
                            v-for="(task, index) of filteredTasks.backlog"
                            v-bind:key="task.id"
                            v-bind:value="task"
                            v-on:click="showEditTaskDialog(null, index, task, $event);"
                            v-on:done-toggle="$set(task, 'done', $event); save();"
                        ></TaskListItem>
                    </draggable>
                </v-card>

                <div class="separator"><!-- Horizontal margin --></div>

                <draggable class="custom-groups" v-model="groups" group="groups" v-bind:delay="500" v-bind:delay-on-touch-only="true" handle=".handle" v-on:end="save">
                    <v-card v-for="group of groups" v-bind:key="group.name" class="group">
                        <v-card-title class="handle">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ group.name }}</span>
                        </v-card-title>
                        <div class="task-list">
                            <div v-for="date of Object.keys(groupedTasks[group.name].scheduled).sort((a, b) => a < b ? 1 : a > b ? -1 : 0)" v-bind:key="date">
                                <div class="date-header">{{ date }}</div>
                                <template v-for="[index, task] of groupedTasks[group.name].scheduled[date]">
                                    <TaskListItem
                                        v-bind:key="task.id"
                                        v-bind:value="task"
                                        v-on:click="showEditTaskDialog(date, index, task, $event);"
                                        v-on:done-toggle="$set(task, 'done', $event); save();"
                                    ></TaskListItem>
                                </template>
                            </div>
                            <div v-if="groupedTasks[group.name].backlog.length !== 0">
                                <div class="date-header">Backlog</div>
                                <template v-for="[index, task] of groupedTasks[group.name].backlog">
                                    <TaskListItem
                                        v-bind:key="task.id"
                                        v-bind:value="task"
                                        v-on:click="showEditTaskDialog(null, index, task, $event);"
                                        v-on:done-toggle="$set(task, 'done', $event); save();"
                                    ></TaskListItem>
                                </template>
                            </div>
                        </div>
                    </v-card>
                </draggable>
            </div>
        </div>
        <v-snackbar v-model="errorNotification" color="error" top timeout="5000">{{ errorNotificationText }}</v-snackbar>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, set, del } from 'vue';
import type { Ref } from 'vue';

import TaskEditor from '@/components/TaskEditor.vue';
import TaskListItem from '@/components/TaskListItem.vue';

import * as api from '@/api';
import axios from 'axios';
import type { Task } from '@/api';
import draggable from 'vuedraggable';
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import YAML from 'yaml';

dayjs.extend(isSameOrAfter);

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Reactive states
const tasks = ref({
    backlog: [] as Task[],
    scheduled: {} as { [key: string]: Task[] }
});
const groups: Ref<{ name: string, filter: string }[]> = ref([]);
const searchQuery = ref("");
// Task
const newTask: Ref<Task> = ref({
    id: crypto.randomUUID(),
    name: '',
    deadline: null,
    schedule: null,
    done: false,
    tags: [],
    note: '',
});
const newTaskDialog = ref(false);
const selectedTaskIndex: Ref<null | number> = ref(null);
const selectedTask: Ref<null | Task> = ref(null);
const editTarget: Ref<null | Task> = ref(null);
const editTaskDialog = ref(false);
const editTaskDialogActivator: Ref<any> = ref(null);
// Group
const newGroupDialog = ref(false);
const newGroupName = ref('');
const newGroupFilter = ref('');
// Others
const isLoading = ref(false);
const hideDone = ref(true);
const errorNotification = ref(false);
const errorNotificationText = ref('');

// Computed properties
const knownTags = computed((): [string, number][] => {
    // Collect tags
    const tagCounts = new Map();
    for (const task of tasks.value.backlog as Task[]) {
        for (const tag of task.tags || []) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
    }
    for (const [_date, dayTasks] of Object.entries(tasks.value.scheduled)) {
        for (const task of dayTasks as Task[]) {
            for (const tag of task.tags || []) {
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
        }
    }
    return [...tagCounts]
        .sort(([_tag1, count1], [_tag2, count2]) => count2 - count1);
});

const filteredTasks = computed(() => {
    const re = new RegExp(searchQuery.value, "i");
    const processedTasks = {};
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
        // Keep today or dates that have some undone tasks
        const today = dayjs().format('YYYY-MM-DD');
        dates = dates.filter(date => {
            return date === today || filteredTasks.value.scheduled[date].some(task => !task.done);
        });
    }
    return dates.map((date) => [date, filteredTasks.value.scheduled[date]]);
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

// Lifecycle hooks
onMounted(() => {
    document.title = `Tasks | ${import.meta.env.VITE_APP_NAME}`;
    load();
});

// Methods
function onDraggableInput(date: string, newTasks: Task[]) {
    set(tasks.value.scheduled, date, newTasks);
}

function isToday(date: string) {
    return date === dayjs().format('YYYY-MM-DD');
}

function select(date: string | null, index: number | null, task: Task | null) {
    selectedTaskIndex.value = index;
    if (task !== null) {
        task.schedule = date;
    }
    selectedTask.value = task;
    if (task !== null) {
        editTarget.value = structuredClone(task);
        editTarget.value.name     ??= '';
        editTarget.value.deadline ??= null;
        editTarget.value.schedule ??= null;
        editTarget.value.done     ??= false;
        editTarget.value.tags     ??= [];
        editTarget.value.note     ??= '';
    }
    else {
        editTarget.value = null;
    }
}

function showEditTaskDialog(date: string | null, index: number, task: Task, event: MouseEvent) {
    const open = () => {
        select(date, index, task);
        editTaskDialogActivator.value = (event.target as Element).parentElement!;
        setTimeout(() => {
            editTaskDialog.value = true;
        }, 0);
    };

    if (editTaskDialog.value) {
        editTaskDialog.value = false;
        setTimeout(open, 0);
    }
    else {
        open();
    }
}

function closeNewTaskDialog() {
    // Close the dialog
    newTaskDialog.value = false;
    // Reset
    newTask.value = {
        id: crypto.randomUUID(),
        name: '',
        deadline: null,
        schedule: null,
        done: false,
        tags: [],
        note: '',
    };
}

function closeNewGroupDialog() {
    // Close the dialog
    newGroupDialog.value = false;
    // Reset
    newGroupName.value = '';
    newGroupFilter.value = '';
}

function closeEditTaskDialog() {
    // Close the dialog
    editTaskDialog.value = false;
    // Reset
    select(null, null, null);
}

function openNewTaskDialogWithSelection() {
    newTask.value = structuredClone(editTarget.value);
    newTask.id = crypto.randomUUID();
    newTask.value.name += ' (copy)';
    newTaskDialog.value = true;
    closeEditTaskDialog();
}

async function sortDailyTasks(date: string) {
    // Sort tasks by completion and then deadline
    tasks.value.scheduled[date] = tasks.value.scheduled[date].slice().sort((task1, task2) => {
        if (task1.done && !task2.done) {
            return +1;
        }
        else if (!task1.done && task2.done) {
            return -1;
        }
        else {
            if (!task1.deadline && task2.deadline) {
                return +1;
            }
            else if (task1.deadline && !task2.deadline) {
                return -1;
            }
            else {
                const deadline1 = dayjs(task1.deadline);
                const deadline2 = dayjs(task2.deadline);
                if (deadline1.isAfter(deadline2)) {
                    return +1;
                }
                else if (deadline2.isAfter(deadline1)) {
                    return -1;
                }
                else {
                    return 0;
                }
            }
        }
    });
    // Save
    await save();
}

async function moveUndoneToToday(date: string) {
    const dayTasks = tasks.value.scheduled[date];
    // Collect undone tasks
    const undone = [];
    let i = 0;
    while (i < dayTasks.length) {
        const task = dayTasks[i];
        if (task.done) {
            i += 1;
        }
        else {
            dayTasks.splice(i, 1);
            undone.push(task);
        }
    }
    // Schedule them today
    const today = dayjs().startOf('day');
    const todayDate = today.format('YYYY-MM-DD');
    if (!Object.hasOwn(tasks.value.scheduled, todayDate)) {
        tasks.value.scheduled[todayDate] = [];
    }
    tasks.value.scheduled[todayDate].unshift(...undone);
    // Save
    await save();
}

async function collectUndone() {
    const today = dayjs().startOf('day');
    // Collect undone tasks
    const undone = [];
    const dates = Object.keys(tasks.value.scheduled).sort();
    for (const date of dates) {
        if (dayjs(date).isSameOrAfter(today)) {
            break;
        }
        const dayTasks: Task[] = tasks.value.scheduled[date];
        for (let i = 0; i < dayTasks.length;) {
            const task = dayTasks[i];
            if (task.done) {
                ++i;
            }
            else {
                undone.push(task)
                dayTasks.splice(i, 1);
            }
        }
    }
    // Schedule them today
    const todayDate = today.format('YYYY-MM-DD');
    if (!Object.hasOwn(tasks.value.scheduled, todayDate)) {
        tasks.value.scheduled[todayDate] = [];
    }
    tasks.value.scheduled[todayDate].unshift(...undone);
    // Save
    await save();
}

async function loadIfNotEditing() {
    if (editTarget.value === null) {
        await load();
    }
}

async function load() {
    isLoading.value = true;
    try {
        const data = await api.getTaskData();

        const today = dayjs().format('YYYY-MM-DD');
        data.tasks.scheduled[today] = data.tasks.scheduled[today] ?? [];

        // Replace with the data
        tasks.value.backlog.splice(0, tasks.value.backlog.length, ...data.tasks.backlog);
        Object.keys(tasks.value.scheduled).forEach(key => del(tasks.value.scheduled, key));
        Object.entries(data.tasks.scheduled).forEach(([key, value]) => {
            set(tasks.value.scheduled, key, value);
        });
        groups.value.splice(0, groups.value.length, ...data.groups);

        isLoading.value = false;
    }
    catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                if (error.response.status === 401) {
                    // Unauthorized
                    emit('tokenExpired', () => load());
                }
                else if (error.response.status === 404) {
                    // Create a new one
                    await api.addNote('.mory/tasks.yaml', YAML.stringify({
                        tasks: {
                            backlog: [],
                            scheduled: {},
                        },
                        groups: [],
                    }));
                    load();
                }
                else {
                    errorNotification.value = true;
                    errorNotificationText.value = error.toString();
                    isLoading.value = false;
                    throw error;
                }
            }
            else {
                errorNotification.value = true;
                errorNotificationText.value = error.toString();
                isLoading.value = false;
                throw error;
            }
        }
    }
}

async function save() {
    return await api.putTaskData({ tasks: tasks.value, groups: groups.value });
}

async function add(closeDialog = true) {
    // Insert a new task
    const task: Task = structuredClone(newTask.value);
    if (task.schedule !== null) {
        tasks.value.scheduled[task.schedule] ??= [];
        tasks.value.scheduled[task.schedule].unshift(task);
    }
    else {
        tasks.value.backlog.unshift(task);
    }

    // Save
    await save();

    // Close the dialog or keep it open to continue creating another similar tasks
    if (closeDialog) {
        closeNewTaskDialog();
    }
    else {
        // Inherit values from the previous task except for id, name, and tags
        newTask.value = structuredClone(newTask.value);
        newTask.value.id = crypto.randomUUID();
        newTask.value.name = '';
        newTask.value.tags = [...newTask.value.tags];
    }
}

async function updateSelected() {
    if (selectedTask.value === null) {
        throw new Error('selectedTask is null');
    }
    if (editTarget.value === null) {
        throw new Error('editTarget is null');
    }
    // Copy back
    selectedTask.value.name = editTarget.value.name;
    selectedTask.value.deadline = editTarget.value.deadline;
    selectedTask.value.done = editTarget.value.done;
    selectedTask.value.tags = editTarget.value.tags;
    selectedTask.value.note = editTarget.value.note;
    // Move to other list
    const oldDate = selectedTask.value.schedule;
    const newDate = editTarget.value.schedule;
    if (newDate !== oldDate) {
        // Remove it from the original list
        const list = oldDate === null ? tasks.value.backlog : tasks.value.scheduled[oldDate];
        list.splice(selectedTaskIndex.value!, 1);
        // Put into a new list
        if (newDate === null) {
            tasks.value.backlog.unshift(selectedTask.value);
        }
        else {
            if (!Object.hasOwn(tasks.value.scheduled, newDate)) {
                tasks.value.scheduled[newDate] = [];
            }
            tasks.value.scheduled[newDate].unshift(selectedTask.value);
        }
    }
    // Save
    await save();
    // Close
    closeEditTaskDialog();
}

async function removeSelected() {
    if (selectedTask.value === null) {
        throw new Error('selectedTask is null');
    }
    const list = selectedTask.value.schedule === null ? tasks.value.backlog : tasks.value.scheduled[selectedTask.value.schedule];
    list.splice(selectedTaskIndex.value!, 1);
    // Save
    await save();
    // Close
    closeEditTaskDialog();
}

async function addGroup() {
    // Create a new group
    const group: any = {
        name: newGroupName.value,
        filter: newGroupFilter.value,
    };
    groups.value.unshift(group);
    // Save
    await save();
    // Hide the dialog
    newGroupDialog.value = false;
    // Reset
    newGroupName.value = '';
    newGroupFilter.value = '';
}

// Expose properties
defineExpose({
    onDraggableInput,
    isToday,
    select,
    showEditTaskDialog,
    closeNewTaskDialog,
    closeNewGroupDialog,
    closeEditTaskDialog,
    openNewTaskDialogWithSelection,
    sortDailyTasks,
    moveUndoneToToday,
    collectUndone,
    loadIfNotEditing,
    load,
    save,
    add,
    updateSelected,
    removeSelected,
    addGroup,
});
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
