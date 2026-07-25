import { Router } from 'express'
import { requireAuth } from './auth.js'
import { all, find, filter, insert, update, remove, uid } from './db.js'
import * as kaspi from './kaspi.js'
import { estimateCard, productProfit } from './analyze.js'
import { buildImportPayload, publicRepricer, runRepricer, sanitizeWarehouses } from './repricer.js'
import { buildPreorderPriceListXml, ensurePriceListFeedKey, preorderPriceListSummary, storeByPreorderFeedKey } from './kaspi-price-list.js'
import { loadClassificationAttributes } from './kaspi-classification.js'
import { preorderRowForSku, setPreorderPrice } from './preorder-link.js'

export const storesRouter = Router()

storesRouter.get('/preorder-feed/:key.xml', (req, res) => {
  const store = storeByPreorderFeedKey(String(req.params.key || '').trim())
  if (!store) return res.status(404).type('text/plain').send('feed_not_found')
  const feed = buildPreorderPriceListXml(store)
  // The XSD requires at least one <offer>; an empty catalog would be a parse
  // error on Kaspi's side, so say so in plain text instead.
  if (!feed.offers.length) return res.status(409).type('text/plain').send('no_publishable_offers')
  update('stores', store.id, {
    priceListFetchedAt: Date.now(),
    priceListFetchCount: (store.priceListFetchCount || 0) + 1,
    priceListOfferCount: feed.offers.length,
  })
  res.setHeader('content-type', 'application/xml; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.send(feed.xml)
})

storesRouter.use(requireAuth)

function parseMerchantRef(input) {
  const s = String(input || '').trim()
  const m = s.match(/[?&]m=(\d{4,})/)
  if (m) return m[1]
  if (/^\d{4,}$/.test(s)) return s
  return null
}

const cogsMap = (userId, storeId) => {
  const map = {}
  filter('cogs', (c) => c.userId === userId && c.storeId === storeId).forEach((c) => (map[c.sku] = c))
  return map
}

function productSettingsPatch(body = {}) {
  const patch = {}
  ;['cost', 'salePrice', 'stock', 'targetMargin', 'packaging', 'logistics'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const raw = body[key]
      patch[key] = raw === '' || raw == null ? null : Math.max(0, Number(raw) || 0)
    }
  })
  if (body.warehouses !== undefined) patch.warehouses = sanitizeWarehouses(body.warehouses)
  return patch
}

function upsertProductSettings(userId, storeId, sku, patch) {
  const existing = find('cogs', (c) => c.userId === userId && c.storeId === storeId && c.sku === sku)
  const clean = { ...patch, updatedAt: Date.now() }
  if (existing) return update('cogs', existing.id, clean)
  return insert('cogs', { id: uid(), userId, storeId, sku, cost: null, ...clean, createdAt: Date.now() })
}

function applySettings(product, settings = {}) {
  const salePrice = settings.salePrice > 0 ? settings.salePrice : product.price
  return {
    ...product,
    kaspiPrice: product.price,
    price: salePrice,
    salePrice,
    cost: settings.cost || null,
    stock: settings.stock ?? null,
    targetMargin: settings.targetMargin ?? null,
    packaging: settings.packaging ?? null,
    logistics: settings.logistics ?? null,
    warehouses: Array.isArray(settings.warehouses) ? settings.warehouses : [],
  }
}

function markPublicCatalog(store, status, error = null, productCount = null) {
  const patch = { publicStatus: status, publicError: error, publicCheckedAt: Date.now() }
  if (productCount != null) patch.productCount = productCount
  return update('stores', store.id, patch) || store
}

function publicStore(s) {
  return {
    id: s.id,
    merchantId: s.merchantId,
    name: s.name,
    rating: s.rating,
    reviews: s.reviews,
    productCount: s.productCount,
    publicStatus: s.publicStatus || 'ok',
    publicError: s.publicError || null,
    publicCheckedAt: s.publicCheckedAt || null,
    hasToken: !!s.token,
    hasPreorderFeed: !!s.priceListFeedKey,
    createdAt: s.createdAt,
  }
}

function storeCatalogResponse(userId, store, products = [], truncated = false, warning = null) {
  const preorderEntries = preorderCatalogEntries(userId, store.id)
  const preorderById = new Map(preorderEntries.map((entry) => [entry.product.id, entry.product]))
  const mergedProducts = products.map((product) => {
    const preorder = preorderById.get(product.id)
    return preorder ? { ...product, ...preorder, price: product.price || preorder.price, link: product.link || preorder.link } : { ...product, sourceType: 'regular', saleMode: 'regular' }
  })
  const seen = new Set(mergedProducts.map((product) => product.id))
  preorderEntries.forEach((entry) => {
    if (!seen.has(entry.product.id)) {
      seen.add(entry.product.id)
      mergedProducts.push(entry.product)
    }
  })
  const settings = cogsMap(userId, store.id)
  const rows = mergedProducts.map((p) => {
    const product = applySettings(p, settings[p.id] || settings[p.taobaoSku])
    const est = estimateCard(p)
    const profit = productProfit(product, product.cost, est)
    return { ...product, est, profit }
  })
  return { store: publicStore(store), products: rows, truncated, warning }
}

const listData = (json) => (Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : [])

function normalizeOrder(row) {
  const a = row?.attributes || {}
  return {
    id: String(row?.id || ''),
    code: a.code || row?.id || '',
    state: a.state || '',
    status: a.status || '',
    deliveryMode: a.deliveryMode || a.deliveryType || '',
    paymentMode: a.paymentMode || '',
    totalPrice: Number(a.totalPrice || 0),
    deliveryCost: Number(a.deliveryCost || 0),
    creationDate: a.creationDate || null,
    approvedByBankDate: a.approvedByBankDate || null,
    entries: [],
  }
}

function normalizeEntry(row, product = null) {
  const a = row?.attributes || {}
  const relProduct = row?.relationships?.product?.data
  return {
    id: String(row?.id || ''),
    quantity: Number(a.quantity || a.qty || 1),
    totalPrice: Number(a.totalPrice || a.basePrice || a.price || 0),
    basePrice: Number(a.basePrice || a.price || 0),
    productId: product?.id || relProduct?.id || a.productCode || '',
    sku: product?.sku || product?.code || relProduct?.id || a.sku || a.productCode || '',
    title: product?.title || product?.name || a.name || a.title || '',
    brand: product?.brand || '',
  }
}

function normalizeProduct(row) {
  const a = row?.attributes || {}
  return {
    id: String(row?.id || ''),
    sku: a.code || a.sku || row?.id || '',
    code: a.code || a.sku || row?.id || '',
    title: a.name || a.title || '',
    name: a.name || a.title || '',
    brand: a.brand || '',
  }
}

async function enrichOrders(token, orders, { maxOrders = 40, maxEntries = 120 } = {}) {
  let loadedEntries = 0
  for (const order of orders.slice(0, maxOrders)) {
    if (loadedEntries >= maxEntries) break
    try {
      const entriesJson = await kaspi.merchantOrderEntries(token, order.id)
      const entries = []
      for (const entryRow of listData(entriesJson)) {
        if (loadedEntries >= maxEntries) break
        let product = null
        try {
          const productJson = await kaspi.merchantOrderEntryProduct(token, entryRow.id)
          product = normalizeProduct(productJson?.data || productJson)
        } catch {
          /* Product details are optional; keep the order entry without them. */
        }
        entries.push(normalizeEntry(entryRow, product))
        loadedEntries++
      }
      order.entries = entries
    } catch {
      /* Some old orders may not expose entries; keep the order itself. */
    }
  }
  return orders
}

function summarizeOrders(orders) {
  const bySku = {}
  const byDay = {}
  let revenue = 0
  orders.forEach((o) => {
    revenue += o.totalPrice || 0
    if (o.creationDate) {
      const day = new Date(o.creationDate).toISOString().slice(0, 10)
      byDay[day] = byDay[day] || { date: day, orders: 0, revenue: 0 }
      byDay[day].orders += 1
      byDay[day].revenue += o.totalPrice || 0
    }
    ;(o.entries || []).forEach((e) => {
      const sku = String(e.sku || e.productId || e.id || '').trim()
      if (!sku) return
      bySku[sku] = bySku[sku] || { sku, title: e.title || sku, brand: e.brand || '', units: 0, revenue: 0, orders: 0 }
      bySku[sku].units += e.quantity || 1
      bySku[sku].revenue += e.totalPrice || e.basePrice || 0
      bySku[sku].orders += 1
    })
  })
  return {
    orders: orders.length,
    revenue,
    avgCheck: orders.length ? Math.round(revenue / orders.length) : 0,
    byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
    bySku: Object.values(bySku).sort((a, b) => b.revenue - a.revenue),
  }
}

function latestTaobaoImportsForStore(userId, storeId) {
  const latest = new Map()
  filter('imports', (row) => row.userId === userId && row.storeId === storeId && row.taobaoProductId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .forEach((row) => {
      if (!latest.has(row.taobaoProductId)) latest.set(row.taobaoProductId, row)
    })
  return [...latest.values()]
}

function preorderCatalogEntries(userId, storeId) {
  return latestTaobaoImportsForStore(userId, storeId)
    .filter((row) => row.publishedProduct?.id || row.publishedProduct?.link)
    .map((row) => {
      const product = row.products?.[0] || {}
      const published = row.publishedProduct || {}
      return {
        publicId: String(published.id || ''),
        publicLink: published.link || null,
        product: {
          id: String(published.id || product.sku || ''),
          title: published.title || product.title || product.sku || '',
          brand: product.brand || '',
          categoryName: product.category || '',
          price: Number(published.price || product.salePrice || product.price || 0),
          image: published.image || product.images?.[0]?.url || null,
          link: published.link || null,
          taobaoPreorderId: row.taobaoProductId,
          taobaoSku: product.sku || '',
          sourceType: 'preorder',
          saleMode: 'preorder',
          deliveryDays: product.deliveryDays || product.preorderDays || null,
        },
      }
    })
    .filter((entry) => entry.product.id)
}

/** POST /api/stores/connect { ref, city } — connect a store by link/merchant id. */
storesRouter.post('/connect', async (req, res) => {
  const mid = parseMerchantRef(req.body?.ref)
  const city = req.body?.city || kaspi.DEFAULT_CITY
  if (!mid) return res.status(400).json({ error: 'bad_ref' })
  let store = find('stores', (s) => s.userId === req.user.id && s.merchantId === mid)
  try {
    const { products, truncated } = await kaspi.merchantProducts(mid, { city })
    if (!products.length) {
      const patch = {
        name: store?.name || `Магазин #${mid}`,
        rating: store?.rating ?? null,
        reviews: store?.reviews ?? null,
        productCount: store?.productCount || 0,
        publicStatus: 'unavailable',
        publicError: 'empty_public_catalog',
        publicCheckedAt: Date.now(),
      }
      if (store) store = update('stores', store.id, patch)
      else store = insert('stores', { id: uid(), userId: req.user.id, merchantId: mid, ...patch, token: null, createdAt: Date.now() })
      ensurePriceListFeedKey(store)
      return res.json({ store: publicStore(store), products: [], truncated: false, warning: 'empty_public_catalog' })
    }
    const info = await kaspi.merchantInfo(mid, products[0].id, { city })
    const patch = { name: info.name, rating: info.rating, reviews: info.reviews, productCount: products.length, publicStatus: 'ok', publicError: null, publicCheckedAt: Date.now() }
    if (store) store = update('stores', store.id, patch)
    else store = insert('stores', { id: uid(), userId: req.user.id, merchantId: mid, ...patch, token: null, createdAt: Date.now() })
    ensurePriceListFeedKey(store)
    res.json({ store: publicStore(store), products, truncated })
  } catch (e) {
    console.warn(`[stores/connect] Kaspi public catalog unavailable for merchant ${mid}: ${e?.message || e}`)
    const patch = {
      name: store?.name || `Магазин #${mid}`,
      rating: store?.rating ?? null,
      reviews: store?.reviews ?? null,
      productCount: store?.productCount || 0,
      publicStatus: 'unavailable',
      publicError: 'kaspi_unreachable',
      publicCheckedAt: Date.now(),
    }
    if (store) store = update('stores', store.id, patch)
    else store = insert('stores', { id: uid(), userId: req.user.id, merchantId: mid, ...patch, token: null, createdAt: Date.now() })
    ensurePriceListFeedKey(store)
    res.json({ store: publicStore(store), products: [], truncated: false, warning: 'kaspi_unreachable' })
  }
})

/** GET /api/stores — list the user's connected stores. */
storesRouter.get('/', (req, res) => {
  res.json({ stores: filter('stores', (s) => s.userId === req.user.id).map(publicStore) })
})

function normalizeSearchText(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeClassificationCategories(data) {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []
  const seen = new Set()
  return rows.map((row) => {
    const code = String(row?.code || '').trim()
    const title = String(row?.title || row?.name || '').trim()
    return code && title ? { code, title } : null
  }).filter((row) => {
    if (!row || seen.has(row.code)) return false
    seen.add(row.code)
    return true
  })
}

function categorySearchScore(category, query) {
  const q = normalizeSearchText(query)
  if (!q) return 1
  const title = normalizeSearchText(category.title)
  const code = normalizeSearchText(category.code.replace(/^master\s*-\s*/i, ''))
  const haystack = `${title} ${code}`
  const words = q.split(' ').filter((word) => word.length > 2)
  let score = 0
  if (title === q || code === q) score += 100
  if (title.includes(q)) score += 70
  if (code.includes(q)) score += 60
  score += words.filter((word) => haystack.includes(word)).length * 12
  return score
}

/** GET /api/stores/:id/classification/categories — Kaspi category codes for product import. */
storesRouter.get('/:id/classification/categories', async (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  if (!store.token) return res.status(400).json({ error: 'no_token' })
  const query = String(req.query.q || '').trim()
  const limit = Math.max(1, Math.min(80, Number(req.query.limit) || 24))
  try {
    const data = await kaspi.merchantClassificationCategories(store.token)
    const ranked = normalizeClassificationCategories(data)
      .map((category) => ({ ...category, score: categorySearchScore(category, query) }))
      .filter((category) => !query || category.score > 0)
      .sort((a, b) => b.score - a.score || a.title.length - b.title.length || a.title.localeCompare(b.title, 'ru'))
    res.json({ categories: ranked.slice(0, limit).map(({ score, ...category }) => category), total: ranked.length })
  } catch (e) {
    res.status(e.status === 401 ? 401 : 502).json({ error: 'classification_failed', status: e.status || null })
  }
})

/** GET /api/stores/:id/classification/attributes — Kaspi attributes for a category. */
storesRouter.get('/:id/classification/attributes', async (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  if (!store.token) return res.status(400).json({ error: 'no_token' })
  const category = String(req.query.category || req.query.c || '').trim()
  if (!category) return res.status(400).json({ error: 'bad_category' })
  try {
    const attributes = await loadClassificationAttributes(store.token, category)
    res.json({
      category,
      attributes,
      mandatory: attributes.filter((attribute) => attribute.mandatory),
    })
  } catch (e) {
    res.status(e.status === 401 ? 401 : 502).json({ error: 'classification_failed', status: e.status || null })
  }
})

storesRouter.get('/:id/preorder-feed', (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  res.json({ feed: preorderPriceListSummary(req, store) })
})

/**
 * PUT /api/stores/:id/preorder-feed { warehouses: [{ id, available }] }
 * The pickup-point map for the price list. Points switched off stay in the XML
 * with available="no" — that is the only way Kaspi stops selling from them.
 */
storesRouter.put('/:id/preorder-feed', (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  const seen = new Set()
  const warehouses = (Array.isArray(req.body?.warehouses) ? req.body.warehouses : [])
    .map((item) => ({
      id: String(item?.id ?? item ?? '').trim(),
      available: typeof item === 'object' && item !== null ? item.available !== false : true,
    }))
    .filter((item) => item.id && !seen.has(item.id) && (seen.add(item.id), true))
    .slice(0, 5)
  update('stores', store.id, { priceListWarehouses: warehouses, updatedAt: Date.now() })
  res.json({ feed: preorderPriceListSummary(req, find('stores', (s) => s.id === store.id)) })
})

/** GET /api/stores/:id — store + fresh catalog with estimates & profit (COGS). */
storesRouter.get('/:id', async (req, res) => {
  let store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  const city = req.query.city || kaspi.DEFAULT_CITY
  try {
    const { products, truncated } = await kaspi.merchantProducts(store.merchantId, { city })
    store = markPublicCatalog(store, 'ok', null, products.length)
    res.json(storeCatalogResponse(req.user.id, store, products, truncated))
  } catch (e) {
    console.warn(`[stores/get] Kaspi public catalog unavailable for merchant ${store.merchantId}: ${e?.message || e}`)
    store = markPublicCatalog(store, 'unavailable', 'kaspi_unreachable')
    res.json(storeCatalogResponse(req.user.id, store, [], false, 'kaspi_unreachable'))
  }
})

/** DELETE /api/stores/:id */
storesRouter.delete('/:id', (req, res) => {
  remove('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  remove('cogs', (c) => c.storeId === req.params.id && c.userId === req.user.id)
  res.json({ ok: true })
})

/** PUT /api/stores/:id/cogs { sku, cost } — set purchase cost for a SKU. */
storesRouter.put('/:id/cogs', (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  const sku = String(req.body?.sku || '')
  const cost = Math.max(0, Number(req.body?.cost) || 0)
  if (!sku) return res.status(400).json({ error: 'bad_sku' })
  const existing = find('cogs', (c) => c.userId === req.user.id && c.storeId === store.id && c.sku === sku)
  if (existing) update('cogs', existing.id, { cost })
  else insert('cogs', { id: uid(), userId: req.user.id, storeId: store.id, sku, cost })
  res.json({ ok: true, sku, cost })
})

/** PUT /api/stores/:id/products/:sku/settings — edit local product management fields. */
storesRouter.put('/:id/products/:sku/settings', (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  const sku = String(req.params.sku || req.body?.sku || '').trim()
  if (!sku) return res.status(400).json({ error: 'bad_sku' })
  const row = upsertProductSettings(req.user.id, store.id, sku, productSettingsPatch(req.body || {}))
  res.json({ ok: true, settings: row })
})

/** POST /api/stores/:id/products/:sku/publish — send price/stock change to Kaspi import API. */
storesRouter.post('/:id/products/:sku/publish', async (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  if (!store.token) return res.status(400).json({ error: 'no_token' })
  const sku = String(req.params.sku || req.body?.sku || '').trim()
  if (!sku) return res.status(400).json({ error: 'bad_sku' })
  const settings = upsertProductSettings(req.user.id, store.id, sku, productSettingsPatch(req.body?.settings || {}))
  // Pre-order goods are driven by the price list; re-sending their card would
  // drop the pre-order, so the new price is stored and the feed carries it.
  const preorderRow = preorderRowForSku(req.user.id, store.id, sku)
  if (preorderRow) {
    const price = settings.salePrice ?? req.body?.product?.price
    if (Number(price) > 0) setPreorderPrice(preorderRow, price)
    return res.json({ ok: true, via: 'feed', preorderId: preorderRow.id, settings })
  }

  const product = { ...(req.body?.product || {}), sku, id: sku }
  const payload = buildImportPayload(product, settings)
  if (!payload.sku || !payload.price) return res.status(400).json({ error: 'bad_product_payload', product: payload })
  try {
    const result = await kaspi.merchantImportProducts(store.token, [payload])
    const row = insert('imports', { id: uid(), userId: req.user.id, storeId: store.id, code: result?.code || null, status: result?.status || null, products: [payload], createdAt: Date.now() })
    res.json({ ok: true, import: row, result, product: payload })
  } catch (e) {
    res.status(e.status === 401 ? 401 : 502).json({ error: 'merchant_import_failed', status: e.status || null, details: e.data || null })
  }
})

/** GET /api/stores/:id/repricers — list dumping-bot rules for this store. */
storesRouter.get('/:id/repricers', (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  const rules = filter('repricers', (r) => r.userId === req.user.id && r.storeId === store.id).map(publicRepricer)
  res.json({ rules })
})

/** POST /api/stores/:id/repricers — create a dumping-bot rule. */
storesRouter.post('/:id/repricers', (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  const product = req.body?.product || {}
  const sku = String(req.body?.sku || product.id || product.sku || '').trim()
  if (!sku) return res.status(400).json({ error: 'bad_sku' })
  const minPrice = Math.max(0, Number(req.body?.minPrice) || 0)
  if (!minPrice) return res.status(400).json({ error: 'bad_min_price' })
  const row = insert('repricers', {
    id: uid(),
    userId: req.user.id,
    storeId: store.id,
    sku,
    title: product.title || sku,
    product,
    minPrice,
    step: Math.max(1, Number(req.body?.step) || 1),
    frequencyMinutes: Math.max(5, Number(req.body?.frequencyMinutes) || 60),
    warehouses: sanitizeWarehouses(req.body?.warehouses),
    stock: req.body?.stock === '' || req.body?.stock == null ? null : Math.max(0, Number(req.body.stock) || 0),
    currentPrice: Number(req.body?.currentPrice || product.price || 0),
    active: !!req.body?.active,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nextRunAt: Date.now() + Math.max(5, Number(req.body?.frequencyMinutes) || 60) * 60_000,
  })
  res.json({ rule: publicRepricer(row) })
})

/** PUT /api/stores/:id/repricers/:rid — update a dumping-bot rule. */
storesRouter.put('/:id/repricers/:rid', (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  const rule = find('repricers', (r) => r.id === req.params.rid && r.userId === req.user.id && r.storeId === store.id)
  if (!rule) return res.status(404).json({ error: 'not_found' })
  const patch = { updatedAt: Date.now() }
  if (req.body?.minPrice !== undefined) patch.minPrice = Math.max(0, Number(req.body.minPrice) || 0)
  if (req.body?.step !== undefined) patch.step = Math.max(1, Number(req.body.step) || 1)
  if (req.body?.frequencyMinutes !== undefined) {
    patch.frequencyMinutes = Math.max(5, Number(req.body.frequencyMinutes) || 60)
    patch.nextRunAt = Date.now() + patch.frequencyMinutes * 60_000
  }
  if (req.body?.warehouses !== undefined) patch.warehouses = sanitizeWarehouses(req.body.warehouses)
  if (req.body?.stock !== undefined) patch.stock = req.body.stock === '' || req.body.stock == null ? null : Math.max(0, Number(req.body.stock) || 0)
  if (req.body?.active !== undefined) patch.active = !!req.body.active
  const saved = update('repricers', rule.id, patch)
  res.json({ rule: publicRepricer(saved) })
})

/** DELETE /api/stores/:id/repricers/:rid */
storesRouter.delete('/:id/repricers/:rid', (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  remove('repricers', (r) => r.id === req.params.rid && r.userId === req.user.id && r.storeId === store.id)
  res.json({ ok: true })
})

/** POST /api/stores/:id/repricers/:rid/run — check competitors and push price if needed. */
storesRouter.post('/:id/repricers/:rid/run', async (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  const rule = find('repricers', (r) => r.id === req.params.rid && r.userId === req.user.id && r.storeId === store.id)
  if (!rule) return res.status(404).json({ error: 'not_found' })
  try {
    const saved = await runRepricer(rule)
    res.json({ rule: publicRepricer(saved) })
  } catch (e) {
    update('repricers', rule.id, { lastRunAt: Date.now(), lastError: e.status === 401 ? 'token_failed' : 'repricer_failed', updatedAt: Date.now() })
    res.status(e.status === 401 ? 401 : 502).json({ error: 'repricer_failed', status: e.status || null, details: e.data || null })
  }
})

/** POST /api/stores/:id/token { token } — save the Kaspi merchant API token. */
storesRouter.post('/:id/token', async (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  const token = req.body?.token ? String(req.body.token).trim() : ''
  if (!token) {
    update('stores', store.id, { token: null, tokenCheckedAt: Date.now(), tokenStatus: 'empty' })
    return res.json({ ok: true, hasToken: false, tokenOk: false })
  }
  try {
    await kaspi.merchantImportSchema(token)
    ensurePriceListFeedKey(store)
    update('stores', store.id, { token, tokenCheckedAt: Date.now(), tokenStatus: 'ok' })
    res.json({ ok: true, hasToken: true, tokenOk: true })
  } catch (e) {
    res.status(e.status === 401 || e.status === 403 ? 401 : 502).json({ error: 'token_check_failed', status: e.status || null })
  }
})

/** GET /api/stores/:id/orders — real orders via merchant API (needs token). */
storesRouter.get('/:id/orders', async (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  if (!store.token) return res.status(400).json({ error: 'no_token' })
  try {
    const data = await kaspi.merchantOrders(store.token, {
      page: req.query.page || 0,
      size: req.query.size || 50,
      days: req.query.days || 30,
      state: req.query.state,
      status: req.query.status,
      code: req.query.code,
    })
    const orders = listData(data).map(normalizeOrder)
    if (req.query.entries === '1') await enrichOrders(store.token, orders)
    res.json({ orders, meta: data?.meta || null, raw: req.query.raw === '1' ? data : undefined })
  } catch (e) {
    res.status(e.status === 401 ? 401 : 502).json({ error: 'merchant_api_failed', status: e.status || null })
  }
})

/** GET /api/stores/:id/seller-summary — real sales summary from seller cabinet. */
storesRouter.get('/:id/seller-summary', async (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  if (!store.token) return res.status(400).json({ error: 'no_token' })
  try {
    const days = Math.max(1, Math.min(180, Number(req.query.days) || 30))
    const data = await kaspi.merchantOrders(store.token, { size: req.query.size || 50, days, state: req.query.state, status: req.query.status })
    const orders = listData(data).map(normalizeOrder)
    if (req.query.entries !== '0') await enrichOrders(store.token, orders)
    res.json({ periodDays: days, summary: summarizeOrders(orders), orders, meta: data?.meta || null })
  } catch (e) {
    res.status(e.status === 401 ? 401 : 502).json({ error: 'merchant_api_failed', status: e.status || null })
  }
})

/** POST /api/stores/:id/import-products — upload products to Kaspi cabinet. */
storesRouter.post('/:id/import-products', async (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  if (!store.token) return res.status(400).json({ error: 'no_token' })
  const products = Array.isArray(req.body?.products) ? req.body.products : req.body?.product ? [req.body.product] : []
  if (!products.length) return res.status(400).json({ error: 'empty_products' })
  const missing = products.find((p) => !p?.sku || !p?.title || !p?.brand || !p?.category)
  if (missing) return res.status(400).json({ error: 'missing_product_fields' })
  try {
    const result = await kaspi.merchantImportProducts(store.token, products)
    const row = insert('imports', { id: uid(), userId: req.user.id, storeId: store.id, code: result?.code || null, status: result?.status || null, products, createdAt: Date.now() })
    res.json({ ok: true, import: row, result })
  } catch (e) {
    res.status(e.status === 401 ? 401 : 502).json({ error: 'merchant_import_failed', status: e.status || null, details: e.data || null })
  }
})

/** GET /api/stores/:id/imports/:code — check Kaspi import status/result. */
storesRouter.get('/:id/imports/:code', async (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  if (!store.token) return res.status(400).json({ error: 'no_token' })
  try {
    const [status, result] = await Promise.all([
      kaspi.merchantImportStatus(store.token, req.params.code).catch((e) => ({ error: e.status || true })),
      kaspi.merchantImportResult(store.token, req.params.code).catch((e) => ({ error: e.status || true })),
    ])
    res.json({ code: req.params.code, status, result })
  } catch (e) {
    res.status(e.status === 401 ? 401 : 502).json({ error: 'merchant_import_failed', status: e.status || null })
  }
})
