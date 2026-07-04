import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { API } from '../lib/api.js'
import { useAuth } from './Auth.jsx'

const Ctx = createContext(null)
const POLL_MS = 60_000

export function AlertsProvider({ children }) {
  const { user } = useAuth()
  const [alerts, setAlerts] = useState([])
  const [unread, setUnread] = useState(0)
  const timer = useRef(null)

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      const r = await API.alerts()
      setAlerts(r.alerts || [])
      setUnread(r.unread || 0)
    } catch {
      /* ignore */
    }
  }, [user])

  useEffect(() => {
    if (!user) { setAlerts([]); setUnread(0); return }
    refresh()
    timer.current = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer.current)
  }, [user, refresh])

  const markAllRead = async () => {
    if (!unread) return
    setUnread(0)
    setAlerts((a) => a.map((x) => ({ ...x, read: true })))
    await API.markAlertsRead().catch(() => {})
  }
  const clear = async () => {
    setAlerts([])
    setUnread(0)
    await API.clearAlerts().catch(() => {})
  }

  return <Ctx.Provider value={{ alerts, unread, refresh, markAllRead, clear }}>{children}</Ctx.Provider>
}

export function useAlerts() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAlerts must be used within AlertsProvider')
  return ctx
}
