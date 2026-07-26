/* ============================================================
   Re-hosting of marketplace photography.

   cbu01.alicdn.com — the CDN behind every 1688 product photo —
   serves only a whitelist of referring domains, and answers 403
   to everyone else, ours included. A hotlinked photo therefore
   renders nowhere in our pages. Requests carrying no Referer are
   served normally, which is exactly what a server-side fetch
   sends: download each photo once and keep it under /uploads.

   Re-hosting also takes the Kaspi card off a CDN we do not
   control, whose whitelist can change without warning.
   ============================================================ */

import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { UPLOAD_DIR } from './uploads.js'
import { fetchImage } from './taobao.js'

/** Photos beyond this stay on the source CDN — the draft only carries ten. */
const MIRROR_LIMIT = 12
const BATCH = 4
/** An import waits on this, so a stalled CDN must not hold the request open. */
const DEADLINE_MS = 20000
const EXTENSIONS = ['jpg', 'png', 'webp']

function extFromContentType(contentType = '') {
  if (/png/i.test(contentType)) return 'png'
  if (/webp/i.test(contentType)) return 'webp'
  return 'jpg'
}

function mirrorHash(url) {
  return createHash('sha1').update(String(url)).digest('hex').slice(0, 24)
}

/** Content-addressed, so re-importing the same offer costs nothing. */
function existingMirror(hash) {
  for (const ext of EXTENSIONS) {
    const name = `mirror-${hash}.${ext}`
    if (existsSync(join(UPLOAD_DIR, name))) return `/uploads/${name}`
  }
  return null
}

export async function mirrorImageUrl(url) {
  const value = String(url || '').trim()
  if (!value) return null
  if (value.startsWith('/uploads/')) return value
  const hash = mirrorHash(value)
  const cached = existingMirror(hash)
  if (cached) return cached
  const image = await fetchImage(value)
  if (!image?.data?.length) return null
  const name = `mirror-${hash}.${extFromContentType(image.contentType)}`
  writeFileSync(join(UPLOAD_DIR, name), image.data)
  return `/uploads/${name}`
}

/**
 * Replaces product.images with local copies and keeps the originals in
 * product.sourceImages. A photo that fails to download keeps its source
 * URL — the browser still has a chance at it with a blank Referer.
 */
export async function mirrorProductImages(product = {}, limit = MIRROR_LIMIT) {
  const source = Array.isArray(product.images) ? product.images.map((image) => (typeof image === 'string' ? image : image?.url)).filter(Boolean) : []
  if (!source.length) return product
  const local = new Map()
  const queue = source.slice(0, limit)
  const deadline = Date.now() + DEADLINE_MS
  for (let i = 0; i < queue.length && Date.now() < deadline; i += BATCH) {
    const batch = queue.slice(i, i + BATCH)
    const results = await Promise.all(batch.map((url) => mirrorImageUrl(url).catch(() => null)))
    batch.forEach((url, index) => { if (results[index]) local.set(url, results[index]) })
  }
  if (!local.size) return product
  const resolve = (url) => local.get(url) || url
  const draft = product.draft
    ? { ...product.draft, images: (product.draft.images || []).map((image) => ({ ...(typeof image === 'string' ? {} : image), url: resolve(typeof image === 'string' ? image : image?.url) })) }
    : product.draft
  return {
    ...product,
    images: source.map(resolve),
    sourceImages: source,
    ...(draft ? { draft } : {}),
  }
}
