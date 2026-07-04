/* ============================================================
   Server-side Kaspi.kz client. The backend IS the proxy — it
   calls kaspi.kz directly with the headers Kaspi expects, so
   no CORS issues and tokens never touch the browser.
   ============================================================ */

const BASE = 'https://kaspi.kz'
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
  const res = await fetch(url, opts)
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

/* ---- Merchant cabinet API (private) — SCAFFOLD ----
   Requires the seller's X-Auth-Token from kaspi.kz cabinet (Настройки → API).
   Endpoint paths follow Kaspi's merchant API v2 shape; verify against your
   cabinet docs. Without a valid token this throws with a clear message. */
export async function merchantApi(token, path, { method = 'GET', body, city = DEFAULT_CITY } = {}) {
  if (!token) {
    const e = new Error('NO_MERCHANT_TOKEN')
    e.code = 'NO_TOKEN'
    throw e
  }
  const res = await fetch(`${BASE}/shop/api/v2${path}`, {
    method,
    headers: {
      'User-Agent': UA,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      'X-Auth-Token': token,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const e = new Error(`Kaspi merchant API ${res.status}`)
    e.status = res.status
    throw e
  }
  return res.json()
}
