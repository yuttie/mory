<template>
    <div id="calendar" class="d-flex flex-column">
        <v-toolbar flat outlined dense class="flex-grow-0">
            <v-btn outlined v-on:click="setToday" class="mr-3">Today</v-btn>
            <v-btn icon small v-on:click="$refs.calendar.prev()">
                <v-icon>mdi-chevron-left</v-icon>
            </v-btn>
            <v-btn icon small v-on:click="$refs.calendar.next()" class="mr-3">
                <v-icon>mdi-chevron-right</v-icon>
            </v-btn>
            <v-toolbar-title v-if="$refs.calendar" class="mr-3">
                {{ $refs.calendar.title }}
            </v-toolbar-title>
            <v-progress-linear
                absolute
                bottom
                indeterminate
                color="primary"
                v-bind:active="isLoading"
            ></v-progress-linear>
        </v-toolbar>
        <v-calendar
            ref="calendar"
            v-bind:type="calendarType"
            v-bind:value="calendarCursor"
            v-bind:events="events"
            v-bind:event-color="getEventColor"
            v-bind:event-text-color="getEventTextColor"
            v-on:input="onCalendarInput"
            v-on:click:event="showEvent"
            v-on:click:more="viewDay"
            v-on:click:date="viewDay"
            v-touch="{
                left: () => $refs.calendar.next(),
                right: () => $refs.calendar.prev(),
            }"
            color="primary"
            class="flex-grow-1"
        ></v-calendar>
        <v-menu
            v-model="selectedOpen"
            v-bind:close-on-content-click="false"
            v-bind:activator="selectedElement"
            offset-x
            offset-y
            max-width="30em"
        >
            <v-card v-if="selectedEvent" flat class="event-card">
                <v-toolbar
                    v-bind:color="selectedEvent.color"
                    dark
                    flat
                >
                    <v-toolbar-title>{{ selectedEvent.name }}</v-toolbar-title>
                    <v-spacer></v-spacer>
                    <v-icon v-if="selectedEvent.finished">mdi-check</v-icon>
                </v-toolbar>
                <v-card-text>
                    <v-list dense>
                        <v-list-item>
                            <v-list-item-icon>
                                <v-icon>mdi-clock-start</v-icon>
                            </v-list-item-icon>
                            <v-list-item-content>
                                {{ selectedEvent.start }}
                            </v-list-item-content>
                        </v-list-item>
                        <v-list-item v-if="selectedEvent.end">
                            <v-list-item-icon>
                                <v-icon>mdi-clock-end</v-icon>
                            </v-list-item-icon>
                            <v-list-item-content>
                                {{ selectedEvent.end }}
                            </v-list-item-content>
                        </v-list-item>
                        <v-list-item>
                            <v-list-item-icon>
                                <v-icon>mdi-file-document-outline</v-icon>
                            </v-list-item-icon>
                            <v-list-item-content>
                                <router-link v-bind:to="{ name: 'Note', params: { path: selectedEvent.notePath } }">{{ selectedEvent.notePath }}</router-link>
                            </v-list-item-content>
                        </v-list-item>
                    </v-list>
                    <template v-if="selectedEvent.note">
                        <v-divider></v-divider>
                        <div class="mt-3" v-html="selectedEventRenderedNote"></div>
                    </template>
                </v-card-text>
            </v-card>
        </v-menu>
        <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted, defineEmits, defineExpose } from 'vue';
import type { Ref } from 'vue';

import { useRouter, useRoute } from '@/composables/vue-router';

import * as api from '@/api';
import { isMetadataEventMultiple, validateEvent } from '@/api';
import type { ListEntry } from '@/api';
import Color from 'color';
import materialColors from 'vuetify/lib/util/colors';
import dayjs from 'dayjs';
import { renderMarkdown } from '@/markdown';

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Composables
const router = useRouter();
const route = useRoute();

// Reactive states
const entries: Ref<ListEntry[]> = ref([]);
const isLoading = ref(false);
const error = ref(false);
const errorText = ref('');
const calendarType = ref('month');
const calendarCursor = ref(dayjs().format('YYYY-MM-DD'));
const selectedEvent = ref(null);
const selectedEventRenderedNote = ref(null);
const selectedElement = ref(null);
const selectedOpen = ref(false);

// Refs
const calendar = ref(null);

// Computed properties
const events = computed(() => {
    function normalizeEndTime(end: any, start: any): any {
        const formatDateTime = (datetime) => {
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
        const match = durationShortRegexp.exec(end || '') || durationLongRegexp.exec(end || '');
        if (match === null) {
            if (dayjs(end).isValid()) {
                return end;
            }
            else {
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
                    throw new Error(`Event end value is invalid: ${end}`);
                }
            }
        }
        else {
            // The end time is calculated based on the duration from the start time
            const amount = parseFloat(match[1]);
            const unit = match[2] as dayjs.ManipulateType;
            return formatDateTime(dayjs(start).add(amount, unit));
        }
    }
    const events = [];
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
                                time.end = normalizeEndTime(time.end || eventDetail.end, time.start);
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
                            eventDetail.end = normalizeEndTime(eventDetail.end, eventDetail.start);
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
    return events;
});

// Lifecycle hooks
onMounted(() => {
    document.title = `Calendar | ${import.meta.env.VITE_APP_NAME}`;

    if (route.name === 'CalendarWithDate') {
        calendarType.value = route.params.type;
        calendarCursor.value = dayjs(route.params.date, 'YYYY/MM/DD').format('YYYY-MM-DD');
    }

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
function onCalendarInput(date: string) {
    router.push({
        path: `/calendar/${calendarType.value}/${dayjs(date, 'YYYY-MM-DD').format('YYYY/MM/DD')}`,
    });
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') {
        (calendar.value as any).prev();
    }
    else if (e.key === 'ArrowRight') {
        (calendar.value as any).next();
    }
}

function onWheel(e: WheelEvent) {
    if (e.deltaY < 0) {
        (calendar.value as any).prev();
    }
    else if (e.deltaY > 0) {
        (calendar.value as any).next();
    }
}

function load() {
    isLoading.value = true;
    api.listNotes()
        .then(res => {
            entries.value = res.data;
            isLoading.value = false;
        }).catch(error => {
            if (error.response) {
                if (error.response.status === 401) {
                    // Unauthorized
                    emit('tokenExpired', () => load());
                }
                else {
                    error.value = true;
                    errorText.value = error.response;
                    isLoading.value = false;
                    throw error;
                }
            }
            else {
                error.value = true;
                errorText.value = error.toString();
                isLoading.value = false;
                throw error;
            }
        });
}

function setToday() {
    router.push({
        name: 'Calendar',
    });
}

function viewDay({ date }: { date: string }) {
    router.push({
        path: `/calendar/day/${dayjs(date, 'YYYY-MM-DD').format('YYYY/MM/DD')}`,
    });
}

function showEvent ({ nativeEvent, event }: { nativeEvent: any, event: any }) {
    const open = () => {
        selectedEvent.value = event;
        selectedElement.value = nativeEvent.target;
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
    if (newValue === null) {
        selectedEventRenderedNote.value = null;
    }
    else {
        const renderedFile = await renderMarkdown(selectedEvent.value.note);
        const renderedHtml = String(renderedFile);
        selectedEventRenderedNote.value = renderedHtml;
    }
});

// Expose properties
defineExpose({
    onCalendarInput,
    onKeydown,
    onWheel,
    load,
    setToday,
    viewDay,
    showEvent,
    getEventEndTime,
    getEventColor,
    getEventTextColor,
});
</script>

<style scoped lang="scss">
#calendar {
    height: 100%;
}

.event-card {
    user-select: text;
}
</style>
