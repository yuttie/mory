<template>
    <div>
        <v-card-subtitle class="px-0">Alarms</v-card-subtitle>
        <p class="text-medium-emphasis mb-4">
            When mory rings, for an event or a task date whose note, or whose category, does not
            say. An alarm is an offset from the start, <code>-10m</code> before it or
            <code>+1h</code> after, or a time on the start's day, <code>09:00</code> or
            <code>-1d 18:00</code>. A note sets its own with <code>alarms:</code>. Stored in the
            same file, so they follow the notes rather than the browser.
        </p>
        <div class="alarm-defaults">
            <AlarmField
                v-for="field of ALARM_FIELDS"
                v-bind:key="field.name"
                v-model="draft[field.name]"
                v-bind:label="field.label"
            ></AlarmField>
        </div>
        <v-btn
            v-bind:disabled="!changed"
            v-bind:loading="isSaving"
            variant="tonal"
            v-on:click="save"
        >
            Save alarms
        </v-btn>
        <v-alert
            v-if="error"
            class="mt-4"
            type="error"
            variant="tonal"
        >{{ error }}</v-alert>
    </div>
</template>

<script lang="ts" setup>
// What mory rings at where a note, or its category, says nothing: the four lists in the `alarms:`
// block of `.mory/calendars.yaml`, edited together and saved together.

import { computed, reactive, ref, watch } from 'vue';

import type { AlarmDefaults, AlarmDraft } from '@/alarms';
import { alarmDraftChanged, readAlarmDraft } from '@/alarms';
import AlarmField from '@/components/AlarmField.vue';
import { CALENDARS_PATH, useCalendarsStore } from '@/stores/calendars';

// The four kinds of alarm the file sets, with what each is called.
const ALARM_FIELDS = [
    { name: 'timed', label: 'Events with a time' },
    { name: 'allDay', label: 'All-day events' },
    { name: 'dueBy', label: 'Task due dates' },
    { name: 'deadline', label: 'Task deadlines' },
] as const satisfies readonly { name: keyof AlarmDefaults; label: string }[];

const calendars = useCalendarsStore();

const isSaving = ref(false);
const error = ref('');
const draft = reactive<AlarmDraft>({ timed: [], allDay: [], dueBy: [], deadline: [] });

const changed = computed(() => alarmDraftChanged(draft, calendars.effectiveAlarmDefaults));

// The file is read after the settings mount, so the draft is filled in when it arrives rather than
// at setup, where there is nothing to fill it from yet.
watch(() => calendars.alarmDefaults, () => {
    for (const field of ALARM_FIELDS) {
        draft[field.name] = [...calendars.effectiveAlarmDefaults[field.name]];
    }
}, { immediate: true });

async function save() {
    const reading = readAlarmDraft(draft);
    if ('problem' in reading) {
        const label = ALARM_FIELDS.find((field) => field.name === reading.field)!.label;
        error.value = `${label}: ${reading.problem}.`;
        return;
    }

    isSaving.value = true;
    error.value = '';
    try {
        await calendars.saveAlarmDefaults(reading.defaults);
    }
    catch (err) {
        error.value = `Could not save ${CALENDARS_PATH}: ${err}`;
    }
    finally {
        isSaving.value = false;
    }
}
</script>

<style scoped>
.alarm-defaults {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(14em, 100%), 1fr));
    gap: 0 1rem;
}
</style>
