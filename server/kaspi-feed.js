/* ============================================================
   Kaspi price-list feed (kaspi_catalog XML).

   The products/import API only creates the *card* (model, brand,
   category, photos). Price, stock and pre-order days come from the
   price list, which Kaspi pulls from a public URL roughly once an
   hour ("Автоматическая загрузка" in the seller cabinet).

   Kaspi matches an offer to a card by SKU, so the SKU written here
   must be byte-identical to the one sent at card import.
   Schema: kaspiShopping — http://kaspi.kz/kaspishopping.xsd
   ============================================================ */

import { createHash } from 'node:crypto'

export const MAX_PREORDER_DAYS = 30 // Kaspi rejects longer pre-orders
export const MAX_SKU_LENGTH = 20 // digits and latin letters only
export const MAX_OFFERS = 5000

export const FEED_DEFAULTS = {
  active: true,
  warehouses: [],
  preorderDays: 14,
  stock: 10,
  includePaused: true,
  autoPublish: false,
  company: '',
  basicLogin: '',
  basicPassword: '',
}

const XML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

/** Escape text/attribute data and drop control characters XML 1.0 forbids. */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"']/g, (char) => XML_ESCAPE[char])
}

/** Price-list SKU: digits and latin letters, max 20 chars, unique per offer. */
export function kaspiSku(value, seed = '') {
  const clean = String(value ?? '').replace(/[^A-Za-z0-9]/g, '')
  if (clean) return clean.slice(0, MAX_SKU_LENGTH)
  const source = String(seed || '').trim()
  if (!source) return ''
  return `TB${createHash('sha1').update(source).digest('hex').slice(0, MAX_SKU_LENGTH - 2)}`
}

export function clampPreorderDays(value, fallback = FEED_DEFAULTS.preorderDays) {
  const days = Math.round(Number(value ?? fallback))
  if (!Number.isFinite(days) || days <= 0) return Math.min(MAX_PREORDER_DAYS, Math.max(1, Math.round(Number(fallback) || 1)))
  return Math.min(MAX_PREORDER_DAYS, days)
}

/** Kaspi wants a whole number of tenge with VAT — no spaces, no decimals. */
export function feedPrice(value) {
  const price = Math.round(Number(value) || 0)
  return price > 0 ? price : 0
}

/** Warehouse (pickup point) codes from the cabinet: Настройки → Склады и магазины. */
export function sanitizeStoreIds(value, limit = 12) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,\n;]/)
  const seen = new Set()
  return list
    .map((item) => String(item?.id ?? item ?? '').trim())
    .filter((item) => item && !seen.has(item) && (seen.add(item), true))
    .slice(0, limit)
}

/**
 * The store's warehouse map: every pickup point that may appear in the feed,
 * each flagged as selling or not. Kaspi only stops selling from a point when it
 * receives `available="no"` for it, so switched-off warehouses stay in the XML.
 * Accepts the legacy plain-id list, where every point counts as selling.
 */
export function sanitizeWarehouseList(value, limit = 12) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,\n;]/)
  const seen = new Set()
  return list
    .map((item) => ({
      id: String(item?.id ?? item ?? '').trim(),
      available: typeof item === 'object' && item !== null ? item.available !== false : true,
    }))
    .filter((item) => item.id && !seen.has(item.id) && (seen.add(item.id), true))
    .slice(0, limit)
}

/** Local Asia/Almaty (UTC+5) stamp — the `date` attribute is a plain string. */
export function feedDate(now = new Date()) {
  return `${new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 19)}+05:00`
}

export function normalizeFeedSettings(patch = {}, current = {}) {
  const base = { ...FEED_DEFAULTS, ...current }
  const next = { ...base }
  if (patch.active !== undefined) next.active = !!patch.active
  if (patch.includePaused !== undefined) next.includePaused = !!patch.includePaused
  if (patch.autoPublish !== undefined) next.autoPublish = !!patch.autoPublish
  if (patch.warehouses !== undefined) next.warehouses = sanitizeWarehouseList(patch.warehouses)
  if (patch.preorderDays !== undefined) next.preorderDays = clampPreorderDays(patch.preorderDays)
  if (patch.stock !== undefined) next.stock = Math.max(0, Math.round(Number(patch.stock) || 0))
  if (patch.company !== undefined) next.company = String(patch.company || '').trim().slice(0, 120)
  if (patch.basicLogin !== undefined) next.basicLogin = String(patch.basicLogin || '').trim().slice(0, 120)
  if (patch.basicPassword !== undefined) next.basicPassword = String(patch.basicPassword || '').slice(0, 120)
  return next
}

/* ---------------------------------------------------------------- offers */

/**
 * Turn a saved pre-order draft into a price-list offer.
 * Returns the offer plus the issues a seller has to fix in the card.
 * The draft arrives already normalized by mergeProduct, so differences against
 * what the seller originally typed are reported by the caller, not here.
 */
export function offerFromDraft(draft = {}, settings = FEED_DEFAULTS) {
  const issues = []
  const sku = kaspiSku(draft.sku, draft.identity || draft.id || draft.title)
  if (!sku) issues.push('no_sku')

  const model = String(draft.title || '').trim().slice(0, 250)
  if (!model) issues.push('no_model')

  const price = feedPrice(draft.salePrice ?? draft.price)
  if (!price) issues.push('no_price')

  const preOrder = clampPreorderDays(draft.deliveryDays ?? draft.preorderDays, settings.preorderDays)

  // The store's warehouse map decides which pickup points appear at all; a card
  // may narrow that down, but never adds points the map does not list.
  const cardStores = sanitizeStoreIds(draft.warehouses)
  const configured = sanitizeWarehouseList(settings.warehouses)
  const warehouses = configured.length ? configured : cardStores.map((id) => ({ id, available: true }))
  if (!warehouses.length) issues.push('no_warehouse')
  if (configured.length && cardStores.some((id) => !configured.some((item) => item.id === id))) issues.push('unknown_warehouse')

  const stock = draft.stock == null || draft.stock === '' ? Math.max(0, Number(settings.stock) || 0) : Math.max(0, Math.round(Number(draft.stock) || 0))
  const paused = draft.feedEnabled === false
  const sellable = !paused && stock > 0
  const availabilities = warehouses.map(({ id, available }) => {
    const sells = sellable && available && (!cardStores.length || cardStores.includes(id))
    return {
      storeId: id,
      available: sells,
      stockCount: sells ? stock : 0,
      // Kaspi treats the offer as a pre-order only while preOrder is present.
      preOrder: sells ? preOrder : 0,
    }
  })
  if (warehouses.length && !availabilities.some((item) => item.available) && !paused && stock > 0) issues.push('all_warehouses_off')

  return {
    issues,
    paused,
    offer: {
      sku,
      model,
      brand: String(draft.brand || '').trim().slice(0, 120),
      price,
      availabilities,
    },
  }
}

/** Offers that Kaspi can actually accept — everything else is reported instead. */
export function isPublishableOffer(entry) {
  const blocking = ['no_sku', 'no_model', 'no_price', 'no_warehouse', 'duplicate_sku']
  return !entry.issues.some((issue) => blocking.includes(issue))
}

/* ------------------------------------------------------------------- xml */

function renderAvailability({ storeId, available, stockCount, preOrder }) {
  const attrs = [
    `available="${available ? 'yes' : 'no'}"`,
    `storeId="${escapeXml(storeId)}"`,
    `stockCount="${Math.max(0, Math.round(Number(stockCount) || 0))}"`,
  ]
  if (preOrder > 0) attrs.push(`preOrder="${clampPreorderDays(preOrder)}"`)
  return `        <availability ${attrs.join(' ')}/>`
}

function renderOffer(offer) {
  const lines = [`    <offer sku="${escapeXml(offer.sku)}">`, `      <model>${escapeXml(offer.model)}</model>`]
  if (offer.brand) lines.push(`      <brand>${escapeXml(offer.brand)}</brand>`)
  if (offer.availabilities?.length) {
    lines.push('      <availabilities>')
    offer.availabilities.forEach((availability) => lines.push(renderAvailability(availability)))
    lines.push('      </availabilities>')
  }
  lines.push(`      <price>${feedPrice(offer.price)}</price>`)
  lines.push('    </offer>')
  return lines.join('\n')
}

/** Full kaspi_catalog document. Element order follows the XSD sequence. */
export function buildCatalogXml({ company, merchantId, offers = [], date = feedDate() }) {
  const body = offers.slice(0, MAX_OFFERS).map(renderOffer)
  // The XSD requires at least one offer, so an empty catalog is only ever shown
  // in the in-app preview — the public route refuses to serve it to Kaspi.
  const offersSection = body.length ? ['  <offers>', ...body, '  </offers>'] : ['  <offers/>']
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<kaspi_catalog date="${escapeXml(date)}"`,
    '               xmlns="kaspiShopping"',
    '               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '               xsi:schemaLocation="kaspiShopping http://kaspi.kz/kaspishopping.xsd">',
    `  <company>${escapeXml(company || 'Kaspi X-Ray')}</company>`,
    `  <merchantid>${escapeXml(merchantId)}</merchantid>`,
    ...offersSection,
    '</kaspi_catalog>',
  ].join('\n')
}
