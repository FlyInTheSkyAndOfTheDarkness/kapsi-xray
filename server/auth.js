/* Auth: register / login with hashed passwords + JWT sessions. */

import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { all, find, insert, uid } from './db.js'

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

/** Express middleware: require a valid Bearer token; attaches req.user. */
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'unauthorized' })
  try {
    const payload = jwt.verify(token, SECRET)
    const user = find('users', (u) => u.id === payload.uid)
    if (!user) return res.status(401).json({ error: 'unauthorized' })
    req.user = { id: user.id, email: user.email }
    next()
  } catch {
    return res.status(401).json({ error: 'invalid_token' })
  }
}

const publicUser = (u) => ({ id: u.id, email: u.email, createdAt: u.createdAt })

export const authRouter = Router()

authRouter.post('/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'bad_email' })
  if (password.length < 6) return res.status(400).json({ error: 'weak_password' })
  if (find('users', (u) => u.email === email)) return res.status(409).json({ error: 'email_taken' })
  const passHash = await bcrypt.hash(password, 10)
  const user = insert('users', { id: uid(), email, passHash, createdAt: Date.now() })
  res.json({ token: sign(user), user: publicUser(user) })
})

authRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const user = find('users', (u) => u.email === email)
  if (!user) return res.status(401).json({ error: 'bad_credentials' })
  const ok = await bcrypt.compare(password, user.passHash)
  if (!ok) return res.status(401).json({ error: 'bad_credentials' })
  res.json({ token: sign(user), user: publicUser(user) })
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, users: all('users').length })
})
