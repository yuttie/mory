<template>
    <div class="schedule-view groups">
        <v-card class="group">
            <v-card-title>Scheduled</v-card-title>
            <div class="task-list">
                <div
                    v-for="date of scheduledDates"
                    v-bind:key="date"
                    v-bind:class="{ today: isToday(date) }"
                >
                    <div class="date-header d-flex flex-row">
                        <span>{{ isToday(date) ? `Today (${date})` : isTomorrow(date) ? `Tomorrow (${date})` : date }}</span>
                    </div>
                    <TaskListItemNext
                        v-for="task of scheduled[date]"
                        v-bind:key="task.uuid"
                        v-bind:value="task"
                        v-on:click="onTaskClick(task.uuid)"
                        v-on:checkbox-click="onCheckboxClick(task, date)"
                    />
                </div>
            </div>
        </v-card>
        
        <!-- Effort Dialog -->
        <EffortDialog
            v-model="effortDialogVisible"
            v-bind:task-title="selectedTask?.title || ''"
            v-bind:scheduled-date="selectedDate"
            v-on:done="onMarkAsDone"
            v-on:effort="onLogEffort"
        />
    </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import { type TreeNodeRecord } from '@/stores/taskForest';
import { type UUID, type Effort } from '@/task';
import dayjs from 'dayjs';
import TaskListItemNext from './TaskListItemNext.vue';
import EffortDialog from './EffortDialog.vue';

// Props
const props = defineProps<{
    scheduled: Record<string, TreeNodeRecord[]>;
}>();

// Emits
const emit = defineEmits<{
    (e: 'task-click', taskUuid: UUID): void;
    (e: 'task-done', taskUuid: UUID): void;
    (e: 'task-effort', taskUuid: UUID, effort: Effort): void;
}>();

// Reactive state
const effortDialogVisible = ref(false);
const selectedTask = ref<TreeNodeRecord | null>(null);
const selectedDate = ref('');

// Computed properties
const scheduledDates = computed<string[]>(() => {
    return Object.keys(props.scheduled).sort((a, b) => -a.localeCompare(b));
});

// Methods
function onTaskClick(taskUuid: UUID) {
    emit('task-click', taskUuid);
}

function onCheckboxClick(task: TreeNodeRecord, date: string) {
    selectedTask.value = task;
    selectedDate.value = date;
    effortDialogVisible.value = true;
}

function onMarkAsDone() {
    if (selectedTask.value) {
        emit('task-done', selectedTask.value.uuid);
    }
}

function onLogEffort(effort: Effort) {
    if (selectedTask.value) {
        emit('task-effort', selectedTask.value.uuid, effort);
    }
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
