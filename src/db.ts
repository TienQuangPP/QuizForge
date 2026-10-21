// Minimal IndexedDB wrapper. Everything stays on this computer.
const DB_NAME = "quizforge";
const DB_VERSION = 2;
export const STORES = ["decks", "questions", "docs", "progress", "sessions", "notes"] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === "progress" ? "qid" : "id" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function putMany<T>(store: StoreName, items: T[]) {
  if (!items.length) return;
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  for (const item of items) os.put(item);
  await done(tx);
}

export async function deleteMany(store: StoreName, keys: string[]) {
  if (!keys.length) return;
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  for (const k of keys) os.delete(k);
  await done(tx);
}

export async function clearAll() {
  const db = await open();
  const tx = db.transaction([...STORES], "readwrite");
  for (const s of STORES) tx.objectStore(s).clear();
  await done(tx);
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
