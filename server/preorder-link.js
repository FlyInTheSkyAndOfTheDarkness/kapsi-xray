/* ============================================================
   Links a Kaspi SKU back to the pre-order draft it came from.

   Kaspi resets the pre-order when a product card is edited, so price and stock
   changes for these SKUs must never go through the products import API — they
   belong in the price-list feed. Everything that used to push a card (the
   repricer, the manual publish button) asks here first.
   ============================================================ */

import { find, update } from './db.js'
import { kaspiSku } from './taobao-product.js'

/** The pre-order draft behind a SKU of a given store, or null for a normal product. */
export function preorderRowForSku(userId, storeId, sku) {
  const wanted = kaspiSku(sku)
  if (!wanted) return null
  return find('taobaoProducts', (row) => row.userId === userId
    && row.preferredStoreId === storeId
    && kaspiSku(row.product?.draft?.sku || '') === wanted) || null
}

/** Write a new price into the draft; the feed carries it to Kaspi within the hour. */
export function setPreorderPrice(productRow, price) {
  const salePrice = Math.max(0, Math.round(Number(price) || 0))
  const draft = { ...(productRow.product?.draft || {}), price: salePrice, salePrice }
  return update('taobaoProducts', productRow.id, {
    product: { ...productRow.product, draft },
    draftEditedAt: Date.now(),
    updatedAt: Date.now(),
  })
}
