import { clampPreorderDays, kaspiSku, sanitizeStoreIds } from './kaspi-feed.js'

export const DEFAULT_PREORDER_DAYS = 14

/* Kaspi: «Напишите "Без бренда", если для продажи товара не нужно получать разрешение
   на торговлю». Товары с Taobao/1688 обычно безбрендовые, а пустой <brand> Kaspi
   не принимает, поэтому подставляем это значение вместо пустого. */
export const NO_BRAND = 'Без бренда'

/** Kaspi caps pre-orders at 30 days, so drafts are clamped at the source. */
export function normalizePreorderDays(value) {
  const days = Number(value)
  return Number.isFinite(days) && days > 0 ? clampPreorderDays(days) : DEFAULT_PREORDER_DAYS
}

function attributeName(attribute = {}) {
  return String(attribute.code || attribute.key || attribute.name || '').trim().toLowerCase()
}

export function upsertAttribute(attributes = [], code, value, aliases = []) {
  const keys = new Set([code, ...aliases].map((key) => String(key).trim().toLowerCase()))
  const index = attributes.findIndex((attribute) => keys.has(attributeName(attribute)))
  const next = { code, value }
  if (index < 0) return [...attributes, next]
  return attributes.map((attribute, itemIndex) => (itemIndex === index ? { ...attribute, ...next } : attribute))
}

const PLATFORM_METADATA_RE = /许可证|备案|营业执照|营业性演出|出版物|增值电信|网络食品|网络订餐|短消息|广播电视|网络交易|医疗器械|药品网络|统一社会信用|隐私政策|消费者热线|客服|倍速|视频|图集|лиценз|регистрац|телеком|сторонн.{0,12}платформ|коммерческ.{0,8}деятельност|аудиовизуальн|коротк.{0,8}сообщен|медицинск.{0,12}оборудован|куплен|покупател|отзыв|параметр\s*00|двойн.{0,8}скорост|галере.{0,8}видео|\b\d{1,2}\s*\/\s*\d{1,2}:\d{2}\b|already purchased|purchased|already enjoyed|gift money|people buy|exclusive heavenly|\brecommend\s+\d|copyright|license|permit|registration|已购|买家|评价|评论|追评/i

export function isPlatformMetadata(code, value = '') {
  return PLATFORM_METADATA_RE.test(`${String(code || '').trim()} ${String(value || '').trim()}`)
}

export function sanitizeProductTitle(value) {
  return String(value || '')
    .replace(/\s+(?:[-–—|]\s*)?(?:table-)?tmall\.com(?:\s+tmall)?\s*$/i, '')
    .replace(/\s+[-–—|]\s*(?:taobao|tmall)\s*$/i, '')
    .replace(/\s*[-–—|]\s*(?:1688\.com|阿里巴巴)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function canonicalTaobaoUrl(value) {
  try {
    const url = new URL(String(value || ''))
    const id = url.searchParams.get('id') || url.searchParams.get('itemId')
    url.hash = ''
    url.search = ''
    if (id) url.searchParams.set('id', id)
    return url.toString()
  } catch {
    return String(value || '').trim()
  }
}

export function sanitizeDescription(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => {
      const clean = sanitizeProductTitle(line.trim())
      const source = clean.match(/^Источник:\s*(https?:\/\/\S+)/i)
      return source ? `Источник: ${canonicalTaobaoUrl(source[1])}` : clean
    })
    .filter((line) => !line || !isPlatformMetadata(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function normalizeAttributes(attributes = [], limit = 80) {
  if (!Array.isArray(attributes)) return []
  const seen = new Set()
  return attributes.map((attribute) => {
    const code = String(attribute?.code || attribute?.key || attribute?.name || '').trim()
    const value = String(attribute?.value ?? '').trim()
    const variantNoise = /^\d{1,2}$/.test(code) && /^\d+\s+(?:gradient|straight|double|scale|shock)/i.test(value)
    return code && value && !variantNoise && !isPlatformMetadata(code, value) ? { code, value } : null
  }).filter((attribute) => {
    if (!attribute) return false
    const identity = `${attribute.code.toLowerCase()}|${attribute.value.toLowerCase()}`
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  }).slice(0, limit)
}

function normalizedImageUrl(image) {
  const value = String(typeof image === 'string' ? image : image?.url || '').trim()
  if (/^\/uploads\/[a-zA-Z0-9._-]+$/.test(value)) return value
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

export function normalizeImages(images = [], limit = 30) {
  if (!Array.isArray(images)) return []
  const seen = new Set()
  return images.map((image) => normalizedImageUrl(image)).filter((url) => {
    if (!url || seen.has(url)) return false
    seen.add(url)
    return true
  }).slice(0, limit).map((url) => ({ url }))
}

export function preorderFields(value = DEFAULT_PREORDER_DAYS) {
  const days = normalizePreorderDays(value)
  return {
    preorder: true,
    preOrder: true,
    isPreorder: true,
    isPreOrder: true,
    deliveryType: 'PREORDER',
    deliveryMode: 'PREORDER',
    fulfillmentType: 'PREORDER',
    deliveryDays: days,
    preorderDays: days,
    preOrderDays: days,
    deliveryPeriod: days,
    deliveryDuration: days,
  }
}

export function preorderDraftDefaults(days = DEFAULT_PREORDER_DAYS, stock = 10) {
  const quantity = Math.max(0, Math.round(Number(stock) || 0))
  return { ...preorderFields(days), stock: quantity, quantity }
}

export function applyPreorder(product = {}) {
  const days = normalizePreorderDays(product.deliveryDays ?? product.preorderDays ?? product.preOrderDays)
  let attributes = normalizeAttributes(product.attributes)
  attributes = upsertAttribute(attributes, 'Предзаказ', 'Да')
  attributes = upsertAttribute(attributes, 'Срок доставки предзаказа', `${days} дней`, ['Срок доставки'])
  return { ...product, ...preorderFields(days), attributes }
}

/**
 * The single Kaspi draft of a saved Taobao/1688 product: what the card import
 * sends and what the price-list feed publishes must come from here, otherwise
 * Kaspi cannot match the offer to the card by SKU.
 */
export function mergeProduct(saved = {}, bodyProduct = {}) {
  const draft = saved.product?.draft || {}
  const fallbackPrice = saved.product?.priceKzt || draft.salePrice || draft.price || 0
  const product = {
    ...draft,
    ...bodyProduct,
    attributes: Array.isArray(bodyProduct.attributes) ? bodyProduct.attributes : draft.attributes || [],
    images: normalizeImages(Array.isArray(bodyProduct.images) ? bodyProduct.images : draft.images || []),
  }
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
  product.warehouses = sanitizeStoreIds(product.warehouses)
  product.feedEnabled = product.feedEnabled !== false
  product.availabilities = product.warehouses.length && product.stock != null
    ? product.warehouses.map((storeId) => ({ storeId, available: product.stock > 0, stockCount: product.stock }))
    : []
  return applyPreorder(product)
}
