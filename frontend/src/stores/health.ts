import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

import { mdiAlertCircleOutline, mdiAlertOutline } from '@mdi/js';
import axios from 'axios';
import dayjs from 'dayjs';

import { eventChecks, frontmatterChecks, guardChecks, settingsChecks, statusOf, taskChecks } from '@/health';
import type { HealthCheck, HealthSeverity, HealthStatus } from '@/health';
import { keepEqual } from '@/keep';
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

/// What to show of the checks outside their page, where only a failing one is worth a word.
export interface HealthNotice {
    severity: HealthSeverity;
    icon: string;
    /// How many checks fail with each severity, as the page labels them ERROR and WARNING, such as
    /// "2 health errors, 1 warning": checks rather than problems, since one misspelt key repeated in
    /// 300 notes is one thing to fix.
    text: string;
}

/// How long a check that reached moried stays current for `checkIfStale`.
///
/// A check is a handful of small requests: the listing's changes since the commit held,
/// `.mory/calendars.yaml`, `.mory/tasks.yaml`, each listed month's plan, which nearly always
/// answers 304, and one day of the subscribed feeds, which moried serves from the copy of each it
/// keeps for an hour. The task settings and the plans are read again at every commit anyway. Every
/// few minutes is often enough to find the rest -- a commit made elsewhere, the calendar
/// configuration, a feed gone bad -- on coming back to the tab, and seldom enough that flicking
/// between tabs asks for nothing again.
export const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;

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
    // When the last check that reached moried ended, or `null` if none has in this session: until
    // one has, the stores hold only what the views happened to read, and a verdict on that would be
    // a verdict on nothing.
    const checkedAt = ref<number | null>(null);
    const checked = computed(() => checkedAt.value !== null);
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

    // A section apiece, each worked out again only when what it reads changes: kept computed
    // wherever the app is open, one section's change must not make the other three run again.
    const frontmatterSection = computed<HealthSection>(() => ({
        id: 'frontmatter',
        title: 'Frontmatter',
        checks: guardChecks('frontmatter', 'Frontmatter can be checked', () => frontmatterChecks(files.entries)),
    }));

    const eventSection = computed<HealthSection>(() => ({
        id: 'events',
        title: `Events and task dates, ${eventWindow.value.from} to ${eventWindow.value.to}`,
        checks: guardChecks('events', 'Events and task dates can be checked', () => eventChecks(files.entries, eventWindow.value, {
            categories: calendars.categoryMap,
            alarmDefaults: calendars.alarmDefaults,
        })),
    }));

    const taskSection = computed<HealthSection>(() => ({
        id: 'tasks',
        title: 'Tasks',
        checks: guardChecks('tasks', 'Tasks can be checked', () => taskChecks(files.entries)),
    }));

    const settingsSection = computed<HealthSection>(() => ({
        id: 'settings',
        title: 'Settings and plans',
        checks: guardChecks('settings', 'Settings and plans can be checked', () => settingsChecks({
            calendarsPath: CALENDARS_PATH,
            feedErrors: feedErrors.value,
            // The file's own lines, not `calendars.errors`, which also holds the feeds of the
            // window a view last loaded and so is a new array at every window the calendar draws.
            calendarErrors: calendarsReadError.value === null
                ? calendars.configurationErrors
                : [`${CALENDARS_PATH}: It cannot be read: ${calendarsReadError.value}`, ...calendars.configurationErrors],
            tasksPath: TASK_SETTINGS_PATH,
            taskSettingsProblems: taskSettings.problems,
            planPaths: planPaths.value,
            planErrors: plans.errors,
        })),
    }));

    const sections = computed(() => [
        frontmatterSection.value,
        eventSection.value,
        taskSection.value,
        settingsSection.value,
    ]);

    const allChecks = computed(() => sections.value.flatMap((section) => section.checks));

    /// The worst of every check, or `null` until a check has reached moried: an OK before then
    /// would be a guess.
    const status = computed((): HealthStatus | null => checked.value ? statusOf(allChecks.value) : null);

    /// How many checks fail with each severity, which is what the page lists, rather than how many
    /// problems they hold.
    const failingChecks = computed(() => {
        const counts: Record<HealthSeverity, number> = { error: 0, warning: 0 };
        for (const item of allChecks.value) {
            const itemStatus = statusOf([item]);
            if (itemStatus !== 'ok') {
                counts[itemStatus] += 1;
            }
        }
        return counts;
    });

    const notice = computed((): HealthNotice | null => {
        if (status.value === null || status.value === 'ok') {
            return null;
        }
        const { error, warning } = failingChecks.value;
        const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
        const text = error === 0
            ? plural(warning, 'health warning')
            : `${plural(error, 'health error')}${warning === 0 ? '' : `, ${plural(warning, 'warning')}`}`;
        return {
            severity: status.value,
            icon: status.value === 'error' ? mdiAlertCircleOutline : mdiAlertOutline,
            text,
        };
    });

    // Bumped whenever the session ends, so a check that began in one does not report on the next:
    // what it found after the token went is the failures of the requests the token was refused for.
    let session = 0;
    let running: Promise<void> | null = null;
    let requested = false;

    /// Reads what the checks need again, now, or once the check under way ends: it may have read a
    /// file before the fix that asked for this one, and one asked for meanwhile would otherwise be
    /// lost.
    function check(): Promise<void> {
        requested = true;
        running ??= (async () => {
            checking.value = true;
            try {
                while (requested) {
                    requested = false;
                    await run();
                }
            }
            finally {
                checking.value = false;
                running = null;
            }
        })();
        return running;
    }

    /// Checks again unless a check reached moried within `HEALTH_CHECK_INTERVAL_MS`, or one is
    /// under way, for what asks without knowing whether anything changed: loading the app, logging
    /// in, returning to the tab.
    function checkIfStale(): Promise<void> {
        if (!app.hasToken) {
            return Promise.resolve();
        }
        if (running !== null) {
            return running;
        }
        if (checkedAt.value !== null && Date.now() - checkedAt.value < HEALTH_CHECK_INTERVAL_MS) {
            return Promise.resolve();
        }
        return check();
    }

    // Each store keeps what it last read, and reading again is what makes a fix show up here.
    // Every read but the listing is caught on its own: one that fails leaves the checks on what the
    // others found, and the page says so rather than staying in its checking state.
    async function run(): Promise<void> {
        // Signed out by the run before, whose listing was refused: logging in asks for a check.
        if (!app.hasToken) {
            return;
        }
        const started = session;
        today.value = dayjs().format('YYYY-MM-DD');
        listingError.value = null;
        // The listing first, as the cheapest way to learn whether moried answers at all. When it
        // does not -- a laptop waking, moried restarting -- every other read would fail too, and the
        // stores would put their failures in place of what they last read: no categories or lead
        // times for the other views, and an error on every check here for nothing in the notes.
        try {
            await files.refresh();
        }
        catch (error) {
            if (started !== session) {
                rerunIfSignedIn();
            }
            else if (axios.isAxiosError(error) && error.response?.status === 401) {
                // Logging in again asks for a check, as every login does.
                app.invalidateToken(() => void checkIfStale());
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
        if (started !== session) {
            rerunIfSignedIn();
            return;
        }
        calendarsReadError.value = readError;
        keepEqual(feedErrors, unloaded);
        checkedAt.value = Date.now();
    }

    // For a check whose session ended while it ran. A login since then found it under way and so
    // asked for none of its own.
    function rerunIfSignedIn(): void {
        if (app.hasToken) {
            requested = true;
        }
    }

    // The listed months, after the listing that names them. A month that fails is in
    // `plans.errors`.
    async function readPlans(): Promise<void> {
        const months = planPaths.value.map(planMonthOf).filter((month): month is string => month !== null);
        await plans.loadMonths(months).catch(() => undefined);
    }

    // Signing out, or a session expiring, leaves nothing checked: the next session's verdict is its
    // own check's, not one the last session left behind. At once, rather than at the next flush, so
    // that a check under way knows of it before it reports.
    watch(() => app.hasToken, (hasToken) => {
        if (!hasToken) {
            session += 1;
            checkedAt.value = null;
            listingError.value = null;
            calendarsReadError.value = null;
            feedErrors.value = [];
        }
    }, { flush: 'sync' });

    return {
        checking,
        checked,
        listingError,
        sections,
        status,
        failingChecks,
        notice,
        check,
        checkIfStale,
    };
});
