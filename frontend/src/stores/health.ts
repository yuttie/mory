import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import axios from 'axios';
import dayjs from 'dayjs';

import { eventChecks, frontmatterChecks, guardChecks, settingsChecks, taskChecks } from '@/health';
import type { HealthCheck } from '@/health';
import { planMonthOf } from '@/plans';
import { useAppStore } from '@/stores/app';
import { CALENDARS_PATH, useCalendarsStore } from '@/stores/calendars';
import { useFilesStore } from '@/stores/files';
import { usePlansStore } from '@/stores/plans';
import { TASK_SETTINGS_PATH, useTaskSettingsStore } from '@/stores/taskSettings';

export interface HealthSection {
    id: string;
    title: string;
    checks: HealthCheck[];
}

// The checks the Health page lists, kept here rather than in the page so whether any of them
// fails can be told without the page being open: a broken note no view happens to show is exactly
// what nobody would think to open the page for.
export const useHealthStore = defineStore('health', () => {
    const app = useAppStore();
    const files = useFilesStore();
    const calendars = useCalendarsStore();
    const taskSettings = useTaskSettingsStore();
    const plans = usePlansStore();

    const checking = ref(false);
    // Why the last check could not refresh the listing, and so read nothing else either.
    const listingError = ref<string | null>(null);
    // What could not be read at all, which no store holds a problem for.
    const calendarsReadError = ref<string | null>(null);
    const feedErrors = ref<string[]>([]);

    // The calendar draws a few months at a time; a year either side of the day a check runs covers
    // what anyone is planning around without expanding every series without end. Moved only by a
    // check, so the sections do not move under a reader at midnight.
    const today = ref(dayjs().format('YYYY-MM-DD'));
    const eventWindow = computed(() => ({
        from: dayjs(today.value).subtract(1, 'year').format('YYYY-MM-DD'),
        to: dayjs(today.value).add(1, 'year').format('YYYY-MM-DD'),
    }));

    const planPaths = computed(() => files.entries
        .map((entry) => entry.path)
        .filter((path) => path.startsWith('.mory/plans/')));

    const sections = computed<HealthSection[]>(() => [
        {
            id: 'frontmatter',
            title: 'Frontmatter',
            checks: guardChecks('frontmatter', 'Frontmatter can be checked', () => frontmatterChecks(files.entries)),
        },
        {
            id: 'events',
            title: `Events and task dates, ${eventWindow.value.from} to ${eventWindow.value.to}`,
            checks: guardChecks('events', 'Events and task dates can be checked', () => eventChecks(files.entries, eventWindow.value, {
                categories: calendars.categoryMap,
                alarmDefaults: calendars.alarmDefaults,
            })),
        },
        {
            id: 'tasks',
            title: 'Tasks',
            checks: guardChecks('tasks', 'Tasks can be checked', () => taskChecks(files.entries)),
        },
        {
            id: 'settings',
            title: 'Settings and plans',
            checks: guardChecks('settings', 'Settings and plans can be checked', () => settingsChecks({
                calendarsPath: CALENDARS_PATH,
                feedErrors: feedErrors.value,
                calendarErrors: calendarsReadError.value === null
                    ? calendars.errors
                    : [`${CALENDARS_PATH}: It cannot be read: ${calendarsReadError.value}`, ...calendars.errors],
                tasksPath: TASK_SETTINGS_PATH,
                taskSettingsProblems: taskSettings.problems,
                planPaths: planPaths.value,
                planErrors: plans.errors,
            })),
        },
    ]);

    // Each store keeps what it last read, and reading again is what makes a fix show up here.
    // Every read but the listing is caught on its own: one that fails leaves the checks on what the
    // others found, and the page says so rather than staying in its checking state.
    async function check(): Promise<void> {
        // A second run would clear what the first is about to report, and the first, ending,
        // would end the second's checking state.
        if (checking.value) {
            return;
        }
        checking.value = true;
        listingError.value = null;
        today.value = dayjs().format('YYYY-MM-DD');
        try {
            await run();
        }
        finally {
            checking.value = false;
        }
    }

    async function run(): Promise<void> {
        // The listing first, as the cheapest way to learn whether moried answers at all. When it
        // does not -- a laptop waking, moried restarting -- every other read would fail too, and the
        // stores would put their failures in place of what they last read: no categories or lead
        // times for the other views, and an error on every check here for nothing in the notes.
        try {
            await files.refresh();
        }
        catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                // Logging in again checks again.
                app.invalidateToken(() => void check());
            }
            else {
                listingError.value = String(error);
            }
            return;
        }
        const [readError, unloaded] = await Promise.all([
            calendars.loadConfiguration().then(() => null, (error) => String(error)),
            calendars.feedReports(today.value).then((reports) => reports
                .filter((report) => report.error !== null)
                .map((report) => `${report.name || report.id}: ${report.error}`), (error) => [
                `The subscribed calendars cannot be asked for: ${error}`,
            ]),
            // Never rejects: the store reports a file it cannot read among its problems.
            taskSettings.load(),
            readPlans(),
        ]);
        calendarsReadError.value = readError;
        feedErrors.value = unloaded;
    }

    // The listed months, after the listing that names them. A month that fails is in
    // `plans.errors`.
    async function readPlans(): Promise<void> {
        const months = planPaths.value.map(planMonthOf).filter((month): month is string => month !== null);
        await plans.loadMonths(months).catch(() => undefined);
    }

    return {
        checking,
        listingError,
        sections,
        check,
    };
});
