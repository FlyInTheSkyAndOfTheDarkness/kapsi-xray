import express from 'express'
import cors from 'cors'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authRouter } from './auth.js'
import { storesRouter } from './routes-stores.js'
import { competitorsRouter } from './routes-competitors.js'
import { alertsRouter } from './routes-alerts.js'
import { taobaoRouter } from './routes-taobao.js'
import { aiRouter } from './routes-ai.js'
import { adminRouter } from './routes-admin.js'
import { startScheduler } from './scheduler.js'
import { cooldownLeft, kaspiFetch, proxyStatus } from './kaspi-net.js'
import { requireAuth } from './auth.js'
import { find, update } from './db.js'
import { UPLOAD_DIR } from './uploads.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  next()
})
app.use(cors())
app.use(express.json({ limit: '12mb' }))
app.use('/uploads', express.static(UPLOAD_DIR))

/* Egress state is on health on purpose: "no products anywhere" is almost always
   Kaspi refusing this IP, and that should be one curl away. */
app.get('/api/health', (req, res) =>
  res.json({ ok: true, ts: Date.now(), kaspi: { proxy: proxyStatus(), cooldownMs: cooldownLeft() } })
)
app.use('/api/auth', authRouter)
app.use('/api/stores', storesRouter)
app.use('/api/competitors', competitorsRouter)
app.use('/api/alerts', alertsRouter)
app.use('/api/taobao', taobaoRouter)
app.use('/api/ai', aiRouter)
app.use('/api/admin', adminRouter)

/* Dev-only: shift a competitor's price baseline so the next poll detects a
   change and emits an alert (for testing). Enable with KX_DEV=1. */
if (process.env.KX_DEV === '1') {
  app.post('/api/_dev/nudge/:cid', requireAuth, (req, res) => {
    const c = find('competitors', (x) => x.id === req.params.cid && x.userId === req.user.id)
    if (!c) return res.status(404).json({ error: 'not_found' })
    const factor = Number(req.body?.factor) || 1.05
    update('competitors', c.id, { lastPrice: Math.round((c.lastPrice || 0) * factor) })
    res.json({ ok: true, lastPrice: c.lastPrice })
  })
}

/* Public Kaspi proxy passthrough — makes the backend a drop-in for the dev
   Vite proxy so the deployed frontend can route all public calls here too. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
app.all('/kaspi/*', async (req, res) => {
  const path = req.originalUrl.replace(/^\/kaspi/, '')
  const m = path.match(/offers\/(\d+)/)
  try {
    const upstream = await kaspiFetch('https://kaspi.kz' + path, {
      method: req.method,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'ru-RU,ru;q=0.9',
        'Content-Type': 'application/json',
        Origin: 'https://kaspi.kz',
        'X-KS-City': '750000000',
        Referer: m ? `https://kaspi.kz/shop/p/x-${m[1]}/` : 'https://kaspi.kz/shop/',
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
    })
    res.status(upstream.status)
    const ct = upstream.headers.get('content-type') || 'application/json'
    res.set('content-type', ct)
    res.send(Buffer.from(await upstream.arrayBuffer()))
  } catch {
    res.status(502).json({ error: 'kaspi_unreachable' })
  }
})

/* Serve the built frontend if present (production single-process deploy). */
const dist = join(__dirname, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (req, res) => res.sendFile(join(dist, 'index.html')))
}

const PORT = process.env.PORT || 8787
export const server = app.listen(PORT, () => {
  console.log(`Kaspi X-Ray backend on http://localhost:${PORT}`)
  // Tests boot the same app but must not start background timers.
  if (process.env.KX_NO_SCHEDULER !== '1') startScheduler()
})
export { app }
