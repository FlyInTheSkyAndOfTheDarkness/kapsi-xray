/* ============================================================
   Unit-economics engine for a Kaspi.kz seller.
   Given a product's price, purchase cost and Kaspi fee model,
   returns the full per-unit profit breakdown — the same logic
   the dashboard, calculator and ABC pages all share.
   ============================================================ */

/**
 * Compute per-unit economics.
 * @param {object} p
 * @param {number} p.price      sale price on Kaspi, ₸
 * @param {number} p.purchase   purchase / production cost, ₸
 * @param {number} p.commission Kaspi commission, % of price
 * @param {number} p.tax        tax, % of price
 * @param {number} p.delivery   delivery cost per order, ₸
 * @param {number} p.packaging  packaging cost per order, ₸
 * @param {number} p.returns    returns rate, % of orders
 */
export function unitEconomics(p) {
  const price = num(p.price)
  const purchase = num(p.purchase)
  const commissionPct = num(p.commission)
  const taxPct = num(p.tax)
  const delivery = num(p.delivery)
  const packaging = num(p.packaging)
  const returnsPct = num(p.returns)

  const commission = (price * commissionPct) / 100
  const tax = (price * taxPct) / 100
  // A returned unit still incurs delivery both ways — model as extra delivery
  // amortised across sold units.
  const returnsCost = ((delivery * 2 + packaging) * returnsPct) / 100

  const totalCost = purchase + commission + tax + delivery + packaging + returnsCost
  const net = price - totalCost
  const marginPct = price ? (net / price) * 100 : 0
  const roiPct = purchase ? (net / purchase) * 100 : 0

  return {
    price,
    purchase,
    commission,
    tax,
    delivery,
    packaging,
    returnsCost,
    totalCost,
    net,
    marginPct,
    roiPct,
    isLoss: net < 0,
    // ordered breakdown for waterfalls / expense charts
    parts: [
      { key: 'purchase', value: purchase },
      { key: 'commission', value: commission },
      { key: 'delivery', value: delivery },
      { key: 'tax', value: tax },
      { key: 'packaging', value: packaging },
      { key: 'returnsCost', value: returnsCost },
    ],
  }
}

/** Recommended sale price to hit a target margin %, holding costs fixed. */
export function recommendedPrice(p, targetMarginPct) {
  // net = price - purchase - price*(comm+tax)/100 - delivery - packaging - returns
  // margin = net/price = target/100  =>  solve for price
  const k = (num(p.commission) + num(p.tax)) / 100
  const returnsUnit = ((num(p.delivery) * 2 + num(p.packaging)) * num(p.returns)) / 100
  const fixed = num(p.purchase) + num(p.delivery) + num(p.packaging) + returnsUnit
  const m = targetMarginPct / 100
  const denom = 1 - k - m
  if (denom <= 0) return null
  return fixed / denom
}

/** Break-even price: net = 0. */
export function breakEvenPrice(p) {
  return recommendedPrice(p, 0)
}

/** Per-product store profit from price + user cost + Kaspi fee model. */
export function storeProfit(price, cost, estSales, fees = {}) {
  if (!cost || cost <= 0) return null
  const e = unitEconomics({
    price,
    purchase: cost,
    commission: fees.commission ?? 12,
    tax: fees.tax ?? 3,
    delivery: fees.delivery ?? 900,
    packaging: fees.packaging ?? 250,
    returns: fees.returns ?? 6,
  })
  return { marginPct: e.marginPct, roiPct: e.roiPct, unitNet: e.net, monthlyProfit: Math.round(e.net * (estSales || 0)), isLoss: e.isLoss, econ: e }
}

/**
 * ABC classification by cumulative profit share (Pareto 80/15/5).
 * @param {Array} items  each must expose `.totalProfit`
 * @returns items sorted desc with `.abc` ('A'|'B'|'C') and `.cumShare` added
 */
export function classifyABC(items) {
  const sorted = [...items].sort((a, b) => b.totalProfit - a.totalProfit)
  const totalProfit = sorted.reduce((s, x) => s + Math.max(0, x.totalProfit), 0) || 1
  let cum = 0
  return sorted.map((x) => {
    cum += Math.max(0, x.totalProfit)
    const cumShare = (cum / totalProfit) * 100
    const abc = cumShare <= 80 ? 'A' : cumShare <= 95 ? 'B' : 'C'
    return { ...x, abc, cumShare }
  })
}

export function sum(arr, sel = (x) => x) {
  return arr.reduce((s, x) => s + (Number(sel(x)) || 0), 0)
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
