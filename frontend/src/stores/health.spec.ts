import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

import type { ListEntry2 } from '@/api';

const stores = vi.hoisted(() => ({
    app: { hasToken: true, invalidateToken: vi.fn() },
    files: { entries: [] as ListEntry2[], refresh: vi.fn() },
    calendars: {
        // Read, and empty: without them the category check says it could not verify any.
        categoryMap: new Map(),
        alarmDefaults: {},
        configurationErrors: [] as string[],
        loadConfiguration: vi.fn(),
        feedReports: vi.fn(),
    },
    taskSettings: { problems: [] as string[], load: vi.fn() },
    plans: { errors: {} as Record<string, string>, loadMonths: vi.fn() },
}));
vi.mock('@/stores/app', async () => {
    const { reactive } = await import('vue');
    return { useAppStore: () => reactive(stores.app) };
});
vi.mock('@/stores/files', async () => {
    const { reactive } = await import('vue');
    return { useFilesStore: () => reactive(stores.files) };
});
vi.mock('@/stores/calendars', async () => {
    const { reactive } = await import('vue');
    return { CALENDARS_PATH: '.mory/calendars.yaml', useCalendarsStore: () => reactive(stores.calendars) };
});
vi.mock('@/stores/taskSettings', async () => {
    const { reactive } = await import('vue');
    return { TASK_SETTINGS_PATH: '.mory/tasks.yaml', useTaskSettingsStore: () => reactive(stores.taskSettings) };
});
vi.mock('@/stores/plans', async () => {
    const { reactive } = await import('vue');
    return { usePlansStore: () => reactive(stores.plans) };
});
import { HEALTH_CHECK_INTERVAL_MS, useHealthStore } from '@/stores/health';

function entry(path: string, metadata: unknown): ListEntry2 {
    return {
        path,
        size: 0,
        mime_type: 'text/markdown',
        metadata: metadata as ListEntry2['metadata'],
        title: null,
        time: '2026-10-20T00:00:00+09:00',
    };
}

// Two notes moried could not read the frontmatter of, which is one check failing, and a file under
// the plans that is never read as one, which is another, at a warning.
const BROKEN = [
    entry('one.md', { error: 'did not find expected key' }),
    entry('two.md', { error: 'did not find expected key' }),
];
const MISNAMED_PLAN = entry('.mory/plans/notes.yaml', null);

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.resetAllMocks();
    Object.assign(reactive(stores.app), { hasToken: true });
    Object.assign(reactive(stores.files), { entries: [] });
    Object.assign(reactive(stores.calendars), { configurationErrors: [] });
    Object.assign(reactive(stores.taskSettings), { problems: [] });
    Object.assign(reactive(stores.plans), { errors: {} });
    stores.files.refresh.mockResolvedValue([]);
    stores.calendars.loadConfiguration.mockResolvedValue([]);
    stores.calendars.feedReports.mockResolvedValue([]);
    stores.taskSettings.load.mockResolvedValue(undefined);
    stores.plans.loadMonths.mockResolvedValue(undefined);
});
afterEach(() => {
    vi.useRealTimers();
    disposePinia(pinia);
});

describe('the verdict', () => {
    it('is unknown until a check has finished', async () => {
        const listing = deferred<ListEntry2[]>();
        stores.files.refresh.mockReturnValue(listing.promise);
        const health = useHealthStore();
        expect(health.status).toBeNull();
        const done = health.check();
        expect(health.checking).toBe(true);
        expect(health.status).toBeNull();
        listing.resolve([]);
        await done;
        expect(health.checking).toBe(false);
        expect(health.status).toBe('ok');
        expect(health.notice).toBeNull();
    });

    it('counts the checks that fail rather than their problems, by severity', async () => {
        reactive(stores.files).entries = [...BROKEN];
        const health = useHealthStore();
        await health.check();
        expect(health.failingChecks).toEqual({ error: 1, warning: 0 });
        expect(health.notice).toMatchObject({ severity: 'error', text: '1 health error' });

        reactive(stores.files).entries = [...BROKEN, MISNAMED_PLAN];
        expect(health.failingChecks).toEqual({ error: 1, warning: 1 });
        expect(health.notice).toMatchObject({ severity: 'error', text: '1 health error, 1 warning' });

        reactive(stores.files).entries = [MISNAMED_PLAN];
        expect(health.status).toBe('warning');
        expect(health.notice).toMatchObject({ severity: 'warning', text: '1 health warning' });
    });

    // The sidebar keeps the checks computed on every view, and the events alone take about 9 ms on
    // the dev notes.
    it('works out again only the section whose reads changed', async () => {
        reactive(stores.files).entries = [...BROKEN];
        stores.calendars.feedReports.mockResolvedValue([{ id: 'work', name: 'Work', error: 'HTTP 404' }]);
        const health = useHealthStore();
        await health.check();
        const [frontmatter, events, tasks, settings] = health.sections;
        await health.check();
        expect(health.sections).toEqual([frontmatter, events, tasks, settings]);
        expect(health.sections[3]).toBe(settings);
        reactive(stores.taskSettings).problems = ['Invalid default_lead_time; use whole days or weeks, such as 7d or 2w.'];
        expect(health.sections[0]).toBe(frontmatter);
        expect(health.sections[1]).toBe(events);
        expect(health.sections[2]).toBe(tasks);
        expect(health.sections[3]).not.toBe(settings);
    });

    it('moves its window to the day each check runs on', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 23, 12));
        const health = useHealthStore();
        await health.check();
        expect(health.sections.find((section) => section.id === 'events')?.title).toBe('Events and task dates, 2025-11-23 to 2027-11-23');
        expect(stores.calendars.feedReports).toHaveBeenLastCalledWith('2026-11-23');
        vi.setSystemTime(new Date(2026, 10, 25, 12));
        await health.check();
        expect(health.sections.find((section) => section.id === 'events')?.title).toBe('Events and task dates, 2025-11-25 to 2027-11-25');
        expect(stores.calendars.feedReports).toHaveBeenLastCalledWith('2026-11-25');
    });
});

describe('a check', () => {
    it('asked for while one runs runs once more after it', async () => {
        const listing = deferred<ListEntry2[]>();
        stores.files.refresh.mockReturnValueOnce(listing.promise);
        const health = useHealthStore();
        const first = health.check();
        const second = health.check();
        void health.check();
        listing.resolve([]);
        await Promise.all([first, second]);
        expect(stores.files.refresh).toHaveBeenCalledTimes(2);
        expect(health.checking).toBe(false);
    });

    it('reads nothing else, and fails no check, when the listing cannot be refreshed', async () => {
        stores.files.refresh.mockRejectedValue(new Error('Network Error'));
        const health = useHealthStore();
        await health.check();
        expect(health.listingError).toBe('Error: Network Error');
        expect(health.status).toBeNull();
        expect(health.notice).toBeNull();
        expect(stores.calendars.loadConfiguration).not.toHaveBeenCalled();
        expect(stores.calendars.feedReports).not.toHaveBeenCalled();
        expect(stores.taskSettings.load).not.toHaveBeenCalled();
        expect(stores.plans.loadMonths).not.toHaveBeenCalled();
    });

    it('keeps the last verdict when the listing cannot be refreshed', async () => {
        reactive(stores.files).entries = [...BROKEN];
        stores.calendars.feedReports.mockResolvedValue([{ id: 'work', name: 'Work', error: 'HTTP 500' }]);
        const health = useHealthStore();
        await health.check();
        expect(health.failingChecks).toEqual({ error: 2, warning: 0 });
        stores.files.refresh.mockRejectedValue(new Error('Network Error'));
        await health.check();
        expect(health.listingError).toBe('Error: Network Error');
        expect(health.failingChecks).toEqual({ error: 2, warning: 0 });
        expect(health.status).toBe('error');
    });

    it('asks to log in again when the session has expired, rather than reporting it', async () => {
        stores.files.refresh.mockRejectedValue({ isAxiosError: true, response: { status: 401 }, message: 'Request failed with status code 401' });
        stores.app.invalidateToken.mockImplementation(() => {
            reactive(stores.app).hasToken = false;
        });
        const health = useHealthStore();
        const first = health.check();
        // Asked for while the first runs, which ends the session: nothing to ask without one.
        void health.check();
        await first;
        expect(stores.files.refresh).toHaveBeenCalledTimes(1);
        expect(stores.app.invalidateToken).toHaveBeenCalledTimes(1);
        expect(health.listingError).toBeNull();
        expect(health.status).toBeNull();
        expect(stores.calendars.loadConfiguration).not.toHaveBeenCalled();
    });

    it('reports a read that fails beside what the others found', async () => {
        stores.calendars.loadConfiguration.mockRejectedValue(new Error('HTTP 500'));
        stores.calendars.feedReports.mockResolvedValue([
            { id: 'work', name: 'Work', error: 'HTTP 404' },
            { id: 'home', name: 'Home', error: null },
        ]);
        reactive(stores.taskSettings).problems = ['Invalid default_lead_time; use whole days or weeks, such as 7d or 2w.'];
        const health = useHealthStore();
        await health.check();
        const settings = health.sections.find((section) => section.id === 'settings')!;
        const problemsOf = (id: string) => settings.checks.find((item) => item.id === id)?.problems.map((problem) => problem.message);
        expect(problemsOf('calendars-settings')).toEqual(['It cannot be read: Error: HTTP 500']);
        expect(problemsOf('calendar-feeds')).toEqual(['Work: HTTP 404']);
        expect(problemsOf('tasks-settings')).toEqual(['Invalid default_lead_time; use whole days or weeks, such as 7d or 2w.']);
        expect(health.failingChecks).toEqual({ error: 3, warning: 0 });
    });

    it('reads the month of each listed plan once the listing is refreshed', async () => {
        stores.files.refresh.mockImplementation(async () => {
            reactive(stores.files).entries = [entry('.mory/plans/2026-11.yaml', null), MISNAMED_PLAN];
            return stores.files.entries;
        });
        const health = useHealthStore();
        await health.check();
        expect(stores.plans.loadMonths).toHaveBeenCalledWith(['2026-11']);
    });
});

describe('a check only if stale', () => {
    it('runs again only once the interval has passed since one reached moried', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const health = useHealthStore();
        await health.checkIfStale();
        expect(stores.files.refresh).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(HEALTH_CHECK_INTERVAL_MS - 1);
        await health.checkIfStale();
        expect(stores.files.refresh).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        await health.checkIfStale();
        expect(stores.files.refresh).toHaveBeenCalledTimes(2);
    });

    it('runs again at once after a check that could not reach moried', async () => {
        stores.files.refresh.mockRejectedValueOnce(new Error('Network Error'));
        const health = useHealthStore();
        await health.checkIfStale();
        await health.checkIfStale();
        expect(stores.files.refresh).toHaveBeenCalledTimes(2);
        expect(health.status).toBe('ok');
    });

    it('joins the check under way', async () => {
        const listing = deferred<ListEntry2[]>();
        stores.files.refresh.mockReturnValueOnce(listing.promise);
        const health = useHealthStore();
        const first = health.check();
        const joined = health.checkIfStale();
        listing.resolve([]);
        await Promise.all([first, joined]);
        expect(stores.files.refresh).toHaveBeenCalledTimes(1);
    });

    it('asks nothing while held, and asks once released', async () => {
        const health = useHealthStore();
        health.hold(true);
        await health.checkIfStale();
        expect(stores.files.refresh).not.toHaveBeenCalled();
        health.hold(false);
        await vi.waitFor(() => expect(health.status).toBe('ok'));
        expect(stores.calendars.loadConfiguration).toHaveBeenCalledTimes(1);
    });

    it('runs nothing without a session', async () => {
        reactive(stores.app).hasToken = false;
        const health = useHealthStore();
        await health.checkIfStale();
        expect(stores.files.refresh).not.toHaveBeenCalled();
    });
});

describe('the session', () => {
    it('leaves nothing checked once it ends', async () => {
        reactive(stores.files).entries = [...BROKEN];
        const health = useHealthStore();
        await health.check();
        expect(health.status).toBe('error');
        reactive(stores.app).hasToken = false;
        expect(health.status).toBeNull();
        expect(health.notice).toBeNull();
        reactive(stores.app).hasToken = true;
        await health.checkIfStale();
        expect(stores.files.refresh).toHaveBeenCalledTimes(2);
        expect(health.status).toBe('error');
    });

    it('checks again for a login made while a check of the last session ran', async () => {
        const feeds = deferred<{ id: string; name: string; error: string | null }[]>();
        stores.calendars.feedReports.mockReturnValueOnce(feeds.promise);
        const health = useHealthStore();
        const first = health.check();
        await vi.waitFor(() => expect(stores.calendars.feedReports).toHaveBeenCalledTimes(1));
        reactive(stores.app).hasToken = false;
        reactive(stores.app).hasToken = true;
        // What a login asks for, which finds the old session's check under way.
        void health.checkIfStale();
        feeds.resolve([{ id: 'work', name: 'Work', error: 'Request failed with status code 401' }]);
        await first;
        expect(stores.files.refresh).toHaveBeenCalledTimes(2);
        expect(health.status).toBe('ok');
    });
});
