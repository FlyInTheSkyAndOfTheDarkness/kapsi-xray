/* ============================================================
   Every call to kaspi.kz leaves the process through here.

   Kaspi rate-limits by IP, and from a datacenter address even a
   cold request comes back 429 with an HTML anti-bot page — the
   catalog then reads as empty on every page of the app. Three
   things keep it usable: an optional Kazakhstan egress proxy, a
   gap between consecutive public calls so we never earn the 429
   ourselves, and a cache that keeps serving the last good
   answer for as long as Kaspi keeps refusing.
   ============================================================ */

import { ProxyAgent } from 'undici'

/* An HTTP(S) proxy with a Kazakhstan exit, e.g. http://user:pass@host:3128.
   Empty means direct egress — fine locally, usually 429 from a VPS. */
const PROXY_URL = process.env.KASPI_PROXY_URL || ''
/* The proxy exists for the public listing, which is what gets rate-limited.
   The cabinet API is authenticated and was never the problem, so the seller's
   token keeps to direct egress and never touches a third-party relay — a free
   one is not something to hand a token to. Opt in only if it is blocked too. */
const PROXY_MERCHANT_API = process.env.KASPI_PROXY_MERCHANT_API === '1'

const TIMEOUT_MS = 15_000
const MAX_ENTRIES = 500

/* Windows are read per call rather than captured at import: they are the knobs
   an operator reaches for when Kaspi tightens, and tests vary them freely. */
const num = (name, fallback) => Number(process.env[name]) || fallback
/* Reading a catalog is 8 pages; firing those back to back is what earns the
   limiter's attention, so public calls are spaced out and serialized. */
const minGapMs = () => num('KASPI_MIN_GAP_MS', 700)
const freshMs = () => num('KASPI_CACHE_TTL_MS', 10 * 60_000)
/* How long an answer may still be served after it went stale. A catalog from
   this morning beats an empty dashboard. */
const staleMs = () => num('KASPI_CACHE_STALE_MS', 24 * 60 * 60_000)
/* Once Kaspi says 429 the host is left alone for a while. Retrying into a
   throttled IP only deepens the block, and every caller pays the timeout. */
const cooldownMs = () => num('KASPI_COOLDOWN_MS', 60_000)
const backoffMs = () => {
  const base = num('KASPI_BACKOFF_MS', 1_000)
  return [base, base * 3]
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ---- egress ---- */

let agent = null
function dispatcher() {
  if (!PROXY_URL) return null
  if (!agent) agent = new ProxyAgent(PROXY_URL)
  return agent
}

/** Whether requests leave through a proxy — surfaced on /api/health. */
export function proxyStatus() {
  if (!PROXY_URL) return { enabled: false, host: null }
  try {
    return { enabled: true, host: new URL(PROXY_URL).host }
  } catch {
    return { enabled: true, host: 'invalid_url' }
  }
}

/* ---- pacing ---- */

let gate = Promise.resolve()
let lastCallAt = 0

/** Serialize public calls and keep a gap between them. */
function pace() {
  const turn = gate.then(async () => {
    const wait = minGapMs() - (Date.now() - lastCallAt)
    if (wait > 0) await sleep(wait)
    lastCallAt = Date.now()
  })
  gate = turn.catch(() => {})
  return turn
}

let blockedUntil = 0

/** Milliseconds left before public calls are attempted again. */
export function cooldownLeft() {
  return Math.max(0, blockedUntil - Date.now())
}

function startCooldown(extraMs = 0) {
  blockedUntil = Date.now() + Math.max(cooldownMs(), extraMs)
}

/* ---- cache ---- */

const cache = new Map() // key -> { at, data }

function cacheKey(url, opts) {
  return `${opts.method || 'GET'} ${url} ${opts.body || ''}`
}

function readCache(key, maxAgeMs) {
  const hit = cache.get(key)
  if (!hit || Date.now() - hit.at > maxAgeMs) return null
  return hit
}

function writeCache(key, data) {
  cache.delete(key) // re-insert so the oldest key stays first for eviction
  cache.set(key, { at: Date.now(), data })
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
}

/** Forget every cached answer and any active cooldown. Used by tests. */
export function clearCache() {
  cache.clear()
  blockedUntil = 0
  lastCallAt = 0
}

/* ---- requests ---- */

function kaspiError(message, { status = null, code = null } = {}) {
  const e = new Error(message)
  if (status) e.status = status
  if (code) e.code = code
  return e
}

function retryAfterMs(res) {
  const secs = Number(res.headers.get('retry-after'))
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0
}

/**
 * One raw request to kaspi.kz through the proxy, with a timeout.
 * Used directly by the merchant cabinet API, which is token-authenticated and
 * must be neither paced nor cached.
 */
export async function kaspiFetch(url, opts = {}) {
  const { timeoutMs = TIMEOUT_MS, viaProxy = true, ...init } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const proxy = viaProxy ? dispatcher() : null
  try {
    // Node's global fetch honours an undici dispatcher, so the proxy needs no
    // separate client — and tests can swap globalThis.fetch.
    return await globalThis.fetch(url, { ...init, signal: ctrl.signal, ...(proxy ? { dispatcher: proxy } : {}) })
  } finally {
    clearTimeout(timer)
  }
}

/** Authenticated cabinet call: direct egress unless explicitly opted in. */
export function merchantFetch(url, opts = {}) {
  return kaspiFetch(url, { ...opts, viaProxy: PROXY_MERCHANT_API })
}

async function attempt(url, opts) {
  await pace()
  const res = await kaspiFetch(url, opts)
  if (res.status === 429 || res.status >= 500) {
    const e = kaspiError(`Kaspi ${res.status}`, { status: res.status, code: 'THROTTLED' })
    e.retryAfterMs = retryAfterMs(res)
    throw e
  }
  if (!res.ok) throw kaspiError(`Kaspi ${res.status}`, { status: res.status })
  // A 200 carrying HTML is the anti-bot page, not an answer.
  if (!(res.headers.get('content-type') || '').includes('json')) {
    throw kaspiError('Kaspi returned non-JSON (blocked)', { code: 'NON_JSON' })
  }
  return res.json()
}

/**
 * Fetch JSON from a public Kaspi endpoint.
 * @returns {Promise<{data: any, stale: boolean, fetchedAt: number}>}
 *   `stale` means Kaspi refused and this is the last good answer.
 */
export async function kaspiJSON(url, opts = {}) {
  const key = cacheKey(url, opts)
  const fresh = readCache(key, freshMs())
  if (fresh) return { data: fresh.data, stale: false, fetchedAt: fresh.at }

  // Still cooling down from a 429: answer from cache rather than dig deeper.
  if (cooldownLeft() > 0) {
    const cached = readCache(key, staleMs())
    if (cached) return { data: cached.data, stale: true, fetchedAt: cached.at }
    throw kaspiError('Kaspi cooling down after 429', { status: 429, code: 'COOLDOWN' })
  }

  const backoff = backoffMs()
  let lastError = null
  for (let tryIndex = 0; tryIndex <= backoff.length; tryIndex++) {
    try {
      const data = await attempt(url, opts)
      writeCache(key, data)
      return { data, stale: false, fetchedAt: Date.now() }
    } catch (e) {
      lastError = e
      if (e.status === 429) startCooldown(e.retryAfterMs || 0)
      if (e.code !== 'THROTTLED' || tryIndex === backoff.length) break
      await sleep(Math.max(backoff[tryIndex], e.retryAfterMs || 0))
    }
  }

  const cached = readCache(key, staleMs())
  if (cached) return { data: cached.data, stale: true, fetchedAt: cached.at }
  throw lastError
}
