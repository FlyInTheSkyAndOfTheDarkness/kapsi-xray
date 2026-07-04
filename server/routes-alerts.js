import { Router } from 'express'
import { requireAuth } from './auth.js'
import { filter, update, remove } from './db.js'

export const alertsRouter = Router()
alertsRouter.use(requireAuth)

/** GET /api/alerts — recent alerts (newest first) + unread count. */
alertsRouter.get('/', (req, res) => {
  const list = filter('alerts', (a) => a.userId === req.user.id).sort((a, b) => b.ts - a.ts)
  const unread = list.filter((a) => !a.read).length
  res.json({ alerts: list.slice(0, 100), unread })
})

/** POST /api/alerts/read { ids? } — mark given (or all) alerts read. */
alertsRouter.post('/read', (req, res) => {
  const ids = req.body?.ids
  filter('alerts', (a) => a.userId === req.user.id && !a.read).forEach((a) => {
    if (!ids || ids.includes(a.id)) update('alerts', a.id, { read: true })
  })
  res.json({ ok: true })
})

/** DELETE /api/alerts — clear all alerts for the user. */
alertsRouter.delete('/', (req, res) => {
  const n = remove('alerts', (a) => a.userId === req.user.id)
  res.json({ ok: true, removed: n })
})
