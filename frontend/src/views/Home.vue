<template>
    <div id="home">
        <!-- Quick Note/Task Creation Section -->
        <div class="quick-create-section ma-3">
            <h2 class="mb-3 text-center">Quick Create</h2>
            <div class="quick-create-grid">
                <v-card variant="outlined">
                    <v-card-title class="pb-2">
                        <v-icon start>{{ mdiNotePlusOutline }}</v-icon>
                        Note
                    </v-card-title>
                    <v-card-text>
                        <v-textarea
                            ref="noteTextarea"
                            v-model="quickNoteContent"
                            placeholder="Enter note content..."
                            rows="5"
                            variant="outlined"
                            density="compact"
                            hide-details="auto"
                            v-on:keydown="handleNoteKeydown"
                        ></v-textarea>
                        <div class="d-flex mt-3">
                            <v-spacer />
                            <v-btn
                                color="primary"
                                v-bind:disabled="!quickNoteContent.trim()"
                                v-on:click="createQuickNote"
                            >
                                <v-icon start>{{ mdiFileDocumentPlusOutline }}</v-icon>
                                Create Note
                            </v-btn>
                        </div>
                    </v-card-text>
                </v-card>
                <v-card variant="outlined">
                    <v-card-title class="pb-2">
                        <v-icon start>{{ mdiCheckboxMarkedCirclePlusOutline }}</v-icon>
                        Task
                    </v-card-title>
                    <v-card-text>
                        <v-text-field
                            ref="taskNameField"
                            v-model="quickTaskName"
                            placeholder="Enter task name..."
                            variant="outlined"
                            hide-details="auto"
                            density="compact"
                            class="mb-2"
                            v-on:keydown="handleTaskKeydown"
                        ></v-text-field>
                        <v-radio-group
                            v-model="quickTaskScheduledDay"
                            hide-details="auto"
                            class="mb-2"
                            inline
                            density="compact"
                        >
                            <template v-slot:label>
                                <div>Schedule</div>
                            </template>
                            <v-radio
                                v-for="option in scheduledDayOptions"
                                v-bind:key="option.value"
                                v-bind:label="option.text"
                                v-bind:value="option.value"
                            ></v-radio>
                        </v-radio-group>
                        <DateSelector
                            v-model="quickTaskDueBy"
                            label="Due by (optional)"
                            clearable
                            class="mt-3"
                        />
                        <DateSelector
                            v-model="quickTaskDeadline"
                            label="Deadline (optional)"
                            clearable
                        />
                        <div class="d-flex mt-3">
                            <v-spacer />
                            <v-btn
                                color="primary"
                                v-bind:disabled="!quickTaskName.trim()"
                                v-on:click="createQuickTask"
                            >
                                <v-icon start>{{ mdiCheckboxMarkedCirclePlusOutline }}</v-icon>
                                Create Task
                            </v-btn>
                        </div>
                    </v-card-text>
                </v-card>
            </div>
        </div>

        <!-- Events Section -->
        <div class="events-section ma-3">
            <h2 class="mb-3 text-center">Events</h2>
            <div class="events-grid">
                <v-card variant="outlined" class="event-column">
                    <v-card-title class="pb-2">
                        <v-icon start>{{ mdiCalendarToday }}</v-icon>
                        Today
                    </v-card-title>
                    <v-card-text>
                        <div v-if="todayEvents.length === 0" class="text-center text-medium-emphasis">
                            No events today
                        </div>
                        <div v-else>
                            <div
                                v-for="event in todayEvents"
                                v-bind:key="event.name + event.start"
                                class="event-item mb-2 pa-2 clickable-event"
                                v-bind:style="{ 'border-left': `8px solid ${getEventColor(event)}` }"
                                v-on:click="navigateToEvent(event)"
                            >
                                <div class="event-name font-weight-medium">{{ event.name }}</div>
                                <div class="event-time text-medium-emphasis text-caption">{{ formatEventTime(event) }}</div>
                                <div v-if="event.note" class="event-note text-caption mt-1">{{ event.note }}</div>
                            </div>
                        </div>
                    </v-card-text>
                </v-card>

                <v-card variant="outlined" class="event-column">
                    <v-card-title class="pb-2">
                        <v-icon start>{{ mdiCalendar }}</v-icon>
                        Tomorrow
                    </v-card-title>
                    <v-card-text>
                        <div v-if="tomorrowEvents.length === 0" class="text-center text-medium-emphasis">
                            No events tomorrow
                        </div>
                        <div v-else>
                            <div
                                v-for="event in tomorrowEvents"
                                v-bind:key="event.name + event.start"
                                class="event-item mb-2 pa-2 clickable-event"
                                v-bind:style="{ 'border-left': `8px solid ${getEventColor(event)}` }"
                                v-on:click="navigateToEvent(event)"
                            >
                                <div class="event-name font-weight-medium">{{ event.name }}</div>
                                <div class="event-time text-medium-emphasis text-caption">{{ formatEventTime(event) }}</div>
                                <div v-if="event.note" class="event-note text-caption mt-1">{{ event.note }}</div>
                            </div>
                        </div>
                    </v-card-text>
                </v-card>

                <v-card variant="outlined" class="event-column">
                    <v-card-title class="pb-2">
                        <v-icon start>{{ mdiCalendarPlus }}</v-icon>
                        Day After Tomorrow
                    </v-card-title>
                    <v-card-text>
                        <div v-if="dayAfterTomorrowEvents.length === 0" class="text-center text-medium-emphasis">
                            No events
                        </div>
                        <div v-else>
                            <div
                                v-for="event in dayAfterTomorrowEvents"
                                v-bind:key="event.name + event.start"
                                class="event-item mb-2 pa-2 clickable-event"
                                v-bind:style="{ 'border-left': `8px solid ${getEventColor(event)}` }"
                                v-on:click="navigateToEvent(event)"
                            >
                                <div class="event-name font-weight-medium">{{ event.name }}</div>
                                <div class="event-time text-medium-emphasis text-caption">{{ formatEventTime(event) }}</div>
                                <div v-if="event.note" class="event-note text-caption mt-1">{{ event.note }}</div>
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </div>
        </div>

        <!-- Tasks Section -->
        <div class="tasks-section ma-3">
            <h2 class="mb-3 text-center">Tasks</h2>
            <div class="tasks-grid">
                <v-card variant="outlined" class="task-column">
                    <v-card-title class="pb-2">
                        <v-icon start>{{ mdiCheckboxMarkedCircleOutline }}</v-icon>
                        Scheduled Today
                    </v-card-title>
                    <v-card-text>
                        <div v-if="todayTasks.length === 0" class="text-center text-medium-emphasis">
                            No tasks scheduled for today
                        </div>
                        <div v-else>
                            <div
                                v-for="task in todayTasks"
                                v-bind:key="task.uuid"
                                class="task-item mb-2 pa-2 clickable-task"
                                v-bind:class="{ 'task-done': task.metadata?.task?.status?.kind === 'done' }"
                                v-on:click="navigateToTask(task)"
                            >
                                <div class="task-content">
                                    <div class="task-name" v-bind:class="{ 'text-decoration-line-through': task.metadata?.task?.status?.kind === 'done' }">
                                        {{ task.title }}
                                    </div>
                                    <div v-if="task.metadata?.task?.due_by" class="task-due-by text-medium-emphasis text-caption">
                                        Due by: {{ task.metadata?.task?.due_by }}
                                    </div>
                                    <div v-if="task.metadata?.task?.deadline" class="task-deadline text-medium-emphasis text-caption">
                                        Deadline: {{ task.metadata?.task?.deadline }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </v-card-text>
                </v-card>

                <v-card variant="outlined" class="task-column">
                    <v-card-title class="pb-2">
                        <v-icon start>{{ mdiClockOutline }}</v-icon>
                        Upcoming Due Dates
                    </v-card-title>
                    <v-card-text>
                        <div v-if="upcomingTasks.length === 0" class="text-center text-medium-emphasis">
                            No upcoming deadlines
                        </div>
                        <div v-else>
                            <div
                                v-for="task in upcomingTasks"
                                v-bind:key="task.uuid"
                                class="task-item mb-2 pa-2 clickable-task"
                                v-bind:class="{ 'task-done': task.metadata?.task?.status?.kind === 'done' }"
                                v-on:click="navigateToTask(task)"
                            >
                                <div class="task-content">
                                    <div class="task-name" v-bind:class="{ 'text-decoration-line-through': task.metadata?.task?.status?.kind === 'done' }">
                                        {{ task.title }}
                                    </div>
                                    <div v-if="task.metadata?.task?.due_by" class="task-due-by text-caption" v-bind:class="getDeadlineClass(task.metadata?.task?.due_by)">
                                        Due by: {{ task.metadata?.task?.due_by }}
                                    </div>
                                    <div v-if="task.metadata?.task?.deadline" class="task-deadline text-caption" v-bind:class="getDeadlineClass(task.metadata?.task?.deadline)">
                                        Deadline: {{ task.metadata?.task?.deadline }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </div>
        </div>

        <!-- Categorized Notes Section (existing) -->
        <div class="notes-section ma-3">
            <h2 class="mb-3 text-center">Notes by Category</h2>
            <div class="notes-grid">
                <v-card
                    v-for="category of sortedCategorizedEntries.entries()"
                    v-bind:key="category[0]"
                    variant="outlined"
                >
                    <v-card-title>{{ category[0] }}</v-card-title>
                    <v-card-text>
                        <div class="text-center mb-3">
                            <v-btn
                                variant="text"
                                size="x-small"
                                v-on:click="changeSortOrder(category[0], 'title')"
                            ><v-icon size="x-small" v-if="sortOrders.get(category[0])[0] === 'title'">{{ sortOrders.get(category[0])[1] ? mdiSortDescending : mdiSortAscending }}</v-icon>sort by title</v-btn>
                            <v-btn
                                variant="text"
                                size="x-small"
                                v-on:click="changeSortOrder(category[0], 'time')"
                            ><v-icon size="x-small" v-if="sortOrders.get(category[0])[0] === 'time'">{{ sortOrders.get(category[0])[1] ? mdiSortDescending : mdiSortAscending }}</v-icon>sort by time</v-btn>
                        </div>
                        <ul>
                            <li
                                v-for="entry of category[1]"
                                v-bind:key="entry.path"
                            >
                                <router-link v-bind:to="{ name: 'Note', params: { path: entry.path } }">{{ entry.title || entry.path }}</router-link>
                                <span class="age ml-1">({{ formatDistanceToNow(parseISO(entry.time)) }})</span>
                            </li>
                        </ul>
                    </v-card-text>
                </v-card>
            </div>
        </div>

        <v-overlay v-bind:model-value="isLoading" z-index="10" scrim="transparent" class="align-center justify-center">
            <v-progress-circular indeterminate color="blue-grey-lighten-3" size="64"></v-progress-circular>
        </v-overlay>
        <v-snackbar v-model="error" color="error" location="top" timeout="5000">{{ errorText }}</v-snackbar>
        <v-snackbar v-model="successMessage" color="success" location="top" timeout="5000">
            {{ successText }}
            <template v-slot:actions>
                <v-btn
                    v-if="createdItemPath"
                    variant="text"
                    v-on:click="openCreatedItem"
                >
                    Open
                </v-btn>
            </template>
        </v-snackbar>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted } from 'vue';
import type { Ref } from 'vue';
import { useRouter } from 'vue-router';

import {
    mdiSortAscending,
    mdiSortDescending,
    mdiFileDocumentPlusOutline,
    mdiCheckboxMarkedCirclePlusOutline,
    mdiCalendarToday,
    mdiCalendar,
    mdiCalendarPlus,
    mdiCheckboxMarkedCircleOutline,
    mdiClockOutline,
    mdiNotePlusOutline,
} from '@mdi/js';

import type { ListEntry2 } from '@/api';

import { eventsFromEntries } from '@/events';
import { useFilesStore } from '@/stores/files';
import { by } from '@/utils';
import dayjs from 'dayjs';
import { useTasksStore } from '@/stores/tasks';
import { type TaskNode } from '@/task-forest';
import type { Task } from '@/task';

import Color from 'color';
import { formatDistanceToNow, parseISO } from 'date-fns';
import materialColors from 'vuetify/util/colors';

function getEventEndTime(event: any): dayjs.Dayjs {
    if (typeof event.end !== 'undefined') {
        return dayjs(event.end);
    }
    else {
        return dayjs(event.start).endOf('day');
    }
}

function getEventColor(event: any): string {
    const toPropName = (s: string) => s.replace(/-./g, (match: string) => match[1].toUpperCase());
    const color = Object.hasOwn(materialColors, toPropName(event.color))
        ? Color((materialColors as any)[toPropName(event.color)].base)
        : Color(event.color);

    const now = dayjs();
    const time = getEventEndTime(event);
    if (time < now || event.finished) {
        return color.fade(0.75).string();
    }
    else {
        return color.string();
    }
}

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Stores
const taskStore = useTasksStore();
const router = useRouter();
const files = useFilesStore();

// Reactive states
const isLoading = ref(false);
const error = ref(false);
const errorText = ref('');
const sortOrders: Ref<Map<string, [string, boolean]>> = ref(new Map());

// Quick create states
const quickNoteContent = ref('');
const quickTaskName = ref('');
const quickTaskScheduledDay = ref('none');
const quickTaskDueBy = ref('');
const quickTaskDeadline = ref('');

// Refs for focusing
const noteTextarea = ref(null);
const taskNameField = ref(null);

// Scheduled day options
const scheduledDayOptions = [
    { text: 'None', value: 'none' },
    { text: 'Today', value: 'today' },
    { text: 'Tomorrow', value: 'tomorrow' }
];

// Success/error messaging
const successMessage = ref(false);
const successText = ref('');
const createdItemPath = ref('');
const createdItemType = ref<'note' | 'task' | ''>('');

// Computed properties
const sortedCategorizedEntries = computed(() => {
    // Copy the unsorted map
    const categorized: Map<string, ListEntry2[]> = new Map(
        Array.from(categorizedEntries.value, ([cat, entries]) => [cat, [...entries]])
    );

    for (const [category, entries] of categorized) {
        // Default value
        if (!sortOrders.value.has(category)) {
            sortOrders.value.set(category, ['title', false]);
        }

        const [kind, descending] = sortOrders.value.get(category);
        if (kind === 'title') {
            sortByTitle(entries, descending);
        }
        else if (kind === 'time') {
            sortByTime(entries, descending);
        }
    }

    return categorized;
});

const categorizedEntries = computed(() => {
    // Categorize entries
    const categorized: Map<string, ListEntry2[]> = new Map();
    for (const entry of files.entries) {
        if (entry.metadata !== null) {
            if (Object.hasOwn(entry.metadata, 'tags') && Array.isArray(entry.metadata.tags)) {
                for (const tag of entry.metadata.tags.map(String)) {
                    const match = tag.match(/^home:(.+)$/);
                    if (match) {
                        const category = match[1];
                        if (!categorized.has(category)) {
                            categorized.set(category, []);
                        }
                        categorized.get(category)!.push(entry);
                    }
                }
            }
        }
    }

    return categorized;
});

// Events computation, shared with the calendar view.
// Only the next three days are ever rendered, below, so that is all a rule needs expanding over.
const events = computed(() => eventsFromEntries(files.entries, {
    from: dayjs().format('YYYY-MM-DD'),
    to: dayjs().add(2, 'days').format('YYYY-MM-DD'),
}).events);

const today = dayjs().format('YYYY-MM-DD');
const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
const dayAfterTomorrow = dayjs().add(2, 'days').format('YYYY-MM-DD');

const todayEvents = computed(() => {
    return events.value.filter(event => {
        const eventDate = dayjs(event.start).format('YYYY-MM-DD');
        return eventDate === today;
    }).sort((a, b) => a.start.localeCompare(b.start));
});

const tomorrowEvents = computed(() => {
    return events.value.filter(event => {
        const eventDate = dayjs(event.start).format('YYYY-MM-DD');
        return eventDate === tomorrow;
    }).sort((a, b) => a.start.localeCompare(b.start));
});

const dayAfterTomorrowEvents = computed(() => {
    return events.value.filter(event => {
        const eventDate = dayjs(event.start).format('YYYY-MM-DD');
        return eventDate === dayAfterTomorrow;
    }).sort((a, b) => a.start.localeCompare(b.start));
});

const todayTasks = computed(() => {
    if (!taskStore.allTasks || taskStore.allTasks.length === 0) return [];

    return taskStore.allTasks.filter(task => {
        const scheduledDates = task.metadata?.task?.scheduled_dates;
        const status = task.metadata?.task?.status?.kind;
        
        // Skip done and canceled tasks
        if (status === 'done' || status === 'canceled') {
            return false;
        }
        
        return Array.isArray(scheduledDates) && scheduledDates.includes(today);
    });
});

function parseDue(input: string): dayjs.Dayjs {
    const hasTime = /\d{1,2}:\d{2}/.test(input);
    if (hasTime) {
        return dayjs(input);
    } else {
        return dayjs(input).endOf('day');
    }
}

const upcomingTasks = computed(() => {
    if (!taskStore.allTasks || taskStore.allTasks.length === 0) return [];

    const tasks: TaskNode[] = [];
    const now = dayjs();

    // Collect tasks with deadlines, excluding done/canceled tasks
    for (const task of taskStore.allTasks) {
        const date = task.metadata?.task?.due_by ?? task.metadata?.task?.deadline;
        const status = task.metadata?.task?.status?.kind;
        
        // Skip done and canceled tasks
        if (status === 'done' || status === 'canceled') {
            continue;
        }
        
        if (date) {
            tasks.push(task);
        }
    }

    // Sort by deadline
    return tasks.sort((a, b) => {
        const dateA = a.metadata?.task?.due_by ?? a.metadata?.task?.deadline;
        const dateB = b.metadata?.task?.due_by ?? b.metadata?.task?.deadline;
        if (!dateA || !dateB) return 0;
        return parseDue(dateA).diff(parseDue(dateB));
    });
});

// Watchers
watch(successMessage, (newValue) => {
    // Clear created item info when success message is dismissed
    if (!newValue) {
        createdItemPath.value = '';
        createdItemType.value = '';
    }
});

// Lifecycle hooks
onMounted(() => {
    document.title = `Home | ${import.meta.env.VITE_APP_NAME}`;

    load();
    loadTasks();
});

// Methods
function handleNoteKeydown(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        if (quickNoteContent.value.trim()) {
            createQuickNote();
        }
    }
}

function handleTaskKeydown(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        if (quickTaskName.value.trim()) {
            createQuickTask();
        }
    }
}

function load() {
    isLoading.value = true;
    files.refresh()
        .then(() => {
            isLoading.value = false;
        }).catch(error => {
            if (error.response) {
                if (error.response.status === 401) {
                    // Unauthorized
                    emit('tokenExpired', () => load());
                }
                else {
                    error.value = true;
                    errorText.value = error.response;
                    isLoading.value = false;
                    throw error;
                }
            }
            else {
                error.value = true;
                errorText.value = error.toString();
                isLoading.value = false;
                throw error;
            }
        });
}

async function loadTasks() {
    try {
        await taskStore.refresh();
    } catch (_err) {
        console.error('Failed to load tasks:', _err);
    }
}

async function createQuickNote() {
    try {
        const content = quickNoteContent.value.trim();
        const filename = crypto.randomUUID() + '.md';

        // Add metadata with quick-create tag
        const metadata = {
            tags: ['quick-create']
        };
        const yamlHeader = '---\n' + Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n') + '\n---\n\n';
        const noteContent = yamlHeader + content;

        await files.write(filename, noteContent);
        successText.value = 'Note created successfully!';
        successMessage.value = true;
        createdItemPath.value = filename;
        createdItemType.value = 'note';
        quickNoteContent.value = '';

        // Focus the textarea for creating another note
        if (noteTextarea.value) {
            noteTextarea.value.focus();
        }

        // Reload notes to show the new one if it has home tags
        load();
    } catch (_err) {
        errorText.value = 'Failed to create note';
        error.value = true;
    }
}

async function createQuickTask() {
    try {
        const taskUuid = crypto.randomUUID();
        const taskPath = `.tasks/${taskUuid}.md`;

        // Determine scheduled dates based on selection
        let scheduledDates: string[] = [];
        if (quickTaskScheduledDay.value === 'today') {
            scheduledDates = [today];
        } else if (quickTaskScheduledDay.value === 'tomorrow') {
            scheduledDates = [tomorrow];
        }

        const newTask: Task = {
            uuid: taskUuid,
            title: quickTaskName.value.trim(),
            tags: ['quick-create'],
            status: { kind: 'todo' },
            progress: 0,
            importance: 3,
            urgency: 3,
            due_by: quickTaskDueBy.value || undefined,
            deadline: quickTaskDeadline.value || undefined,
            scheduled_dates: scheduledDates,
            note: '',
        };

        await taskStore.save(newTask, taskPath);

        successText.value = `Task "${newTask.title}" created successfully!`;
        successMessage.value = true;
        createdItemPath.value = taskUuid;
        createdItemType.value = 'task';
        quickTaskName.value = '';
        quickTaskDueBy.value = '';
        quickTaskDeadline.value = '';
        quickTaskScheduledDay.value = 'none';

        // Focus the task name field for creating another task
        if (taskNameField.value) {
            taskNameField.value.focus();
        }

    } catch (_err) {
        errorText.value = 'Failed to create task';
        error.value = true;
    }
}

function navigateToTask(task: TaskNode) {
    // Navigate to the TasksNext view with the selected task
    router.push({
        name: 'TasksNextWithParams',
        params: {
            selectedNodeId: task.uuid,
            tab: 'selected',
            viewMode: 'status'
        }
    }).catch(err => {
            // Ignore navigation duplicated errors
            if (err.name !== 'NavigationDuplicated') {
                console.error('Router navigation error:', err);
            }
        });
}

function navigateToEvent(event: { notePath: string }) {
    // Navigate to the Note view for the event's source note
    router.push({
        name: 'Note',
        params: {
            path: event.notePath.split('/')
        }
    }).catch(err => {
            // Ignore navigation duplicated errors
            if (err.name !== 'NavigationDuplicated') {
                console.error('Router navigation error:', err);
            }
        });
}

function openCreatedItem() {
    if (createdItemType.value === 'note') {
        // Navigate to the Note view for the created note
        router.push({
            name: 'Note',
            params: {
                path: createdItemPath.value.split('/')
            }
        }).catch(err => {
            // Ignore navigation duplicated errors
            if (err.name !== 'NavigationDuplicated') {
                console.error('Router navigation error:', err);
            }
        });
    } else if (createdItemType.value === 'task') {
        // Navigate to the TasksNext view for the created task
        router.push({
            name: 'TasksNextWithParams',
            params: {
                selectedNodeId: createdItemPath.value,
                tab: 'selected',
                viewMode: 'status'
            }
        }).catch(err => {
            // Ignore navigation duplicated errors
            if (err.name !== 'NavigationDuplicated') {
                console.error('Router navigation error:', err);
            }
        });
    }
    // Clear the success message after navigation
    successMessage.value = false;
}

function formatEventTime(event: { start: string; end?: string }) {
    const start = dayjs(event.start);
    if (event.end) {
        const end = dayjs(event.end);
        if (start.format('YYYY-MM-DD') === end.format('YYYY-MM-DD')) {
            return `${start.format('HH:mm')} - ${end.format('HH:mm')}`;
        } else {
            return `${start.format('HH:mm')} - ${end.format('MM/DD HH:mm')}`;
        }
    } else {
        return start.format('HH:mm');
    }
}

function getDeadlineClass(deadline: string | undefined) {
    if (!deadline) return 'text-medium-emphasis';

    const deadlineDate = dayjs(deadline);
    const now = dayjs();
    const diffDays = deadlineDate.diff(now, 'days');

    if (diffDays < 0) {
        return 'text-error';
    } else if (diffDays <= 3) {
        return 'text-warning';
    } else {
        return 'text-medium-emphasis';
    }
}

function sortByTitle(entries: ListEntry2[], descending: boolean = false) {
    if (descending) {
        entries.sort((a, b) => -by((entry) => entry.title)(a, b));
    }
    else {
        entries.sort(by((entry) => entry.title));
    }
}

function sortByTime(entries: ListEntry2[], descending: boolean = false) {
    if (descending) {
        entries.sort((a, b) => -by((entry) => parseISO(entry.time))(a, b));
    }
    else {
        entries.sort(by((entry) => parseISO(entry.time)));
    }
}

function changeSortOrder(category: string, kind: string) {
    // Copy the map
    const newSortOrders = new Map(sortOrders.value);

    const [curKind, curDescending] = newSortOrders.get(category);
    if (kind === curKind) {
        newSortOrders.set(category, [kind, !curDescending]);
    }
    else {
        newSortOrders.set(category, [kind, curDescending]);
    }

    sortOrders.value = newSortOrders;
}
</script>

<style scoped lang="scss">
#home {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    user-select: text;
}

.v-card {
    flex-grow: 1;

    .v-card-title {
        justify-content: center;
        font-weight: bold;
    }

    .age {
        opacity: 0.5;
        user-select: none;
    }
}

.quick-create-section, .events-section, .tasks-section, .notes-section {
    max-width: 1200px;
    margin: 0 auto;
}

.quick-create-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
}

.events-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
}

.tasks-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
}

.notes-grid {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    gap: 16px;
    margin-bottom: 24px;
}

.event-column, .task-column {
    min-height: 200px;
}

.event-item {
    background-color: rgba(0, 0, 0, 0.02);
    border-radius: 4px;
    overflow-wrap: anywhere;

    &:hover {
        background-color: rgba(0, 0, 0, 0.04);
    }
}

.clickable-event {
    cursor: pointer;

    &:hover {
        background-color: rgba(0, 0, 0, 0.08);
    }
}

.task-item {
    background-color: rgba(0, 0, 0, 0.02);
    border-radius: 4px;
    overflow-wrap: anywhere;

    &.task-done {
        opacity: 0.6;
    }
}

.clickable-task {
    cursor: pointer;

    &:hover {
        background-color: rgba(0, 0, 0, 0.08);
    }
}

.event-name {
    font-size: 0.9rem;
    line-height: 1.2;
}

.event-time {
    font-size: 0.8rem;
}

.event-note {
    font-size: 0.8rem;
    color: rgba(0, 0, 0, 0.6);
}

.task-name {
    font-size: 0.9rem;
    line-height: 1.2;
}

.task-deadline {
    font-size: 0.8rem;
}

// Responsive adjustments
@media (max-width: 959px) {
    .events-grid {
        grid-template-columns: 1fr;
    }

    .tasks-grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 599px) {
    .quick-create-section, .events-section, .tasks-section, .notes-section {
        flex-grow: 1;
        margin: 0 8px;
    }
}
</style>
