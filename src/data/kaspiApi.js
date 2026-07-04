/* ============================================================
   Live Kaspi.kz data layer.
   Talks to Kaspi's public JSON endpoints through the dev proxy
   (/kaspi -> https://kaspi.kz, see vite.config.js). Every call
   degrades gracefully: on network/CORS/blocked responses it
   throws a typed error the UI turns into a friendly message.
   ============================================================ */

const BASE = '/kaspi'
export const DEFAULT_CITY = '750000000' // Алматы

async function getJSON(url, opts = {}) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json, text/plain, */*', ...(opts.headers || {}) },
    ...opts,
  })
  if (!res.ok) {
    const err = new Error(`Kaspi ${res.status}`)
    err.status = res.status
    throw err
  }
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('json')) {
    const err = new Error('Kaspi returned non-JSON (likely blocked / anti-bot)')
    err.code = 'NON_JSON'
    throw err
  }
  return res.json()
}

/** Extract a numeric Kaspi product id from a URL, or return the trimmed id/text. */
export function parseProductRef(input) {
  const s = (input || '').trim()
  if (!s) return { kind: 'empty' }
  // full/partial product URL: .../p/<slug>-<digits>/  or ?...-<digits>
  const urlMatch = s.match(/-(\d{6,})\/?(?:\?|$)/) || s.match(/\/(\d{6,})(?:\/|\?|$)/)
  if (urlMatch) return { kind: 'id', id: urlMatch[1] }
  // bare numeric id
  if (/^\d{6,}$/.test(s)) return { kind: 'id', id: s }
  return { kind: 'text', text: s }
}

/** Search the whole marketplace by keyword. Returns normalised product cards. */
export async function searchProducts(text, { city = DEFAULT_CITY, limit = 12 } = {}) {
  const url =
    `${BASE}/yml/product-view/pl/results?text=${encodeURIComponent(text)}` +
    `&page=0&limit=${limit}&sortBy=relevance&ui=d&i=-1&c=${city}`
  const json = await getJSON(url)
  const list = (json && json.data) || []
  return list.map(normalizeSearchItem)
}

function normalizeSearchItem(p) {
  const img = p.previewImages && p.previewImages[0]
  return {
    id: String(p.id || p.configSku),
    title: p.title,
    brand: p.brand || '',
    categoryId: p.categoryId,
    categoryName: Array.isArray(p.categoryRu || p.category) ? (p.categoryRu || p.category).join(' / ') : String(p.categoryRu || p.category || ''),
    price: p.unitSalePrice || p.unitPrice || 0,
    priceMinusBonus: p.priceMinusBonus || null,
    image: img ? img.medium || img.small : null,
    link: p.shopLink ? `https://kaspi.kz/shop${p.shopLink}` : null,
    createdTime: p.createdTime || null,
    rating: p.rating || null,
    reviewsQuantity: p.reviewsQuantity || 0,
    stock: p.stock || null,
  }
}

/** Extract a numeric Kaspi merchant id from a store/product URL or bare id. */
export function parseMerchantRef(input) {
  const s = (input || '').trim()
  if (!s) return null
  const m = s.match(/[?&]m=(\d{4,})/)
  if (m) return m[1]
  if (/^\d{4,}$/.test(s)) return s
  return null
}

/** List a merchant's public catalog (paginated q=:allMerchants:<id>). */
export async function getMerchantProducts(merchantId, { city = DEFAULT_CITY, maxPages = 8 } = {}) {
  const out = []
  for (let page = 0; page < maxPages; page++) {
    const url =
      `${BASE}/yml/product-view/pl/results?text=&q=%3AallMerchants%3A${merchantId}` +
      `&page=${page}&limit=24&ui=d&i=-1&c=${city}`
    const json = await getJSON(url)
    const data = (json && json.data) || []
    out.push(...data.map(normalizeSearchItem))
    if (data.length < 12) break // reached the last page
  }
  // dedupe by id (paging overlaps happen)
  const seen = new Set()
  const list = out.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
  return { products: list, truncated: out.length >= maxPages * 12 }
}

/** Store name/rating for a merchant, read from any of its products' offers. */
export async function getMerchantInfo(merchantId, firstProductId, { city = DEFAULT_CITY } = {}) {
  try {
    const offers = await getOffers(firstProductId, { city, limit: 64 })
    const o = offers.find((x) => String(x.merchantId) === String(merchantId))
    if (o) return { name: o.merchant, rating: o.merchantRating, reviews: o.merchantReviews }
  } catch {
    /* fall through */
  }
  return { name: `Магазин #${merchantId}`, rating: null, reviews: null }
}

/** Sellers/offers for a product: prices, merchants, ratings, delivery. */
export async function getOffers(id, { city = DEFAULT_CITY, limit = 32 } = {}) {
  const url = `${BASE}/yml/offer-view/offers/${id}`
  const body = {
    cityId: city,
    id: String(id),
    merchantUID: '',
    limit,
    page: 0,
    sort: true,
    highRating: null,
    searchText: null,
    zoneId: ['Magnum_ZONE1'],
    installationId: '-1',
  }
  const json = await getJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const offers = (json && json.offers) || []
  return offers.map((o) => ({
    merchantId: o.merchantId,
    merchant: o.merchantName,
    merchantRating: o.merchantRating || null,
    merchantReviews: o.merchantReviewsQuantity || 0,
    price: o.price,
    kaspiDelivery: !!o.kaspiDelivery,
    deliveryDuration: o.deliveryDuration || null,
    title: o.title,
    category: o.masterCategory || null,
  }))
}

/** Rating summary + recent dated ratings (for velocity-based sales estimate).
    Kaspi separates ALL ratings (stars given) from COMMENT (text reviews) — the
    product page headline "(N отзыва)" is the COMMENT count, so we surface both. */
export async function getReviews(id, { limit = 1000 } = {}) {
  const url =
    `${BASE}/yml/review-view/api/v1/reviews/product/${id}` +
    `?baseProductCodes=${id}&limit=${limit}&page=0&withAgg=true&sort=DATE`
  const json = await getJSON(url)
  const summary = json.summary || {}
  const statistic = summary.statistic || []
  const byStar = {}
  statistic.forEach((x) => (byStar[x.rate] = x.count))
  const ratingsTotal = statistic.reduce((s, x) => s + (x.count || 0), 0)

  // groupSummary: [{id:'ALL',total},{id:'COMMENT',total},{id:'PICTURE',...}, ...]
  const grp = {}
  ;(json.groupSummary || []).forEach((g) => (grp[g.id] = g.total))
  const commentsTotal = grp.COMMENT != null ? grp.COMMENT : ratingsTotal
  const allTotal = grp.ALL != null ? grp.ALL : ratingsTotal

  const reviews = (json.data || []).map((r) => ({ date: r.date, rating: r.rating }))
  return {
    global: summary.global || null,
    ratingsTotal: allTotal, // 103 — сколько поставили оценку
    commentsTotal, // 82 — сколько написали отзыв (как на странице Kaspi)
    withPhoto: grp.PICTURE || 0,
    positive: grp.POSITIVE || 0,
    negative: grp.NEGATIVE || 0,
    byStar, // distribution of the ratingsTotal
    reviews, // recent dated ratings (dd.mm.yyyy) for velocity
  }
}
