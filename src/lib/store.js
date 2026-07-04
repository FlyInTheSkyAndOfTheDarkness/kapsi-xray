/* ============================================================
   Client-side persistence (localStorage) for Kaspi X-Ray:
   settings, product observation snapshots, and the watchlist.
   No backend required — history accumulates as you track products.
   ============================================================ */

const K = {
  settings: 'kx-settings',
  snapshots: 'kx-snapshots',
  watchlist: 'kx-watchlist',
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode — ignore */
  }
}

/* ---------------- settings ---------------- */
export const loadSettings = () => read(K.settings, null)
export const saveSettings = (s) => write(K.settings, s)

/* ---------------- snapshots ----------------
   shape: { [productId]: [{ ts, date, price, buyBox, sellers, ratingsTotal,
                            commentsTotal, estSales, estRevenue }] }        */
export function getSnapshots(id) {
  const all = read(K.snapshots, {})
  return all[id] || []
}
export function getAllSnapshots() {
  return read(K.snapshots, {})
}
/** Add a snapshot, but at most one per calendar day per product (dedupe). */
export function addSnapshot(id, snap) {
  const all = read(K.snapshots, {})
  const list = all[id] || []
  const today = snap.date
  const idx = list.findIndex((s) => s.date === today)
  if (idx >= 0) list[idx] = snap
  else list.push(snap)
  list.sort((a, b) => a.ts - b.ts)
  all[id] = list.slice(-180) // keep ~6 months of daily points
  write(K.snapshots, all)
  return all[id]
}

/* ---------------- watchlist ---------------- */
export const loadWatchlist = () => read(K.watchlist, [])
export const saveWatchlist = (list) => write(K.watchlist, list)

/** Local YYYY-MM-DD (stable key for one-per-day snapshots). */
export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
