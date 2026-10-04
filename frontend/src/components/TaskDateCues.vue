<template>
    <span
        class="task-dates"
        v-bind:class="{ stacked }"
    >
        <span
            v-for="cue of cues"
            v-bind:key="cue.field"
            class="task-date-cue"
            v-bind:data-field="cue.field"
            v-bind:class="cue.color ? `text-${cue.color}` : 'text-medium-emphasis'"
        >
            <v-tooltip location="bottom">
                <template #activator="{ props: tooltipProps }">
                    <span v-bind="tooltipProps">
                        <v-icon
                            size="small"
                            class="mr-1"
                        >{{ mdiCalendar }}</v-icon>{{ cue.label }} {{ cue.text }}
                    </span>
                </template>
                {{ cue.label }}: {{ cue.value }}
            </v-tooltip>
        </span>
    </span>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { mdiCalendar } from '@mdi/js';
import type { TaskNode } from '@/task-forest';
import { taskDateCues, type TaskDateField } from '@/task-date-cues';
import { useTasksStore } from '@/stores/tasks';
import { useTaskSettingsStore } from '@/stores/taskSettings';

const props = defineProps<{
    value: TaskNode;
    fields?: readonly TaskDateField[];
    stacked?: boolean;
}>();
const tasks = useTasksStore();
const settings = useTaskSettingsStore();
const cues = computed(() => taskDateCues(props.value.metadata?.task ?? {}, props.value.metadata?.tags ?? [], settings.settings, tasks.now).filter((cue) => !props.fields || props.fields.includes(cue.field)));
</script>

<style scoped>
.task-date-cue {
    display: inline-block;
    margin-left: 4px;
}
.stacked .task-date-cue {
    display: block;
    margin-left: 0;
}
</style>
