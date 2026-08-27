import { computed, shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import { defineStore } from 'pinia';

import * as api from '@/api';
import type { ListEntry2 } from '@/api';
import {
    applyEntryDelta,
    clearEntries,
    readAllEntries,
    readCacheCommitId,
    readEntry,
    replaceEntries,
} from '@/idb';

// The single frontend entry point for file-related operations.
//
// Notes are files in a Git repository, so the repository's HEAD commit ID identifies the
// exact state a listing was taken at. That gives the cache a cheap, exact validity test:
// a listing persisted in IndexedDB may be served verbatim as long as its commit ID still
// matches HEAD, and must be refetched otherwise.
//
// The listing lives here once and every consumer reads the same array, which is what
// keeps the app affordable on mobile.
//
// Persisted rows are the source of truth for syncing, and always describe exactly one commit.
// A sync sends that commit as `since`, so the backend can reply with just what changed instead
// of the whole listing. In-memory optimistic patches never reach IndexedDB: they would corrupt
// that base.

export interface SearchHit {
    file: string;
    line: number;
    content: string;
}

// How long to wait before asking again after the backend served a listing older than HEAD,
// which it does while a cold rebuild is still running. Without this, a component calling
// `list()` in a loop would spin against a warming cache.
const LAGGING_RETRY_MS = 1000;

export const useFilesStore = defineStore('files', () => {
    // A `shallowRef` rather than a `ref`: the list can hold thousands of entries, and deep
    // reactivity would wrap every one of them in a proxy. Consumers only read entries and
    // derive from them, so replacing the array wholesale is enough to drive updates — and it
    // keeps the array structured-cloneable for IndexedDB.
    const entriesRef: ShallowRef<ListEntry2[]> = shallowRef([]);

    // The primary structure. A delta names paths, so applying one has to be a keyed update;
    // rebuilding `entriesRef` from this once per sync keeps the shared-array contract every
    // consumer already reads through.
    let entryMap: Map<string, ListEntry2> = new Map();

    // Whether `entryMap` still matches the persisted rows exactly. An optimistic patch clears it:
    // a delta is computed by the backend against the persisted commit, so applying one to a
    // locally-patched map would compound the patch instead of replacing it.
    let mapIsPersisted = false;

    // When the last sync returned a commit older than HEAD, so `list()` does not spin while the
    // backend finishes a rebuild.
    let laggingUntil = 0;

    function publish(): ListEntry2[] {
        entriesRef.value = Array.from(entryMap.values());
        return entriesRef.value;
    }

    // The commit ID the in-memory list is known to be correct for, or `null` when the list is
    // absent, unvalidated, or invalidated by a mutation. Nothing is ever persisted or served
    // as current while this is `null`.
    const validatedCommitIdRef: ShallowRef<string | null> = shallowRef(null);

    const isLoadingRef = shallowRef(false);
    const errorRef: ShallowRef<unknown> = shallowRef(null);

    // Collapses concurrent requests for the same stale data into one refresh.
    let inflight: Promise<ListEntry2[]> | null = null;

    // Bumped by every invalidation. A sync that started before the bump must not adopt or
    // persist its result: a mutation has landed since it read HEAD, so what it fetched no
    // longer describes the repository and would resurrect a cache under a stale commit ID.
    let epoch = 0;

    // Bring the store up to date in a single request.
    //
    // The persisted rows and their commit ID are the delta base: sending that commit as `since`
    // lets the backend reply with only what changed. The response's `commit` is authoritative --
    // the client can no longer label a listing with a commit it did not come from, which is what
    // let a pre-save listing be cached as valid for a post-save commit.
    //
    // Only ever called through `sync()`, which serializes concurrent callers onto one run.
    async function syncOnce(): Promise<ListEntry2[]> {
        const startEpoch = epoch;

        // Only the commit ID is needed to ask; the rows themselves are read only if a delta
        // actually comes back. A cache that fails to open yields no base, and the backend then
        // answers with a full listing.
        const base = await readCacheCommitId();
        const response = await api.getEntries(base ?? undefined);

        if (epoch !== startEpoch) {
            // A mutation invalidated the cache while this ran. Its optimistic patch to the
            // in-memory list is newer than what we fetched, so leave both alone and let the next
            // sync fetch a listing that accounts for the mutation.
            return entriesRef.value;
        }

        if (response.kind === 'full') {
            entryMap = new Map(response.entries.map((entry) => [entry.path, entry]));
            await replaceEntries(response.commit, response.entries);
        }
        else {
            // A delta is computed against the persisted rows, so it has to be applied to them --
            // never to a map an optimistic patch has already touched, which would compound the
            // patch rather than replace it.
            let next: Map<string, ListEntry2>;
            if (mapIsPersisted) {
                next = new Map(entryMap);
            }
            else {
                const rows = await readAllEntries<ListEntry2>();
                if (rows === null) {
                    // No readable base to apply to. Ask again without one, and take the full
                    // listing.
                    validatedCommitIdRef.value = null;
                    return publish();
                }
                next = new Map(rows.map((entry) => [entry.path, entry]));
            }

            // The delta applies to the base we sent. If the backend answered against a different
            // one -- another tab synced in between -- the rows we hold are not that base, so drop
            // them and take a full listing next time.
            if (response.base !== base) {
                validatedCommitIdRef.value = null;
                return publish();
            }
            for (const path of response.deleted) {
                next.delete(path);
            }
            for (const entry of response.changed) {
                next.set(entry.path, entry);
            }
            entryMap = next;
            await applyEntryDelta(response.commit, response.changed, response.deleted);
        }
        mapIsPersisted = true;

        if (response.commit === response.head) {
            validatedCommitIdRef.value = response.commit;
        }
        else {
            // The backend served the commit its cache actually describes, which lags HEAD while
            // it is still syncing. Honest rather than wrong, but not current: hold the rows
            // without claiming they are, and back off before asking again.
            validatedCommitIdRef.value = null;
            laggingUntil = Date.now() + LAGGING_RETRY_MS;
        }
        return publish();
    }

    function sync(): Promise<ListEntry2[]> {
        if (inflight !== null) {
            // A refresh is already running against the same HEAD; join it instead of
            // duplicating the work.
            return inflight;
        }

        isLoadingRef.value = true;
        errorRef.value = null;

        inflight = syncOnce()
            .catch((error) => {
                errorRef.value = error;
                throw error;
            })
            .finally(() => {
                inflight = null;
                isLoadingRef.value = false;
            });

        return inflight;
    }

    // One retry covers the case where we joined a sync that a mutation invalidated underneath
    // us: that run deliberately discards its result, so a second, fresh run is what produces
    // the post-mutation listing. Bounded, so a repository being written to continuously cannot
    // spin here.
    async function syncValidated(): Promise<ListEntry2[]> {
        const first = await sync();
        if (validatedCommitIdRef.value !== null) {
            return first;
        }
        return await sync();
    }

    // The listing, from memory when it is known current and from the cache or the API
    // otherwise. Cheap enough to call from every consumer's `onMounted`.
    function list(): Promise<ListEntry2[]> {
        if (validatedCommitIdRef.value !== null) {
            return Promise.resolve(entriesRef.value);
        }
        if (Date.now() < laggingUntil && entryMap.size > 0) {
            // The backend last answered with a commit older than HEAD, so it is still syncing.
            // Serve what we have rather than hammering it; the next call past the backoff picks
            // up the rest.
            return Promise.resolve(entriesRef.value);
        }
        return syncValidated();
    }

    // Re-validate against HEAD. With a delta base in hand this costs one small request when
    // nothing has changed, and sends only what moved when something has.
    function refresh(): Promise<ListEntry2[]> {
        return syncValidated();
    }

    // Mark the store stale after a mutation. HEAD has moved, so the in-memory list may no longer
    // be served as current.
    //
    // The persisted rows and their commit ID deliberately stay: they are the delta base for the
    // next sync. Deleting them is exactly what forced the full refetch this change exists to
    // avoid -- every save cost the whole listing again.
    function invalidate(): void {
        epoch += 1;
        validatedCommitIdRef.value = null;
        laggingUntil = 0;
    }

    // Apply a mutation's known effect to the in-memory list so the UI updates immediately, while
    // marking the store stale: the authoritative listing arrives on the next sync.
    //
    // In memory only. The persisted rows must keep describing exactly the commit recorded beside
    // them, or the next delta would be applied to a base the backend never saw.
    async function patchEntries(patch: (entries: ListEntry2[]) => ListEntry2[]): Promise<void> {
        const patched = patch(Array.from(entryMap.values()));
        entryMap = new Map(patched.map((entry) => [entry.path, entry]));
        mapIsPersisted = false;
        publish();
        invalidate();
    }

    // Forget everything, in memory and on disk. Used on logout: the listing describes a
    // private repository and must not outlive the session that fetched it.
    async function clear(): Promise<void> {
        entryMap = new Map();
        mapIsPersisted = false;
        entriesRef.value = [];
        errorRef.value = null;
        invalidate();
        // Rows and commit ID together: the listing describes a private repository and must not
        // outlive the session that fetched it.
        await clearEntries();
    }

    async function read(path: string): Promise<string> {
        const res = await api.getNote(path);
        return res.data;
    }

    // Creates the file or replaces its content; the repository does not distinguish.
    async function write(path: string, content: string): Promise<void> {
        await api.addNote(path, content);
        // The new entry's size, MIME type and metadata are decided by the backend, so the
        // listing cannot be patched locally: invalidate and let the next sync fetch it.
        invalidate();
    }

    async function rename(oldPath: string, newPath: string): Promise<void> {
        await api.renameNote(oldPath, newPath);
        await patchEntries((entries) => entries.map(
            (entry) => entry.path === oldPath ? { ...entry, path: newPath } : entry,
        ));
    }

    async function remove(path: string): Promise<boolean> {
        const res = await api.deleteNote(path);
        const deleted = res.data === true;
        if (deleted) {
            await patchEntries((entries) => entries.filter((entry) => entry.path !== path));
        }
        return deleted;
    }

    async function upload(formData: FormData): Promise<[string, string][]> {
        const res = await api.uploadFiles(formData);
        invalidate();
        return res.data;
    }

    // A single file's listing entry, without the caller having to hold the whole list.
    //
    // Rendering one image should not cost 2,170 entries. When the persisted rows already describe
    // HEAD, one row answers it; only a genuinely stale cache falls back to the full listing.
    async function entry(path: string): Promise<ListEntry2 | undefined> {
        if (validatedCommitIdRef.value !== null) {
            return entryMap.get(path);
        }

        const [head, cachedCommitId] = await Promise.all([
            api.getHeadCommitId().catch(() => null),
            readCacheCommitId(),
        ]);
        if (head !== null && cachedCommitId === head) {
            const cached = await readEntry<ListEntry2>(path);
            if (cached !== null) {
                return cached;
            }
            // Absent from a cache that is current means the file does not exist, but fall
            // through rather than assert it: a cache that failed to open reads the same way.
        }

        const entries = await list();
        return entries.find((candidate) => candidate.path === path);
    }

    // Full-text search is answered by the backend against HEAD, so it is not cached.
    async function search(pattern: string): Promise<SearchHit[]> {
        const res = await api.searchNotes(pattern);
        return res.data as SearchHit[];
    }

    // Whether a path is taken, asked of the repository rather than of the listing so that a
    // stale listing cannot report a free path as taken or vice versa.
    function exists(path: string): Promise<boolean> {
        return api.noteExists(path);
    }

    return {
        // Getters. `computed` keeps them read-only, so a consumer cannot assign over the
        // shared listing — the constraint this store exists to enforce.
        entries: computed(() => entriesRef.value),
        commitId: computed(() => validatedCommitIdRef.value),
        isLoading: computed(() => isLoadingRef.value),
        error: computed(() => errorRef.value),

        // Actions
        list,
        refresh,
        entry,
        read,
        write,
        rename,
        remove,
        upload,
        search,
        exists,
        invalidate,
        clear,
    };
});
