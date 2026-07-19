import { find, update } from './db.js'
import * as kaspi from './kaspi.js'

const clampNumber = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function publicRepricer(row) {
  if (!row) return null
  const { userId, ...safe } = row
  return safe
}

export function sanitizeWarehouses(value) {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
  return String(value || '')
    .split(/[,\n;]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12)
}

export function buildImportPayload(product = {}, settings = {}) {
  const sku = String(product.sku || product.id || settings.sku || '').trim()
  const price = Math.max(0, Math.round(clampNumber(settings.salePrice ?? product.salePrice ?? product.price, 0)))
  const stock = settings.stock === '' || settings.stock == null ? null : Math.max(0, Math.round(clampNumber(settings.stock, 0)))
  const warehouses = sanitizeWarehouses(settings.warehouses)
  const payload = {
    sku,
    title: String(product.title || product.name || sku).trim(),
    brand: String(product.brand || settings.brand || '').trim(),
    category: String(product.category || product.categoryCode || product.categoryId || settings.category || '').trim(),
    price,
  }
  if (stock != null) {
    payload.stock = stock
    payload.quantity = stock
  }
  if (warehouses.length) {
    payload.availabilities = warehouses.map((storeId) => ({
      storeId,
      available: stock == null ? true : stock > 0,
      stockCount: stock == null ? undefined : stock,
    }))
  }
  return payload
}

export async function runRepricer(rule) {
  const fallbackNextRunAt = Date.now() + Math.max(1, Number(rule.frequencyMinutes) || 60) * 60_000
  const store = find('stores', (s) => s.id === rule.storeId && s.userId === rule.userId)
  if (!store) return updateRun(rule, { lastError: 'store_not_found', nextRunAt: fallbackNextRunAt })
  if (!store.token) return updateRun(rule, { lastError: 'no_token', nextRunAt: fallbackNextRunAt })

  const product = rule.product || { id: rule.sku, sku: rule.sku, title: rule.title, price: rule.currentPrice }
  const offers = await kaspi.offers(rule.sku, { limit: 64 })
  const competitors = offers
    .filter((o) => String(o.merchantId) !== String(store.merchantId))
    .filter((o) => Number(o.price) > 0)
    .sort((a, b) => a.price - b.price)

  if (!competitors.length) return updateRun(rule, { lastError: 'no_competitors', competitors: 0, nextRunAt: fallbackNextRunAt })

  const best = competitors[0]
  const minPrice = Math.max(0, Math.round(clampNumber(rule.minPrice, 0)))
  const step = Math.max(1, Math.round(clampNumber(rule.step, 1)))
  const targetPrice = Math.max(minPrice, Math.round(best.price - step))
  const currentPrice = Math.round(clampNumber(rule.currentPrice || product.price, 0))
  const nextRunAt = Date.now() + Math.max(1, Number(rule.frequencyMinutes) || 60) * 60_000

  if (targetPrice === currentPrice) {
    return updateRun(rule, {
      lastError: null,
      lastAction: 'unchanged',
      lastCompetitorPrice: best.price,
      competitors: competitors.length,
      nextRunAt,
    })
  }

  const payload = buildImportPayload(product, {
    salePrice: targetPrice,
    stock: rule.stock,
    warehouses: rule.warehouses,
  })
  if (!payload.sku || !payload.price) return updateRun(rule, { lastError: 'bad_product_payload', nextRunAt })

  const result = await kaspi.merchantImportProducts(store.token, [payload])
  return updateRun(rule, {
    lastError: null,
    lastAction: targetPrice <= minPrice ? 'min_price' : 'price_changed',
    lastCompetitorPrice: best.price,
    competitors: competitors.length,
    currentPrice: targetPrice,
    lastImportCode: result?.code || null,
    lastImportStatus: result?.status || null,
    nextRunAt,
  })
}

function updateRun(rule, patch) {
  return update('repricers', rule.id, {
    ...patch,
    lastRunAt: Date.now(),
    updatedAt: Date.now(),
  })
}
