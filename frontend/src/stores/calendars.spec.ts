import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';

import type { EntriesResponse, ImportedEventsResponse } from '@/api';

const apiMocks = vi.hoisted(() => ({
    getEntries: vi.fn<(since?: string) => Promise<EntriesResponse>>(
        async () => ({ kind: 'full', commit: 'c0', head: 'c0', entries: [] })),
    getHeadCommitId: vi.fn<() => Promise<string>>(async () => 'c0'),
    getNote: vi.fn<(path: string) => Promise<{ data: string }>>(),
    addNote: vi.fn<(path: string, content: string) => Promise<{ data: null }>>(
        async () => ({ data: null })),
    renameNote: vi.fn(async () => ({ data: null })),
    deleteNote: vi.fn(async () => ({ data: true })),
    uploadFiles: vi.fn(async () => ({ data: [] })),
    searchNotes: vi.fn(async () => ({ data: [] })),
    noteExists: vi.fn(async () => false),
    getImportedEvents: vi.fn<(start: string, end: string) => Promise<ImportedEventsResponse>>(),
}));

vi.mock('@/api', () => apiMocks);

async function load() {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
    setActivePinia(createPinia());
    return await import('@/stores/calendars');
}

// A store as a page load makes one, over modules `load` has reset.
async function freshStore() {
    const { useCalendarsStore } = await load();
    return useCalendarsStore();
}

// A store whose configuration file holds `yaml`, which is read when a test loads it.
async function storeWith(yaml: string) {
    apiMocks.getNote.mockResolvedValue({ data: yaml });
    return await freshStore();
}

function missing(): Error {
    return Object.assign(new Error('Not Found'), { response: { status: 404 } });
}

function response(over: Partial<ImportedEventsResponse> = {}): ImportedEventsResponse {
    return {
        calendars: [{ id: 'work', name: 'Work', color: '#3f51b5', error: null }],
        events: [{
            calendar: 'work',
            uid: 'a@example',
            recurrence_id: '2024-05-01 09:00:00+09:00',
            name: 'Standup',
            start: '2024-05-01 09:00:00+09:00',
        }],
        series: {},
        truncated: false,
        ...over,
    };
}

const YAML_FILE = `calendars:
    - id: work
      name: Work
      url: https://example.invalid/work.ics
      color: "#3f51b5"
      enabled: true
    - id: old
      url: https://example.invalid/old.ics
      enabled: false
`;

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('available', () => {
    it('lists what the backend reported for the loaded window', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const store = await freshStore();

        await store.load('2024-05-01', '2024-05-31');

        expect(store.available).toEqual([{ id: 'work', name: 'Work', color: '#3f51b5' }]);
    });

    // So the view's control is not empty on its first paint, before any events have arrived.
    it('falls back to the enabled subscriptions before anything is loaded', async () => {
        const store = await storeWith(YAML_FILE);

        await store.loadConfiguration();

        // The disabled one is left out: the backend never fetches it, so hiding it would do
        // nothing.
        expect(store.available).toEqual([{ id: 'work', name: 'Work', color: '#3f51b5' }]);
    });
});

describe('loading the configuration', () => {
    // A held read, to have a load in flight while another is asked for.
    function held() {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        apiMocks.getNote.mockImplementation(async () => {
            await gate;
            return { data: YAML_FILE };
        });
        return release;
    }

    it('reads the file once for loads that overlap, and gives each the same answer', async () => {
        const release = held();
        const store = await freshStore();

        const first = store.loadConfiguration();
        const second = store.loadConfiguration();
        release();

        expect((await first).map(({ id }) => id)).toEqual(['work', 'old']);
        expect(await second).toEqual(await first);
        expect(apiMocks.getNote).toHaveBeenCalledTimes(1);
    });

    it('reads it again for a load asked for afterwards, which is how a view finds a changed file', async () => {
        apiMocks.getNote.mockResolvedValue({ data: YAML_FILE });
        const store = await freshStore();

        await store.loadConfiguration();
        await store.loadConfiguration();

        expect(apiMocks.getNote).toHaveBeenCalledTimes(2);
    });

    it('is loaded for good once it has been read, and ensureLoaded reads it only until then', async () => {
        apiMocks.getNote.mockResolvedValue({ data: YAML_FILE });
        const store = await freshStore();
        expect(store.hasLoadedConfiguration).toBe(false);

        await store.ensureLoaded();
        await store.ensureLoaded();

        expect(store.hasLoadedConfiguration).toBe(true);
        expect(apiMocks.getNote).toHaveBeenCalledTimes(1);
    });

    it('lets ensureLoaded join a load in flight rather than start another', async () => {
        const release = held();
        const store = await freshStore();

        const loading = store.loadConfiguration();
        const ensured = store.ensureLoaded();
        release();
        await Promise.all([loading, ensured]);

        expect(apiMocks.getNote).toHaveBeenCalledTimes(1);
    });

    it('tries again from ensureLoaded when the file could not be read, and not for one that is missing', async () => {
        apiMocks.getNote.mockRejectedValueOnce(Object.assign(new Error('Server Error'), { response: { status: 500 } }));
        const store = await freshStore();
        await expect(store.ensureLoaded()).rejects.toThrow('Server Error');
        expect(store.hasLoadedConfiguration).toBe(false);

        apiMocks.getNote.mockRejectedValue(missing());
        await store.ensureLoaded();
        expect(store.hasLoadedConfiguration).toBe(true);
        await store.ensureLoaded();
        expect(apiMocks.getNote).toHaveBeenCalledTimes(2);
    });
});

describe('subscriptions', () => {
    it('reads the list out of the repository', async () => {
        const store = await storeWith(YAML_FILE);

        await store.loadConfiguration();

        expect(store.subscriptions).toEqual([
            {
                id: 'work',
                name: 'Work',
                url: 'https://example.invalid/work.ics',
                color: '#3f51b5',
                enabled: true,
            },
            // A missing name falls back to the id, and a missing colour stays absent.
            {
                id: 'old',
                name: 'old',
                url: 'https://example.invalid/old.ics',
                color: undefined,
                enabled: false,
            },
        ]);
    });

    // The normal state before any calendar is added, which is not an error.
    it('treats a missing file as no calendars', async () => {
        apiMocks.getNote.mockRejectedValue(missing());
        const store = await freshStore();

        await store.loadConfiguration();

        expect(store.subscriptions).toEqual([]);
        expect(store.hasLoadedConfiguration).toBe(true);
    });

    it('does not swallow a failure that is not a missing file', async () => {
        apiMocks.getNote.mockRejectedValue(
            Object.assign(new Error('boom'), { response: { status: 500 } }));
        const store = await freshStore();

        await expect(store.loadConfiguration()).rejects.toThrow('boom');
    });

    it('writes the list back and drops what was loaded for the old one', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const store = await freshStore();

        await store.load('2024-05-01', '2024-05-31');
        expect(store.events).toHaveLength(1);

        await store.saveSubscriptions([{
            id: 'work',
            name: 'Work',
            url: 'https://example.invalid/work.ics',
            enabled: true,
        }]);

        expect(apiMocks.addNote).toHaveBeenCalledOnce();
        const [path, content] = apiMocks.addNote.mock.calls[0];
        expect(path).toBe('.mory/calendars.yaml');
        expect(content).toContain('https://example.invalid/work.ics');
        // The subscription list decides what the events request returns, so the loaded window
        // describes a configuration that no longer exists.
        expect(store.events).toHaveLength(0);
    });
});

describe('loading events', () => {
    it('refetches after a subscription save even when the previous response arrives late', async () => {
        let release!: (value: ImportedEventsResponse) => void;
        apiMocks.getImportedEvents
            .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
            .mockResolvedValueOnce(response({ events: [] }));
        const store = await freshStore();
        const oldLoad = store.load('2024-05-01', '2024-05-31');

        await store.saveSubscriptions([]);
        const refreshed = store.load('2024-05-01', '2024-05-31');
        release(response());
        await oldLoad;
        expect(store.events).toEqual([]);
        await refreshed;

        expect(apiMocks.getImportedEvents).toHaveBeenCalledTimes(2);
        expect(store.events).toEqual([]);
    });

    it('fetches a window once and serves the same one from memory', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const store = await freshStore();

        await store.load('2024-05-01', '2024-05-31');
        await store.load('2024-05-01', '2024-05-31');

        expect(apiMocks.getImportedEvents).toHaveBeenCalledOnce();
        expect(store.events[0].name).toBe('Standup');
    });

    it('fetches again for a different window', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const store = await freshStore();

        await store.load('2024-05-01', '2024-05-31');
        await store.load('2024-06-01', '2024-06-30');

        expect(apiMocks.getImportedEvents).toHaveBeenCalledTimes(2);
    });

    it('does not fire two requests for one window at once', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const store = await freshStore();

        await Promise.all([
            store.load('2024-05-01', '2024-05-31'),
            store.load('2024-05-01', '2024-05-31'),
        ]);

        expect(apiMocks.getImportedEvents).toHaveBeenCalledOnce();
    });

    // One dead feed must not blank the others, so a failure is data rather than an exception.
    it('surfaces a per-calendar failure without losing the calendars that worked', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response({
            calendars: [
                { id: 'work', name: 'Work', color: '#3f51b5', error: null },
                { id: 'dead', name: 'Broken', color: null, error: 'the calendar responded 404' },
            ],
        }));
        const store = await freshStore();

        await store.load('2024-05-01', '2024-05-31');

        expect(store.events).toHaveLength(1);
        expect(store.errors).toEqual(['Broken: the calendar responded 404']);
    });

    it('reports the colour and name each calendar was configured with', async () => {
        apiMocks.getNote.mockResolvedValue({ data: YAML_FILE });
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const store = await freshStore();

        await store.loadConfiguration();
        await store.load('2024-05-01', '2024-05-31');

        expect(store.colorOf.get('work')).toBe('#3f51b5');
        expect(store.nameOf.get('work')).toBe('Work');
    });

    // Showing May's events under June's dates is worse than showing none, and leaving the window
    // marked unloaded is what lets a later navigation retry it.
    it('drops what was loaded when a later window fails', async () => {
        apiMocks.getImportedEvents.mockResolvedValueOnce(response());
        const store = await freshStore();

        await store.load('2024-05-01', '2024-05-31');
        expect(store.events).toHaveLength(1);

        apiMocks.getImportedEvents.mockRejectedValueOnce(new Error('offline'));
        await expect(store.load('2024-06-01', '2024-06-30')).rejects.toThrow('offline');

        expect(store.events).toHaveLength(0);
    });

    // Regression: a caller queued behind another window awaited the in-flight promise and so
    // inherited its rejection -- its own window was never fetched, and nothing retriggered it.
    it('fetches a queued window even when the one before it fails', async () => {
        apiMocks.getImportedEvents
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(response());
        const store = await freshStore();

        const first = store.load('2024-05-01', '2024-05-31');
        const second = store.load('2024-06-01', '2024-06-30');

        await expect(first).rejects.toThrow('offline');
        await second;

        expect(apiMocks.getImportedEvents).toHaveBeenCalledTimes(2);
        expect(store.events).toHaveLength(1);
    });

    it('does not refetch a window a queued caller is already waiting on', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const store = await freshStore();

        await Promise.all([
            store.load('2024-05-01', '2024-05-31'),
            store.load('2024-06-01', '2024-06-30'),
            store.load('2024-06-01', '2024-06-30'),
        ]);

        // May once, June once -- not twice for June because two callers asked while it queued.
        expect(apiMocks.getImportedEvents).toHaveBeenCalledTimes(2);
    });

    it('clears the loading flag even when the request fails', async () => {
        apiMocks.getImportedEvents.mockRejectedValue(new Error('offline'));
        const store = await freshStore();

        await expect(store.load('2024-05-01', '2024-05-31')).rejects.toThrow('offline');
        expect(store.isLoading).toBe(false);
    });
});

describe('task date colours', () => {
    const WITH_COLORS = `${YAML_FILE}task_dates:
    due_by: "#0d47a1"
    deadline: "#880e4f"
`;

    it('reads them out of the same file', async () => {
        const store = await storeWith(WITH_COLORS);

        await store.loadConfiguration();

        expect(store.taskDateColors).toEqual({ due_by: '#0d47a1', deadline: '#880e4f' });
    });

    // Hand-edited YAML: anything but a non-empty string means "use the default".
    it('drops a colour that is not usable text', async () => {
        apiMocks.getNote.mockResolvedValue({
            data: `${YAML_FILE}task_dates:\n    due_by: 12\n    deadline: "  "\n`,
        });
        const store = await freshStore();

        await store.loadConfiguration();

        expect(store.taskDateColors).toEqual({});
    });

    it('keeps the subscriptions when only the colours are saved', async () => {
        const store = await storeWith(WITH_COLORS);

        await store.loadConfiguration();
        await store.saveTaskDateColors({ deadline: '#b71c1c' });

        const [path, content] = apiMocks.addNote.mock.calls[0];
        expect(path).toBe('.mory/calendars.yaml');
        expect(content).toContain('https://example.invalid/work.ics');
        expect(content).toContain('#b71c1c');
        expect(content).not.toContain('due_by');
    });

    it('keeps the colours when only the subscriptions are saved', async () => {
        const store = await storeWith(WITH_COLORS);

        await store.loadConfiguration();
        await store.saveSubscriptions([{
            id: 'work',
            name: 'Work',
            url: 'https://example.invalid/work.ics',
            enabled: true,
        }]);

        const [, content] = apiMocks.addNote.mock.calls[0];
        expect(content).toContain('#0d47a1');
        expect(content).toContain('#880e4f');
    });
});

describe('alarm defaults', () => {
    const WITH_ALARMS = `${YAML_FILE}alarms:
    timed: [-10m]
    all_day: -1d 18:00
    due_by: [09:00]
    deadline: []
`;

    it('reads each kind the file sets, a single string as a list of one', async () => {
        const store = await storeWith(WITH_ALARMS);

        await store.loadConfiguration();

        expect(store.alarmDefaults).toEqual({
            timed: ['-10m'],
            allDay: ['-1d 18:00'],
            dueBy: ['09:00'],
            deadline: [],
        });
    });

    // Hand-edited YAML: an entry that is not an alarm is dropped, as moried drops it, and a kind
    // left empty is not set -- which is not the same as an empty list.
    it('drops what is not usable, and leaves a kind that is empty unset', async () => {
        apiMocks.getNote.mockResolvedValue({
            data: `${YAML_FILE}alarms:\n    timed: [10m, -5m, soon]\n    all_day:\n    due_by: 5\n`,
        });
        const store = await freshStore();

        await store.loadConfiguration();

        expect(store.alarmDefaults).toEqual({ timed: ['-5m'], dueBy: [] });
    });

    it('has none when there is no file, or none is set', async () => {
        apiMocks.getNote.mockRejectedValue(missing());
        const store = await freshStore();

        await store.loadConfiguration();

        expect(store.alarmDefaults).toEqual({});
    });

    it('counts the built-in default for each kind the file leaves unset', async () => {
        apiMocks.getNote.mockResolvedValue({
            data: `${YAML_FILE}alarms:\n    timed: [-5m]\n    deadline: []\n`,
        });
        const store = await freshStore();

        expect(store.effectiveAlarmDefaults).toEqual({ timed: ['0m'], allDay: [], dueBy: [], deadline: [] });
        await store.loadConfiguration();

        expect(store.effectiveAlarmDefaults).toEqual({ timed: ['-5m'], allDay: [], dueBy: [], deadline: [] });
    });

    // Dropped on reading, and the file is rewritten whole, so the next save would erase them.
    describe('that are not alarms', () => {
        const BAD = `${YAML_FILE}alarms:
    timed: [10m, -5m]
    due_by: soon
categories:
    meeting:
        alarms: [-1h, 5]
    fine:
        alarms: [-1h]
`;

        it('are reported, by where they are written, and dropped', async () => {
            const store = await storeWith(BAD);

            await store.loadConfiguration();

            expect(store.alarmDefaults).toEqual({ timed: ['-5m'], dueBy: [] });
            expect(store.errors).toHaveLength(3);
            expect(store.errors[0]).toMatch(/^\.mory\/calendars\.yaml: alarms\.timed: "10m" needs a sign/);
            expect(store.errors[1]).toMatch(/^\.mory\/calendars\.yaml: alarms\.due_by: "soon"/);
            expect(store.errors[2]).toMatch(/^\.mory\/calendars\.yaml: categories\.meeting\.alarms: 5 is not an alarm/);
            expect(store.errors.every((line) => line.endsWith('saving the settings removes it.'))).toBe(true);
        });

        it('are not reported when there are none, or no file', async () => {
            const store = await storeWith(WITH_ALARMS);
            await store.loadConfiguration();
            expect(store.errors).toEqual([]);

            apiMocks.getNote.mockRejectedValue(missing());
            await store.loadConfiguration();
            expect(store.errors).toEqual([]);
        });

        it('stop being reported once a save has rewritten the file without them', async () => {
            const store = await storeWith(BAD);
            await store.loadConfiguration();
            expect(store.errors).not.toEqual([]);

            await store.saveAlarmDefaults({ timed: ['-5m'] });

            expect(store.errors).toEqual([]);
            expect(YAML.parse(apiMocks.addNote.mock.calls.at(-1)![1]).alarms).toEqual({ timed: ['-5m'] });
        });

        it('are reported again when the file is read again and still has them', async () => {
            const store = await storeWith(BAD);

            await store.loadConfiguration();
            await store.loadConfiguration();

            expect(store.errors).toHaveLength(3);
        });
    });

    // The whole file is rewritten from what the store holds, so what it does not hold is lost.
    it('keeps them when the subscriptions, the colours or the categories are saved', async () => {
        const store = await storeWith(WITH_ALARMS);

        await store.loadConfiguration();
        await store.saveSubscriptions([{
            id: 'work',
            name: 'Work',
            url: 'https://example.invalid/work.ics',
            enabled: true,
        }]);
        await store.saveTaskDateColors({ deadline: '#b71c1c' });
        await store.saveCategories([{ id: 'meeting' }]);

        for (const [, content] of apiMocks.addNote.mock.calls) {
            expect(YAML.parse(content).alarms).toEqual({
                timed: ['-10m'],
                all_day: ['-1d 18:00'],
                due_by: ['09:00'],
                deadline: [],
            });
        }
        expect(apiMocks.addNote.mock.calls).toHaveLength(3);
    });

    it('writes only the kinds that are set, in the file\'s order, and keeps the rest of it', async () => {
        const store = await storeWith(WITH_ALARMS);

        await store.loadConfiguration();
        await store.saveAlarmDefaults({ deadline: ['-1d 18:00', '-2h'], timed: [] });

        const [path, content] = apiMocks.addNote.mock.calls[0];
        expect(path).toBe('.mory/calendars.yaml');
        expect(content).toContain('https://example.invalid/work.ics');
        const alarms = YAML.parse(content).alarms;
        expect(alarms).toEqual({ timed: [], deadline: ['-1d 18:00', '-2h'] });
        expect(Object.keys(alarms)).toEqual(['timed', 'deadline']);
        expect(store.alarmDefaults).toEqual({ deadline: ['-1d 18:00', '-2h'], timed: [] });
    });

    // Read back by hand as often as by the app, and short enough to sit on the line that names it.
    it('writes each list on the line that names it', async () => {
        const store = await storeWith(WITH_ALARMS);

        await store.loadConfiguration();
        await store.saveAlarmDefaults({ timed: ['-10m', '0m'], allDay: ['-1d 18:00'] });
        await store.saveCategories([{ id: 'meeting', alarms: ['-1h'] }, { id: 'quiet', alarms: [] }]);

        const [, content] = apiMocks.addNote.mock.calls[1];
        expect(content).toContain('timed: [-10m, 0m]');
        expect(content).toContain('all_day: [-1d 18:00]');
        expect(content).toContain('alarms: [-1h]');
        expect(content).toContain('alarms: []');
        // Only alarms: the subscriptions are in the block style they were.
        expect(content).toMatch(/calendars:\n {4}- id: work\n/);
    });

    it('leaves the block out of the file when none is set', async () => {
        const store = await storeWith(WITH_ALARMS);

        await store.loadConfiguration();
        await store.saveAlarmDefaults({});

        const [, content] = apiMocks.addNote.mock.calls[0];
        expect(content).not.toContain('alarms');
    });
});

describe('event categories', () => {
    const WITH_CATEGORIES = `${YAML_FILE}categories:
    meeting:
        color: "#1565c0"
        name: "[MTG] {{name}}"
    meeting/1on1:
    trip:
        color: "#2e7d32"
`;

    it('reads them out of the same file, in its order', async () => {
        const store = await storeWith(WITH_CATEGORIES);

        await store.loadConfiguration();

        expect(store.categories).toEqual([
            { id: 'meeting', color: '#1565c0', name: '[MTG] {{name}}' },
            { id: 'meeting/1on1' },
            { id: 'trip', color: '#2e7d32' },
        ]);
        expect(store.categoryMap?.get('meeting/1on1')).toEqual({});
    });

    // Hand-edited YAML: a category that is not a mapping is dropped, and a field that is not usable
    // text is left to fall back.
    it('drops what is not usable', async () => {
        apiMocks.getNote.mockResolvedValue({
            data: `${YAML_FILE}categories:\n    meeting: blue\n    trip:\n        color: 12\n        name: "  "\n`,
        });
        const store = await freshStore();

        await store.loadConfiguration();

        expect(store.categories).toEqual([{ id: 'trip' }]);
    });

    // Every category a note names would otherwise be reported as unknown on the first paint.
    it('has no map to check against until the file is read', async () => {
        const store = await freshStore();

        expect(store.categoryMap).toBeUndefined();
    });

    it('has none, rather than unknown ones, when there is no file', async () => {
        apiMocks.getNote.mockRejectedValue(missing());
        const store = await freshStore();

        await store.loadConfiguration();

        expect(store.categoryMap).toEqual(new Map());
    });

    it('has no map to check against when the file cannot be read', async () => {
        apiMocks.getNote.mockRejectedValue(new Error('offline'));
        const store = await freshStore();

        await expect(store.loadConfiguration()).rejects.toThrow('offline');
        expect(store.categoryMap).toBeUndefined();
    });

    it('keeps them when only the subscriptions are saved', async () => {
        const store = await storeWith(WITH_CATEGORIES);

        await store.loadConfiguration();
        await store.saveSubscriptions([{
            id: 'work',
            name: 'Work',
            url: 'https://example.invalid/work.ics',
            enabled: true,
        }]);

        const [, content] = apiMocks.addNote.mock.calls[0];
        expect(content).toContain('[MTG] {{name}}');
        expect(content).toContain('meeting/1on1: {}');
        expect(content).toContain('#2e7d32');
    });

    describe('alarms', () => {
        const WITH_ALARMS = `${YAML_FILE}categories:
    meeting:
        color: "#1565c0"
        alarms: [-10m, 0m]
    meeting/1on1:
        alarms: -15m
    meeting/quiet:
        alarms: []
    meeting/standup:
        alarms:
    trip:
        alarms: [10m, -1d 18:00, soon]
`;

        // A set list is not an unset one, which is what an empty `alarms:` is.
        it('reads a category\'s, an empty list as set and an empty value as not', async () => {
            const store = await storeWith(WITH_ALARMS);

            await store.loadConfiguration();

            expect(store.categories).toEqual([
                { id: 'meeting', color: '#1565c0', alarms: ['-10m', '0m'] },
                { id: 'meeting/1on1', alarms: ['-15m'] },
                { id: 'meeting/quiet', alarms: [] },
                { id: 'meeting/standup' },
                { id: 'trip', alarms: ['-1d 18:00'] },
            ]);
            expect(store.categoryMap?.get('meeting')?.alarms).toEqual(['-10m', '0m']);
        });

        it('keeps them when the subscriptions are saved, as written', async () => {
            const store = await storeWith(WITH_ALARMS);

            await store.loadConfiguration();
            await store.saveSubscriptions([{
                id: 'work',
                name: 'Work',
                url: 'https://example.invalid/work.ics',
                enabled: true,
            }]);

            const [, content] = apiMocks.addNote.mock.calls[0];
            expect(YAML.parse(content).categories).toEqual({
                meeting: { color: '#1565c0', alarms: ['-10m', '0m'] },
                'meeting/1on1': { alarms: ['-15m'] },
                'meeting/quiet': { alarms: [] },
                'meeting/standup': {},
                trip: { alarms: ['-1d 18:00'] },
            });
        });

        it('writes what the settings give', async () => {
            const store = await storeWith(WITH_ALARMS);

            await store.loadConfiguration();
            await store.saveCategories([{ id: 'meeting', alarms: ['-1h'] }, { id: 'quiet', alarms: [] }]);

            const [, content] = apiMocks.addNote.mock.calls[0];
            expect(YAML.parse(content).categories).toEqual({
                meeting: { alarms: ['-1h'] },
                quiet: { alarms: [] },
            });
        });
    });

    it('keeps the subscriptions when only the categories are saved', async () => {
        const store = await storeWith(WITH_CATEGORIES);

        await store.loadConfiguration();
        await store.saveCategories([{ id: 'meeting', color: '#0d47a1' }]);

        const [path, content] = apiMocks.addNote.mock.calls[0];
        expect(path).toBe('.mory/calendars.yaml');
        expect(content).toContain('https://example.invalid/work.ics');
        expect(content).toContain('#0d47a1');
        expect(content).not.toContain('trip');
        // Read back as written, so what the settings save is what the calendar then draws.
        expect(YAML.parse(content).categories).toEqual({ meeting: { color: '#0d47a1' } });
    });
});
