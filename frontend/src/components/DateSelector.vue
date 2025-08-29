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

        <v-card>
            <div class="d-flex flex-row align-end">
                <v-date-picker
                    v-model="dateValue"
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
            <v-list v-if="showTimeToggle">
                <v-list-item>
                    <v-switch
                        v-model="timeEnabled"
                        label="Include time"
                        v-on:change="onTimeToggle"
                    />
                </v-list-item>
            </v-list>
        </v-card>
    </v-menu>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
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
        includeTime?: boolean;
    }>(),
    {
        value: undefined,
        label: undefined,
        rules: [],
        required: false,
        clearable: true,
        hideDetails: false,
        includeTime: undefined,
    },
);

// Emits
const emit = defineEmits<{
    (e: 'input', value: string | null): void;
}>();

// Reactive states
const menu = ref(false);

// Determine if the includeTime prop was explicitly provided
const includeTimeExplicitlyProvided = props.includeTime !== undefined;

// Show the time toggle only if includeTime prop was not explicitly provided
const showTimeToggle = computed(() => !includeTimeExplicitlyProvided);

// Internal state for time enablement
const timeEnabled = ref(false);

// Initialize timeEnabled based on the current value or includeTime prop
const initializeTimeEnabled = () => {
    if (includeTimeExplicitlyProvided) {
        // If includeTime prop is explicitly provided, use that value
        timeEnabled.value = props.includeTime!;
    } else if (props.value) {
        // If no explicit includeTime prop, determine from current value
        const { time } = parseDateTime(props.value);
        timeEnabled.value = time !== null;
    } else {
        // Default to false if no value and no explicit includeTime prop
        timeEnabled.value = false;
    }
};

// Initialize on mount
onMounted(() => {
    initializeTimeEnabled();
});

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
}

function onTimePick(time: string) {
    updateValue(dateValue.value, time);
}

function onTimeToggle() {
    if (!timeEnabled.value) {
        // If time is disabled, update value to date-only format
        if (dateValue.value) {
            updateValue(dateValue.value, timeValue.value);
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
:deep(.v-date-picker-title) {
    height: 70px;
}
:deep(.v-picker) {
    border-radius: 0;
}
</style>
