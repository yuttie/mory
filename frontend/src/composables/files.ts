import { computed, shallowRef } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';

import * as api from '@/api';
import type { ListEntry2 } from '@/api';
import { deleteRecord, readRecord, writeRecord } from '@/idb';

// The single frontend entry point for file-related operations.
//
// Notes are files in a Git repository, so the repository's HEAD commit ID identifies the
// exact state a listing was taken at. That gives the cache a cheap, exact validity test:
// a listing persisted in IndexedDB may be served verbatim as long as its commit ID still
// matches HEAD, and must be refetched otherwise.
//
// The state below is module level on purpose. `useFiles()` hands every caller the same
// refs, so the file list exists once in memory no matter how many components read it —
// which is what keeps the app affordable on mobile.

const CACHE_KEY = 'entries';

export interface SearchHit {
    file: string;
    line: number;
    content: string;
}

interface CachedListing {
    commitId: string;
    entries: ListEntry2[];
}

// A `shallowRef` rather than a `ref`: the list can hold thousands of entries, and deep
// reactivity would wrap every one of them in a proxy. Consumers only read entries and
// derive from them, so replacing the array wholesale is enough to drive updates — and it
// keeps the array structured-cloneable for IndexedDB.
const entriesRef: ShallowRef<ListEntry2[]> = shallowRef([]);

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

async function readCache(): Promise<CachedListing | null> {
    const cached = await readRecord<CachedListing>(CACHE_KEY);
    if (cached === null || cached === undefined) {
        return null;
    }
    if (typeof cached.commitId !== 'string' || !Array.isArray(cached.entries)) {
        // Written by an older or broken version; treat it as a miss.
        return null;
    }
    return cached;
}

// Validate the cache against HEAD and, if it is stale or missing, refetch through the API.
// Only ever called through `sync()`, which serializes concurrent callers onto one run.
async function syncOnce(): Promise<ListEntry2[]> {
    const startEpoch = epoch;
    const headCommitId = await api.getHeadCommitId();

    // Already correct in memory: no I/O at all.
    if (epoch === startEpoch && validatedCommitIdRef.value === headCommitId) {
        return entriesRef.value;
    }

    const cached = await readCache();
    if (epoch === startEpoch && cached !== null && cached.commitId === headCommitId) {
        entriesRef.value = cached.entries;
        validatedCommitIdRef.value = headCommitId;
        return cached.entries;
    }

    // Cache missing or stale: go to the API.
    const listed = await api.listNotes();
    const entries = listed.data as ListEntry2[];

    // A commit may have landed while the listing was in flight, in which case the listing
    // belongs to an unknown state. Re-reading HEAD tells us whether `headCommitId` still
    // describes it.
    const headCommitIdAfter = await api.getHeadCommitId();

    if (epoch !== startEpoch) {
        // A mutation invalidated the cache while this ran. Its optimistic patch to the
        // in-memory list is newer than what we fetched, so leave both alone and let the
        // next sync fetch a listing that accounts for the mutation.
        return entriesRef.value;
    }

    entriesRef.value = entries;
    if (headCommitIdAfter === headCommitId) {
        validatedCommitIdRef.value = headCommitId;
        await writeRecord(CACHE_KEY, { commitId: headCommitId, entries } satisfies CachedListing);
    }
    else {
        // Usable for display, but not attributable to a commit: never persisted, and
        // re-validated on the next call.
        validatedCommitIdRef.value = null;
        await deleteRecord(CACHE_KEY);
    }

    return entries;
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
    return syncValidated();
}

// Re-validate against HEAD. Costs one small request when nothing has changed, and
// refetches the listing only when the commit ID has actually moved.
function refresh(): Promise<ListEntry2[]> {
    return syncValidated();
}

// Drop the cached listing after a mutation. HEAD has moved, so neither the persisted copy
// nor the in-memory one may be served as current any more.
async function invalidate(): Promise<void> {
    epoch += 1;
    validatedCommitIdRef.value = null;
    await deleteRecord(CACHE_KEY);
}

// Apply a mutation's known effect to the in-memory list so the UI updates immediately,
// while still marking the cache stale: the authoritative listing arrives on the next sync.
async function patchEntries(patch: (entries: ListEntry2[]) => ListEntry2[]): Promise<void> {
    entriesRef.value = patch(entriesRef.value);
    await invalidate();
}

// Forget everything, in memory and on disk. Used on logout: the listing describes a
// private repository and must not outlive the session that fetched it.
async function clear(): Promise<void> {
    entriesRef.value = [];
    errorRef.value = null;
    await invalidate();
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
    await invalidate();
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
    await invalidate();
    return res.data;
}

// A single file's listing entry, without the caller having to hold the whole list.
async function entry(path: string): Promise<ListEntry2 | undefined> {
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

export interface FilesStore {
    /** The repository's files. Shared by every consumer; treat as read-only. */
    entries: ComputedRef<ListEntry2[]>;
    /** True while the listing is being validated or refetched. */
    isLoading: ComputedRef<boolean>;
    /** The error from the most recent failed sync, or `null`. */
    error: ComputedRef<unknown>;
    /** The commit ID the listing is valid for, or `null` when it is stale or unknown. */
    commitId: ComputedRef<string | null>;

    list(): Promise<ListEntry2[]>;
    refresh(): Promise<ListEntry2[]>;
    entry(path: string): Promise<ListEntry2 | undefined>;

    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    remove(path: string): Promise<boolean>;
    upload(formData: FormData): Promise<[string, string][]>;
    search(pattern: string): Promise<SearchHit[]>;
    exists(path: string): Promise<boolean>;

    invalidate(): Promise<void>;
    clear(): Promise<void>;
}

// Every method is a plain module-level function, so destructuring the result stays safe.
const store: FilesStore = {
    entries: computed(() => entriesRef.value),
    isLoading: computed(() => isLoadingRef.value),
    error: computed(() => errorRef.value),
    commitId: computed(() => validatedCommitIdRef.value),

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

export function useFiles(): FilesStore {
    return store;
}
