// Subscribed external calendars, and the read-only events they contribute.
//
// Two quite different things live here because they are two halves of one feature. The
// subscription list is repository data, held in `.mory/calendars.yaml` next to the app's other
// configuration, and read and written through the files store like any other note. The events are
// the opposite: never stored, fetched per window from the backend, and thrown away -- they are a
// live view of someone else's calendar, so the repository is deliberately not their home.
//
// Results are memoised per window because the calendar re-derives on every navigation, and a month
// stepped back and forth would otherwise refetch each time.

import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import YAML from 'yaml';

import type { AlarmDefaults } from '@/alarms';
import {
    readAlarmDefaults,
    withBuiltInAlarms,
    writeAlarmDefaults,
} from '@/alarms';
import type {
    ImportedCalendarReport,
    ImportedOccurrence,
    ImportedSeries,
} from '@/api';
import { getImportedEvents } from '@/api';
import type { ConfiguredCategory, EventCategories, TaskDateColors } from '@/events';
import { stringifyWithFlowAlarms } from '@/frontmatter';
import { categoryMapOf, readCategories } from '@/events';
import { useFilesStore } from '@/stores/files';

export const CALENDARS_PATH = '.mory/calendars.yaml';

/// Where a browser keeps the imported calendars it is not drawing. Every view that draws imported
/// events reads the same key, so hiding a calendar is one choice rather than one per page.
export const HIDDEN_CALENDARS_STORAGE_KEY = 'hidden-imported-calendars';

/// Where a browser keeps the event categories it is not drawing, shared by every view in the same
/// way. Hiding a category hides the categories nested under it too.
export const HIDDEN_CATEGORIES_STORAGE_KEY = 'hidden-event-categories';

export interface CalendarSubscription {
    id: string;
    name: string;
    url: string;
    color?: string;
    enabled: boolean;
}

// The colours a task's due date and deadline are drawn in live beside the subscriptions rather
// than in this browser's storage because they are the same kind of thing as a calendar's colour:
// how one source of dates is told from another, and something the user would otherwise have to set
// again on every device.

/// A calendar as a view needs to list it: what to call it, and what colour it draws in.
export interface CalendarSummary {
    id: string;
    name: string;
    color?: string;
}

interface Loaded {
    events: ImportedOccurrence[];
    series: Record<string, ImportedSeries>;
    calendars: ImportedCalendarReport[];
    truncated: boolean;
}

const EMPTY: Loaded = { events: [], series: {}, calendars: [], truncated: false };

export const useCalendarsStore = defineStore('calendars', () => {
    const files = useFilesStore();

    const subscriptions = ref<CalendarSubscription[]>([]);
    const taskDateColors = ref<TaskDateColors>({});
    // When an event or a task's date rings where its note says nothing. Kept in this file for the
    // reason the colours are: it is the same kind of thing as a category's, and would otherwise
    // have to be set again on every device.
    const alarmDefaults = ref<AlarmDefaults>({});
    // What each kind rings at once the built-in default is counted, which is what is in force where
    // the file sets none and so what a box showing the setting should start from.
    const effectiveAlarmDefaults = computed(() => withBuiltInAlarms(alarmDefaults.value));
    // `null` until the file has been read, and again when reading it fails: with no configuration
    // to hand, every category a note names would look unknown and be reported as a typo.
    const categories = ref<ConfiguredCategory[] | null>(null);
    // What the file says that is dropped on reading, as lines to show. Dropped is lost: saving
    // anything rewrites the file from what was kept, so the author is told before it is.
    const configurationProblems = ref<string[]>([]);
    const hasLoadedConfiguration = ref(false);

    const loaded = shallowRef<Loaded>(EMPTY);
    // Mounted views refetch their own window when subscriptions change under Config.
    const subscriptionRevision = ref(0);
    const isLoading = ref(false);
    // The window the current `loaded` describes, so a repeat request for it costs nothing.
    const loadedWindow = ref<string | null>(null);
    let inFlight: Promise<void> | null = null;
    // Which window `inFlight` is fetching, so a second caller for it can wait rather than refetch.
    let pendingWindow: string | null = null;
    let latestRequest = 0;

    const events = computed(() => loaded.value.events);
    const series = computed(() => loaded.value.series);
    const truncated = computed(() => loaded.value.truncated);

    /// The colour a calendar was configured with, for tinting its events.
    const colorOf = computed(() => {
        const colors = new Map<string, string>();
        for (const calendar of loaded.value.calendars) {
            if (calendar.color) {
                colors.set(calendar.id, calendar.color);
            }
        }
        for (const subscription of subscriptions.value) {
            if (subscription.color && !colors.has(subscription.id)) {
                colors.set(subscription.id, subscription.color);
            }
        }
        return colors;
    });

    const nameOf = computed(() => {
        const names = new Map<string, string>();
        for (const calendar of loaded.value.calendars) {
            names.set(calendar.id, calendar.name);
        }
        for (const subscription of subscriptions.value) {
            if (!names.has(subscription.id)) {
                names.set(subscription.id, subscription.name);
            }
        }
        return names;
    });

    /// The categories by id, as the event derivation takes them; `undefined` until they are known.
    const categoryMap = computed<EventCategories | undefined>(() => {
        if (categories.value === null) {
            return undefined;
        }
        return categoryMapOf(categories.value);
    });

    /// The calendars whose events this window could contain, in the order they are configured.
    ///
    /// The backend reports exactly the enabled subscriptions, so this is what a view may offer to
    /// show and hide. Before the first response there is nothing to report yet, and the
    /// subscriptions stand in so the control is not empty on the first paint.
    const available = computed<CalendarSummary[]>(() => {
        const reports = loaded.value.calendars.map((calendar) => ({
            id: calendar.id,
            name: nameOf.value.get(calendar.id) ?? calendar.id,
            color: colorOf.value.get(calendar.id),
        }));
        if (reports.length > 0) {
            return reports;
        }
        return subscriptions.value
            .filter((subscription) => subscription.enabled)
            .map((subscription) => ({
                id: subscription.id,
                name: subscription.name || subscription.id,
                color: subscription.color,
            }));
    });

    /// One line per calendar that failed, and per alarm in the configuration that is not one, for the
    /// view's existing error alert.
    const errors = computed(() => [
        ...configurationProblems.value,
        ...loaded.value.calendars
            .filter((calendar) => calendar.error !== null)
            .map((calendar) => `${calendar.name}: ${calendar.error}`),
    ]);

    async function readConfiguration(): Promise<CalendarSubscription[]> {
        try {
            const text = await files.read(CALENDARS_PATH);
            const parsed = YAML.parse(text);
            const list = Array.isArray(parsed?.calendars) ? parsed.calendars : [];
            subscriptions.value = list.map((entry: Record<string, unknown>) => ({
                id: String(entry.id ?? ''),
                name: String(entry.name ?? entry.id ?? ''),
                url: String(entry.url ?? ''),
                color: entry.color === undefined ? undefined : String(entry.color),
                enabled: entry.enabled !== false,
            }));
            taskDateColors.value = readTaskDateColors(parsed?.task_dates);
            const problems: string[] = [];
            alarmDefaults.value = readAlarmDefaults(parsed?.alarms, problems);
            categories.value = readCategories(parsed?.categories, problems);
            configurationProblems.value = problems.map((problem) =>
                `${CALENDARS_PATH}: ${problem}. It is ignored, and saving the settings removes it.`);
        }
        catch (error) {
            // No file means no calendars, which is the normal state before any are added -- the
            // same reading `ai-actions.ts` gives a 404 on its own config.
            subscriptions.value = [];
            taskDateColors.value = {};
            alarmDefaults.value = {};
            configurationProblems.value = [];
            categories.value = isMissing(error) ? [] : null;
            if (!isMissing(error)) {
                throw error;
            }
        }
        hasLoadedConfiguration.value = true;
        return subscriptions.value;
    }

    // The read under way, which a view that asks while one is joins rather than repeats: every view
    // that shows what the file holds asks as it mounts, and two of them mount together.
    let reading: Promise<CalendarSubscription[]> | null = null;

    /// Reads the configuration, again if it has been: a view that is opened finds the file as it is
    /// now, however it was changed since.
    function loadConfiguration(): Promise<CalendarSubscription[]> {
        reading ??= readConfiguration().finally(() => {
            reading = null;
        });
        return reading;
    }

    /// Reads the configuration only if it has not been read, for what wants it there rather than
    /// fresh: a box that shows the defaults beside a task's own.
    async function ensureLoaded(): Promise<void> {
        if (!hasLoadedConfiguration.value) {
            await loadConfiguration();
        }
    }

    async function saveSubscriptions(next: CalendarSubscription[]): Promise<void> {
        subscriptions.value = next;
        await writeConfiguration();
        // The subscription list decides what the events request returns, so what is loaded now
        // describes a configuration that no longer exists.
        invalidate();
    }

    /// Set the colours a task's dates draw in. An absent colour means the built-in default.
    ///
    /// No `invalidate()`: this changes how events are drawn, not which ones the backend returns.
    async function saveTaskDateColors(next: TaskDateColors): Promise<void> {
        taskDateColors.value = next;
        await writeConfiguration();
    }

    /// Set when events and task dates ring where a note says nothing. A kind left out takes the
    /// built-in default. Like the colours, this changes how events are shown, not which ones the
    /// backend returns, so no `invalidate()`.
    async function saveAlarmDefaults(next: AlarmDefaults): Promise<void> {
        alarmDefaults.value = next;
        await writeConfiguration();
    }

    /// Set the event categories. Like the task date colours, they change how events are drawn,
    /// not which ones the backend returns.
    async function saveCategories(next: ConfiguredCategory[]): Promise<void> {
        categories.value = next;
        await writeConfiguration();
    }

    // The whole file, from whatever the store holds. Every part is written every time, so editing
    // one never drops another.
    async function writeConfiguration(): Promise<void> {
        const document = {
            calendars: subscriptions.value.map((subscription) => ({
                id: subscription.id,
                name: subscription.name,
                url: subscription.url,
                ...(subscription.color ? { color: subscription.color } : {}),
                enabled: subscription.enabled,
            })),
            ...(Object.keys(taskDateColors.value).length > 0
                ? { task_dates: { ...taskDateColors.value } }
                : {}),
            ...(Object.keys(alarmDefaults.value).length > 0
                ? { alarms: writeAlarmDefaults(alarmDefaults.value) }
                : {}),
            ...(categories.value !== null && categories.value.length > 0
                ? {
                    categories: Object.fromEntries(categories.value.map(
                        ({ id, ...defaults }) => [id, defaults])),
                }
                : {}),
        };
        await files.write(CALENDARS_PATH, stringifyWithFlowAlarms(document, { indent: 4 }));
        // What was dropped on reading is now gone from the file, which is what was warned of.
        configurationProblems.value = [];
    }

    function invalidate(): void {
        loadedWindow.value = null;
        loaded.value = EMPTY;
        subscriptionRevision.value += 1;
    }

    /// Fetch the occurrences in `[from, to]`, unless that window is already loaded.
    async function load(from: string, to: string): Promise<void> {
        const key = `${from}..${to}`;
        if (loadedWindow.value === key) {
            return;
        }
        // Wait out whatever is in flight, but never inherit its outcome: a request for another
        // window failing is not this window's failure, and swallowing it here left the queued
        // window unfetched with nothing to retrigger it.
        if (inFlight !== null) {
            await inFlight.catch(() => undefined);
            if (loadedWindow.value === key) {
                return;
            }
            // A second caller for this same window may have started it meanwhile.
            if (pendingWindow === key && inFlight !== null) {
                await inFlight.catch(() => undefined);
                return;
            }
        }

        isLoading.value = true;
        pendingWindow = key;
        // A generation, so the `finally` only clears the slot if it still owns it -- a later
        // request for another window must not have its bookkeeping torn down by an earlier one.
        const generation = ++latestRequest;
        const revision = subscriptionRevision.value;
        const request = (async () => {
            try {
                const response = await getImportedEvents(from, to);
                // A save may have invalidated the subscriptions while this request ran.
                if (revision !== subscriptionRevision.value) {
                    return;
                }
                loaded.value = {
                    events: response.events ?? [],
                    series: response.series ?? {},
                    calendars: response.calendars ?? [],
                    truncated: response.truncated === true,
                };
                loadedWindow.value = key;
            }
            catch (error) {
                if (revision !== subscriptionRevision.value) {
                    return;
                }
                // Showing another window's events under this one's dates would be worse than
                // showing none, so what was loaded is dropped rather than left to mislead.
                loaded.value = EMPTY;
                loadedWindow.value = null;
                throw error;
            }
            finally {
                isLoading.value = false;
                if (latestRequest === generation) {
                    inFlight = null;
                    pendingWindow = null;
                }
            }
        })();
        inFlight = request;
        await request;
    }

    return {
        subscriptions,
        subscriptionRevision,
        taskDateColors,
        alarmDefaults,
        effectiveAlarmDefaults,
        categories,
        categoryMap,
        hasLoadedConfiguration,
        available,
        events,
        series,
        errors,
        truncated,
        colorOf,
        nameOf,
        isLoading,
        loadConfiguration,
        ensureLoaded,
        saveSubscriptions,
        saveTaskDateColors,
        saveAlarmDefaults,
        saveCategories,
        invalidate,
        load,
    };
});

// Hand-edited YAML, so every value is checked rather than trusted: a colour that is not a string
// is dropped in favour of the default, which is what an absent one means anyway.
function readTaskDateColors(value: unknown): TaskDateColors {
    if (typeof value !== 'object' || value === null) {
        return {};
    }
    const colors: TaskDateColors = {};
    for (const field of ['due_by', 'deadline'] as const) {
        const color = (value as Record<string, unknown>)[field];
        if (typeof color === 'string' && color.trim() !== '') {
            colors[field] = color.trim();
        }
    }
    return colors;
}

function isMissing(error: unknown): boolean {
    const status = (error as { response?: { status?: number } })?.response?.status;
    return status === 404;
}
