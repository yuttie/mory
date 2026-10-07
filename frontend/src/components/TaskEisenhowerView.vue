<template>
    <div class="eisenhower-matrix">
        <TaskGroup
            v-for="quadrant of QUADRANTS"
            v-bind:key="quadrant.key"
            class="quadrant"
            v-bind:class="quadrant.class"
            v-bind:title="quadrant.title"
            v-bind:subtitle="quadrant.subtitle"
        >
            <div class="task-list">
                <TaskListItemNext
                    v-for="task of eisenhowerQuadrants[quadrant.key]"
                    v-bind:key="task.uuid"
                    v-bind:value="task"
                    v-bind:to="routeFor(task)"
                    v-bind:list-root="listRoot"
                />
            </div>
        </TaskGroup>
    </div>
</template>

<script lang="ts" setup>
import type { RouteLocationRaw } from 'vue-router';

import { type TaskNode } from '@/task-forest';
import { type UUID } from '@/task';

// Props
defineProps<{
    eisenhowerQuadrants: {
        unrated: TaskNode[];
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
    { key: 'unrated', title: 'Unrated', subtitle: 'Choose importance when useful', class: 'unrated' },
    { key: 'doFirst', title: 'Do First', subtitle: 'Urgent & Important', class: 'urgent-important' },
    { key: 'schedule', title: 'Schedule', subtitle: 'Important, Not Urgent', class: 'important-not-urgent' },
    { key: 'delegate', title: 'Delegate', subtitle: 'Urgent, Not Important', class: 'urgent-not-important' },
    { key: 'eliminate', title: 'Eliminate', subtitle: 'Not Urgent, Not Important', class: 'not-urgent-not-important' },
] as const;
</script>

<style scoped lang="scss">
$space: 8px;

/* Eisenhower Matrix styles */
.eisenhower-matrix {
    flex: 1 1 0;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: minmax(48px, 1fr) repeat(2, minmax(0, 2fr));
    gap: 16px;
    padding: $space;
    height: 100%;
    min-height: 0;
}

.unrated { grid-column: 1 / -1; }

/* Mobile responsive adjustments for Eisenhower matrix */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .eisenhower-matrix {
        padding: $space / 2;
        gap: $space / 2;
    }

    .quadrant :deep(.task-group-subtitle) {
        display: none;
    }
}

/* A quadrant is far wider than a column of the Status view, so its cards are laid out in as many
   columns as fit, each about as wide as a Status column. */
.task-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr));
    gap: 16px;
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
