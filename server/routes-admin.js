import { Router } from 'express'
import { requireAdmin, publicUser, userRole, userStatus } from './auth.js'
import { all, find, filter, insert, update, uid } from './db.js'

export const adminRouter = Router()
adminRouter.use(requireAdmin)

const cleanEmail = (value) => String(value || '').trim().toLowerCase()
const isEmail = (value) => /^\S+@\S+\.\S+$/.test(value)
const roleOf = (value) => (value === 'admin' ? 'admin' : 'user')
const statusOf = (value) => (value === 'blocked' ? 'blocked' : 'active')

function totalsForUser(userId) {
  const stores = filter('stores', (s) => s.userId === userId)
  const imports = filter('imports', (x) => x.userId === userId)
  const taobaoProducts = filter('taobaoProducts', (x) => x.userId === userId)
  const competitors = filter('competitors', (x) => x.userId === userId)
  const repricers = filter('repricers', (x) => x.userId === userId)
  const cogs = filter('cogs', (x) => x.userId === userId)
  const alerts = filter('alerts', (x) => x.userId === userId)
  return {
    stores: stores.length,
    products: stores.reduce((sum, store) => sum + Number(store.productCount || 0), 0),
    storesWithToken: stores.filter((s) => s.token).length,
    competitors: competitors.length,
    repricers: repricers.length,
    imports: imports.length,
    taobaoProducts: taobaoProducts.length,
    cogs: cogs.length,
    alerts: alerts.length,
    lastImportAt: imports.reduce((max, row) => Math.max(max, Number(row.createdAt || 0)), 0) || null,
    lastActivityAt: Math.max(
      ...[...imports, ...taobaoProducts, ...competitors, ...repricers, ...cogs, ...alerts].map((row) => Number(row.updatedAt || row.createdAt || row.ts || 0)),
      0,
    ) || null,
    storesList: stores.map((s) => ({
      id: s.id,
      name: s.name,
      merchantId: s.merchantId,
      productCount: s.productCount || 0,
      hasToken: !!s.token,
      createdAt: s.createdAt || null,
    })),
  }
}

function publicGrant(row) {
  const user = find('users', (u) => u.email === row.email)
  return {
    id: row.id,
    email: row.email,
    role: row.role || 'user',
    status: row.status || 'active',
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    registered: !!user,
  }
}

function publicAdminUser(user) {
  return {
    ...publicUser(user),
    role: userRole(user),
    status: userStatus(user),
    metrics: totalsForUser(user.id),
  }
}

function activeAdminCount() {
  return all('users').filter((user) => userRole(user) === 'admin' && userStatus(user) === 'active').length
}

function wouldRemoveLastActiveAdmin(user, patch = {}) {
  if (userRole(user) !== 'admin' || userStatus(user) !== 'active') return false
  if (activeAdminCount() > 1) return false
  const nextRole = patch.role === undefined ? userRole(user) : roleOf(patch.role)
  const nextStatus = patch.status === undefined ? userStatus(user) : statusOf(patch.status)
  return nextRole !== 'admin' || nextStatus !== 'active'
}

function summary() {
  const users = all('users').map(publicAdminUser).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  const grants = all('accessGrants').map(publicGrant).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
  const metrics = users.reduce((acc, user) => {
    acc.users += 1
    if (user.status === 'active') acc.activeUsers += 1
    if (user.role === 'admin') acc.admins += 1
    acc.stores += user.metrics.stores
    acc.products += user.metrics.products
    acc.storesWithToken += user.metrics.storesWithToken
    acc.competitors += user.metrics.competitors
    acc.repricers += user.metrics.repricers
    acc.imports += user.metrics.imports
    acc.taobaoProducts += user.metrics.taobaoProducts
    return acc
  }, { users: 0, activeUsers: 0, admins: 0, stores: 0, products: 0, storesWithToken: 0, competitors: 0, repricers: 0, imports: 0, taobaoProducts: 0 })
  return { metrics, users, grants }
}

adminRouter.get('/summary', (req, res) => {
  res.json(summary())
})

adminRouter.post('/access', (req, res) => {
  const email = cleanEmail(req.body?.email)
  if (!isEmail(email)) return res.status(400).json({ error: 'bad_email' })
  const patch = {
    role: roleOf(req.body?.role),
    status: statusOf(req.body?.status),
    updatedAt: Date.now(),
    updatedBy: req.user.id,
  }
  let grant = find('accessGrants', (row) => row.email === email)
  if (grant) grant = update('accessGrants', grant.id, patch)
  else grant = insert('accessGrants', { id: uid(), email, createdAt: Date.now(), createdBy: req.user.id, ...patch })

  const user = find('users', (u) => u.email === email)
  if (user) {
    if (wouldRemoveLastActiveAdmin(user, patch)) return res.status(400).json({ error: 'last_admin' })
    update('users', user.id, { role: patch.role, status: patch.status, updatedAt: Date.now() })
  }

  res.json({ ok: true, grant: publicGrant(grant), summary: summary() })
})

adminRouter.put('/users/:id', (req, res) => {
  const user = find('users', (u) => u.id === req.params.id)
  if (!user) return res.status(404).json({ error: 'not_found' })
  const patch = { updatedAt: Date.now() }
  if (req.body?.role !== undefined) patch.role = roleOf(req.body.role)
  if (req.body?.status !== undefined) patch.status = statusOf(req.body.status)
  if (wouldRemoveLastActiveAdmin(user, patch)) return res.status(400).json({ error: 'last_admin' })
  const updated = update('users', user.id, patch)
  const email = cleanEmail(updated.email)
  let grant = find('accessGrants', (row) => row.email === email)
  const grantPatch = { role: userRole(updated), status: userStatus(updated), updatedAt: Date.now(), updatedBy: req.user.id }
  if (grant) update('accessGrants', grant.id, grantPatch)
  else insert('accessGrants', { id: uid(), email, createdAt: Date.now(), createdBy: req.user.id, ...grantPatch })
  res.json({ ok: true, user: publicAdminUser(updated), summary: summary() })
})
