import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

        await store.load('2024-05-01', '2024-05-31');

        expect(store.available).toEqual([{ id: 'work', name: 'Work', color: '#3f51b5' }]);
    });

    // So the view's control is not empty on its first paint, before any events have arrived.
    it('falls back to the enabled subscriptions before anything is loaded', async () => {
        apiMocks.getNote.mockResolvedValue({ data: YAML_FILE });
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

        await store.loadSubscriptions();

        // The disabled one is left out: the backend never fetches it, so hiding it would do
        // nothing.
        expect(store.available).toEqual([{ id: 'work', name: 'Work', color: '#3f51b5' }]);
    });
});

describe('subscriptions', () => {
    it('reads the list out of the repository', async () => {
        apiMocks.getNote.mockResolvedValue({ data: YAML_FILE });
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

        await store.loadSubscriptions();

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
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

        await store.loadSubscriptions();

        expect(store.subscriptions).toEqual([]);
        expect(store.hasLoadedSubscriptions).toBe(true);
    });

    it('does not swallow a failure that is not a missing file', async () => {
        apiMocks.getNote.mockRejectedValue(
            Object.assign(new Error('boom'), { response: { status: 500 } }));
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

        await expect(store.loadSubscriptions()).rejects.toThrow('boom');
    });

    it('writes the list back and drops what was loaded for the old one', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

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
    it('fetches a window once and serves the same one from memory', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

        await store.load('2024-05-01', '2024-05-31');
        await store.load('2024-05-01', '2024-05-31');

        expect(apiMocks.getImportedEvents).toHaveBeenCalledOnce();
        expect(store.events[0].name).toBe('Standup');
    });

    it('fetches again for a different window', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

        await store.load('2024-05-01', '2024-05-31');
        await store.load('2024-06-01', '2024-06-30');

        expect(apiMocks.getImportedEvents).toHaveBeenCalledTimes(2);
    });

    it('does not fire two requests for one window at once', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

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
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

        await store.load('2024-05-01', '2024-05-31');

        expect(store.events).toHaveLength(1);
        expect(store.errors).toEqual(['Broken: the calendar responded 404']);
    });

    it('reports the colour and name each calendar was configured with', async () => {
        apiMocks.getNote.mockResolvedValue({ data: YAML_FILE });
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

        await store.loadSubscriptions();
        await store.load('2024-05-01', '2024-05-31');

        expect(store.colorOf.get('work')).toBe('#3f51b5');
        expect(store.nameOf.get('work')).toBe('Work');
    });

    // Showing May's events under June's dates is worse than showing none, and leaving the window
    // marked unloaded is what lets a later navigation retry it.
    it('drops what was loaded when a later window fails', async () => {
        apiMocks.getImportedEvents.mockResolvedValueOnce(response());
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

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
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

        const first = store.load('2024-05-01', '2024-05-31');
        const second = store.load('2024-06-01', '2024-06-30');

        await expect(first).rejects.toThrow('offline');
        await second;

        expect(apiMocks.getImportedEvents).toHaveBeenCalledTimes(2);
        expect(store.events).toHaveLength(1);
    });

    it('does not refetch a window a queued caller is already waiting on', async () => {
        apiMocks.getImportedEvents.mockResolvedValue(response());
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

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
        const { useCalendarsStore } = await load();
        const store = useCalendarsStore();

        await expect(store.load('2024-05-01', '2024-05-31')).rejects.toThrow('offline');
        expect(store.isLoading).toBe(false);
    });
});
