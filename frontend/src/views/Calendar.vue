<template>
    <div id="calendar" class="d-flex flex-column">
        <AppBarContent>
            <!-- A phone's app bar has no room to spell out every control beside the month, and the
                 month is what says where the calendar is. -->
            <template v-if="$vuetify.display.xs">
                <v-icon-btn
                    v-bind:icon="mdiCalendarToday"
                    title="Today"
                    class="ml-1"
                    v-on:click="setToday"
                ></v-icon-btn>
            </template>
            <template v-else>
                <v-btn variant="outlined" v-on:click="setToday" class="ml-1 mr-3">Today</v-btn>
            </template>
            <v-icon-btn v-bind:icon="mdiChevronLeft" v-on:click="navigateCalendar('prev')"></v-icon-btn>
            <v-icon-btn v-bind:icon="mdiChevronRight" v-on:click="navigateCalendar('next')"></v-icon-btn>
            <!-- Drawn even before the calendar has mounted and has a title to give it, because it
                 is also what holds the controls after it at the end of the bar. -->
            <v-toolbar-title
                v-bind:class="$vuetify.display.xs ? 'ms-2 me-1' : 'ms-8 me-3'"
            >
                {{ $vuetify.display.xs ? shortTitle : calendar?.title }}
            </v-toolbar-title>
            <v-menu v-if="$vuetify.display.xs" location="bottom end">
                <template v-slot:activator="{ props }">
                    <v-icon-btn
                        v-bind="props"
                        v-bind:text="calendarTypes.find((type) => type.value === calendarType)?.short"
                        class="mr-1"
                    ></v-icon-btn>
                </template>
                <v-list>
                    <v-list-item
                        v-for="type of calendarTypes"
                        v-bind:key="type.value"
                        v-bind:title="type.title"
                        v-bind:active="type.value === calendarType"
                        v-on:click="setCalendarType(type.value)"
                    ></v-list-item>
                </v-list>
            </v-menu>
            <v-btn-toggle
                v-else
                v-bind:model-value="calendarType"
                mandatory
                variant="outlined"
                class="mr-2"
                v-on:update:model-value="setCalendarType"
            >
                <v-btn
                    v-for="type of calendarTypes"
                    v-bind:key="type.value"
                    v-bind:value="type.value"
                >
                    {{ type.title }}
                </v-btn>
            </v-btn-toggle>
            <v-menu
                v-if="calendars.available.length > 0 || categoryList.length > 0"
                v-bind:close-on-content-click="false"
                location="bottom end"
            >
                <template v-slot:activator="{ props }">
                    <v-icon-btn
                        v-bind="props"
                        class="mr-2"
                        title="Choose which calendars and categories are shown"
                    >
                        <v-badge
                            v-bind:model-value="hiddenCount > 0"
                            v-bind:content="hiddenCount"
                            color="grey"
                        >
                            <v-icon>{{ mdiCalendarMultiple }}</v-icon>
                        </v-badge>
                    </v-icon-btn>
                </template>
                <v-card min-width="16em">
                    <v-list class="py-0">
                        <template v-if="calendars.available.length > 0">
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
                        </template>
                        <template v-if="categoryList.length > 0">
                            <v-list-subheader>Categories</v-list-subheader>
                            <!-- A category under a hidden one is hidden with it, and ticking it
                                 alone could not show it, so it is shown unticked and disabled. -->
                            <v-list-item
                                v-for="category of categoryList"
                                v-bind:key="category.id"
                                v-bind:disabled="isInHiddenCategory(category.id, hiddenCategories) && !hiddenCategories.has(category.id)"
                                v-bind:title="category.id"
                                v-on:click="toggleCategory(category.id)"
                            >
                                <template v-slot:prepend>
                                    <v-checkbox-btn
                                        v-bind:model-value="!isInHiddenCategory(category.id, hiddenCategories)"
                                        class="mr-1"
                                        tabindex="-1"
                                    ></v-checkbox-btn>
                                    <v-avatar
                                        v-bind:color="categoryColorOf(category.id)"
                                        class="mr-3"
                                        size="12"
                                    ></v-avatar>
                                </template>
                            </v-list-item>
                        </template>
                        <v-divider></v-divider>
                        <v-list-item
                            v-bind:disabled="hiddenCount === 0"
                            title="Show all"
                            v-on:click="showAll"
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
        </AppBarContent>
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
                    class="event-card-toolbar"
                >
                    <v-toolbar-title>{{ selectedEvent.name }}</v-toolbar-title>
                    <v-spacer></v-spacer>
                    <v-chip
                        v-if="selectedEvent.source === 'ical'"
                        class="mr-2 flex-shrink-0"
                        variant="flat"
                    >
                        iCal
                    </v-chip>
                    <v-chip
                        v-else-if="selectedEvent.source === 'task'"
                        class="mr-2 flex-shrink-0"
                        variant="flat"
                    >
                        {{ selectedEvent.taskDate === 'due_by' ? 'Due' : 'Deadline' }}
                    </v-chip>
                    <v-chip
                        v-if="selectedEvent.categoryId"
                        class="mr-2 flex-shrink-0"
                        variant="flat"
                    >
                        {{ selectedEvent.categoryId }}
                    </v-chip>
                    <v-icon v-if="selectedEvent.finished" class="mr-4 flex-shrink-0">{{ mdiCheck }}</v-icon>
                </v-toolbar>
                <v-card-text>
                    <v-list>
                        <v-list-item v-bind:prepend-icon="mdiClockStart">
                            {{ selectedEvent.start }}
                        </v-list-item>
                        <v-list-item v-if="selectedEvent.end" v-bind:prepend-icon="mdiClockEnd">
                            {{ selectedEvent.end }}
                        </v-list-item>
                        <v-list-item v-if="selectedEvent.location" v-bind:prepend-icon="mdiMapMarkerOutline">
                            {{ selectedEvent.location }}
                        </v-list-item>
                        <v-list-item v-if="selectedEvent.url" v-bind:prepend-icon="mdiLinkVariant">
                            <a
                                v-bind:href="selectedEvent.url"
                                rel="noopener"
                                target="_blank"
                            >{{ selectedEvent.url }}</a>
                        </v-list-item>
                        <v-list-item v-if="selectedEvent.taskId" v-bind:prepend-icon="mdiCheckboxMarkedOutline">
                            <router-link v-bind:to="{ name: 'TasksNextWithParams', params: { selectedNodeId: selectedEvent.taskId, tab: 'selected', viewMode: 'status' } }">{{ selectedEvent.name }}</router-link>
                        </v-list-item>
                        <v-list-item v-else-if="selectedEvent.notePath" v-bind:prepend-icon="mdiFileDocumentOutline">
                            <router-link v-bind:to="{ name: 'Note', params: { path: selectedEvent.notePath.split('/') } }">{{ selectedEvent.notePath }}</router-link>
                        </v-list-item>
                        <v-list-item v-else-if="selectedEvent.calendar" v-bind:prepend-icon="mdiCalendarImport">
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
    mdiCalendarToday,
    mdiCheck,
    mdiCheckboxMarkedOutline,
    mdiChevronLeft,
    mdiChevronRight,
    mdiClockEnd,
    mdiClockStart,
    mdiFileDocumentOutline,
    mdiLinkVariant,
    mdiMapMarkerOutline,
    mdiNotePlusOutline,
} from '@mdi/js';


import {
    DEFAULT_EVENT_COLOR,
    DEFAULT_IMPORTED_COLOR,
    eventEndsAt,
    eventsFromEntries,
    isInHiddenCategory,
    mergeImported,
    resolveCategory,
    taskDatesFromEntries,
} from '@/events';
import type { CalendarEvent } from '@/events';
import { buildOccurrenceNote, buildSeriesNote, canConvertSeries } from '@/event-note';
import {
    HIDDEN_CALENDARS_STORAGE_KEY,
    HIDDEN_CATEGORIES_STORAGE_KEY,
    useCalendarsStore,
} from '@/stores/calendars';
import { LAGGING_RETRY_MS, useFilesStore } from '@/stores/files';
import { useLocalStorage } from '@/composables/localStorage';
import Color from 'color';
import { parseEventColor } from '@/event-color';
import dayjs from 'dayjs';
import { renderMarkdown } from '@/markdown';
import AppBarContent from '@/components/AppBarContent.vue';

// Emits
const emit = defineEmits<{
    (e: 'tokenExpired', callback: () => void): void;
}>();

// Composables
const router = useRouter();
const route = useRoute();
const files = useFilesStore();
const calendars = useCalendarsStore();

type CalendarType = 'month' | 'week' | 'day';

// `short` labels the type on a phone's app bar, which has no room for the word.
const calendarTypes: { value: CalendarType, title: string, short: string }[] = [
    { value: 'day', title: 'Day', short: 'D' },
    { value: 'week', title: 'Week', short: 'W' },
    { value: 'month', title: 'Month', short: 'M' },
];

// Reactive states
const isLoading = ref(false);
const error = ref(false);
const errorText = ref('');
const calendarType = ref<CalendarType>('month');
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
const hiddenCalendarIds = useLocalStorage<string[]>(HIDDEN_CALENDARS_STORAGE_KEY, []);
// The same kind of preference for categories, kept the same way -- ids of categories that are gone
// included, so one renamed back is not suddenly shown.
const hiddenCategoryIds = useLocalStorage<string[]>(HIDDEN_CATEGORIES_STORAGE_KEY, []);

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
const derived = computed(() => eventsFromEntries(
    files.entries,
    eventWindow.value,
    { categories: calendars.categoryMap },
));
// A task's dates are not an `events:` block, so they come from their own derivation over the same
// listing.
const taskDates = computed(() => taskDatesFromEntries(
    files.entries,
    eventWindow.value,
    { colorOf: calendars.taskDateColors },
));
const hiddenCalendars = computed(() => new Set(hiddenCalendarIds.value));
const hiddenCategories = computed(() => new Set(hiddenCategoryIds.value));
const categoryList = computed(() => calendars.categories ?? []);
const hiddenCount = computed(() => hiddenCalendars.value.size + hiddenCategories.value.size);
const events = computed(() => mergeImported(
    [...derived.value.events, ...taskDates.value.events],
    calendars.events,
    {
        colorOf: calendars.colorOf,
        hidden: hiddenCalendars.value,
        hiddenCategories: hiddenCategories.value,
    },
));
const eventErrors = computed(() => [...derived.value.errors, ...taskDates.value.errors]);
// The calendar's title for a phone, whose app bar cannot fit a month spelled out in full. Only a
// range within one month is spelled out; the calendar already abbreviates the ones across months.
// Built from the calendar's own range and formatters, so it names the days the calendar shows.
const shortTitle = computed((): string => {
    if (!calendar.value) {
        return '';
    }
    const { start, end } = calendar.value.renderProps;
    if (start.year !== end.year || start.month !== end.month) {
        return calendar.value.title;
    }
    const short = calendar.value.monthShortFormatter(start, true);
    const long = calendar.value.monthLongFormatter(start, false);
    // A period marks an abbreviation, and "May" is not one.
    return `${short === long ? short : `${short}.`} ${start.year}`;
});

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

function setCalendarType(type: CalendarType) {
    if (type === calendarType.value) {
        return;
    }

    const date = dayjs(calendarCursor.value, 'YYYY-MM-DD');
    router.push({
        name: 'CalendarWithDate',
        params: {
            type,
            year: date.format('YYYY'),
            month: date.format('MM'),
            day: date.format('DD'),
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

function toggleCategory(id: string) {
    hiddenCategoryIds.value = hiddenCategories.value.has(id)
        ? hiddenCategoryIds.value.filter((hidden) => hidden !== id)
        : [...hiddenCategoryIds.value, id];
}

function categoryColorOf(id: string): string {
    return (calendars.categoryMap && resolveCategory(id, calendars.categoryMap)?.color)
        || DEFAULT_EVENT_COLOR;
}

function showAll() {
    hiddenCalendarIds.value = [];
    hiddenCategoryIds.value = [];
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

function getEventColor(event: any): string {
    // Both a note's `color:` and a calendar's configured colour are free text, and this runs inside
    // v-calendar's render: an unreadable one draws in the default rather than blanking the view.
    const color = parseEventColor(event.color) ?? Color(DEFAULT_EVENT_COLOR);

    const now = dayjs();
    const time = eventEndsAt(event);
    if (time < now || event.finished) {
        return color.fade(0.75).string();
    }
    else {
        return color.string();
    }
}

function getEventTextColor(event: any): string {
    const now = dayjs();
    const time = eventEndsAt(event);
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
        calendarType.value = newRoute.params.type as CalendarType;
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
    // Not `height: 100%`: that resolves against `v-main`, which Vuetify gives `flex: 1 0 auto`
    // inside a wrapper with only a `min-height`, so it grows with whatever is inside it. The view
    // was then as tall as its own contents, and a busy month or an alert under the grid scrolled
    // the whole app instead of shrinking the grid. The window, less whatever the layout's bars
    // take, is the height the grid has to fit into.
    height: calc(100dvh - var(--v-layout-top, 0px) - var(--v-layout-bottom, 0px));

    // An alert names the notes the view could not draw, so it keeps its height and the grid gives
    // up the room. Vuetify's own `flex: 1 1 0%` would squeeze it to nothing instead, and since it
    // clips what it cannot fit, the errors would be there but unreadable. Beyond a share of the
    // view it scrolls itself: the grid has to stay a calendar however long the list is.
    > .v-alert {
        flex: 0 0 auto;
        max-height: 40%;
        overflow-y: auto;
    }
}

.event-card {
    user-select: text;
}

// The popup is where an event's whole name is read, but a toolbar fixes its height inline and cuts
// the title to one line. It stays a toolbar rather than becoming a plain sheet so that styling
// aimed at toolbars, including `.mory/custom.css`, still applies to it.
.event-card-toolbar {
    :deep(.v-toolbar__content) {
        // The height Vuetify gives a toolbar at the app's global compact density, kept as a floor
        // so a one-line title looks as it did.
        height: auto !important;
        min-height: 48px;
    }

    :deep(.v-toolbar-title) {
        // Vuetify's zero basis leaves the title out of the popup's natural width, so the popup
        // would stay as narrow as the event it opened from and wrap even a short name.
        flex-basis: auto;
        // Keeps a wrapped title off the toolbar's edges; a one-line title still sits within the
        // minimum height above.
        padding-block: 8px;
    }

    :deep(.v-toolbar-title__placeholder) {
        white-space: normal;
        // A long URL or unbroken word must wrap too, not widen the popup past its max-width.
        overflow-wrap: anywhere;
    }
}
</style>
