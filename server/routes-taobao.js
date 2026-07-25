import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { requireAuth } from './auth.js'
import { filter, find, insert, remove, update, uid } from './db.js'
import * as taobao from './taobao.js'
import * as kaspi from './kaspi.js'
import { makeZip } from './zip.js'
import { removeUploadedImages, saveUploadedImage } from './uploads.js'
import { applyPreorder, canonicalTaobaoUrl, isPlatformMetadata, kaspiSku, MAX_PREORDER_DAYS, NO_BRAND, normalizeImages, normalizePreorderDays, sanitizeDescription, sanitizeProductTitle } from './taobao-product.js'
import { ensurePriceListFeedKey, preorderPriceListSummary } from './kaspi-price-list.js'
import { suggestKaspiAttributes } from './ai-attributes.js'
import { attributeLabelRu, loadClassificationAttributes, normalizeKaspiAttributeCode, validateClassificationAttributes } from './kaspi-classification.js'

export const taobaoRouter = Router()

const BOOKMARKLET_TTL = 1000 * 60 * 60 * 24 * 365
const KASPI_BASE = 'https://kaspi.kz'

function aiSettingFor(userId) {
  return find('aiSettings', (row) => row.userId === userId) || null
}

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
  const frontendOrigin = safeOrigin(process.env.PUBLIC_BASE_URL) || safeOrigin(req.get('origin')) || 'http://127.0.0.1:5175'
  const appUrl = `${frontendOrigin}/taobao`
  const api = new URL(frontendOrigin)
  if (/^517\d$/.test(api.port)) api.port = process.env.PORT || '8787'
  return {
    appUrl,
    appOrigin: frontendOrigin,
    endpoint: `${api.origin}/api/taobao/browser-import`,
  }
}

function mergeProduct(saved, bodyProduct = {}) {
  const draft = saved.product?.draft || {}
  const fallbackPrice = saved.product?.priceKzt || draft.salePrice || draft.price || 0
  const product = {
    ...draft,
    ...bodyProduct,
    attributes: Array.isArray(bodyProduct.attributes) ? bodyProduct.attributes : draft.attributes || [],
    images: normalizeImages(Array.isArray(bodyProduct.images) ? bodyProduct.images : draft.images || []),
  }
  // Card import and price-list feed must carry a byte-identical SKU, so it is
  // normalized here — the single place every draft passes through.
  product.sku = kaspiSku(product.sku, saved.id || saved.product?.productId || product.title)
  product.title = sanitizeProductTitle(product.title)
  product.brand = String(product.brand || '').trim() || NO_BRAND
  product.category = String(product.category || '').trim()
  product.description = sanitizeDescription(product.description)
  const salePrice = Math.max(0, Math.round(Number(product.salePrice ?? product.price ?? fallbackPrice) || 0))
  product.price = salePrice
  product.salePrice = salePrice
  product.stock = product.stock === '' || product.stock == null ? null : Math.max(0, Number(product.stock) || 0)
  product.quantity = product.stock == null ? product.quantity : product.stock
  const warehouses = Array.isArray(product.warehouses)
    ? product.warehouses
    : String(product.warehouses || '').split(/[,\n;]/).map((x) => x.trim()).filter(Boolean)
  product.warehouses = [...new Set(warehouses)].slice(0, 12)
  product.feedEnabled = product.feedEnabled !== false
  product.availabilities = product.warehouses.length && product.stock != null
    ? product.warehouses.map((storeId) => ({ storeId, available: product.stock > 0, stockCount: product.stock }))
    : []
  return applyPreorder(product)
}

function publicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return String(process.env.PUBLIC_BASE_URL).replace(/\/$/, '')
  const protocol = req.get('x-forwarded-proto') || req.protocol
  const host = req.get('x-forwarded-host') || req.get('host')
  return `${protocol}://${host}`
}

function cleanKaspiAttributeCode(value = '') {
  return normalizeKaspiAttributeCode(value)
}

function kaspiAttributes(product) {
  const seen = new Set()
  return (Array.isArray(product.attributes) ? product.attributes : [])
    .map((attribute, index) => ({ ...attribute, _uiIndex: index }))
    .filter((attribute) => !/^предзаказ$/i.test(String(attribute?.code || '').trim()))
    .filter((attribute) => !/^срок доставки/i.test(String(attribute?.code || '').trim()))
    .filter((attribute) => !isPlatformMetadata(attribute?.code, attribute?.value))
    .map((attribute) => ({ ...attribute, code: cleanKaspiAttributeCode(attribute?.code), value: String(attribute?.value ?? '').trim() }))
    .filter((attribute) => {
      if (!attribute.code || !attribute.value) return false
      const key = `${attribute.code.toLowerCase()}|${attribute.value.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

async function productForKaspi(req, store, product) {
  const base = publicBaseUrl(req)
  const images = normalizeImages(product.images).map((image) => ({
    url: image.url.startsWith('/') ? `${base}${image.url}` : image.url,
  }))
  const sourceAttributes = kaspiAttributes(product)
  let attributes = sourceAttributes.map(({ _uiIndex, ...attribute }) => attribute)
  let attributeDefinitions = []
  let attributeValidationIssues = []
  if (store?.token && /^Master\s*-/i.test(String(product.category || '').trim())) {
    attributeDefinitions = await loadClassificationAttributes(store.token, product.category)
    const validation = validateClassificationAttributes(sourceAttributes, attributeDefinitions)
    attributes = validation.attributes
    attributeValidationIssues = validation.issues
  }
  const payload = {
    sku: String(product.sku || '').trim(),
    title: sanitizeProductTitle(product.title),
    brand: String(product.brand || '').trim(),
    category: String(product.category || '').trim(),
    description: sanitizeDescription(product.description),
    attributes,
    images,
  }
  if (!payload.description) delete payload.description
  if (!payload.attributes.length) delete payload.attributes
  if (!payload.images.length) delete payload.images
  return { payload, attributeDefinitions, attributeValidationIssues }
}

function taobaoIdentity(product = {}) {
  const productId = String(product.productId || '').trim()
  if (productId) return `product:${productId}`
  const source = product.finalUrl || product.sourceUrl
  try {
    const url = new URL(String(source || ''))
    url.hash = ''
    const itemId = url.searchParams.get('id')
      || url.searchParams.get('itemId')
      || url.searchParams.get('offerId')
      || url.pathname.match(/\/offer\/(\d{6,})\.html/i)?.[1]
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

function attributeIssueAdvice(field, detail = '') {
  const text = String(detail || '').toLowerCase()
  if (field === 'code' && /regex|pattern|match/.test(text)) {
    return 'Код характеристики не проходит формат Kaspi. Удалите эту строку или выберите официальный код из выпадающего списка категории.'
  }
  if (field === 'code') return 'Код должен быть точным кодом из справочника Kaspi для выбранной категории.'
  if (/required|mandatory|обязател/.test(text)) return 'Заполните значение обязательной характеристики.'
  return 'Проверьте значение характеристики и используйте формат, который ожидает Kaspi.'
}

function fullAttributeIndex(productAttributes = [], target = {}, targetPosition = 0) {
  let matched = -1
  for (let index = 0, sentIndex = 0; index < productAttributes.length; index += 1) {
    const attribute = productAttributes[index]
    if (/^предзаказ$/i.test(String(attribute?.code || '').trim()) || /^срок доставки/i.test(String(attribute?.code || '').trim())) continue
    if (isPlatformMetadata(attribute?.code, attribute?.value)) continue
    const code = cleanKaspiAttributeCode(attribute?.code)
    const value = String(attribute?.value ?? '').trim()
    if (sentIndex === targetPosition) matched = index
    if (code === target.code && value === target.value) return index
    sentIndex += 1
  }
  return matched
}

function attributeIssues(messages = [], product = {}, sentAttributes = null) {
  const text = messages.join('\n')
  const attrs = Array.isArray(product.attributes) ? product.attributes : []
  const sentAttrs = Array.isArray(sentAttributes) && sentAttributes.length
    ? sentAttributes.map((attribute) => ({ ...attribute }))
    : kaspiAttributes(product)
  const issues = []
  const seen = new Set()
  const re = /(?:\$\[\d+\]\.)?attributes\[(\d+)\]\.(code|value)\s*:\s*([\s\S]*?)(?=(?:\s*\$\[\d+\]\.attributes\[\d+\]\.)|$)/gi
  for (const match of text.matchAll(re)) {
    const sentIndex = Number(match[1])
    const field = match[2]
    const detail = String(match[3] || '').replace(/\s+/g, ' ').trim().slice(0, 360)
    const attribute = sentAttrs[sentIndex] || {}
    const uiIndex = fullAttributeIndex(attrs, attribute, sentIndex)
    const key = `${sentIndex}|${field}|${attribute.code || ''}|${detail}`
    if (seen.has(key)) continue
    seen.add(key)
    issues.push({
      kind: field === 'code' ? 'unknown_code' : 'invalid_value',
      action: field === 'code' ? 'delete' : 'fill',
      path: `attributes[${sentIndex}].${field}`,
      index: sentIndex,
      uiIndex,
      field,
      code: attribute.code || '',
      value: attribute.value || '',
      labelRu: attributeLabelRu(attribute.code || ''),
      detail,
      advice: attributeIssueAdvice(field, detail),
    })
  }
  return issues.slice(0, 8)
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
  if (/attributes\[\d+\]\.code|does not match.*regex|regex pattern/.test(text)) return 'Kaspi отклонил код характеристики. Удалите подсвеченные строки или замените их точными кодами из справочника Kaspi.'
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
  const attrIssues = attributeIssues(messages, product, row.sentAttributes)
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
  const reason = rejected
    ? (connectionReason || (attrIssues.length
      ? `Исправьте характеристики товара: найдено ошибок ${attrIssues.length}. Откройте карточку — нужные поля будут подсвечены.`
      : rawReason || 'Kaspi не принял товар. Детальная причина не была передана.'))
    : null
  return {
    id: row.id,
    code: row.code || null,
    state,
    technicalStatus: resultState || statusCode || null,
    reason,
    technicalReason: rejected && rawReason && rawReason !== reason ? rawReason : null,
    recommendation: rejected ? recommendationFor(reason) : null,
    attributeIssues: attrIssues,
    productLink: publishedProduct?.link || null,
    publishedProduct,
    publicationCheckedAt: row.publicationCheckedAt || null,
    createdAt: row.createdAt,
    checkedAt: row.checkedAt || null,
    attempt: row.attempt || 1,
  }
}

/* Kaspi needs an hour to pull the feed and then drops unknown SKUs into
   «Нераспознанные товары → Без привязки». Only after that silence is it fair to
   tell the seller the product is waiting to be linked by hand. */
const AWAITING_LINK_GRACE_MS = 2 * 60 * 60 * 1000

/**
 * Where the product actually is on the way to the shelf. The import state alone
 * describes the card only; the price list and the manual linking step are what
 * decide whether a buyer can order it.
 */
function preorderStage(productRow, importState, priceList, store) {
  if (importState === 'published') return 'on_sale'
  if (importState === 'rejected') return 'blocked'
  const inFeed = priceList?.status === 'ready'
  if (!inFeed) return importState === 'draft' ? 'draft' : 'card_sent'
  const pulledAfterCreate = store?.priceListFetchedAt
    && store.priceListFetchedAt - (productRow.createdAt || 0) > AWAITING_LINK_GRACE_MS
  return pulledAfterCreate ? 'awaiting_link' : 'in_feed'
}

function preorderView(productRow, importRow, attempts, userId, req = null) {
  const importedProduct = importRow?.products?.[0] || productRow.product?.draft || {}
  const parsed = productRow.product || {}
  const linkedStoreId = importRow?.storeId || productRow.preferredStoreId
  const store = linkedStoreId && find('stores', (row) => row.id === linkedStoreId && row.userId === userId)
  const firstImage = importedProduct.images?.[0]?.url || importedProduct.images?.[0] || parsed.images?.[0] || null
  const view = importView(importRow)
  const priceList = store ? preorderPriceListSummary(req, store) : importRow?.priceList || null
  return {
    stage: preorderStage(productRow, view?.state || 'draft', priceList, store),
    cardLocked: cardLocked(userId, productRow),
    feedEnabled: importedProduct.feedEnabled !== false,
    id: productRow.id,
    title: importedProduct.title || parsed.titleRu || parsed.title || importedProduct.sku || (String(parsed.source || '').startsWith('1688') ? 'Товар 1688' : 'Товар Taobao'),
    sku: importedProduct.sku || '',
    image: firstImage,
    price: Number(importedProduct.salePrice ?? importedProduct.price ?? parsed.priceKzt ?? 0) || 0,
    sourceUrl: parsed.sourceUrl || parsed.finalUrl || null,
    deliveryDays: normalizePreorderDays(importedProduct.deliveryDays),
    stock: importedProduct.stock ?? importedProduct.quantity ?? null,
    store: store ? { id: store.id, name: store.name, merchantId: store.merchantId, hasToken: !!store.token } : null,
    priceList,
    import: view || {
      id: null,
      code: null,
      state: 'draft',
      technicalStatus: null,
      reason: null,
      recommendation: null,
      attributeIssues: [],
      createdAt: null,
      checkedAt: null,
      attempt: 0,
    },
    attempts,
    createdAt: productRow.createdAt,
    updatedAt: importRow?.createdAt || productRow.updatedAt || productRow.createdAt,
  }
}

function listPreorders(userId, req = null) {
  const rows = filter('taobaoProducts', (row) => row.userId === userId)
  const imports = filter('imports', (row) => row.userId === userId && row.taobaoProductId)
  const latest = latestTaobaoImports(userId)
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
    .map((row) => preorderView(row, latest.get(row.id), attemptCounts[row.id] || 0, userId, req))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

function preorderDetail(productRow, userId, req = null) {
  const imports = filter('imports', (row) => row.userId === userId && row.taobaoProductId === productRow.id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  const latest = imports[0] || null
  const fallback = latest?.products?.[0] || {}
  const product = mergeProduct(productRow, productRow.product?.draft || fallback)
  const linkedStoreId = latest?.storeId || productRow.preferredStoreId || null
  const linkedStore = linkedStoreId && find('stores', (row) => row.id === linkedStoreId && row.userId === userId)
  return {
    ...preorderView(productRow, latest, imports.length, userId, req),
    product,
    storeId: linkedStore?.id || null,
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
  const missing = ['sku', 'title', 'brand', 'category'].filter((field) => !String(product[field] || '').trim())
  const days = Number(product.deliveryDays ?? product.preorderDays ?? product.preOrderDays)
  if (!(Number(product.salePrice ?? product.price) > 0)) missing.push('price')
  if (!(Number(product.stock ?? product.quantity) > 0)) missing.push('stock')
  if (!Array.isArray(product.warehouses) || !product.warehouses.length) missing.push('warehouses')
  if (!Number.isFinite(days) || days < 1 || days > MAX_PREORDER_DAYS) missing.push('deliveryDays')
  if (!normalizeImages(product.images).length) missing.push('images')
  return missing
}

/**
 * Kaspi: «не редактируйте карточку товара, иначе покупатели не смогут оформить
 * на него предзаказ. Используйте для этого прайс-лист». So a card goes out once;
 * afterwards price, stock and lead time may only change through the feed.
 * Re-sending needs an explicit unlock, and the lock re-engages right after.
 */
export function cardLocked(userId, productRow) {
  const published = importsForProduct(userId, productRow.id).filter((row) => row.code)
  if (!published.length) return false
  return (productRow.cardUnlockedAt || 0) <= Math.max(...published.map((row) => row.createdAt || 0))
}

async function publishTaobaoProduct(req, res, { productRow, storeId, sourceProduct }) {
  const store = find('stores', (row) => row.id === storeId && row.userId === req.user.id)
  if (!store) return res.status(404).json({ error: 'store_not_found' })
  if (!store.token) return res.status(400).json({ error: 'no_token' })
  if (cardLocked(req.user.id, productRow)) return res.status(409).json({ error: 'card_locked' })
  ensurePriceListFeedKey(store)

  const product = mergeProduct(productRow, sourceProduct || {})
  const missing = missingRequiredFields(product)
  if (missing.length) return res.status(400).json({ error: 'missing_preorder_fields', missing, draft: product, maxPreorderDays: MAX_PREORDER_DAYS })
  if (!/^Master\s*-/i.test(String(product.category || '').trim())) {
    return res.status(400).json({
      error: 'bad_category',
      field: 'category',
      message: 'Выберите официальную категорию Kaspi из списка.',
    })
  }

  const attempt = importsForProduct(req.user.id, productRow.id).length + 1
  update('taobaoProducts', productRow.id, {
    product: { ...productRow.product, draft: product },
    preferredStoreId: store.id,
    draftEditedAt: Date.now(),
    updatedAt: Date.now(),
  })

  try {
    const { payload: kaspiProduct, attributeDefinitions, attributeValidationIssues } = await productForKaspi(req, store, product)
    if (attributeValidationIssues.length) {
      return res.status(400).json({
        error: 'attribute_validation_failed',
        issues: attributeValidationIssues,
        draft: product,
        mandatoryAttributes: attributeDefinitions.filter((attribute) => attribute.mandatory),
      })
    }
    const mandatoryAttributes = attributeDefinitions.filter((attribute) => attribute.mandatory)
    if (mandatoryAttributes.length && (!Array.isArray(kaspiProduct.attributes) || !kaspiProduct.attributes.length)) {
      return res.status(400).json({
        error: 'missing_preorder_fields',
        missing: ['attributes'],
        draft: product,
        mandatoryAttributes,
        maxPreorderDays: MAX_PREORDER_DAYS,
      })
    }
    const result = await kaspi.merchantImportProducts(store.token, [kaspiProduct])
    const saved = insert('imports', {
      id: uid(), userId: req.user.id, storeId: store.id, taobaoProductId: productRow.id,
      code: result?.code || null, status: result?.status || null, products: [product],
      sentAttributes: kaspiProduct.attributes || [], attempt, publicationMode: 'preorder_price_list', createdAt: Date.now(),
    })
    const priceList = preorderPriceListSummary(req, store)
    update('imports', saved.id, { priceList })
    saved.priceList = priceList
    return res.json({ ok: true, preorder: preorderView(productRow, saved, attempt, req.user.id, req), import: saved, result, priceList })
  } catch (error) {
    const failed = insert('imports', {
      id: uid(), userId: req.user.id, storeId: store.id, taobaoProductId: productRow.id,
      code: null, status: 'FAILED', products: [product], attempt, localError: 'merchant_import_failed',
      errorDetails: error.data || { status: error.status || null }, createdAt: Date.now(), checkedAt: Date.now(),
    })
    return res.status(error.status === 401 ? 401 : 502).json({
      error: 'merchant_import_failed',
      attempt: importView(failed),
      status: error.status || null,
      details: error.data || null,
    })
  }
}

function bookmarklet(key, { endpoint, appUrl, appOrigin } = bookmarkletUrls({ get: () => null })) {
  const cfg = JSON.stringify({ key, endpoint, appUrl, appOrigin })
  const js = `
(async()=>{
  const CFG=${cfg};
  const C=(s)=>String(s||'').replace(/\\s+/g,' ').trim();
  const U=(raw)=>{
    let u=String(raw||'').replace(/\\\\\\//g,'/').trim();
    if(!u)return '';
    if(/^img\\//i.test(u))u='https://cbu01.alicdn.com/'+u;
    if(u.startsWith('//'))u='https:'+u;
    if(u.startsWith('http://'))u='https://'+u.slice(7);
    try{const x=new URL(u,location.href);x.search='';return x.href}catch(e){return ''}
  };
  const at=(obj,path)=>path.split('.').reduce((acc,key)=>acc&&acc[key],obj);
  const deepFind=(root,names)=>{
    const wanted=new Set(names);
    const queue=[root].filter(Boolean);
    const seen=new Set();
    let steps=0;
    while(queue.length&&steps++<2500){
      const item=queue.shift();
      if(!item||typeof item!=='object'||seen.has(item))continue;
      seen.add(item);
      for(const [key,value] of Object.entries(item)){
        if(wanted.has(key)&&value!=null&&typeof value!=='object'&&C(value))return value;
        if(value&&typeof value==='object')queue.push(value);
      }
    }
    return '';
  };
  const scoreModel=(obj)=>{
    if(!obj||typeof obj!=='object')return 0;
    let score=0;
    if(C(obj.subject))score+=8;
    if(Array.isArray(obj.mainImageList))score+=5;
    if(obj.tradeModel)score+=4;
    if(obj.offerIDatacenterSellInfo)score+=4;
    if(Array.isArray(obj.skuProps))score+=3;
    if(C(obj.leafCategoryName))score+=2;
    return score;
  };
  const findModel=(root)=>{
    const starts=[
      at(root,'result.global.globalData.model'),
      at(root,'result.data.model'),
      at(root,'result.data'),
      at(root,'global.globalData.model'),
      root
    ].filter(Boolean);
    let best={},bestScore=0;
    const queue=[...starts];
    const seen=new Set();
    let steps=0;
    while(queue.length&&steps++<2500){
      const item=queue.shift();
      if(!item||typeof item!=='object'||seen.has(item))continue;
      seen.add(item);
      const score=scoreModel(item);
      if(score>bestScore){best=item;bestScore=score}
      Object.values(item).forEach((value)=>{if(value&&typeof value==='object')queue.push(value)});
    }
    return bestScore?best:(starts[0]||{});
  };
  const addSpec=(list,key,value)=>{
    key=C(key).replace(/[:：]+$/,'');
    value=C(value);
    if(!key||!value||key.length>60||value.length>180)return;
    if(/http|img|script|style|function|undefined|null/i.test(key+value))return;
    list.push({key,value});
  };
  const addImage=(set,raw)=>{
    const url=U(raw);
    if(url&&/alicdn|taobao|tmall|tbcdn|1688/i.test(url))set.add(url);
  };
  const collectImages=(set,obj)=>{
    const queue=[obj].filter(Boolean);
    const seen=new Set();
    let steps=0;
    while(queue.length&&steps++<1500&&set.size<40){
      const item=queue.shift();
      if(!item)return;
      if(typeof item==='string'){addImage(set,item);continue}
      if(typeof item!=='object'||seen.has(item))continue;
      seen.add(item);
      Object.entries(item).forEach(([key,value])=>{
        if(/image|img|pic|uri|url/i.test(key))addImage(set,value);
        if(value&&typeof value==='object')queue.push(value);
      });
    }
  };
  const priceValue=(value)=>{
    if(typeof value==='number')return value;
    const match=String(value||'').match(/([0-9]+(?:\\.[0-9]+)?)/);
    return match?Number(match[1]):0;
  };
  try{
    const root=window.context||window.__INIT_DATA__||window.__INITIAL_STATE__||{};
    const model=findModel(root);
    const sellerNames=[
      at(model,'sellerModel.companyName'),
      at(model,'sellerModel.shopName'),
      at(model,'sellerModel.loginId'),
      deepFind(root,['companyName','shopName','loginId'])
    ].map(C).filter(Boolean);
    const subject=C(model.subject||deepFind(root,['subject','offerTitle','productTitle']));
    const titleCandidates=[
      subject,
      C(model.offerTitle||model.title),
      C(at(model,'offerBaseInfo.subject')),
      C(document.querySelector('meta[property="og:title"]')?.content),
      C(document.querySelector('h1')?.innerText),
      C(document.title)
    ];
    let title=titleCandidates.find((item)=>item&&!sellerNames.includes(item))||titleCandidates.find(Boolean)||'';
    if(sellerNames.includes(title)&&subject)title=subject;
    const imgs=new Set();
    collectImages(imgs,model.mainImageList||model);
    collectImages(imgs,model.skuProps||[]);
    [...document.images].forEach((img)=>[img.currentSrc,img.src,img.dataset&&img.dataset.src,img.dataset&&img.dataset.lazyload].forEach((value)=>addImage(imgs,value)));
    [...document.querySelectorAll('[style]')].forEach((el)=>addImage(imgs,(el.getAttribute('style')||'').match(/url\\(["']?([^"')]+)["']?\\)/)?.[1]));
    const specs=[];
    addSpec(specs,'类目',model.leafCategoryName||deepFind(root,['leafCategoryName']));
    Object.entries(model.offerIDatacenterSellInfo||{}).forEach(([key,value])=>addSpec(specs,key,value));
    (Array.isArray(model.skuProps)?model.skuProps:[]).forEach((prop)=>{
      const values=(Array.isArray(prop.value)?prop.value:[]).map((item)=>C(item&&item.name)).filter(Boolean);
      if(values.length)addSpec(specs,prop.prop,[...new Set(values)].slice(0,8).join(', '));
    });
    document.querySelectorAll('li,span,p,div,dt,dd').forEach((el)=>{
      const text=C(el.innerText);
      if(text.length<3||text.length>180)return;
      const match=text.match(/^([^:：]{1,42})[:：]\\s*(.{1,120})$/);
      if(match)addSpec(specs,match[1],match[2]);
    });
    const body=C(document.body.innerText);
    const priceCandidates=[
      at(model,'tradeModel.priceDisplay'),
      at(model,'tradeModel.minPrice'),
      at(model,'tradeModel.offerMinPrice'),
      at(model,'tradeModel.offerPriceModel.currentPrices.0.price'),
      deepFind(root,['priceDisplay','minPrice','offerMinPrice','priceText']),
      (body.match(/[¥￥]\\s*([0-9]+(?:\\.[0-9]+)?)/)||[])[1]
    ];
    const priceCny=priceCandidates.map(priceValue).find((n)=>n>0&&n<1000000)||0;
    const L=new URL(location.href);
    const id=L.searchParams.get('id')||L.searchParams.get('itemId')||L.searchParams.get('offerId')||(L.pathname.match(/\\/offer\\/(\\d{6,})\\.html/i)||[])[1]||C(model.offerId||model.offerID||deepFind(root,['offerId','offerID']));
    const dedupSpecs=[...new Map(specs.filter((s)=>s.key&&s.value).map((s)=>[s.key+'|'+s.value,s])).values()].slice(0,40);
    const p={sourceUrl:location.href,productId:id,title,subject,sellerName:sellerNames[0]||'',priceCny,images:[...imgs].slice(0,30),specs:dedupSpecs};
    try{
      const r=await fetch(CFG.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:CFG.key,payload:p}),credentials:'omit'});
      if(r.ok){
        const j=await r.json(),pid=j&&j.product&&j.product.id;
        window.open(CFG.appUrl+(pid?'?import='+encodeURIComponent(pid):'?browser=1'),'_blank');
        alert('Товар отправлен в Kaspi X-Ray.');
        return;
      }
    }catch(e){}
    const m={type:'KX_TAOBAO_PAYLOAD',key:CFG.key,payload:p};
    const w=window.open(CFG.appUrl+'?browser=1&handoff=1','_blank');
    if(!w)throw new Error('Разрешите всплывающие окна для Taobao/1688');
    try{w.name='KX_TAOBAO_PAYLOAD:'+encodeURIComponent(JSON.stringify(m))}catch(e){}
    let n=0;
    const send=()=>{try{w.postMessage(m,CFG.appOrigin)}catch(e){}if(++n>=120)clearInterval(timer)};
    const timer=setInterval(send,500);
    send();
    alert('Товар отправляется в Kaspi X-Ray. Если вкладка открылась, дождитесь загрузки товара.');
  }catch(e){
    alert('Не удалось отправить в Kaspi X-Ray: '+e.message+'\\nОткройте платформу на этом устройстве и создайте закладку заново.');
  }
})()`
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
  res.json({ preorders: listPreorders(req.user.id, req) })
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
  res.json({ preorder: preorderDetail(row, req.user.id, req) })
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
  res.json({ ok: true, preorder: preorderDetail(row, req.user.id, req) })
})

/** POST /api/taobao/preorders/:id/ai-attributes — suggest required Kaspi attribute values. */
taobaoRouter.post('/preorders/:id/ai-attributes', async (req, res) => {
  const row = find('taobaoProducts', (item) => item.id === req.params.id && item.userId === req.user.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  const settings = aiSettingFor(req.user.id) || {}
  const provider = ['openai', 'gemini'].includes(req.body?.provider) ? req.body.provider : settings.provider || 'openai'
  const apiKey = provider === 'gemini'
    ? settings.geminiKey || process.env.GEMINI_API_KEY
    : settings.openaiKey || process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(400).json({ error: 'ai_not_configured', provider })
  const attributes = Array.isArray(req.body?.attributes) ? req.body.attributes : []
  if (!attributes.length) return res.status(400).json({ error: 'no_attributes' })
  const draft = mergeProduct(row, req.body?.product || row.product?.draft || {})
  try {
    const result = await suggestKaspiAttributes({
      provider,
      apiKey,
      userId: req.user.id,
      product: { ...row.product, ...draft, draft, specs: row.product?.specs || [] },
      attributes,
    })
    res.json({ ok: true, provider, ...result })
  } catch (error) {
    const code = error.code || 'ai_attributes_failed'
    res.status(error.status || 502).json({ error: code, details: error.details || null })
  }
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
    res.json({ ok: true, image: { url }, preorder: preorderDetail(row, req.user.id, req) })
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
  res.json({ preorders: listPreorders(req.user.id, req), refreshed: latest.length })
})

/** POST /api/taobao/preorders/:id/retry — repeat the latest Kaspi publication. */
taobaoRouter.post('/preorders/:id/retry', async (req, res) => {
  const productRow = find('taobaoProducts', (row) => row.id === req.params.id && row.userId === req.user.id)
  if (!productRow) return res.status(404).json({ error: 'not_found' })
  const attempts = importsForProduct(req.user.id, productRow.id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  const previous = attempts[0]
  if (!previous) return res.status(400).json({ error: 'no_previous_import' })

  // The card is already live: re-sending it would drop the pre-order. Save the
  // draft instead — Kaspi reads the new price and stock from the feed.
  if (cardLocked(req.user.id, productRow)) {
    const product = mergeProduct(productRow, req.body?.product || previous.products?.[0] || {})
    update('taobaoProducts', productRow.id, {
      product: { ...productRow.product, draft: product },
      draftEditedAt: Date.now(),
      updatedAt: Date.now(),
    })
    return res.json({ ok: true, via: 'feed', preorder: preorderDetail(productRow, req.user.id, req) })
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
 * Deliberate and one-shot: Kaspi resets the pre-order when a card is edited.
 */
taobaoRouter.post('/preorders/:id/unlock-card', (req, res) => {
  const productRow = find('taobaoProducts', (row) => row.id === req.params.id && row.userId === req.user.id)
  if (!productRow) return res.status(404).json({ error: 'not_found' })
  update('taobaoProducts', productRow.id, { cardUnlockedAt: Date.now(), updatedAt: Date.now() })
  res.json({ ok: true, preorder: preorderDetail(productRow, req.user.id, req) })
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
  const prefix = String(row.product?.source || '').startsWith('1688') ? '1688' : 'taobao'
  const files = []
  for (let i = 0; i < Math.min(urls.length, 20); i++) {
    try {
      const img = await taobao.fetchImage(urls[i])
      if (!img?.data?.length) continue
      files.push({ name: `${prefix}-${String(i + 1).padStart(2, '0')}.${extFromContentType(img.contentType)}`, data: img.data })
    } catch {
      /* skip failed image */
    }
  }
  if (!files.length) return res.status(502).json({ error: 'images_unavailable' })
  const zip = makeZip(files)
  res.setHeader('content-type', 'application/zip')
  res.setHeader('content-disposition', `attachment; filename="${prefix}-${row.product?.productId || row.id}.zip"`)
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
