/* ============================================================
   Server-side Kaspi.kz client. The backend IS the proxy — it
   calls kaspi.kz directly with the headers Kaspi expects, so
   no CORS issues and tokens never touch the browser.
   ============================================================ */

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

async function getJSON(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts, opts.timeoutMs || 15000)
  if (!res.ok) {
    const e = new Error(`Kaspi ${res.status}`)
    e.status = res.status
    throw e
  }
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('json')) {
    const e = new Error('Kaspi returned non-JSON (blocked)')
    e.code = 'NON_JSON'
    throw e
  }
  return res.json()
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
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

export async function merchantProducts(merchantId, { city = DEFAULT_CITY, maxPages = 8 } = {}) {
  const out = []
  for (let page = 0; page < maxPages; page++) {
    const url = `${BASE}/yml/product-view/pl/results?text=&q=%3AallMerchants%3A${merchantId}&page=${page}&limit=24&ui=d&i=-1&c=${city}`
    const json = await getJSON(url, { headers: headers() })
    const data = json.data || []
    out.push(...data.map(normCard))
    if (data.length < 12) break
  }
  const seen = new Set()
  const products = out.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
  return { products, truncated: out.length >= maxPages * 12 }
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
  const res = await fetchWithTimeout(url, {
    method,
    headers: {
      'User-Agent': UA,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      'X-Auth-Token': token,
      'X-KS-City': city,
    },
    body: body ? JSON.stringify(body) : undefined,
  }, 15000)
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
  const res = await fetchWithTimeout(url, {
    method,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Content-Type': hasBody ? 'text/plain' : 'application/json',
      'X-Auth-Token': token,
    },
    body: hasBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  }, 20000)
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

export async function merchantImportSchema(token) {
  return merchantProductApi(token, '/import/schema')
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
