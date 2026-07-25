import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { requireAuth } from './auth.js'
import { filter, find, insert, remove, update, uid } from './db.js'
import * as taobao from './taobao.js'
import * as kaspi from './kaspi.js'
import { makeZip } from './zip.js'
import { removeUploadedImages, saveUploadedImage } from './uploads.js'
import { canonicalTaobaoUrl, isPlatformMetadata, mergeProduct, normalizeImages, normalizePreorderDays, sanitizeDescription, sanitizeProductTitle } from './taobao-product.js'
import { publicBaseUrl } from './base-url.js'
import { feedContextForStore } from './routes-feed.js'

export const taobaoRouter = Router()

const BOOKMARKLET_TTL = 1000 * 60 * 60 * 24 * 365
const KASPI_BASE = 'https://kaspi.kz'

function publicProduct(row) {
  const { userId, ...rest } = row
  const product = rest.product || {}
  return {
    ...rest,
    product: {
      ...product,
      title: sanitizeProductTitle(product.title),
      titleRu: sanitizeProductTitle(product.titleRu),
      sourceUrl: canonicalTaobaoUrl(product.sourceUrl),
      finalUrl: canonicalTaobaoUrl(product.finalUrl),
      specs: Array.isArray(product.specs) ? product.specs.filter((spec) => !isPlatformMetadata(spec.keyRu || spec.key, spec.valueRu || spec.value)) : [],
    },
  }
}

function extFromContentType(ct, fallback = 'jpg') {
  if (/png/i.test(ct)) return 'png'
  if (/webp/i.test(ct)) return 'webp'
  if (/jpeg|jpg/i.test(ct)) return 'jpg'
  return fallback
}

function safeOrigin(value) {
  try {
    const url = new URL(String(value || ''))
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

function bookmarkletUrls(req) {
  const frontendOrigin = safeOrigin(req.get('origin')) || 'http://127.0.0.1:5175'
  const appUrl = `${frontendOrigin}/taobao`
  const api = new URL(frontendOrigin)
  if (/^517\d$/.test(api.port)) api.port = process.env.PORT || '8787'
  return {
    appUrl,
    appOrigin: frontendOrigin,
    endpoint: `${api.origin}/api/taobao/browser-import`,
  }
}

function productForKaspi(base, product) {
  const images = normalizeImages(product.images).map((image) => ({
    url: image.url.startsWith('/') ? `${base}${image.url}` : image.url,
  }))
  const attributes = (Array.isArray(product.attributes) ? product.attributes : [])
    .filter((attribute) => !/^предзаказ$/i.test(String(attribute?.code || '').trim()))
    .filter((attribute) => !/^срок доставки/i.test(String(attribute?.code || '').trim()))
    .filter((attribute) => !isPlatformMetadata(attribute?.code, attribute?.value))
  const payload = {
    sku: String(product.sku || '').trim(),
    title: sanitizeProductTitle(product.title),
    brand: String(product.brand || '').trim(),
    category: String(product.category || '').trim(),
    price: Math.max(0, Math.round(Number(product.salePrice ?? product.price) || 0)),
    description: sanitizeDescription(product.description),
    attributes,
    images,
  }
  if (!payload.description) delete payload.description
  if (!payload.attributes.length) delete payload.attributes
  if (!payload.images.length) delete payload.images
  return payload
}

function taobaoIdentity(product = {}) {
  const productId = String(product.productId || '').trim()
  if (productId) return `product:${productId}`
  const source = product.finalUrl || product.sourceUrl
  try {
    const url = new URL(String(source || ''))
    url.hash = ''
    const itemId = url.searchParams.get('id') || url.searchParams.get('itemId')
    return itemId ? `product:${itemId}` : `url:${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

function importsForProduct(userId, productId) {
  return filter('imports', (row) => row.userId === userId && row.taobaoProductId === productId)
}

function saveAnalyzedProduct(userId, product) {
  const identity = taobaoIdentity(product)
  const candidates = filter('taobaoProducts', (row) => row.userId === userId && identity && taobaoIdentity(row.product) === identity)
  const existing = candidates.sort((a, b) => {
    const aImported = importsForProduct(userId, a.id).length > 0 ? 1 : 0
    const bImported = importsForProduct(userId, b.id).length > 0 ? 1 : 0
    return bImported - aImported || (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
  })[0]
  if (!existing) return insert('taobaoProducts', { id: uid(), userId, product, createdAt: Date.now(), updatedAt: Date.now() })

  const preserveDraft = !!existing.draftEditedAt || importsForProduct(userId, existing.id).length > 0
  return update('taobaoProducts', existing.id, {
    product: { ...product, draft: preserveDraft ? existing.product?.draft || product.draft : product.draft },
    updatedAt: Date.now(),
  })
}

function latestTaobaoImports(userId) {
  const latest = new Map()
  filter('imports', (row) => row.userId === userId && row.taobaoProductId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .forEach((row) => {
      if (!latest.has(row.taobaoProductId)) latest.set(row.taobaoProductId, row)
    })
  return latest
}

function resultItem(result, sku) {
  const rows = result?.result
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return null
  if (sku && rows[sku]) return rows[sku]
  return Object.values(rows)[0] || null
}

function flatResultStrings(value, out = []) {
  if (out.length >= 30 || value == null) return out
  if (typeof value === 'string') {
    const text = value.trim()
    if (text) out.push(text.slice(0, 500))
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flatResultStrings(item, out))
    return out
  }
  if (typeof value === 'object') Object.values(value).forEach((item) => flatResultStrings(item, out))
  return out
}

function issueMessages(value, key = '', out = []) {
  if (out.length >= 8 || value == null) return out
  const relevant = /error|warning|message|description|reason|detail|ошиб|причин|описан/i.test(key)
  if (typeof value === 'string' && relevant) {
    const text = value.trim()
    if (text && !out.includes(text)) out.push(text.slice(0, 500))
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item) => issueMessages(item, key, out))
    return out
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([childKey, item]) => issueMessages(item, childKey, out))
  }
  return out
}

function validationMessages(resultResponse) {
  return flatResultStrings(resultResponse?.result)
    .filter((text) => /error|failed|invalid|reject|does not match|must have|not defined|not allowed|schema|ошиб|некоррект|обязател|не найден|не разреш/i.test(text))
    .slice(0, 8)
}

function normalizeSearchText(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim()
}

function productLink(product) {
  if (product?.link) return product.link
  if (product?.id) return `${KASPI_BASE}/shop/p/x-${encodeURIComponent(product.id)}/?c=${kaspi.DEFAULT_CITY}`
  return null
}

function publicProductView(product) {
  if (!product) return null
  return {
    id: String(product.id || ''),
    title: product.title || '',
    image: product.image || null,
    price: Number(product.price || 0),
    link: productLink(product),
  }
}

async function findPublishedProduct(store, product) {
  if (!store?.merchantId) return null
  const sku = String(product?.sku || '').trim()
  const title = normalizeSearchText(product?.title)
  const titleHead = title.split(' ').slice(0, 8).join(' ')
  const { products } = await kaspi.merchantProducts(store.merchantId, { maxPages: 10 })
  const found = products.find((item) => String(item.id) === sku)
    || products.find((item) => normalizeSearchText(item.title) === title)
    || products.find((item) => {
      const candidate = normalizeSearchText(item.title)
      return titleHead && titleHead.length > 18 && (candidate.includes(titleHead) || title.includes(candidate.split(' ').slice(0, 8).join(' ')))
    })
  return publicProductView(found)
}

function recommendationFor(reason = '') {
  const text = String(reason).toLowerCase()
  if (/category|категор/.test(text)) return 'Укажите код категории из справочника Kaspi, а не произвольное название.'
  if (/brand|бренд|manufacturer/.test(text)) return 'Проверьте написание бренда. Для товара без бренда используйте допустимое Kaspi значение из схемы категории.'
  if (/attribute|характерист|атрибут|property/.test(text)) return 'Заполните обязательные характеристики выбранной категории и используйте их точные коды Kaspi.'
  if (/image|photo|картин|фото|url/.test(text)) return 'Проверьте, что ссылки на фото открываются без авторизации, и оставьте только изображения самого товара.'
  if (/sku|артикул|code/.test(text)) return 'Задайте уникальный SKU без лишних пробелов и повторите публикацию.'
  if (/price|цен/.test(text)) return 'Проверьте цену: она должна быть положительной и соответствовать требованиям категории.'
  if (/warehouse|storeid|склад|availab/.test(text)) return 'Укажите действующий ID склада из кабинета Kaspi и положительный остаток.'
  if (/pre.?order|предзаказ|delivery|достав/.test(text)) return 'Проверьте срок доставки предзаказа и настройки доставки выбранного склада.'
  if (/token|401|403|авториза|магазин.*отключ/.test(text)) return 'Подключите нужный магазин и его API-токен, затем откройте карточку, выберите этот магазин и опубликуйте повторно.'
  return 'Откройте карточку, сверьте категорию, бренд и обязательные характеристики со схемой Kaspi, затем отправьте повторно.'
}

function importView(row) {
  if (!row) return null
  const product = row.products?.[0] || {}
  const statusResponse = row.kaspiStatus || null
  const resultResponse = row.kaspiResult || null
  const item = resultItem(resultResponse, product.sku)
  const statusCode = String(statusResponse?.status || row.status || '').toUpperCase()
  const resultState = String(item?.state || resultResponse?.state || '').toUpperCase()
  const errors = Number(resultResponse?.errors || 0)
  const skipped = Number(resultResponse?.skipped || 0)
  const validation = validationMessages(resultResponse)
  const messages = issueMessages({ localError: row.localError, details: row.errorDetails, result: resultResponse }).concat(validation)
  const rawReason = messages.join(' ') || (errors || skipped ? `Kaspi отклонил товар: ошибок ${errors}, пропущено ${skipped}.` : '')
  const connectionReason = row.syncError === 'store_not_found'
    ? 'Подключённый ранее магазин отключён от платформы.'
    : row.syncError === 'no_token'
      ? 'API-токен магазина отключён, поэтому статус Kaspi проверить нельзя.'
      : row.syncError === 'token_failed'
        ? 'Kaspi отклонил API-токен магазина.'
        : null
  const rejected = !!row.localError || !!connectionReason || errors > 0 || skipped > 0 || validation.length > 0 || /ERROR|FAILED|REJECT|CANCEL|INVALID/.test(`${statusCode} ${resultState}`)
  const importFinished = !rejected && !!resultResponse && errors === 0 && skipped === 0 && /FINISHED|SUCCESS|PUBLISHED|COMPLETED/.test(`${statusCode} ${resultState}`)
  const publishedProduct = publicProductView(row.publishedProduct)
  const published = importFinished && !!publishedProduct?.link
  const state = rejected ? 'rejected' : published ? 'published' : importFinished ? 'verifying' : 'processing'
  const reason = rejected ? (connectionReason || rawReason || 'Kaspi не принял товар. Детальная причина не была передана.') : null
  return {
    id: row.id,
    code: row.code || null,
    state,
    technicalStatus: resultState || statusCode || null,
    reason,
    recommendation: rejected ? recommendationFor(reason) : null,
    productLink: publishedProduct?.link || null,
    publishedProduct,
    publicationCheckedAt: row.publicationCheckedAt || null,
    createdAt: row.createdAt,
    checkedAt: row.checkedAt || null,
    attempt: row.attempt || 1,
  }
}

/* Kaspi needs an hour to pull the feed, then puts unknown SKUs into
   «Нераспознанные товары → Без привязки». Only after that silence is it fair to tell
   the seller their товар is waiting to be linked by hand. */
const AWAITING_LINK_GRACE_MS = 2 * 60 * 60 * 1000

/**
 * Where the product actually is on the way to the shelf. The import state alone
 * only describes the card; the price list and the manual linking step are what
 * decide whether a buyer can order it.
 */
function preorderStage(productRow, importState, feedEntry, feed, onSale) {
  if (onSale) return 'on_sale'
  if (importState === 'rejected') return 'blocked'
  if (!feedEntry) return importState === 'draft' ? 'draft' : 'card_sent'
  if (!feedEntry.included) return 'blocked'
  const pulledAfterCreate = feed?.lastFetchAt && feed.lastFetchAt - (productRow.createdAt || 0) > AWAITING_LINK_GRACE_MS
  return pulledAfterCreate ? 'awaiting_link' : 'in_feed'
}

function preorderView(productRow, importRow, attempts, userId, feedContext = null) {
  const importedProduct = importRow?.products?.[0] || productRow.product?.draft || {}
  const parsed = productRow.product || {}
  const linkedStoreId = importRow?.storeId || productRow.preferredStoreId
  const store = linkedStoreId && find('stores', (row) => row.id === linkedStoreId && row.userId === userId)
  const firstImage = importedProduct.images?.[0]?.url || importedProduct.images?.[0] || parsed.images?.[0] || null
  const view = importView(importRow)
  const feedEntry = feedContext?.byProduct?.get(productRow.id) || null
  const stage = preorderStage(productRow, view?.state || 'draft', feedEntry, feedContext?.feed, view?.state === 'published')
  return {
    stage,
    cardLocked: cardLocked(userId, productRow),
    feed: {
      included: !!feedEntry?.included,
      issues: feedEntry?.issues || [],
      warehouses: feedEntry?.warehouses || [],
      lastFetchAt: feedContext?.feed?.lastFetchAt || null,
    },
    id: productRow.id,
    title: importedProduct.title || parsed.titleRu || parsed.title || importedProduct.sku || 'Товар Taobao',
    sku: importedProduct.sku || '',
    image: firstImage,
    price: Number(importedProduct.salePrice ?? importedProduct.price ?? parsed.priceKzt ?? 0) || 0,
    sourceUrl: parsed.sourceUrl || parsed.finalUrl || null,
    deliveryDays: normalizePreorderDays(importedProduct.deliveryDays),
    stock: importedProduct.stock ?? importedProduct.quantity ?? null,
    feedEnabled: importedProduct.feedEnabled !== false,
    store: store ? { id: store.id, name: store.name, merchantId: store.merchantId, hasToken: !!store.token } : null,
    import: view || {
      id: null,
      code: null,
      state: 'draft',
      technicalStatus: null,
      reason: null,
      recommendation: null,
      createdAt: null,
      checkedAt: null,
      attempt: 0,
    },
    attempts,
    createdAt: productRow.createdAt,
    updatedAt: importRow?.createdAt || productRow.updatedAt || productRow.createdAt,
  }
}

/** Feed state of every store once, so a list of N products stays a single pass. */
function feedContexts(userId) {
  const contexts = new Map()
  filter('stores', (row) => row.userId === userId).forEach((store) => {
    const context = feedContextForStore(userId, store.id)
    if (context) contexts.set(store.id, context)
  })
  return contexts
}

function contextFor(contexts, productRow, importRow) {
  return contexts.get(importRow?.storeId || productRow.preferredStoreId) || null
}

function listPreorders(userId) {
  const rows = filter('taobaoProducts', (row) => row.userId === userId)
  const imports = filter('imports', (row) => row.userId === userId && row.taobaoProductId)
  const latest = latestTaobaoImports(userId)
  const contexts = feedContexts(userId)
  const attemptCounts = imports.reduce((acc, row) => {
    acc[row.taobaoProductId] = (acc[row.taobaoProductId] || 0) + 1
    return acc
  }, {})
  const ordered = [...rows].sort((a, b) => {
    const aImported = latest.has(a.id) ? 1 : 0
    const bImported = latest.has(b.id) ? 1 : 0
    return bImported - aImported || (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
  })
  const seen = new Set()
  return ordered
    .filter((row) => {
      const identity = taobaoIdentity(row.product) || `row:${row.id}`
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
    .map((row) => preorderView(row, latest.get(row.id), attemptCounts[row.id] || 0, userId, contextFor(contexts, row, latest.get(row.id))))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

function preorderDetail(productRow, userId) {
  const imports = filter('imports', (row) => row.userId === userId && row.taobaoProductId === productRow.id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  const latest = imports[0] || null
  const fallback = latest?.products?.[0] || {}
  const product = mergeProduct(productRow, productRow.product?.draft || fallback)
  const storeId = latest?.storeId || productRow.preferredStoreId
  return {
    ...preorderView(productRow, latest, imports.length, userId, storeId ? feedContextForStore(userId, storeId) : null),
    product,
    storeId: latest?.storeId || productRow.preferredStoreId || null,
    source: {
      url: canonicalTaobaoUrl(productRow.product?.sourceUrl || productRow.product?.finalUrl) || null,
      title: productRow.product?.titleRu || productRow.product?.title || null,
    },
    history: imports.map(importView),
  }
}

async function syncImport(row, userId) {
  if (!row?.code) return row
  const store = find('stores', (item) => item.id === row.storeId && item.userId === userId)
  if (!store) return update('imports', row.id, { checkedAt: Date.now(), syncError: 'store_not_found' })
  if (!store.token) return update('imports', row.id, { checkedAt: Date.now(), syncError: 'no_token' })
  const [statusResult, importResult] = await Promise.allSettled([
    kaspi.merchantImportStatus(store.token, row.code),
    kaspi.merchantImportResult(store.token, row.code),
  ])
  const patch = { checkedAt: Date.now(), syncError: null }
  if (statusResult.status === 'fulfilled') {
    patch.kaspiStatus = statusResult.value
    patch.status = statusResult.value?.status || row.status
  }
  if (importResult.status === 'fulfilled') patch.kaspiResult = importResult.value
  if (statusResult.status === 'rejected' && importResult.status === 'rejected') {
    patch.syncError = statusResult.reason?.status === 401 ? 'token_failed' : 'kaspi_unavailable'
  }
  const draftRow = { ...row, ...patch }
  const view = importView(draftRow)
  if (view?.state === 'verifying') {
    patch.publicationCheckedAt = Date.now()
    try {
      patch.publishedProduct = await findPublishedProduct(store, draftRow.products?.[0] || {})
      patch.publicationCheckError = null
    } catch {
      patch.publicationCheckError = 'public_catalog_unavailable'
    }
  }
  return update('imports', row.id, patch)
}

function missingRequiredFields(product = {}) {
  return ['sku', 'title', 'brand', 'category'].filter((field) => !String(product[field] || '').trim())
    .concat(Number(product.salePrice ?? product.price) > 0 ? [] : ['price'])
}

/**
 * Kaspi: «не редактируйте карточку товара, иначе покупатели не смогут оформить на него
 * предзаказ. Используйте для этого прайс-лист». So a card goes out exactly once; after
 * that price, stock and lead time may only change through the feed. Re-sending is possible
 * only after an explicit unlock, which the seller confirms knowing the pre-order resets.
 */
export function cardLocked(userId, productRow) {
  const published = importsForProduct(userId, productRow.id).filter((row) => row.code)
  if (!published.length) return false
  const lastPublishedAt = Math.max(...published.map((row) => row.createdAt || 0))
  return (productRow.cardUnlockedAt || 0) <= lastPublishedAt
}

/**
 * Send the product card to Kaspi. Price, stock and pre-order days are not part
 * of this call — they reach Kaspi through the price-list feed (kaspi-feed.js),
 * which matches this card by SKU.
 * Shared by the HTTP routes and the auto-publish scheduler.
 */
export async function publishPreorderCard({ userId, productRow, storeId, sourceProduct, baseUrl }) {
  const store = find('stores', (row) => row.id === storeId && row.userId === userId)
  if (!store) return { ok: false, error: 'store_not_found', status: 404 }
  if (!store.token) return { ok: false, error: 'no_token', status: 400 }
  if (cardLocked(userId, productRow)) return { ok: false, error: 'card_locked', status: 409 }

  const product = mergeProduct(productRow, sourceProduct || {})
  const missing = missingRequiredFields(product)
  if (missing.length) return { ok: false, error: 'missing_product_fields', status: 400, missing, draft: product }

  const attempt = importsForProduct(userId, productRow.id).length + 1
  update('taobaoProducts', productRow.id, {
    product: { ...productRow.product, draft: product },
    preferredStoreId: store.id,
    draftEditedAt: Date.now(),
    updatedAt: Date.now(),
  })

  try {
    const result = await kaspi.merchantImportProducts(store.token, [productForKaspi(baseUrl, product)])
    const saved = insert('imports', {
      id: uid(), userId, storeId: store.id, taobaoProductId: productRow.id,
      code: result?.code || null, status: result?.status || null, products: [product], attempt, createdAt: Date.now(),
    })
    return { ok: true, store, product, attempt, import: saved, result }
  } catch (error) {
    const failed = insert('imports', {
      id: uid(), userId, storeId: store.id, taobaoProductId: productRow.id,
      code: null, status: 'FAILED', products: [product], attempt, localError: 'merchant_import_failed',
      errorDetails: error.data || { status: error.status || null }, createdAt: Date.now(), checkedAt: Date.now(),
    })
    return {
      ok: false,
      error: 'merchant_import_failed',
      status: error.status === 401 ? 401 : 502,
      kaspiStatus: error.status || null,
      details: error.data || null,
      attempt: importView(failed),
    }
  }
}

async function publishTaobaoProduct(req, res, { productRow, storeId, sourceProduct }) {
  const result = await publishPreorderCard({
    userId: req.user.id,
    productRow,
    storeId,
    sourceProduct,
    baseUrl: publicBaseUrl(req),
  })
  if (result.ok) {
    return res.json({
      ok: true,
      preorder: preorderView(productRow, result.import, result.attempt, req.user.id, feedContextForStore(req.user.id, storeId)),
      import: result.import,
      result: result.result,
    })
  }
  const body = { error: result.error }
  if (result.missing) Object.assign(body, { missing: result.missing, draft: result.draft })
  if (result.error === 'merchant_import_failed') Object.assign(body, { attempt: result.attempt, status: result.kaspiStatus, details: result.details })
  return res.status(result.status).json(body)
}

function bookmarklet(key, { endpoint, appUrl, appOrigin } = bookmarkletUrls({ get: () => null })) {
  const js = `(async()=>{const K=${JSON.stringify(key)},E=${JSON.stringify(endpoint)},A=${JSON.stringify(appUrl)},O=${JSON.stringify(appOrigin)},C=s=>(s||'').replace(/\\s+/g,' ').trim();try{const imgs=[...document.images].map(i=>i.currentSrc||i.src).filter(u=>/alicdn|taobao|tmall|tbcdn/i.test(u||''));const specs=[];document.querySelectorAll('li,span,p,div,dt,dd').forEach(el=>{const t=C(el.innerText);if(t.length<3||t.length>140)return;const m=t.match(/^([^:：]{1,36})[:：]\\s*(.{1,96})$/);if(m)specs.push({key:C(m[1]),value:C(m[2])});});const body=C(document.body.innerText);const pm=body.match(/[¥￥]\\s*([0-9]+(?:\\.[0-9]+)?)/);const p={sourceUrl:location.href,title:document.querySelector('meta[property="og:title"]')?.content||document.title,priceCny:pm?Number(pm[1]):0,images:[...new Set(imgs)].slice(0,30),specs:[...new Map(specs.map(s=>[s.key+'|'+s.value,s])).values()].slice(0,40)};const w=window.open(A+'?browser=1','_blank');if(!w)throw new Error('Разрешите всплывающие окна для Taobao');const m={type:'KX_TAOBAO_PAYLOAD',key:K,payload:p};let n=0;const send=()=>{try{w.postMessage(m,O)}catch(e){}if(++n>=24)clearInterval(timer)};const timer=setInterval(send,500);send();alert('Товар отправляется в Kaspi X-Ray. Если вкладка открылась, дождитесь загрузки товара.');}catch(e){alert('Не удалось отправить в Kaspi X-Ray: '+e.message+'\\nОткройте платформу на этом устройстве и создайте закладку заново.');}})()`
  return `javascript:${encodeURIComponent(js)}`
}

function validBrowserKey(key) {
  const row = find('taobaoKeys', (x) => x.key === key)
  if (!row) return null
  if (row.expiresAt < Date.now()) {
    remove('taobaoKeys', (x) => x.id === row.id)
    return null
  }
  return row
}

/** POST /api/taobao/browser-import — called from Taobao page bookmarklet. */
taobaoRouter.post('/browser-import', async (req, res) => {
  const key = String(req.body?.key || '')
  const keyRow = validBrowserKey(key)
  if (!keyRow) return res.status(401).json({ error: 'invalid_browser_key' })
  try {
    const product = await taobao.productFromBrowserPayload(req.body?.payload || {})
    const row = saveAnalyzedProduct(keyRow.userId, product)
    res.json({ product: publicProduct(row) })
  } catch (e) {
    const code = e.code || 'taobao_failed'
    res.status(code === 'bad_url' ? 400 : 502).json({ error: code, status: e.status || null })
  }
})

taobaoRouter.use(requireAuth)

/** POST /api/taobao/browser-key — bookmarklet parser for a logged-in browser. */
taobaoRouter.post('/browser-key', (req, res) => {
  remove('taobaoKeys', (x) => x.expiresAt < Date.now())
  const existing = find('taobaoKeys', (x) => x.userId === req.user.id)
  const expiresAt = Date.now() + BOOKMARKLET_TTL
  const row = existing
    ? update('taobaoKeys', existing.id, { expiresAt, touchedAt: Date.now() })
    : insert('taobaoKeys', { id: uid(), userId: req.user.id, key: randomBytes(24).toString('hex'), createdAt: Date.now(), expiresAt })
  res.json({ key: row.key, expiresAt: row.expiresAt, bookmarklet: bookmarklet(row.key, bookmarkletUrls(req)) })
})

/** POST /api/taobao/browser-payload — called by the app after bookmarklet postMessage. */
taobaoRouter.post('/browser-payload', async (req, res) => {
  try {
    const product = await taobao.productFromBrowserPayload(req.body?.payload || {})
    const row = saveAnalyzedProduct(req.user.id, product)
    res.json({ product: publicProduct(row) })
  } catch (e) {
    const code = e.code || 'taobao_failed'
    res.status(code === 'bad_url' ? 400 : 502).json({ error: code, status: e.status || null })
  }
})

/** GET /api/taobao/preorders — products already sent from Taobao to Kaspi. */
taobaoRouter.get('/preorders', (req, res) => {
  res.json({ preorders: listPreorders(req.user.id) })
})

/** GET /api/taobao/preorders/:id — editable preorder card. */
taobaoRouter.get('/preorders/:id', async (req, res) => {
  const row = find('taobaoProducts', (item) => item.id === req.params.id && item.userId === req.user.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  const latest = latestTaobaoImports(req.user.id).get(row.id)
  const state = latest ? importView(latest)?.state : null
  if (latest?.code && (state === 'processing' || state === 'verifying')) {
    await syncImport(latest, req.user.id).catch(() => null)
  }
  res.json({ preorder: preorderDetail(row, req.user.id) })
})

/** PUT /api/taobao/preorders/:id — save editable Kaspi draft. */
taobaoRouter.put('/preorders/:id', (req, res) => {
  const row = find('taobaoProducts', (item) => item.id === req.params.id && item.userId === req.user.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  const preferredStoreId = req.body?.storeId ? String(req.body.storeId) : row.preferredStoreId || null
  if (preferredStoreId && !find('stores', (item) => item.id === preferredStoreId && item.userId === req.user.id)) {
    return res.status(404).json({ error: 'store_not_found' })
  }
  const product = mergeProduct(row, req.body?.product || {})
  const retained = new Set(product.images.map((image) => image.url))
  removeUploadedImages(normalizeImages(row.product?.draft?.images || []).filter((image) => !retained.has(image.url)))
  update('taobaoProducts', row.id, {
    product: { ...row.product, draft: product },
    preferredStoreId,
    draftEditedAt: Date.now(),
    updatedAt: Date.now(),
  })
  res.json({ ok: true, preorder: preorderDetail(row, req.user.id) })
})

/** POST /api/taobao/preorders/:id/photos — upload a photo into the draft. */
taobaoRouter.post('/preorders/:id/photos', (req, res) => {
  const row = find('taobaoProducts', (item) => item.id === req.params.id && item.userId === req.user.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  try {
    const url = saveUploadedImage(req.body || {}, req.user.id)
    const current = mergeProduct(row, row.product?.draft || {})
    const product = mergeProduct(row, { ...current, images: [...current.images, { url }] })
    update('taobaoProducts', row.id, { product: { ...row.product, draft: product }, draftEditedAt: Date.now(), updatedAt: Date.now() })
    res.json({ ok: true, image: { url }, preorder: preorderDetail(row, req.user.id) })
  } catch (error) {
    const code = error.code || 'image_upload_failed'
    res.status(code === 'image_too_large' ? 413 : 400).json({ error: code })
  }
})

/** DELETE /api/taobao/preorders/:id — remove local draft and import history. */
taobaoRouter.delete('/preorders/:id', (req, res) => {
  const row = find('taobaoProducts', (item) => item.id === req.params.id && item.userId === req.user.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  removeUploadedImages(row.product?.draft?.images || [])
  const importsRemoved = remove('imports', (item) => item.userId === req.user.id && item.taobaoProductId === row.id)
  remove('taobaoProducts', (item) => item.id === row.id && item.userId === req.user.id)
  res.json({ ok: true, importsRemoved, kaspiUnaffected: true })
})

/** POST /api/taobao/preorders/refresh — sync current Kaspi import results. */
taobaoRouter.post('/preorders/refresh', async (req, res) => {
  const requested = Array.isArray(req.body?.ids) ? new Set(req.body.ids.map(String)) : null
  const latest = [...latestTaobaoImports(req.user.id).entries()]
    .filter(([productId, row]) => {
      const state = importView(row)?.state
      return (!requested || requested.has(productId)) && (state === 'processing' || state === 'verifying')
    })
    .slice(0, 20)
  await Promise.all(latest.map(([, row]) => syncImport(row, req.user.id)))
  res.json({ preorders: listPreorders(req.user.id), refreshed: latest.length })
})

/** POST /api/taobao/preorders/:id/retry — repeat the latest Kaspi publication. */
taobaoRouter.post('/preorders/:id/retry', async (req, res) => {
  const productRow = find('taobaoProducts', (row) => row.id === req.params.id && row.userId === req.user.id)
  if (!productRow) return res.status(404).json({ error: 'not_found' })
  const attempts = importsForProduct(req.user.id, productRow.id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  const previous = attempts[0]
  if (!previous) return res.status(400).json({ error: 'no_previous_import' })

  // The card is already live: re-sending it would drop the pre-order. Save the draft
  // instead — Kaspi picks the new price and stock up from the feed within the hour.
  if (cardLocked(req.user.id, productRow)) {
    const product = mergeProduct(productRow, req.body?.product || previous.products?.[0] || {})
    update('taobaoProducts', productRow.id, {
      product: { ...productRow.product, draft: product },
      draftEditedAt: Date.now(),
      updatedAt: Date.now(),
    })
    return res.json({ ok: true, via: 'feed', preorder: preorderDetail(productRow, req.user.id) })
  }

  const storeId = req.body?.storeId || previous.storeId
  return publishTaobaoProduct(req, res, {
    productRow,
    storeId,
    sourceProduct: req.body?.product || previous.products?.[0] || {},
  })
})

/**
 * POST /api/taobao/preorders/:id/unlock-card — allow one more card publication.
 * Kaspi resets the pre-order when a card is edited, so this is deliberate and one-shot:
 * the lock re-engages as soon as the next card actually goes out.
 */
taobaoRouter.post('/preorders/:id/unlock-card', (req, res) => {
  const productRow = find('taobaoProducts', (row) => row.id === req.params.id && row.userId === req.user.id)
  if (!productRow) return res.status(404).json({ error: 'not_found' })
  update('taobaoProducts', productRow.id, { cardUnlockedAt: Date.now(), updatedAt: Date.now() })
  res.json({ ok: true, preorder: preorderDetail(productRow, req.user.id) })
})

/** GET /api/taobao/:id — load a parsed product. */
taobaoRouter.get('/:id', (req, res, next) => {
  if (req.params.id === 'browser-key' || req.params.id === 'analyze') return next()
  const row = find('taobaoProducts', (x) => x.id === req.params.id && x.userId === req.user.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json({ product: publicProduct(row) })
})

/** POST /api/taobao/analyze { url, shippingCny, markupPct, rate } */
taobaoRouter.post('/analyze', async (req, res) => {
  try {
    const product = await taobao.parseTaobao(req.body?.url, {
      shippingCny: req.body?.shippingCny,
      markupPct: req.body?.markupPct,
      rate: req.body?.rate,
    })
    const row = saveAnalyzedProduct(req.user.id, product)
    res.json({ product: publicProduct(row) })
  } catch (e) {
    const code = e.code || 'taobao_failed'
    const status = code === 'bad_url' ? 400 : code === 'taobao_blocked' ? 502 : 502
    res.status(status).json({ error: code, status: e.status || null })
  }
})

/** GET /api/taobao/:id/images.zip */
taobaoRouter.get('/:id/images.zip', async (req, res) => {
  const row = find('taobaoProducts', (x) => x.id === req.params.id && x.userId === req.user.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  const urls = row.product?.images || []
  const files = []
  for (let i = 0; i < Math.min(urls.length, 20); i++) {
    try {
      const img = await taobao.fetchImage(urls[i])
      if (!img?.data?.length) continue
      files.push({ name: `taobao-${String(i + 1).padStart(2, '0')}.${extFromContentType(img.contentType)}`, data: img.data })
    } catch {
      /* skip failed image */
    }
  }
  if (!files.length) return res.status(502).json({ error: 'images_unavailable' })
  const zip = makeZip(files)
  res.setHeader('content-type', 'application/zip')
  res.setHeader('content-disposition', `attachment; filename="taobao-${row.product?.productId || row.id}.zip"`)
  res.send(zip)
})

/** POST /api/taobao/:id/import { storeId, product } */
taobaoRouter.post('/:id/import', async (req, res) => {
  const row = find('taobaoProducts', (x) => x.id === req.params.id && x.userId === req.user.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  return publishTaobaoProduct(req, res, {
    productRow: row,
    storeId: req.body?.storeId,
    sourceProduct: req.body?.product || {},
  })
})
