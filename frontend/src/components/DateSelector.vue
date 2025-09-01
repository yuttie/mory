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
            <div class="d-flex flex-row align-start">
                <div class="d-flex flex-column">
                    <v-date-picker
                        v-model="dateValue"
                        scrollable
                        show-adjacent-months
                        v-on:input="onDatePick"
                    />
                    <v-list v-if="showTimeToggle">
                        <v-list-item>
                            <v-switch
                                v-model="timeEnabled"
                                label="Include time"
                                v-on:change="onTimeToggle"
                            />
                        </v-list-item>
                    </v-list>
                </div>
                <div v-if="timeEnabled" class="d-flex flex-column">
                    <v-time-picker
                        v-model="timeValue"
                        format="24hr"
                        scrollable
                        v-on:input="onTimePick"
                    />
                    <v-list>
                        <v-list-item>
                            <v-select
                                v-model="timezoneValue"
                                v-bind:items="timezoneOptions"
                                label="Timezone"
                                item-text="text"
                                item-value="value"
                                hide-details
                                v-on:input="onTimezonePick"
                            >
                                <template v-slot:prepend>
                                    <v-icon>{{ mdiEarth }}</v-icon>
                                </template>
                            </v-select>
                        </v-list-item>
                    </v-list>
                </div>
            </div>
        </v-card>
    </v-menu>
</template>



<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import dayjs from 'dayjs';

import {
    mdiCalendarOutline,
    mdiClockOutline,
    mdiEarth,
} from '@mdi/js';

// Get local timezone in ISO8601 format
const getLocalTimezone = (): string => {
    const offsetMinutes = new Date().getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const offsetMins = Math.abs(offsetMinutes) % 60;
    const sign = offsetMinutes <= 0 ? '+' : '-';
    return `${sign}${offsetHours.toString().padStart(2, '0')}:${offsetMins.toString().padStart(2, '0')}`;
};

// ISO8601-style timezone options
const timezoneOptions = [
    { text: 'UTC-12:00', value: '-12:00' },
    { text: 'UTC-11:00', value: '-11:00' },
    { text: 'UTC-10:00', value: '-10:00' },
    { text: 'UTC-09:30', value: '-09:30' },
    { text: 'UTC-09:00', value: '-09:00' },
    { text: 'UTC-08:00', value: '-08:00' },
    { text: 'UTC-07:00', value: '-07:00' },
    { text: 'UTC-06:00', value: '-06:00' },
    { text: 'UTC-05:00', value: '-05:00' },
    { text: 'UTC-04:00', value: '-04:00' },
    { text: 'UTC-03:30', value: '-03:30' },
    { text: 'UTC-03:00', value: '-03:00' },
    { text: 'UTC-02:00', value: '-02:00' },
    { text: 'UTC-01:00', value: '-01:00' },
    { text: 'UTC+00:00', value: '+00:00' },
    { text: 'UTC+01:00', value: '+01:00' },
    { text: 'UTC+02:00', value: '+02:00' },
    { text: 'UTC+03:00', value: '+03:00' },
    { text: 'UTC+03:30', value: '+03:30' },
    { text: 'UTC+04:00', value: '+04:00' },
    { text: 'UTC+04:30', value: '+04:30' },
    { text: 'UTC+05:00', value: '+05:00' },
    { text: 'UTC+05:30', value: '+05:30' },
    { text: 'UTC+05:45', value: '+05:45' },
    { text: 'UTC+06:00', value: '+06:00' },
    { text: 'UTC+06:30', value: '+06:30' },
    { text: 'UTC+07:00', value: '+07:00' },
    { text: 'UTC+08:00', value: '+08:00' },
    { text: 'UTC+08:45', value: '+08:45' },
    { text: 'UTC+09:00', value: '+09:00' },
    { text: 'UTC+09:30', value: '+09:30' },
    { text: 'UTC+10:00', value: '+10:00' },
    { text: 'UTC+10:30', value: '+10:30' },
    { text: 'UTC+11:00', value: '+11:00' },
    { text: 'UTC+12:00', value: '+12:00' },
    { text: 'UTC+12:45', value: '+12:45' },
    { text: 'UTC+13:00', value: '+13:00' },
    { text: 'UTC+14:00', value: '+14:00' },
];

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

// Watch for changes to the value prop and re-initialize timeEnabled
watch(() => props.value, () => {
    initializeTimeEnabled();
}, { immediate: true });

// Parse the input value to extract date and time parts
const parseDateTime = (value: string | null | undefined): { date: string | null; time: string | null; timezone: string | null } => {
    if (!value) {
        return { date: null, time: null, timezone: null };
    }
    
    // Try to parse with dayjs to handle various formats
    const parsed = dayjs(value);
    if (parsed.isValid()) {
        const date = parsed.format('YYYY-MM-DD');
        const time = parsed.format('HH:mm');
        
        // Check if the original value contains time information
        // If it's just a date (like "2023-12-25"), don't extract time
        if (value.includes(' ') || value.includes('T') || value.match(/\d{2}:\d{2}/)) {
            // Check for ISO8601 timezone indicators: +HH:MM, -HH:MM, Z
            let timezone: string | null = null;
            const tzMatch = value.match(/([+-]\d{2}:\d{2}|Z)$/);
            if (tzMatch) {
                timezone = tzMatch[1] === 'Z' ? '+00:00' : tzMatch[1];
            }
            return { date, time, timezone };
        } else {
            return { date, time: null, timezone: null };
        }
    }
    
    return { date: null, time: null, timezone: null };
};

// Computed properties for date and time values
const dateValue = computed<string | null>({
    get: () => {
        const { date } = parseDateTime(props.value);
        return date;
    },
    set: (v) => {
        updateValue(v, timeValue.value, timezoneValue.value);
    },
});

const timeValue = computed<string | null>({
    get: () => {
        if (!timeEnabled.value) return null;
        const { time } = parseDateTime(props.value);
        return time;
    },
    set: (v) => {
        updateValue(dateValue.value, v, timezoneValue.value);
    },
});

// Computed property for timezone value extracted from the value prop
const timezoneValue = computed<string | null>({
    get: () => {
        if (!timeEnabled.value) return null;
        const { timezone } = parseDateTime(props.value);
        return timezone || getLocalTimezone();
    },
    set: (v) => {
        updateValue(dateValue.value, timeValue.value, v);
    },
});

// Display value for the text field
const displayValue = computed(() => {
    if (!props.value) return '';
    
    if (timeEnabled.value) {
        const { date, time } = parseDateTime(props.value);
        if (date && time) {
            const currentTz = timezoneValue.value || getLocalTimezone();
            return `${date} ${time}${currentTz}`;
        } else if (date) {
            return date;
        }
    }
    
    return props.value;
});

// Update the combined value
const updateValue = (date: string | null, time: string | null, timezone: string | null) => {
    if (!date) {
        emit('input', null);
        return;
    }
    
    if (timeEnabled.value && time) {
        let value = `${date} ${time}`;
        // Always include timezone when time is enabled
        const tz = timezone || getLocalTimezone();
        value += tz;
        emit('input', value);
    } else {
        emit('input', date);
    }
};

// Methods
function onDatePick(date: string) {
    updateValue(date, timeValue.value, timezoneValue.value);
}

function onTimePick(time: string) {
    updateValue(dateValue.value, time, timezoneValue.value);
}

function onTimezonePick(timezone: string) {
    updateValue(dateValue.value, timeValue.value, timezone);
}

function onTimeToggle() {
    if (!timeEnabled.value) {
        // If time is disabled, update value to date-only format
        if (dateValue.value) {
            updateValue(dateValue.value, timeValue.value, timezoneValue.value);
        }
    } else {
        // If time is enabled and we have a date, set default time if none exists
        if (dateValue.value && !timeValue.value) {
            updateValue(dateValue.value, '12:00', timezoneValue.value);
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
