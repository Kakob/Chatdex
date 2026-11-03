// Device-remembered master key ("Stay unlocked on this device").
//
// Stores the NON-EXTRACTABLE master key in its own IndexedDB database so a
// reload can resume sync without a passkey ceremony. A non-extractable
// CryptoKey survives structured clone into IndexedDB, can still encrypt and
// decrypt, but its raw bytes can never be exported — page script, devtools and
// the server alike only ever get an opaque handle.
//
// Deliberately NOT a Dexie table in the main `chatdex` database: nothing here
// may ever be reachable by the sync engine's hooks, clearAllData's table list,
// or a future "export everything" path.
//
// Lock, Log out, and "Delete all local data" call clearDeviceKey().

const DB_NAME = 'chatdex-device-key';
const STORE = 'keys';
const RECORD_ID = 'master';

interface StoredDeviceKey {
  userId: string;
  key: CryptoKey;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const idb = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = idb.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}

export async function saveDeviceKey(userId: string, key: CryptoKey): Promise<void> {
  if (key.extractable) {
    throw new Error('Refusing to persist an extractable master key');
  }
  const record: StoredDeviceKey = { userId, key };
  await withStore('readwrite', (store) => store.put(record, RECORD_ID));
}

/** The remembered key for this user, or null (none saved, or saved for someone else). */
export async function loadDeviceKey(userId: string): Promise<CryptoKey | null> {
  const record = await withStore<StoredDeviceKey | undefined>('readonly', (store) =>
    store.get(RECORD_ID)
  );
  if (!record || record.userId !== userId) return null;
  return record.key;
}

export async function clearDeviceKey(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(RECORD_ID));
}
