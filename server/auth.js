/* Auth: register / login with hashed passwords + JWT sessions. */

import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { all, find, insert, update, uid } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// stable JWT secret persisted between restarts
function loadSecret() {
  const dir = join(__dirname, 'data')
  const f = join(dir, 'secret.txt')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  if (existsSync(f)) return readFileSync(f, 'utf8').trim()
  const s = randomBytes(48).toString('hex')
  writeFileSync(f, s)
  return s
}
const SECRET = process.env.JWT_SECRET || loadSecret()
const TOKEN_TTL = '30d'

export function sign(user) {
  return jwt.sign({ uid: user.id, email: user.email }, SECRET, { expiresIn: TOKEN_TTL })
}

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean)

const isEnvAdmin = (email) => ADMIN_EMAILS.includes(String(email || '').toLowerCase())

function accessGrant(email) {
  return find('accessGrants', (row) => row.email === String(email || '').toLowerCase())
}

export function userRole(user) {
  if (!user) return 'user'
  if (isEnvAdmin(user.email)) return 'admin'
  if (user.role) return user.role
  const users = all('users')
  return users[0]?.id === user.id ? 'admin' : 'user'
}

export function userStatus(user) {
  if (!user) return 'blocked'
  const grant = accessGrant(user.email)
  if (grant?.status === 'blocked') return 'blocked'
  return user.status || 'active'
}

function registrationAllowed(email) {
  if (all('users').length === 0) return true
  if (isEnvAdmin(email)) return true
  if (process.env.OPEN_REGISTRATION === '1') return true
  const grant = accessGrant(email)
  return grant?.status === 'active'
}

/** Express middleware: require a valid Bearer token; attaches req.user. */
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'unauthorized' })
  try {
    const payload = jwt.verify(token, SECRET)
    const user = find('users', (u) => u.id === payload.uid)
    if (!user) return res.status(401).json({ error: 'unauthorized' })
    if (userStatus(user) !== 'active') return res.status(403).json({ error: 'access_denied' })
    req.user = { id: user.id, email: user.email, role: userRole(user), status: userStatus(user) }
    next()
  } catch {
    return res.status(401).json({ error: 'invalid_token' })
  }
}

export function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin_required' })
    next()
  })
}

export const publicUser = (u) => ({ id: u.id, email: u.email, role: userRole(u), status: userStatus(u), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null })

export const authRouter = Router()

authRouter.post('/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'bad_email' })
  if (password.length < 6) return res.status(400).json({ error: 'weak_password' })
  if (find('users', (u) => u.email === email)) return res.status(409).json({ error: 'email_taken' })
  if (!registrationAllowed(email)) return res.status(403).json({ error: 'access_denied' })
  const passHash = await bcrypt.hash(password, 10)
  const grant = accessGrant(email)
  const role = all('users').length === 0 || isEnvAdmin(email) ? 'admin' : grant?.role || 'user'
  const user = insert('users', { id: uid(), email, passHash, role, status: 'active', createdAt: Date.now(), lastLoginAt: Date.now() })
  res.json({ token: sign(user), user: publicUser(user) })
})

authRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const user = find('users', (u) => u.email === email)
  if (!user) return res.status(401).json({ error: 'bad_credentials' })
  if (userStatus(user) !== 'active') return res.status(403).json({ error: 'access_denied' })
  const ok = await bcrypt.compare(password, user.passHash)
  if (!ok) return res.status(401).json({ error: 'bad_credentials' })
  update('users', user.id, { lastLoginAt: Date.now(), role: userRole(user), status: userStatus(user) })
  res.json({ token: sign(user), user: publicUser(user) })
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, users: all('users').length })
})
