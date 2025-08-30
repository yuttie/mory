<template>
    <div class="status-view groups">
        <v-card dense class="group">
            <v-card-title>To do</v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of taskStatuses.todo"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-on:click="onTaskClick(task.uuid)"
                />
            </div>
        </v-card>
        <v-card dense class="group">
            <v-card-title>In progress</v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of taskStatuses.inProgress"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-on:click="onTaskClick(task.uuid)"
                />
            </div>
        </v-card>
        <v-card dense class="group">
            <v-card-title>Waiting</v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of taskStatuses.waiting"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-on:click="onTaskClick(task.uuid)"
                />
            </div>
        </v-card>
        <v-card dense class="group">
            <v-card-title>Blocked</v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of taskStatuses.blocked"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-on:click="onTaskClick(task.uuid)"
                />
            </div>
        </v-card>
        <v-card dense class="group">
            <v-card-title>On hold</v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of taskStatuses.onHold"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-on:click="onTaskClick(task.uuid)"
                />
            </div>
        </v-card>
        <v-card dense class="group">
            <v-card-title>Done</v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of taskStatuses.done"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-on:click="onTaskClick(task.uuid)"
                />
            </div>
        </v-card>
        <v-card dense class="group">
            <v-card-title>Canceled</v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of taskStatuses.canceled"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-on:click="onTaskClick(task.uuid)"
                />
            </div>
        </v-card>
    </div>
</template>

<script lang="ts" setup>
import { type TreeNodeRecord } from '@/stores/taskForest';
import { type UUID } from '@/task';

// Props
const props = defineProps<{
    taskStatuses: {
        todo: TreeNodeRecord[];
        inProgress: TreeNodeRecord[];
        waiting: TreeNodeRecord[];
        blocked: TreeNodeRecord[];
        onHold: TreeNodeRecord[];
        done: TreeNodeRecord[];
        canceled: TreeNodeRecord[];
    };
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
