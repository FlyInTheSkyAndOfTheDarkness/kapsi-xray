/* ============================================================
   Server-side Kaspi.kz client. The backend IS the proxy — it
   calls kaspi.kz directly with the headers Kaspi expects, so
   no CORS issues and tokens never touch the browser.

   Egress, pacing and caching live in kaspi-net.js — Kaspi
   rate-limits by IP hard enough that they cannot be an
   afterthought at the call sites.
   ============================================================ */

import { kaspiJSON, merchantFetch } from './kaspi-net.js'

const BASE = 'https://kaspi.kz'
const API_V2 = `${BASE}/shop/api/v2`
const PRODUCTS_API = `${BASE}/shop/api/products`
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
export const DEFAULT_CITY = '750000000'

function headers(extra = {}, referer = `${BASE}/shop/`) {
  return {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'ru-RU,ru;q=0.9',
    Referer: referer,
    Origin: BASE,
    'X-KS-City': DEFAULT_CITY,
    ...extra,
  }
}

/** Public endpoint read; drops the cache metadata the callers below ignore. */
async function getJSON(url, opts = {}) {
  const { data } = await kaspiJSON(url, opts)
  return data
}

async function readJSON(res) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function qs(params) {
  const out = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') out.set(k, String(v))
  })
  const s = out.toString()
  return s ? `?${s}` : ''
}

function normCard(p) {
  const img = p.previewImages && p.previewImages[0]
  const cat = p.categoryRu || p.category || ''
  return {
    id: String(p.id || p.configSku),
    title: p.title,
    brand: p.brand || '',
    categoryId: p.categoryId,
    categoryName: Array.isArray(cat) ? cat.join(' / ') : String(cat),
    price: p.unitSalePrice || p.unitPrice || 0,
    priceMinusBonus: p.priceMinusBonus || null,
    image: img ? img.medium || img.small : null,
    link: p.shopLink ? `${BASE}/shop${p.shopLink}` : null,
    createdTime: p.createdTime || null,
    rating: p.rating || null,
    reviewsQuantity: p.reviewsQuantity || 0,
  }
}

export async function search(text, { city = DEFAULT_CITY, limit = 12 } = {}) {
  const url = `${BASE}/yml/product-view/pl/results?text=${encodeURIComponent(text)}&page=0&limit=${limit}&sortBy=relevance&ui=d&i=-1&c=${city}`
  const json = await getJSON(url, { headers: headers() })
  return (json.data || []).map(normCard)
}

export async function offers(id, { city = DEFAULT_CITY, limit = 32 } = {}) {
  const body = { cityId: city, id: String(id), merchantUID: '', limit, page: 0, sort: true, installationId: '-1' }
  const json = await getJSON(`${BASE}/yml/offer-view/offers/${id}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }, `${BASE}/shop/p/x-${id}/`),
    body: JSON.stringify(body),
  })
  return (json.offers || []).map((o) => ({
    merchantId: o.merchantId,
    merchant: o.merchantName,
    merchantRating: o.merchantRating || null,
    merchantReviews: o.merchantReviewsQuantity || 0,
    price: o.price,
    kaspiDelivery: !!o.kaspiDelivery,
    title: o.title || null,
    category: o.masterCategory || null,
  }))
}

export async function reviews(id, { limit = 1000 } = {}) {
  const url = `${BASE}/yml/review-view/api/v1/reviews/product/${id}?baseProductCodes=${id}&limit=${limit}&page=0&withAgg=true&sort=DATE`
  const json = await getJSON(url, { headers: headers({}, `${BASE}/shop/p/x-${id}/`) })
  const summary = json.summary || {}
  const stat = summary.statistic || []
  const byStar = {}
  stat.forEach((x) => (byStar[x.rate] = x.count))
  const ratingsTotal = stat.reduce((s, x) => s + (x.count || 0), 0)
  const grp = {}
  ;(json.groupSummary || []).forEach((g) => (grp[g.id] = g.total))
  return {
    global: summary.global || null,
    ratingsTotal: grp.ALL != null ? grp.ALL : ratingsTotal,
    commentsTotal: grp.COMMENT != null ? grp.COMMENT : ratingsTotal,
    byStar,
    reviews: (json.data || []).map((r) => ({ date: r.date })),
  }
}

/* Kaspi serves this listing 12 items per page and ignores `limit`, so the walk
   is driven by what comes back, not by the page size we asked for. A 382-item
   store needs 33 pages; stopping early silently hid three quarters of it. */
const PAGE_CAP = Number(process.env.KASPI_MAX_PAGES) || 60

/**
 * The merchant's catalog, read from Kaspi's public listing.
 * Walks until the listing runs out. A page that fails ends the walk instead of
 * discarding the pages already in hand — a partial catalog still beats none —
 * and `stale` says at least one page came from cache because Kaspi refused.
 */
export async function merchantProducts(merchantId, { city = DEFAULT_CITY, maxPages = PAGE_CAP } = {}) {
  const seen = new Set()
  const products = []
  let stale = false
  let fetchedAt = Date.now()
  let complete = false
  let failure = null
  let barrenPages = 0
  for (let page = 0; page < maxPages; page++) {
    const url = `${BASE}/yml/product-view/pl/results?text=&q=%3AallMerchants%3A${merchantId}&page=${page}&limit=24&ui=d&i=-1&c=${city}`
    let answer
    try {
      answer = await kaspiJSON(url, { headers: headers() })
    } catch (e) {
      failure = e
      break
    }
    if (answer.stale) {
      stale = true
      fetchedAt = Math.min(fetchedAt, answer.fetchedAt)
    }
    const rows = answer.data?.data || []
    if (!rows.length) {
      complete = true
      break
    }
    const before = products.length
    rows.map(normCard).forEach((p) => {
      if (seen.has(p.id)) return
      seen.add(p.id)
      products.push(p)
    })
    // Pages overlap, but several in a row adding nothing means the listing is
    // cycling rather than advancing — treat that as the end too.
    barrenPages = products.length === before ? barrenPages + 1 : 0
    if (barrenPages >= 2) {
      complete = true
      break
    }
  }
  // Nothing to show at all: the caller needs the reason, not an empty catalog.
  if (!products.length && failure) throw failure
  return { products, truncated: !complete, stale, fetchedAt }
}

export async function merchantInfo(merchantId, firstProductId, { city = DEFAULT_CITY } = {}) {
  try {
    const list = await offers(firstProductId, { city, limit: 64 })
    const o = list.find((x) => String(x.merchantId) === String(merchantId))
    if (o) return { name: o.merchant, rating: o.merchantRating, reviews: o.merchantReviews }
  } catch {
    /* ignore */
  }
  return { name: `Магазин #${merchantId}`, rating: null, reviews: null }
}

/* ---- Merchant cabinet API (private)
   Requires the seller's X-Auth-Token from Kaspi cabinet:
   Settings -> API token. Keep it server-side only. */
export async function merchantApi(token, path, { method = 'GET', body, city = DEFAULT_CITY } = {}) {
  if (!token) {
    const e = new Error('NO_MERCHANT_TOKEN')
    e.code = 'NO_TOKEN'
    throw e
  }
  const url = path.startsWith('http') ? path : `${API_V2}${path.startsWith('/') ? path : `/${path}`}`
  // Not paced or cached: these are authenticated, order-fetching runs into the
  // hundreds of sequential calls, and Kaspi treats the token API separately.
  const res = await merchantFetch(url, {
    method,
    headers: {
      'User-Agent': UA,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      'X-Auth-Token': token,
      'X-KS-City': city,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await readJSON(res)
  if (!res.ok) {
    const e = new Error(`Kaspi merchant API ${res.status}`)
    e.status = res.status
    e.data = data
    throw e
  }
  return data
}

export async function merchantProductApi(token, path, { method = 'GET', body } = {}) {
  if (!token) {
    const e = new Error('NO_MERCHANT_TOKEN')
    e.code = 'NO_TOKEN'
    throw e
  }
  const url = path.startsWith('http') ? path : `${PRODUCTS_API}${path.startsWith('/') ? path : `/${path}`}`
  const hasBody = body !== undefined && body !== null
  const res = await merchantFetch(url, {
    method,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Content-Type': hasBody ? 'text/plain' : 'application/json',
      'X-Auth-Token': token,
    },
    body: hasBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    timeoutMs: 20_000,
  })
  const data = await readJSON(res)
  if (!res.ok) {
    const e = new Error(`Kaspi products API ${res.status}`)
    e.status = res.status
    e.data = data
    throw e
  }
  return data
}

export function merchantOrdersPath({ page = 0, size = 50, state, status, code, days = 30, includeUser = true } = {}) {
  const now = Date.now()
  const since = now - Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000
  return `/orders${qs({
    'page[number]': Math.max(0, Number(page) || 0),
    'page[size]': Math.min(100, Math.max(1, Number(size) || 50)),
    'filter[orders][code]': code,
    'filter[orders][state]': state,
    'filter[orders][status]': status,
    'filter[orders][creationDate][$ge]': since,
    'filter[orders][creationDate][$le]': now,
    'include[orders]': includeUser ? 'user' : undefined,
  })}`
}

export async function merchantOrders(token, opts = {}) {
  return merchantApi(token, merchantOrdersPath(opts))
}

export async function merchantOrderEntries(token, orderId) {
  return merchantApi(token, `/orders/${encodeURIComponent(orderId)}/entries`)
}

export async function merchantOrderEntryProduct(token, entryId) {
  return merchantApi(token, `/orderentries/${encodeURIComponent(entryId)}/product`)
}

/**
 * Ask one cabinet path with the seller's token and report only how it answered.
 * Bodies are truncated hard: this is for mapping the API, not for reading data,
 * and the response goes to a browser.
 */
export async function merchantProbe(token, path) {
  const res = await merchantFetch(`${BASE}${path}`, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/vnd.api+json',
      'X-Auth-Token': token,
      'X-KS-City': DEFAULT_CITY,
    },
    timeoutMs: 12_000,
  })
  const body = await res.text().catch(() => '')
  return {
    path,
    status: res.status,
    contentType: (res.headers.get('content-type') || '').split(';')[0],
    sample: body.slice(0, 180).replace(/\s+/g, ' '),
  }
}

export async function merchantImportSchema(token) {
  return merchantProductApi(token, '/import/schema')
}

export async function merchantClassificationCategories(token) {
  return merchantProductApi(token, '/classification/categories')
}

export async function merchantClassificationAttributes(token, category) {
  return merchantProductApi(token, `/classification/attributes${qs({ c: category })}`)
}

export async function merchantClassificationAttributeValues(token, category, attribute) {
  return merchantProductApi(token, `/classification/attribute/values${qs({ c: category, a: attribute })}`)
}

export async function merchantImportProducts(token, products) {
  const payload = Array.isArray(products) ? products : [products]
  return merchantProductApi(token, '/import', { method: 'POST', body: payload })
}

export async function merchantImportStatus(token, code) {
  return merchantProductApi(token, `/import${qs({ i: code })}`)
}

export async function merchantImportResult(token, code) {
  return merchantProductApi(token, `/import/result${qs({ i: code })}`)
}
