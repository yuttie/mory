<template>
    <div class="status-view groups">
        <v-card
            v-for="column of COLUMNS"
            v-bind:key="column.kind"
            class="group"
        >
            <v-card-title>{{ STATUS_LABEL[column.kind] }}</v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of taskStatuses[column.key]"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-on:click="onTaskClick(task.uuid)"
                />
            </div>
        </v-card>
    </div>
</template>

<script lang="ts" setup>
import { type TaskNode } from '@/task-forest';
import { type UUID, type StatusKind, STATUS_LABEL } from '@/task';

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

// Props
const props = defineProps<{
    taskStatuses: TaskStatuses;
}>();

// Emits
const emit = defineEmits<{
    (e: 'task-click', taskUuid: UUID): void;
}>();

// Methods
function onTaskClick(taskUuid: UUID) {
    emit('task-click', taskUuid);
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
</style>
