import { Router } from 'express'
import { requireAuth } from './auth.js'
import { filter, find, insert, remove, update, uid } from './db.js'
import { snapshotProduct, todayKey } from './analyze.js'
import { initBaseline, checkAndEmitAlerts } from './alerts.js'
import * as kaspi from './kaspi.js'

export const competitorsRouter = Router()
competitorsRouter.use(requireAuth)

function parseProductRef(input) {
  const s = String(input || '').trim()
  const url = s.match(/-(\d{6,})\/?(?:\?|$)/) || s.match(/\/(\d{6,})(?:\/|\?|$)/)
  if (url) return url[1]
  if (/^\d{6,}$/.test(s)) return s
  return null
}

/** Record a dated snapshot (one per product per day) for the given owner. */
export function recordSnapshot(userId, refType, refId, snap) {
  const date = todayKey()
  const existing = find('snapshots', (s) => s.userId === userId && s.refId === refId && s.date === date)
  const row = { userId, refType, refId, date, ts: Date.now(), ...snap }
  if (existing) Object.assign(existing, row)
  else insert('snapshots', { id: uid(), ...row })
  return row
}

const latest = (userId, refId) =>
  filter('snapshots', (s) => s.userId === userId && s.refId === refId).sort((a, b) => b.ts - a.ts)[0] || null

function productDraft(comp, snap, overrides = {}) {
  const image = snap?.image || comp.image || null
  return {
    sku: overrides.sku || `KX-${comp.productId}`,
    title: overrides.title || comp.title || snap?.title || `Товар ${comp.productId}`,
    brand: overrides.brand || '',
    category: overrides.category || '',
    description: overrides.description || `${comp.title || snap?.title || comp.productId}. Подготовлено из Kaspi X-Ray по анализу конкурентов.`,
    attributes: Array.isArray(overrides.attributes) ? overrides.attributes : [],
    images: overrides.images || (image ? [{ url: image }] : []),
  }
}

/** POST /api/competitors { ref, city } — start tracking a competitor product. */
competitorsRouter.post('/', async (req, res) => {
  const pid = parseProductRef(req.body?.ref)
  const city = req.body?.city || kaspi.DEFAULT_CITY
  if (!pid) return res.status(400).json({ error: 'bad_ref' })
  if (find('competitors', (c) => c.userId === req.user.id && c.productId === pid))
    return res.status(409).json({ error: 'already_tracked' })
  try {
    const snap = await snapshotProduct(pid, { city })
    const comp = insert('competitors', { id: uid(), userId: req.user.id, productId: pid, title: snap.title, image: snap.image, link: snap.link, addedAt: Date.now() })
    recordSnapshot(req.user.id, 'competitor', comp.id, snap)
    initBaseline(comp.id, snap) // baseline: no alert on first observation
    res.json({ competitor: { ...comp, last: snap } })
  } catch {
    res.status(502).json({ error: 'kaspi_unreachable' })
  }
})

/** GET /api/competitors — list with latest snapshot + change vs previous. */
competitorsRouter.get('/', (req, res) => {
  const list = filter('competitors', (c) => c.userId === req.user.id).map((c) => {
    const snaps = filter('snapshots', (s) => s.userId === req.user.id && s.refId === c.id).sort((a, b) => a.ts - b.ts)
    const last = snaps[snaps.length - 1] || null
    const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null
    const priceChange = last && prev ? last.price - prev.price : 0
    return { ...c, last, priceChange, points: snaps.length }
  })
  res.json({ competitors: list.sort((a, b) => (b.last?.estRevenue || 0) - (a.last?.estRevenue || 0)) })
})

/** GET /api/competitors/opportunities — products prepared for seller import. */
competitorsRouter.get('/opportunities', (req, res) => {
  const opportunities = filter('opportunities', (o) => o.userId === req.user.id).sort((a, b) => b.createdAt - a.createdAt)
  res.json({ opportunities })
})

/** POST /api/competitors/:id/opportunity — save competitor product as a sell candidate. */
competitorsRouter.post('/:id/opportunity', (req, res) => {
  const comp = find('competitors', (c) => c.id === req.params.id && c.userId === req.user.id)
  if (!comp) return res.status(404).json({ error: 'not_found' })
  const storeId = req.body?.storeId || null
  if (storeId && !find('stores', (s) => s.id === storeId && s.userId === req.user.id)) return res.status(404).json({ error: 'store_not_found' })
  const snap = latest(req.user.id, comp.id)
  const draft = productDraft(comp, snap, req.body?.product || {})
  const existing = find('opportunities', (o) => o.userId === req.user.id && o.competitorId === comp.id && (storeId ? o.storeId === storeId : !o.storeId))
  const patch = {
    storeId,
    productId: comp.productId,
    competitorId: comp.id,
    title: comp.title,
    image: comp.image,
    link: comp.link,
    lastPrice: snap?.price || null,
    estSales: snap?.estSales || 0,
    estRevenue: snap?.estRevenue || 0,
    sellers: snap?.sellers || 0,
    buyBoxMerchant: snap?.buyBoxMerchant || null,
    draft,
    status: 'draft',
    updatedAt: Date.now(),
  }
  const row = existing ? update('opportunities', existing.id, patch) : insert('opportunities', { id: uid(), userId: req.user.id, createdAt: Date.now(), ...patch })
  res.json({ opportunity: row })
})

/** POST /api/competitors/:id/publish — upload a prepared product to Kaspi cabinet. */
competitorsRouter.post('/:id/publish', async (req, res) => {
  const comp = find('competitors', (c) => c.id === req.params.id && c.userId === req.user.id)
  if (!comp) return res.status(404).json({ error: 'not_found' })
  const store = find('stores', (s) => s.id === req.body?.storeId && s.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'store_not_found' })
  if (!store.token) return res.status(400).json({ error: 'no_token' })
  const snap = latest(req.user.id, comp.id)
  const product = productDraft(comp, snap, req.body?.product || {})
  if (!product.sku || !product.title || !product.brand || !product.category) return res.status(400).json({ error: 'missing_product_fields', draft: product })
  try {
    const result = await kaspi.merchantImportProducts(store.token, [product])
    const row = insert('imports', { id: uid(), userId: req.user.id, storeId: store.id, competitorId: comp.id, code: result?.code || null, status: result?.status || null, products: [product], createdAt: Date.now() })
    res.json({ ok: true, import: row, result })
  } catch (e) {
    res.status(e.status === 401 ? 401 : 502).json({ error: 'merchant_import_failed', status: e.status || null, details: e.data || null })
  }
})

/** GET /api/competitors/:id/history — full snapshot history. */
competitorsRouter.get('/:id/history', (req, res) => {
  const comp = find('competitors', (c) => c.id === req.params.id && c.userId === req.user.id)
  if (!comp) return res.status(404).json({ error: 'not_found' })
  const history = filter('snapshots', (s) => s.userId === req.user.id && s.refId === comp.id).sort((a, b) => a.ts - b.ts)
  res.json({ competitor: comp, history })
})

/** DELETE /api/competitors/:id */
competitorsRouter.delete('/:id', (req, res) => {
  remove('competitors', (c) => c.id === req.params.id && c.userId === req.user.id)
  remove('snapshots', (s) => s.refId === req.params.id && s.userId === req.user.id)
  res.json({ ok: true })
})

/** POST /api/competitors/poll — refresh all tracked competitors now. */
competitorsRouter.post('/poll', async (req, res) => {
  const city = req.body?.city || kaspi.DEFAULT_CITY
  const list = filter('competitors', (c) => c.userId === req.user.id)
  let updated = 0
  let newAlerts = 0
  for (const c of list) {
    try {
      const snap = await snapshotProduct(c.productId, { city })
      recordSnapshot(req.user.id, 'competitor', c.id, snap)
      newAlerts += checkAndEmitAlerts(req.user.id, c.id, snap).length
      updated++
    } catch {
      /* skip */
    }
  }
  res.json({ ok: true, updated, alerts: newAlerts })
})
