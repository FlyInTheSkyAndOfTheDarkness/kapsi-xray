import { loadSourceImage } from './ai-images.js'

const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini'
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.0-flash'

function aiError(code, status = 502, details = null) {
  const error = new Error(code)
  error.code = code
  error.status = status
  error.details = details
  return error
}

function clean(value = '', max = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeKey(value = '') {
  return clean(value, 120).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function compactProduct(product = {}) {
  const draft = product.draft || {}
  const attributes = Array.isArray(draft.attributes) ? draft.attributes : Array.isArray(product.attributes) ? product.attributes : []
  const specs = Array.isArray(product.specs) ? product.specs : []
  const images = (Array.isArray(draft.images) ? draft.images : Array.isArray(product.images) ? product.images : [])
    .map((image) => (typeof image === 'string' ? image : image?.url))
    .filter(Boolean)
    .slice(0, 8)
  return {
    sku: clean(draft.sku || product.sku, 120),
    title: clean(draft.title || product.titleRu || product.title, 500),
    brand: clean(draft.brand || product.brand, 120),
    category: clean(draft.categoryTitle || draft.category || product.categoryTitle || product.category, 200),
    description: clean(draft.description || product.description, 1800),
    attributes: attributes.map((item) => ({
      code: clean(item?.code, 120),
      value: clean(item?.value, 300),
    })).filter((item) => item.code || item.value).slice(0, 80),
    sourceSpecs: specs.map((item) => ({
      key: clean(item?.keyRu || item?.key, 120),
      value: clean(item?.valueRu || item?.value, 300),
    })).filter((item) => item.key || item.value).slice(0, 60),
    imageUrls: images,
  }
}

function allowedAttributes(attributes = []) {
  return (Array.isArray(attributes) ? attributes : [])
    .map((attribute) => ({
      code: clean(attribute?.code, 120),
      labelRu: clean(attribute?.labelRu || attribute?.title || attribute?.name, 120),
      type: clean(attribute?.type || 'string', 40),
      mandatory: !!attribute?.mandatory,
      multiValued: !!attribute?.multiValued,
      values: (Array.isArray(attribute?.values) ? attribute.values : [])
        .map((item) => ({ code: clean(item?.code, 120), name: clean(item?.name || item?.code, 120) }))
        .filter((item) => item.code)
        .slice(0, 80),
    }))
    .filter((attribute) => attribute.code)
    .slice(0, 40)
}

function directEvidence(product) {
  const rows = []
  const add = (code, value) => {
    const c = clean(code, 120)
    const v = clean(value, 300)
    if (c && v) rows.push({ code: c, value: v })
  }
  add('Бренд', product.brand)
  product.attributes?.forEach((item) => add(item.code, item.value))
  product.sourceSpecs?.forEach((item) => add(item.key, item.value))
  return rows
}

function valueByHints(product, attribute) {
  const code = attribute.code
  const label = attribute.labelRu || code
  const normalized = normalizeKey(label)
  const evidence = directEvidence(product)
  const exact = evidence.find((item) => normalizeKey(item.code) === normalized)
  if (exact) return exact.value
  const partial = evidence.find((item) => {
    const key = normalizeKey(item.code)
    return key && (normalized.includes(key) || key.includes(normalized))
  })
  if (partial) return partial.value
  const text = `${product.title} ${product.description} ${evidence.map((item) => `${item.code} ${item.value}`).join(' ')}`
  const colors = ['черный', 'белый', 'серый', 'синий', 'красный', 'зеленый', 'желтый', 'розовый', 'фиолетовый', 'коричневый', 'бежевый', 'золотистый', 'серебристый']
  if (/цвет|color/i.test(label)) return colors.find((color) => new RegExp(`\\b${color}\\b`, 'i').test(text)) || ''
  if (/бренд|brand/i.test(label)) return product.brand || ''
  if (/материал|material/i.test(label)) return evidence.find((item) => /материал|material|材质/i.test(item.code))?.value || ''
  if (/модель|model/i.test(label)) {
    const model = text.match(/\b[A-ZА-Я0-9]{2,}[-\s]?[A-ZА-Я0-9]{2,}\b/i)?.[0]
    return model || ''
  }
  return ''
}

function deterministicSuggestions({ product, attributes }) {
  return attributes.map((attribute) => {
    const rawValue = valueByHints(product, attribute)
    if (!rawValue) return null
    if (attribute.type === 'boolean') {
      const value = /^(false|нет|no|0)$/i.test(rawValue) ? 'false' : 'true'
      return { code: attribute.code, value, confidence: 0.65, source: 'card' }
    }
    if (attribute.type === 'number') {
      const number = String(rawValue).replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0]
      return number ? { code: attribute.code, value: number, confidence: 0.6, source: 'card' } : null
    }
    if (attribute.type === 'enum' && attribute.values.length) {
      const cleanValue = normalizeKey(rawValue)
      const allowed = attribute.values.find((item) => normalizeKey(item.code) === cleanValue || normalizeKey(item.name) === cleanValue)
      return allowed ? { code: attribute.code, value: allowed.code, confidence: 0.7, source: 'card' } : null
    }
    return { code: attribute.code, value: rawValue, confidence: 0.55, source: 'card' }
  }).filter(Boolean)
}

function promptFor(product, attributes, deterministic) {
  return [
    'You fill required Kaspi Marketplace product attributes for a seller import.',
    'Return only valid JSON with this shape: {"suggestions":[{"code":"ATTRIBUTE_CODE","value":"VALUE","confidence":0.0-1.0,"reason":"short evidence"}]}.',
    'Use only the supplied product evidence and product photos. Do not invent unknown facts. If a required value is not supported by evidence, omit it.',
    'Use concise Russian values for free-text fields. Preserve brand/model names exactly.',
    'For enum attributes choose only an exact code from the supplied values array. For boolean use true or false.',
    '',
    `Product: ${JSON.stringify(product)}`,
    `Required attributes: ${JSON.stringify(attributes)}`,
    `Existing deterministic hints: ${JSON.stringify(deterministic)}`,
  ].join('\n')
}

async function imageParts(imageUrls = [], userId, provider) {
  const parts = []
  for (const url of imageUrls.slice(0, 3)) {
    try {
      const image = await loadSourceImage(url, userId)
      const data = image.data.toString('base64')
      if (provider === 'gemini') parts.push({ inline_data: { mime_type: image.type, data } })
      else parts.push({ type: 'image_url', image_url: { url: `data:${image.type};base64,${data}`, detail: 'low' } })
    } catch {
      /* Photos are optional evidence; text can still be used. */
    }
  }
  return parts
}

function parseJson(text = '') {
  const cleanText = String(text || '').trim()
  try { return JSON.parse(cleanText) } catch {
    const match = cleanText.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }
}

function normalizeSuggestions(rows = [], attributes = []) {
  const byCode = new Map(attributes.map((attribute) => [attribute.code, attribute]))
  const byNorm = new Map(attributes.map((attribute) => [normalizeKey(attribute.code), attribute]))
  const out = []
  const seen = new Set()
  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    const rawCode = clean(row?.code || row?.attribute || row?.key, 120)
    const attribute = byCode.get(rawCode) || byNorm.get(normalizeKey(rawCode))
    const value = clean(row?.value ?? row?.answer ?? row?.text, 300)
    if (!attribute || !value || seen.has(attribute.code)) return
    seen.add(attribute.code)
    out.push({
      code: attribute.code,
      value,
      confidence: Math.max(0, Math.min(1, Number(row?.confidence) || 0.7)),
      reason: clean(row?.reason || row?.source || '', 180),
    })
  })
  return out
}

function mergeSuggestions(primary = [], fallback = []) {
  const byCode = new Map()
  fallback.forEach((item) => byCode.set(item.code, item))
  primary.forEach((item) => byCode.set(item.code, item))
  return [...byCode.values()]
}

function upstreamError(response, payload) {
  const message = [
    payload?.error?.code,
    payload?.error?.status,
    payload?.error?.type,
    payload?.error?.message,
  ].filter(Boolean).join(' ')
  if (response.status === 401 || response.status === 403 || /key|auth|permission|organization|verified|model/i.test(message)) return aiError('ai_auth_failed', 400, message)
  if (response.status === 429 || /quota|rate|billing|balance|limit/i.test(message)) return aiError('ai_quota', 429, message)
  return aiError('ai_unavailable', 502, message || response.status)
}

async function openAiSuggest({ apiKey, prompt, images }) {
  let response
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_TEXT_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...images],
        }],
      }),
    })
  } catch {
    throw aiError('ai_unavailable')
  }
  let payload
  try { payload = await response.json() } catch { payload = null }
  if (!response.ok) throw upstreamError(response, payload)
  return parseJson(payload?.choices?.[0]?.message?.content || '')
}

async function geminiSuggest({ apiKey, prompt, images }) {
  let response
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${GEMINI_TEXT_MODEL}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(90_000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, ...images] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    })
  } catch {
    throw aiError('ai_unavailable')
  }
  let payload
  try { payload = await response.json() } catch { payload = null }
  if (!response.ok) throw upstreamError(response, payload)
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || ''
  return parseJson(text)
}

export async function suggestKaspiAttributes({ provider, apiKey, userId, product: sourceProduct, attributes: sourceAttributes }) {
  const product = compactProduct(sourceProduct)
  const attributes = allowedAttributes(sourceAttributes)
  const deterministic = deterministicSuggestions({ product, attributes })
  if (!attributes.length) return { suggestions: [], model: null, usedPhotos: 0 }
  const prompt = promptFor(product, attributes, deterministic)
  const images = await imageParts(product.imageUrls, userId, provider)
  const payload = provider === 'gemini'
    ? await geminiSuggest({ apiKey, prompt, images })
    : await openAiSuggest({ apiKey, prompt, images })
  const aiRows = normalizeSuggestions(payload?.suggestions || payload, attributes)
  return {
    suggestions: mergeSuggestions(aiRows, deterministic).slice(0, attributes.length),
    model: provider === 'gemini' ? GEMINI_TEXT_MODEL : OPENAI_TEXT_MODEL,
    usedPhotos: images.length,
  }
}
