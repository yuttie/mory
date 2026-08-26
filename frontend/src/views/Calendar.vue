<template>
    <div id="calendar" class="d-flex flex-column">
        <v-toolbar flat border density="compact" color="transparent" class="flex-grow-0">
            <v-btn variant="outlined" v-on:click="setToday" class="mr-3">Today</v-btn>
            <v-btn icon variant="text" size="small" v-on:click="navigateCalendar('prev')">
                <v-icon>{{ mdiChevronLeft }}</v-icon>
            </v-btn>
            <v-btn icon variant="text" size="small" v-on:click="navigateCalendar('next')" class="mr-3">
                <v-icon>{{ mdiChevronRight }}</v-icon>
            </v-btn>
            <v-toolbar-title v-if="calendar" class="mr-3">
                {{ calendar.title }}
            </v-toolbar-title>
            <v-progress-linear
                absolute
                location="bottom"
                indeterminate
                color="primary"
                v-bind:active="isLoading"
            ></v-progress-linear>
        </v-toolbar>
        <v-calendar
            ref="calendar"
            v-bind:type="calendarType"
            v-bind:model-value="calendarCursor"
            v-bind:events="events"
            v-bind:event-color="getEventColor"
            v-bind:event-text-color="getEventTextColor"
            v-on:update:model-value="onCalendarInput"
            v-on:click:event="showEvent"
            v-on:click:more="viewDay"
            v-on:click:date="viewDay"
            v-touch="{
                left: () => navigateCalendar('next'),
                right: () => navigateCalendar('prev'),
            }"
            color="primary"
            class="flex-grow-1"
        ></v-calendar>
        <v-menu
            v-model="selectedOpen"
            v-bind:close-on-content-click="false"
            v-bind:activator="selectedElement"
            location="bottom"
            max-width="30em"
        >
            <v-card v-if="selectedEvent" flat class="event-card">
                <v-toolbar
                    v-bind:color="selectedEvent.color"
                    theme="dark"
                    flat
                >
                    <v-toolbar-title>{{ selectedEvent.name }}</v-toolbar-title>
                    <v-spacer></v-spacer>
                    <v-icon v-if="selectedEvent.finished" class="mr-4">{{ mdiCheck }}</v-icon>
                </v-toolbar>
                <v-card-text>
                    <v-list density="compact">
                        <v-list-item>
                            <template v-slot:prepend>
                                <v-icon>{{ mdiClockStart }}</v-icon>
                            </template>
                            {{ selectedEvent.start }}
                        </v-list-item>
                        <v-list-item v-if="selectedEvent.end">
                            <template v-slot:prepend>
                                <v-icon>{{ mdiClockEnd }}</v-icon>
                            </template>
                            {{ selectedEvent.end }}
                        </v-list-item>
                        <v-list-item>
                            <template v-slot:prepend>
                                <v-icon>{{ mdiFileDocumentOutline }}</v-icon>
                            </template>
                            <router-link v-bind:to="{ name: 'Note', params: { path: selectedEvent.notePath.split('/') } }">{{ selectedEvent.notePath }}</router-link>
                        </v-list-item>
                    </v-list>
                    <template v-if="selectedEvent.note">
                        <v-divider></v-divider>
                        <div class="mt-3" v-html="selectedEventRenderedNote"></div>
                    </template>
                </v-card-text>
            </v-card>
        </v-menu>
        <v-snackbar v-model="error" color="error" location="top" timeout="5000">{{ errorText }}</v-snackbar>
        <v-alert type="error" v-if="eventErrors.length > 0">
            <ul>
                <li
                    v-for="[prop, value, eventName, entryPath, entryTitle] of eventErrors"
                >Invalid event {{ prop }} value "{{ value }}" of "{{ eventName }}" defined in <router-link v-bind:to="{ path: `/note/${entryPath}` }">{{ entryTitle ?? entryPath }}</router-link></li>
            </ul>
        </v-alert>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';

import { useRoute, useRouter } from 'vue-router';

import {
    mdiCheck,
    mdiChevronLeft,
    mdiChevronRight,
    mdiClockEnd,
    mdiClockStart,
    mdiFileDocumentOutline,
} from '@mdi/js';

import { isMetadataEventMultiple, validateEvent } from '@/api';

import { useFiles } from '@/composables/files';
import Color from 'color';
import materialColors from 'vuetify/util/colors';
import dayjs from 'dayjs';
import { renderMarkdown } from '@/markdown';

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Composables
const router = useRouter();
const route = useRoute();
const files = useFiles();

// Reactive states
// The file list itself lives in the files store, shared with every other consumer.
const entries = files.entries;
const isLoading = ref(false);
const error = ref(false);
const errorText = ref('');
const eventErrors: Ref<[string, unknown, string, string, string | null][]> = ref([]);
const calendarType = ref<'month' | 'week' | 'day'>('month');
const calendarCursor = ref(dayjs().format('YYYY-MM-DD'));
const selectedEvent = ref<any>(null);
const selectedEventRenderedNote = ref<string | null>(null);
const selectedElement = ref<Element | undefined>(undefined);
const selectedOpen = ref(false);

// Template Refs
const calendar = ref<any>(null);

// Computed properties
const events = computed(() => {
    function normalizeEndTime(end: string | undefined, start: string): string | undefined | null {
        if (end === undefined) {
            return undefined;
        }

        const formatDateTime = (datetime: dayjs.Dayjs) => {
            if (datetime.second() === 0) {
                return datetime.format('YYYY-MM-DD HH:mm');
            }
            else {
                return datetime.format('YYYY-MM-DD HH:mm:ss');
            }
        };
        const durationShortRegexp =
            /^\+([\d.]+) *(y|M|w|d|h|m|s|ms)$/;
        const durationLongRegexp =
            /^\+([\d.]+) *(years?|months?|weeks?|days?|hours?|minutes?|seconds?|milliseconds?)$/i;

        const match = durationShortRegexp.exec(end) || durationLongRegexp.exec(end);
        if (match === null) {
            // `end` is not in duration format
            if (dayjs(end).isValid()) {
                // Return it as is if it's in valid format
                return end;
            }
            else {
                // Try to prefix it with start date
                const prefixedEnd = dayjs(start).format('YYYY-MM-DD') + ' ' + end;
                const parsedEnd = dayjs(prefixedEnd);
                if (parsedEnd.isValid()) {
                    if (parsedEnd.isAfter(start)) {
                        return prefixedEnd;
                    }
                    else {
                        return formatDateTime(parsedEnd.add(1, 'day'));
                    }
                }
                else {
                    // `end` is invalid
                    return null;
                }
            }
        }
        else {
            // `end` is in duration format
            // Calculate actual end time based on the duration from the start time
            const amount = parseFloat(match[1]);
            const unit = match[2] as dayjs.ManipulateType;
            return formatDateTime(dayjs(start).add(amount, unit));
        }
    }
    const events = [];
    const newEventErrors: [string, unknown, string, string, string | null][] = [];
    for (const entry of entries.value) {
        if (entry.metadata !== null) {
            // Choose a default color for the note based on its path
            let defaultColor = "#666666";
            if (Object.hasOwn(entry.metadata, 'events') && typeof entry.metadata.events === 'object' && entry.metadata.events !== null) {
                for (const [eventName, eventDetail] of Object.entries(entry.metadata.events)) {
                    if (typeof eventDetail === 'object' && eventDetail !== null) {
                        // If eventDetail has the 'times' property and it is an array
                        if (isMetadataEventMultiple(eventDetail)) {
                            for (const time of eventDetail.times) {
                                if (!dayjs(time.start).isValid()) {
                                    newEventErrors.push(['start', time.start, eventName, entry.path, entry.title]);
                                    continue;
                                }
                                const normalizedEndTime = normalizeEndTime(time.end || eventDetail.end, time.start);
                                if (normalizedEndTime === null) {
                                    newEventErrors.push(['end', time.end, eventName, entry.path, entry.title]);
                                    continue;
                                }
                                time.end = normalizedEndTime;
                                const event = {
                                    name: eventName,
                                    start: time.start,
                                    end: time.end,
                                    finished: time.finished,
                                    color: time.color || eventDetail.color || defaultColor,
                                    note: time.note || eventDetail.note,
                                    notePath: entry.path,
                                };
                                if (validateEvent(event)) {
                                    events.push(event);
                                }
                            }
                        }
                        else {
                            if (!dayjs(eventDetail.start).isValid()) {
                                newEventErrors.push(['start', eventDetail.start, eventName, entry.path, entry.title]);
                                continue;
                            }
                            const normalizedEndTime = normalizeEndTime(eventDetail.end, eventDetail.start);
                            if (normalizedEndTime === null) {
                                newEventErrors.push(['end', eventDetail.end, eventName, entry.path, entry.title]);
                                continue;
                            }
                            eventDetail.end = normalizedEndTime;
                            const event = {
                                name: eventName,
                                start: eventDetail.start,
                                end: eventDetail.end,
                                finished: eventDetail.finished,
                                color: eventDetail.color || defaultColor,
                                note: eventDetail.note,
                                notePath: entry.path,
                            };
                            if (validateEvent(event)) {
                                events.push(event);
                            }
                        }
                    }
                }
            }
        }
    }
    eventErrors.value = newEventErrors;
    return events;
});

// Lifecycle hooks
onMounted(() => {
    document.title = `Calendar | ${import.meta.env.VITE_APP_NAME}`;

    window.addEventListener('keydown', onKeydown);
    window.addEventListener('wheel', onWheel);
    window.addEventListener('focus', load);

    load();
});

onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('focus', load);
});

// Methods
function onCalendarInput(date: unknown) {
    const parsedDate = dayjs(date as string, 'YYYY-MM-DD');
    router.push({
        name: 'CalendarWithDate',
        params: {
            type: calendarType.value,
            year: parsedDate.format('YYYY'),
            month: parsedDate.format('MM'),
            day: parsedDate.format('DD'),
        },
    });
}

function navigateCalendar(direction: 'prev' | 'next', amount = 1) {
    const currentDate = dayjs(calendarCursor.value, 'YYYY-MM-DD');
    let newDate: dayjs.Dayjs;

    if (calendarType.value === 'month') {
        newDate = direction === 'prev'
            ? currentDate.subtract(amount, 'month')
            : currentDate.add(amount, 'month');
    } else if (calendarType.value === 'week') {
        newDate = direction === 'prev'
            ? currentDate.subtract(amount, 'week')
            : currentDate.add(amount, 'week');
    } else if (calendarType.value === 'day') {
        newDate = direction === 'prev'
            ? currentDate.subtract(amount, 'day')
            : currentDate.add(amount, 'day');
    } else {
        // Default to day navigation
        newDate = direction === 'prev'
            ? currentDate.subtract(amount, 'day')
            : currentDate.add(amount, 'day');
    }

    router.push({
        name: 'CalendarWithDate',
        params: {
            type: calendarType.value,
            year: newDate.format('YYYY'),
            month: newDate.format('MM'),
            day: newDate.format('DD'),
        },
    });
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') {
        navigateCalendar('prev');
    }
    else if (e.key === 'ArrowRight') {
        navigateCalendar('next');
    }
    else if (e.key === 'PageDown') {
        navigateCalendar('prev', 12);
    }
    else if (e.key === 'PageUp') {
        navigateCalendar('next', 12);
    }
    else if (e.key === 'Home') {
        setToday();
    }
}

function onWheel(e: WheelEvent) {
    if (e.deltaX < 0) {
        navigateCalendar('prev');
    }
    else if (e.deltaX > 0) {
        navigateCalendar('next');
    }
}

function load() {
    isLoading.value = true;
    files.refresh()
        .then(() => {
            isLoading.value = false;
        }).catch(err => {
            if (err.response) {
                if (err.response.status === 401) {
                    // Unauthorized
                    emit('tokenExpired', () => load());
                }
                else {
                    error.value = true;
                    errorText.value = err.response;
                    isLoading.value = false;
                    throw err;
                }
            }
            else {
                error.value = true;
                errorText.value = err.toString();
                isLoading.value = false;
                throw err;
            }
        });
}

function setToday() {
    router.push({
        name: 'Calendar',
    });
}

// Vuetify 4's calendar invokes click:date / click:more handlers with (nativeEvent, payload)
function viewDay(_nativeEvent: Event, { date }: { date: string }) {
    const parsedDate = dayjs(date, 'YYYY-MM-DD');
    router.push({
        name: 'CalendarWithDate',
        params: {
            type: 'day',
            year: parsedDate.format('YYYY'),
            month: parsedDate.format('MM'),
            day: parsedDate.format('DD'),
        },
    });
}

function showEvent (nativeEvent: Event, { event }: { event: any }) {
    const open = () => {
        selectedEvent.value = event;
        selectedElement.value = nativeEvent.target as Element;
        setTimeout(() => {
            selectedOpen.value = true;
        }, 10);
    };

    if (selectedOpen.value) {
        selectedOpen.value = false;
        setTimeout(open, 10);
    } else {
        open();
    }

    nativeEvent.stopPropagation();
}

function getEventEndTime(event: any): dayjs.Dayjs {
    if (typeof event.end !== 'undefined') {
        return dayjs(event.end);
    }
    else {
        return dayjs(event.start).endOf('day');
    }
}

function getEventColor(event: any): string {
    const toPropName = (s: string) => s.replace(/-./g, (match: string) => match[1].toUpperCase());
    const color = Object.hasOwn(materialColors, toPropName(event.color))
                ? Color((materialColors as any)[toPropName(event.color)].base)
                : Color(event.color);

    const now = dayjs();
    const time = getEventEndTime(event);
    if (time < now || event.finished) {
        return color.fade(0.75).string();
    }
    else {
        return color.string();
    }
}

function getEventTextColor(event: any): string {
    const now = dayjs();
    const time = getEventEndTime(event);
    if (time < now || event.finished) {
        return Color('#000000').fade(0.7).string();
    }
    else {
        const bg = Color(getEventColor(event));
        const white = Color('#ffffff');
        const black = Color('#000000');
        if (bg.contrast(white) >= 4.5) {  // Prefer white over black
            return white.string();
        }
        else if (bg.contrast(black) >= 4.5) {
            return black.string();
        }
        else if (bg.contrast(white) >= bg.contrast(black)) {
            return white.string();
        }
        else {
            return black.string();
        }
    }
}

// Watchers
watch(selectedEvent, async (newValue) => {
    if (newValue === null || newValue.note == null) {
        selectedEventRenderedNote.value = null;
    }
    else {
        const renderedFile = await renderMarkdown(newValue.note);
        const renderedHtml = String(renderedFile);
        selectedEventRenderedNote.value = renderedHtml;
    }
});

watch(route, (newRoute) => {
    if (newRoute.name === 'CalendarWithDate') {
        const { year, month, day } = newRoute.params as { year: string, month: string, day: string };
        calendarType.value = newRoute.params.type as string;
        calendarCursor.value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
}, { immediate: true });
</script>

<style scoped lang="scss">
#calendar {
    height: 100%;
}

.event-card {
    user-select: text;
}
</style>
