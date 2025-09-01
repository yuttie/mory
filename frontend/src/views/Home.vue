<template>
  <div id="home">
    <!-- Quick Note/Task Creation Section -->
    <v-card class="ma-3" outlined>
      <v-card-title class="pb-2">Quick Create</v-card-title>
      <v-card-text>
        <v-tabs v-model="quickCreateTab" class="mb-3">
          <v-tab>Note</v-tab>
          <v-tab>Task</v-tab>
        </v-tabs>
        <v-tabs-items v-model="quickCreateTab">
          <v-tab-item>
            <v-textarea
              v-model="quickNoteContent"
              placeholder="Enter note content... First line will be used as title."
              rows="3"
              outlined
              dense
            ></v-textarea>
            <v-btn
              color="primary"
              v-bind:disabled="!quickNoteContent.trim()"
              v-on:click="createQuickNote"
              class="mr-2"
            >
              <v-icon left>{{ mdiFileDocumentPlusOutline }}</v-icon>
              Create Note
            </v-btn>
          </v-tab-item>
          <v-tab-item>
            <v-text-field
              v-model="quickTaskName"
              placeholder="Enter task name..."
              outlined
              dense
              class="mb-2"
            ></v-text-field>
            <div class="d-flex gap-2 mb-3">
              <v-checkbox
                v-model="quickTaskScheduleToday"
                label="Schedule for today"
                dense
                class="mt-0"
              ></v-checkbox>
              <v-menu
                ref="dueDateMenu"
                v-model="dueDateMenu"
                v-bind:close-on-content-click="false"
                v-bind:nudge-right="40"
                transition="scale-transition"
                offset-y
                min-width="auto"
              >
                <template v-slot:activator="{ on, attrs }">
                  <v-text-field
                    v-model="quickTaskDeadline"
                    label="Deadline (optional)"
                    prepend-icon
                    readonly
                    outlined
                    dense
                    v-bind="attrs"
                    v-on="on"
                  ></v-text-field>
                </template>
                <v-date-picker
                  v-model="quickTaskDeadline"
                  v-on:input="dueDateMenu = false"
                ></v-date-picker>
              </v-menu>
            </div>
            <v-btn
              color="primary"
              v-bind:disabled="!quickTaskName.trim()"
              v-on:click="createQuickTask"
              class="mr-2"
            >
              <v-icon left>{{ mdiCheckboxMarkedCirclePlusOutline }}</v-icon>
              Create Task
            </v-btn>
          </v-tab-item>
        </v-tabs-items>
      </v-card-text>
    </v-card>

    <!-- Events Section -->
    <div class="events-section ma-3">
      <h2 class="mb-3">Events</h2>
      <div class="events-grid">
        <v-card outlined class="event-column">
          <v-card-title class="pb-2">
            <v-icon left>{{ mdiCalendarToday }}</v-icon>
            Today
          </v-card-title>
          <v-card-text>
            <div v-if="todayEvents.length === 0" class="text-center text--secondary">
              No events today
            </div>
            <div v-else>
              <div
                v-for="event in todayEvents"
                v-bind:key="event.name + event.start"
                class="event-item mb-2 pa-2"
                v-bind:style="{ 'border-left': `4px solid ${event.color}` }"
              >
                <div class="event-name font-weight-medium">{{ event.name }}</div>
                <div class="event-time text--secondary caption">{{ formatEventTime(event) }}</div>
                <div v-if="event.note" class="event-note caption mt-1">{{ event.note }}</div>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <v-card outlined class="event-column">
          <v-card-title class="pb-2">
            <v-icon left>{{ mdiCalendar }}</v-icon>
            Tomorrow
          </v-card-title>
          <v-card-text>
            <div v-if="tomorrowEvents.length === 0" class="text-center text--secondary">
              No events tomorrow
            </div>
            <div v-else>
              <div
                v-for="event in tomorrowEvents"
                v-bind:key="event.name + event.start"
                class="event-item mb-2 pa-2"
                v-bind:style="{ 'border-left': `4px solid ${event.color}` }"
              >
                <div class="event-name font-weight-medium">{{ event.name }}</div>
                <div class="event-time text--secondary caption">{{ formatEventTime(event) }}</div>
                <div v-if="event.note" class="event-note caption mt-1">{{ event.note }}</div>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <v-card outlined class="event-column">
          <v-card-title class="pb-2">
            <v-icon left>{{ mdiCalendarPlus }}</v-icon>
            Day After Tomorrow
          </v-card-title>
          <v-card-text>
            <div v-if="dayAfterTomorrowEvents.length === 0" class="text-center text--secondary">
              No events
            </div>
            <div v-else>
              <div
                v-for="event in dayAfterTomorrowEvents"
                v-bind:key="event.name + event.start"
                class="event-item mb-2 pa-2"
                v-bind:style="{ 'border-left': `4px solid ${event.color}` }"
              >
                <div class="event-name font-weight-medium">{{ event.name }}</div>
                <div class="event-time text--secondary caption">{{ formatEventTime(event) }}</div>
                <div v-if="event.note" class="event-note caption mt-1">{{ event.note }}</div>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </div>
    </div>

    <!-- Tasks Section -->
    <div class="tasks-section ma-3">
      <h2 class="mb-3">Tasks</h2>
      <div class="tasks-grid">
        <v-card outlined class="task-column">
          <v-card-title class="pb-2">
            <v-icon left>{{ mdiCheckboxMarkedCircleOutline }}</v-icon>
            Scheduled Today
          </v-card-title>
          <v-card-text>
            <div v-if="todayTasks.length === 0" class="text-center text--secondary">
              No tasks scheduled for today
            </div>
            <div v-else>
              <div
                v-for="task in todayTasks"
                v-bind:key="task.id"
                class="task-item mb-2 pa-2"
                v-bind:class="{ 'task-done': task.done }"
              >
                <div class="d-flex align-center">
                  <v-checkbox
                    v-model="task.done"
                    v-on:change="updateTask(task)"
                    dense
                    class="mt-0 mr-2"
                  ></v-checkbox>
                  <div class="task-content flex-grow-1">
                    <div class="task-name" v-bind:class="{ 'text-decoration-line-through': task.done }">
                      {{ task.name }}
                    </div>
                    <div v-if="task.deadline" class="task-deadline text--secondary caption">
                      Deadline: {{ task.deadline }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <v-card outlined class="task-column">
          <v-card-title class="pb-2">
            <v-icon left>{{ mdiClockOutline }}</v-icon>
            Upcoming Due Dates
          </v-card-title>
          <v-card-text>
            <div v-if="upcomingTasks.length === 0" class="text-center text--secondary">
              No upcoming deadlines
            </div>
            <div v-else>
              <div
                v-for="task in upcomingTasks"
                v-bind:key="task.id"
                class="task-item mb-2 pa-2"
                v-bind:class="{ 'task-done': task.done }"
              >
                <div class="d-flex align-center">
                  <v-checkbox
                    v-model="task.done"
                    v-on:change="updateTask(task)"
                    dense
                    class="mt-0 mr-2"
                  ></v-checkbox>
                  <div class="task-content flex-grow-1">
                    <div class="task-name" v-bind:class="{ 'text-decoration-line-through': task.done }">
                      {{ task.name }}
                    </div>
                    <div class="task-deadline caption" v-bind:class="getDeadlineClass(task.deadline)">
                      Due: {{ task.deadline }}
                    </div>
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
      <h2 class="mb-3">Notes by Category</h2>
      <v-card
        v-for="category of sortedCategorizedEntries.entries()"
        v-bind:key="category[0]"
        class="mb-3"
        outlined
      >
        <v-card-title>{{ category[0] }}</v-card-title>
        <v-card-text>
          <div class="text-center mb-3">
            <v-btn
              text
              x-small
              v-on:click="changeSortOrder(category[0], 'title')"
            ><v-icon x-small v-if="sortOrders.get(category[0])[0] === 'title'">{{ sortOrders.get(category[0])[1] ? mdiSortDescending : mdiSortAscending }}</v-icon>sort by title</v-btn>
            <v-btn
              text
              x-small
              v-on:click="changeSortOrder(category[0], 'time')"
            ><v-icon x-small v-if="sortOrders.get(category[0])[0] === 'time'">{{ sortOrders.get(category[0])[1] ? mdiSortDescending : mdiSortAscending }}</v-icon>sort by time</v-btn>
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

    <v-overlay v-bind:value="isLoading" z-index="10" opacity="0">
      <v-progress-circular indeterminate color="blue-grey lighten-3" size="64"></v-progress-circular>
    </v-overlay>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
    <v-snackbar v-model="successMessage" color="success" top timeout="3000">{{ successText }}</v-snackbar>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import type { Ref } from 'vue';

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
} from '@mdi/js';

import * as api from '@/api';
import type { ListEntry2, Task, TaskData } from '@/api';
import { isMetadataEventMultiple, validateEvent } from '@/api';
import { by } from '@/utils';
import dayjs from 'dayjs';
import YAML from 'yaml';

import { formatDistanceToNow, parseISO } from 'date-fns';

// Emits
const emit = defineEmits<{
  (e: 'tokenExpired', callback: () => void): void;
}>();

// Reactive states
const entries: Ref<ListEntry2[]> = ref([]);
const isLoading = ref(false);
const error = ref(false);
const errorText = ref('');
const sortOrders: Ref<Map<string, [string, boolean]>> = ref(new Map());

// Quick create states
const quickCreateTab = ref(0);
const quickNoteContent = ref('');
const quickTaskName = ref('');
const quickTaskScheduleToday = ref(false);
const quickTaskDeadline = ref('');
const dueDateMenu = ref(false);

// Success/error messaging
const successMessage = ref(false);
const successText = ref('');

// Tasks data
const taskData: Ref<TaskData | null> = ref(null);
const taskETag: Ref<string | null> = ref(null);

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
  for (const entry of entries.value) {
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

// Events computation (based on Calendar view)
const events = computed(() => {
    function normalizeEndTime(end: string | undefined, start: string): string | undefined | null {
        if (end === undefined) {
            return undefined;
        }

        const formatDateTime = (datetime: dayjs.Dayjs) => {
            if (datetime.second() === 0) {
                return datetime.format('YYYY-MM-DD HH:mm');
            }
            else {
                return datetime.format('YYYY-MM-DD HH:mm:ss');
            }
        };
        const durationShortRegexp =
            /^\+([\d.]+) *(y|M|w|d|h|m|s|ms)$/;
        const durationLongRegexp =
            /^\+([\d.]+) *(years?|months?|weeks?|days?|hours?|minutes?|seconds?|milliseconds?)$/i;

        const match = durationShortRegexp.exec(end) || durationLongRegexp.exec(end);
        if (match === null) {
            // `end` is not in duration format
            if (dayjs(end).isValid()) {
                // Return it as is if it's in valid format
                return end;
            }
            else {
                // Try to prefix it with start date
                const prefixedEnd = dayjs(start).format('YYYY-MM-DD') + ' ' + end;
                const parsedEnd = dayjs(prefixedEnd);
                if (parsedEnd.isValid()) {
                    if (parsedEnd.isAfter(start)) {
                        return prefixedEnd;
                    }
                    else {
                        return formatDateTime(parsedEnd.add(1, 'day'));
                    }
                }
                else {
                    // `end` is invalid
                    return null;
                }
            }
        }
        else {
            // `end` is in duration format
            const amount = parseFloat(match[1]);
            const unit = match[2] as dayjs.ManipulateType;
            return formatDateTime(dayjs(start).add(amount, unit));
        }
    }

    const events = [];
    for (const entry of entries.value) {
        if (entry.metadata !== null) {
            let defaultColor = "#666666";
            if (Object.hasOwn(entry.metadata, 'events') && typeof entry.metadata.events === 'object' && entry.metadata.events !== null) {
                for (const [eventName, eventDetail] of Object.entries(entry.metadata.events)) {
                    if (typeof eventDetail === 'object' && eventDetail !== null) {
                        if (isMetadataEventMultiple(eventDetail)) {
                            for (const time of eventDetail.times) {
                                if (!dayjs(time.start).isValid()) {
                                    continue;
                                }
                                const normalizedEndTime = normalizeEndTime(time.end || eventDetail.end, time.start);
                                if (normalizedEndTime === null) {
                                    continue;
                                }
                                time.end = normalizedEndTime;
                                const event = {
                                    name: eventName,
                                    start: time.start,
                                    end: time.end,
                                    finished: time.finished,
                                    color: time.color || eventDetail.color || defaultColor,
                                    note: time.note || eventDetail.note,
                                    notePath: entry.path,
                                };
                                if (validateEvent(event)) {
                                    events.push(event);
                                }
                            }
                        }
                        else {
                            if (!dayjs(eventDetail.start).isValid()) {
                                continue;
                            }
                            const normalizedEndTime = normalizeEndTime(eventDetail.end, eventDetail.start);
                            if (normalizedEndTime === null) {
                                continue;
                            }
                            eventDetail.end = normalizedEndTime;
                            const event = {
                                name: eventName,
                                start: eventDetail.start,
                                end: eventDetail.end,
                                finished: eventDetail.finished,
                                color: eventDetail.color || defaultColor,
                                note: eventDetail.note,
                                notePath: entry.path,
                            };
                            if (validateEvent(event)) {
                                events.push(event);
                            }
                        }
                    }
                }
            }
        }
    }
    return events;
});

const today = dayjs().format('YYYY-MM-DD');
const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
const dayAfterTomorrow = dayjs().add(2, 'days').format('YYYY-MM-DD');

const todayEvents = computed(() => {
    return events.value.filter(event => {
        const eventDate = dayjs(event.start).format('YYYY-MM-DD');
        return eventDate === today;
    });
});

const tomorrowEvents = computed(() => {
    return events.value.filter(event => {
        const eventDate = dayjs(event.start).format('YYYY-MM-DD');
        return eventDate === tomorrow;
    });
});

const dayAfterTomorrowEvents = computed(() => {
    return events.value.filter(event => {
        const eventDate = dayjs(event.start).format('YYYY-MM-DD');
        return eventDate === dayAfterTomorrow;
    });
});

const todayTasks = computed(() => {
    if (!taskData.value) return [];
    return taskData.value.tasks.scheduled[today] || [];
});

const upcomingTasks = computed(() => {
    if (!taskData.value) return [];
    
    const tasks: Task[] = [];
    const now = dayjs();
    
    // Collect tasks with deadlines from backlog
    for (const task of taskData.value.tasks.backlog) {
        if (task.deadline && dayjs(task.deadline).isAfter(now)) {
            tasks.push(task);
        }
    }
    
    // Collect tasks with deadlines from scheduled dates
    for (const [date, dayTasks] of Object.entries(taskData.value.tasks.scheduled)) {
        for (const task of dayTasks) {
            if (task.deadline && dayjs(task.deadline).isAfter(now)) {
                tasks.push(task);
            }
        }
    }
    
    // Sort by deadline
    return tasks.sort((a, b) => dayjs(a.deadline!).diff(dayjs(b.deadline!)));
});

// Lifecycle hooks
onMounted(() => {
  document.title = `Home | ${import.meta.env.VITE_APP_NAME}`;

  load();
  loadTasks();
});

// Methods
function load() {
  isLoading.value = true;
  api.listNotes()
    .then(res => {
      entries.value = res.data;
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
    const [eTag, data] = await api.getTaskData(taskETag.value);
    if (data !== null) {
      taskETag.value = eTag;
      taskData.value = data;
    }
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
}

async function createQuickNote() {
  try {
    const content = quickNoteContent.value.trim();
    const lines = content.split('\n');
    const title = lines[0] || 'Quick Note';
    const filename = crypto.randomUUID() + '.md';
    
    await api.addNote(filename, content);
    successText.value = `Note "${title}" created successfully!`;
    successMessage.value = true;
    quickNoteContent.value = '';
    
    // Reload notes to show the new one if it has home tags
    load();
  } catch (err) {
    errorText.value = 'Failed to create note';
    error.value = true;
  }
}

async function createQuickTask() {
  try {
    const newTask: Task = {
      id: crypto.randomUUID(),
      name: quickTaskName.value.trim(),
      deadline: quickTaskDeadline.value || null,
      schedule: quickTaskScheduleToday.value ? today : null,
      done: false,
      tags: [],
      note: '',
    };

    // Add to appropriate location
    if (newTask.schedule) {
      if (!taskData.value.tasks.scheduled[newTask.schedule]) {
        taskData.value.tasks.scheduled[newTask.schedule] = [];
      }
      taskData.value.tasks.scheduled[newTask.schedule].push(newTask);
    } else {
      taskData.value.tasks.backlog.push(newTask);
    }

    await saveTaskData();
    
    successText.value = `Task "${newTask.name}" created successfully!`;
    successMessage.value = true;
    quickTaskName.value = '';
    quickTaskDeadline.value = '';
    quickTaskScheduleToday.value = false;
  } catch (err) {
    errorText.value = 'Failed to create task';
    error.value = true;
  }
}

async function updateTask(task: Task) {
  try {
    await saveTaskData();
    successText.value = 'Task updated!';
    successMessage.value = true;
  } catch (err) {
    errorText.value = 'Failed to update task';
    error.value = true;
  }
}

async function saveTaskData() {
  if (!taskData.value) return;
  
  const yaml = YAML.stringify({
    tasks: taskData.value.tasks,
    groups: taskData.value.groups || []
  });
  await api.addNote('.mory/tasks.yaml', yaml);
}

function formatEventTime(event: any) {
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

function getDeadlineClass(deadline: string) {
  const deadlineDate = dayjs(deadline);
  const now = dayjs();
  const diffDays = deadlineDate.diff(now, 'days');
  
  if (diffDays < 0) {
    return 'error--text';
  } else if (diffDays <= 3) {
    return 'warning--text';
  } else {
    return 'text--secondary';
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
  user-select: text;
}

.events-section, .tasks-section, .notes-section {
  max-width: 1200px;
  margin: 0 auto;
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

.event-column, .task-column {
  min-height: 200px;
}

.event-item {
  background-color: rgba(0, 0, 0, 0.02);
  border-radius: 4px;
  transition: background-color 0.2s;
  
  &:hover {
    background-color: rgba(0, 0, 0, 0.04);
  }
}

.task-item {
  background-color: rgba(0, 0, 0, 0.02);
  border-radius: 4px;
  transition: opacity 0.2s;
  
  &.task-done {
    opacity: 0.6;
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
  .events-section, .tasks-section, .notes-section {
    margin: 0 8px;
  }
}
</style>
