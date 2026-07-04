/* Shared analytics helpers (reuse the frontend estimate library on the server). */

import {
  estimateSales,
  analyzeOffers,
  resolveMultiplierKey,
  DEFAULT_MULTIPLIERS,
} from '../src/lib/salesEstimate.js'
import { unitEconomics } from '../src/lib/economics.js'
import * as kaspi from './kaspi.js'

/** Crude lifetime estimate for a catalog card (no extra API calls). */
export function estimateCard(card, multipliers = DEFAULT_MULTIPLIERS) {
  const key = resolveMultiplierKey(card.title, card.categoryName)
  const mult = multipliers[key] || DEFAULT_MULTIPLIERS[key] || DEFAULT_MULTIPLIERS.default
  const est = estimateSales({
    price: card.price,
    ratingsTotal: card.reviewsQuantity,
    reviews: [],
    createdTime: card.createdTime,
    multiplier: mult,
  })
  return { sales: est.available ? est.monthlySales : 0, revenue: est.available ? est.monthlyRevenue : 0, mult, catKey: key }
}

/** Full observation snapshot for a product (offers + reviews + estimate). */
export async function snapshotProduct(productId, { city } = {}) {
  const [offs, rev, found] = await Promise.all([
    kaspi.offers(productId, { city }).catch(() => []),
    kaspi.reviews(productId).catch(() => null),
    kaspi.search(String(productId), { city, limit: 5 }).catch(() => []),
  ])
  const comp = analyzeOffers(offs)
  const card = found.find((p) => p.id === String(productId)) || {}
  const title = card.title || (offs[0] && offs[0].title) || `#${productId}`
  const price = card.price || comp.min || 0
  const key = resolveMultiplierKey(card.title || title, card.categoryName, offs[0] && offs[0].category)
  const mult = DEFAULT_MULTIPLIERS[key] || DEFAULT_MULTIPLIERS.default
  const est = rev
    ? estimateSales({ price, ratingsTotal: rev.ratingsTotal, reviews: rev.reviews, createdTime: card.createdTime, multiplier: mult })
    : { available: false }
  return {
    productId: String(productId),
    title,
    image: card.image || null,
    link: card.link || `https://kaspi.kz/shop/p/-${productId}/`,
    price,
    buyBox: (comp.buyBox && comp.buyBox.price) || comp.min || price,
    buyBoxMerchant: (comp.buyBox && comp.buyBox.merchant) || null,
    sellers: comp.count || 0,
    priceMin: comp.min || price,
    priceMax: comp.max || price,
    rating: rev ? rev.global : null,
    ratingsTotal: rev ? rev.ratingsTotal : 0,
    commentsTotal: rev ? rev.commentsTotal : 0,
    estSales: est.available ? est.monthlySales : 0,
    estRevenue: est.available ? est.monthlyRevenue : 0,
    catKey: key,
  }
}

/** Per-product real unit economics using the user's cost (COGS). */
export function productProfit(card, cost, est) {
  if (!cost || cost <= 0) return null
  const e = unitEconomics({
    price: card.price,
    purchase: cost,
    commission: 12,
    tax: 3,
    delivery: 900,
    packaging: 250,
    returns: 6,
  })
  return {
    unitNet: e.net,
    marginPct: e.marginPct,
    roiPct: e.roiPct,
    monthlyProfit: Math.round(e.net * (est?.sales || 0)),
    isLoss: e.isLoss,
    econ: { commission: e.commission, delivery: e.delivery, tax: e.tax, packaging: e.packaging, returnsCost: e.returnsCost },
  }
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export { DEFAULT_MULTIPLIERS }
