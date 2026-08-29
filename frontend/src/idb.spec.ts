import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListEntry2 } from '@/api';

type Idb = typeof import('@/idb');

// `idb.ts` memoizes its database handle at module scope, so each test gets a fresh module and a
// fresh IndexedDB rather than inheriting the previous test's connection.
async function freshIdb(): Promise<Idb> {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
    return await import('@/idb');
}

function entry(path: string): ListEntry2 {
    return {
        path,
        size: path.length,
        mime_type: 'text/markdown',
        metadata: { tags: [] },
        title: path,
        time: '2020-01-01T00:00:00+00:00',
    };
}

const listing = [
    entry('.tasks/a.md'),
    entry('.tasks/nested/b.md'),
    entry('.tasksextra/c.md'),   // shares the prefix up to the slash, must not be included
    entry('.task/d.md'),         // sorts before '.tasks/'
    entry('notes/e.md'),         // sorts after '.tasks/'
    entry('zz/f.md'),
];

let idb: Idb;

beforeEach(async () => {
    idb = await freshIdb();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('readEntriesByPrefix', () => {
    beforeEach(async () => {
        await idb.replaceEntries('commit-1', listing);
    });

    // The store is keyed by `path`, so a prefix is a bounded range over the primary key and no
    // secondary index is involved. The bound has to stop exactly at the prefix, though.
    it('returns exactly the rows under the prefix', async () => {
        const rows = await idb.readEntriesByPrefix<ListEntry2>('.tasks/');
        expect(rows?.map((r) => r.path).sort()).toEqual(['.tasks/a.md', '.tasks/nested/b.md']);
    });

    it('does not spill into a sibling path that merely shares the leading characters', async () => {
        const rows = await idb.readEntriesByPrefix<ListEntry2>('.tasks/');
        expect(rows?.map((r) => r.path)).not.toContain('.tasksextra/c.md');
    });

    it('reads far fewer rows than the whole listing', async () => {
        const all = await idb.readAllEntries<ListEntry2>();
        const some = await idb.readEntriesByPrefix<ListEntry2>('.tasks/');
        expect(all?.length).toBe(listing.length);
        expect(some?.length).toBeLessThan(all?.length as number);
    });

    it('reads the whole listing for an empty prefix', async () => {
        const rows = await idb.readEntriesByPrefix<ListEntry2>('');
        expect(rows?.length).toBe(listing.length);
    });

    it('returns an empty list, not null, when nothing matches', async () => {
        expect(await idb.readEntriesByPrefix<ListEntry2>('nothing/')).toEqual([]);
    });

    it('handles a prefix without a trailing slash', async () => {
        const rows = await idb.readEntriesByPrefix<ListEntry2>('.tasks');
        expect(rows?.map((r) => r.path).sort())
            .toEqual(['.tasks/a.md', '.tasks/nested/b.md', '.tasksextra/c.md']);
    });
});

describe('the entry store', () => {
    it('replaces rows and their commit id together', async () => {
        await idb.replaceEntries('commit-1', listing);
        expect(await idb.readCacheCommitId()).toBe('commit-1');

        await idb.replaceEntries('commit-2', [entry('only.md')]);
        expect((await idb.readAllEntries<ListEntry2>())?.map((r) => r.path)).toEqual(['only.md']);
        expect(await idb.readCacheCommitId()).toBe('commit-2');
    });

    it('applies a delta and moves the commit id with it', async () => {
        await idb.replaceEntries('commit-1', listing);
        await idb.applyEntryDelta('commit-2', [entry('.tasks/new.md')], ['.tasks/a.md']);

        const rows = await idb.readEntriesByPrefix<ListEntry2>('.tasks/');
        expect(rows?.map((r) => r.path).sort()).toEqual(['.tasks/nested/b.md', '.tasks/new.md']);
        expect(await idb.readCacheCommitId()).toBe('commit-2');
    });

    it('overwrites a changed row rather than duplicating it', async () => {
        await idb.replaceEntries('commit-1', listing);
        await idb.applyEntryDelta('commit-2', [{ ...entry('.tasks/a.md'), title: 'renamed' }], []);

        const rows = await idb.readEntriesByPrefix<ListEntry2>('.tasks/');
        expect(rows?.filter((r) => r.path === '.tasks/a.md')).toHaveLength(1);
        expect(rows?.find((r) => r.path === '.tasks/a.md')?.title).toBe('renamed');
    });

    it('reads a single row without the listing', async () => {
        await idb.replaceEntries('commit-1', listing);
        expect((await idb.readEntry<ListEntry2>('.tasks/a.md'))?.path).toBe('.tasks/a.md');
        expect(await idb.readEntry<ListEntry2>('missing.md')).toBeUndefined();
    });

    it('wipes rows and commit id together', async () => {
        await idb.replaceEntries('commit-1', listing);
        await idb.clearEntries();
        expect(await idb.readAllEntries<ListEntry2>()).toEqual([]);
        expect(await idb.readCacheCommitId()).toBeUndefined();
    });
});

// A broken or absent cache must never break the app: every operation degrades to null so the
// caller falls through to the API.
describe('without IndexedDB', () => {
    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal('indexedDB', undefined);
        idb = await import('@/idb');
    });

    it('degrades to null rather than throwing', async () => {
        await expect(idb.replaceEntries('commit-1', listing)).resolves.toBeUndefined();
        await expect(idb.readEntriesByPrefix<ListEntry2>('.tasks/')).resolves.toBeNull();
        await expect(idb.readAllEntries<ListEntry2>()).resolves.toBeNull();
        await expect(idb.readCacheCommitId()).resolves.toBeNull();
    });
});
