import { createPinia, disposePinia, setActivePinia } from 'pinia';
import type { Pinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive, watch } from 'vue';

import type { ListEntry2 } from '@/api';

const stores = vi.hoisted(() => ({
    app: { hasToken: true, invalidateToken: vi.fn() },
    files: { entries: [] as ListEntry2[], commitId: null as string | null, schema: 7 as number | undefined, refresh: vi.fn() },
    calendars: {
        // Read, and empty: without them the category check says it could not verify any.
        categoryMap: new Map(),
        alarmDefaults: {},
        configurationErrors: [] as string[],
        subscriptions: [] as { id: string; url: string }[],
        reloadConfiguration: vi.fn(),
        feedReports: vi.fn(),
    },
    taskSettings: { problems: [] as string[], readAt: null as string | null, load: vi.fn() },
    plans: { errors: {} as Record<string, string>, loadMonths: vi.fn(), readAt: vi.fn() },
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
import { HEALTH_RECORD_STORAGE_KEY, RECORD_LIFETIME_MS, useHealthStore } from '@/stores/health';

const KEY = HEALTH_RECORD_STORAGE_KEY;

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

// One section failing one check at a warning, as another tab's record might hold it.
const WARNING_SECTIONS = [{
    id: 'frontmatter',
    title: 'Frontmatter',
    checks: [{ id: 'x', title: 'x', description: '', problems: [{ severity: 'warning', message: 'm' }] }],
}];

// A request that never reached moried, as axios fails one.
function unreached(message = 'Network Error'): Error {
    return Object.assign(new Error(message), { isAxiosError: true });
}

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// The storage every tab shares, and the window that hears another tab write to it: the tests run
// in Node, which has neither.
function memoryStorage(): Storage {
    const items = new Map<string, string>();
    return {
        get length() {
            return items.size;
        },
        key: (index: number) => [...items.keys()][index] ?? null,
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, String(value)),
        removeItem: (key: string) => void items.delete(key),
        clear: () => items.clear(),
    };
}

function storageEvent(key: string | null, newValue: string | null): Event {
    return Object.assign(new Event('storage'), { key, newValue });
}

function stored(): Record<string, unknown> {
    return JSON.parse(localStorage.getItem(KEY)!);
}

// Each tab of the app: the same storage, a store of its own, and every tab alive until the test
// ends, as in a browser. Node has Web Locks, so tabs wait for each other's checks as there.
const pinias: Pinia[] = [];
function tab() {
    const pinia = createPinia();
    pinias.push(pinia);
    setActivePinia(pinia);
    return useHealthStore();
}

// Holds the lock the checks take, as another tab checking would, until `release` is called.
async function lockedElsewhere() {
    const released = deferred();
    const granted = deferred();
    const held = navigator.locks.request('mory-health-check', () => {
        granted.resolve();
        return released.promise;
    });
    await granted.promise;
    return async () => {
        released.resolve();
        await held;
    };
}

// The reads a check makes past the listing, which a check found current makes none of.
function checksRead(): number {
    return stores.calendars.reloadConfiguration.mock.calls.length;
}

// HEAD as moried names it, which a sync puts in the store.
let head: string;

beforeEach(() => {
    vi.resetAllMocks();
    head = 'c1';
    Object.assign(reactive(stores.app), { hasToken: true });
    Object.assign(reactive(stores.files), { entries: [], commitId: null, schema: 7 });
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('window', new EventTarget());
    Object.assign(reactive(stores.calendars), { configurationErrors: [], subscriptions: [] });
    Object.assign(reactive(stores.taskSettings), { problems: [], readAt: null });
    Object.assign(reactive(stores.plans), { errors: {} });
    stores.files.refresh.mockImplementation(async () => {
        reactive(stores.files).commitId = head;
        return stores.files.entries;
    });
    stores.calendars.reloadConfiguration.mockResolvedValue([]);
    stores.calendars.feedReports.mockResolvedValue([]);
    // Reads that reach their files, at the commit listed as they begin.
    stores.taskSettings.load.mockImplementation(async () => {
        reactive(stores.taskSettings).readAt = stores.files.commitId;
    });
    stores.plans.loadMonths.mockResolvedValue(undefined);
    stores.plans.readAt.mockImplementation(() => stores.files.commitId);
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const pinia of pinias.splice(0)) {
        disposePinia(pinia);
    }
    vi.unstubAllGlobals();
});

describe('the verdict', () => {
    it('is unknown until a check is recorded', async () => {
        const feeds = deferred<never[]>();
        stores.calendars.feedReports.mockReturnValue(feeds.promise);
        const health = tab();
        expect(health.status).toBeNull();
        const done = health.check();
        expect(health.busy).toBe(true);
        await vi.waitFor(() => expect(health.checking).toBe(true));
        expect(health.status).toBeNull();
        feeds.resolve([]);
        await done;
        expect(health.busy).toBe(false);
        expect(health.checking).toBe(false);
        expect(health.status).toBe('ok');
        expect(health.notice).toBeNull();
    });

    it('counts the checks that fail rather than their problems, by severity', async () => {
        reactive(stores.files).entries = [...BROKEN];
        const health = tab();
        await health.check();
        expect(health.failingChecks).toEqual({ error: 1, warning: 0 });
        expect(health.notice).toMatchObject({ severity: 'error', text: '1 health error' });

        reactive(stores.files).entries = [...BROKEN, MISNAMED_PLAN];
        await health.check();
        expect(health.failingChecks).toEqual({ error: 1, warning: 1 });
        expect(health.notice).toMatchObject({ severity: 'error', text: '1 health error, 1 warning' });

        reactive(stores.files).entries = [MISNAMED_PLAN];
        await health.check();
        expect(health.status).toBe('warning');
        expect(health.notice).toMatchObject({ severity: 'warning', text: '1 health warning' });
    });

    it('says how many files were checked, to every tab', async () => {
        reactive(stores.files).entries = [...BROKEN, MISNAMED_PLAN];
        const health = tab();
        expect(health.fileCount).toBe(0);
        await health.checkIfStale();
        expect(health.fileCount).toBe(3);
        expect(tab().fileCount).toBe(3);
    });

    it('moves its window to the day each check runs on', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 23, 12));
        const health = tab();
        await health.check();
        expect(health.sections.find((section) => section.id === 'events')?.title).toBe('Events and task dates, 2025-11-23 to 2027-11-23');
        expect(stores.calendars.feedReports).toHaveBeenLastCalledWith('2026-11-23');
        vi.setSystemTime(new Date(2026, 10, 25, 12));
        await health.check();
        expect(health.sections.find((section) => section.id === 'events')?.title).toBe('Events and task dates, 2025-11-25 to 2027-11-25');
        expect(stores.calendars.feedReports).toHaveBeenLastCalledWith('2026-11-25');
    });
});

describe('the record', () => {
    it('spares a check of a commit already checked', async () => {
        const health = tab();
        await health.checkIfStale();
        await health.checkIfStale();
        expect(stores.files.refresh).toHaveBeenCalledTimes(2);
        expect(checksRead()).toBe(1);
    });

    it('is checked again for a commit this tab learns of', async () => {
        const health = tab();
        await health.checkIfStale();
        reactive(stores.files).entries = [...BROKEN];
        // Another view's sync, after a save.
        reactive(stores.files).commitId = 'c2';
        await vi.waitFor(() => expect(health.status).toBe('error'));
        expect(checksRead()).toBe(2);
        expect(health.record?.commit).toBe('c2');
        // Invalidated by a save, then listed at the commit the record is of: nothing to check.
        const asked: boolean[] = [];
        watch(() => health.busy, (busy) => asked.push(busy), { flush: 'sync' });
        reactive(stores.files).commitId = null;
        await nextTick();
        reactive(stores.files).commitId = 'c2';
        await nextTick();
        await vi.waitFor(() => expect(asked).toEqual([true, false]));
        expect(checksRead()).toBe(2);
    });

    it('is checked again the next day, and once its lifetime has passed', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 23, 23, 30));
        const health = tab();
        await health.checkIfStale();
        vi.setSystemTime(new Date(2026, 10, 24, 0, 10));
        await health.checkIfStale();
        expect(checksRead()).toBe(2);
        vi.advanceTimersByTime(RECORD_LIFETIME_MS - 1);
        await health.checkIfStale();
        expect(checksRead()).toBe(2);
        vi.advanceTimersByTime(1);
        await health.checkIfStale();
        expect(checksRead()).toBe(3);
    });

    // A deploy of moried alone, which may say something new of the same commit.
    it('is checked again for the same commit listed under another schema', async () => {
        const health = tab();
        await health.checkIfStale();
        reactive(stores.files).schema = 8;
        await health.checkIfStale();
        expect(checksRead()).toBe(2);
        expect(health.record?.schema).toBe(8);
    });

    it('is neither trusted nor shown from another build', async () => {
        reactive(stores.files).entries = [...BROKEN];
        await tab().checkIfStale();
        localStorage.setItem(KEY, JSON.stringify({ ...stored(), build: 'an older build' }));
        const other = tab();
        expect(other.status).toBeNull();
        await other.checkIfStale();
        expect(checksRead()).toBe(2);
    });

    it('is what another tab checked, which this one does not check again', async () => {
        reactive(stores.files).entries = [...BROKEN];
        await tab().checkIfStale();
        const other = tab();
        expect(other.status).toBe('error');
        await other.checkIfStale();
        expect(stores.files.refresh).toHaveBeenCalledTimes(2);
        expect(checksRead()).toBe(1);
    });

    it('is checked once by tabs that ask at once', async () => {
        const feeds = deferred<never[]>();
        stores.calendars.feedReports.mockReturnValueOnce(feeds.promise);
        const one = tab();
        const two = tab();
        const asked = [one.checkIfStale(), two.checkIfStale()];
        await vi.waitFor(() => expect(checksRead()).toBe(1));
        // The second waits for the first's check rather than making its own.
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(checksRead()).toBe(1);
        feeds.resolve([]);
        await Promise.all(asked);
        expect(checksRead()).toBe(1);
        expect(two.status).toBe('ok');
        expect(two.record).toEqual(one.record);
    });

    it('follows what another tab records of the commit it lists', async () => {
        const health = tab();
        await health.checkIfStale();
        window.dispatchEvent(storageEvent(KEY, JSON.stringify({ ...stored(), sections: WARNING_SECTIONS })));
        expect(health.notice).toMatchObject({ severity: 'warning', text: '1 health warning' });
    });

    // A tab whose listing lags writes what it found of the commit before.
    it('keeps a record of the commit it lists over another tab\'s of another', async () => {
        vi.stubGlobal('document', { visibilityState: 'visible' });
        const health = tab();
        await health.checkIfStale();
        window.dispatchEvent(storageEvent(KEY, JSON.stringify({ ...stored(), commit: 'c0', sections: WARNING_SECTIONS })));
        // Asking moried for HEAD finds this tab's commit current.
        await vi.waitFor(() => expect(stores.files.refresh).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(health.busy).toBe(false));
        expect(health.status).toBe('ok');
        expect(checksRead()).toBe(1);
        // Unless its own is of another commit than it lists too, as after a save.
        reactive(stores.files).commitId = null;
        window.dispatchEvent(storageEvent(KEY, JSON.stringify({ ...stored(), commit: 'c2', sections: WARNING_SECTIONS })));
        expect(health.record?.commit).toBe('c2');
        expect(health.status).toBe('warning');
    });

    // Another tab's save, which this tab has not synced.
    it('asks moried for HEAD when shown a record of a commit it does not list, and takes it then', async () => {
        vi.stubGlobal('document', { visibilityState: 'hidden' });
        const health = tab();
        await health.checkIfStale();
        head = 'c2';
        const newer = JSON.stringify({ ...stored(), commit: 'c2', sections: WARNING_SECTIONS });
        localStorage.setItem(KEY, newer);
        window.dispatchEvent(storageEvent(KEY, newer));
        expect(health.busy).toBe(false);
        expect(health.status).toBe('ok');
        vi.stubGlobal('document', { visibilityState: 'visible' });
        window.dispatchEvent(storageEvent(KEY, newer));
        await vi.waitFor(() => expect(health.status).toBe('warning'));
        expect(health.record?.commit).toBe('c2');
        expect(stores.files.refresh).toHaveBeenCalledTimes(2);
        expect(checksRead()).toBe(1);
    });

    it('keeps what it shows over another build\'s record, but goes with a removal', async () => {
        const health = tab();
        await health.checkIfStale();
        const shape = JSON.stringify({ ...stored(), build: 'another build', sections: [{ id: 'frontmatter', title: 'Frontmatter' }] });
        window.dispatchEvent(storageEvent(KEY, shape));
        expect(health.status).toBe('ok');
        window.dispatchEvent(storageEvent(KEY, null));
        expect(health.status).toBeNull();
        await health.check();
        expect(health.status).toBe('ok');
        // Storage cleared whole.
        window.dispatchEvent(storageEvent(null, null));
        expect(health.status).toBeNull();
    });

    it('takes nothing from another tab while signed out', async () => {
        const health = tab();
        await health.checkIfStale();
        const text = localStorage.getItem(KEY);
        reactive(stores.app).hasToken = false;
        window.dispatchEvent(storageEvent(KEY, text));
        expect(health.status).toBeNull();
    });

    it('is checked again regardless when asked to', async () => {
        const health = tab();
        await health.checkIfStale();
        await health.check();
        expect(checksRead()).toBe(2);
    });

    it('is no record when storage holds something else, though it says it is of this build', async () => {
        await tab().checkIfStale();
        const record = stored();
        const others = [
            'not JSON',
            '{"sections": 3}',
            JSON.stringify({ ...record, sections: [{ id: 'frontmatter', title: 'Frontmatter' }] }),
            JSON.stringify({ ...record, sections: [{ ...WARNING_SECTIONS[0], checks: [{ ...WARNING_SECTIONS[0].checks[0], problems: [{ severity: 'fatal', message: 'm' }] }] }] }),
            JSON.stringify({ ...record, complete: false }),
            JSON.stringify({ ...record, feeds: { subscriptions: '[]', askedAt: Date.now(), errors: [3] } }),
        ];
        for (const text of others) {
            localStorage.setItem(KEY, text);
            const other = tab();
            expect(other.status).toBeNull();
            expect(other.notice).toBeNull();
        }
        const health = tab();
        await health.checkIfStale();
        expect(health.status).toBe('ok');
        expect(checksRead()).toBe(2);
    });

    // As while moried restarts: the next occasion checks again, and no other tab is told of it.
    it.each([
        ['.mory/calendars.yaml cannot be fetched', () => stores.calendars.reloadConfiguration.mockRejectedValue(unreached())],
        ['the feeds cannot be asked for', () => stores.calendars.feedReports.mockRejectedValue(unreached('Request failed with status code 502'))],
        ['.mory/tasks.yaml cannot be fetched', () => stores.taskSettings.load.mockImplementation(async () => {
            reactive(stores.taskSettings).readAt = null;
        })],
        ['a plan cannot be fetched', () => {
            reactive(stores.files).entries = [entry('.mory/plans/2026-11.yaml', null)];
            stores.plans.readAt.mockReturnValue(null);
        }],
        ['the listing moves on while it reads', () => stores.plans.loadMonths.mockImplementation(async () => {
            reactive(stores.files).commitId = null;
        })],
    ])('is shown but neither stored nor current when %s', async (_, failing) => {
        failing();
        const health = tab();
        await health.checkIfStale();
        expect(health.checked).toBe(true);
        expect(localStorage.getItem(KEY)).toBeNull();
        await health.checkIfStale();
        expect(checksRead()).toBe(2);
    });

    it('is stored and current when a file is broken rather than out of reach', async () => {
        // Not YAML, which moried cannot read either, and so refuses the feeds for.
        stores.calendars.reloadConfiguration.mockRejectedValue(new Error('Nested mappings are not allowed in compact mappings'));
        stores.calendars.feedReports.mockRejectedValue(unreached('Request failed with status code 500'));
        reactive(stores.taskSettings).problems = ['Invalid default_lead_time; use whole days or weeks, such as 7d or 2w.'];
        const health = tab();
        await health.checkIfStale();
        expect(health.failingChecks).toEqual({ error: 3, warning: 0 });
        expect(localStorage.getItem(KEY)).not.toBeNull();
        await health.checkIfStale();
        expect(checksRead()).toBe(1);
    });

    // moried's cache still lags HEAD: what it lists is not known to be any commit's.
    it('is neither stored nor current for a listing not known to be HEAD\'s', async () => {
        stores.files.refresh.mockImplementation(async () => {
            reactive(stores.files).commitId = null;
            return [];
        });
        const health = tab();
        await health.checkIfStale();
        expect(health.status).toBe('ok');
        expect(localStorage.getItem(KEY)).toBeNull();
        await health.checkIfStale();
        expect(checksRead()).toBe(2);
    });

    it('leaves no older record of the commit in storage when storage refuses a newer one', async () => {
        const health = tab();
        await health.checkIfStale();
        expect(localStorage.getItem(KEY)).not.toBeNull();
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });
        await health.check();
        expect(localStorage.getItem(KEY)).toBeNull();
        expect(health.status).toBe('ok');
    });

    it('goes when found in storage with no session', async () => {
        await tab().checkIfStale();
        const text = localStorage.getItem(KEY)!;
        reactive(stores.app).hasToken = false;
        // Left behind, as by a tab that wrote it as the session ended.
        localStorage.setItem(KEY, text);
        const health = tab();
        expect(health.record).toBeNull();
        expect(localStorage.getItem(KEY)).toBeNull();
        reactive(stores.app).hasToken = true;
        await health.checkIfStale();
        expect(checksRead()).toBe(2);
    });

    it('stops following other tabs once its store is gone', async () => {
        const health = tab();
        await health.checkIfStale();
        disposePinia(pinias.pop()!);
        window.dispatchEvent(storageEvent(KEY, null));
        expect(health.record).not.toBeNull();
    });
});

describe('the feeds', () => {
    const WORK = { id: 'work', url: 'https://example.invalid/work.ics' };

    it('are asked about once for the commits after while the subscriptions stay as they were', async () => {
        stores.calendars.feedReports.mockResolvedValue([{ id: 'work', name: 'Work', error: 'HTTP 404' }]);
        const health = tab();
        await health.checkIfStale();
        reactive(stores.files).commitId = 'c2';
        await vi.waitFor(() => expect(health.record?.commit).toBe('c2'));
        expect(checksRead()).toBe(2);
        expect(stores.calendars.feedReports).toHaveBeenCalledTimes(1);
        expect(health.failingChecks).toEqual({ error: 1, warning: 0 });
        // A subscription added in the settings, or by hand.
        stores.calendars.reloadConfiguration.mockImplementation(async () => {
            reactive(stores.calendars).subscriptions = [WORK];
        });
        reactive(stores.files).commitId = 'c3';
        await vi.waitFor(() => expect(health.record?.commit).toBe('c3'));
        expect(stores.calendars.feedReports).toHaveBeenCalledTimes(2);
    });

    it('are asked about again once what was found of them is an hour old, and the record goes with it', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 23, 12));
        const health = tab();
        await health.checkIfStale();
        vi.setSystemTime(new Date(2026, 10, 23, 12, 30));
        reactive(stores.files).commitId = 'c2';
        await vi.waitFor(() => expect(health.record?.commit).toBe('c2'));
        expect(stores.calendars.feedReports).toHaveBeenCalledTimes(1);
        head = 'c2';
        vi.setSystemTime(new Date(2026, 10, 23, 13));
        await health.checkIfStale();
        expect(checksRead()).toBe(3);
        expect(stores.calendars.feedReports).toHaveBeenCalledTimes(2);
    });

    it('are asked about again the next day, and when asked to check regardless', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 23, 23, 50));
        const health = tab();
        await health.checkIfStale();
        await health.check();
        expect(stores.calendars.feedReports).toHaveBeenCalledTimes(2);
        vi.setSystemTime(new Date(2026, 10, 24, 0, 10));
        reactive(stores.files).commitId = 'c2';
        await vi.waitFor(() => expect(health.record?.commit).toBe('c2'));
        expect(stores.calendars.feedReports).toHaveBeenCalledTimes(3);
        expect(stores.calendars.feedReports).toHaveBeenLastCalledWith('2026-11-24');
    });

    it('are taken over from what another tab found of them', async () => {
        await tab().checkIfStale();
        head = 'c2';
        await tab().checkIfStale();
        expect(checksRead()).toBe(2);
        expect(stores.calendars.feedReports).toHaveBeenCalledTimes(1);
    });

    it('are asked about again after they could not be, or the subscriptions could not be read', async () => {
        stores.calendars.feedReports.mockRejectedValueOnce(unreached('Request failed with status code 502'));
        const health = tab();
        await health.checkIfStale();
        reactive(stores.files).commitId = 'c2';
        await vi.waitFor(() => expect(health.record?.commit).toBe('c2'));
        expect(stores.calendars.feedReports).toHaveBeenCalledTimes(2);
        stores.calendars.reloadConfiguration.mockRejectedValueOnce(new Error('Nested mappings are not allowed in compact mappings'));
        reactive(stores.files).commitId = 'c3';
        await vi.waitFor(() => expect(health.record?.commit).toBe('c3'));
        reactive(stores.files).commitId = 'c4';
        await vi.waitFor(() => expect(health.record?.commit).toBe('c4'));
        expect(stores.calendars.feedReports).toHaveBeenCalledTimes(4);
    });
});

describe('a check', () => {
    it('asked for while one runs runs once more after it', async () => {
        const listing = deferred<ListEntry2[]>();
        stores.files.refresh.mockImplementationOnce(async () => {
            await listing.promise;
            reactive(stores.files).commitId = 'c1';
            return [];
        });
        const health = tab();
        const first = health.check();
        const second = health.check();
        void health.check();
        expect(health.busy).toBe(true);
        listing.resolve([]);
        await Promise.all([first, second]);
        expect(stores.files.refresh).toHaveBeenCalledTimes(2);
        expect(checksRead()).toBe(2);
        expect(health.busy).toBe(false);
    });

    it('reads nothing else, and fails no check, when the listing cannot be refreshed', async () => {
        stores.files.refresh.mockRejectedValue(new Error('Network Error'));
        const health = tab();
        await health.check();
        expect(health.listingError).toBe('Error: Network Error');
        expect(health.status).toBeNull();
        expect(health.notice).toBeNull();
        expect(stores.calendars.reloadConfiguration).not.toHaveBeenCalled();
        expect(stores.calendars.feedReports).not.toHaveBeenCalled();
        expect(stores.taskSettings.load).not.toHaveBeenCalled();
        expect(stores.plans.loadMonths).not.toHaveBeenCalled();
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('keeps the last verdict when the listing cannot be refreshed, and tries again when asked', async () => {
        reactive(stores.files).entries = [...BROKEN];
        stores.calendars.feedReports.mockResolvedValue([{ id: 'work', name: 'Work', error: 'HTTP 500' }]);
        const health = tab();
        await health.check();
        expect(health.failingChecks).toEqual({ error: 2, warning: 0 });
        stores.files.refresh.mockRejectedValueOnce(new Error('Network Error'));
        await health.checkIfStale();
        expect(health.listingError).toBe('Error: Network Error');
        expect(health.failingChecks).toEqual({ error: 2, warning: 0 });
        await health.checkIfStale();
        expect(stores.files.refresh).toHaveBeenCalledTimes(3);
        expect(health.listingError).toBeNull();
    });

    it('says the listing cannot be refreshed only until another view refreshes it', async () => {
        stores.files.refresh.mockRejectedValueOnce(new Error('Network Error'));
        const health = tab();
        await health.checkIfStale();
        expect(health.listingError).toBe('Error: Network Error');
        reactive(stores.files).commitId = 'c1';
        await vi.waitFor(() => expect(health.status).toBe('ok'));
        expect(health.listingError).toBeNull();
    });

    it('asks to log in again when the session has expired, rather than reporting it', async () => {
        stores.files.refresh.mockRejectedValue({ isAxiosError: true, response: { status: 401 }, message: 'Request failed with status code 401' });
        stores.app.invalidateToken.mockImplementation(() => {
            reactive(stores.app).hasToken = false;
        });
        const health = tab();
        const first = health.check();
        // Asked for while the first runs, which ends the session: nothing to ask without one.
        void health.check();
        await first;
        expect(stores.files.refresh).toHaveBeenCalledTimes(1);
        expect(stores.app.invalidateToken).toHaveBeenCalledTimes(1);
        expect(health.listingError).toBeNull();
        expect(health.status).toBeNull();
        expect(stores.calendars.reloadConfiguration).not.toHaveBeenCalled();
    });

    it('reports a read that fails beside what the others found', async () => {
        stores.calendars.reloadConfiguration.mockRejectedValue(unreached('Request failed with status code 500'));
        stores.calendars.feedReports.mockResolvedValue([
            { id: 'work', name: 'Work', error: 'HTTP 404' },
            { id: 'home', name: 'Home', error: null },
        ]);
        reactive(stores.taskSettings).problems = ['Invalid default_lead_time; use whole days or weeks, such as 7d or 2w.'];
        const health = tab();
        await health.check();
        const settings = health.sections.find((section) => section.id === 'settings')!;
        const problemsOf = (id: string) => settings.checks.find((item) => item.id === id)?.problems.map((problem) => problem.message);
        expect(problemsOf('calendars-settings')).toEqual(['It cannot be read: Error: Request failed with status code 500']);
        expect(problemsOf('calendar-feeds')).toEqual(['Work: HTTP 404']);
        expect(problemsOf('tasks-settings')).toEqual(['Invalid default_lead_time; use whole days or weeks, such as 7d or 2w.']);
        expect(health.failingChecks).toEqual({ error: 3, warning: 0 });
    });

    it('reads the month of each listed plan once the listing is refreshed', async () => {
        stores.files.refresh.mockImplementation(async () => {
            reactive(stores.files).entries = [entry('.mory/plans/2026-11.yaml', null), MISNAMED_PLAN];
            reactive(stores.files).commitId = 'c1';
            return stores.files.entries;
        });
        const health = tab();
        await health.check();
        expect(stores.plans.loadMonths).toHaveBeenCalledWith(['2026-11']);
    });

    it('waits while held, and runs one held meanwhile once released', async () => {
        const health = tab();
        health.hold(true);
        await health.checkIfStale();
        reactive(stores.files).commitId = 'c9';
        await nextTick();
        await health.check();
        expect(stores.files.refresh).not.toHaveBeenCalled();
        expect(checksRead()).toBe(0);
        health.hold(false);
        await vi.waitFor(() => expect(health.status).toBe('ok'));
        expect(checksRead()).toBe(1);
        // As the check asked for regardless, which a record of the commit would not have stopped.
        expect(stores.files.refresh).toHaveBeenCalledTimes(1);
    });

    // A save in the settings leaves the listing unknown until the next sync, which may not come.
    it('asks again as the hold ends though no commit was learned meanwhile', async () => {
        const health = tab();
        await health.checkIfStale();
        health.hold(true);
        reactive(stores.files).commitId = null;
        head = 'c2';
        await nextTick();
        health.hold(false);
        await vi.waitFor(() => expect(health.record?.commit).toBe('c2'));
        expect(checksRead()).toBe(2);
    });

    it('reads nothing once held for a check under way or asked for, and runs it once released', async () => {
        const listing = deferred<ListEntry2[]>();
        stores.files.refresh.mockImplementationOnce(async () => {
            await listing.promise;
            reactive(stores.files).commitId = 'c1';
            return [];
        });
        const health = tab();
        const first = health.checkIfStale();
        void health.check();
        health.hold(true);
        listing.resolve([]);
        await first;
        expect(checksRead()).toBe(0);
        health.hold(false);
        await vi.waitFor(() => expect(checksRead()).toBe(1));
        // The check asked for regardless, which no record would have stopped.
        await health.checkIfStale();
        expect(checksRead()).toBe(1);
    });

    it('reads nothing once held for a check that waited for another tab\'s', async () => {
        const release = await lockedElsewhere();
        try {
            const health = tab();
            const asked = health.checkIfStale();
            await vi.waitFor(() => expect(stores.files.refresh).toHaveBeenCalled());
            await new Promise((resolve) => setTimeout(resolve, 10));
            health.hold(true);
            await release();
            await asked;
            expect(checksRead()).toBe(0);
        }
        finally {
            await release();
        }
    });

    it('reads nothing for a session that ended while it waited for another tab\'s check', async () => {
        const release = await lockedElsewhere();
        try {
            const health = tab();
            const asked = health.checkIfStale();
            await vi.waitFor(() => expect(stores.files.refresh).toHaveBeenCalled());
            await new Promise((resolve) => setTimeout(resolve, 10));
            reactive(stores.app).hasToken = false;
            await release();
            await asked;
            expect(checksRead()).toBe(0);
            expect(stores.taskSettings.load).not.toHaveBeenCalled();
            expect(stores.plans.loadMonths).not.toHaveBeenCalled();
        }
        finally {
            await release();
        }
    });

    // Another tab's request that never ends holds the lock as long.
    it('checks without the lock once another tab has held it too long', async () => {
        const release = await lockedElsewhere();
        try {
            vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')));
            const health = tab();
            await health.checkIfStale();
            expect(AbortSignal.timeout).toHaveBeenCalledWith(30_000);
            expect(checksRead()).toBe(1);
            expect(health.status).toBe('ok');
        }
        finally {
            await release();
        }
    });

    it('waits for no other tab when asked to check regardless', async () => {
        const release = await lockedElsewhere();
        try {
            const health = tab();
            await health.check();
            expect(checksRead()).toBe(1);
        }
        finally {
            await release();
        }
    });

    it('runs nothing without a session', async () => {
        reactive(stores.app).hasToken = false;
        const health = tab();
        await health.checkIfStale();
        reactive(stores.files).commitId = 'c1';
        await nextTick();
        await vi.waitFor(() => expect(health.busy).toBe(false));
        expect(stores.files.refresh).not.toHaveBeenCalled();
        expect(checksRead()).toBe(0);
    });
});

describe('the session', () => {
    it('leaves nothing checked once it ends, here or in storage', async () => {
        reactive(stores.files).entries = [...BROKEN];
        const health = tab();
        await health.check();
        expect(health.status).toBe('error');
        reactive(stores.app).hasToken = false;
        expect(health.status).toBeNull();
        expect(health.notice).toBeNull();
        expect(localStorage.getItem(KEY)).toBeNull();
        reactive(stores.app).hasToken = true;
        await health.checkIfStale();
        expect(checksRead()).toBe(2);
        expect(health.status).toBe('error');
    });

    it('checks again for a login made while a check of the last session ran', async () => {
        const feeds = deferred<{ id: string; name: string; error: string | null }[]>();
        stores.calendars.feedReports.mockReturnValueOnce(feeds.promise);
        const health = tab();
        const first = health.check();
        await vi.waitFor(() => expect(stores.calendars.feedReports).toHaveBeenCalledTimes(1));
        reactive(stores.app).hasToken = false;
        reactive(stores.app).hasToken = true;
        // What a login asks for, which finds the old session's check under way.
        void health.checkIfStale();
        feeds.resolve([{ id: 'work', name: 'Work', error: 'Request failed with status code 401' }]);
        await first;
        expect(checksRead()).toBe(2);
        expect(health.status).toBe('ok');
    });
});
