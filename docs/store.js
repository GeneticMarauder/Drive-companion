// On-phone storage. Game files and save slots live in IndexedDB; small
// settings (including the API key) live in localStorage. Nothing here ever
// leaves the phone except the key, which is sent only to api.anthropic.com.

const DB_NAME = 'drive-companion'
let dbPromise

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('games', { keyPath: 'id' })
      req.result.createObjectStore('saves')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx(store, mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode)
    const req = fn(t.objectStore(store))
    t.oncomplete = () => resolve(req?.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export const games = {
  list: () => tx('games', 'readonly', (s) => s.getAll()),
  get: (id) => tx('games', 'readonly', (s) => s.get(id)),
  put: (game) => tx('games', 'readwrite', (s) => s.put(game)),
  remove: (id) => tx('games', 'readwrite', (s) => s.delete(id)),
}

// A save store scoped to one game, in the shape engine.js expects.
export function saveStoreFor(gameId) {
  return {
    get: (name) => tx('saves', 'readonly', (s) => s.get(`${gameId}:${name}`)).then((v) => v ?? null),
    set: (name, bytes) => tx('saves', 'readwrite', (s) => s.put(bytes, `${gameId}:${name}`)),
    clear: () => tx('saves', 'readwrite', (s) => s.delete(IDBKeyRange.bound(`${gameId}:`, `${gameId}:￿`))),
  }
}

function safeGet(k) { try { return localStorage.getItem(k) } catch { return null } }
function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }

export const settings = {
  get apiKey() { return safeGet('dc.apiKey') || '' },
  set apiKey(v) { safeSet('dc.apiKey', v || null) },
  get rate() { return Number(safeGet('dc.rate')) || 1 },
  set rate(v) { safeSet('dc.rate', String(v)) },
  get voice() { return safeGet('dc.voice') || '' },
  set voice(v) { safeSet('dc.voice', v || null) },
  get textSize() { const raw = safeGet('dc.textSize'); const v = Number(raw); return raw !== null && Number.isInteger(v) && v >= 0 && v <= 3 ? v : 1 },
  set textSize(v) { safeSet('dc.textSize', String(v)) },
  get totalCost() { return Number(safeGet('dc.totalCost')) || 0 },
  set totalCost(v) { safeSet('dc.totalCost', String(v)) },
}

// Ask the browser not to evict our storage under pressure.
export async function persist() {
  try { return await navigator.storage?.persist?.() } catch { return false }
}
