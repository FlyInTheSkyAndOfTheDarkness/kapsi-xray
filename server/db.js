/* ============================================================
   Tiny JSON-file database (no native deps — Windows-friendly).
   Collections: users, stores, cogs, competitors, snapshots.
   Writes are debounced; the whole DB is small (personal SaaS).
   ============================================================ */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')
const DB_FILE = join(DATA_DIR, 'db.json')

const EMPTY = { users: [], stores: [], cogs: [], competitors: [], snapshots: [], alerts: [], opportunities: [], imports: [], taobaoProducts: [], taobaoKeys: [], repricers: [], aiSettings: [], accessGrants: [] }

function loadDb() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(DB_FILE)) {
    writeFileSync(DB_FILE, JSON.stringify(EMPTY, null, 2))
    return structuredClone(EMPTY)
  }
  try {
    return { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(DB_FILE, 'utf8')) }
  } catch {
    return structuredClone(EMPTY)
  }
}

const db = loadDb()

let writeTimer = null
function persist() {
  clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    try {
      writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
    } catch (e) {
      console.error('DB write failed:', e.message)
    }
  }, 120)
}

export const uid = () => randomUUID()

/** Generic collection helpers. */
export function all(coll) {
  return db[coll]
}
export function find(coll, pred) {
  return db[coll].find(pred)
}
export function filter(coll, pred) {
  return db[coll].filter(pred)
}
export function insert(coll, doc) {
  const row = { id: doc.id || uid(), ...doc }
  db[coll].push(row)
  persist()
  return row
}
export function update(coll, id, patch) {
  const row = db[coll].find((r) => r.id === id)
  if (!row) return null
  Object.assign(row, patch)
  persist()
  return row
}
export function remove(coll, pred) {
  const before = db[coll].length
  db[coll] = db[coll].filter((r) => !pred(r))
  if (db[coll].length !== before) persist()
  return before - db[coll].length
}

export default db
