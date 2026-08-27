// A minimal promise wrapper around IndexedDB for the frontend's repository cache.
//
// Every operation degrades to a no-op when IndexedDB is unavailable or refuses to
// open (private browsing modes, blocked storage, a corrupted database). Callers can
// then fall back to the API, so a broken cache never breaks the app.

const DB_NAME = 'mory';
const DB_VERSION = 1;
const STORE_NAME = 'repository';

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
    return getDatabase().then((db) => {
        if (db === null) {
            return null;
        }

        return new Promise<T | null>((resolve) => {
            let request: IDBRequest<T>;
            try {
                const tx = db.transaction(STORE_NAME, mode);
                request = body(tx.objectStore(STORE_NAME));
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
