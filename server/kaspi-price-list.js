import { randomBytes } from 'node:crypto'
import { filter, find, update } from './db.js'
import { MAX_PREORDER_DAYS, normalizeImages, normalizePreorderDays, sanitizeProductTitle } from './taobao-product.js'
import { sanitizeWarehouses } from './repricer.js'

function publicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return String(process.env.PUBLIC_BASE_URL).replace(/\/$/, '')
  if (!req) return null
  const protocol = req.get('x-forwarded-proto') || req.protocol
  const host = req.get('x-forwarded-host') || req.get('host')
  return host ? `${protocol}://${host}` : null
}

function xmlText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function xmlAttr(value) {
  return xmlText(value).replaceAll('"', '&quot;')
}

function normalizeWarehouseId(value) {
  const clean = String(value || '').trim()
  return /^pp[1-5]$/i.test(clean) ? clean.toUpperCase() : clean
}

function latestTaobaoImportRows(store) {
  const latest = new Map()
  filter('imports', (row) => row.userId === store.userId && row.storeId === store.id && row.taobaoProductId)
    .forEach((row) => {
      const current = latest.get(row.taobaoProductId)
      if (!current || (row.createdAt || 0) > (current.createdAt || 0)) latest.set(row.taobaoProductId, row)
    })
  return [...latest.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

function isRejectedImport(row) {
  const result = row.kaspiResult || null
  const itemStates = Object.values(result?.result || {}).map((item) => String(item?.state || '').toUpperCase())
  const status = String(row.status || row.kaspiStatus?.status || '').toUpperCase()
  const errors = Number(result?.errors || 0)
  const skipped = Number(result?.skipped || 0)
  return !!row.localError || row.status === 'FAILED' || errors > 0 || skipped > 0 || /FAILED|ERROR|REJECT|CANCEL|INVALID/.test([status, ...itemStates].join(' '))
}

export function ensurePriceListFeedKey(store) {
  if (!store) return null
  if (store.priceListFeedKey) return store.priceListFeedKey
  const priceListFeedKey = randomBytes(24).toString('hex')
  update('stores', store.id, { priceListFeedKey, updatedAt: Date.now() })
  store.priceListFeedKey = priceListFeedKey
  return priceListFeedKey
}

export function preorderFeedUrl(req, store) {
  const key = ensurePriceListFeedKey(store)
  const base = publicBaseUrl(req)
  return base && key ? `${base}/api/stores/preorder-feed/${key}.xml` : null
}

/**
 * The store's pickup points, each flagged as selling or not.
 * Kaspi stops selling from a point only when it receives `available="no"` for it —
 * a point simply left out of the file keeps its previous price and stays on sale.
 * Falls back to the points named on the products themselves.
 */
export function storeWarehouseMap(store, productWarehouses = []) {
  const configured = Array.isArray(store?.priceListWarehouses) ? store.priceListWarehouses : []
  const seen = new Set()
  const map = configured
    .map((item) => ({
      id: normalizeWarehouseId(String(item?.id ?? item ?? '').trim()),
      available: typeof item === 'object' && item !== null ? item.available !== false : true,
    }))
    .filter((item) => item.id && !seen.has(item.id) && (seen.add(item.id), true))
  if (map.length) return map.slice(0, 5)
  return sanitizeWarehouses(productWarehouses).map(normalizeWarehouseId).filter(Boolean)
    .filter((id) => !seen.has(id) && (seen.add(id), true))
    .map((id) => ({ id, available: true }))
    .slice(0, 5)
}

export function preorderPriceListOffers(store) {
  const offers = []
  const skipped = []
  latestTaobaoImportRows(store).forEach((row) => {
    if (isRejectedImport(row)) {
      skipped.push({ importId: row.id, reason: 'failed_import' })
      return
    }
    const product = row.products?.[0] || {}
    const sku = String(product.sku || '').trim()
    const model = sanitizeProductTitle(product.title || product.name || sku)
    const brand = String(product.brand || 'Без бренда').trim()
    const price = Math.max(0, Math.round(Number(product.salePrice ?? product.price) || 0))
    const stockCount = Math.max(0, Math.round(Number(product.stock ?? product.quantity) || 0))
    const preOrder = normalizePreorderDays(product.deliveryDays ?? product.preorderDays ?? product.preOrderDays)
    const warehouses = storeWarehouseMap(store, product.warehouses)
    const images = normalizeImages(product.images)
    if (!sku || !model || !brand || !price || !warehouses.length || !images.length || preOrder > MAX_PREORDER_DAYS) {
      skipped.push({ importId: row.id, sku, reason: 'missing_preorder_fields' })
      return
    }
    // Withdrawn or out of stock still goes out — with available="no", so Kaspi
    // takes it off sale instead of keeping the previous price.
    const sellable = stockCount > 0 && product.feedEnabled !== false
    const availabilities = warehouses.map(({ id, available }) => {
      const sells = sellable && available
      return { storeId: id, available: sells, stockCount: sells ? stockCount : 0, preOrder: sells ? preOrder : 0 }
    })
    offers.push({ sku, model, brand, price, stockCount, preOrder, warehouses, availabilities, withdrawn: !sellable, importId: row.id })
  })
  return { offers, skipped }
}

export function preorderPriceListSummary(req, store) {
  if (!store) return null
  const { offers, skipped } = preorderPriceListOffers(store)
  return {
    mode: 'kaspi_xml_preorder',
    status: offers.length ? 'ready' : 'empty',
    url: preorderFeedUrl(req, store),
    items: offers.length,
    // Which articles actually made it in — a product's own stage depends on this,
    // not on whether the file has any offers at all.
    skus: offers.map((offer) => offer.sku),
    selling: offers.filter((offer) => !offer.withdrawn).length,
    withdrawn: offers.filter((offer) => offer.withdrawn).length,
    skipped: skipped.length,
    warehouses: storeWarehouseMap(store),
    maxPreorderDays: MAX_PREORDER_DAYS,
    fetchedAt: store.priceListFetchedAt || null,
    fetchCount: store.priceListFetchCount || 0,
    updatedAt: Date.now(),
  }
}

export function buildPreorderPriceListXml(store) {
  const { offers, skipped } = preorderPriceListOffers(store)
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<kaspi_catalog date="${xmlAttr(new Date().toISOString())}" xmlns="kaspiShopping" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="kaspiShopping http://kaspi.kz/kaspishopping.xsd">`,
    `  <company>${xmlText(store.name || `Merchant ${store.merchantId || store.id}`)}</company>`,
    `  <merchantid>${xmlText(store.merchantId || store.id)}</merchantid>`,
    '  <offers>',
  ]
  offers.forEach((offer) => {
    lines.push(`    <offer sku="${xmlAttr(offer.sku)}">`)
    lines.push(`      <model>${xmlText(offer.model)}</model>`)
    lines.push(`      <brand>${xmlText(offer.brand)}</brand>`)
    lines.push('      <availabilities>')
    offer.availabilities.forEach(({ storeId, available, stockCount, preOrder }) => {
      const attrs = [`available="${available ? 'yes' : 'no'}"`, `storeId="${xmlAttr(storeId)}"`, `stockCount="${stockCount}"`]
      // «Не передавайте атрибут, если на товар не нужно делать предзаказ.»
      if (preOrder > 0) attrs.push(`preOrder="${preOrder}"`)
      lines.push(`        <availability ${attrs.join(' ')}/>`)
    })
    lines.push('      </availabilities>')
    lines.push(`      <price>${offer.price}</price>`)
    lines.push('    </offer>')
  })
  lines.push('  </offers>')
  lines.push('</kaspi_catalog>')
  return { xml: `${lines.join('\n')}\n`, offers, skipped }
}

export function storeByPreorderFeedKey(key) {
  return find('stores', (store) => store.priceListFeedKey === key)
}
