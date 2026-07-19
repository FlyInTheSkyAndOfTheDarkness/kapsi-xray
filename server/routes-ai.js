import { Router } from 'express'
import { requireAuth } from './auth.js'
import { find, insert, update, uid } from './db.js'
import { loadSourceImage, localizeImage } from './ai-images.js'
import { removeOwnedUploadedImages, saveUploadedImage } from './uploads.js'
import { normalizeImages } from './taobao-product.js'

export const aiRouter = Router()
aiRouter.use(requireAuth)

function settingFor(userId) {
  return find('aiSettings', (row) => row.userId === userId) || null
}

function publicSettings(row = {}) {
  return {
    provider: ['openai', 'gemini'].includes(row.provider) ? row.provider : 'openai',
    defaultLanguage: ['ru', 'kk'].includes(row.defaultLanguage) ? row.defaultLanguage : 'ru',
    openaiConfigured: !!(row.openaiKey || process.env.OPENAI_API_KEY),
    geminiConfigured: !!(row.geminiKey || process.env.GEMINI_API_KEY),
  }
}

aiRouter.get('/settings', (req, res) => {
  res.json({ settings: publicSettings(settingFor(req.user.id) || {}) })
})

aiRouter.put('/settings', (req, res) => {
  const current = settingFor(req.user.id)
  const provider = ['openai', 'gemini'].includes(req.body?.provider) ? req.body.provider : current?.provider || 'openai'
  const defaultLanguage = ['ru', 'kk'].includes(req.body?.defaultLanguage) ? req.body.defaultLanguage : current?.defaultLanguage || 'ru'
  const patch = { provider, defaultLanguage, updatedAt: Date.now() }
  const openaiKey = String(req.body?.openaiKey || '').trim()
  const geminiKey = String(req.body?.geminiKey || '').trim()
  if (openaiKey) patch.openaiKey = openaiKey.slice(0, 500)
  if (geminiKey) patch.geminiKey = geminiKey.slice(0, 500)
  if (req.body?.clearOpenai) patch.openaiKey = null
  if (req.body?.clearGemini) patch.geminiKey = null
  const saved = current
    ? update('aiSettings', current.id, patch)
    : insert('aiSettings', { id: uid(), userId: req.user.id, openaiKey: null, geminiKey: null, createdAt: Date.now(), ...patch })
  res.json({ ok: true, settings: publicSettings(saved) })
})

aiRouter.post('/images/localize', async (req, res) => {
  const preorderId = String(req.body?.preorderId || '')
  const sourceUrl = String(req.body?.sourceUrl || '')
  const provider = ['openai', 'gemini'].includes(req.body?.provider) ? req.body.provider : 'openai'
  const language = ['ru', 'kk'].includes(req.body?.language) ? req.body.language : 'ru'
  const row = find('taobaoProducts', (item) => item.id === preorderId && item.userId === req.user.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  const sources = normalizeImages(row.product?.draft?.images || []).map((image) => image.url)
  if (!sourceUrl || !sources.includes(sourceUrl)) return res.status(400).json({ error: 'image_not_in_preorder' })
  const settings = settingFor(req.user.id) || {}
  const apiKey = provider === 'gemini'
    ? settings.geminiKey || process.env.GEMINI_API_KEY
    : settings.openaiKey || process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(400).json({ error: 'ai_not_configured', provider })
  try {
    const image = await loadSourceImage(sourceUrl, req.user.id)
    const output = await localizeImage({ provider, apiKey, language, image })
    const localizedUrl = saveUploadedImage({ data: `data:${output.type};base64,${output.data}`, type: output.type }, req.user.id)
    res.json({ ok: true, sourceUrl, localizedUrl, provider, language, model: output.model })
  } catch (error) {
    const code = error.code || 'ai_image_failed'
    const status = Number(error.status) || (code === 'image_too_large' ? 413 : 502)
    if (process.env.NODE_ENV !== 'production') {
      console.warn('AI image localization failed', { provider, code, details: error.details || null })
    }
    res.status(status).json({ error: code })
  }
})

aiRouter.post('/images/discard', (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, 30) : []
  removeOwnedUploadedImages(urls, req.user.id)
  res.json({ ok: true, removed: urls.length })
})
