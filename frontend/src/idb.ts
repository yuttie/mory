// A minimal promise wrapper around IndexedDB for the frontend's repository cache.
//
// Every operation degrades to a no-op when IndexedDB is unavailable or refuses to
// open (private browsing modes, blocked storage, a corrupted database). Callers can
// then fall back to the API, so a broken cache never breaks the app.

const DB_NAME = 'mory';
const DB_VERSION = 2;
const STORE_NAME = 'repository';
const ENTRY_STORE = 'entries';

// The listing used to be one record in `repository`, rewritten whole on every change. It is now
// one row per file in `entries`, keyed by path, so a change can touch only the rows it affects.
const LEGACY_LISTING_KEY = 'entries';
const CACHE_COMMIT_KEY = 'entriesCommitId';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        }
        catch (error) {
            console.warn('Failed to open the IndexedDB cache:', error);
            resolve(null);
            return;
        }

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
            if (!db.objectStoreNames.contains(ENTRY_STORE)) {
                db.createObjectStore(ENTRY_STORE, { keyPath: 'path' });
            }
            // Drop the whole-listing record the row store replaces, so a v1 database does not
            // keep several hundred kilobytes nothing will ever read again.
            if (request.transaction !== null) {
                try {
                    request.transaction.objectStore(STORE_NAME).delete(LEGACY_LISTING_KEY);
                }
                catch (error) {
                    console.warn('Failed to drop the legacy listing record:', error);
                }
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            // A newer tab wanting a schema upgrade must not be blocked by this one.
            db.onversionchange = () => {
                db.close();
                dbPromise = null;
            };
            resolve(db);
        };
        request.onerror = () => {
            console.warn('Failed to open the IndexedDB cache:', request.error);
            resolve(null);
        };
        request.onblocked = () => {
            console.warn('Opening the IndexedDB cache is blocked by another connection.');
            resolve(null);
        };
    });
}

function getDatabase(): Promise<IDBDatabase | null> {
    if (dbPromise === null) {
        dbPromise = openDatabase();
    }
    return dbPromise;
}

function runTransaction<T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
    return runTransactionOn(STORE_NAME, mode, body);
}

function runTransactionOn<T>(
    storeName: string,
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
    return getDatabase().then((db) => {
        if (db === null) {
            return null;
        }

        return new Promise<T | null>((resolve) => {
            let request: IDBRequest<T>;
            try {
                const tx = db.transaction(storeName, mode);
                request = body(tx.objectStore(storeName));
                tx.onabort = () => {
                    console.warn('The IndexedDB cache transaction was aborted:', tx.error);
                    resolve(null);
                };
            }
            catch (error) {
                console.warn('The IndexedDB cache transaction failed:', error);
                resolve(null);
                return;
            }

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.warn('The IndexedDB cache request failed:', request.error);
                // Otherwise the failure would also abort the transaction and log twice.
                request.transaction?.abort?.();
                resolve(null);
            };
        });
    });
}

export function readRecord<T>(key: string): Promise<T | null> {
    return runTransaction<T>('readonly', (store) => store.get(key) as IDBRequest<T>);
}

export function writeRecord(key: string, value: unknown): Promise<void> {
    // `value` must be structured-cloneable: pass plain data, never a Vue reactive proxy.
    return runTransaction('readwrite', (store) => store.put(value, key)).then(() => undefined);
}

export function deleteRecord(key: string): Promise<void> {
    return runTransaction('readwrite', (store) => store.delete(key)).then(() => undefined);
}

// Run `body` over several stores in one transaction, resolving when the transaction *completes*
// rather than when any single request does.
//
// `runTransaction` above resolves on one `IDBRequest`, which is enough for a single put. Applying
// a delta issues many requests across two stores and they have to land together: rows and the
// commit ID they describe must move as a unit, or a torn write leaves the cache describing a
// commit whose contents it does not have. Same degrade-to-null contract, so a broken cache still
// never breaks the app.
function runMultiTransaction<T>(
    storeNames: string[],
    mode: IDBTransactionMode,
    body: (stores: Record<string, IDBObjectStore>) => T,
): Promise<T | null> {
    return getDatabase().then((db) => {
        if (db === null) {
            return null;
        }

        return new Promise<T | null>((resolve) => {
            let result: T;
            try {
                const tx = db.transaction(storeNames, mode);
                const stores: Record<string, IDBObjectStore> = {};
                for (const name of storeNames) {
                    stores[name] = tx.objectStore(name);
                }
                result = body(stores);
                tx.oncomplete = () => resolve(result);
                tx.onabort = () => {
                    console.warn('The IndexedDB cache transaction was aborted:', tx.error);
                    resolve(null);
                };
                tx.onerror = () => {
                    console.warn('The IndexedDB cache transaction failed:', tx.error);
                    resolve(null);
                };
            }
            catch (error) {
                console.warn('The IndexedDB cache transaction failed:', error);
                resolve(null);
            }
        });
    });
}

// Replace the whole listing: clear the rows, write the new ones, record their commit.
export function replaceEntries(commitId: string, entries: unknown[]): Promise<void> {
    return runMultiTransaction([ENTRY_STORE, STORE_NAME], 'readwrite', (stores) => {
        stores[ENTRY_STORE].clear();
        for (const entry of entries) {
            stores[ENTRY_STORE].put(entry);
        }
        stores[STORE_NAME].put(commitId, CACHE_COMMIT_KEY);
    }).then(() => undefined);
}

// Apply only what changed, and move the commit ID with it.
export function applyEntryDelta(
    commitId: string,
    changed: unknown[],
    deleted: string[],
): Promise<void> {
    return runMultiTransaction([ENTRY_STORE, STORE_NAME], 'readwrite', (stores) => {
        for (const path of deleted) {
            stores[ENTRY_STORE].delete(path);
        }
        for (const entry of changed) {
            stores[ENTRY_STORE].put(entry);
        }
        stores[STORE_NAME].put(commitId, CACHE_COMMIT_KEY);
    }).then(() => undefined);
}

export function readAllEntries<T>(): Promise<T[] | null> {
    return runTransactionOn<T[]>(ENTRY_STORE, 'readonly', (store) => store.getAll() as IDBRequest<T[]>);
}

// The rows under a path prefix, without reading the listing.
//
// No secondary index is involved, and none is needed: the store is keyed by `path`, so a path
// prefix is already a bounded range over the primary key. `.tasks/` answers from 162 rows rather
// than the 2,170 the repository holds.
export function readEntriesByPrefix<T>(prefix: string): Promise<T[] | null> {
    if (prefix === '') {
        return readAllEntries<T>();
    }
    // '\uffff' sorts after every character IndexedDB will see in a path, so the range covers
    // exactly the keys beginning with `prefix`.
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    return runTransactionOn<T[]>(ENTRY_STORE, 'readonly', (store) => store.getAll(range) as IDBRequest<T[]>);
}

// One row, without reading the listing. This is what lets a single-entry lookup avoid pulling
// every entry in the repository.
export function readEntry<T>(path: string): Promise<T | null> {
    return runTransactionOn<T>(ENTRY_STORE, 'readonly', (store) => store.get(path) as IDBRequest<T>);
}

export function readCacheCommitId(): Promise<string | null> {
    return readRecord<string>(CACHE_COMMIT_KEY);
}

// Wipe rows and commit ID together. Used on logout: the listing describes a private repository.
export function clearEntries(): Promise<void> {
    return runMultiTransaction([ENTRY_STORE, STORE_NAME], 'readwrite', (stores) => {
        stores[ENTRY_STORE].clear();
        stores[STORE_NAME].delete(CACHE_COMMIT_KEY);
    }).then(() => undefined);
}
