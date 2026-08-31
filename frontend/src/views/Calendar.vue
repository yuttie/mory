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
            <v-spacer></v-spacer>
            <v-menu
                v-if="calendars.available.length > 0"
                v-bind:close-on-content-click="false"
                location="bottom end"
            >
                <template v-slot:activator="{ props }">
                    <v-btn
                        v-bind="props"
                        icon
                        size="small"
                        variant="text"
                        title="Choose which imported calendars are shown"
                    >
                        <v-badge
                            v-bind:model-value="hiddenCalendars.size > 0"
                            v-bind:content="hiddenCalendars.size"
                            color="grey"
                        >
                            <v-icon>{{ mdiCalendarMultiple }}</v-icon>
                        </v-badge>
                    </v-btn>
                </template>
                <v-card min-width="16em">
                    <v-list density="compact" class="py-0">
                        <v-list-subheader>Imported calendars</v-list-subheader>
                        <v-list-item
                            v-for="subscription of calendars.available"
                            v-bind:key="subscription.id"
                            v-bind:title="subscription.name"
                            v-on:click="toggleCalendar(subscription.id)"
                        >
                            <template v-slot:prepend>
                                <v-checkbox-btn
                                    v-bind:model-value="!hiddenCalendars.has(subscription.id)"
                                    density="compact"
                                    class="mr-1"
                                    tabindex="-1"
                                ></v-checkbox-btn>
                                <v-avatar
                                    v-bind:color="calendars.colorOf.get(subscription.id) || DEFAULT_IMPORTED_COLOR"
                                    class="mr-3"
                                    size="12"
                                ></v-avatar>
                            </template>
                        </v-list-item>
                        <v-divider></v-divider>
                        <v-list-item
                            v-bind:disabled="hiddenCalendars.size === 0"
                            title="Show all"
                            v-on:click="showAllCalendars"
                        ></v-list-item>
                    </v-list>
                </v-card>
            </v-menu>
            <v-progress-linear
                absolute
                location="bottom"
                indeterminate
                color="primary"
                v-bind:active="isLoading || calendars.isLoading"
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
                    <v-chip
                        v-if="selectedEvent.source === 'ical'"
                        class="mr-2"
                        size="small"
                        variant="flat"
                    >
                        iCal
                    </v-chip>
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
                        <v-list-item v-if="selectedEvent.location">
                            <template v-slot:prepend>
                                <v-icon>{{ mdiMapMarkerOutline }}</v-icon>
                            </template>
                            {{ selectedEvent.location }}
                        </v-list-item>
                        <v-list-item v-if="selectedEvent.url">
                            <template v-slot:prepend>
                                <v-icon>{{ mdiLinkVariant }}</v-icon>
                            </template>
                            <a
                                v-bind:href="selectedEvent.url"
                                rel="noopener"
                                target="_blank"
                            >{{ selectedEvent.url }}</a>
                        </v-list-item>
                        <v-list-item v-if="selectedEvent.notePath">
                            <template v-slot:prepend>
                                <v-icon>{{ mdiFileDocumentOutline }}</v-icon>
                            </template>
                            <router-link v-bind:to="{ name: 'Note', params: { path: selectedEvent.notePath.split('/') } }">{{ selectedEvent.notePath }}</router-link>
                        </v-list-item>
                        <v-list-item v-else-if="selectedEvent.calendar">
                            <template v-slot:prepend>
                                <v-icon>{{ mdiCalendarImport }}</v-icon>
                            </template>
                            {{ calendars.nameOf.get(selectedEvent.calendar) ?? selectedEvent.calendar }}
                        </v-list-item>
                    </v-list>
                    <template v-if="selectedEvent.note">
                        <v-divider></v-divider>
                        <div class="mt-3" v-html="selectedEventRenderedNote"></div>
                    </template>
                </v-card-text>
                <v-card-actions v-if="selectedEvent.source === 'ical'">
                    <v-btn
                        v-bind:loading="isConverting"
                        v-bind:prepend-icon="mdiNotePlusOutline"
                        block
                        variant="tonal"
                        v-on:click="convertSelected"
                    >
                        Convert to note
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-menu>
        <v-snackbar v-model="error" color="error" location="top" timeout="5000">{{ errorText }}</v-snackbar>
        <v-alert type="error" v-if="eventErrors.length > 0 || calendars.errors.length > 0">
            <ul>
                <li
                    v-for="[prop, value, eventName, entryPath, entryTitle] of eventErrors"
                >Invalid event {{ prop }} value "{{ value }}" of "{{ eventName }}" defined in <router-link v-bind:to="{ path: `/note/${entryPath}` }">{{ entryTitle ?? entryPath }}</router-link></li>
                <li v-for="message of calendars.errors" v-bind:key="message">{{ message }}</li>
            </ul>
        </v-alert>
        <v-alert
            v-if="calendars.truncated"
            density="compact"
            type="warning"
        >
            Some calendars have more events in this range than can be shown.
        </v-alert>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

import { useRoute, useRouter } from 'vue-router';

import {
    mdiCalendarImport,
    mdiCalendarMultiple,
    mdiCheck,
    mdiChevronLeft,
    mdiChevronRight,
    mdiClockEnd,
    mdiClockStart,
    mdiFileDocumentOutline,
    mdiLinkVariant,
    mdiMapMarkerOutline,
    mdiNotePlusOutline,
} from '@mdi/js';


import { DEFAULT_EVENT_COLOR, DEFAULT_IMPORTED_COLOR, eventsFromEntries, mergeImported } from '@/events';
import type { CalendarEvent } from '@/events';
import { buildOccurrenceNote, buildSeriesNote, canConvertSeries } from '@/event-note';
import { useCalendarsStore } from '@/stores/calendars';
import { LAGGING_RETRY_MS, useFilesStore } from '@/stores/files';
import { useLocalStorage } from '@/composables/localStorage';
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
const files = useFilesStore();
const calendars = useCalendarsStore();

// Reactive states
const isLoading = ref(false);
const error = ref(false);
const errorText = ref('');
const calendarType = ref<'month' | 'week' | 'day'>('month');
const calendarCursor = ref(dayjs().format('YYYY-MM-DD'));
const selectedEvent = ref<CalendarEvent | null>(null);
const isConverting = ref(false);
const selectedEventRenderedNote = ref<string | null>(null);
const selectedElement = ref<Element | undefined>(undefined);
const selectedOpen = ref(false);
// Which imported calendars this browser is not drawing. A view preference, not repository data:
// the `enabled` flag in the settings decides what is fetched at all and is shared through
// `.mory/calendars.yaml`, while this only stops what arrived from being drawn here. Ids of
// calendars that are gone are kept rather than pruned, so a subscription that fails to load once
// does not come back shown.
const hiddenCalendarIds = useLocalStorage<string[]>('hidden-imported-calendars', []);

// Template Refs
const calendar = ref<any>(null);

// Computed properties
// A rule may be open-ended, so expansion is bounded by what the view can show. Padded a month
// either side, so the occurrences a month view spills into its first and last rows are present.
const eventWindow = computed(() => {
    const cursor = dayjs(calendarCursor.value, 'YYYY-MM-DD');
    const unit = calendarType.value === 'month' ? 'month' : calendarType.value;
    return {
        from: cursor.startOf(unit).subtract(1, 'month').format('YYYY-MM-DD'),
        to: cursor.endOf(unit).add(1, 'month').format('YYYY-MM-DD'),
    };
});
const derived = computed(() => eventsFromEntries(files.entries, eventWindow.value));
const hiddenCalendars = computed(() => new Set(hiddenCalendarIds.value));
const events = computed(() => mergeImported(
    derived.value.events,
    calendars.events,
    { colorOf: calendars.colorOf, hidden: hiddenCalendars.value },
));
const eventErrors = computed(() => derived.value.errors);

// Watchers
// Lifecycle hooks
onMounted(() => {
    document.title = `Calendar | ${import.meta.env.VITE_APP_NAME}`;
    calendars.loadSubscriptions().catch(() => {
        // The subscription list is only needed for names and colours; the events themselves come
        // back from the backend, which reads the same file.
    });

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

function loadImported(window: { from: string; to: string }) {
    calendars.load(window.from, window.to).catch((err) => {
        // A calendar that fails is already reported per-calendar in the response; this is the
        // request itself failing, which must not take the note events down with it.
        error.value = true;
        errorText.value = `Could not load imported events: ${err}`;
    });
}

/// Write a note for the imported event in the popup, so mory owns it from now on.
async function convertSelected() {
    const event = selectedEvent.value;
    if (event === null || event.source !== 'ical' || event.uid === undefined) {
        return;
    }

    const series = calendars.series[event.uid];
    // From the backend's own record, not from the popup: the drawn event's times have been through
    // `toWallClock` and no longer carry their offsets, so writing them into a note would fix the
    // event to whatever zone the reader happened to be in.
    const source = calendars.events.find((candidate) =>
        candidate.uid === event.uid
        && candidate.calendar === event.calendar
        && candidate.recurrence_id === event.recurrenceId);
    const occurrence = source ?? {
        calendar: event.calendar ?? '',
        uid: event.uid,
        recurrence_id: event.recurrenceId ?? event.start,
        name: event.name,
        start: event.start,
        end: event.end,
        note: event.note,
        location: event.location,
        url: event.url,
    };

    isConverting.value = true;
    try {
        // A series whose rule mory cannot express converts as the single occurrence in front of
        // the user, which `buildOccurrenceNote` records in the note itself.
        const note = canConvertSeries(series)
            ? buildSeriesNote(occurrence, series)
            : buildOccurrenceNote(occurrence, series);
        await files.write(note.path, note.content);
        await settle(note.path);

        // `selectedEvent` holds the imported object by reference, so rebuilding `events` leaves
        // the popup showing an event that is no longer drawn -- with its Convert button still on
        // it. Close it and let the user reopen whichever event replaced it.
        selectedOpen.value = false;
        selectedEvent.value = null;
    }
    catch (err) {
        error.value = true;
        errorText.value = `Could not convert the event: ${err}`;
    }
    finally {
        isConverting.value = false;
    }
}

/// Wait until the listing actually shows the note that was just written.
///
/// A single refresh can come back without it -- the same race `useEntrySubset` documents, and the
/// reason a newly created task used to go missing from the tree.
async function settle(path: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const entries = await files.refresh();
        if (entries.some((entry) => entry.path === path)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, LAGGING_RETRY_MS));
    }
}

function toggleCalendar(id: string) {
    hiddenCalendarIds.value = hiddenCalendars.value.has(id)
        ? hiddenCalendarIds.value.filter((hidden) => hidden !== id)
        : [...hiddenCalendarIds.value, id];
}

function showAllCalendars() {
    hiddenCalendarIds.value = [];
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
    // `Color` throws on anything it cannot parse, and both a note's `color:` and a calendar's
    // configured colour are free text. Throwing here happens inside v-calendar's render, so one
    // typo would blank the whole view rather than mis-colour one event.
    let color;
    try {
        color = Object.hasOwn(materialColors, toPropName(event.color))
            ? Color((materialColors as any)[toPropName(event.color)].base)
            : Color(event.color);
    }
    catch {
        color = Color(DEFAULT_EVENT_COLOR);
    }

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

// Declared after the route watcher, and immediate like it: watchers run in declaration order, so
// the other way round a deep-linked date fetched twice -- once for today's window, which is never
// drawn, and again once the route had moved the cursor.
watch(eventWindow, (window) => {
    loadImported(window);
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
