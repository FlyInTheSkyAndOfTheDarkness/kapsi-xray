import { canonicalTaobaoUrl, isPlatformMetadata, preorderDraftDefaults, sanitizeProductTitle } from './taobao-product.js'
import { kaspiSku } from './kaspi-feed.js'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const CNY_RATE_FALLBACK = 72

let rateCache = { ts: 0, rate: CNY_RATE_FALLBACK }

const SPEC_KEY_RU = {
  颜色: 'Цвет',
  颜色分类: 'Цвет',
  尺码: 'Размер',
  尺寸: 'Размер',
  规格: 'Спецификация',
  品牌: 'Бренд',
  型号: 'Модель',
  货号: 'Артикул',
  材质: 'Материал',
  面料: 'Ткань',
  主要材质: 'Основной материал',
  适用性别: 'Пол',
  风格: 'Стиль',
  图案: 'Узор',
  产地: 'Страна производства',
  功能: 'Функция',
  适用年龄: 'Возраст',
  上市年份季节: 'Сезон',
  适用季节: 'Сезон',
  包装: 'Упаковка',
  重量: 'Вес',
}

const TEXT_RU = {
  黑色: 'черный',
  白色: 'белый',
  红色: 'красный',
  蓝色: 'синий',
  绿色: 'зеленый',
  黄色: 'желтый',
  紫色: 'фиолетовый',
  粉色: 'розовый',
  灰色: 'серый',
  银色: 'серебристый',
  金色: 'золотистый',
  棕色: 'коричневый',
  米色: 'бежевый',
  透明: 'прозрачный',
  男: 'мужской',
  女: 'женский',
  男女通用: 'унисекс',
  儿童: 'детский',
  棉: 'хлопок',
  涤纶: 'полиэстер',
  聚酯纤维: 'полиэстер',
  尼龙: 'нейлон',
  皮革: 'кожа',
  真皮: 'натуральная кожа',
  塑料: 'пластик',
  金属: 'металл',
  木: 'дерево',
  玻璃: 'стекло',
  简约: 'минимализм',
  休闲: 'повседневный',
  运动: 'спортивный',
  商务: 'деловой',
  卡通: 'мультяшный',
  纯色: 'однотонный',
  中国: 'Китай',
}

function cjk(s) {
  return /[\u3400-\u9fff]/.test(String(s || ''))
}

function decodeHtml(s = '') {
  return String(s)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function stripTags(s = '') {
  return decodeHtml(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function cleanText(s = '') {
  return stripTags(s).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

const SOURCE_DOMAINS = {
  taobao: ['taobao.com', 'tmall.com', 'tmall.hk', 'm.tb.cn', 'tb.cn'],
  '1688': ['1688.com'],
}

/** Marketplace this URL belongs to, or null when it is not one we support. */
export function sourceOfUrl(input) {
  let url
  try {
    url = new URL(String(input || '').trim())
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null
  const host = url.hostname.toLowerCase()
  const entry = Object.entries(SOURCE_DOMAINS)
    .find(([, domains]) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`)))
  return entry ? { source: entry[0], url: url.toString() } : null
}


async function fetchWithTimeout(url, opts = {}, timeoutMs = 18000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

export async function cnyKztRate() {
  if (Date.now() - rateCache.ts < 60 * 60 * 1000) return rateCache.rate
  try {
    const res = await fetchWithTimeout('https://open.er-api.com/v6/latest/CNY', { headers: { Accept: 'application/json' } }, 8000)
    const json = await res.json()
    const rate = Number(json?.rates?.KZT)
    if (rate > 0) rateCache = { ts: Date.now(), rate }
  } catch {
    /* keep fallback/cache */
  }
  return rateCache.rate
}

async function translateViaGoogle(text) {
  if (!text || !cjk(text)) return text
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=ru&dt=t&q=${encodeURIComponent(text)}`
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, 8000)
    if (!res.ok) return text
    const json = await res.json()
    return (json?.[0] || []).map((x) => x?.[0] || '').join('').trim() || text
  } catch {
    return text
  }
}

export async function translateZh(text) {
  const source = cleanText(text)
  if (!source) return ''
  if (SPEC_KEY_RU[source]) return SPEC_KEY_RU[source]
  if (TEXT_RU[source]) return TEXT_RU[source]
  let out = source
  Object.entries(TEXT_RU).forEach(([zh, ru]) => {
    out = out.replaceAll(zh, ru)
  })
  if (cjk(out)) out = await translateViaGoogle(out)
  return out
}

function extractId(url) {
  try {
    const u = new URL(url)
    return u.searchParams.get('id')
      || u.searchParams.get('itemId')
      // 1688 keeps the offer id in the path: /offer/123456789.html
      || (u.pathname.match(/\/offer\/(\d{6,})/) || [])[1]
      || (url.match(/(?:id=|itemId=)(\d{6,})/) || [])[1]
      || ''
  } catch {
    return ''
  }
}

function extractTitle(html) {
  const candidates = [
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1],
    html.match(/<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)/i)?.[1],
    html.match(/"title"\s*:\s*"([^"]{3,220})"/i)?.[1],
    html.match(/<title[^>]*>([\s\S]{3,260}?)<\/title>/i)?.[1],
  ].filter(Boolean).map(cleanText)
  return candidates.find((x) => x && !/淘宝网|登录|captcha|验证/i.test(x)) || ''
}

function extractPrice(html) {
  const patterns = [
    /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([\d.]+)/i,
    /"priceText"\s*:\s*"¥?\s*([\d.]+)\s*"/i,
    /"price"\s*:\s*"¥?\s*([\d.]+)\s*"/i,
    /"salePrice"\s*:\s*"¥?\s*([\d.]+)\s*"/i,
    /"reservePrice"\s*:\s*"¥?\s*([\d.]+)\s*"/i,
    /"priceRange"\s*:\s*"¥?\s*([\d.]+)/i,
    // 1688 offer pages
    /"beginAmount"\s*:\s*"?([\d.]+)/i,
    /"discountPrice"\s*:\s*"?¥?\s*([\d.]+)/i,
    /"currentPrices?"\s*:\s*"?¥?\s*([\d.]+)/i,
  ]
  for (const p of patterns) {
    const n = Number((html.match(p) || [])[1])
    if (n > 0 && n < 1000000) return n
  }
  return 0
}

function normalizeImageUrl(raw) {
  let u = decodeHtml(raw || '').replace(/\\/g, '')
  if (!u) return null
  if (u.startsWith('//')) u = `https:${u}`
  if (u.startsWith('http://')) u = `https://${u.slice(7)}`
  try {
    const url = new URL(u)
    if (!/\.(alicdn|taobao|tmall|tbcdn)\./i.test(url.hostname)) return null
    url.search = ''
    return url.toString()
  } catch {
    return null
  }
}

function extractImages(html) {
  const out = new Set()
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1]
  const ogUrl = normalizeImageUrl(og)
  if (ogUrl) out.add(ogUrl)
  // img/gw/imgextra serve Taobao & Tmall, cbu01…cbu04 serve 1688.
  const re = /(?:https?:)?\/\/[a-z0-9-]+\.alicdn\.com\/[^"'\\<>\s]+?\.(?:jpg|jpeg|png|webp)/ig
  for (const m of html.matchAll(re)) {
    const u = normalizeImageUrl(m[0])
    if (u) out.add(u)
    if (out.size >= 24) break
  }
  return [...out]
}

function addSpec(map, key, value) {
  const k = cleanText(key).replace(/[:：]+$/, '')
  const v = cleanText(value)
  if (!k || !v || k.length > 60 || v.length > 160) return
  if (!cjk(k) && !cjk(v)) return
  if (/http|img|script|style|function|undefined|null/i.test(k + v)) return
  if (isPlatformMetadata(k, v)) return
  map.set(k, v)
}

function extractSpecs(html) {
  const map = new Map()
  const decoded = decodeHtml(html)
  const pairs = [
    /"name"\s*:\s*"([^"]{1,60})"\s*,\s*"value"\s*:\s*"([^"]{1,160})"/g,
    /"key"\s*:\s*"([^"]{1,60})"\s*,\s*"value"\s*:\s*"([^"]{1,160})"/g,
    /"propName"\s*:\s*"([^"]{1,60})"\s*,\s*"valueName"\s*:\s*"([^"]{1,160})"/g,
    /"name"\s*:\s*"([^"]{1,60})"\s*,\s*"values"\s*:\s*\[\s*\{\s*"name"\s*:\s*"([^"]{1,160})"/g,
  ]
  pairs.forEach((re) => {
    for (const m of decoded.matchAll(re)) {
      addSpec(map, m[1], m[2])
      if (map.size >= 40) return
    }
  })
  const liRe = /<li[^>]*>\s*([^<：:]{1,40})\s*[：:]\s*([\s\S]{1,180}?)<\/li>/g
  for (const m of decoded.matchAll(liRe)) {
    addSpec(map, m[1], m[2])
    if (map.size >= 40) break
  }
  return [...map.entries()].slice(0, 32).map(([key, value]) => ({ key, value }))
}

const SKU_PREFIX = { taobao: 'TB', '1688': 'AL' }

/** Price-list safe SKU: latin letters and digits only, max 20 characters. */
function draftSku(source, productId) {
  return kaspiSku(`${SKU_PREFIX[source] || 'TB'}${productId || Date.now()}`)
}

function looksBlocked(url, html) {
  const s = `${url}\n${html.slice(0, 6000)}`
  return /login|captcha|验证码|滑块|访问受限|安全验证|punish|verify/i.test(s) && !/"price"|"title"|og:title/i.test(s)
}

export async function parseTaobao(input, { shippingCny = 0, markupPct = 0, rate: manualRate } = {}) {
  const detected = sourceOfUrl(input)
  if (!detected) {
    const e = new Error('BAD_TAOBAO_URL')
    e.code = 'bad_url'
    throw e
  }
  const { url, source } = detected
  const res = await fetchWithTimeout(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,ru;q=0.8,en;q=0.7',
    },
  })
  const html = await res.text()
  const finalUrl = res.url || url
  if (!res.ok || looksBlocked(finalUrl, html)) {
    const e = new Error('TAOBAO_BLOCKED')
    e.code = 'taobao_blocked'
    e.status = res.status
    throw e
  }
  const title = extractTitle(html)
  const priceCny = extractPrice(html)
  const specsRaw = extractSpecs(html)
  const images = extractImages(html)
  if (!title && !priceCny && !images.length) {
    const e = new Error('TAOBAO_PARSE_FAILED')
    e.code = 'parse_failed'
    throw e
  }
  const rate = Number(manualRate) > 0 ? Number(manualRate) : await cnyKztRate()
  const totalCny = priceCny + Math.max(0, Number(shippingCny) || 0)
  const priceKzt = Math.round(totalCny * rate * (1 + Math.max(0, Number(markupPct) || 0) / 100))
  const titleRu = sanitizeProductTitle(await translateZh(title))
  const specs = []
  for (const s of specsRaw) {
    specs.push({ ...s, keyRu: await translateZh(s.key), valueRu: await translateZh(s.value) })
  }
  const productId = extractId(finalUrl) || extractId(url)
  const brand = specs.find((s) => /бренд/i.test(s.keyRu))?.valueRu || ''
  const description = [
    titleRu,
    '',
    ...specs.map((s) => `${s.keyRu}: ${s.valueRu}`),
    '',
    `Источник: ${canonicalTaobaoUrl(finalUrl)}`,
  ].join('\n')
  return {
    source,
    sourceUrl: canonicalTaobaoUrl(url),
    finalUrl: canonicalTaobaoUrl(finalUrl),
    productId,
    title,
    titleRu,
    priceCny,
    shippingCny: Math.max(0, Number(shippingCny) || 0),
    markupPct: Math.max(0, Number(markupPct) || 0),
    rate,
    priceKzt,
    specs,
    images,
    draft: {
      sku: draftSku(source, productId),
      title: titleRu || title,
      brand,
      category: '',
      price: priceKzt,
      salePrice: priceKzt,
      description,
      attributes: specs.map((s) => ({ code: s.keyRu, value: s.valueRu })),
      images: images.slice(0, 10).map((u) => ({ url: u })),
      ...preorderDraftDefaults(),
    },
  }
}

export async function productFromBrowserPayload(payload = {}, { shippingCny = 0, markupPct = 0, rate: manualRate } = {}) {
  const detected = sourceOfUrl(payload.sourceUrl || payload.url)
  if (!detected) {
    const e = new Error('BAD_TAOBAO_URL')
    e.code = 'bad_url'
    throw e
  }
  const { url, source } = detected
  const title = cleanText(payload.title || '')
  const specsRaw = Array.isArray(payload.specs)
    ? payload.specs.map((s) => ({ key: cleanText(s.key), value: cleanText(s.value) })).filter((s) => s.key && s.value && !isPlatformMetadata(s.key, s.value))
    : []
  const images = [...new Set((payload.images || []).map(allowedImageUrl).filter(Boolean))].slice(0, 30)
  const priceCny = Math.max(0, Number(payload.priceCny || payload.price || 0) || 0)
  if (!title && !priceCny && !images.length && !specsRaw.length) {
    const e = new Error('TAOBAO_PARSE_FAILED')
    e.code = 'parse_failed'
    throw e
  }
  const rate = Number(manualRate) > 0 ? Number(manualRate) : await cnyKztRate()
  const totalCny = priceCny + Math.max(0, Number(shippingCny) || 0)
  const priceKzt = Math.round(totalCny * rate * (1 + Math.max(0, Number(markupPct) || 0) / 100))
  const titleRu = sanitizeProductTitle(await translateZh(title))
  const specs = []
  for (const s of specsRaw.slice(0, 40)) {
    specs.push({ ...s, keyRu: await translateZh(s.key), valueRu: await translateZh(s.value) })
  }
  const productId = extractId(url) || cleanText(payload.productId || '')
  const brand = specs.find((s) => /бренд/i.test(s.keyRu))?.valueRu || ''
  const description = [
    titleRu || title,
    '',
    ...specs.map((s) => `${s.keyRu}: ${s.valueRu}`),
    '',
    `Источник: ${canonicalTaobaoUrl(url)}`,
  ].join('\n')
  return {
    source: `${source}-browser`,
    sourceUrl: canonicalTaobaoUrl(url),
    finalUrl: canonicalTaobaoUrl(url),
    productId,
    title,
    titleRu,
    priceCny,
    shippingCny: Math.max(0, Number(shippingCny) || 0),
    markupPct: Math.max(0, Number(markupPct) || 0),
    rate,
    priceKzt,
    specs,
    images,
    draft: {
      sku: draftSku(source, productId),
      title: titleRu || title,
      brand,
      category: '',
      price: priceKzt,
      salePrice: priceKzt,
      description,
      attributes: specs.map((s) => ({ code: s.keyRu, value: s.valueRu })),
      images: images.slice(0, 10).map((u) => ({ url: u })),
      ...preorderDraftDefaults(),
    },
  }
}

export function allowedImageUrl(raw) {
  const u = normalizeImageUrl(raw)
  if (!u) return null
  try {
    const host = new URL(u).hostname
    return /\.(alicdn|taobao|tmall|tbcdn)\./i.test(host) ? u : null
  } catch {
    return null
  }
}

export async function fetchImage(url) {
  const safe = allowedImageUrl(url)
  if (!safe) return null
  const res = await fetchWithTimeout(safe, { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/*,*/*' } }, 15000)
  if (!res.ok) return null
  const ct = res.headers.get('content-type') || ''
  if (!ct.startsWith('image/')) return null
  return { contentType: ct, data: Buffer.from(await res.arrayBuffer()) }
}
