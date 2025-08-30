<template>
    <div class="eisenhower-matrix">
        <v-card class="quadrant urgent-important">
            <v-card-title class="quadrant-header">
                <span class="quadrant-title">Do First</span>
                <span class="quadrant-subtitle">Urgent & Important</span>
            </v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of eisenhowerQuadrants.doFirst"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-on:click="onTaskClick(task.uuid)"
                />
            </div>
        </v-card>
        <v-card class="quadrant important-not-urgent">
            <v-card-title class="quadrant-header">
                <span class="quadrant-title">Schedule</span>
                <span class="quadrant-subtitle">Important, Not Urgent</span>
            </v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of eisenhowerQuadrants.schedule"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-on:click="onTaskClick(task.uuid)"
                />
            </div>
        </v-card>
        <v-card class="quadrant urgent-not-important">
            <v-card-title class="quadrant-header">
                <span class="quadrant-title">Delegate</span>
                <span class="quadrant-subtitle">Urgent, Not Important</span>
            </v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of eisenhowerQuadrants.delegate"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-on:click="onTaskClick(task.uuid)"
                />
            </div>
        </v-card>
        <v-card class="quadrant not-urgent-not-important">
            <v-card-title class="quadrant-header">
                <span class="quadrant-title">Eliminate</span>
                <span class="quadrant-subtitle">Not Urgent, Not Important</span>
            </v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of eisenhowerQuadrants.eliminate"
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
    eisenhowerQuadrants: {
        doFirst: TreeNodeRecord[];
        schedule: TreeNodeRecord[];
        delegate: TreeNodeRecord[];
        eliminate: TreeNodeRecord[];
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
$space: 12px;

/* Eisenhower Matrix styles */
.eisenhower-matrix {
    flex: 1 1 0;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: $space;
    padding: $space;
    height: 100%;
}

.matrix-row {
    display: flex;
    gap: $space;
    flex: 1 1 0;
}

/* Mobile responsive adjustments for Eisenhower matrix */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .eisenhower-matrix {
        padding: $space / 2;
        gap: $space / 2;
    }

    .matrix-row {
        flex-direction: column;
        flex: none;
    }
}

.quadrant {
    display: flex;
    flex-direction: column;
    max-height: 100%;
    overflow: auto;
}

/* Mobile responsive adjustments for quadrants */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .quadrant-subtitle {
        display: none;
    }
}

.quadrant-header {
    flex-direction: column;
    align-items: flex-start !important;
    padding-bottom: 8px;
}

.quadrant-title {
    font-weight: 600;
    font-size: 1.1em;
}

.quadrant-subtitle {
    font-size: 0.85em;
    color: rgba(0, 0, 0, 0.6);
    font-weight: 400;
}

.task-list {
    overflow-y: auto;
}

/* Color coding for quadrants */
.urgent-important {
    border-left: 4px solid #f44336; /* Red - Critical */
}

.important-not-urgent {
    border-left: 4px solid #2196f3; /* Blue - Important */
}

.urgent-not-important {
    border-left: 4px solid #ff9800; /* Orange - Delegate */
}

.not-urgent-not-important {
    border-left: 4px solid #9e9e9e; /* Gray - Eliminate */
}
</style>
