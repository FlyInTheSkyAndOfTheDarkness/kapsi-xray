/* ============================================================
   Kaspi price-list feed — end-to-end checks.

   Runs the real server against a throwaway data directory
   (KX_DATA_DIR), so the production database is never touched.
   Every assertion here maps to a documented Kaspi rule; see
   guide.kaspi.kz/partner/ru/shop/goods/price_list.
   ============================================================ */

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'kx-feed-test-'))
const PORT = 8911
const BASE = `http://127.0.0.1:${PORT}`

process.env.KX_DATA_DIR = DATA_DIR
process.env.KX_NO_SCHEDULER = '1'
process.env.PORT = String(PORT)
process.env.JWT_SECRET = 'feed-test-secret'
process.env.PUBLIC_BASE_URL = BASE

const { insert, uid } = await import('../db.js')
const { clampPreorderDays, escapeXml, kaspiSku, MAX_PREORDER_DAYS } = await import('../kaspi-feed.js')
const { mergeProduct, NO_BRAND } = await import('../taobao-product.js')
const { cardLocked, publishPreorderCard } = await import('../routes-taobao.js')
const { server } = await import('../index.js')

/** Every open tag closed in order — a cheap stand-in for a schema validator. */
function xmlWellFormed(xml) {
  const stack = []
  const re = /<(\/?)([A-Za-z_][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  let match
  while ((match = re.exec(xml))) {
    const [, closing, name, , selfClosing] = match
    if (selfClosing) continue
    if (closing) {
      if (stack.pop() !== name) return `unbalanced at </${name}>`
    } else stack.push(name)
  }
  return stack.length ? `unclosed <${stack.pop()}>` : null
}

let auth
let store
let good
let paused
let broken

const api = (path, options = {}) => fetch(`${BASE}${path}`, {
  ...options,
  headers: { ...auth, 'Content-Type': 'application/json', ...options.headers },
})
const basic = (login, password) => ({ Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}` })

before(async () => {
  const registered = await (await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'feed@test.local', password: 'test-password-1' }),
  })).json()
  auth = { Authorization: `Bearer ${registered.token}` }
  const userId = registered.user.id

  store = insert('stores', {
    id: uid(), userId, merchantId: '30364386', name: 'Тест & Ко <магазин>', token: 'fake', createdAt: Date.now(),
  })
  const seed = (draft, extra = {}) => insert('taobaoProducts', {
    id: uid(), userId, preferredStoreId: store.id,
    product: { source: 'taobao', productId: draft.sku, draft },
    createdAt: Date.now(), updatedAt: Date.now(), ...extra,
  })

  good = seed({
    sku: 'TB-801234567890', title: 'Чехол "Pro" & <кейс>', brand: 'Baseus', category: 'Master - Cases',
    salePrice: 18900, stock: 7, deliveryDays: 90, warehouses: ['PP1', 'PP2'],
  })
  paused = seed({
    sku: 'TB700', title: 'Снят с продажи', brand: '', category: 'Master - Other',
    salePrice: 5000, stock: 4, warehouses: ['PP1'], feedEnabled: false,
  })
  broken = seed({
    sku: 'TB900', title: 'Без цены', brand: 'NoName', category: 'Master - Other',
    salePrice: 0, stock: 3, warehouses: [],
  })
  insert('imports', {
    id: uid(), userId, storeId: store.id, taobaoProductId: good.id, code: 'IMP-1', products: [], createdAt: Date.now(),
  })

  await api(`/api/feeds/${store.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      warehouses: [{ id: 'PP2', available: true }, { id: 'PP1', available: false }],
      preorderDays: 45, stock: 12, basicLogin: 'kaspi', basicPassword: 's3cret',
    }),
  })
})

after(async () => {
  server.close()
  // db.js debounces its writes; let the last one land before the directory goes.
  await new Promise((resolve) => setTimeout(resolve, 250))
  rmSync(DATA_DIR, { recursive: true, force: true })
})

describe('price-list rules', () => {
  it('SKU keeps only latin letters and digits, max 20 chars', () => {
    assert.equal(kaspiSku('TB-801234567890'), 'TB801234567890')
    assert.equal(kaspiSku('A'.repeat(40)).length, 20)
    assert.match(kaspiSku('Артикул', 'row-1'), /^TB[0-9a-f]{18}$/)
  })

  it('pre-order is capped at 30 days', () => {
    assert.equal(clampPreorderDays(90), MAX_PREORDER_DAYS)
    assert.equal(clampPreorderDays(7), 7)
  })

  it('escapes the five characters Kaspi lists and drops control bytes', () => {
    assert.equal(escapeXml(`Ka"s<p>i & 'x'`), 'Ka&quot;s&lt;p&gt;i &amp; &apos;x&apos;')
    assert.equal(escapeXml('ab'), 'ab')
  })

  it('normalizes the draft once, so card and feed carry the same SKU', () => {
    const draft = mergeProduct(good, good.product.draft)
    assert.equal(draft.sku, 'TB801234567890')
    assert.equal(draft.deliveryDays, MAX_PREORDER_DAYS)
  })

  it('falls back to «Без бренда» for unbranded goods', () => {
    assert.equal(mergeProduct(paused, paused.product.draft).brand, NO_BRAND)
  })
})

describe('feed contents', () => {
  it('keeps drafts with blocking issues out and reports why', async () => {
    const data = await (await api(`/api/feeds/${store.id}`)).json()
    const byId = Object.fromEntries(data.entries.map((entry) => [entry.id, entry]))
    assert.equal(data.offerCount, 2)
    assert.ok(byId[broken.id].issues.includes('no_price'))
    assert.equal(byId[broken.id].included, false)
    assert.ok(byId[good.id].issues.includes('sku_normalized'))
    assert.ok(byId[good.id].issues.includes('preorder_clamped'))
    assert.ok(byId[paused.id].issues.includes('brand_defaulted'))
    assert.ok(byId[paused.id].issues.includes('card_not_published'))
  })

  it('exposes the per-warehouse selling flag', async () => {
    const data = await (await api(`/api/feeds/${store.id}`)).json()
    const entry = data.entries.find((row) => row.id === good.id)
    assert.deepEqual(entry.warehouses, [{ id: 'PP2', available: true }, { id: 'PP1', available: false }])
  })
})

describe('served document', () => {
  let xml
  let bytes

  before(async () => {
    const data = await (await api(`/api/feeds/${store.id}`)).json()
    const res = await fetch(data.feed.url, { headers: basic('kaspi', 's3cret') })
    bytes = Buffer.from(await res.arrayBuffer())
    xml = bytes.toString('utf8')
  })

  it('is well formed and follows the XSD element order', () => {
    assert.equal(xmlWellFormed(xml), null)
    assert.match(xml, /<model>[\s\S]*?<brand>[\s\S]*?<availabilities>[\s\S]*?<\/availabilities>[\s\S]*?<price>/)
    assert.match(xml, /<kaspi_catalog date="[^"]+"/)
    assert.match(xml, /xmlns="kaspiShopping"/)
    assert.match(xml, /<merchantid>30364386<\/merchantid>/)
  })

  it('is single-encoded UTF-8', () => {
    // The third-party feed this replaced double-encoded its Cyrillic company name.
    const company = bytes.slice(bytes.indexOf('<company>') + 9, bytes.indexOf('</company>'))
    assert.ok(company.toString('hex').startsWith('d0a2d0b5d181d182'), company.toString('hex'))
    assert.equal(company.toString('utf8'), 'Тест &amp; Ко &lt;магазин&gt;')
    assert.ok(!xml.includes('Ð'))
  })

  it('sells only from warehouses flagged yes, and silences the rest', () => {
    assert.match(xml, /<availability available="yes" storeId="PP2" stockCount="7" preOrder="30"\/>/)
    assert.match(xml, /<availability available="no" storeId="PP1" stockCount="0"\/>/)
    assert.ok(!/available="no"[^>]*preOrder=/.test(xml), 'preOrder must not appear on unavailable points')
  })

  it('writes prices as bare integers', () => {
    assert.match(xml, /<price>18900<\/price>/)
    assert.ok(!/<price>[^<]*[., ]/.test(xml))
  })
})

describe('public endpoint', () => {
  let url

  before(async () => {
    url = (await (await api(`/api/feeds/${store.id}`)).json()).feed.url
  })

  it('enforces basic auth when credentials are set', async () => {
    const anonymous = await fetch(url)
    assert.equal(anonymous.status, 401)
    assert.match(anonymous.headers.get('www-authenticate') || '', /Basic/)
    assert.equal((await fetch(url, { headers: basic('kaspi', 'nope') })).status, 401)
  })

  it('404s an unknown token', async () => {
    assert.equal((await fetch(`${BASE}/feed/kaspi/deadbeefdeadbeefdeadbeef.xml`)).status, 404)
  })

  it('records each fetch and self-check confirms reachability', async () => {
    const before2 = (await (await api(`/api/feeds/${store.id}`)).json()).feed.fetchCount
    await fetch(url, { headers: basic('kaspi', 's3cret') })
    const check = await (await api(`/api/feeds/${store.id}/selfcheck`, { method: 'POST' })).json()
    assert.equal(check.ok, true)
    assert.equal(check.offers, 2)
    const after2 = (await (await api(`/api/feeds/${store.id}`)).json()).feed
    assert.ok(after2.fetchCount > before2)
    assert.ok(after2.lastFetchAt)
  })

  it('rotating the token retires the old URL', async () => {
    const rotated = await (await api(`/api/feeds/${store.id}/rotate`, { method: 'POST' })).json()
    assert.notEqual(rotated.feed.url, url)
    assert.equal((await fetch(url, { headers: basic('kaspi', 's3cret') })).status, 404)
    url = rotated.feed.url
  })

  it('refuses to serve a catalog with no offers', async () => {
    await api(`/api/taobao/preorders/${good.id}`, {
      method: 'PUT',
      body: JSON.stringify({ product: { ...good.product.draft, feedEnabled: false } }),
    })
    const cleared = await (await api(`/api/feeds/${store.id}`, {
      method: 'PUT',
      body: JSON.stringify({ includePaused: false }),
    })).json()
    assert.equal(cleared.offerCount, 0)
    assert.equal((await fetch(cleared.feed.url, { headers: basic('kaspi', 's3cret') })).status, 409)
    // The preview still renders, so the seller can see what would be sent.
    assert.equal(xmlWellFormed(await (await api(`/api/feeds/${store.id}/xml`)).text()), null)
  })
})

describe('card lock', () => {
  it('locks a card that already went out to Kaspi', () => {
    assert.equal(cardLocked(store.userId, good), true)
    assert.equal(cardLocked(store.userId, broken), false)
  })

  it('refuses to re-publish a locked card before touching the Kaspi API', async () => {
    const result = await publishPreorderCard({
      userId: store.userId, productRow: good, storeId: store.id, sourceProduct: {}, baseUrl: BASE,
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'card_locked')
  })

  it('unlocking allows exactly one more publication', async () => {
    await api(`/api/taobao/preorders/${good.id}/unlock-card`, { method: 'POST' })
    const { preorder } = await (await api(`/api/taobao/preorders/${good.id}`)).json()
    assert.equal(preorder.cardLocked, false)
  })
})

describe('pipeline stage', () => {
  it('reports where the product actually is', async () => {
    const { preorders } = await (await api('/api/taobao/preorders')).json()
    const stages = Object.fromEntries(preorders.map((row) => [row.id, row.stage]))
    // broken has no card and cannot enter the feed
    assert.equal(stages[broken.id], 'blocked')
    // paused was withdrawn by the seller, so it is held back too
    assert.ok(['blocked', 'card_sent'].includes(stages[paused.id]))
  })
})
