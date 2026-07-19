import { readFile } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { basename, extname, join } from 'node:path'
import { UPLOAD_DIR, uploadedImageBelongsTo } from './uploads.js'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function imageError(code, status = 400, details = null) {
  const error = new Error(code)
  error.code = code
  error.status = status
  error.details = details
  return error
}

function mimeFromFilename(filename = '') {
  const ext = extname(filename).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function detectImageType(data, fallback = '') {
  if (data?.length >= 12 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data?.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png'
  if (data?.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  const type = String(fallback || '').split(';')[0].toLowerCase()
  return IMAGE_TYPES.has(type) ? type : ''
}

function privateIp(address) {
  const value = String(address || '').toLowerCase()
  if (!isIP(value)) return true
  if (value.includes(':')) {
    if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true
    if (value.startsWith('::ffff:')) return privateIp(value.slice(7))
    return false
  }
  const [a, b] = value.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

async function validateRemoteUrl(value) {
  let url
  try { url = new URL(value) } catch { throw imageError('image_unavailable') }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) throw imageError('image_unavailable')
  if (['localhost', 'localhost.localdomain'].includes(url.hostname) || url.hostname.endsWith('.local')) throw imageError('image_unavailable')
  let records
  try { records = await lookup(url.hostname, { all: true }) } catch { throw imageError('image_unavailable') }
  if (!records.length || records.some((record) => privateIp(record.address))) throw imageError('image_unavailable')
  return url
}

async function downloadImage(value, redirects = 0) {
  if (redirects > 3) throw imageError('image_unavailable')
  const url = await validateRemoteUrl(value)
  let response
  try {
    response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
      headers: {
        Accept: 'image/webp,image/png,image/jpeg,*/*;q=0.7',
        'User-Agent': 'Mozilla/5.0 (compatible; KaspiXRay/1.0)',
        Referer: `${url.protocol}//${url.host}/`,
      },
    })
  } catch {
    throw imageError('image_unavailable')
  }
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    return downloadImage(new URL(response.headers.get('location'), url).toString(), redirects + 1)
  }
  if (!response.ok) throw imageError('image_unavailable')
  const declaredType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase()
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_IMAGE_BYTES) throw imageError('image_too_large')
  const data = Buffer.from(await response.arrayBuffer())
  if (!data.length || data.length > MAX_IMAGE_BYTES) throw imageError('image_too_large')
  const type = detectImageType(data, declaredType || mimeFromFilename(url.pathname))
  if (!IMAGE_TYPES.has(type)) throw imageError('bad_image_type')
  return { data, type, name: basename(url.pathname) || 'source.jpg' }
}

export async function loadSourceImage(sourceUrl, userId) {
  if (String(sourceUrl || '').startsWith('/uploads/')) {
    if (!uploadedImageBelongsTo(sourceUrl, userId)) throw imageError('image_unavailable')
    const filename = basename(sourceUrl)
    let data
    try { data = await readFile(join(UPLOAD_DIR, filename)) } catch { throw imageError('image_unavailable') }
    if (!data.length || data.length > MAX_IMAGE_BYTES) throw imageError('image_too_large')
    const type = detectImageType(data, mimeFromFilename(filename))
    if (!IMAGE_TYPES.has(type)) throw imageError('bad_image_type')
    return { data, type, name: filename }
  }
  return downloadImage(sourceUrl)
}

function editPrompt(language) {
  const target = language === 'kk' ? 'natural Kazakh in Cyrillic' : 'natural Russian'
  return `Edit this ecommerce product image. Detect every Chinese-language text region and replace only that Chinese text with an accurate, concise translation into ${target}. Preserve the product, people, logos, brand names, model numbers, prices, colors, background, icons, layout, typography style, text box positions, image dimensions, crop and every non-Chinese element. Fit translated text inside the original text areas. Do not add marketing claims or new objects. If a brand name is Chinese, transliterate it only when necessary. Return only the edited image.`
}

function upstreamError(response, payload) {
  const code = payload?.error?.code || payload?.error?.status || ''
  const message = [code, payload?.error?.type, payload?.error?.message].filter(Boolean).join(' ')
  if (response.status === 401 || response.status === 403 || /key|auth|permission|organization|verified|model/i.test(message)) return imageError('ai_auth_failed', 400, message)
  if (response.status === 429 || /quota|rate|billing|balance|limit/i.test(message)) return imageError('ai_quota', 429, message)
  if (/image|format|mime|unsupported/i.test(message)) return imageError('bad_image_type', 400, message)
  return imageError('ai_image_failed', 502, message || response.status)
}

async function openAiEdit({ image, apiKey, language }) {
  const form = new FormData()
  form.append('model', process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2')
  form.append('prompt', editPrompt(language))
  form.append('image[]', new Blob([image.data], { type: image.type }), image.name)
  form.append('size', 'auto')
  form.append('quality', 'medium')
  form.append('output_format', 'jpeg')
  form.append('output_compression', '94')
  let response
  try {
    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      signal: AbortSignal.timeout(180_000),
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
  } catch {
    throw imageError('ai_unavailable', 502)
  }
  let payload
  try { payload = await response.json() } catch { payload = null }
  if (!response.ok) throw upstreamError(response, payload)
  const encoded = payload?.data?.[0]?.b64_json
  if (!encoded) throw imageError('ai_image_failed', 502)
  return { data: encoded, type: 'image/jpeg', model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2' }
}

async function geminiEdit({ image, apiKey, language }) {
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image'
  let response
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(180_000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: editPrompt(language) },
          { inline_data: { mime_type: image.type, data: image.data.toString('base64') } },
        ] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    })
  } catch {
    throw imageError('ai_unavailable', 502)
  }
  let payload
  try { payload = await response.json() } catch { payload = null }
  if (!response.ok) throw upstreamError(response, payload)
  const parts = payload?.candidates?.[0]?.content?.parts || []
  const output = parts.find((part) => part.inlineData?.data || part.inline_data?.data)
  const inline = output?.inlineData || output?.inline_data
  if (!inline?.data) throw imageError('ai_image_failed', 502)
  const type = inline.mimeType || inline.mime_type || 'image/png'
  if (!IMAGE_TYPES.has(type)) throw imageError('bad_image_type')
  return { data: inline.data, type, model }
}

export async function localizeImage({ provider, apiKey, language, image }) {
  if (provider === 'gemini') return geminiEdit({ image, apiKey, language })
  return openAiEdit({ image, apiKey, language })
}
