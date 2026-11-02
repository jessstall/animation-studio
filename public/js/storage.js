// Tiny IndexedDB wrapper: projects, uploaded fonts, user symbols
const DB = 'animation-studio';
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['projects', 'fonts', 'symbols', 'effects']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  });
}
export const put = (store, val) => tx(store, 'readwrite', s => s.put(val));
export const del = (store, id) => tx(store, 'readwrite', s => s.delete(id));
export const all = (store) => tx(store, 'readonly', s => s.getAll());
export const get = (store, id) => tx(store, 'readonly', s => s.get(id));
