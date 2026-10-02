<template>
    <div class="mb-4">
        <v-switch
            v-bind:hint="hint"
            v-bind:model-value="modelValue === null"
            density="compact"
            label="Default alarms"
            persistent-hint
            v-on:update:model-value="onDefault"
        ></v-switch>
        <AlarmField
            v-if="modelValue !== null"
            v-bind:model-value="modelValue"
            class="mt-2"
            label="Alarms"
            v-on:update:model-value="emit('update:modelValue', $event)"
        ></AlarmField>
    </div>
</template>

<script lang="ts" setup>
// When one of a task's dates rings: what the settings say for every task's, or a list of its own.
//
// `null` is the default and is not written to the note, so the date keeps following the settings;
// a list, even an empty one, is the task's own. An empty one rings nothing, which is how a single
// date is silenced.

import { computed } from 'vue';

import { describeAlarmList } from '@/alarms';
import AlarmField from '@/components/AlarmField.vue';

const props = defineProps<{
    modelValue: string[] | null;
    /// What the default rings at, from the settings: shown while it is in use, and what the list
    /// starts as when the task takes its own, since starting from nothing would silence it.
    fallback: readonly string[];
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: string[] | null): void;
}>();

const hint = computed(() => props.modelValue === null
    ? `${describeAlarmList(props.fallback)} by default. The default is set under Calendars in the settings.`
    : 'Only these, and not the default.');

function onDefault(isDefault: boolean | null) {
    emit('update:modelValue', isDefault === true ? null : [...props.fallback]);
}
</script>
