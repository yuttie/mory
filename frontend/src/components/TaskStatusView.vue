<template>
    <div
        class="status-view groups"
        v-bind:class="{ dragging: draggedFrom !== null }"
    >
        <v-card
            v-for="column of COLUMNS"
            v-bind:key="column.kind"
            class="group"
            v-bind:class="{
                origin: column.kind === draggedFrom,
                refused: draggedFrom !== null && !accepts(draggedFrom, column.kind),
            }"
        >
            <v-card-title>{{ STATUS_LABEL[column.kind] }}</v-card-title>
            <!-- `model-value` rather than `list`: the lists are derived from the listing, so a drop
                 is reported and the parent writes it; nothing here moves a task itself.
                 `force-fallback` because Sortable scrolls near an edge only for a drag it runs
                 itself. A native drag leaves that to the browser, and a touch drag in a browser
                 that has native ones is scrolled by neither -- and on a phone each column is the
                 width of the screen, so no other column could be reached. -->
            <draggable
                class="task-list"
                item-key="uuid"
                v-bind:model-value="taskStatuses[column.key]"
                v-bind:group="{ name: 'tasks', put: () => draggedFrom !== null && accepts(draggedFrom, column.kind) }"
                v-bind:sort="false"
                v-bind:force-fallback="true"
                v-bind:delay="500"
                v-bind:delay-on-touch-only="true"
                v-on:start="draggedFrom = column.kind"
                v-on:end="draggedFrom = null"
                v-on:change="onChange(column.kind, $event)"
            >
                <template v-slot:item="{ element: task }">
                    <TaskListItemNext
                        v-bind:value="task"
                        v-on:click="onTaskClick(task.uuid)"
                    />
                </template>
            </draggable>
        </v-card>
        <v-dialog
            v-bind:model-value="awaitingReason !== null"
            max-width="400px"
            v-on:update:model-value="awaitingReason = null"
        >
            <v-card v-if="awaitingReason !== null">
                <v-form v-on:submit.prevent="onReasonSubmit">
                    <v-card-title>Move to {{ STATUS_LABEL[awaitingReason.kind] }}</v-card-title>
                    <v-card-subtitle>{{ awaitingReason.task.title }}</v-card-subtitle>
                    <v-card-text>
                        <v-text-field
                            v-model="reason"
                            v-bind:label="REASON_LABEL[awaitingReason.kind]"
                            autofocus
                        />
                    </v-card-text>
                    <v-card-actions>
                        <v-spacer />
                        <v-btn
                            variant="text"
                            v-on:click="awaitingReason = null"
                        >
                            Cancel
                        </v-btn>
                        <v-btn
                            type="submit"
                            color="primary"
                            v-bind:disabled="reason.trim() === ''"
                        >
                            Move
                        </v-btn>
                    </v-card-actions>
                </v-form>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import draggable from 'vuedraggable';
import dayjs from 'dayjs';

import { type TaskNode } from '@/task-forest';
import { type UUID, type Status, type StatusKind, STATUS_LABEL, canTransition, makeDefaultStatus } from '@/task';

type TaskStatuses = {
    backlog: TaskNode[];
    todo: TaskNode[];
    inProgress: TaskNode[];
    waiting: TaskNode[];
    blocked: TaskNode[];
    onHold: TaskNode[];
    done: TaskNode[];
    canceled: TaskNode[];
};

// The columns, left to right, and the list each one draws.
const COLUMNS: { kind: StatusKind; key: keyof TaskStatuses }[] = [
    { kind: 'backlog', key: 'backlog' },
    { kind: 'todo', key: 'todo' },
    { kind: 'in_progress', key: 'inProgress' },
    { kind: 'waiting', key: 'waiting' },
    { kind: 'blocked', key: 'blocked' },
    { kind: 'on_hold', key: 'onHold' },
    { kind: 'done', key: 'done' },
    { kind: 'canceled', key: 'canceled' },
];

// The statuses the schema will not take without a reason, labelled as the editor labels them.
const REASON_LABEL: Partial<Record<StatusKind, string>> = {
    waiting: 'Waiting for',
    blocked: 'Blocked by',
    on_hold: 'Hold reason',
    canceled: 'Cancel reason',
};

// Props
defineProps<{
    taskStatuses: TaskStatuses;
}>();

// Emits
const emit = defineEmits<{
    (e: 'task-click', taskUuid: UUID): void;
    (e: 'status-change', task: TaskNode, status: Status): void;
}>();

// Reactive states
// The column a drag started in. Its kind stands for the task's status, since that is the column
// the status put it in; only the kind decides a transition.
const draggedFrom = ref<StatusKind | null>(null);
const awaitingReason = ref<{ task: TaskNode; kind: StatusKind } | null>(null);
const reason = ref('');

// Methods
function onTaskClick(taskUuid: UUID) {
    emit('task-click', taskUuid);
}

// A drop obeys the transitions the editor offers while locked. Unlocking is an exception made
// deliberately, one edit at a time, so reopening a finished task stays the editor's to do.
function accepts(from: StatusKind, to: StatusKind): boolean {
    return canTransition({ kind: from } as Status, to);
}

function onChange(kind: StatusKind, event: { added?: { element: TaskNode } }) {
    // A drop reports `removed` on the column it left and `added` on the one it reached; one is
    // enough.
    const task = event.added?.element;
    if (task === undefined) {
        return;
    }
    if (REASON_LABEL[kind] === undefined) {
        emit('status-change', task, statusFor(kind, ''));
    }
    else {
        reason.value = '';
        awaitingReason.value = { task, kind };
    }
}

function onReasonSubmit() {
    const awaiting = awaitingReason.value;
    if (awaiting === null || reason.value.trim() === '') {
        return;
    }
    emit('status-change', awaiting.task, statusFor(awaiting.kind, reason.value.trim()));
    awaitingReason.value = null;
}

function statusFor(kind: StatusKind, reason: string): Status {
    // Stamped as the editor stamps a status it switches to.
    const now = dayjs().format().replace('T', ' ');
    const status = makeDefaultStatus(kind);
    switch (status.kind) {
        case 'waiting': status.waiting_for = reason; break;
        case 'blocked': status.blocked_by = reason; break;
        case 'on_hold': status.hold_reason = reason; break;
        case 'done': status.completed_at = now; break;
        case 'canceled': status.canceled_at = now; status.cancel_reason = reason; break;
    }
    return status;
}
</script>

<style scoped lang="scss">
$group-width: 270px;
$space: 12px;

.groups {
    flex: 1 1 0;
    display: flex;
    flex-direction: row;
    width: 0;
    height: 100%;
    overflow-x: auto;
    gap: $space;
    padding: $space;
}

.group {
    flex-grow: 0;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-self: flex-start;
    max-height: 100%;
    width: $group-width;
}

/* Mobile responsive adjustments for groups */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .groups {
        padding: $space / 2;
        gap: $space / 2;
    }

    .group {
        flex-shrink: 0;
        flex-grow: 1;
        width: 100%;
    }
}

.task-list {
    overflow-y: auto;
}

/* Room to drop into, which an empty column otherwise does not have. Only while dragging, so a
   column at rest looks as it did, and not in the column the task came from, where a drop changes
   nothing: there it would be the task's empty place kept open. */
.dragging .group:not(.refused):not(.origin) .task-list {
    min-height: 32px;
}

.refused {
    opacity: 0.4;
}

/* A drop decides the column and nothing else, since each column is ordered by date. So the task
   being dragged leaves no gap anywhere: not between two tasks of a column it is held over, as if it
   could go there, and not where it was, as if it could go back to that place. A column it is held
   over is marked as a whole instead.
   Under `.dragging` because Sortable measures the task for the copy that follows the pointer
   before `.dragging` is drawn: hidden at that moment, the copy made from it would be zero-sized. */
.dragging :deep(.sortable-ghost) {
    display: none;
}

/* The copy that follows the pointer lives in the column it left, and each card stacks its own
   contents, so without this the columns after it would be drawn over it. */
.dragging .origin {
    z-index: 1;
}

/* That copy is drawn over other tasks, so it needs a ground of its own to be read against. */
.groups :deep(.task-list-item.sortable-drag) {
    background: rgb(var(--v-theme-surface));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.dragging .group:not(.origin):has(.sortable-ghost) {
    outline: 2px solid rgb(var(--v-theme-primary));
}
</style>
