<template>
    <v-combobox
        v-bind:delimiters="[',']"
        v-bind:error-messages="problems"
        v-bind:hint="description"
        v-bind:label="label"
        v-bind:model-value="modelValue"
        chips
        closable-chips
        multiple
        persistent-hint
        trim-values
        v-on:update:model-value="onUpdate"
    ></v-combobox>
</template>

<script lang="ts" setup>
// When something rings, as a list of alarms typed or pasted.
//
// An alarm is written in the text of `alarms.ts`'s grammar, which `moried` reads to send each one,
// so what is accepted here is what it will ring at: a chip that is not an alarm is named in the
// error rather than saved to be dropped without a word. The description says each in words, which
// is how a bare `0m` or `-1d 18:00` is told apart from what was meant.
//
// An empty list is a setting, and rings nothing. Whether that is wanted, or the same as leaving it
// unset, is the caller's to say.

import { computed } from 'vue';

import { describeAlarmText, parseAlarm } from '@/alarms';

const props = defineProps<{
    modelValue: string[];
    label: string;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: string[]): void;
}>();

const problems = computed(() => props.modelValue.flatMap((alarm) => {
    const parsed = parseAlarm(alarm);
    return 'error' in parsed ? [parsed.error] : [];
}));

const description = computed(() => props.modelValue.length === 0
    ? 'Never rings'
    : `Rings ${props.modelValue.map(describeAlarmText).join(', ')}`);

// Typed entries arrive as text, but an `items` list would hand objects: take only what is text.
function onUpdate(value: unknown) {
    emit('update:modelValue', (Array.isArray(value) ? value : []).filter(
        (entry): entry is string => typeof entry === 'string'));
}
</script>
