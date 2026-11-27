<!-- Days to plan work on, from one to four weeks of them, each with the events on it and the time
     they leave; and one day alone, its tasks poured into that time (`@/planner`). -->
<template>
    <div
        class="plan-view d-flex flex-column"
        v-bind:class="{ dragging: draggedFrom !== null }"
    >
        <div
            class="plan-toolbar"
            role="toolbar"
            aria-label="Planning"
        >
            <div class="plan-navigation">
                <v-btn
                    v-bind:disabled="busy"
                    v-bind:icon="mdiChevronLeft"
                    v-bind:title="zoom === 'day' ? 'Previous day' : 'Previous week'"
                    size="small"
                    variant="text"
                    v-on:click="step(-1)"
                />
                <v-btn
                    v-bind:disabled="busy"
                    v-on:click="cursor = today"
                >
                    Today
                </v-btn>
                <v-btn
                    v-bind:disabled="busy"
                    v-bind:icon="mdiChevronRight"
                    v-bind:title="zoom === 'day' ? 'Next day' : 'Next week'"
                    size="small"
                    variant="text"
                    v-on:click="step(1)"
                />
            </div>
            <div class="plan-range">
                {{ rangeLabel }}
            </div>
            <v-btn-toggle
                v-model="zoom"
                mandatory
                density="compact"
                aria-label="Days shown"
            >
                <v-btn
                    v-for="{ value, text, title } of ZOOMS"
                    v-bind:key="value"
                    v-bind:value="value"
                    v-bind:title="title"
                    min-width="0"
                >
                    {{ text }}
                </v-btn>
            </v-btn-toggle>
            <!-- An interruption is recorded as it happens: on today, or on the day shown alone.
                 A phone has no room for these two beside the days shown, so there they are in a
                 menu. -->
            <template v-if="!$vuetify.display.xs">
                <v-btn
                    v-bind:disabled="busy"
                    v-bind:prepend-icon="mdiLightningBoltOutline"
                    v-bind:title="`Record an interruption on ${interruptionDay}`"
                    v-on:click="askInterruption"
                >
                    Interruption
                </v-btn>
                <v-btn
                    v-bind:disabled="busy"
                    v-on:click="run(collect)"
                >
                    Collect undone
                </v-btn>
            </template>
            <v-menu v-else>
                <template #activator="{ props: menuProps }">
                    <v-btn
                        v-bind="menuProps"
                        v-bind:icon="mdiDotsVertical"
                        title="More"
                        size="small"
                        variant="text"
                    />
                </template>
                <v-list>
                    <v-list-item
                        v-bind:prepend-icon="mdiLightningBoltOutline"
                        v-bind:title="`Record interruption on ${interruptionDay}`"
                        v-bind:disabled="busy"
                        v-on:click="askInterruption"
                    />
                    <v-list-item
                        title="Collect undone"
                        v-bind:disabled="busy"
                        v-on:click="run(collect)"
                    />
                </v-list>
            </v-menu>
        </div>
        <v-alert
            v-if="error"
            type="error"
            closable
            v-on:click:close="error = ''"
        >
            {{ error }}
        </v-alert>
        <v-alert
            v-for="[month, problem] of Object.entries(plans.errors)"
            v-bind:key="month"
            type="warning"
        >
            {{ month }}: {{ problem }}
        </v-alert>
        <div class="plan-body">
            <TaskGroup
                class="candidates"
                v-bind:class="{ origin: draggedFrom === 'candidates' }"
                title="Candidate tasks"
                subtitle="Drag onto a day to plan work"
            >
                <template #header>
                    <!-- A task is added where it is planned from: under the task the list is of,
                         and To do, as a task in the backlog is no candidate. -->
                    <v-text-field
                        v-model="added"
                        class="candidate-add"
                        v-bind:label="`Add a task${rootTitle ? ` under ${rootTitle}` : ''}`"
                        placeholder="Title [2h, <=2026-12-10]"
                        density="compact"
                        hide-details="auto"
                        v-bind:error-messages="addError"
                        v-bind:loading="adding"
                        v-bind:readonly="adding"
                        v-bind:append-inner-icon="mdiPlus"
                        v-on:click:append-inner="add"
                        v-on:keydown.enter.prevent="add"
                        v-on:update:model-value="addError = ''"
                    />
                    <TaskSearchField
                        v-model="searched"
                        class="candidate-search"
                        label="Search candidates"
                        v-bind:delay="250"
                    />
                </template>
                <div
                    v-if="terms.length > 0 && shownCandidates.length === 0"
                    class="text-medium-emphasis pa-2"
                >
                    No candidates match.
                </div>
                <draggable
                    class="task-list candidate-list"
                    v-bind:model-value="shownCandidates"
                    item-key="uuid"
                    v-bind:group="CANDIDATE_GROUP"
                    v-bind:clone="cloneTask"
                    v-bind:move="canDrop"
                    v-bind:sort="false"
                    v-bind:disabled="busy"
                    v-bind:force-fallback="true"
                    v-bind:fallback-on-body="true"
                    v-bind:delay="500"
                    v-bind:delay-on-touch-only="true"
                    v-on:start="draggedFrom = 'candidates'"
                    v-on:end="draggedFrom = null"
                    v-on:clone="onClone"
                >
                    <template #item="{ element: task }">
                        <div class="task-list-entry">
                            <TaskListItemNext
                                class="candidate"
                                draggable="false"
                                v-bind:value="task"
                                v-bind:to="routeFor(task)"
                                v-bind:list-root="listRoot"
                                v-bind:highlight="terms"
                                v-on:pointerdown="onPointerDown"
                                v-on:contextmenu="onContextMenu"
                            >
                                <span
                                    class="candidate-estimate"
                                    v-bind:class="{ assumed: estimateOf(task).assumed }"
                                    v-bind:title="estimateOf(task).assumed ? 'No estimate of its own' : 'Estimate'"
                                >{{ formatEstimate(estimateOf(task).minutes) }}</span>
                                <div
                                    v-if="lenders.get(task.uuid)"
                                    class="lent-dates"
                                >
                                    <span class="text-medium-emphasis">Ranked by {{ lenders.get(task.uuid)!.title || 'Untitled' }}:</span>
                                    <TaskDateCues
                                        v-bind:value="lenders.get(task.uuid)!"
                                        v-bind:fields="LENT_FIELDS"
                                    />
                                </div>
                            </TaskListItemNext>
                        </div>
                    </template>
                </draggable>
            </TaskGroup>
            <div
                class="days"
                v-bind:class="zoom === 'day' ? 'one-day' : 'weeks'"
            >
                <template v-if="zoom !== 'day'">
                    <div
                        v-for="name of weekdayNames"
                        v-bind:key="name"
                        class="weekday"
                    >
                        {{ name }}
                    </div>
                </template>
                <section
                    v-for="day of days"
                    v-bind:key="day.date"
                    class="day"
                    v-bind:class="{ today: day.today, past: day.past, origin: draggedFrom === day.date }"
                    v-bind:data-day="day.date"
                >
                    <header class="day-header">
                        <button
                            type="button"
                            class="day-title"
                            v-bind:title="zoom === 'day' ? undefined : 'Show this day alone'"
                            v-bind:disabled="zoom === 'day'"
                            v-on:click="openDay(day.date)"
                        >
                            {{ day.label }}
                        </button>
                        <span
                            v-if="!day.past"
                            class="day-load"
                            v-bind:class="{ over: day.overflowMinutes > 0 }"
                            v-bind:title="loadTitle(day)"
                        >{{ formatEstimate(day.plannedMinutes) }} / {{ formatEstimate(day.freeMinutes) }}</span>
                    </header>
                    <div
                        v-if="!day.past"
                        class="day-meter"
                        role="presentation"
                    >
                        <div
                            class="day-meter-fill"
                            v-bind:class="{ over: day.overflowMinutes > 0 }"
                            v-bind:style="{ width: `${meterOf(day)}%` }"
                        />
                    </div>
                    <!-- A whole day takes no time, but says what kind of day it is: always in
                         sight, so nothing is planned on it unawares. -->
                    <div
                        v-for="(event, index) of day.events.allDay"
                        v-bind:key="`all-${index}`"
                        class="day-banner"
                        v-bind:style="{ backgroundColor: event.color }"
                        v-bind:title="event.name"
                    >
                        {{ event.name }}
                    </div>
                    <div
                        v-for="(event, index) of day.taskDates.slice(0, shownTaskDates)"
                        v-bind:key="`date-${index}`"
                        class="day-task-date"
                        v-bind:style="{ color: event.color }"
                        v-bind:title="event.name"
                    >
                        <v-icon size="x-small">
                            {{ mdiFlagOutline }}
                        </v-icon>
                        {{ event.name }}
                    </div>
                    <!-- A day many dates fall on would be all dates: the rest are on the day alone. -->
                    <button
                        v-if="day.taskDates.length > shownTaskDates"
                        type="button"
                        class="day-more"
                        v-on:click="openDay(day.date)"
                    >
                        +{{ day.taskDates.length - shownTaskDates }} more dates
                    </button>
                    <div
                        v-for="(timed, index) of day.events.timed"
                        v-bind:key="`timed-${index}`"
                        class="day-event"
                        v-bind:title="`${clockOf(timed.start)}–${clockOf(timed.end)} ${timed.event.name}`"
                    >
                        <span
                            class="day-event-dot"
                            v-bind:style="{ backgroundColor: timed.event.color }"
                        />
                        <span class="day-event-time">{{ clockOf(timed.start) }}</span>
                        {{ timed.event.name }}
                    </div>
                    <draggable
                        class="task-list entries"
                        v-bind:data-date="day.date"
                        v-bind:model-value="day.rows"
                        v-bind:item-key="rowKey"
                        v-bind:group="DAY_GROUP"
                        v-bind:clone="(row: Row) => cloneEntry(row.entry, day.date)"
                        v-bind:move="canDrop"
                        v-bind:disabled="busy"
                        v-bind:force-fallback="true"
                        v-bind:fallback-on-body="true"
                        v-bind:delay="500"
                        v-bind:delay-on-touch-only="true"
                        v-on:start="draggedFrom = day.date"
                        v-on:end="draggedFrom = null"
                        v-on:clone="onClone"
                        v-on:change="onDayChange(day.date, $event)"
                    >
                        <template #item="{ element: row }">
                            <div class="task-list-entry">
                                <button
                                    type="button"
                                    class="plan-entry"
                                    v-bind:class="{ finished: !row.active || day.past, over: row.left > 0, 'text-disabled': !row.task }"
                                    v-bind:style="{ backgroundColor: statusGround(row.task?.metadata?.task?.status?.kind, taskSettings.resolvedStatusColors) }"
                                    v-bind:data-task="row.entry.task"
                                    v-on:pointerdown="onPointerDown"
                                    v-on:contextmenu="onContextMenu"
                                    v-on:click="openMenu(day.date, row, $event)"
                                >
                                    <span class="plan-entry-head">
                                        <v-icon
                                            size="x-small"
                                            v-bind:color="statusColor(row.task?.metadata?.task?.status?.kind, taskSettings.resolvedStatusColors)"
                                        >
                                            {{ statusIcon(row.task?.metadata?.task?.status?.kind, false) }}
                                        </v-icon>
                                        <span class="plan-entry-title">{{ row.task ? row.task.title || 'Untitled' : `Unknown task ${row.entry.task}` }}</span>
                                    </span>
                                    <span class="plan-entry-meta">
                                        <template v-if="row.active && !day.past">
                                            <span v-if="row.start !== undefined">{{ clockOf(row.start) }}</span>
                                            <span
                                                class="plan-entry-estimate"
                                                v-bind:class="{ assumed: row.estimate.assumed }"
                                                v-bind:title="row.left > 0 ? `${formatEstimate(row.left)} does not fit the day` : row.estimate.assumed ? 'No estimate of its own' : 'Estimate'"
                                            >{{ formatEstimate(row.estimate.minutes) }}</span>
                                            <span v-if="row.left > 0">{{ row.left === row.estimate.minutes ? 'does not fit' : `${formatEstimate(row.left)} over` }}</span>
                                        </template>
                                        <span v-else-if="row.entry.result">
                                            <v-icon size="x-small">{{ row.entry.result === 'worked' ? mdiCheck : mdiClose }}</v-icon>
                                            {{ row.entry.result }}
                                        </span>
                                        <span v-else>{{ row.active ? 'unrecorded' : row.task ? 'over' : 'unknown' }}</span>
                                        <v-icon
                                            v-if="row.entry.origin === 'interruption'"
                                            size="x-small"
                                            title="Interruption"
                                        >
                                            {{ mdiLightningBoltOutline }}
                                        </v-icon>
                                    </span>
                                </button>
                            </div>
                        </template>
                    </draggable>
                </section>
                <!-- The one day by the clock: its events, and its tasks in the time they leave. -->
                <section
                    v-if="timeline"
                    class="timeline"
                    aria-label="The day by the clock"
                >
                    <div
                        class="timeline-track"
                        v-bind:style="{ height: `${timeline.height}px` }"
                    >
                        <div
                            v-for="shade of timeline.shades"
                            v-bind:key="`shade-${shade.top}`"
                            class="timeline-shade"
                            v-bind:style="{ top: `${shade.top}px`, height: `${shade.height}px` }"
                        />
                        <div
                            v-for="hour of timeline.hours"
                            v-bind:key="hour.label"
                            class="timeline-hour"
                            v-bind:style="{ top: `${hour.top}px` }"
                        >
                            <span>{{ hour.label }}</span>
                        </div>
                        <div
                            v-for="(block, index) of timeline.events"
                            v-bind:key="`event-${index}`"
                            class="timeline-event"
                            v-bind:style="{ top: `${block.top}px`, height: `${block.height}px`, left: `calc(${TIMELINE_GUTTER}px + (45% - ${TIMELINE_GUTTER / 2}px) * ${block.lane} / ${timeline.lanes})`, width: `calc((45% - ${TIMELINE_GUTTER / 2}px) / ${timeline.lanes} - 2px)`, backgroundColor: block.color }"
                            v-bind:title="block.title"
                        >
                            {{ block.name }}
                        </div>
                        <div
                            v-for="(block, index) of timeline.tasks"
                            v-bind:key="`task-${index}`"
                            class="timeline-task"
                            v-bind:class="{ assumed: block.assumed }"
                            v-bind:style="{ top: `${block.top}px`, height: `${block.height}px`, backgroundColor: block.ground }"
                            v-bind:title="block.title"
                        >
                            <span class="timeline-task-time">{{ block.label }}</span>
                            {{ block.name }}
                        </div>
                        <div
                            v-if="timeline.now !== undefined"
                            class="timeline-now"
                            v-bind:style="{ top: `${timeline.now}px` }"
                        />
                    </div>
                    <div
                        v-if="timeline.overflow.length > 0"
                        class="timeline-overflow text-error"
                    >
                        <strong>Does not fit: {{ formatEstimate(timeline.overflowMinutes) }}</strong>
                        <div
                            v-for="left of timeline.overflow"
                            v-bind:key="left.id"
                        >
                            {{ left.name }} ({{ formatEstimate(left.minutes) }})
                        </div>
                    </div>
                </section>
            </div>
        </div>
        <!-- One menu for the planned tasks, opened on the one chosen, and by `openMenu` alone:
             Vuetify would also toggle it at a click on its activator, and on a task the menu had
             opened on before, that listener ran after the view's and closed what it had opened.
             Keyed by the task, so it is a menu of its own for each: a click on another task while
             it is open is one outside it, which the menu closes at a moment later, and the same
             menu opened on the other task was closed with it. -->
        <v-menu
            v-bind:key="menuKey"
            v-model="menuOpen"
            v-bind:activator="menuActivator"
            v-bind:open-on-click="false"
            v-bind:close-on-content-click="false"
            location="end"
        >
            <v-card
                v-if="chosen"
                class="plan-entry-menu"
                min-width="280"
                max-width="360"
            >
                <v-card-title class="text-body-1">
                    <router-link
                        v-if="chosen.row.task"
                        v-bind:to="routeFor(chosen.row.task)"
                        v-on:click="menuOpen = false"
                    >
                        {{ chosen.row.task.title || 'Untitled' }}
                    </router-link>
                    <template v-else>
                        Unknown task {{ chosen.row.entry.task }}
                    </template>
                </v-card-title>
                <v-card-subtitle>
                    {{ chosen.date }} · {{ chosen.row.entry.origin }} · {{ chosen.row.entry.result ?? 'unrecorded' }}
                </v-card-subtitle>
                <v-card-text
                    v-if="chosen.row.task"
                    class="pb-0"
                >
                    <v-text-field
                        v-model="estimateDraft"
                        label="Estimate of the work left"
                        v-bind:placeholder="`${formatEstimate(chosen.row.estimate.minutes)} (resolved default)`"
                        persistent-placeholder
                        density="compact"
                        hide-details="auto"
                        v-bind:rules="[estimateRule]"
                        v-bind:disabled="busy"
                        v-on:keydown.enter.prevent="saveEstimate"
                    >
                        <template #append>
                            <v-btn
                                variant="tonal"
                                size="small"
                                v-bind:disabled="busy || !estimateChanged"
                                v-on:click="saveEstimate"
                            >
                                Set
                            </v-btn>
                        </template>
                    </v-text-field>
                </v-card-text>
                <v-list density="compact">
                    <v-list-item
                        v-bind:prepend-icon="mdiCheck"
                        v-bind:title="chosen.row.entry.result === 'worked' ? 'Not worked after all' : 'Worked on this day'"
                        v-bind:disabled="busy || !chosen.row.task"
                        v-on:click="act(() => plans.recordResult(chosen!.date, chosen!.row.entry.task, chosen!.row.entry.result === 'worked' ? undefined : 'worked'))"
                    />
                    <v-list-item
                        v-if="chosen.row.task && !isOver(chosen.row.task)"
                        v-bind:prepend-icon="mdiCalendarArrowRight"
                        v-bind:title="`Worked, and continue on ${continuationOf(chosen.date)}`"
                        v-bind:disabled="busy"
                        v-on:click="act(() => continueLater(chosen!.date, chosen!.row.entry.task))"
                    />
                    <v-list-item
                        v-if="chosen.row.task && !isOver(chosen.row.task)"
                        v-bind:prepend-icon="mdiCheckCircleOutline"
                        title="Complete task"
                        v-bind:disabled="busy"
                        v-on:click="act(() => complete(chosen!.date, chosen!.row.entry.task))"
                    />
                    <v-list-item
                        v-if="chosen.row.entry.origin === 'planned'"
                        v-bind:prepend-icon="mdiClose"
                        title="Missed"
                        v-bind:disabled="busy || chosen.row.entry.result === 'missed'"
                        v-on:click="act(() => plans.recordResult(chosen!.date, chosen!.row.entry.task, 'missed'))"
                    />
                    <v-list-item
                        v-bind:prepend-icon="mdiTrashCanOutline"
                        title="Remove from this day"
                        v-bind:disabled="busy"
                        v-on:click="act(() => plans.unplanTask(chosen!.date, chosen!.row.entry.task))"
                    />
                </v-list>
            </v-card>
        </v-menu>
        <v-dialog
            v-bind:model-value="interruptionDate !== null"
            v-bind:persistent="busy"
            max-width="550"
            v-on:update:model-value="!$event && (interruptionDate = null)"
        >
            <v-card v-bind:title="`Record interruption on ${interruptionDate}`">
                <v-card-text>
                    <v-autocomplete
                        v-model="interruptionTask"
                        v-bind:disabled="busy"
                        v-bind:items="tasks.allTasks"
                        item-title="title"
                        item-value="uuid"
                        label="Task worked on"
                        clearable
                    />
                </v-card-text>
                <v-card-actions>
                    <v-btn
                        v-bind:disabled="busy"
                        v-on:click="interruptionDate = null"
                    >
                        Cancel
                    </v-btn>
                    <v-btn
                        v-bind:disabled="!interruptionTask || busy"
                        v-on:click="run(recordInterruption)"
                    >
                        Record worked
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch, onMounted } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import dayjs from 'dayjs';
import draggable from 'vuedraggable';
import {
    mdiCalendarArrowRight,
    mdiCheck,
    mdiCheckCircleOutline,
    mdiChevronLeft,
    mdiChevronRight,
    mdiClose,
    mdiDotsVertical,
    mdiFlagOutline,
    mdiLightningBoltOutline,
    mdiPlus,
    mdiTrashCanOutline,
} from '@mdi/js';

import type { TaskNode } from '@/task-forest';
import { makeDefaultStatus } from '@/task';
import type { PlanEntry } from '@/plans';
import { DEFAULT_WORK_HOURS, estimateMinutes, formatEstimate, resolvedEstimate, type ResolvedEstimate } from '@/estimate';
import { eventsFromEntries, mergeImported, taskDatesFromEntries, type CalendarEvent } from '@/events';
import { clockOf, eventsByDay, flow, freeSpans, minutesIn, type DayEvents, type Flow, type Span } from '@/planner';
import { parseOutline, writesOf } from '@/task-outline';
import { statusColor, statusGround } from '@/status-color';
import { statusIcon } from '@/status-icon';
import { tagsOf } from '@/tags';
import { useFilesStore } from '@/stores/files';
import { useTasksStore } from '@/stores/tasks';
import { usePlansStore } from '@/stores/plans';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { useZoneStore } from '@/stores/zone';
import { HIDDEN_CALENDARS_STORAGE_KEY, HIDDEN_CATEGORIES_STORAGE_KEY, useCalendarsStore } from '@/stores/calendars';
import { useLocalStorage } from '@/composables/localStorage';
import { LENT_FIELDS, usePlanCandidates } from '@/composables/planCandidates';

const props = defineProps<{
    candidates: TaskNode[];
    routeFor: (task: TaskNode) => RouteLocationRaw;
    listRoot?: string;
}>();

// Created once: Sortable knows the list a drag began in by its group object.
const CANDIDATE_GROUP = { name: 'plans', pull: 'clone', put: false };
const DAY_GROUP = { name: 'plans', pull: true, put: true };

type Zoom = 'day' | 'w1' | 'w2' | 'w4';
const ZOOMS: { value: Zoom; text: string; title: string }[] = [
    { value: 'day', text: 'D', title: 'One day, by the clock' },
    { value: 'w1', text: '1W', title: 'One week' },
    { value: 'w2', text: '2W', title: 'Two weeks' },
    { value: 'w4', text: '4W', title: 'Four weeks' },
];

const files = useFilesStore();
const tasks = useTasksStore();
const plans = usePlansStore();
const taskSettings = useTaskSettingsStore();
const calendars = useCalendarsStore();
const zones = useZoneStore();

// How far out the view looks is the reader's habit, not the repository's.
const zoom = useLocalStorage<Zoom>('task-plan-zoom', 'w2');
// The present, to the minute the tasks store keeps: the day that is today, and where in it a day's
// tasks are poured from.
const present = computed(() => dayjs(tasks.now));
const today = computed(() => present.value.format('YYYY-MM-DD'));
const cursor = ref(dayjs().format('YYYY-MM-DD'));
const busy = ref(false);
const error = ref('');
const draggedFrom = ref<string | null>(null);
const interruptionDate = ref<string | null>(null);
const interruptionTask = ref<string | null>(null);
const interruptionDay = computed(() => (zoom.value === 'day' ? cursor.value : today.value));
function askInterruption(): void {
    interruptionDate.value = interruptionDay.value;
    interruptionTask.value = null;
}

const { searched, terms, shown: shownCandidates, lenders } = usePlanCandidates(() => props.candidates, () => props.listRoot);

const tasksById = computed(() => new Map(tasks.allTasks.map((task) => [task.uuid.toLowerCase(), task])));
const taskOf = (uuid: string): TaskNode | undefined => tasksById.value.get(uuid.toLowerCase());
const isOver = (task: TaskNode): boolean => ['done', 'canceled'].includes(task.metadata?.task?.status?.kind ?? '');
const estimateOf = (task: TaskNode | undefined): ResolvedEstimate => resolvedEstimate(task?.metadata?.task?.estimate, tagsOf(task?.metadata), taskSettings.planning);
const rootTitle = computed(() => (props.listRoot ? tasks.node(props.listRoot)?.title : undefined));

// The days shown: the one the cursor is on, or whole weeks from the start of its week.
const dates = computed<string[]>(() => {
    if (zoom.value === 'day') {
        return [cursor.value];
    }
    const first = dayjs(cursor.value).startOf('week');
    return Array.from({ length: Number(zoom.value.slice(1)) * 7 }, (_, index) => first.add(index, 'day').format('YYYY-MM-DD'));
});
const weekdayNames = computed(() => dates.value.slice(0, 7).map((date) => dayjs(date).format('ddd')));
const rangeLabel = computed(() => (zoom.value === 'day'
    ? dayjs(cursor.value).format('YYYY-MM-DD ddd')
    : `${dates.value[0]} – ${dates.value.at(-1)}`));
function step(direction: number): void {
    cursor.value = dayjs(cursor.value).add(direction, zoom.value === 'day' ? 'day' : 'week').format('YYYY-MM-DD');
}
function openDay(date: string): void {
    cursor.value = date;
    zoom.value = 'day';
}

// The events of the days shown, as the calendar draws them. A week further back, so that an event
// begun before the first day and still on is there.
const eventWindow = computed(() => ({
    from: dayjs(dates.value[0]).subtract(7, 'day').format('YYYY-MM-DD'),
    to: dayjs(dates.value.at(-1)).add(1, 'day').format('YYYY-MM-DD'),
}));
const hiddenCalendarIds = useLocalStorage<string[]>(HIDDEN_CALENDARS_STORAGE_KEY, []);
const hiddenCategoryIds = useLocalStorage<string[]>(HIDDEN_CATEGORIES_STORAGE_KEY, []);
const events = computed(() => mergeImported(
    [
        ...eventsFromEntries(files.entries, eventWindow.value, { categories: calendars.categoryMap }).events,
        ...taskDatesFromEntries(files.entries, eventWindow.value, { colorOf: calendars.taskDateColors }).events,
    ],
    calendars.events,
    {
        colorOf: calendars.colorOf,
        hidden: new Set(hiddenCalendarIds.value),
        hiddenCategories: new Set(hiddenCategoryIds.value),
    },
));
const eventsOfDays = computed(() => eventsByDay(events.value, dates.value[0], dates.value.at(-1)!));
// The dates of the tasks the list is of, and of the task they are under: the milestones the days
// are planned towards. Every task's would bury them.
const listed = computed(() => new Set([...props.candidates.map((task) => task.uuid.toLowerCase()), ...(props.listRoot ? [props.listRoot.toLowerCase()] : [])]));
const isListed = (event: CalendarEvent): boolean => event.taskId !== undefined && listed.value.has(event.taskId.toLowerCase());

interface Row {
    entry: PlanEntry;
    task: TaskNode | undefined;
    estimate: ResolvedEstimate;
    // Still to be worked on that day: no result recorded, and the task not over.
    active: boolean;
    // When the day's pouring begins it, and how much of it the day has no room for.
    start: number | undefined;
    left: number;
}
interface Day {
    date: string;
    label: string;
    today: boolean;
    past: boolean;
    events: DayEvents;
    taskDates: CalendarEvent[];
    rows: Row[];
    free: Span[];
    flow: Flow;
    freeMinutes: number;
    plannedMinutes: number;
    assumedMinutes: number;
    overflowMinutes: number;
}
const work = computed(() => taskSettings.planning.work_hours ?? DEFAULT_WORK_HOURS);
const days = computed<Day[]>(() => dates.value.map((date, index) => {
    const dayEvents = eventsOfDays.value[date] ?? { allDay: [], timed: [], taskDates: [] };
    const isToday = date === today.value;
    const past = date < today.value;
    const rows: Row[] = (plans.days[date] ?? []).map((entry) => {
        const task = taskOf(entry.task);
        return { entry, task, estimate: estimateOf(task), active: entry.result === undefined && task !== undefined && !isOver(task), start: undefined, left: 0 };
    });
    // A day gone by has no time left to pour into, and nothing on it is still to be fitted: it
    // only shows what was planned and what came of it.
    const active = past ? [] : rows.filter((row) => row.active);
    const free = past ? [] : freeSpans(work.value, dayEvents.timed, isToday ? present.value.diff(present.value.startOf('day'), 'minute') : undefined);
    const poured = flow(active.map((row) => ({ id: row.entry.task, minutes: row.estimate.minutes })), free);
    for (const row of active) {
        row.start = poured.segments.find((segment) => segment.id === row.entry.task)?.start;
        row.left = poured.overflow.find((left) => left.id === row.entry.task)?.minutes ?? 0;
    }
    const day = dayjs(date);
    return {
        date,
        // The month where it is not plain from the days around: on the first day shown and on a first.
        label: zoom.value === 'day' ? day.format('YYYY-MM-DD ddd') : day.format(index === 0 || day.date() === 1 ? 'M/D' : 'D'),
        today: isToday,
        past,
        events: dayEvents,
        taskDates: dayEvents.taskDates.filter(isListed),
        rows,
        free,
        flow: poured,
        freeMinutes: minutesIn(free),
        plannedMinutes: active.reduce((sum, row) => sum + row.estimate.minutes, 0),
        assumedMinutes: active.reduce((sum, row) => sum + (row.estimate.assumed ? row.estimate.minutes : 0), 0),
        overflowMinutes: minutesIn(poured.overflow.map((left) => ({ start: 0, end: left.minutes }))),
    };
}));
const shownTaskDates = computed(() => (zoom.value === 'day' ? Infinity : 3));
const rowKey = (row: Row): string => row.entry.task;
function loadTitle(day: Day): string {
    return `${formatEstimate(day.plannedMinutes)} planned`
        + (day.assumedMinutes > 0 ? ` (${formatEstimate(day.assumedMinutes)} without an estimate of its own)` : '')
        + ` in ${formatEstimate(day.freeMinutes)} free`
        + (day.overflowMinutes > 0 ? `; ${formatEstimate(day.overflowMinutes)} does not fit` : '');
}
function meterOf(day: Day): number {
    if (day.plannedMinutes === 0) {
        return 0;
    }
    return day.freeMinutes === 0 ? 100 : Math.min(100, day.plannedMinutes / day.freeMinutes * 100);
}

// The day alone, by the clock. From the hours worked, and as much further as its events reach.
const PIXELS_PER_MINUTE = 1.2;
const TIMELINE_GUTTER = 48;
const timeline = computed(() => {
    if (zoom.value !== 'day') {
        return undefined;
    }
    const day = days.value[0];
    const timed = day.events.timed;
    const first = Math.floor(Math.min(work.value.start, ...timed.map((event) => event.start)) / 60) * 60;
    const last = Math.ceil(Math.max(work.value.end, ...timed.map((event) => event.end)) / 60) * 60;
    const at = (minutes: number): number => (minutes - first) * PIXELS_PER_MINUTE;
    // Each event in the first lane free of the ones before it, so two at once are side by side.
    const laneEnds: number[] = [];
    const eventBlocks = timed.map(({ event, start, end }) => {
        let lane = laneEnds.findIndex((until) => until <= start);
        if (lane === -1) {
            lane = laneEnds.length;
        }
        laneEnds[lane] = Math.max(end, start + 15);
        return {
            lane,
            top: at(start),
            height: Math.max(at(end) - at(start), 16),
            name: event.name,
            color: event.color,
            title: `${clockOf(start)}–${clockOf(end)} ${event.name}`,
        };
    });
    const now = present.value.diff(present.value.startOf('day'), 'minute');
    const nameOf = (uuid: string): string => taskOf(uuid)?.title || 'Untitled';
    return {
        height: at(last),
        hours: Array.from({ length: (last - first) / 60 + 1 }, (_, index) => ({ top: index * 60 * PIXELS_PER_MINUTE, label: clockOf(first + index * 60) })),
        // Outside the hours worked.
        shades: [
            { top: 0, height: at(work.value.start) },
            { top: at(work.value.end), height: at(last) - at(work.value.end) },
        ].filter((shade) => shade.height > 0),
        lanes: Math.max(1, laneEnds.length),
        events: eventBlocks,
        tasks: day.flow.segments.map((segment) => {
            const row = day.rows.find((candidate) => candidate.entry.task === segment.id);
            const label = `${clockOf(segment.start)}–${clockOf(segment.end)}` + (segment.parts > 1 ? ` (${segment.part}/${segment.parts})` : '');
            return {
                top: at(segment.start),
                height: at(segment.end) - at(segment.start),
                name: nameOf(segment.id),
                label,
                title: `${label} ${nameOf(segment.id)}`,
                assumed: row?.estimate.assumed ?? false,
                ground: statusGround(row?.task?.metadata?.task?.status?.kind, taskSettings.resolvedStatusColors),
            };
        }),
        now: day.today && now >= first && now <= last ? at(now) : undefined,
        overflow: day.flow.overflow.map((left) => ({ ...left, name: nameOf(left.id) })),
        overflowMinutes: day.overflowMinutes,
    };
});

// The planned task the menu is open on. Found again in the days at each draw, so the menu shows
// the entry as it is after each change, and nothing of one that has gone.
const menuOpen = ref(false);
const menuActivator = ref<HTMLElement | undefined>(undefined);
const menuOn = ref<{ date: string; task: string } | null>(null);
const menuKey = computed(() => (menuOn.value ? `${menuOn.value.date} ${menuOn.value.task}` : ''));
const chosen = computed(() => {
    const on = menuOn.value;
    const row = on && days.value.find((day) => day.date === on.date)?.rows.find((candidate) => candidate.entry.task === on.task);
    return on && row ? { date: on.date, row } : null;
});
const estimateDraft = ref('');
const estimateRule = (value: string) => !value?.trim() || estimateMinutes(value) !== undefined || 'Use hours and minutes, such as 3h, 90m or 1h 30m.';
const estimateChanged = computed(() => {
    const typed = estimateDraft.value.trim();
    return typed !== '' && estimateMinutes(typed) !== undefined && typed !== (chosen.value?.row.task?.metadata?.task?.estimate ?? '');
});
function openMenu(date: string, row: Row, event: MouseEvent): void {
    menuOn.value = { date, task: row.entry.task };
    menuActivator.value = event.currentTarget as HTMLElement;
    const own = row.task?.metadata?.task?.estimate;
    estimateDraft.value = typeof own === 'string' ? own : '';
    menuOpen.value = true;
}
watch(chosen, (value) => {
    if (value === null) {
        menuOpen.value = false;
    }
});
// The task view covers itself while the listing loads, and a menu is drawn over that cover, as
// every overlay is: left open, it would be the one thing still offered on a view that says to wait,
// and offered for a task the listing may be about to change. So it closes, as it does once any
// of its own actions is taken.
watch(() => tasks.isLoading, (loading) => {
    if (loading) {
        menuOpen.value = false;
    }
});

const cloneTask = (task: TaskNode): PlanEntry => ({ task: task.uuid.toLowerCase(), origin: 'planned' });
interface DraggedPlanEntry extends PlanEntry {
    sourceDate?: string;
}
// Carry the source with the drag, since Sortable's end event clears the view's drag state.
const cloneEntry = (entry: PlanEntry, sourceDate: string): DraggedPlanEntry => ({ ...entry, sourceDate });
function canDrop(event: { from: HTMLElement; to: HTMLElement; draggedContext: { element: TaskNode | Row } }): boolean {
    if (event.from === event.to) {
        return true;
    }
    const date = event.to.dataset.date;
    const element = event.draggedContext.element;
    const uuid = 'entry' in element ? element.entry.task : element.uuid.toLowerCase();
    return date !== undefined && !(plans.days[date] ?? []).some((entry) => entry.task === uuid);
}
// Match the Status view: touch picks up the whole row without opening the link's menu.
let pressedWith = '';
function onPointerDown(event: PointerEvent): void {
    pressedWith = event.pointerType;
}
function onContextMenu(event: MouseEvent): void {
    if (pressedWith === 'touch') {
        event.preventDefault();
    }
}
function onClone(event: { clone: HTMLElement }): void {
    event.clone.classList.add('vacated');
}
async function run(operation: () => Promise<void>): Promise<void> {
    if (busy.value) {
        return;
    }
    busy.value = true;
    error.value = '';
    try {
        await operation();
    }
    catch (failure) {
        error.value = failure instanceof Error ? failure.message : String(failure);
    }
    finally {
        busy.value = false;
    }
}
// What the menu does, after which it has nothing more to say.
function act(operation: () => Promise<void>): void {
    menuOpen.value = false;
    void run(operation);
}
function onDayChange(date: string, event: { added?: { element: DraggedPlanEntry; newIndex: number }; moved?: { element: Row; newIndex: number } }): void {
    // A day-to-day drop also emits `removed`; the destination persists both sides together.
    if (!event.added && !event.moved) {
        return;
    }
    void run(async () => {
        if (event.added) {
            const { element, newIndex } = event.added;
            if (element.sourceDate !== undefined) {
                await plans.moveTask(element.sourceDate, date, element.task, newIndex);
            }
            else if (!(plans.days[date] ?? []).some((entry) => entry.task === element.task)) {
                await plans.planTask(date, element.task, 'planned', newIndex);
            }
        }
        else if (event.moved) {
            const ordered = (plans.days[date] ?? []).map((entry) => entry.task);
            const current = ordered.indexOf(event.moved.element.entry.task);
            if (current === -1) {
                throw new Error('The plan changed during reordering. Reload and retry.');
            }
            const [uuid] = ordered.splice(current, 1);
            ordered.splice(event.moved.newIndex, 0, uuid);
            await plans.reorder(date, ordered);
        }
    });
}
function saveEstimate(): void {
    const task = chosen.value?.row.task;
    if (!task || !estimateChanged.value) {
        return;
    }
    const estimate = estimateDraft.value.trim();
    act(() => tasks.setEstimate(task.path, estimate));
}
async function complete(date: string, uuid: string): Promise<void> {
    const task = taskOf(uuid);
    if (!task) {
        throw new Error('The task no longer exists.');
    }
    // Record effort before completing the note; a failure leaves a truthful work record to retry.
    await plans.recordResult(date, uuid, 'worked');
    await tasks.setStatus(task.path, makeDefaultStatus('done'));
}
// Where a task left unfinished goes on: the day after, or today for a day gone by. Collect undone
// passes over a day worked on, so without this a task set down for the day is on no day at all.
function continuationOf(date: string): string {
    return date < today.value ? today.value : dayjs(date).add(1, 'day').format('YYYY-MM-DD');
}
async function continueLater(date: string, uuid: string): Promise<void> {
    await plans.recordResult(date, uuid, 'worked');
    await plans.planTask(continuationOf(date), uuid, 'planned');
}
async function recordInterruption(): Promise<void> {
    const date = interruptionDate.value;
    const task = interruptionTask.value;
    if (date && task) {
        await plans.planTask(date, task, 'interruption');
        // An already planned task keeps its origin but still records that work happened.
        await plans.recordResult(date, task, 'worked');
        interruptionDate.value = null;
    }
}
async function collect(): Promise<void> {
    await plans.collect(today.value, (uuid) => {
        const task = taskOf(uuid);
        return task ? task.metadata?.task?.status?.kind ?? 'backlog' : undefined;
    });
}

// A task typed where it is planned from, as a line of Quick add: a title, and its fields in
// brackets. It is added To do unless the line says otherwise, since a task in the backlog is no
// candidate and would vanish as it is added.
const added = ref('');
const addError = ref('');
const adding = ref(false);
async function add(): Promise<void> {
    const line = added.value.replace(/\s*\n\s*/g, ' ').trim();
    if (line === '' || adding.value) {
        return;
    }
    const outline = parseOutline(line, zones.zone);
    if (outline.problems.length > 0 || outline.tasks.length !== 1) {
        addError.value = outline.problems.map((problem) => problem.message).join(' ') || 'Type one task.';
        return;
    }
    const [task] = outline.tasks;
    if (task.fields.status === 'backlog') {
        task.fields.status = 'todo';
    }
    adding.value = true;
    try {
        const writes = writesOf(outline.tasks, (uuid) => tasks.pathUnder(props.listRoot ?? null, uuid));
        await tasks.saveAll(writes);
        added.value = '';
    }
    catch (failure) {
        addError.value = failure instanceof Error ? failure.message : String(failure);
    }
    finally {
        adding.value = false;
    }
}

// Read when the months shown change, not at every step, as the Schedule view reads them.
const shownMonths = computed(() => [...new Set(dates.value.map((date) => date.slice(0, 7)))]);
watch(() => shownMonths.value.join(), () => { void run(() => plans.loadMonths(shownMonths.value)); }, { immediate: true });
watch([eventWindow, () => calendars.subscriptionRevision], ([window]) => {
    calendars.load(window.from, window.to).catch((failure) => {
        // A calendar that fails is reported per calendar in the response; this is the request
        // itself failing, which must not take the plan down with it.
        error.value = `Could not load imported events: ${failure}`;
    });
}, { immediate: true });
onMounted(() => {
    void plans.loadAll().catch((failure) => { error.value = String(failure); });
    calendars.loadConfiguration().catch(() => {
        // Only names and colours are wanted from it, and there are defaults for those.
    });
});
</script>

<style scoped>
.plan-view { flex: 1 1 0; min-width: 0; min-height: 0; }
.plan-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px; }
.plan-navigation { display: flex; align-items: center; }
.plan-range { flex: 1 0 auto; font-size: 1.1rem; }
.plan-body { display: flex; flex: 1; min-width: 0; min-height: 0; gap: 12px; padding: 8px; overflow: auto; }
.candidates { flex: none; width: 290px; }
.candidate-add, .candidate-search { margin-block: 4px; }
.candidate-estimate { font-size: 12px; margin-inline-start: 6px; }
.lent-dates { font-size: 12px; }
/* An estimate the task does not give itself is a guess, and is drawn as one. */
.assumed { font-style: italic; opacity: 0.7; }
.assumed::before { content: '~'; }

/* The days scroll under the candidates, which stay beside them; a window too narrow for seven
   columns scrolls the two together sideways. */
.days { flex: 1 1 0; min-height: 0; }
.weeks {
    display: grid;
    grid-template-columns: repeat(7, minmax(96px, 1fr));
    gap: 6px;
    align-content: start;
    min-width: 708px;
    overflow-y: auto;
}
/* A day is at least so tall by the room it keeps for its tasks, not by a least height of its own
   or its row's: a row holds to either when the weeks are taller than the view, and a day's tasks
   then spill into the week below. */
.weeks .entries { min-height: 72px; }
.weekday {
    position: sticky;
    top: 0;
    z-index: 1;
    font-size: 12px;
    text-align: center;
    background: rgb(var(--v-theme-background));
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.one-day { display: flex; gap: 12px; min-width: 620px; }
.one-day .day { flex: none; width: 300px; overflow-y: auto; }

.day {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 4px;
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 4px;
}
.day.today { border: 2px solid rgb(var(--v-theme-primary)); }
.day.past { background: rgba(var(--v-theme-on-surface), 0.04); }
.day-header { display: flex; flex-wrap: wrap; align-items: center; column-gap: 4px; }
.day-title { font-weight: 600; padding: 0 2px; border: 0; border-radius: 4px; background: none; color: inherit; }
.day-title:not(:disabled):hover { background: rgba(var(--v-theme-on-surface), 0.08); }
.one-day .day-title { font-size: 1.2em; }
.day-load { margin-inline-start: auto; font-size: 12px; text-align: end; color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.day-load.over { color: rgb(var(--v-theme-error)); font-weight: 600; }
.day-meter { height: 3px; margin-block: 2px 4px; border-radius: 2px; background: rgba(var(--v-theme-on-surface), 0.1); overflow: hidden; }
.day-meter-fill { height: 100%; background: rgb(var(--v-theme-primary)); }
.day-meter-fill.over { background: rgb(var(--v-theme-error)); }
.day-banner {
    margin-bottom: 2px;
    padding: 0 4px;
    border-radius: 3px;
    font-size: 12px;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.day-header, .day-meter, .day-banner, .day-task-date, .day-event, .day-more { flex: none; }
.day-more { padding: 0; border: 0; background: none; font-size: 12px; text-align: start; color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.day-more:hover { text-decoration: underline; }
.day-task-date, .day-event { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.day-task-date { font-weight: 600; }
.day-event { color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.day-event-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.day-event-time { font-variant-numeric: tabular-nums; }

/* As tall as what is left of its day, so a task dropped below the last entry, or onto an empty
   day, still lands in the list. */
.task-list { display: flex; flex-direction: column; flex: 1 0 auto; min-height: 28px; }
.candidate-list { min-height: 0; }
.candidate-list .task-list-entry:not(:last-child) { padding-bottom: 16px; }
.entries { margin-top: 4px; }
.entries .task-list-entry:not(:last-child) { padding-bottom: 3px; }
.plan-entry {
    display: block;
    width: 100%;
    padding: 2px 4px;
    border: 0;
    border-radius: 4px;
    color: inherit;
    font-size: 13px;
    line-height: 1.3;
    text-align: start;
    background: rgb(var(--v-theme-surface));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    -webkit-touch-callout: none;
}
.one-day .plan-entry { padding: 6px 8px; font-size: 14px; }
.plan-entry-head { display: flex; align-items: center; gap: 4px; }
.plan-entry-title { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.one-day .plan-entry-title { white-space: normal; }
/* When the day's pouring comes to it and how long it takes, under its title: a day's column in
   four weeks is too narrow to hold them beside it. */
.plan-entry-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 6px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.plan-entry.finished { opacity: 0.6; }
.plan-entry.over .plan-entry-meta { color: rgb(var(--v-theme-error)); font-weight: 600; }

.timeline { flex: 1 1 0; min-width: 280px; overflow-y: auto; padding: 8px 4px; }
.timeline-track { position: relative; }
.timeline-shade { position: absolute; inset-inline: 0; background: rgba(var(--v-theme-on-surface), 0.06); }
.timeline-hour { position: absolute; inset-inline: 0; border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.timeline-hour span { position: absolute; top: -0.7em; font-size: 11px; padding-inline-end: 4px; background: rgb(var(--v-theme-background)); color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.timeline-event, .timeline-task {
    position: absolute;
    padding: 0 4px;
    border-radius: 4px;
    font-size: 12px;
    line-height: 16px;
    overflow: hidden;
}
.timeline-event { color: #fff; }
.timeline-task {
    left: calc(45% + 28px);
    right: 0;
    border: 1px solid rgba(var(--v-theme-on-surface), 0.3);
    background: rgb(var(--v-theme-surface));
}
.timeline-task.assumed { border-style: dashed; font-style: normal; opacity: 1; }
.timeline-task.assumed::before { content: none; }
.timeline-task-time { font-variant-numeric: tabular-nums; color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.timeline-now { position: absolute; inset-inline: 0; border-top: 2px solid rgb(var(--v-theme-error)); }
.timeline-overflow { margin-top: 12px; font-size: 13px; }

.plan-view :deep(.task-list-item) { -webkit-touch-callout: none; }
.plan-view :deep(:is(.sortable-chosen, .sortable-chosen .v-card)) { --v-hover-opacity: 0; }
.plan-view :deep(:is(.sortable-ghost, .vacated)) { visibility: hidden; }
.sortable-drag :deep(.v-ripple__container) { display: none; }
/* Keep an ordered day slot open, while marking the destination as in Status. */
.dragging .day:has(.sortable-ghost) { outline: 2px solid rgb(var(--v-theme-primary)); }
.dragging :deep(:is(.task-list-item, .plan-entry)) { --v-hover-opacity: 0; cursor: inherit; }
.dragging :deep(:is(.task-list-item, .plan-entry) *) { pointer-events: none; }
</style>
