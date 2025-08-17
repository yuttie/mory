<template>
    <v-menu
        v-model="menu"
        v-bind:close-on-content-click="false"
        offset-y
        min-width="auto"
    >
        <template v-slot:activator="{ on, attrs }">
            <v-text-field
                v-bind="attrs"
                v-model="localValue"
                v-bind:label="label"
                v-bind:rules="rules"
                v-bind:required="required"
                v-bind:clearable="clearable"
                v-bind:hide-details="hideDetails"
                readonly
                v-on="on"
            >
                <template v-slot:prepend>
                    <v-icon>{{ mdiCalendarOutline }}</v-icon>
                </template>
            </v-text-field>
        </template>

        <v-date-picker
            v-model="localValue"
            no-title
            scrollable
            show-adjacent-months
            v-on:input="onPick"
        />
    </v-menu>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

import {
    mdiCalendarOutline,
} from '@mdi/js';

type HideDetails = boolean | 'auto';

// Props
const props = withDefaults(
    defineProps<{
        value?: string | null | undefined;
        label?: string | undefined;
        rules?: any[];
        required?: boolean;
        clearable?: boolean;
        hideDetails?: HideDetails;
    }>(),
    {
        value: undefined,
        label: undefined,
        rules: [],
        required: false,
        clearable: true,
        hideDetails: false,
    },
);

// Emits
const emit = defineEmits<{
    (e: 'input', value: string | null): void;
}>();

// Reactive states
const menu = ref(false);

// Computed properties
const localValue = computed<string | undefined>({
    get: () => {
        return props.value ?? undefined;
    },
    set: (v) => {
        emit('input', v ?? null);
    },
});

// Methods
function onPick() {
    menu.value = false;
}
</script>

<style scoped lang="scss">
</style>
