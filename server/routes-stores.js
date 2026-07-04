import { Router } from 'express'
import { requireAuth } from './auth.js'
import { all, find, filter, insert, update, remove, uid } from './db.js'
import * as kaspi from './kaspi.js'
import { estimateCard, productProfit } from './analyze.js'

export const storesRouter = Router()
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
  filter('cogs', (c) => c.userId === userId && c.storeId === storeId).forEach((c) => (map[c.sku] = c.cost))
  return map
}

/** POST /api/stores/connect { ref, city } — connect a store by link/merchant id. */
storesRouter.post('/connect', async (req, res) => {
  const mid = parseMerchantRef(req.body?.ref)
  const city = req.body?.city || kaspi.DEFAULT_CITY
  if (!mid) return res.status(400).json({ error: 'bad_ref' })
  try {
    const { products, truncated } = await kaspi.merchantProducts(mid, { city })
    if (!products.length) return res.status(404).json({ error: 'empty' })
    const info = await kaspi.merchantInfo(mid, products[0].id, { city })
    let store = find('stores', (s) => s.userId === req.user.id && s.merchantId === mid)
    if (store) update('stores', store.id, { name: info.name, rating: info.rating, reviews: info.reviews, productCount: products.length })
    else store = insert('stores', { id: uid(), userId: req.user.id, merchantId: mid, name: info.name, rating: info.rating, reviews: info.reviews, productCount: products.length, token: null, createdAt: Date.now() })
    res.json({ store: publicStore(store), products, truncated })
  } catch (e) {
    res.status(502).json({ error: 'kaspi_unreachable' })
  }
})

const publicStore = (s) => ({ id: s.id, merchantId: s.merchantId, name: s.name, rating: s.rating, reviews: s.reviews, productCount: s.productCount, hasToken: !!s.token, createdAt: s.createdAt })

/** GET /api/stores — list the user's connected stores. */
storesRouter.get('/', (req, res) => {
  res.json({ stores: filter('stores', (s) => s.userId === req.user.id).map(publicStore) })
})

/** GET /api/stores/:id — store + fresh catalog with estimates & profit (COGS). */
storesRouter.get('/:id', async (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  const city = req.query.city || kaspi.DEFAULT_CITY
  try {
    const { products, truncated } = await kaspi.merchantProducts(store.merchantId, { city })
    const costs = cogsMap(req.user.id, store.id)
    const rows = products.map((p) => {
      const est = estimateCard(p)
      const profit = productProfit(p, costs[p.id], est)
      return { ...p, cost: costs[p.id] || null, est, profit }
    })
    res.json({ store: publicStore(store), products: rows, truncated })
  } catch {
    res.status(502).json({ error: 'kaspi_unreachable' })
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

/** POST /api/stores/:id/token { token } — save the Kaspi merchant API token. */
storesRouter.post('/:id/token', (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  update('stores', store.id, { token: req.body?.token ? String(req.body.token) : null })
  res.json({ ok: true, hasToken: !!req.body?.token })
})

/** GET /api/stores/:id/orders — real orders via merchant API (needs token). */
storesRouter.get('/:id/orders', async (req, res) => {
  const store = find('stores', (s) => s.id === req.params.id && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'not_found' })
  if (!store.token) return res.status(400).json({ error: 'no_token' })
  try {
    const data = await kaspi.merchantApi(store.token, '/orders?page[number]=0&page[size]=50&filter[orders][state]=ARCHIVE')
    res.json({ orders: data })
  } catch (e) {
    res.status(e.status === 401 ? 401 : 502).json({ error: 'merchant_api_failed', status: e.status || null })
  }
})
