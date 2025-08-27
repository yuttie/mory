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
                v-model="displayValue"
                v-bind:label="label"
                v-bind:rules="rules"
                v-bind:required="required"
                v-bind:clearable="clearable"
                v-bind:hide-details="hideDetails"
                readonly
                v-on="on"
            >
                <template v-slot:prepend>
                    <v-icon>{{ includeTime ? mdiClockOutline : mdiCalendarOutline }}</v-icon>
                </template>
            </v-text-field>
        </template>

        <div>
            <v-date-picker
                v-model="dateValue"
                no-title
                scrollable
                show-adjacent-months
                v-on:input="onDatePick"
            />
            <v-time-picker
                v-if="includeTime"
                v-model="timeValue"
                format="24hr"
                scrollable
                v-on:input="onTimePick"
            />
        </div>
    </v-menu>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import dayjs from 'dayjs';

import {
    mdiCalendarOutline,
    mdiClockOutline,
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
        includeTime?: boolean;
    }>(),
    {
        value: undefined,
        label: undefined,
        rules: [],
        required: false,
        clearable: true,
        hideDetails: false,
        includeTime: false,
    },
);

// Emits
const emit = defineEmits<{
    (e: 'input', value: string | null): void;
}>();

// Reactive states
const menu = ref(false);

// Parse the input value to extract date and time parts
const parseDateTime = (value: string | null | undefined): { date: string | null; time: string | null } => {
    if (!value) {
        return { date: null, time: null };
    }
    
    // Try to parse with dayjs to handle various formats
    const parsed = dayjs(value);
    if (parsed.isValid()) {
        const date = parsed.format('YYYY-MM-DD');
        const time = parsed.format('HH:mm');
        
        // Check if the original value contains time information
        // If it's just a date (like "2023-12-25"), don't extract time
        if (value.includes(' ') || value.includes('T') || value.match(/\d{2}:\d{2}/)) {
            return { date, time };
        } else {
            return { date, time: null };
        }
    }
    
    return { date: null, time: null };
};

// Computed properties for date and time values
const dateValue = computed<string | null>({
    get: () => {
        const { date } = parseDateTime(props.value);
        return date;
    },
    set: (v) => {
        updateValue(v, timeValue.value);
    },
});

const timeValue = computed<string | null>({
    get: () => {
        if (!props.includeTime) return null;
        const { time } = parseDateTime(props.value);
        return time;
    },
    set: (v) => {
        updateValue(dateValue.value, v);
    },
});

// Display value for the text field
const displayValue = computed(() => {
    if (!props.value) return '';
    
    if (props.includeTime) {
        const { date, time } = parseDateTime(props.value);
        if (date && time) {
            return `${date} ${time}`;
        } else if (date) {
            return date;
        }
    }
    
    return props.value;
});

// Update the combined value
const updateValue = (date: string | null, time: string | null) => {
    if (!date) {
        emit('input', null);
        return;
    }
    
    if (props.includeTime && time) {
        emit('input', `${date} ${time}`);
    } else {
        emit('input', date);
    }
};

// Methods
function onDatePick(date: string) {
    updateValue(date, timeValue.value);
    if (!props.includeTime) {
        menu.value = false;
    }
}

function onTimePick(time: string) {
    updateValue(dateValue.value, time);
    menu.value = false;
}
</script>

<style scoped lang="scss">
</style>
