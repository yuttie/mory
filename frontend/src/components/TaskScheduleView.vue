<template>
    <div
        class="planning-view d-flex flex-column"
        v-bind:class="{ dragging: draggedFrom !== null }"
    >
        <div
            class="planning-toolbar"
            role="toolbar"
            aria-label="Week planning"
        >
            <div class="week-navigation">
                <v-btn
                    v-bind:disabled="busy"
                    v-on:click="week = week.subtract(1, 'day')"
                >
                    Previous
                </v-btn>
                <v-btn
                    v-bind:disabled="busy"
                    v-on:click="week = dayjs().startOf('day')"
                >
                    Today
                </v-btn>
                <v-btn
                    v-bind:disabled="busy"
                    v-on:click="week = week.add(1, 'day')"
                >
                    Next
                </v-btn>
            </div>
            <div class="week-range">{{ dates[0] }} – {{ dates[6] }}</div>
            <v-btn
                v-bind:disabled="busy"
                v-on:click="run(collect)"
            >
                Collect undone
            </v-btn>
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
        <div class="day-columns">
            <TaskGroup
                class="day candidates"
                v-bind:class="{ origin: draggedFrom === 'candidates' }"
                title="Candidate tasks"
                subtitle="Drag onto a day to plan work"
            >
                <template #header>
                    <TaskSearchField
                        v-model="searched"
                        class="candidate-search"
                        label="Search candidates"
                        v-bind:delay="250"
                    />
                </template>
                <!-- Above the list, not in its header slot: Sortable would make it draggable. -->
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
            <TaskGroup
                v-for="date of dates"
                v-bind:key="date"
                class="day"
                v-bind:class="{ today: date === dayjs().format('YYYY-MM-DD'), origin: draggedFrom === date }"
            >
                <template #title>
                    {{ date }}<small class="ml-2">{{ dayjs(date).format('ddd') }}</small>
                </template>
                <template #header>
                    <v-btn
                        variant="text"
                        size="small"
                        v-bind:disabled="busy"
                        v-on:click="interruptionDate = date; interruptionTask = null"
                    >
                        Record interruption
                    </v-btn>
                </template>
                <draggable
                    class="task-list entries"
                    v-bind:data-date="date"
                    filter="button, input, .v-selection-control"
                    v-bind:prevent-on-filter="false"
                    v-bind:model-value="plans.days[date] ?? []"
                    item-key="task"
                    v-bind:group="DAY_GROUP"
                    v-bind:clone="(entry: PlanEntry) => cloneEntry(entry, date)"
                    v-bind:move="canDrop"
                    v-bind:disabled="busy"
                    v-bind:force-fallback="true"
                    v-bind:fallback-on-body="true"
                    v-bind:delay="500"
                    v-bind:delay-on-touch-only="true"
                    v-on:start="draggedFrom = date"
                    v-on:end="draggedFrom = null"
                    v-on:clone="onClone"
                    v-on:change="onDayChange(date, $event)"
                >
                    <template #item="{ element: entry }">
                        <div class="task-list-entry">
                            <v-card
                                class="planned-entry"
                                draggable="false"
                                v-bind:class="{ 'text-disabled': !taskOf(entry.task) || !tasks.ownUrgency(taskOf(entry.task)?.uuid ?? entry.task).actionable }"
                                v-bind:style="{ backgroundColor: statusGround(taskOf(entry.task)?.metadata?.task?.status?.kind, taskSettings.resolvedStatusColors) }"
                                v-on:pointerdown="onPointerDown"
                                v-on:contextmenu="onContextMenu"
                            >
                                <TaskListItemNext
                                    v-if="taskOf(entry.task)"
                                    class="planned-task"
                                    variant="text"
                                    draggable="false"
                                    v-bind:value="taskOf(entry.task)!"
                                    v-bind:to="routeFor(taskOf(entry.task)!)"
                                    v-bind:list-root="listRoot"
                                >
                                    <div class="plan-record">
                                        <small>{{ entry.origin }} · {{ entry.result ?? 'unrecorded' }}</small>
                                    </div>
                                </TaskListItemNext>
                                <div
                                    v-else
                                    class="pa-2"
                                >
                                    <div>Unknown task {{ entry.task }}</div>
                                    <small>{{ entry.origin }} · {{ entry.result ?? 'unrecorded' }}</small>
                                </div>
                                <div class="plan-actions">
                                    <v-checkbox-btn
                                        class="plan-control"
                                        v-bind:model-value="entry.result === 'worked'"
                                        v-bind:disabled="busy || !taskOf(entry.task)"
                                        label="Worked"
                                        title="Worked on this day"
                                        v-on:update:model-value="run(() => plans.recordResult(date, entry.task, $event ? 'worked' : undefined))"
                                    />
                                    <v-btn
                                        v-if="taskOf(entry.task) && !['done', 'canceled'].includes(taskOf(entry.task)?.metadata?.task?.status?.kind ?? '')"
                                        variant="text"
                                        size="x-small"
                                        v-bind:disabled="busy"
                                        v-on:click="run(() => complete(date, entry.task))"
                                    >
                                        Complete task
                                    </v-btn>
                                    <v-btn
                                        v-if="entry.origin === 'planned'"
                                        variant="text"
                                        size="x-small"
                                        v-bind:disabled="busy"
                                        v-on:click="run(() => plans.recordResult(date, entry.task, 'missed'))"
                                    >
                                        Missed
                                    </v-btn>
                                    <v-btn
                                        variant="text"
                                        size="x-small"
                                        v-bind:disabled="busy"
                                        v-on:click="run(() => plans.unplanTask(date, entry.task))"
                                    >
                                        Remove
                                    </v-btn>
                                </div>
                            </v-card>
                        </div>
                    </template>
                </draggable>
            </TaskGroup>
        </div>
        <v-dialog
            v-bind:model-value="interruptionDate !== null"
            v-bind:persistent="busy"
            max-width="550"
            v-on:update:model-value="!$event && (interruptionDate = null)"
        >
            <v-card title="Record interruption">
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
import type { TaskNode } from '@/task-forest';
import { makeDefaultStatus } from '@/task';
import type { PlanEntry } from '@/plans';
import { useTasksStore } from '@/stores/tasks';
import { usePlansStore } from '@/stores/plans';
import { useTaskSettingsStore } from '@/stores/taskSettings';
import { statusGround } from '@/status-color';
import { LENT_FIELDS, usePlanCandidates } from '@/composables/planCandidates';

const props = defineProps<{
    candidates: TaskNode[];
    routeFor: (task: TaskNode) => RouteLocationRaw;
    listRoot?: string;
}>();
const CANDIDATE_GROUP = { name: 'plans', pull: 'clone', put: false };
const DAY_GROUP = { name: 'plans', pull: true, put: true };
const tasks = useTasksStore();
const plans = usePlansStore();
const taskSettings = useTaskSettingsStore();
const week = ref(dayjs().startOf('day'));
const dates = computed(() => Array.from({ length: 7 }, (_, index) => week.value.add(index, 'day').format('YYYY-MM-DD')));
const busy = ref(false);
const error = ref('');
const draggedFrom = ref<string | null>(null);
const interruptionDate = ref<string | null>(null);
const interruptionTask = ref<string | null>(null);
const taskOf = (uuid: string) => tasks.allTasks.find((task) => task.uuid.toLowerCase() === uuid.toLowerCase());
const { searched, terms, shown: shownCandidates, lenders } = usePlanCandidates(() => props.candidates, () => props.listRoot);
const cloneTask = (task: TaskNode): PlanEntry => ({ task: task.uuid.toLowerCase(), origin: 'planned' });
interface DraggedPlanEntry extends PlanEntry {
    sourceDate?: string;
}
// Carry the source with the drag, since Sortable's end event clears the view's drag state.
const cloneEntry = (entry: PlanEntry, sourceDate: string): DraggedPlanEntry => ({ ...entry, sourceDate });
function canDrop(event: { from: HTMLElement; to: HTMLElement; draggedContext: { element: TaskNode | PlanEntry } }): boolean {
    if (event.from === event.to) {
        return true;
    }
    const date = event.to.dataset.date;
    const element = event.draggedContext.element;
    const uuid = 'task' in element ? element.task : element.uuid.toLowerCase();
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
        error.value = String(failure);
    }
    finally {
        busy.value = false;
    }
}
function onDayChange(date: string, event: { added?: { element: DraggedPlanEntry; newIndex: number }; moved?: { element: PlanEntry; newIndex: number } }): void {
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
            const current = ordered.indexOf(event.moved.element.task);
            if (current === -1) {
                throw new Error('The plan changed during reordering. Reload and retry.');
            }
            const [uuid] = ordered.splice(current, 1);
            ordered.splice(event.moved.newIndex, 0, uuid);
            await plans.reorder(date, ordered);
        }
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
    await plans.collect(dayjs().format('YYYY-MM-DD'), (uuid) => {
        const task = taskOf(uuid);
        return task ? task.metadata?.task?.status?.kind ?? 'backlog' : undefined;
    });
}
// Read when the months shown change, not at every step. A read holds the controls disabled for its
// round trip, so a day at a time it would drop the next click on nearly every step, and the store
// already reads each month it holds again at every commit.
const shownMonths = computed(() => [...new Set(dates.value.map((date) => date.slice(0, 7)))]);
watch(() => shownMonths.value.join(), () => { void run(() => plans.loadMonths(shownMonths.value)); }, { immediate: true });
onMounted(() => { void plans.loadAll().catch((failure) => { error.value = String(failure); }); });
</script>

<style scoped>
.planning-view { flex: 1 1 0; min-width: 0; min-height: 0; }
.planning-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px; }
.week-navigation { display: flex; }
.week-range { flex: 1 0 auto; font-size: 1.1rem; }
.day-columns { display: flex; flex: 1; min-width: 0; min-height: 0; gap: 16px; padding: 8px; overflow: auto; }
.day { flex-shrink: 0; width: 250px; }
.candidates { width: 290px; }
.candidate-search { margin-block: 4px; }
.lent-dates { font-size: 12px; }
.today { border: 2px solid rgb(var(--v-theme-primary)); border-radius: 4px; }
/* As tall as its day at least, so a task dropped below the last entry, or onto an empty day,
   still lands in the list. */
.task-list {
    min-height: 100%;
    display: flex;
    flex-direction: column;
}
/* At least as tall as the column, the list would overflow it by the height of the message above
   it saying none match. The candidates take no drop (`put: false`), so it needs no such height. */
.candidate-list {
    min-height: 0;
}
/* The space between two cards is the upper one's entry's, not a gap of the list's: Sortable takes a
   task held over another, or past either end of the list, and one held over the list itself
   anywhere else goes nowhere. */
.task-list-entry:not(:last-child) {
    padding-bottom: 16px;
}
/* The task's card is drawn flat inside the entry's and left unpositioned, so its link's cover and
   its hover shade reach over the whole entry rather than its own part of it. Important because
   Vuetify's ripple positions the card while it plays: a press would land on the cover and the
   release outside it, and the click would go to neither. */
.planned-entry :deep(.planned-task) {
    position: static !important;
}
/* A real link keeps keyboard/new-tab navigation while covering the entry's unused space. */
.planned-entry :deep(.planned-task::after) {
    content: '';
    position: absolute;
    inset: 0;
}
.plan-actions { display: flex; flex-wrap: wrap; align-items: center; padding: 0 4px 4px; }
/* Controls stay outside the link and above its extended click area. */
.plan-control, .plan-actions :deep(button), .planned-entry :deep(.task-date-cue) {
    position: relative;
    z-index: 1;
}
.planning-view :deep(:is(.task-list-item, .planned-entry)) {
    -webkit-touch-callout: none;
}
/* The hover shade is the card's overlay, drawn at this opacity. Every card sets the opacity again
   for itself, through the class of its theme, so it is unset on each card in the one pressed: a
   planned entry's own and the task's inside it. */
.planning-view :deep(:is(.sortable-chosen, .sortable-chosen .v-card)) {
    --v-hover-opacity: 0;
}
.planning-view :deep(:is(.sortable-ghost, .vacated)) {
    visibility: hidden;
}
/* Sortable's copy that follows the pointer keeps the ripple of the press that picked it up, which
   nothing would ever fade there. */
.sortable-drag :deep(.v-ripple__container) {
    display: none;
}
/* Keep an ordered day slot open, while marking the destination as in Status. */
.dragging .day:not(.candidates):has(.sortable-ghost) {
    outline: 2px solid rgb(var(--v-theme-primary));
}
.dragging :deep(:is(.task-list-item, .planned-entry)) {
    --v-hover-opacity: 0;
    cursor: inherit;
}
.dragging :deep(:is(.task-list-item, .planned-entry) *) {
    pointer-events: none;
}
</style>
