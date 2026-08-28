import { computed, ref, shallowRef } from 'vue';
import type { ComputedRef, Ref } from 'vue';

import type { ListEntry2 } from '@/api';
import { readEntriesByPrefix } from '@/idb';
import { LAGGING_RETRY_MS, useFilesStore } from '@/stores/files';

// A live slice of the file listing, for a view that only cares about one part of the repository.
//
// The files store already holds the whole listing, synced incrementally and cached in IndexedDB.
// Anything derived from a subset of it -- the task forest, and the note tree that follows -- wants
// the same three things, which is what this provides:
//
//   * the subset, recomputed whenever the listing changes, so consumers never hold a second copy
//     that a server response could contradict;
//   * a first paint out of IndexedDB, reading only the rows under the prefix rather than waiting
//     for the whole listing to sync;
//   * a way to wait until a path a mutation just wrote is actually visible.

export interface EntrySubset {
    entries: ComputedRef<ListEntry2[]>;
    hasLoadedOnce: Ref<boolean>;
    init: () => Promise<void>;
    refresh: () => Promise<ListEntry2[]>;
    settle: (path: string, expectPresent: boolean) => Promise<void>;
}

export function useEntrySubset(prefix: string): EntrySubset {
    const files = useFilesStore();

    // Rows read straight from IndexedDB, to paint before the first sync resolves. They describe
    // the persisted commit, so they are a paint buffer and not a second source of truth: the
    // moment the files store has published a listing, that listing wins.
    const primed = shallowRef<ListEntry2[] | null>(null);

    // Not `files.commitId !== null`: that goes null on every invalidation, so a view gated on it
    // would blank itself after each save.
    const hasLoadedOnce = ref(false);

    const entries = computed<ListEntry2[]>(() => {
        if (files.entries.length > 0) {
            return files.entries.filter((entry) => entry.path.startsWith(prefix));
        }
        return primed.value ?? [];
    });

    async function init(): Promise<void> {
        const rows = await readEntriesByPrefix<ListEntry2>(prefix);
        // A sync may have landed while the read was in flight; it is the better answer.
        if (rows !== null && files.entries.length === 0) {
            primed.value = rows;
        }
        hasLoadedOnce.value = true;
        await files.list();
    }

    function refresh(): Promise<ListEntry2[]> {
        return files.refresh();
    }

    // Sync, and do not return until `path` is present (or absent, after a delete).
    //
    // The backend serves the listing at the commit its cache actually describes, which can lag
    // HEAD when a sync outruns the deadline it waits on. A single refresh can therefore come back
    // without the write that prompted it -- which is exactly how a newly created task used to go
    // missing from the tree. One bounded retry, so a repository being written to continuously
    // cannot spin here.
    async function settle(path: string, expectPresent: boolean): Promise<void> {
        await refresh();
        if (isPresent(path) === expectPresent) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, LAGGING_RETRY_MS));
        await refresh();
    }

    function isPresent(path: string): boolean {
        return files.entries.some((entry) => entry.path === path);
    }

    return { entries, hasLoadedOnce, init, refresh, settle };
}
