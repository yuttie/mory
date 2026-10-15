import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { ListEntry2 } from '@/api';

// One IndexedDB, shared by every store created here as it is by every tab of an origin.
const idb = {
    commit: null as string | null,
    rows: new Map<string, ListEntry2>(),
};
vi.mock('@/idb', () => ({
    readCacheCommitId: async () => idb.commit,
    readAllEntries: async () => Array.from(idb.rows.values()),
    readEntry: async (path: string) => idb.rows.get(path) ?? null,
    replaceEntries: async (commit: string, entries: ListEntry2[]) => {
        idb.rows = new Map(entries.map((entry) => [entry.path, entry]));
        idb.commit = commit;
    },
    applyEntryDelta: async (commit: string, changed: ListEntry2[], deleted: string[]) => {
        for (const path of deleted) {
            idb.rows.delete(path);
        }
        for (const entry of changed) {
            idb.rows.set(entry.path, entry);
        }
        idb.commit = commit;
    },
    clearEntries: async () => {
        idb.rows.clear();
        idb.commit = null;
    },
}));

// The backend: every commit's listing, answering `since` with what changed as moried does.
const history = new Map<string, Map<string, ListEntry2>>();
let head = '';

function entry(path: string): ListEntry2 {
    return {
        path,
        size: 1,
        mime_type: 'text/markdown',
        metadata: null,
        title: path,
        time: '2026-01-01T00:00:00+00:00',
    };
}

function commit(change: (files: Map<string, ListEntry2>) => void): void {
    const next = new Map(history.get(head));
    change(next);
    head = `C${history.size + 1}`;
    history.set(head, next);
}

vi.mock('@/api', () => ({
    getEntries: async (since?: string) => {
        const now = history.get(head)!;
        const before = since === undefined ? undefined : history.get(since);
        if (before === undefined) {
            return { kind: 'full', commit: head, head, entries: Array.from(now.values()) };
        }
        return {
            kind: 'delta',
            commit: head,
            head,
            base: since,
            changed: Array.from(now.values()).filter((candidate) =>
                JSON.stringify(before.get(candidate.path)) !== JSON.stringify(candidate)),
            deleted: Array.from(before.keys()).filter((path) => !now.has(path)),
        };
    },
    addNote: async (path: string) => {
        commit((files) => files.set(path, entry(path)));
    },
    deleteNote: async (path: string) => {
        commit((files) => files.delete(path));
        return { data: true };
    },
}));

import { useFilesStore } from '@/stores/files';

function newTab(): ReturnType<typeof useFilesStore> {
    setActivePinia(createPinia());
    return useFilesStore();
}

const paths = (entries: readonly ListEntry2[]) => entries.map((candidate) => candidate.path).sort();

beforeEach(() => {
    idb.commit = null;
    idb.rows = new Map();
    history.clear();
    head = 'C1';
    history.set(head, new Map([['a.md', entry('a.md')]]));
});

describe('the files store', () => {
    // Another tab's sync moves the shared rows on to a commit this tab's listing never reached. A
    // delta from there applied to this tab's own listing loses whatever happened in between.
    it('takes in what another tab synced before it', async () => {
        const tabA = newTab();
        const tabB = newTab();
        expect(paths(await tabA.list())).toEqual(['a.md']);
        expect(paths(await tabB.list())).toEqual(['a.md']);

        await tabA.write('b.md', '# B');
        expect(paths(await tabA.list())).toEqual(['a.md', 'b.md']);
        expect(idb.commit).toBe(head);

        expect(paths(await tabB.refresh())).toEqual(['a.md', 'b.md']);
        expect(tabB.commitId).toBe(head);
    });
});
