import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { DATA_DIR } from './db.js'

export const UPLOAD_DIR = join(DATA_DIR, 'uploads')

const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })

export function saveUploadedImage({ data, type } = {}, userId = 'user') {
  const mime = String(type || '').toLowerCase()
  const ext = TYPES[mime]
  if (!ext) {
    const error = new Error('bad_image_type')
    error.code = 'bad_image_type'
    throw error
  }
  const match = String(data || '').match(/^data:image\/(?:jpeg|png|webp);base64,([a-z0-9+/=]+)$/i)
  if (!match) {
    const error = new Error('bad_image_data')
    error.code = 'bad_image_data'
    throw error
  }
  const buffer = Buffer.from(match[1], 'base64')
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    const error = new Error('image_too_large')
    error.code = 'image_too_large'
    throw error
  }
  const owner = String(userId).replace(/[^a-z0-9-]/gi, '').slice(0, 12) || 'user'
  const filename = `${owner}-${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`
  writeFileSync(join(UPLOAD_DIR, filename), buffer)
  return `/uploads/${filename}`
}

/** Reads back an image we already hold, so mirrored photos need no second download. */
export function readUploadedImage(url) {
  if (!/^\/uploads\/[a-zA-Z0-9._-]+$/.test(String(url || ''))) return null
  const name = basename(String(url))
  const path = join(UPLOAD_DIR, name)
  if (!existsSync(path)) return null
  const ext = name.split('.').pop().toLowerCase()
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  try {
    return { contentType, data: readFileSync(path) }
  } catch {
    return null
  }
}

export function removeUploadedImages(images = []) {
  images.forEach((image) => {
    const url = typeof image === 'string' ? image : image?.url
    if (!String(url || '').startsWith('/uploads/')) return
    const filename = basename(String(url))
    const path = join(UPLOAD_DIR, filename)
    if (existsSync(path)) {
      try { unlinkSync(path) } catch { /* leave orphaned upload if locked */ }
    }
  })
}

export function uploadedImageBelongsTo(url, userId = 'user') {
  if (!String(url || '').startsWith('/uploads/')) return false
  const owner = String(userId).replace(/[^a-z0-9-]/gi, '').slice(0, 12) || 'user'
  return basename(String(url)).startsWith(`${owner}-`)
}

export function removeOwnedUploadedImages(images = [], userId = 'user') {
  removeUploadedImages(images.filter((image) => {
    const url = typeof image === 'string' ? image : image?.url
    return uploadedImageBelongsTo(url, userId)
  }))
}
