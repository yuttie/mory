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

import type {
    ImportedCalendarReport,
    ImportedOccurrence,
    ImportedSeries,
} from '@/api';
import { getImportedEvents } from '@/api';
import { useFilesStore } from '@/stores/files';

export const CALENDARS_PATH = '.mory/calendars.yaml';

export interface CalendarSubscription {
    id: string;
    name: string;
    url: string;
    color?: string;
    enabled: boolean;
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
    const hasLoadedSubscriptions = ref(false);

    const loaded = shallowRef<Loaded>(EMPTY);
    const isLoading = ref(false);
    // The window the current `loaded` describes, so a repeat request for it costs nothing.
    const loadedWindow = ref<string | null>(null);
    let inFlight: Promise<void> | null = null;

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

    /// One line per calendar that failed, for the view's existing error alert.
    const errors = computed(() =>
        loaded.value.calendars
            .filter((calendar) => calendar.error !== null)
            .map((calendar) => `${calendar.name}: ${calendar.error}`));

    async function loadSubscriptions(): Promise<CalendarSubscription[]> {
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
        }
        catch (error) {
            // No file means no calendars, which is the normal state before any are added -- the
            // same reading `ai-actions.ts` gives a 404 on its own config.
            subscriptions.value = [];
            if (!isMissing(error)) {
                throw error;
            }
        }
        hasLoadedSubscriptions.value = true;
        return subscriptions.value;
    }

    async function saveSubscriptions(next: CalendarSubscription[]): Promise<void> {
        subscriptions.value = next;
        const document = {
            calendars: next.map((subscription) => ({
                id: subscription.id,
                name: subscription.name,
                url: subscription.url,
                ...(subscription.color ? { color: subscription.color } : {}),
                enabled: subscription.enabled,
            })),
        };
        await files.write(CALENDARS_PATH, YAML.stringify(document, { indent: 4 }));
        // The subscription list decides what the events request returns, so what is loaded now
        // describes a configuration that no longer exists.
        invalidate();
    }

    function invalidate(): void {
        loadedWindow.value = null;
        loaded.value = EMPTY;
    }

    /// Fetch the occurrences in `[from, to]`, unless that window is already loaded.
    async function load(from: string, to: string): Promise<void> {
        const key = `${from}..${to}`;
        if (loadedWindow.value === key) {
            return;
        }
        if (inFlight !== null) {
            await inFlight;
            if (loadedWindow.value === key) {
                return;
            }
        }

        isLoading.value = true;
        inFlight = (async () => {
            try {
                const response = await getImportedEvents(from, to);
                loaded.value = {
                    events: response.events ?? [],
                    series: response.series ?? {},
                    calendars: response.calendars ?? [],
                    truncated: response.truncated === true,
                };
                loadedWindow.value = key;
            }
            finally {
                isLoading.value = false;
                inFlight = null;
            }
        })();
        await inFlight;
    }

    return {
        subscriptions,
        hasLoadedSubscriptions,
        events,
        series,
        errors,
        truncated,
        colorOf,
        nameOf,
        isLoading,
        loadSubscriptions,
        saveSubscriptions,
        invalidate,
        load,
    };
});

function isMissing(error: unknown): boolean {
    const status = (error as { response?: { status?: number } })?.response?.status;
    return status === 404;
}
