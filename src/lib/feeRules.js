import { resolveMultiplierKey } from './salesEstimate.js'

const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export const DEFAULT_FEE_RULES = {
  mode: 'category',
  category: {
    electronics: { delivery: 1200, packaging: 350, returns: 5 },
    sport: { delivery: 1000, packaging: 300, returns: 6 },
    auto: { delivery: 1200, packaging: 300, returns: 4 },
    kids: { delivery: 850, packaging: 220, returns: 7 },
    home: { delivery: 1100, packaging: 300, returns: 6 },
    apparel: { delivery: 850, packaging: 220, returns: 9 },
    beauty: { delivery: 700, packaging: 180, returns: 4 },
    default: { delivery: 900, packaging: 250, returns: 6 },
  },
  ranges: [
    { id: 'low', min: 0, max: 10000, delivery: 700, packaging: 180, returns: 5 },
    { id: 'mid', min: 10000, max: 50000, delivery: 900, packaging: 250, returns: 6 },
    { id: 'high', min: 50000, max: null, delivery: 1200, packaging: 350, returns: 7 },
  ],
}

function normalizeFeeSet(value, fallback) {
  return {
    delivery: Math.max(0, num(value?.delivery, fallback.delivery)),
    packaging: Math.max(0, num(value?.packaging, fallback.packaging)),
    returns: Math.max(0, num(value?.returns, fallback.returns)),
  }
}

export function normalizeFeeRules(saved) {
  const base = DEFAULT_FEE_RULES
  const mode = saved?.mode === 'range' ? 'range' : 'category'
  const category = Object.fromEntries(
    Object.entries(base.category).map(([key, fees]) => [key, normalizeFeeSet(saved?.category?.[key], fees)])
  )
  const savedRanges = Array.isArray(saved?.ranges) ? saved.ranges : []
  const ranges = base.ranges.map((range) => {
    const savedRange = savedRanges.find((x) => x?.id === range.id) || {}
    const max = savedRange.max === '' || savedRange.max == null ? range.max : num(savedRange.max, range.max)
    return {
      id: range.id,
      min: Math.max(0, num(savedRange.min, range.min)),
      max: max == null ? null : Math.max(0, max),
      ...normalizeFeeSet(savedRange, range),
    }
  })
  return { mode, category, ranges }
}

export function resolveFeeRules(product = {}, rules = DEFAULT_FEE_RULES) {
  const normalized = normalizeFeeRules(rules)
  const categoryKey = resolveMultiplierKey(product.title, product.categoryName, product.category, product.categoryCode)
  const categoryFees = normalized.category[categoryKey] || normalized.category.default
  const price = Math.max(0, num(product.price, 0))
  const range = normalized.ranges.find((r) => price >= num(r.min, 0) && (r.max == null || price < num(r.max, Infinity)))
  const fees = normalized.mode === 'range' && range ? normalizeFeeSet(range, categoryFees) : categoryFees
  return {
    commission: 12,
    tax: 3,
    ...fees,
    categoryKey,
    mode: normalized.mode,
    rangeId: normalized.mode === 'range' ? range?.id || null : null,
  }
}
