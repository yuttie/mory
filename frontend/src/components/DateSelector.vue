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
                    <v-icon>{{ timeEnabled ? mdiClockOutline : mdiCalendarOutline }}</v-icon>
                </template>
            </v-text-field>
        </template>

        <div>
            <div class="pa-2">
                <v-switch
                    v-model="timeEnabled"
                    label="Include time"
                    hide-details
                    dense
                    v-on:change="onTimeToggle"
                />
            </div>
            <v-date-picker
                v-model="dateValue"
                no-title
                scrollable
                show-adjacent-months
                v-on:input="onDatePick"
            />
            <v-time-picker
                v-if="timeEnabled"
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
        rules?: Array<(value: string) => boolean | string>;
        required?: boolean;
        clearable?: boolean;
        hideDetails?: HideDetails;
        includeTime?: boolean; // Deprecated: kept for backward compatibility as initial state
    }>(),
    {
        value: undefined,
        label: undefined,
        rules: () => [],
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

// Internal state for time enablement - user can control this via UI toggle
const timeEnabled = ref(false);

// Initialize timeEnabled based on the current value or includeTime prop
const initializeTimeEnabled = () => {
    if (props.value) {
        const { time } = parseDateTime(props.value);
        timeEnabled.value = time !== null;
    } else {
        timeEnabled.value = props.includeTime;
    }
};

// Initialize on mount
initializeTimeEnabled();

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
        if (!timeEnabled.value) return null;
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
    
    if (timeEnabled.value) {
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
    
    if (timeEnabled.value && time) {
        emit('input', `${date} ${time}`);
    } else {
        emit('input', date);
    }
};

// Methods
function onDatePick(date: string) {
    updateValue(date, timeValue.value);
    if (!timeEnabled.value) {
        menu.value = false;
    }
}

function onTimePick(time: string) {
    updateValue(dateValue.value, time);
    menu.value = false;
}

function onTimeToggle() {
    if (!timeEnabled.value) {
        // If time is disabled, update value to date-only format
        if (dateValue.value) {
            emit('input', dateValue.value);
        }
    } else {
        // If time is enabled and we have a date, set default time if none exists
        if (dateValue.value && !timeValue.value) {
            updateValue(dateValue.value, '12:00');
        }
    }
}
</script>

<style scoped lang="scss">
</style>
