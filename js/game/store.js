/**
 * Stockage des sauvegardes : IndexedDB (beaucoup plus de place que localStorage, limité à
 * ~5 Mo sur iPhone — une partie à 20 championnats pèse ~1,2 Mo compressée).
 * Repli sur localStorage si IndexedDB est indisponible.
 */
const DB = 'coach-de-poche', STORE = 'kv';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };

async function tx(mode, fn) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function kvGet(key) {
  if (typeof indexedDB === 'undefined') return ls()?.getItem(key) ?? null;
  const v = await tx('readonly', (s) => s.get(key));
  if (v != null) return v;
  return ls()?.getItem(key) ?? null; // anciennes sauvegardes (localStorage)
}

export async function kvSet(key, value) {
  if (typeof indexedDB === 'undefined') { ls()?.setItem(key, value); return; }
  await tx('readwrite', (s) => s.put(value, key));
  try { ls()?.removeItem(key); } catch { /* ignore */ } // libère l'ancien emplacement
}

export async function kvDel(key) {
  try { ls()?.removeItem(key); } catch { /* ignore */ }
  if (typeof indexedDB !== 'undefined') await tx('readwrite', (s) => s.delete(key));
}
