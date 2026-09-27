<template>
    <div class="eisenhower-matrix">
        <v-card
            v-for="quadrant of QUADRANTS"
            v-bind:key="quadrant.key"
            class="quadrant"
            v-bind:class="quadrant.class"
        >
            <v-card-title class="quadrant-header">
                <span class="quadrant-title">{{ quadrant.title }}</span>
                <span class="quadrant-subtitle">{{ quadrant.subtitle }}</span>
            </v-card-title>
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of eisenhowerQuadrants[quadrant.key]"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-bind:to="routeFor(task)"
                    v-bind:list-root="listRoot"
                />
            </div>
        </v-card>
    </div>
</template>

<script lang="ts" setup>
import type { RouteLocationRaw } from 'vue-router';

import { type TaskNode } from '@/task-forest';
import { type UUID } from '@/task';

// Props
defineProps<{
    eisenhowerQuadrants: {
        doFirst: TaskNode[];
        schedule: TaskNode[];
        delegate: TaskNode[];
        eliminate: TaskNode[];
    };
    routeFor: (task: TaskNode) => RouteLocationRaw;
    listRoot?: UUID;
}>();

// In the order the 2×2 grid places them: left to right, then top to bottom.
const QUADRANTS = [
    { key: 'doFirst', title: 'Do First', subtitle: 'Urgent & Important', class: 'urgent-important' },
    { key: 'schedule', title: 'Schedule', subtitle: 'Important, Not Urgent', class: 'important-not-urgent' },
    { key: 'delegate', title: 'Delegate', subtitle: 'Urgent, Not Important', class: 'urgent-not-important' },
    { key: 'eliminate', title: 'Eliminate', subtitle: 'Not Urgent, Not Important', class: 'not-urgent-not-important' },
] as const;
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

/* Mobile responsive adjustments for Eisenhower matrix */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .eisenhower-matrix {
        padding: $space / 2;
        gap: $space / 2;
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
