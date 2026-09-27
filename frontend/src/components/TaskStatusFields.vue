<template>
    <!-- One chain, so the block drawn is the root and takes the caller's class. -->
    <div v-if="status.kind === 'waiting'">
        <v-text-field
            v-bind:model-value="status.waiting_for"
            v-bind:rules="[required('Waiting for is required.')]"
            v-bind:autofocus="autofocus"
            label="Waiting for"
            required
            v-on:update:model-value="set('waiting_for', $event)"
        >
            <template v-slot:prepend>
                <v-icon>{{ mdiTarget }}</v-icon>
            </template>
        </v-text-field>
        <DateSelector
            v-bind:model-value="status.expected_by"
            v-bind:rules="[optionalDateTime]"
            label="Expected by (optional)"
            v-on:update:model-value="set('expected_by', $event ?? undefined)"
        />
        <v-combobox
            v-bind:model-value="status.contact"
            v-bind:items="contactItems"
            v-bind:return-object="false"
            label="Contact (optional)"
            clearable
            hide-selected
            v-on:update:model-value="set('contact', $event ?? undefined)"
        >
            <template v-slot:prepend>
                <v-icon>{{ mdiAccountOutline }}</v-icon>
            </template>
        </v-combobox>
        <DateSelector
            v-bind:model-value="status.follow_up_at"
            v-bind:rules="[optionalDateTime]"
            label="Follow up at (optional)"
            v-on:update:model-value="set('follow_up_at', $event ?? undefined)"
        />
    </div>
    <div v-else-if="status.kind === 'blocked'">
        <v-text-field
            v-bind:model-value="status.blocked_by"
            v-bind:rules="[required('Blocked by is required.')]"
            v-bind:autofocus="autofocus"
            label="Blocked by"
            required
            v-on:update:model-value="set('blocked_by', $event)"
        >
            <template v-slot:prepend>
                <v-icon>{{ mdiCancel }}</v-icon>
            </template>
        </v-text-field>
    </div>
    <div v-else-if="status.kind === 'on_hold'">
        <v-text-field
            v-bind:model-value="status.hold_reason"
            v-bind:rules="[required('Hold reason is required.')]"
            v-bind:autofocus="autofocus"
            label="Hold reason"
            required
            v-on:update:model-value="set('hold_reason', $event)"
        >
            <template v-slot:prepend>
                <v-icon>{{ mdiHelpCircleOutline }}</v-icon>
            </template>
        </v-text-field>
        <DateSelector
            v-bind:model-value="status.review_at"
            v-bind:rules="[optionalDateTime]"
            label="Review on (optional)"
            v-on:update:model-value="set('review_at', $event ?? undefined)"
        />
    </div>
    <div v-else-if="status.kind === 'done'">
        <DateSelector
            v-bind:model-value="status.completed_at"
            v-bind:rules="[required('Completed at is required.'), isDateTime('Invalid format.')]"
            label="Completed at"
            required
            v-on:update:model-value="set('completed_at', $event ?? undefined)"
        />
        <v-text-field
            v-bind:model-value="status.completion_note"
            v-bind:autofocus="autofocus"
            label="Completion note (optional)"
            v-on:update:model-value="set('completion_note', $event)"
        >
            <template v-slot:prepend>
                <v-icon>{{ mdiNoteEditOutline }}</v-icon>
            </template>
        </v-text-field>
    </div>
    <div v-else-if="status.kind === 'canceled'">
        <DateSelector
            v-bind:model-value="status.canceled_at"
            v-bind:rules="[required('Canceled at is required.'), isDateTime('Invalid format.')]"
            label="Canceled at"
            required
            v-on:update:model-value="set('canceled_at', $event ?? undefined)"
        />
        <v-text-field
            v-bind:model-value="status.cancel_reason"
            v-bind:rules="[required('Cancel reason is required.')]"
            v-bind:autofocus="autofocus"
            label="Cancel reason"
            required
            v-on:update:model-value="set('cancel_reason', $event)"
        >
            <template v-slot:prepend>
                <v-icon>{{ mdiHelpCircleOutline }}</v-icon>
            </template>
        </v-text-field>
    </div>
</template>

<script lang="ts" setup>
// The fields a status carries besides its kind, wherever a status is chosen: in the editor, and
// when a task is dropped on a column of the status view. One copy, so the two cannot come to ask
// for different things.
import { computed } from 'vue';

import {
    mdiAccountOutline,
    mdiCancel,
    mdiHelpCircleOutline,
    mdiNoteEditOutline,
    mdiTarget,
} from '@mdi/js';

import { isDateTime, optionalDateTime, required } from '@/rules';
import type { Status } from '@/task';

// Props
const props = defineProps<{
    knownContacts: [string, number][];
    // Focuses the first field to be typed rather than picked from a calendar.
    autofocus?: boolean;
}>();

const status = defineModel<Status>({ required: true });

// Computed properties
const contactItems = computed<{ title: string; value: string; }[]>(() =>
    props.knownContacts.map(([contact, count]) => {
        return {
            title: `${contact} (${count})`,
            value: contact,
        };
    })
);

// Any field of any status but its kind, and the values that field takes.
type Field = Status extends infer S ? (S extends Status ? Exclude<keyof S, 'kind'> : never) : never;
type FieldValue<K extends Field> = Status extends infer S ? (S extends Status ? (K extends keyof S ? S[K] : never) : never) : never;

// Methods
// Typed by the field, so a misspelt one, or a value it cannot hold, does not compile. Clearing a
// date or the contact gives null, which no field holds, though neither says so in its types:
// DateSelector's events reach this template untyped, and Vuetify types a combobox's value as a
// string. So each such caller turns null into absence itself.
function set<K extends Field>(key: K, value: FieldValue<K>): void {
    status.value = { ...status.value, [key]: value } as Status;
}
</script>
