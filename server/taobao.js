import { canonicalTaobaoUrl, isPlatformMetadata, kaspiSku, preorderDraftDefaults, sanitizeProductTitle } from './taobao-product.js'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const CNY_RATE_FALLBACK = 72

let rateCache = { ts: 0, rate: CNY_RATE_FALLBACK }

const TAOBAO_DOMAINS = ['taobao.com', 'tmall.com', 'tmall.hk', 'm.tb.cn', 'tb.cn']
const IMAGE_HOST_RE = /(^|\.)(alicdn|taobao|tmall|tbcdn|1688)\./i

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`)
}

function marketplaceFromHost(host = '') {
  const h = String(host || '').toLowerCase()
  if (hostMatches(h, '1688.com')) return { key: '1688', label: '1688', skuPrefix: '1688' }
  if (TAOBAO_DOMAINS.some((domain) => hostMatches(h, domain))) return { key: 'taobao', label: 'Taobao', skuPrefix: 'TB' }
  return null
}

function marketplaceFromUrl(value) {
  try {
    return marketplaceFromHost(new URL(String(value || '')).hostname)
  } catch {
    return null
  }
}

const SPEC_KEY_RU = {
  颜色: 'Цвет',
  颜色分类: 'Цвет',
  类目: 'Категория',
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

function safeTaobaoUrl(input) {
  let url
  try {
    url = new URL(String(input || '').trim())
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null
  const host = url.hostname.toLowerCase()
  const marketplace = marketplaceFromHost(host)
  if (!marketplace) return null
  const offerId = url.searchParams.get('offerId') || url.pathname.match(/\/offer\/(\d{6,})\.html/i)?.[1]
  if (marketplace.key === '1688' && offerId && /^\d{6,}$/.test(offerId)) return `https://detail.1688.com/offer/${offerId}.html`
  const itemId = url.searchParams.get('id') || url.searchParams.get('itemId')
  if (itemId && /^\d{6,}$/.test(itemId)) {
    url.hash = ''
    url.search = ''
    url.searchParams.set('id', itemId)
  }
  return url.toString()
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
      || u.searchParams.get('offerId')
      || u.pathname.match(/\/offer\/(\d{6,})\.html/i)?.[1]
      || (url.match(/(?:id=|itemId=|offerId=)(\d{6,})/) || [])[1]
      || (url.match(/\/offer\/(\d{6,})\.html/i) || [])[1]
      || ''
  } catch {
    return ''
  }
}

function extractTitle(html) {
  const candidates = [
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1],
    html.match(/<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)/i)?.[1],
    html.match(/"subject"\s*:\s*"([^"]{3,220})"/i)?.[1],
    html.match(/"offerTitle"\s*:\s*"([^"]{3,220})"/i)?.[1],
    html.match(/"productTitle"\s*:\s*"([^"]{3,220})"/i)?.[1],
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
    /"discountPrice"\s*:\s*"¥?\s*([\d.]+)\s*"/i,
    /"consignPrice"\s*:\s*"¥?\s*([\d.]+)\s*"/i,
    /"reservePrice"\s*:\s*"¥?\s*([\d.]+)\s*"/i,
    /"priceRange"\s*:\s*"¥?\s*([\d.]+)/i,
    /"priceDisplay"\s*:\s*"¥?\s*([\d.]+)\s*"/i,
    /"minPrice"\s*:\s*"¥?\s*([\d.]+)\s*"/i,
    /"offerMinPrice"\s*:\s*"¥?\s*([\d.]+)\s*"/i,
    /"priceRanges?"\s*:\s*\[\s*\{[\s\S]{0,300}?"price"\s*:\s*"?¥?\s*([\d.]+)/i,
    /"priceModel"\s*:\s*\{[\s\S]{0,800}?"price"\s*:\s*"?¥?\s*([\d.]+)/i,
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
    if (!IMAGE_HOST_RE.test(url.hostname)) return null
    url.search = ''
    return url.toString()
  } catch {
    return null
  }
}

/* Offer pages are as much interface as merchandise: shop banners, trust
   badges, delivery icons. Product photography sits under /img/ibank/ and
   /imgextra/; the interface art gives itself away by carrying its own pixel
   size in the file name, or by living in the CMS and sprite directories. */
function isProductImage(url) {
  if (/\/cms\/upload\//i.test(url)) return false
  if (/\/tfs\//i.test(url)) return false
  const size = url.match(/-tps-(\d+)-(\d+)/i)
  if (size && Math.min(Number(size[1]), Number(size[2])) < 250) return false
  return true
}

function extractImages(html) {
  const out = new Set()
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1]
  const ogUrl = normalizeImageUrl(og)
  if (ogUrl && isProductImage(ogUrl)) out.add(ogUrl)
  const re = /(?:https?:)?\/\/(?:[^"'\\<>\s/]+\.)?(?:alicdn|taobao|tmall|tbcdn|1688)\.[^"'\\<>\s]+?\.(?:jpg|jpeg|png|webp)/ig
  for (const m of html.matchAll(re)) {
    const u = normalizeImageUrl(m[0])
    if (u && isProductImage(u)) out.add(u)
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
  const category = decoded.match(/"leafCategoryName"\s*:\s*"([^"]{1,80})"/i)?.[1]
  if (category) addSpec(map, '类目', category)
  const info = decoded.match(/"offerIDatacenterSellInfo"\s*:\s*\{([\s\S]{0,1200}?)\}/i)?.[1] || ''
  for (const m of info.matchAll(/"([^"\\]{1,60})"\s*:\s*"([^"]{1,160})"/g)) {
    addSpec(map, m[1], m[2])
  }
  for (const m of decoded.matchAll(/"prop"\s*:\s*"([^"]{1,60})"\s*,\s*"value"\s*:\s*\[([\s\S]{1,1800}?)\]/g)) {
    const values = [...m[2].matchAll(/"name"\s*:\s*"([^"]{1,160})"/g)].map((x) => cleanText(x[1])).filter(Boolean)
    if (values.length) addSpec(map, m[1], [...new Set(values)].slice(0, 6).join(', ').slice(0, 155))
  }
  const pairs = [
    /"name"\s*:\s*"([^"]{1,60})"\s*,\s*"value"\s*:\s*"([^"]{1,160})"/g,
    /"key"\s*:\s*"([^"]{1,60})"\s*,\s*"value"\s*:\s*"([^"]{1,160})"/g,
    /"propName"\s*:\s*"([^"]{1,60})"\s*,\s*"valueName"\s*:\s*"([^"]{1,160})"/g,
    /"attrName"\s*:\s*"([^"]{1,60})"\s*,\s*"attrValue"\s*:\s*"([^"]{1,160})"/g,
    /"attributeName"\s*:\s*"([^"]{1,60})"\s*,\s*"value"\s*:\s*"([^"]{1,160})"/g,
    /"featureName"\s*:\s*"([^"]{1,60})"\s*,\s*"featureValue"\s*:\s*"([^"]{1,160})"/g,
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

function looksBlocked(url, html) {
  const s = `${url}\n${html.slice(0, 120000)}`
  const hasBlockSignal = /login|captcha|验证码|滑块|访问受限|安全验证|身份验证|请登录|登录后|会员登录|punish|verify|security/i.test(s)
  const hasProductSignal = /"subject"\s*:|"offerId"\s*:|"priceDisplay"\s*:|"mainImageList"\s*:|"leafCategoryName"\s*:|"fullPathImageURI"\s*:|<meta[^>]+property=["']og:title["']|<title[^>]*>[\s\S]{3,260}?<\/title>/i.test(s)
  return hasBlockSignal && !hasProductSignal
}

export async function parseTaobao(input, { shippingCny = 0, markupPct = 0, rate: manualRate } = {}) {
  const url = safeTaobaoUrl(input)
  if (!url) {
    const e = new Error('BAD_TAOBAO_URL')
    e.code = 'bad_url'
    throw e
  }
  const marketplace = marketplaceFromUrl(url) || { key: 'taobao', skuPrefix: 'TB' }
  const requestHeaders = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,ru;q=0.8,en;q=0.7',
  }
  let res = await fetchWithTimeout(url, {
    redirect: 'follow',
    headers: requestHeaders,
  })
  let html = await res.text()
  let finalUrl = res.url || url
  if (marketplace.key === '1688' && (!res.ok || looksBlocked(finalUrl, html))) {
    const productIdHint = extractId(finalUrl) || extractId(url)
    if (productIdHint) {
      const mobileUrl = `https://m.1688.com/offer/${productIdHint}.html`
      const mobileRes = await fetchWithTimeout(mobileUrl, { redirect: 'follow', headers: requestHeaders })
      const mobileHtml = await mobileRes.text()
      if (mobileRes.ok && !looksBlocked(mobileRes.url || mobileUrl, mobileHtml)) {
        res = mobileRes
        html = mobileHtml
        finalUrl = mobileRes.url || mobileUrl
      }
    }
  }
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
  const finalMarketplace = marketplaceFromUrl(finalUrl) || marketplace
  const brand = specs.find((s) => /бренд/i.test(s.keyRu))?.valueRu || ''
  const description = [
    titleRu,
    '',
    ...specs.map((s) => `${s.keyRu}: ${s.valueRu}`),
    '',
    `Источник: ${canonicalTaobaoUrl(finalUrl)}`,
  ].join('\n')
  return {
    source: finalMarketplace.key,
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
      sku: kaspiSku(`${finalMarketplace.skuPrefix}${productId || Date.now()}`),
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
  const url = safeTaobaoUrl(payload.sourceUrl || payload.url)
  if (!url) {
    const e = new Error('BAD_TAOBAO_URL')
    e.code = 'bad_url'
    throw e
  }
  const marketplace = marketplaceFromUrl(url) || { key: 'taobao', skuPrefix: 'TB' }
  const sellerName = cleanText(payload.sellerName || payload.seller || '')
  const subject = cleanText(payload.subject || '')
  const rawTitle = cleanText(payload.title || '')
  const sellerTitle = sellerName && rawTitle.toLowerCase() === sellerName.toLowerCase()
  const companyTitle = /有限公司|有限责任|公司|co\.,?\s*ltd|company|factory|store|shop/i.test(rawTitle)
  const title = subject || (sellerTitle || companyTitle ? '' : rawTitle)
  const specsRaw = Array.isArray(payload.specs)
    ? payload.specs.map((s) => ({ key: cleanText(s.key), value: cleanText(s.value) })).filter((s) => s.key && s.value && !isPlatformMetadata(s.key, s.value))
    : []
  const images = [...new Set((payload.images || []).map(productImageUrl).filter(Boolean))].slice(0, 30)
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
    source: `${marketplace.key}-browser`,
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
      sku: kaspiSku(`${marketplace.skuPrefix}${productId || Date.now()}`),
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

/** Safe to fetch: a marketplace host we recognise. */
export function allowedImageUrl(raw) {
  const u = normalizeImageUrl(raw)
  if (!u) return null
  try {
    const host = new URL(u).hostname
    return IMAGE_HOST_RE.test(host) ? u : null
  } catch {
    return null
  }
}

/** Worth importing: safe to fetch, and a photo of the goods rather than of the site. */
export function productImageUrl(raw) {
  const u = allowedImageUrl(raw)
  return u && isProductImage(u) ? u : null
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
