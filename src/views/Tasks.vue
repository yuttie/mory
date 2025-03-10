<template>
    <div id="tasks" class="d-flex flex-column">
        <v-toolbar flat outlined dense class="flex-grow-0">
            <v-dialog
                max-width="600px"
                persistent
                v-model="newTaskDialog"
            >
                <template v-slot:activator="{ on, attrs }">
                    <v-btn
                        text
                        v-bind="attrs"
                        v-on="on"
                        class="mr-2"
                    >
                        <v-icon class="mr-1">mdi-plus-box-outline</v-icon>
                        Task
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
                        >Add (continuously)</v-btn>
                        <v-btn
                            text
                            color="primary"
                            v-on:click="add"
                            v-bind:disabled="newTask.name.length === 0"
                        >Add</v-btn>
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
            <v-dialog
                max-width="600px"
                persistent
                v-model="newGroupDialog"
            >
                <template v-slot:activator="{ on, attrs }">
                    <v-btn
                        text
                        v-bind="attrs"
                        v-on="on"
                    >
                        <v-icon class="mr-1">mdi-plus-box-outline</v-icon>
                        Group
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
                        >Add</v-btn>
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
            <v-btn
                text
                v-on:click="collectUndone"
            >
                <v-icon class="mr-1">mdi-checkbox-multiple-blank-outline</v-icon>
                Collect Undone
            </v-btn>
            <v-switch
                v-model="hideDone"
                v-bind:label="'Hide done'"
                hide-details
            ></v-switch>
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
                    >Add similar...</v-btn>
                    <v-btn
                        text
                        color="error"
                        v-on:click="removeSelected"
                    >Delete</v-btn>
                    <v-btn
                        text
                        color="primary"
                        v-on:click="updateSelected"
                        v-bind:disabled="editTarget.name.length === 0"
                    >Save</v-btn>
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
                <v-card dense class="group">
                    <v-card-title>Backlog</v-card-title>
                    <draggable
                        class="task-list"
                        group="tasks"
                        v-model="tasks.backlog"
                        v-bind:delay="500"
                        v-bind:delay-on-touch-only="true"
                        v-on:end="clean(); save();"
                    >
                        <TaskListItem
                            v-for="(task, index) of tasks.backlog"
                            v-bind:key="`backlog/${task.name}`"
                            v-bind:value="task"
                            v-on:click="showEditTaskDialog(null, index, task, $event);"
                            v-on:done-toggle="$set(task, 'done', $event); clean(); save();"
                        ></TaskListItem>
                    </draggable>
                </v-card>
                <v-card dense class="group">
                    <v-card-title>With Deadline</v-card-title>
                    <div class="task-list">
                        <TaskListItem
                            v-for="[date, index, task] of tasksWithDeadline"
                            v-bind:key="task.name"
                            v-bind:value="task"
                            v-on:click="showEditTaskDialog(date, index, task, $event);"
                            v-on:done-toggle="$set(task, 'done', $event); clean(); save();"
                        ></TaskListItem>
                    </div>
                </v-card>
                <v-card class="group">
                    <v-card-title>Scheduled</v-card-title>
                    <div class="task-list">
                        <div
                            v-for="date of scheduledDates"
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
                            <draggable v-model="tasks.scheduled[date]" group="tasks" v-bind:delay="500" v-bind:delay-on-touch-only="true" v-on:end="clean(); save();">
                                <TaskListItem
                                    v-for="(task, index) of tasks.scheduled[date]"
                                    v-bind:key="`${date}/${task.name}`"
                                    v-bind:value="task"
                                    v-on:click="showEditTaskDialog(date, index, task, $event);"
                                    v-on:done-toggle="$set(task, 'done', $event); clean(); save();"
                                ></TaskListItem>
                            </draggable>
                        </div>
                    </div>
                </v-card>
                <draggable class="custom-groups" v-model="groups" group="groups" v-bind:delay="500" v-bind:delay-on-touch-only="true" handle=".handle" v-on:end="clean(); save();">
                    <v-card v-for="group of groups" v-bind:key="group.name" class="group">
                        <v-card-title class="handle">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ group.name }}</span>
                        </v-card-title>
                        <div class="task-list">
                            <div v-for="date of Object.keys(groupedTasks[group.name].scheduled).sort((a, b) => a < b ? 1 : a > b ? -1 : 0)" v-bind:key="date">
                                <div class="date-header">{{ date }}</div>
                                <template v-for="[index, task] of groupedTasks[group.name].scheduled[date]">
                                    <TaskListItem
                                        v-bind:key="`${date}/${task.name}`"
                                        v-bind:value="task"
                                        v-on:click="showEditTaskDialog(date, index, task, $event);"
                                        v-on:done-toggle="$set(task, 'done', $event); clean(); save();"
                                    ></TaskListItem>
                                </template>
                            </div>
                            <div v-if="groupedTasks[group.name].backlog.length !== 0">
                                <div class="date-header">Backlog</div>
                                <template v-for="[index, task] of groupedTasks[group.name].backlog">
                                    <TaskListItem
                                        v-bind:key="`backlog/${task.name}`"
                                        v-bind:value="task"
                                        v-on:click="showEditTaskDialog(null, index, task, $event);"
                                        v-on:done-toggle="$set(task, 'done', $event); clean(); save();"
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
import { ref, computed, onMounted, onUnmounted, del } from 'vue';
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
// Task
const newTask: Ref<Task> = ref({
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

const scheduledDates = computed(() => {
    let dates = Object.keys(tasks.value.scheduled);
    dates.sort((a, b) => a < b ? 1 : a > b ? -1 : 0);
    if (hideDone.value) {
        // Keep today or dates that have some undone tasks
        const today = dayjs().format('YYYY-MM-DD');
        dates = dates.filter(date => {
            return date === today || tasks.value.scheduled[date].some(task => !task.done);
        });
    }
    return dates;
});

const tasksWithDeadline = computed(() => {
    const result: [string | null, number, Task][] = [];
    // Backlog
    for (const [i, task] of tasks.value.backlog.entries()) {
        if (task.deadline) {
            result.push([null, i, task]);
        }
    }
    // Scheduled
    for (const [date, dayTasks] of Object.entries(tasks.value.scheduled)) {
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
        for (const [i, task] of tasks.value.backlog.entries()) {
            if ((task.tags || []).includes(group.filter)) {
                grouped.backlog.push([i, task]);
            }
        }
        // Scheduled
        for (const [date, dayTasks] of Object.entries(tasks.value.scheduled)) {
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
    window.addEventListener('focus', loadIfNotEditing);
});

onUnmounted(() => {
    window.removeEventListener('focus', loadIfNotEditing);
});

// Methods
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
        editTarget.value = JSON.parse(JSON.stringify(task));
        editTarget.value!.name     ||= '';
        editTarget.value!.deadline ||= null;
        editTarget.value!.schedule ||= null;
        editTarget.value!.done     ||= false;
        editTarget.value!.tags     ||= [];
        editTarget.value!.note     ||= '';
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
    newTask.value = JSON.parse(JSON.stringify(editTarget.value));
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
    clean();
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
    clean();
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
    clean();
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
        const res = await api.getNote('.mory/tasks.yaml');
        const data = YAML.parse(res.data);
        tasks.value = data.tasks;
        groups.value = data.groups;
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

function save() {
    const datePattern = /\d{4}-\d{2}-\d{2}/;
    const taskPropertyOrder: { [key: string]: number } = {
        name: 0,
        deadline: 1,
        schedule: 2,
        done: 3,
        tags: 4,
        note: 5,
    };
    const groupPropertyOrder: { [key: string]: number } = {
        name: 0,
        filter: 1,
    };
    const yaml = YAML.stringify({
        tasks: tasks.value,
        groups: groups.value,
    }, {
        sortMapEntries: (a, b) => {
            if (datePattern.test(a.key.value) && datePattern.test(b.key.value)) {
                if (a.key.value < b.key.value) {
                    return 1;
                }
                else if (a.key.value > b.key.value) {
                    return -1;
                }
                else {
                    return 0;
                }
            }
            else if (a.key.value in taskPropertyOrder && b.key.value in taskPropertyOrder) {
                if (taskPropertyOrder[a.key.value] < taskPropertyOrder[b.key.value]) {
                    return -1;
                }
                else if (taskPropertyOrder[a.key.value] > taskPropertyOrder[b.key.value]) {
                    return 1;
                }
                else {
                    return 0;
                }
            }
            else if (a.key.value in groupPropertyOrder && b.key.value in groupPropertyOrder) {
                if (groupPropertyOrder[a.key.value] < groupPropertyOrder[b.key.value]) {
                    return -1;
                }
                else if (groupPropertyOrder[a.key.value] > groupPropertyOrder[b.key.value]) {
                    return 1;
                }
                else {
                    return 0;
                }
            }
            else {
                if (a.key.value < b.key.value) {
                    return -1;
                }
                else if (a.key.value > b.key.value) {
                    return 1;
                }
                else {
                    return 0;
                }
            }
        },
    });
    return api.addNote('.mory/tasks.yaml', yaml);
}

function clean() {
    for (const task of tasks.value.backlog) {
        for (const [prop, value] of Object.entries(task)) {
            if (value === null) {
                del(task, prop);
            }
        }
    }
    for (const [date, dailyTasks] of Object.entries(tasks.value.scheduled)) {
        if ((dailyTasks as Task[]).length === 0) {
            del(tasks.value.scheduled, date);
        }
        for (const task of dailyTasks) {
            for (const [prop, value] of Object.entries(task)) {
                if (value === null) {
                    del(task, prop);
                }
            }
        }
    }
}

async function add(closeDialog = true) {
    // Create a new entry
    const task: any = {
        name: newTask.value.name,
    };
    if (newTask.value.deadline) { task.deadline = newTask.value.deadline; }
    if (newTask.value.done) { task.done = newTask.value.done; }
    if (newTask.value.tags.length > 0) { task.tags = newTask.value.tags; }
    if (newTask.value.note.length > 0) { task.note = newTask.value.note; }
    if (newTask.value.schedule !== null) {
        if (!Object.hasOwn(tasks.value.scheduled, newTask.value.schedule)) {
            tasks.value.scheduled[newTask.value.schedule] = [];
        }
        tasks.value.scheduled[newTask.value.schedule].unshift(task);
    }
    else {
        tasks.value.backlog.unshift(task);
    }
    // Save
    await save();
    if (closeDialog) {
        closeNewTaskDialog();
    }
    else {
        // Reset partially
        newTask.value = {
            ...newTask.value,
            name: '',
            tags: [...newTask.value.tags],
        };
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
    clean();
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
    clean();
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
    clean,
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
</style>
