/* ============================================================
   Kaspi pre-order price list — end-to-end checks.

   Runs the real server against a throwaway data directory
   (KX_DATA_DIR), so the production database is never touched.
   Every assertion maps to a documented Kaspi rule — see
   guide.kaspi.kz/partner/ru/shop/goods/price_list (q2962, q3347).
   ============================================================ */

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'kx-price-list-test-'))
const PORT = 8912
const BASE = `http://127.0.0.1:${PORT}`

process.env.KX_DATA_DIR = DATA_DIR
process.env.KX_NO_SCHEDULER = '1'
process.env.PORT = String(PORT)
process.env.JWT_SECRET = 'price-list-test-secret'
process.env.PUBLIC_BASE_URL = BASE

const { find, insert, uid, update } = await import('../db.js')
const { kaspiSku, MAX_PREORDER_DAYS, NO_BRAND, normalizePreorderDays } = await import('../taobao-product.js')
const { buildPreorderPriceListXml, ensurePriceListFeedKey, storeWarehouseMap } = await import('../kaspi-price-list.js')
const { cardLocked } = await import('../routes-taobao.js')
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
let userId
let store
let good
let withdrawn

const api = (path, options = {}) => fetch(`${BASE}${path}`, {
  ...options,
  headers: { ...auth, 'Content-Type': 'application/json', ...options.headers },
})

const seedProduct = (draft) => {
  const row = insert('taobaoProducts', {
    id: uid(), userId, preferredStoreId: store.id,
    product: { source: 'taobao', productId: draft.sku, draft },
    createdAt: Date.now(), updatedAt: Date.now(),
  })
  insert('imports', {
    id: uid(), userId, storeId: store.id, taobaoProductId: row.id,
    code: `IMP-${row.id.slice(0, 6)}`, status: 'ACCEPTED', products: [draft], createdAt: Date.now(),
  })
  return row
}

before(async () => {
  const registered = await (await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'price-list@test.local', password: 'test-password-1' }),
  })).json()
  auth = { Authorization: `Bearer ${registered.token}` }
  userId = registered.user.id

  store = insert('stores', {
    id: uid(), userId, merchantId: '30364386', name: 'Тест & Ко <магазин>', token: 'fake', createdAt: Date.now(),
  })
  ensurePriceListFeedKey(store)

  const base = {
    category: 'Master - Cases', images: [{ url: 'https://example.kz/a.jpg' }],
    warehouses: ['PP2'], deliveryDays: 14,
  }
  good = seedProduct({ ...base, sku: 'TB801234567890', title: 'Чехол "Pro" & <кейс>', brand: 'Baseus', salePrice: 18900, stock: 7 })
  withdrawn = seedProduct({ ...base, sku: 'TB700', title: 'Снят с продажи', brand: NO_BRAND, salePrice: 5000, stock: 0 })

  await api(`/api/stores/${store.id}/preorder-feed`, {
    method: 'PUT',
    body: JSON.stringify({ warehouses: [{ id: 'PP2', available: true }, { id: 'PP1', available: false }] }),
  })
})

after(async () => {
  server.close()
  // db.js debounces its writes; let the last one land before the directory goes.
  await new Promise((resolve) => setTimeout(resolve, 250))
  rmSync(DATA_DIR, { recursive: true, force: true })
})

describe('documented field rules', () => {
  it('SKU keeps only latin letters and digits, max 20 chars', () => {
    assert.equal(kaspiSku('TB-801234567890'), 'TB801234567890')
    assert.equal(kaspiSku('1688-912345678901'), '1688912345678901')
    assert.equal(kaspiSku('A'.repeat(40)).length, 20)
    assert.match(kaspiSku('Артикул', 'row-1'), /^TB[0-9a-f]{18}$/)
  })

  it('pre-order never exceeds 30 days', () => {
    assert.equal(MAX_PREORDER_DAYS, 30)
    assert.equal(normalizePreorderDays(90), 30)
    assert.equal(normalizePreorderDays(7), 7)
  })

  it('the warehouse map falls back to the points named on the product', () => {
    assert.deepEqual(storeWarehouseMap({}, ['pp2']), [{ id: 'PP2', available: true }])
    assert.deepEqual(
      storeWarehouseMap({ priceListWarehouses: [{ id: 'PP2', available: true }, { id: 'PP1', available: false }] }),
      [{ id: 'PP2', available: true }, { id: 'PP1', available: false }],
    )
  })
})

describe('generated document', () => {
  let xml
  let bytes

  before(async () => {
    const feedStore = (await (await api(`/api/stores/${store.id}/preorder-feed`)).json()).feed
    const res = await fetch(feedStore.url)
    bytes = Buffer.from(await res.arrayBuffer())
    xml = bytes.toString('utf8')
    assert.equal(res.status, 200)
  })

  it('is well formed and follows the XSD element order', () => {
    assert.equal(xmlWellFormed(xml), null)
    assert.match(xml, /<model>[\s\S]*?<brand>[\s\S]*?<availabilities>[\s\S]*?<\/availabilities>[\s\S]*?<price>/)
    assert.match(xml, /xmlns="kaspiShopping"/)
    assert.match(xml, /<merchantid>30364386<\/merchantid>/)
  })

  it('is single-encoded UTF-8', () => {
    // The third-party feed this replaces double-encoded its Cyrillic company name.
    const company = bytes.slice(bytes.indexOf('<company>') + 9, bytes.indexOf('</company>'))
    assert.ok(company.toString('hex').startsWith('d0a2d0b5d181d182'), company.toString('hex'))
    assert.ok(!xml.includes('Ð'))
  })

  it('escapes the characters Kaspi lists', () => {
    assert.match(xml, /<model>Чехол "Pro" &amp; &lt;кейс&gt;<\/model>/)
    assert.match(xml, /<company>Тест &amp; Ко &lt;магазин&gt;<\/company>/)
  })

  it('sells only from points flagged yes and silences the rest', () => {
    assert.match(xml, /<availability available="yes" storeId="PP2" stockCount="7" preOrder="14"\/>/)
    assert.match(xml, /<availability available="no" storeId="PP1" stockCount="0"\/>/)
    assert.ok(!/available="no"[^>]*preOrder=/.test(xml), 'preOrder must not appear on unavailable points')
  })

  it('withdraws an out-of-stock product instead of dropping it from the file', () => {
    // Omitting it would leave the old price on sale in Kaspi.
    assert.match(xml, /<offer sku="TB700">/)
    const offer = xml.slice(xml.indexOf('<offer sku="TB700">'), xml.indexOf('</offer>', xml.indexOf('<offer sku="TB700">')))
    assert.ok(!offer.includes('available="yes"'), offer)
  })

  it('writes prices as bare integers', () => {
    assert.match(xml, /<price>18900<\/price>/)
    assert.ok(!/<price>[^<]*[., ]/.test(xml))
  })
})

describe('public endpoint', () => {
  it('404s an unknown key', async () => {
    assert.equal((await fetch(`${BASE}/api/stores/preorder-feed/deadbeefdeadbeef.xml`)).status, 404)
  })

  it('records each fetch', async () => {
    const url = (await (await api(`/api/stores/${store.id}/preorder-feed`)).json()).feed.url
    await fetch(url)
    const feed = (await (await api(`/api/stores/${store.id}/preorder-feed`)).json()).feed
    assert.ok(feed.fetchCount > 0)
    assert.ok(feed.fetchedAt)
  })

  it('refuses to serve a catalog with no offers', async () => {
    const empty = insert('stores', {
      id: uid(), userId, merchantId: '111', name: 'Пустой', token: 'fake', createdAt: Date.now(),
    })
    const url = (await (await api(`/api/stores/${empty.id}/preorder-feed`)).json()).feed.url
    assert.equal((await fetch(url)).status, 409)
    assert.equal(buildPreorderPriceListXml(empty).offers.length, 0)
  })
})

describe('card lock', () => {
  it('locks a card that already went out to Kaspi', () => {
    assert.equal(cardLocked(userId, good), true)
  })

  it('does not lock a card Kaspi rejected — there is no pre-order to protect', () => {
    // A rejected import still carries an import code; the seller must be able
    // to fix the draft and send it again, or the product is stuck for good.
    const row = seedProduct({
      sku: 'TB404404', title: 'Отклонён', brand: NO_BRAND, salePrice: 990, stock: 1,
      category: 'Master - Cases', images: [{ url: 'https://example.kz/c.jpg' }], warehouses: ['PP2'], deliveryDays: 5,
    })
    const attempt = find('imports', (item) => item.taobaoProductId === row.id)
    update('imports', attempt.id, { localError: 'Kaspi отклонил характеристики товара.' })
    assert.equal(cardLocked(userId, row), false)
  })

  it('refuses to re-publish it', async () => {
    const res = await api(`/api/taobao/${good.id}/import`, {
      method: 'POST',
      body: JSON.stringify({ storeId: store.id }),
    })
    assert.equal(res.status, 409)
    assert.equal((await res.json()).error, 'card_locked')
  })

  it('retry saves the draft through the feed instead of touching Kaspi', async () => {
    const res = await api(`/api/taobao/preorders/${good.id}/retry`, { method: 'POST', body: JSON.stringify({}) })
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.via, 'feed')
  })

  it('unlocking allows one more publication', async () => {
    await api(`/api/taobao/preorders/${good.id}/unlock-card`, { method: 'POST' })
    const { preorder } = await (await api(`/api/taobao/preorders/${good.id}`)).json()
    assert.equal(preorder.cardLocked, false)
  })
})

describe('pipeline stage', () => {
  it('waits before claiming a product needs linking, then says so', async () => {
    // Seeded fresh: opening a card triggers a Kaspi status sync, which cannot
    // succeed against a fake token and would colour the stage.
    const fresh = seedProduct({
      sku: 'TB555000111', title: 'Свежий', brand: NO_BRAND, salePrice: 4200, stock: 3,
      category: 'Master - Cases', images: [{ url: 'https://example.kz/b.jpg' }], warehouses: ['PP2'], deliveryDays: 10,
    })
    const stageOf = async () => {
      const { preorders } = await (await api('/api/taobao/preorders')).json()
      return preorders.find((row) => row.id === fresh.id)?.stage
    }
    // Kaspi last read the file before this offer existed — nothing to report yet.
    assert.equal(await stageOf(), 'in_feed')

    const url = (await (await api(`/api/stores/${store.id}/preorder-feed`)).json()).feed.url
    await fetch(url)
    // Now Kaspi has seen the offer and the product is still not on sale.
    assert.equal(await stageOf(), 'awaiting_link')
  })

  it('does not claim linking is needed for an article the feed never carried', async () => {
    const orphan = seedProduct({
      sku: 'TB999NOFEED', title: 'Без склада', brand: NO_BRAND, salePrice: 100, stock: 5,
      category: 'Master - Cases', images: [], warehouses: ['PP2'], deliveryDays: 10,
    })
    const { preorders } = await (await api('/api/taobao/preorders')).json()
    assert.equal(preorders.find((row) => row.id === orphan.id)?.stage, 'card_sent')
  })

  it('marks a draft that Kaspi never accepted as blocked', async () => {
    const { preorders } = await (await api('/api/taobao/preorders')).json()
    assert.ok(preorders.every((row) => typeof row.stage === 'string'))
    assert.ok(preorders.some((row) => row.id === withdrawn.id))
  })
})
