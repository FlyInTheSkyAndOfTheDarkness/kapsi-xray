/* ============================================================
   Kaspi price-list feed routes.

   Public:  GET /feed/kaspi/<token>.xml  — the URL pasted into
            Кабинет продавца → Загрузить прайс-лист → Автоматическая
            загрузка. Kaspi polls it about once an hour.
   Private: /api/feeds/* — token, credentials, warehouses, defaults
            and the diagnostics behind the "why is my offer missing"
            question.
   ============================================================ */

import { Router } from 'express'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { requireAuth } from './auth.js'
import { filter, find, insert, uid, update } from './db.js'
import { mergeProduct } from './taobao-product.js'
import { publicBaseUrl } from './base-url.js'
import {
  buildCatalogXml,
  FEED_DEFAULTS,
  isPublishableOffer,
  MAX_PREORDER_DAYS,
  normalizeFeedSettings,
  offerFromDraft,
  sanitizeWarehouseList,
} from './kaspi-feed.js'

export const publicFeedRouter = Router()
export const feedRouter = Router()

const newToken = () => randomBytes(18).toString('hex')

export function feedForStore(userId, storeId, { create = false } = {}) {
  const existing = find('feeds', (row) => row.userId === userId && row.storeId === storeId)
  if (existing || !create) return existing || null
  return insert('feeds', {
    id: uid(),
    userId,
    storeId,
    token: newToken(),
    ...FEED_DEFAULTS,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}

export function feedUrl(feed, base) {
  return `${base}/feed/kaspi/${feed.token}.xml`
}

/** Drafts that belong to a store: chosen explicitly or by the last publication. */
function storeProductRows(userId, storeId) {
  const byImport = new Set(
    filter('imports', (row) => row.userId === userId && row.storeId === storeId && row.taobaoProductId)
      .map((row) => row.taobaoProductId),
  )
  return filter('taobaoProducts', (row) => row.userId === userId && (row.preferredStoreId === storeId || byImport.has(row.id)))
}

function cardSentToKaspi(userId, productId) {
  return filter('imports', (row) => row.userId === userId && row.taobaoProductId === productId && row.code).length > 0
}

/**
 * Every draft of a store turned into a price-list entry, with the reasons an
 * entry is held back. `offers` is what actually goes into the XML.
 */
export function feedContents(feed) {
  const settings = { ...FEED_DEFAULTS, ...feed }
  const seenSku = new Set()
  const entries = storeProductRows(feed.userId, feed.storeId).map((row) => {
    const saved = row.product?.draft || {}
    const draft = mergeProduct(row, saved)
    const { offer, issues, paused } = offerFromDraft({ ...draft, identity: row.id }, settings)
    // What the seller typed vs what Kaspi will actually receive.
    const rawSku = String(saved.sku || '').trim()
    if (rawSku && rawSku !== offer.sku) issues.push('sku_normalized')
    if (!String(saved.brand || '').trim()) issues.push('brand_defaulted')
    if (Number(saved.deliveryDays ?? saved.preorderDays) > MAX_PREORDER_DAYS) issues.push('preorder_clamped')
    if (!cardSentToKaspi(feed.userId, row.id)) issues.push('card_not_published')
    if (offer.sku) {
      if (seenSku.has(offer.sku)) issues.push('duplicate_sku')
      else seenSku.add(offer.sku)
    }
    const selling = offer.availabilities.find((availability) => availability.available)
    return {
      id: row.id,
      title: draft.title || offer.sku,
      sku: offer.sku,
      rawSku,
      price: offer.price,
      stock: selling?.stockCount ?? 0,
      preorderDays: selling?.preOrder || settings.preorderDays,
      warehouses: offer.availabilities.map(({ storeId, available }) => ({ id: storeId, available })),
      paused,
      issues,
      included: isPublishableOffer({ issues }) && (settings.includePaused || !paused),
      offer,
    }
  })
  return { entries, offers: entries.filter((entry) => entry.included).map((entry) => entry.offer) }
}

/**
 * Feed state of a store's pre-order drafts, keyed by product row id.
 * Returns null when the store has no feed yet, so callers can tell
 * "not in the price list" apart from "held back by an error".
 */
export function feedContextForStore(userId, storeId) {
  const feed = feedForStore(userId, storeId)
  if (!feed) return null
  const { entries } = feedContents(feed)
  return { feed, byProduct: new Map(entries.map((entry) => [entry.id, entry])) }
}

export function feedXml(feed, store) {
  const { entries, offers } = feedContents(feed)
  const xml = buildCatalogXml({
    company: feed.company || store?.name || 'Kaspi X-Ray',
    merchantId: store?.merchantId || '',
    offers,
  })
  return { xml, entries, offers }
}

/* ------------------------------------------------------------ public feed */

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8')
  const right = Buffer.from(String(b ?? ''), 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

function basicAuthOk(feed, header) {
  if (!feed.basicLogin) return true
  const [scheme, encoded] = String(header || '').split(' ')
  if (!/^basic$/i.test(scheme || '') || !encoded) return false
  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  const separator = decoded.indexOf(':')
  if (separator < 0) return false
  return safeEqual(decoded.slice(0, separator), feed.basicLogin) && safeEqual(decoded.slice(separator + 1), feed.basicPassword || '')
}

/** GET /feed/kaspi/:token(.xml) — the price list Kaspi downloads. */
publicFeedRouter.get('/kaspi/:token', (req, res) => {
  const token = String(req.params.token || '').replace(/\.xml$/i, '')
  const feed = token.length >= 16 ? find('feeds', (row) => row.token === token) : null
  if (!feed) return res.status(404).type('text/plain').send('feed not found')
  if (!basicAuthOk(feed, req.get('authorization'))) {
    res.setHeader('WWW-Authenticate', 'Basic realm="kaspi price list"')
    return res.status(401).type('text/plain').send('unauthorized')
  }
  if (feed.active === false) return res.status(503).type('text/plain').send('feed disabled')

  const store = find('stores', (row) => row.id === feed.storeId && row.userId === feed.userId)
  if (!store?.merchantId) return res.status(409).type('text/plain').send('store not connected')

  const { xml, offers } = feedXml(feed, store)
  // A catalog with no offers is invalid against the XSD — say so in plain text
  // instead of handing Kaspi a document its parser will choke on.
  if (!offers.length) return res.status(409).type('text/plain').send('no publishable offers')

  update('feeds', feed.id, {
    lastFetchAt: Date.now(),
    lastFetchIp: req.get('x-forwarded-for') || req.ip || null,
    lastFetchAgent: (req.get('user-agent') || '').slice(0, 200),
    lastOfferCount: offers.length,
    fetchCount: (feed.fetchCount || 0) + 1,
  })
  res.setHeader('content-type', 'application/xml; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-disposition', 'inline; filename="kaspi-price-list.xml"')
  res.send(xml)
})

/* ----------------------------------------------------------- private API */

feedRouter.use(requireAuth)

function storeOr404(req, res) {
  const store = find('stores', (row) => row.id === req.params.storeId && row.userId === req.user.id)
  if (!store) {
    res.status(404).json({ error: 'store_not_found' })
    return null
  }
  return store
}

function publicFeed(feed, base, store) {
  const { entries, offers } = feedXml(feed, store)
  return {
    feed: {
      storeId: feed.storeId,
      url: feedUrl(feed, base),
      active: feed.active !== false,
      company: feed.company || '',
      warehouses: sanitizeWarehouseList(feed.warehouses),
      preorderDays: feed.preorderDays ?? FEED_DEFAULTS.preorderDays,
      stock: feed.stock ?? FEED_DEFAULTS.stock,
      includePaused: feed.includePaused !== false,
      autoPublish: !!feed.autoPublish,
      basicLogin: feed.basicLogin || '',
      hasBasicPassword: !!feed.basicPassword,
      lastFetchAt: feed.lastFetchAt || null,
      lastFetchAgent: feed.lastFetchAgent || null,
      lastOfferCount: feed.lastOfferCount ?? null,
      fetchCount: feed.fetchCount || 0,
      updatedAt: feed.updatedAt || feed.createdAt || null,
    },
    offerCount: offers.length,
    entries,
  }
}

/** GET /api/feeds/:storeId — feed settings, offers and diagnostics. */
feedRouter.get('/:storeId', (req, res) => {
  const store = storeOr404(req, res)
  if (!store) return undefined
  const feed = feedForStore(req.user.id, store.id, { create: true })
  return res.json(publicFeed(feed, publicBaseUrl(req), store))
})

/** GET /api/feeds/:storeId/xml — same document Kaspi receives, for preview. */
feedRouter.get('/:storeId/xml', (req, res) => {
  const store = storeOr404(req, res)
  if (!store) return undefined
  const feed = feedForStore(req.user.id, store.id, { create: true })
  res.setHeader('content-type', 'application/xml; charset=utf-8')
  return res.send(feedXml(feed, store).xml)
})

/** PUT /api/feeds/:storeId — warehouses, defaults and Basic credentials. */
feedRouter.put('/:storeId', (req, res) => {
  const store = storeOr404(req, res)
  if (!store) return undefined
  const feed = feedForStore(req.user.id, store.id, { create: true })
  const saved = update('feeds', feed.id, { ...normalizeFeedSettings(req.body || {}, feed), updatedAt: Date.now() })
  return res.json(publicFeed(saved, publicBaseUrl(req), store))
})

/** POST /api/feeds/:storeId/rotate — new secret URL (old one stops working). */
feedRouter.post('/:storeId/rotate', (req, res) => {
  const store = storeOr404(req, res)
  if (!store) return undefined
  const feed = feedForStore(req.user.id, store.id, { create: true })
  const saved = update('feeds', feed.id, { token: newToken(), updatedAt: Date.now() })
  return res.json(publicFeed(saved, publicBaseUrl(req), store))
})

/**
 * POST /api/feeds/:storeId/selfcheck — fetch our own public URL the way Kaspi
 * does. Catches an unset PUBLIC_BASE_URL, a proxy that does not route /feed,
 * and wrong Basic credentials before the seller pastes the link into Kaspi.
 */
feedRouter.post('/:storeId/selfcheck', async (req, res) => {
  const store = storeOr404(req, res)
  if (!store) return undefined
  const feed = feedForStore(req.user.id, store.id, { create: true })
  const url = feedUrl(feed, publicBaseUrl(req))
  const headers = { Accept: 'application/xml,text/xml,*/*' }
  if (feed.basicLogin) {
    headers.Authorization = `Basic ${Buffer.from(`${feed.basicLogin}:${feed.basicPassword || ''}`, 'utf8').toString('base64')}`
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' })
    const body = await response.text()
    const contentType = response.headers.get('content-type') || ''
    return res.json({
      url,
      ok: response.ok && /xml/i.test(contentType) && body.includes('<kaspi_catalog'),
      status: response.status,
      contentType,
      bytes: Buffer.byteLength(body, 'utf8'),
      offers: (body.match(/<offer\s/g) || []).length,
      reachable: true,
    })
  } catch (error) {
    return res.json({ url, ok: false, reachable: false, reason: error.name === 'AbortError' ? 'timeout' : 'unreachable' })
  } finally {
    clearTimeout(timer)
  }
})
