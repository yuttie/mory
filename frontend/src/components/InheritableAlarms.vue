<template>
    <div class="mb-4">
        <v-switch
            v-bind:hint="hint"
            v-bind:label="label"
            v-bind:model-value="modelValue === null"
            density="compact"
            persistent-hint
            v-on:update:model-value="onInherit"
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
// When something rings: what it inherits, or a list of its own.
//
// `null` is inheriting and is not written to the note or the file, so the thing keeps following what
// it inherits from; a list, even an empty one, is its own. An empty one rings nothing, which is how
// one is silenced. A task's date inherits from the settings, and a category from the category it is
// nested under or else from them, which the caller says in the words it gives.

import { computed, watch } from 'vue';

import { describeAlarmList } from '@/alarms';
import AlarmField from '@/components/AlarmField.vue';

const props = withDefaults(defineProps<{
    modelValue: string[] | null;
    /// What it rings at while it inherits: shown in the hint, and what the list starts as when it
    /// takes its own, since starting from nothing would silence it.
    fallback: readonly string[];
    /// What the switch is called.
    label?: string;
    /// What is said while it inherits, where the default of saying what it rings at is not enough.
    inheritedHint?: string;
    /// What is said of a list of its own.
    ownHint?: string;
}>(), {
    label: 'Default alarms',
    inheritedHint: undefined,
    ownHint: 'Only these, and not the default.',
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: string[] | null): void;
}>();

const hint = computed(() => {
    if (props.modelValue !== null) {
        return props.ownHint;
    }
    return props.inheritedHint
        ?? `${describeAlarmList(props.fallback)} by default. The default is set under Calendars in the settings.`;
});

// The list it had before it was switched to inheriting, so switching back finds it where it was
// and not the inherited one in its place. Not state to draw from, so not reactive.
let remembered: string[] | null = props.modelValue === null ? null : [...props.modelValue];
watch(() => props.modelValue, (value) => {
    if (value !== null) {
        remembered = [...value];
    }
});

function onInherit(inherit: boolean | null) {
    emit('update:modelValue', inherit === true ? null : [...(remembered ?? props.fallback)]);
}
</script>
