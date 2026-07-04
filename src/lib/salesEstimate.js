/* ============================================================
   Sales estimation for any Kaspi product.
   Kaspi never exposes real unit sales — like every marketplace
   analytics service, we ESTIMATE it from review velocity:
   only a fraction of buyers leave a review, so
     monthly orders ≈ (reviews per month) × reviews-to-orders ratio.
   Everything here is labelled as an estimate with a confidence.
   ============================================================ */

// On Kaspi roughly 1 in ~14 buyers leaves a review (category-dependent).
export const REVIEW_TO_ORDER = 14

/* Per-category review→order ratio: how many orders per one review/rating.
   High-ticket goods (electronics) get reviewed more often (low ratio);
   cheap frequent buys (beauty, pharmacy) rarely (high ratio). Heuristic —
   user-editable in Settings and calibratable against ground truth. */
export const CATEGORY_KEYS = ['electronics', 'sport', 'auto', 'kids', 'home', 'apparel', 'beauty', 'default']
export const DEFAULT_MULTIPLIERS = {
  electronics: 9,
  sport: 13,
  auto: 14,
  kids: 15,
  home: 16,
  apparel: 20,
  beauty: 22,
  default: 14,
}
const CATEGORY_TESTS = [
  { key: 'electronics', test: /smartphone|\bphone\b|телефон|смартфон|электрон|electronic|ноут|laptop|computer|компьютер|планшет|tablet|телевизор|\btv\b|audio|аудио|наушник|headphone|гаджет|watch|часы/ },
  { key: 'beauty', test: /beaut|космет|уход|красот|парфюм|perfume|health|здоров|аптек|pharmac|витамин|космо/ },
  { key: 'apparel', test: /одежд|обув|плать|футбол|рубаш|clothing|shoes|footwear|fashion|мода|аксессуар/ },
  { key: 'kids', test: /детск|игрушк|\bkids\b|toys|baby|малыш/ },
  { key: 'home', test: /\bдом\b|кухн|home|kitchen|бытов|appliance|мебель|furnitur|посуд/ },
  { key: 'sport', test: /велосипед|\bbike\b|спорт|sport|фитнес|тренаж|самокат|scooter/ },
  { key: 'auto', test: /\bавто\b|\bauto\b|\bcar\b|шины|tire|запчаст/ },
]

/** Detect a product's category key from title / Kaspi category strings. */
export function resolveMultiplierKey(...strings) {
  const hay = strings.filter(Boolean).join(' ').toLowerCase()
  for (const c of CATEGORY_TESTS) if (c.test.test(hay)) return c.key
  return 'default'
}

/** Resolve {key, mult} using an optional user multiplier override map. */
export function resolveMultiplier(strings, overrides) {
  const key = resolveMultiplierKey(...(Array.isArray(strings) ? strings : [strings]))
  const mult = (overrides && overrides[key]) || DEFAULT_MULTIPLIERS[key] || DEFAULT_MULTIPLIERS.default
  return { key, mult }
}

/** Parse Kaspi's "DD.MM.YYYY" review date to a JS Date. */
function parseKaspiDate(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s || '')
  if (!m) return null
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
}

/**
 * Estimate monthly sales & revenue.
 * @param {object} p
 * @param {number} p.price          current buy-box price, ₸
 * @param {number} p.reviewsTotal   total review count
 * @param {Array}  p.reviews        recent dated reviews [{date}]
 * @param {string} p.createdTime    ISO listing date (optional)
 * @param {number} p.multiplier     reviews-to-orders ratio
 */
export function estimateSales(p) {
  const mult = p.multiplier || REVIEW_TO_ORDER
  const now = new Date()
  const dates = (p.reviews || []).map((r) => parseKaspiDate(r.date)).filter(Boolean).sort((a, b) => b - a)
  const total = p.ratingsTotal || p.reviewsTotal || 0

  let reviewsPerMonth = null
  let method = 'none'
  let confidence = 'low'

  const oldest = dates.length ? dates[dates.length - 1] : null
  // Ratings are sorted newest-first: if the oldest sampled rating is >30 days
  // back, then every rating from the last 30 days is present in the sample —
  // enough for an exact count regardless of total history depth.
  const sampleCoversMonth = oldest && (now - oldest) / 86400000 >= 30

  if (sampleCoversMonth) {
    // exact: how many ratings actually landed in the last 30 days
    const cutoff = now - 30 * 86400000
    reviewsPerMonth = dates.filter((d) => d >= cutoff).length
    method = 'exact30'
    confidence = reviewsPerMonth >= 8 ? 'high' : reviewsPerMonth >= 2 ? 'medium' : 'low'
  } else if (dates.length >= 4) {
    // dense/truncated sample → recent run-rate from the sampled window
    const newest = dates[0]
    const daysSpanned = Math.max(1, (newest - dates[dates.length - 1]) / 86400000)
    reviewsPerMonth = (dates.length / daysSpanned) * 30
    method = 'velocity'
    confidence = dates.length >= 30 && daysSpanned >= 14 ? 'medium' : 'low'
  } else if (p.createdTime && total) {
    const created = new Date(p.createdTime)
    const months = Math.max(1, (now - created) / (86400000 * 30))
    reviewsPerMonth = total / months
    method = 'lifetime'
    confidence = 'low'
  } else if (total) {
    reviewsPerMonth = Math.max(1, total * 0.06)
    method = 'crude'
    confidence = 'low'
  }

  if (reviewsPerMonth == null) {
    return { available: false }
  }

  const monthlySales = Math.max(0, Math.round(reviewsPerMonth * mult))
  const monthlyRevenue = Math.round(monthlySales * (p.price || 0))
  return {
    available: true,
    monthlySales,
    monthlyRevenue,
    dailySales: Math.round((monthlySales / 30) * 10) / 10,
    reviewsPerMonth: Math.round(reviewsPerMonth * 10) / 10,
    multiplier: mult,
    method,
    confidence,
    sampleSize: dates.length,
  }
}

const MONTHS_SHORT = {
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  kk: ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}
const pad2 = (n) => String(n).padStart(2, '0')
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/**
 * Build a sales-over-time series from dated ratings.
 * Sales per bucket = ratings that landed in the bucket × multiplier.
 * This is the honest trend proxy — Kaspi never exposes real sales history.
 * @param {Array} reviews  [{date:'DD.MM.YYYY'}]
 * @param {object} opts    { period: 'd7'|'d14'|'d30'|'d90'|'month', multiplier, total, lang }
 */
export function buildSalesSeries(reviews, opts = {}) {
  const { period = 'd30', multiplier = REVIEW_TO_ORDER, total = 0, lang = 'ru', price = 0 } = opts
  const dates = (reviews || []).map((r) => parseKaspiDate(r.date)).filter(Boolean)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const DAY = 86400000
  const oldest = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null
  const truncated = total ? dates.length < total : false
  const months = MONTHS_SHORT[lang] || MONTHS_SHORT.ru

  // finalize: attach sales/revenue + running cumulative, compute totals
  const finalize = (raw, unit, partial) => {
    let cumSales = 0
    let cumRevenue = 0
    const buckets = raw.map((b) => {
      const sales = b.ratings * multiplier
      const revenue = sales * price
      cumSales += sales
      cumRevenue += revenue
      return { ...b, sales, revenue, cumSales, cumRevenue }
    })
    const totalRatings = raw.reduce((s, b) => s + b.ratings, 0)
    return { buckets, totalSales: cumSales, totalRevenue: cumRevenue, totalRatings, partial, unit }
  }

  if (period === 'month') {
    if (!oldest) return { buckets: [], totalSales: 0, totalRevenue: 0, totalRatings: 0, partial: false, unit: 'month' }
    const list = []
    const cur = new Date(oldest.getFullYear(), oldest.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth(), 1)
    while (cur <= end) {
      list.push(new Date(cur))
      cur.setMonth(cur.getMonth() + 1)
    }
    const capped = list.slice(-12)
    const raw = capped.map((m) => ({
      key: `${m.getFullYear()}-${m.getMonth()}`,
      label: `${months[m.getMonth()]} ${String(m.getFullYear()).slice(2)}`,
      ratings: dates.filter((d) => d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth()).length,
    }))
    return finalize(raw, 'month', truncated || capped.length < list.length)
  }

  const N = { d7: 7, d14: 14, d30: 30, d90: 90 }[period] || 30
  const start = new Date(now.getTime() - (N - 1) * DAY)
  const raw = []
  for (let i = 0; i < N; i++) {
    const day = new Date(start.getTime() + i * DAY)
    raw.push({ key: i, label: `${pad2(day.getDate())}.${pad2(day.getMonth() + 1)}`, ratings: dates.filter((d) => sameDay(d, day)).length })
  }
  return finalize(raw, 'day', truncated && oldest && oldest > start)
}

/** Competition summary from the offers list. */
export function analyzeOffers(offers) {
  if (!offers || !offers.length) return { count: 0 }
  const prices = offers.map((o) => o.price).filter((x) => x > 0)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const avg = prices.reduce((s, x) => s + x, 0) / prices.length
  const kaspiDelivery = offers.filter((o) => o.kaspiDelivery).length
  const buyBox = offers.reduce((a, b) => (b.price < a.price ? b : a), offers[0])
  return {
    count: offers.length,
    min,
    max,
    avg,
    spreadPct: min ? ((max - min) / min) * 100 : 0,
    kaspiDelivery,
    buyBox,
    // competition intensity: many sellers + tight spread = brutal
    level: offers.length >= 20 ? 'high' : offers.length >= 7 ? 'mid' : 'low',
  }
}
