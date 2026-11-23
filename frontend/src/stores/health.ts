import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';

import { mdiAlertCircleOutline, mdiAlertOutline } from '@mdi/js';
import axios from 'axios';
import dayjs from 'dayjs';

import { eventChecks, frontmatterChecks, guardChecks, settingsChecks, statusOf, taskChecks } from '@/health';
import type { HealthCheck, HealthProblem, HealthSeverity, HealthStatus } from '@/health';
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

/// What a check is of: the repository at one commit, as moried lists it under one schema, and the
/// day it runs on, which sets the window of events it expands.
interface HealthKey {
    /// `null` while the listing is not known to be HEAD's, as while moried's cache lags it.
    commit: string | null;
    schema: number | null;
    day: string;
}

/// What one check found, and what it was found of. A check reads nothing but what its key names and
/// runs nothing but its build's code, apart from asking whether each subscribed feed can be
/// fetched; `RECORD_LIFETIME_MS` bounds how long that goes unasked.
export interface HealthRecord extends HealthKey {
    build: string;
    checkedAt: number;
    /// How many files the listing held, for the page to say what was checked.
    fileCount: number;
    /// Whether every read reached what it read, at a commit known to be HEAD's. One that failed for
    /// moried or the network rather than for a file -- a restart, a lost connection, an expired
    /// session -- says nothing of the commit, so the tab that made it shows what it found but
    /// neither stores it nor takes it as current: the next occasion checks again.
    complete: boolean;
    sections: HealthSection[];
}

/// Where the last complete check is kept: in `localStorage`, which every tab of the app shares, so
/// a check one tab has made of a commit is one no other tab makes again.
export const HEALTH_RECORD_STORAGE_KEY = 'health-record';

/// How long a record stands even when nothing it was found of has moved, for the one input that
/// can change without a commit: whether each subscribed feed can be fetched and read. moried keeps
/// a feed it fetched for `MORIED_ICAL_CACHE_MINUTES`, an hour by default, so asking more often
/// would mostly be answered from that copy; but it keeps only a feed it could fetch, so a feed that
/// failed and has since recovered is reported failed until the record runs out.
export const RECORD_LIFETIME_MS = 60 * 60 * 1000;

/// How long a check waits for another tab's to end before checking without it. A check is a few
/// requests, but none of them has a timeout, and one that never ends must not hold every tab's
/// checks with it; one waited out too soon costs no more than a second check of the commit.
const LOCK_WAIT_MS = 30 * 1000;

const LOCK_NAME = 'mory-health-check';

// The code doing the checking: another version of it may check something new, or the same thing
// differently, so what one recorded is no record to another. A build names each chunk by a hash of
// what it holds, the names of the chunks it imports among it, so this module's URL changes whenever
// code it runs does (and with much else in the same chunk), and stays as it is in a build of the
// same sources. Vite's dev server marks an edited module and every module importing it with `?t=`,
// and its start time stands for edits made while it was down.
const BUILD = `${import.meta.env.VITE_APP_DEV_SERVER_STARTED ?? ''} ${import.meta.url}`;

function readStoredRecord(): HealthRecord | null {
    try {
        return parseRecord(localStorage.getItem(HEALTH_RECORD_STORAGE_KEY));
    }
    catch {
        return null;
    }
}

/// The record `text` holds, if this build wrote it: one another build wrote is no record at all.
function parseRecord(text: string | null): HealthRecord | null {
    if (text === null) {
        return null;
    }
    try {
        const value: unknown = JSON.parse(text);
        return isRecord(value) ? value : null;
    }
    catch {
        return null;
    }
}

// Checked as far as what reads a record dereferences, every view's sidebar among them: one key
// holds what whichever build ran last wrote, and anything else on the origin can write to it.
function isRecord(value: unknown): value is HealthRecord {
    const record = value as Partial<HealthRecord> | null;
    return typeof record === 'object' && record !== null
        && record.build === BUILD
        && typeof record.commit === 'string'
        && (record.schema === null || typeof record.schema === 'number')
        && typeof record.day === 'string'
        && typeof record.checkedAt === 'number'
        && typeof record.fileCount === 'number'
        && record.complete === true
        && Array.isArray(record.sections)
        && record.sections.every(isSection);
}

function isSection(value: unknown): value is HealthSection {
    const section = value as Partial<HealthSection> | null;
    return typeof section === 'object' && section !== null
        && typeof section.id === 'string'
        && typeof section.title === 'string'
        && Array.isArray(section.checks)
        && section.checks.every(isCheck);
}

function isCheck(value: unknown): value is HealthCheck {
    const check = value as Partial<HealthCheck> | null;
    return typeof check === 'object' && check !== null
        && typeof check.id === 'string'
        && typeof check.title === 'string'
        && typeof check.description === 'string'
        && Array.isArray(check.problems)
        && check.problems.every(isProblem);
}

function isProblem(value: unknown): value is HealthProblem {
    const problem = value as Partial<HealthProblem> | null;
    return typeof problem === 'object' && problem !== null
        && (problem.severity === 'error' || problem.severity === 'warning')
        && typeof problem.message === 'string'
        && (problem.path === undefined || typeof problem.path === 'string');
}

function storeRecord(record: HealthRecord): void {
    try {
        localStorage.setItem(HEALTH_RECORD_STORAGE_KEY, JSON.stringify(record));
    }
    catch {
        // Refused, as a full quota may refuse it: the record still stands in this tab, but an older
        // one left in storage must not stand for it in the others, which check for themselves.
        removeStoredRecord();
    }
}

function removeStoredRecord(): void {
    try {
        localStorage.removeItem(HEALTH_RECORD_STORAGE_KEY);
    }
    catch {
        // No storage, and so no record in it.
    }
}

/// Whether `record` is of what `key` names, with this build, complete or not.
function isOf(record: HealthRecord | null, key: HealthKey): record is HealthRecord {
    return record !== null
        && record.commit === key.commit
        && record.schema === key.schema
        && record.day === key.day
        && record.build === BUILD;
}

/// Whether `record` is what a check of `key` would find now.
function isCurrent(record: HealthRecord | null, key: HealthKey, now: number): boolean {
    return isOf(record, key) && record.complete && now - record.checkedAt < RECORD_LIFETIME_MS;
}

/// Runs `task` while no other tab runs one under the same lock, where the browser has locks, so
/// that tabs following the same commit check it once: the second, given the lock, finds the first's
/// record and stops there. A check asked for regardless takes no lock, as nothing another tab
/// records would stop it, and no check waits longer than `LOCK_WAIT_MS`.
async function exclusively(force: boolean, task: () => Promise<void>): Promise<void> {
    if (force || typeof navigator === 'undefined' || navigator.locks === undefined) {
        return task();
    }
    let granted = false;
    try {
        await navigator.locks.request(LOCK_NAME, { signal: AbortSignal.timeout(LOCK_WAIT_MS) }, () => {
            granted = true;
            return task();
        });
    }
    catch (error) {
        if (granted) {
            throw error;
        }
        await task();
    }
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

    // Whether a check asked for is under way, from asking moried for HEAD to recording what was
    // found or finding the record current, waiting for another tab's among it.
    const busy = ref(false);
    // Whether this tab is reading what a check needs, rather than finding the record current.
    const checking = ref(false);
    // Why the last check could not refresh the listing, and so read nothing else either.
    const listingError = ref<string | null>(null);
    // The last check any tab made, while the session lasts. One left in storage while signed out is
    // no session's, and goes.
    const record = shallowRef<HealthRecord | null>(app.hasToken ? readStoredRecord() : null);
    if (!app.hasToken) {
        removeStoredRecord();
    }

    // Another tab's check is this one's too.
    function onStorage(event: StorageEvent): void {
        if (event.key !== HEALTH_RECORD_STORAGE_KEY && event.key !== null) {
            return;
        }
        // Signed out, nothing is shown, and a record written meanwhile is not this session's.
        if (!app.hasToken) {
            return;
        }
        // Removed, by a sign-out or by a write storage refused: what this tab shows may be what
        // that write was to replace.
        if (event.newValue === null) {
            record.value = null;
            return;
        }
        // Another build's record is none.
        const next = parseRecord(event.newValue);
        if (next === null) {
            return;
        }
        if (record.value === null || next.commit === files.commitId || record.value.commit !== files.commitId) {
            record.value = next;
        }
        // Of a commit this tab does not list, while what it shows is of one it does: another tab's
        // commit, which asking moried for HEAD finds and the record then stands for, or one before
        // this tab's, checked by a tab whose listing lagged, which asking finds past. A hidden tab
        // asks as it is shown again.
        else if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            void checkIfStale();
        }
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('storage', onStorage);
        onScopeDispose(() => window.removeEventListener('storage', onStorage));
    }

    const sections = computed(() => record.value?.sections ?? []);
    const fileCount = computed(() => record.value?.fileCount ?? 0);
    const checked = computed(() => record.value !== null);

    const allChecks = computed(() => sections.value.flatMap((section) => section.checks));

    /// The worst of every check, or `null` until one has been recorded: an OK before then would be
    /// a guess.
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

    interface Request {
        /// Check whatever the record says, as the page's button asks.
        force: boolean;
        /// Ask moried for its HEAD first, where nothing says what it is: loading the app, logging
        /// in, coming back to the tab. A request following a sync knows already.
        refresh: boolean;
    }

    // Bumped whenever the session ends, so a check that began in one does not report on the next:
    // what it found after the token went is the failures of the requests the token was refused for.
    let session = 0;
    let running: Promise<void> | null = null;
    let pending: Request | null = null;
    // While held, as under the open settings, nothing is read; the end of the hold asks again, for
    // a check asked for regardless meanwhile as well.
    let held = false;
    let heldForce = false;

    // One request at a time, and one asked for meanwhile is run after it, merged with any other:
    // the one under way may have read a file before the change that asked for this one.
    function request(next: Request): Promise<void> {
        pending = pending === null
            ? next
            : { force: pending.force || next.force, refresh: pending.refresh || next.refresh };
        running ??= (async () => {
            busy.value = true;
            try {
                while (pending !== null) {
                    const current = pending;
                    pending = null;
                    await run(current);
                }
            }
            finally {
                busy.value = false;
                running = null;
            }
        })();
        return running;
    }

    /// Checks again now, whatever the record says.
    function check(): Promise<void> {
        return request({ force: true, refresh: true });
    }

    /// Asks moried for its HEAD and checks again unless the record is of it, for what asks without
    /// knowing whether anything changed: loading the app, logging in, returning to the tab.
    function checkIfStale(): Promise<void> {
        if (!app.hasToken || held) {
            return Promise.resolve();
        }
        return request({ force: false, refresh: true });
    }

    /// Reads nothing for a check while `hold` is true, as the open settings need, and asks again
    /// once it ends: what changed meanwhile is unknown, a save there among it.
    function hold(hold: boolean): void {
        held = hold;
        if (!hold) {
            const force = heldForce;
            heldForce = false;
            void (force ? check() : checkIfStale());
        }
    }

    // Whether a check must stop for the hold, which then asks for it again.
    function stoppedByHold(force: boolean): boolean {
        if (held) {
            heldForce ||= force;
        }
        return held;
    }

    function keyNow(): HealthKey {
        return { commit: files.commitId, schema: files.schema ?? null, day: dayjs().format('YYYY-MM-DD') };
    }

    // Whether a check of `key` would tell this tab nothing new. One asked for only because this tab
    // learned of a commit asks nothing of a commit this tab has checked already, even if not
    // completely, which is for the next occasion to try again, nor of one it no longer lists, whose
    // successor asks for itself.
    function served(key: HealthKey, refresh: boolean): boolean {
        return isCurrent(record.value, key, Date.now())
            || !refresh && (key.commit === null || isOf(record.value, key));
    }

    async function run({ force, refresh }: Request): Promise<void> {
        // Signed out by the run before, whose listing was refused: logging in asks for a check.
        if (!app.hasToken || stoppedByHold(force)) {
            return;
        }
        const started = session;
        if (refresh) {
            listingError.value = null;
            // The listing first, as the cheapest way to learn both what HEAD is and whether moried
            // answers at all. When it does not -- a laptop waking, moried restarting -- every other
            // read would fail too, and the stores would put their failures in place of what they
            // last read: no categories or lead times for the other views, and an error on every
            // check here for nothing in the notes.
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
        }
        if (!force && served(keyNow(), refresh)) {
            return;
        }
        await exclusively(force, async () => {
            // Waiting for the lock, the session may have ended, the settings opened, and the
            // listing moved on.
            if (started !== session || !app.hasToken) {
                rerunIfSignedIn();
                return;
            }
            if (stoppedByHold(force)) {
                return;
            }
            const key = keyNow();
            if (!force) {
                const stored = readStoredRecord();
                if (isCurrent(stored, key, Date.now())) {
                    record.value = stored;
                    return;
                }
                if (served(key, refresh)) {
                    return;
                }
            }
            checking.value = true;
            try {
                const reached = await read(key);
                if (started !== session) {
                    rerunIfSignedIn();
                    return;
                }
                const next: HealthRecord = {
                    ...key,
                    build: BUILD,
                    checkedAt: Date.now(),
                    fileCount: files.entries.length,
                    // What was read is of the commit only if the listing is still of it.
                    complete: reached && key.commit !== null && files.commitId === key.commit,
                    sections: sectionsOf(key.day, feedErrors, calendarsReadError),
                };
                record.value = next;
                if (next.complete) {
                    storeRecord(next);
                }
            }
            finally {
                checking.value = false;
            }
        });
    }

    // What the last `read` could not read at all, which no store holds a problem for.
    let calendarsReadError: string | null = null;
    let feedErrors: string[] = [];

    // Each store keeps what it last read, and reading again is what makes a fix show up. Every read
    // is caught on its own: one that fails leaves the checks on what the others found. Resolves to
    // whether every read reached its file at `key`'s commit: a failure of moried or the network
    // says nothing of the files.
    async function read(key: HealthKey): Promise<boolean> {
        const months = listedMonths();
        const [calendarsError, feeds] = await Promise.all([
            calendars.reloadConfiguration().then(() => null, (error: unknown) => ({ error })),
            calendars.feedReports(key.day).then(
                (reports) => ({
                    errors: reports
                        .filter((report) => report.error !== null)
                        .map((report) => `${report.name || report.id}: ${report.error}`),
                    failed: false,
                }),
                (error: unknown) => ({ errors: [`The subscribed calendars cannot be asked for: ${error}`], failed: true }),
            ),
            // Never rejects: the store reports a file it cannot read among its problems.
            taskSettings.load(),
            plans.loadMonths(months).catch(() => undefined),
        ]);
        calendarsReadError = calendarsError === null ? null : String(calendarsError.error);
        feedErrors = feeds.errors;
        // A file that is not YAML is the file's fault, and moried, which cannot read it either,
        // refuses the feeds for it.
        const calendarsBroken = calendarsError !== null && !axios.isAxiosError(calendarsError.error);
        return (calendarsError === null || calendarsBroken)
            && (!feeds.failed || calendarsBroken)
            && taskSettings.readAt === key.commit
            && months.every((month) => plans.readAt(month) === key.commit);
    }

    // Worked out once a check has read everything, rather than kept computed: every tab would
    // otherwise work all of them out again at each sync, for a verdict one tab records for all.
    function sectionsOf(day: string, feeds: string[], calendarsError: string | null): HealthSection[] {
        const span = {
            from: dayjs(day).subtract(1, 'year').format('YYYY-MM-DD'),
            to: dayjs(day).add(1, 'year').format('YYYY-MM-DD'),
        };
        const entries = files.entries;
        return [
            {
                id: 'frontmatter',
                title: 'Frontmatter',
                checks: guardChecks('frontmatter', 'Frontmatter can be checked', () => frontmatterChecks(entries)),
            },
            {
                // The calendar draws a few months at a time; a year either side of the day a check
                // runs covers what anyone is planning around without expanding every series
                // without end.
                id: 'events',
                title: `Events and task dates, ${span.from} to ${span.to}`,
                checks: guardChecks('events', 'Events and task dates can be checked', () => eventChecks(entries, span, {
                    categories: calendars.categoryMap,
                    alarmDefaults: calendars.alarmDefaults,
                })),
            },
            {
                id: 'tasks',
                title: 'Tasks',
                checks: guardChecks('tasks', 'Tasks can be checked', () => taskChecks(entries)),
            },
            {
                id: 'settings',
                title: 'Settings and plans',
                checks: guardChecks('settings', 'Settings and plans can be checked', () => settingsChecks({
                    calendarsPath: CALENDARS_PATH,
                    feedErrors: feeds,
                    calendarErrors: calendarsError === null
                        ? calendars.configurationErrors
                        : [`${CALENDARS_PATH}: It cannot be read: ${calendarsError}`, ...calendars.configurationErrors],
                    tasksPath: TASK_SETTINGS_PATH,
                    taskSettingsProblems: taskSettings.problems,
                    planPaths: planPaths(),
                    planErrors: plans.errors,
                })),
            },
        ];
    }

    function planPaths(): string[] {
        return files.entries
            .map((entry) => entry.path)
            .filter((path) => path.startsWith('.mory/plans/'));
    }

    // The months the listing holds a plan for. A month that fails to read is in `plans.errors`.
    function listedMonths(): string[] {
        return planPaths().map(planMonthOf).filter((month): month is string => month !== null);
    }

    // For a check whose session ended while it ran. A login since then found it under way and so
    // asked for none of its own.
    function rerunIfSignedIn(): void {
        if (app.hasToken) {
            pending ??= { force: false, refresh: true };
        }
    }

    // A commit this tab learns of, by a sync of its own or another view's, is checked unless some
    // tab has checked it already: the checks follow the repository rather than the clock. The
    // listing has just been refreshed, too, whatever the last check found of it.
    watch(() => files.commitId, (commit) => {
        if (commit !== null) {
            listingError.value = null;
            void request({ force: false, refresh: false });
        }
    });

    // Signing out, or a session expiring, leaves nothing checked, here or in storage: the record
    // names the notes and what is wrong with them, and must not outlive the session, as the
    // listing it was made from does not. At once, rather than at the next flush, so that a check
    // under way knows of it before it reports.
    watch(() => app.hasToken, (hasToken) => {
        if (!hasToken) {
            session += 1;
            record.value = null;
            listingError.value = null;
            removeStoredRecord();
        }
    }, { flush: 'sync' });

    return {
        busy,
        checking,
        checked,
        listingError,
        record,
        sections,
        fileCount,
        status,
        failingChecks,
        notice,
        check,
        checkIfStale,
        hold,
    };
});
