<template>
    <div class="schedule-view groups">
        <v-card class="group">
            <v-card-title>Scheduled</v-card-title>
            <div class="task-list">
                <div
                    v-for="[date, dayTasks] of Object.entries(scheduled)"
                    v-bind:key="date"
                    v-bind:class="{ today: isToday(date) }"
                >
                    <div class="date-header d-flex flex-row">
                        <span>{{ isToday(date) ? `Today (${date})` : isTomorrow(date) ? `Tomorrow (${date})` : date }}</span>
                    </div>
                    <TaskListItemNext
                        v-for="task of dayTasks"
                        v-bind:key="task.uuid"
                        v-bind:value="task"
                        v-on:click="onTaskClick(task.uuid)"
                    />
                </div>
            </div>
        </v-card>
    </div>
</template>

<script lang="ts" setup>
import { type TreeNodeRecord } from '@/stores/taskForest';
import { type UUID } from '@/task';
import dayjs from 'dayjs';

// Props
interface Props {
    scheduled: Record<string, TreeNodeRecord[]>;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
    (e: 'task-click', taskUuid: UUID): void;
}>();

// Methods
function onTaskClick(taskUuid: UUID) {
    emit('task-click', taskUuid);
}

function isToday(date: string) {
    return date === dayjs().format('YYYY-MM-DD');
}

function isTomorrow(date: string) {
    return date === dayjs().add(1, 'day').format('YYYY-MM-DD');
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

    .date-header {
        padding: 2px 8px 0 8px;
    }
    div > .date-header {
        border-bottom: 2px solid #ddd;
        margin-bottom: 2px;
    }
    div + div > .date-header {
        margin-top: 12px;
    }
}
</style>