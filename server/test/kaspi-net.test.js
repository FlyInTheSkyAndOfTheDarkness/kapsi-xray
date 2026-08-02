/* ============================================================
   Staying useful while Kaspi says no.

   From a datacenter IP Kaspi answers 429 with an HTML anti-bot
   page. Before this layer existed that surfaced as an empty
   catalog on every page — no products, no analytics, no reason
   given. What matters here is that a refusal never costs the
   seller data we already had.
   ============================================================ */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.KX_DATA_DIR = mkdtempSync(join(tmpdir(), 'kx-net-test-'))
process.env.KASPI_MIN_GAP_MS = '1'
process.env.KASPI_BACKOFF_MS = '1'
process.env.KASPI_COOLDOWN_MS = '2000'

const { kaspiJSON, clearCache, cooldownLeft } = await import('../kaspi-net.js')
const { merchantProducts } = await import('../kaspi.js')

const URL_A = 'https://kaspi.kz/yml/product-view/pl/results?text=&q=a'
const realFetch = globalThis.fetch

/* Answers are built per call: a Response body can only be read once, so a
   repeated answer has to be a fresh object each time. */
const json = (data) => () => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
/* The anti-bot page: a 429 whose body is HTML — exactly what the server saw. */
const blocked = () => () => new Response('<!DOCTYPE html><html lang="ru">', { status: 429, headers: { 'content-type': 'text/html' } })
const html200 = () => () => new Response('<!DOCTYPE html>', { status: 200, headers: { 'content-type': 'text/html' } })

/** Queue Kaspi's answers, one per call; the last one repeats. */
function serve(...answers) {
  const queue = [...answers]
  const calls = { count: 0 }
  globalThis.fetch = async () => {
    calls.count++
    const next = queue.length > 1 ? queue.shift() : queue[0]
    return next()
  }
  return calls
}

beforeEach(() => clearCache())
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.KASPI_CACHE_TTL_MS
})

describe('reading a public Kaspi endpoint', () => {
  it('returns what Kaspi sent, marked fresh', async () => {
    serve(json({ data: [{ id: 1 }] }))
    const answer = await kaspiJSON(URL_A)
    assert.deepEqual(answer.data, { data: [{ id: 1 }] })
    assert.equal(answer.stale, false)
  })

  it('serves a repeat read from cache instead of asking again', async () => {
    const calls = serve(json({ data: ['first'] }))
    await kaspiJSON(URL_A)
    const second = await kaspiJSON(URL_A)
    assert.equal(calls.count, 1, 'the second read must not reach Kaspi')
    assert.deepEqual(second.data, { data: ['first'] })
    assert.equal(second.stale, false)
  })

  it('keys the cache by body so two offer lookups do not collide', async () => {
    const calls = serve(json({ offers: ['a'] }), json({ offers: ['b'] }))
    const post = (body) => kaspiJSON(URL_A, { method: 'POST', body })
    assert.deepEqual((await post('{"id":"1"}')).data, { offers: ['a'] })
    assert.deepEqual((await post('{"id":"2"}')).data, { offers: ['b'] })
    assert.equal(calls.count, 2)
  })
})

describe('when Kaspi refuses', () => {
  it('falls back to the last good answer rather than going empty', async () => {
    serve(json({ data: ['good'] }))
    await kaspiJSON(URL_A)

    // Expire the fresh window so the refusal is actually reached.
    process.env.KASPI_CACHE_TTL_MS = '1'
    await new Promise((r) => setTimeout(r, 5))
    serve(blocked())

    const answer = await kaspiJSON(URL_A)
    assert.deepEqual(answer.data, { data: ['good'] }, 'the seller keeps the catalog we already had')
    assert.equal(answer.stale, true, 'and is told it is not current')
  })

  it('surfaces the 429 when there is nothing cached to fall back on', async () => {
    serve(blocked())
    await assert.rejects(() => kaspiJSON(URL_A), (e) => e.status === 429)
  })

  it('stops calling for a cooldown so a throttled IP is not dug deeper', async () => {
    serve(blocked())
    await assert.rejects(() => kaspiJSON(URL_A))
    assert.ok(cooldownLeft() > 0, 'a 429 must start a quiet period')

    const calls = serve(json({ data: ['ok'] }))
    await assert.rejects(() => kaspiJSON('https://kaspi.kz/yml/other'), (e) => e.code === 'COOLDOWN')
    assert.equal(calls.count, 0, 'no request may leave during the cooldown')
  })

  it('retries a 429 before giving up on it', async () => {
    const calls = serve(blocked(), json({ data: ['late'] }))
    const answer = await kaspiJSON(URL_A)
    assert.deepEqual(answer.data, { data: ['late'] })
    assert.equal(answer.stale, false)
    assert.equal(calls.count, 2, 'the first refusal must not be final')
  })

  it('treats a 200 carrying HTML as a block, not as data', async () => {
    serve(html200())
    await assert.rejects(() => kaspiJSON(URL_A), (e) => e.code === 'NON_JSON')
  })
})

/* Kaspi serves this listing 12 at a time and ignores the `limit` we send, so
   these fixtures use 12 — the number the real endpoint actually returns. */
const PAGE_SIZE = 12
const pageOf = (n) => json({ data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `p${n}-${i}`, title: 'x', unitPrice: 1 })) })

describe('walking the catalog pages', () => {
  it('reads past the old eight-page ceiling instead of stopping at 96', async () => {
    let call = 0
    // 30 full pages then the end: 360 products, far past what used to be read.
    globalThis.fetch = async () => (call++ < 30 ? pageOf(call)() : json({ data: [] })())

    const result = await merchantProducts('30336022')
    assert.equal(result.products.length, 30 * PAGE_SIZE, 'the whole catalog, not the first eight pages')
    assert.equal(result.truncated, false)
  })

  it('ends the walk on an empty page', async () => {
    let call = 0
    globalThis.fetch = async () => (call++ < 2 ? pageOf(call)() : json({ data: [] })())
    const result = await merchantProducts('30336022')
    assert.equal(result.products.length, 2 * PAGE_SIZE)
    assert.equal(result.truncated, false, 'reaching the end is not a cut-off')
  })

  it('ends the walk when pages stop adding anything new', async () => {
    // Kaspi's pages overlap; a listing that cycles must not spin to the cap.
    let call = 0
    globalThis.fetch = async () => (call++ < 1 ? pageOf(1)() : pageOf(1)())
    const result = await merchantProducts('30336022')
    assert.equal(result.products.length, PAGE_SIZE, 'duplicates across pages collapse')
    assert.equal(result.truncated, false)
  })

  it('keeps the pages already read when a later one is refused', async () => {
    let call = 0
    globalThis.fetch = async () => (++call <= 2 ? pageOf(call)() : blocked()())

    const result = await merchantProducts('30336022')
    assert.equal(result.products.length, 2 * PAGE_SIZE, 'two pages survive the third being blocked')
    assert.equal(result.truncated, true, 'and the catalog is flagged as incomplete')
  })

  it('reports the refusal when not a single page came back', async () => {
    serve(blocked())
    await assert.rejects(() => merchantProducts('30336022'), (e) => e.status === 429)
  })
})
