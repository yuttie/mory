import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntriesResponse, ListEntry2 } from '@/api';

// Hoisted so the same mock functions survive `vi.resetModules()`, which every test does: `idb.ts`
// memoizes its database handle at module scope, and a handle from a previous test's IndexedDB
// never fires its events again.
const apiMocks = vi.hoisted(() => ({
    getEntries: vi.fn<(since?: string) => Promise<EntriesResponse>>(),
    getHeadCommitId: vi.fn<() => Promise<string>>(async () => 'c0'),
    addNote: vi.fn<(path: string, content: string) => Promise<{ data: null }>>(
        async () => ({ data: null })),
    renameNote: vi.fn<(oldPath: string, newPath: string) => Promise<{ data: null }>>(
        async () => ({ data: null })),
    deleteNote: vi.fn<(path: string) => Promise<{ data: boolean }>>(async () => ({ data: true })),
    getNote: vi.fn<(path: string) => Promise<{ data: string }>>(async () => ({ data: '' })),
    uploadFiles: vi.fn<(form: FormData) => Promise<{ data: [string, string][] }>>(
        async () => ({ data: [] })),
    searchNotes: vi.fn<(pattern: string) => Promise<{ data: unknown[] }>>(
        async () => ({ data: [] })),
    noteExists: vi.fn<(path: string) => Promise<boolean>>(async () => false),
}));

vi.mock('@/api', () => apiMocks);

function entry(path: string): ListEntry2 {
    return {
        path,
        size: 1,
        mime_type: 'text/markdown',
        metadata: { tags: [] },
        title: path,
        time: '2020-01-01T00:00:00+00:00',
    };
}

// Stands in for the repository the backend serves. `commit` is what its entry cache actually
// describes and `head` is where the repository is; they differ while the cache is catching up,
// which is the state `settle`'s retry exists for.
function repository(paths: string[]) {
    const state = { paths: [...paths], commit: 'c0', head: 'c0' };

    function advance(next: string[], { lagging = false } = {}) {
        state.head = `c${Number(state.head.slice(1)) + 1}`;
        if (lagging) {
            // HEAD has moved but the cache has not caught up, so the listing served is still the
            // old one -- honestly labelled with the commit it describes.
            return;
        }
        state.paths = next;
        state.commit = state.head;
    }

    function catchUp(next: string[]) {
        state.paths = next;
        state.commit = state.head;
    }

    apiMocks.getEntries.mockImplementation(async (): Promise<EntriesResponse> => ({
        kind: 'full',
        commit: state.commit,
        head: state.head,
        entries: state.paths.map(entry),
    }));

    return { state, advance, catchUp };
}

async function load(options: { indexedDB?: boolean } = {}) {
    vi.resetModules();
    vi.stubGlobal('indexedDB', options.indexedDB === false ? undefined : new IDBFactory());
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
    setActivePinia(createPinia());
    return {
        idb: await import('@/idb'),
        ...(await import('@/composables/entrySubset')),
        ...(await import('@/stores/files')),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the subset', () => {
    it('is the slice of the listing under the prefix', async () => {
        const { useEntrySubset } = await load();
        repository(['.tasks/a.md', '.tasks/b.md', 'notes/c.md', '.tasksextra/d.md']);
        const subset = useEntrySubset('.tasks/');
        await subset.init();
        expect(subset.entries.value.map((e) => e.path)).toEqual(['.tasks/a.md', '.tasks/b.md']);
    });

    it('tracks the listing as it changes, holding no copy of its own', async () => {
        const { useEntrySubset } = await load();
        const repo = repository(['.tasks/a.md']);
        const subset = useEntrySubset('.tasks/');
        await subset.init();
        expect(subset.entries.value).toHaveLength(1);

        repo.advance(['.tasks/a.md', '.tasks/b.md']);
        await subset.refresh();
        expect(subset.entries.value.map((e) => e.path)).toEqual(['.tasks/a.md', '.tasks/b.md']);
    });

    it('takes the whole listing for an empty prefix', async () => {
        const { useEntrySubset } = await load();
        repository(['.tasks/a.md', 'notes/c.md']);
        const subset = useEntrySubset('');
        await subset.init();
        expect(subset.entries.value).toHaveLength(2);
    });
});

describe('init', () => {
    // The point of the prefix read: paint from the cache without waiting for the whole listing.
    it('primes from IndexedDB before the listing request answers', async () => {
        const { useEntrySubset, idb } = await load();
        await idb.replaceEntries('c0', [entry('.tasks/cached.md'), entry('notes/other.md')]);

        let release: (value: EntriesResponse) => void = () => {};
        apiMocks.getEntries.mockImplementation(
            () => new Promise<EntriesResponse>((resolve) => { release = resolve; }),
        );

        const subset = useEntrySubset('.tasks/');
        const running = subset.init();
        await vi.waitFor(() => expect(subset.entries.value).toHaveLength(1));
        expect(subset.entries.value[0].path).toBe('.tasks/cached.md');

        release({ kind: 'full', commit: 'c1', head: 'c1', entries: [entry('.tasks/fresh.md')] });
        await running;
        // The listing wins the moment it lands; the primed rows were only a first paint.
        expect(subset.entries.value.map((e) => e.path)).toEqual(['.tasks/fresh.md']);
    });

    it('starts empty when nothing is cached', async () => {
        const { useEntrySubset } = await load();
        repository(['.tasks/a.md']);
        const subset = useEntrySubset('.tasks/');
        const running = subset.init();
        expect(subset.entries.value).toEqual([]);
        await running;
        expect(subset.entries.value).toHaveLength(1);
    });

    it('still loads when IndexedDB is unavailable', async () => {
        const { useEntrySubset } = await load({ indexedDB: false });
        repository(['.tasks/a.md']);
        const subset = useEntrySubset('.tasks/');
        await subset.init();
        expect(subset.entries.value).toHaveLength(1);
    });
});

describe('hasLoadedOnce', () => {
    it('is false until the first load and true afterwards', async () => {
        const { useEntrySubset } = await load();
        repository(['.tasks/a.md']);
        const subset = useEntrySubset('.tasks/');
        expect(subset.hasLoadedOnce.value).toBe(false);
        await subset.init();
        expect(subset.hasLoadedOnce.value).toBe(true);
    });

    // Not `files.commitId !== null`: that goes null on every invalidation, so a view gated on it
    // would blank itself after each save.
    it('stays true across an invalidation', async () => {
        const { useEntrySubset, useFilesStore } = await load();
        repository(['.tasks/a.md']);
        const files = useFilesStore();
        const subset = useEntrySubset('.tasks/');
        await subset.init();

        files.invalidate();
        expect(files.commitId).toBeNull();
        expect(subset.hasLoadedOnce.value).toBe(true);
    });
});

describe('settle', () => {
    it('returns after one request when the write is already visible', async () => {
        const { useEntrySubset } = await load();
        const repo = repository([]);
        const subset = useEntrySubset('.tasks/');
        await subset.init();

        repo.advance(['.tasks/new.md']);
        apiMocks.getEntries.mockClear();
        await subset.settle('.tasks/new.md', true);

        expect(subset.entries.value.map((e) => e.path)).toEqual(['.tasks/new.md']);
        expect(apiMocks.getEntries).toHaveBeenCalledTimes(1);
    });

    // The bug this exists for: the backend serves the listing at the commit its cache actually
    // describes, which can lag HEAD, so a single refresh can come back without the write that
    // prompted it. These two wait out the real backoff rather than faking timers, which
    // deadlocks against fake-indexeddb's own scheduling.
    it('retries when the backend serves a listing that lags HEAD', async () => {
        const { useEntrySubset } = await load();
        const repo = repository([]);
        const subset = useEntrySubset('.tasks/');
        await subset.init();

        repo.advance(['.tasks/new.md'], { lagging: true });
        const settled = subset.settle('.tasks/new.md', true);

        // The first look finds HEAD moved but the listing still the old one.
        await vi.waitFor(() => expect(apiMocks.getEntries).toHaveBeenCalled());
        expect(subset.entries.value).toEqual([]);

        repo.catchUp(['.tasks/new.md']);
        await settled;
        expect(subset.entries.value.map((e) => e.path)).toEqual(['.tasks/new.md']);
    });

    it('gives up after one retry rather than spinning', async () => {
        const { useEntrySubset } = await load();
        const repo = repository([]);
        const subset = useEntrySubset('.tasks/');
        await subset.init();

        // The write never becomes visible.
        repo.advance(['.tasks/new.md'], { lagging: true });
        apiMocks.getEntries.mockClear();
        await expect(subset.settle('.tasks/new.md', true)).resolves.toBeUndefined();

        // A refresh may ask twice while the cache lags, but the retry itself happens once, so
        // the request count is bounded rather than open-ended.
        expect(apiMocks.getEntries.mock.calls.length).toBeLessThanOrEqual(4);
    });

    it('waits for a deleted path to disappear', async () => {
        const { useEntrySubset } = await load();
        const repo = repository(['.tasks/gone.md']);
        const subset = useEntrySubset('.tasks/');
        await subset.init();
        expect(subset.entries.value).toHaveLength(1);

        repo.advance([]);
        await subset.settle('.tasks/gone.md', false);
        expect(subset.entries.value).toEqual([]);
    });
});

describe('a delta response', () => {
    it('is merged into the subset', async () => {
        const { useEntrySubset } = await load();
        repository(['.tasks/a.md', '.tasks/b.md', 'notes/c.md']);
        const subset = useEntrySubset('.tasks/');
        await subset.init();

        apiMocks.getEntries.mockImplementation(async (since?: string) => {
            expect(since).toBe('c0');
            return {
                kind: 'delta',
                commit: 'c1',
                head: 'c1',
                base: 'c0',
                changed: [entry('.tasks/added.md')],
                deleted: ['.tasks/a.md'],
            } satisfies EntriesResponse;
        });
        await subset.refresh();

        expect(subset.entries.value.map((e) => e.path).sort())
            .toEqual(['.tasks/added.md', '.tasks/b.md']);
    });
});
