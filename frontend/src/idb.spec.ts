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
        await idb.replaceEntries(undefined, 'commit-1', listing);
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
        await idb.replaceEntries(undefined, 'commit-1', listing);
        expect(await idb.readCacheCommitId()).toBe('commit-1');

        await idb.replaceEntries('commit-1', 'commit-2', [entry('only.md')]);
        expect((await idb.readAllEntries<ListEntry2>())?.map((r) => r.path)).toEqual(['only.md']);
        expect(await idb.readCacheCommitId()).toBe('commit-2');
    });

    it('applies a delta and moves the commit id with it', async () => {
        await idb.replaceEntries(undefined, 'commit-1', listing);
        await idb.applyEntryDelta('commit-1', 'commit-2', [entry('.tasks/new.md')], ['.tasks/a.md']);

        const rows = await idb.readEntriesByPrefix<ListEntry2>('.tasks/');
        expect(rows?.map((r) => r.path).sort()).toEqual(['.tasks/nested/b.md', '.tasks/new.md']);
        expect(await idb.readCacheCommitId()).toBe('commit-2');
    });

    it('overwrites a changed row rather than duplicating it', async () => {
        await idb.replaceEntries(undefined, 'commit-1', listing);
        await idb.applyEntryDelta('commit-1', 'commit-2', [{ ...entry('.tasks/a.md'), title: 'renamed' }], []);

        const rows = await idb.readEntriesByPrefix<ListEntry2>('.tasks/');
        expect(rows?.filter((r) => r.path === '.tasks/a.md')).toHaveLength(1);
        expect(rows?.find((r) => r.path === '.tasks/a.md')?.title).toBe('renamed');
    });

    // Another tab moved the rows on, or a logout cleared them, after the base was read.
    it('applies no delta to rows of another commit than its base', async () => {
        await idb.replaceEntries(undefined, 'commit-3', listing);
        await idb.applyEntryDelta('commit-1', 'commit-2', [entry('ghost.md')], []);
        expect(await idb.readCacheCommitId()).toBe('commit-3');
        expect(await idb.readEntryAt<ListEntry2>('commit-3', 'ghost.md')).toBeNull();

        await idb.clearEntries();
        await idb.applyEntryDelta('commit-3', 'commit-4', [entry('ghost.md')], []);
        expect(await idb.readAllEntries<ListEntry2>()).toEqual([]);
        expect(await idb.readCacheCommitId()).toBeNull();
    });

    it('reads the rows only while they describe the commit asked for', async () => {
        await idb.replaceEntries(undefined, 'commit-1', listing);
        expect((await idb.readEntriesAt<ListEntry2>('commit-1'))?.length).toBe(listing.length);
        expect(await idb.readEntriesAt<ListEntry2>('commit-2')).toBeNull();
    });

    it('reads a single row without the listing', async () => {
        await idb.replaceEntries(undefined, 'commit-1', listing);
        expect((await idb.readEntryAt<ListEntry2>('commit-1', '.tasks/a.md'))?.path).toBe('.tasks/a.md');
        expect(await idb.readEntryAt<ListEntry2>('commit-1', 'missing.md')).toBeNull();
    });

    // Read apart from the commit, a row another tab had removed since, or a logout had, was taken
    // for a file the current commit does not have.
    it('reads a single row only while the rows describe the commit asked for', async () => {
        await idb.replaceEntries(undefined, 'commit-1', listing);
        expect(await idb.readEntryAt<ListEntry2>('commit-2', '.tasks/a.md')).toBeNull();
        await idb.clearEntries();
        expect(await idb.readEntryAt<ListEntry2>('commit-1', '.tasks/a.md')).toBeNull();
    });

    it('wipes rows and commit id together', async () => {
        await idb.replaceEntries(undefined, 'commit-1', listing);
        await idb.clearEntries();
        expect(await idb.readAllEntries<ListEntry2>()).toEqual([]);
        expect(await idb.readCacheCommitId()).toBeNull();
    });

    // A tab asked for a listing, then another logged out. Written after that, the listing of a
    // private repository outlived the session it was fetched in.
    it('writes no listing asked for before a logout', async () => {
        for (const before of [undefined, 'commit-1']) {
            if (before !== undefined) {
                await idb.replaceEntries(undefined, before, listing);
            }
            const base = await idb.readCacheCommitId();
            await idb.clearEntries();

            await idb.replaceEntries(base, 'commit-2', listing);

            expect(await idb.readAllEntries<ListEntry2>()).toEqual([]);
            expect(await idb.readCacheCommitId()).toBeNull();
            idb = await freshIdb();
        }
    });

    it('writes a listing asked for after a logout', async () => {
        await idb.replaceEntries(undefined, 'commit-1', listing);
        await idb.clearEntries();

        await idb.replaceEntries(await idb.readCacheCommitId(), 'commit-2', [entry('only.md')]);

        expect((await idb.readAllEntries<ListEntry2>())?.map((r) => r.path)).toEqual(['only.md']);
        expect(await idb.readCacheCommitId()).toBe('commit-2');
    });

    it('keeps a listing another tab wrote since its own was asked for', async () => {
        await idb.replaceEntries(undefined, 'commit-2', [entry('only.md')]);

        await idb.replaceEntries(undefined, 'commit-1', listing);

        expect(await idb.readCacheCommitId()).toBe('commit-2');
    });
});

describe('a database an older version wrote', () => {
    // Rows a delta landed on after another tab had moved them on, labelled as the commit it came
    // from: nothing tells them from good ones, and a later delta never names a row its base lacks.
    it('loses the listing it held, and nothing else', async () => {
        vi.resetModules();
        const factory = new IDBFactory();
        vi.stubGlobal('indexedDB', factory);
        await new Promise<void>((resolve, reject) => {
            const request = factory.open('mory', 2);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('repository');
                request.result.createObjectStore('entries', { keyPath: 'path' });
            };
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction(['repository', 'entries'], 'readwrite');
                tx.objectStore('entries').put(entry('ghost.md'));
                tx.objectStore('repository').put('commit-1', 'entriesCommitId');
                tx.objectStore('repository').put('kept', 'other');
                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };
                tx.onerror = () => reject(tx.error);
            };
            request.onerror = () => reject(request.error);
        });
        const upgraded = await import('@/idb');

        expect(await upgraded.readCacheCommitId()).toBeUndefined();
        expect(await upgraded.readAllEntries<ListEntry2>()).toEqual([]);
        expect(await upgraded.readRecord('other')).toBe('kept');
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
        await expect(idb.replaceEntries(undefined, 'commit-1', listing)).resolves.toBeUndefined();
        await expect(idb.readEntriesByPrefix<ListEntry2>('.tasks/')).resolves.toBeNull();
        await expect(idb.readAllEntries<ListEntry2>()).resolves.toBeNull();
        await expect(idb.readEntriesAt<ListEntry2>('commit-1')).resolves.toBeNull();
        await expect(idb.applyEntryDelta('commit-1', 'commit-2', listing, [])).resolves.toBeUndefined();
        await expect(idb.readCacheCommitId()).resolves.toBeNull();
    });
});
