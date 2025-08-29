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
                    <v-list v-if="showTimeToggle || showTimezoneSelector">
                        <v-list-item v-if="showTimeToggle">
                            <v-switch
                                v-model="timeEnabled"
                                label="Include time"
                                v-on:change="onTimeToggle"
                            />
                        </v-list-item>
                    </v-list>
                </div>
                <div class="d-flex flex-column">
                    <v-time-picker
                        v-if="timeEnabled"
                        v-model="timeValue"
                        format="24hr"
                        scrollable
                        v-on:input="onTimePick"
                    />
                    <v-list v-if="showTimeToggle || showTimezoneSelector">
                        <v-list-item v-if="showTimezoneSelector">
                            <v-select
                                v-model="selectedTimezone"
                                v-bind:items="timezoneOptions"
                                label="Timezone"
                                item-text="text"
                                item-value="value"
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

<script lang="ts">
// Calculate local timezone at module scope
const offsetMinutes = new Date().getTimezoneOffset();
const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
const offsetMins = Math.abs(offsetMinutes) % 60;
const sign = offsetMinutes <= 0 ? '+' : '-';
export const LOCAL_TIMEZONE = `${sign}${offsetHours.toString().padStart(2, '0')}:${offsetMins.toString().padStart(2, '0')}`;
</script>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

import {
    mdiCalendarOutline,
    mdiClockOutline,
    mdiEarth,
} from '@mdi/js';

// Extend dayjs with UTC support
dayjs.extend(utc);

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
    { text: 'UTC (+00:00)', value: '+00:00' },
    { text: 'UTC-12 (-12:00)', value: '-12:00' },
    { text: 'UTC-11 (-11:00)', value: '-11:00' },
    { text: 'UTC-10 (-10:00)', value: '-10:00' },
    { text: 'UTC-9 (-09:00)', value: '-09:00' },
    { text: 'UTC-8 (-08:00)', value: '-08:00' },
    { text: 'UTC-7 (-07:00)', value: '-07:00' },
    { text: 'UTC-6 (-06:00)', value: '-06:00' },
    { text: 'UTC-5 (-05:00)', value: '-05:00' },
    { text: 'UTC-4 (-04:00)', value: '-04:00' },
    { text: 'UTC-3 (-03:00)', value: '-03:00' },
    { text: 'UTC-2 (-02:00)', value: '-02:00' },
    { text: 'UTC-1 (-01:00)', value: '-01:00' },
    { text: 'UTC+1 (+01:00)', value: '+01:00' },
    { text: 'UTC+2 (+02:00)', value: '+02:00' },
    { text: 'UTC+3 (+03:00)', value: '+03:00' },
    { text: 'UTC+4 (+04:00)', value: '+04:00' },
    { text: 'UTC+5 (+05:00)', value: '+05:00' },
    { text: 'UTC+5:30 (+05:30)', value: '+05:30' },
    { text: 'UTC+6 (+06:00)', value: '+06:00' },
    { text: 'UTC+7 (+07:00)', value: '+07:00' },
    { text: 'UTC+8 (+08:00)', value: '+08:00' },
    { text: 'UTC+9 (+09:00)', value: '+09:00' },
    { text: 'UTC+10 (+10:00)', value: '+10:00' },
    { text: 'UTC+11 (+11:00)', value: '+11:00' },
    { text: 'UTC+12 (+12:00)', value: '+12:00' },
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
        includeTimezone?: boolean;
        timezone?: string;
    }>(),
    {
        value: undefined,
        label: undefined,
        rules: () => [],
        required: false,
        clearable: true,
        hideDetails: false,
        includeTime: undefined,
        includeTimezone: false,
        timezone: '+00:00',
    },
);

// Emits
const emit = defineEmits<{
    (e: 'input', value: string | null): void;
    (e: 'timezone-change', timezone: string): void;
}>();

// Reactive states
const menu = ref(false);

// Determine if the includeTime prop was explicitly provided
const includeTimeExplicitlyProvided = props.includeTime !== undefined;

// Show the time toggle only if includeTime prop was not explicitly provided
const showTimeToggle = computed(() => !includeTimeExplicitlyProvided);

// Internal state for time enablement
const timeEnabled = ref(false);

// Internal state for timezone selection
const selectedTimezone = ref(props.timezone !== '+00:00' ? props.timezone : getLocalTimezone());

// Always show timezone selector when time is enabled
const showTimezoneSelector = computed(() => timeEnabled.value);

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

    // Initialize timezone from value if present
    if (props.value) {
        const { timezone } = parseDateTime(props.value);
        if (timezone) {
            selectedTimezone.value = timezone;
        }
    }
};

// Initialize on mount
onMounted(() => {
    initializeTimeEnabled();
});

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
        
        // Extract timezone from the input value if present (ISO8601 format only)
        let timezone: string | null = null;
        if (value.includes(' ') || value.includes('T') || value.match(/\d{2}:\d{2}/)) {
            // Check for ISO8601 timezone indicators: +HH:MM, -HH:MM, Z
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
        updateValue(v, timeValue.value, selectedTimezone.value);
    },
});

const timeValue = computed<string | null>({
    get: () => {
        if (!timeEnabled.value) return null;
        const { time } = parseDateTime(props.value);
        return time;
    },
    set: (v) => {
        updateValue(dateValue.value, v, selectedTimezone.value);
    },
});

// Display value for the text field
const displayValue = computed(() => {
    if (!props.value) return '';
    
    if (timeEnabled.value) {
        const { date, time } = parseDateTime(props.value);
        if (date && time) {
            let display = `${date} ${time}`;
            // Only show timezone if it's different from local timezone
            if (showTimezoneSelector.value && selectedTimezone.value !== getLocalTimezone()) {
                display += ` ${selectedTimezone.value}`;
            }
            return display;
        } else if (date) {
            return date;
        }
    }
    
    return props.value;
});

// Update the combined value
const updateValue = (date: string | null, time: string | null, timezone?: string) => {
    if (!date) {
        emit('input', null);
        return;
    }
    
    if (timeEnabled.value && time) {
        let value = `${date} ${time}`;
        // Always include timezone when time is enabled
        if (timezone) {
            // For ISO8601 format, directly append the timezone offset
            value += timezone;
        }
        emit('input', value);
    } else {
        emit('input', date);
    }
};

// Methods
function onDatePick(date: string) {
    updateValue(date, timeValue.value, selectedTimezone.value);
}

function onTimePick(time: string) {
    updateValue(dateValue.value, time, selectedTimezone.value);
}

function onTimezonePick(timezone: string) {
    selectedTimezone.value = timezone;
    emit('timezone-change', timezone);
    updateValue(dateValue.value, timeValue.value, timezone);
}

function onTimeToggle() {
    if (!timeEnabled.value) {
        // If time is disabled, update value to date-only format
        if (dateValue.value) {
            updateValue(dateValue.value, timeValue.value, selectedTimezone.value);
        }
    } else {
        // If time is enabled and we have a date, set default time if none exists
        if (dateValue.value && !timeValue.value) {
            updateValue(dateValue.value, '12:00', selectedTimezone.value);
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
