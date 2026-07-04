/* Competitor change detection → alerts.
   On each poll we compare the fresh snapshot with the competitor's last
   observed values and emit an alert on meaningful changes. */

import { find, insert, update, uid } from './db.js'

const PRICE_THRESHOLD_PCT = 0.5 // ignore sub-0.5% noise
const SELLERS_THRESHOLD = 2

/** Set the baseline (no alert) — called when a competitor is first tracked. */
export function initBaseline(competitorId, snap) {
  update('competitors', competitorId, {
    lastPrice: snap.price || null,
    lastBuyBox: snap.buyBoxMerchant || null,
    lastSellers: snap.sellers ?? null,
  })
}

/** Compare a fresh snapshot to the competitor baseline, emit alerts, update baseline. */
export function checkAndEmitAlerts(userId, competitorId, snap) {
  const c = find('competitors', (x) => x.id === competitorId)
  if (!c) return []
  const out = []
  const mk = (type, oldValue, newValue, deltaPct) =>
    out.push(insert('alerts', { id: uid(), userId, competitorId, productId: c.productId, title: c.title, image: c.image || null, type, oldValue, newValue, deltaPct: deltaPct ?? null, ts: Date.now(), read: false }))

  if (c.lastPrice != null && snap.price > 0) {
    const d = ((snap.price - c.lastPrice) / c.lastPrice) * 100
    if (Math.abs(d) >= PRICE_THRESHOLD_PCT) mk(d < 0 ? 'price_down' : 'price_up', c.lastPrice, snap.price, Math.round(d * 10) / 10)
  }
  if (c.lastBuyBox && snap.buyBoxMerchant && c.lastBuyBox !== snap.buyBoxMerchant) {
    mk('buybox', c.lastBuyBox, snap.buyBoxMerchant, null)
  }
  if (c.lastSellers != null && Math.abs((snap.sellers || 0) - c.lastSellers) >= SELLERS_THRESHOLD) {
    mk('sellers', c.lastSellers, snap.sellers || 0, null)
  }

  update('competitors', c.id, { lastPrice: snap.price || c.lastPrice, lastBuyBox: snap.buyBoxMerchant || c.lastBuyBox, lastSellers: snap.sellers ?? c.lastSellers })
  return out
}
