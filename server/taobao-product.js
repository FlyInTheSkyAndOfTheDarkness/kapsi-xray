import { createHash } from 'node:crypto'

export const DEFAULT_PREORDER_DAYS = 14
export const MAX_PREORDER_DAYS = 30

/* Kaspi price list: «Артикул может содержать цифры и латинские буквы.
   Максимальная длина — 20 символов. Артикул должен быть уникальным для каждого
   товара». A hyphen or a Cyrillic letter here means Kaspi cannot match the offer
   to its card, so the SKU is normalized in one place and used everywhere. */
export const MAX_SKU_LENGTH = 20

export function kaspiSku(value, seed = '') {
  const clean = String(value ?? '').replace(/[^A-Za-z0-9]/g, '')
  if (clean) return clean.slice(0, MAX_SKU_LENGTH)
  const source = String(seed || '').trim()
  if (!source) return ''
  return `TB${createHash('sha1').update(source).digest('hex').slice(0, MAX_SKU_LENGTH - 2)}`
}

/* Kaspi: «Напишите "Без бренда", если для продажи товара не нужно получать
   разрешение на торговлю». Goods from Taobao/1688 are usually unbranded and an
   empty <brand> is rejected. */
export const NO_BRAND = 'Без бренда'

export function normalizePreorderDays(value) {
  const days = Number(value)
  return Number.isFinite(days) && days > 0 ? Math.min(MAX_PREORDER_DAYS, Math.round(days)) : DEFAULT_PREORDER_DAYS
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
    .replace(/\s+(?:[-–—|]\s*)?(?:detail\.)?1688\.com\s*$/i, '')
    .replace(/\s+[-–—|]\s*(?:taobao|tmall|1688)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function canonicalTaobaoUrl(value) {
  try {
    const url = new URL(String(value || ''))
    const offerId = url.searchParams.get('offerId') || url.pathname.match(/\/offer\/(\d{6,})\.html/i)?.[1]
    const id = url.searchParams.get('id') || url.searchParams.get('itemId') || offerId
    const host = url.hostname.toLowerCase()
    if (id && (host === '1688.com' || host.endsWith('.1688.com'))) return `https://detail.1688.com/offer/${encodeURIComponent(id)}.html`
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

/* Kaspi wants photographs. An SVG swept off the offer page comes back from the
   import API as «Image ... has no data», so it is dropped here rather than at
   import — that way drafts saved before this check are cleaned up too. */
const VECTOR_IMAGE_RE = /\.svgz?(?:$|[?#])/i

function normalizedImageUrl(image) {
  const value = String(typeof image === 'string' ? image : image?.url || '').trim()
  if (VECTOR_IMAGE_RE.test(value)) return null
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
