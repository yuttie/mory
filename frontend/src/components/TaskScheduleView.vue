<template>
    <div class="planning-view d-flex flex-column">
        <v-toolbar density="compact" color="transparent">
            <v-btn v-bind:disabled="busy" v-on:click="week = week.subtract(7, 'day')">Previous</v-btn>
            <v-btn v-bind:disabled="busy" v-on:click="week = dayjs().startOf('day')">Today</v-btn>
            <v-btn v-bind:disabled="busy" v-on:click="week = week.add(7, 'day')">Next</v-btn>
            <v-toolbar-title>{{ dates[0] }} – {{ dates[6] }}</v-toolbar-title>
            <v-btn v-bind:disabled="busy" v-on:click="run(collect)">Collect undone</v-btn>
        </v-toolbar>
        <v-alert v-if="error" type="error" closable v-on:click:close="error = ''">{{ error }}</v-alert>
        <v-alert v-for="[month, problem] of Object.entries(plans.errors)" v-bind:key="month" type="warning">{{ month }}: {{ problem }}</v-alert>
        <div class="day-columns">
            <v-card class="day candidates">
                <v-card-title>Candidate tasks</v-card-title>
                <v-card-subtitle>Drag onto a day to plan work</v-card-subtitle>
                <draggable v-bind:model-value="candidates" item-key="uuid" handle=".plan-drag-handle" v-bind:group="CANDIDATE_GROUP" v-bind:clone="cloneTask" v-bind:sort="false" v-bind:disabled="busy" v-bind:force-fallback="true" v-bind:fallback-on-body="true" v-bind:delay="200" v-bind:delay-on-touch-only="true">
                    <template v-slot:item="{ element: task }">
                        <div class="candidate">
                            <div class="d-flex align-center">
                                <span class="plan-drag-handle" title="Drag onto a day"><v-icon v-bind:icon="mdiDragVertical"></v-icon></span>
                                <TaskListItemNext draggable="false" v-bind:value="task" v-bind:to="routeFor(task)" v-bind:list-root="listRoot"></TaskListItemNext>
                            </div>
                            <small v-if="plans.missedCount(task.uuid) >= 3" class="text-warning">Missed {{ plans.missedCount(task.uuid) }} times: consider splitting or re-rating importance</small>
                        </div>
                    </template>
                </draggable>
            </v-card>
            <v-card v-for="date of dates" v-bind:key="date" class="day" v-bind:class="{ today: date === dayjs().format('YYYY-MM-DD') }">
                <v-card-title>{{ date }}<small class="ml-2">{{ dayjs(date).format('ddd') }}</small></v-card-title>
                <v-btn variant="text" size="small" v-bind:disabled="busy" v-on:click="interruptionDate = date; interruptionTask = null">Record interruption</v-btn>
                <draggable class="entries" v-bind:model-value="plans.days[date] ?? []" item-key="task" v-bind:group="DAY_GROUP" v-bind:clone="cloneEntry" v-bind:disabled="busy" v-bind:force-fallback="true" v-bind:fallback-on-body="true" v-bind:delay="200" v-bind:delay-on-touch-only="true" v-on:update:model-value="replaceDay(date, $event)">
                    <template v-slot:item="{ element: entry }">
                        <div class="planned-entry pa-2" v-bind:class="{ 'text-disabled': !taskOf(entry.task) || !tasks.ownUrgency(taskOf(entry.task)?.uuid ?? entry.task).actionable }">
                            <div class="d-flex align-center">
                                <v-checkbox-btn v-bind:model-value="entry.result === 'worked'" v-bind:disabled="busy || !taskOf(entry.task)" title="Worked on this day" v-on:update:model-value="run(() => plans.recordResult(date, entry.task, $event ? 'worked' : undefined))"></v-checkbox-btn>
                                <router-link draggable="false" v-if="taskOf(entry.task)" v-bind:to="routeFor(taskOf(entry.task)!)">{{ taskOf(entry.task)?.title || 'Untitled' }}</router-link>
                                <span v-else>Unknown task {{ entry.task }}</span>
                            </div>
                            <small>{{ entry.origin }} · {{ entry.result ?? 'unrecorded' }}</small>
                            <div>
                                <v-btn v-if="taskOf(entry.task) && !['done', 'canceled'].includes(taskOf(entry.task)?.metadata?.task?.status?.kind ?? '')" variant="text" size="x-small" v-bind:disabled="busy" v-on:click="run(() => complete(date, entry.task))">Complete task</v-btn>
                                <v-btn v-if="entry.origin === 'planned'" variant="text" size="x-small" v-bind:disabled="busy" v-on:click="run(() => plans.recordResult(date, entry.task, 'missed'))">Missed</v-btn>
                                <v-btn variant="text" size="x-small" v-bind:disabled="busy" v-on:click="run(() => plans.unplanTask(date, entry.task))">Remove</v-btn>
                            </div>
                        </div>
                    </template>
                </draggable>
            </v-card>
        </div>
        <v-dialog v-bind:model-value="interruptionDate !== null" max-width="550" v-on:update:model-value="!$event && (interruptionDate = null)">
            <v-card title="Record interruption">
                <v-card-text>
                    <v-autocomplete v-model="interruptionTask" v-bind:items="tasks.allTasks" item-title="title" item-value="uuid" label="Task worked on" clearable></v-autocomplete>
                </v-card-text>
                <v-card-actions>
                    <v-btn v-on:click="interruptionDate = null">Cancel</v-btn>
                    <v-btn v-bind:disabled="!interruptionTask || busy" v-on:click="run(recordInterruption)">Record worked</v-btn>
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
import { mdiDragVertical } from '@mdi/js';
import type { TaskNode } from '@/task-forest';
import { makeDefaultStatus } from '@/task';
import { readImportance, isUrgent, compareUrgency } from '@/urgency';
import type { PlanEntry } from '@/plans';
import { useTasksStore } from '@/stores/tasks';
import { usePlansStore } from '@/stores/plans';

const props = defineProps<{
    candidates: TaskNode[];
    routeFor: (task: TaskNode) => RouteLocationRaw;
    listRoot?: string;
}>();
const CANDIDATE_GROUP = { name: 'plans', pull: 'clone', put: false };
const DAY_GROUP = { name: 'plans', pull: 'clone', put: true };
const tasks = useTasksStore();
const plans = usePlansStore();
const week = ref(dayjs().startOf('day'));
const dates = computed(() => Array.from({ length: 7 }, (_, index) => week.value.add(index, 'day').format('YYYY-MM-DD')));
const busy = ref(false);
const error = ref('');
const interruptionDate = ref<string | null>(null);
const interruptionTask = ref<string | null>(null);
const taskOf = (uuid: string) => tasks.allTasks.find((task) => task.uuid.toLowerCase() === uuid.toLowerCase());
function quadrant(task: TaskNode): number {
    const importance = readImportance(task.metadata?.task?.importance);
    if (!importance) {
        return 4;
    }
    const important = importance === 'medium' || importance === 'high';
    return important ? (isUrgent(tasks.urgency(task.uuid)) ? 0 : 1) : (isUrgent(tasks.urgency(task.uuid)) ? 2 : 3);
}
const candidates = computed(() => props.candidates.filter((task) => tasks.ownUrgency(task.uuid).actionable && !['done', 'canceled'].includes(task.metadata?.task?.status?.kind ?? '')).sort((a, b) => quadrant(a) - quadrant(b) || compareUrgency(tasks.urgency(a.uuid), tasks.urgency(b.uuid)) || a.uuid.localeCompare(b.uuid)));
const cloneTask = (task: TaskNode): PlanEntry => ({ task: task.uuid.toLowerCase(), origin: 'planned' });
const cloneEntry = (entry: PlanEntry): PlanEntry => ({ task: entry.task, origin: 'planned' });
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
        error.value = String(failure);
    }
    finally {
        busy.value = false;
    }
}
function replaceDay(date: string, entries: PlanEntry[]): void {
    void run(async () => {
        const unique = [...new Map(entries.map((entry) => [entry.task, entry])).values()];
        const existing = plans.days[date] ?? [];
        for (const entry of unique) {
            if (!existing.some((item) => item.task === entry.task)) {
                await plans.planTask(date, entry.task);
            }
        }
        await plans.reorder(date, unique.map((entry) => entry.task));
    });
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
async function recordInterruption(): Promise<void> {
    if (interruptionDate.value && interruptionTask.value) {
        await plans.planTask(interruptionDate.value, interruptionTask.value, 'interruption');
        // An already planned task keeps its origin but still records that work happened.
        await plans.recordResult(interruptionDate.value, interruptionTask.value, 'worked');
        interruptionDate.value = null;
    }
}
async function collect(): Promise<void> {
    await plans.collect(dayjs().format('YYYY-MM-DD'), (uuid) => {
        const task = taskOf(uuid);
        return task ? task.metadata?.task?.status?.kind ?? 'backlog' : undefined;
    });
}
watch(dates, () => { void run(() => plans.loadMonths(dates.value.map((date) => date.slice(0, 7)))); }, { immediate: true });
onMounted(() => { void plans.loadAll().catch((failure) => { error.value = String(failure); }); });
</script>

<style scoped>
.planning-view { height: 100%; min-height: 0; }
.day-columns { display: flex; flex: 1; min-height: 0; gap: 12px; padding: 12px; overflow: auto; }
.day { display: flex; flex-direction: column; min-width: 250px; width: 250px; flex-shrink: 0; overflow-y: auto; }
.candidates { width: 290px; }
.entries { flex: 1; min-height: 140px; }
.today { border: 2px solid rgb(var(--v-theme-primary)); }
.planned-entry { border-top: 1px solid rgba(128, 128, 128, .3); }
.planned-entry a { color: inherit; }
.plan-drag-handle { cursor: grab; touch-action: none; }
</style>
