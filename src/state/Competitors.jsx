import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { API } from '../lib/api.js'
import { useAuth } from './Auth.jsx'

const Ctx = createContext(null)

export function CompetitorsProvider({ children }) {
  const { user } = useAuth()
  const [list, setList] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [r, o] = await Promise.all([API.competitors(), API.opportunities().catch(() => ({ opportunities: [] }))])
      setList(r.competitors || [])
      setOpportunities(o.opportunities || [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) refresh()
    else {
      setList([])
      setOpportunities([])
    }
  }, [user, refresh])

  const isTracked = (productId) => list.some((c) => c.productId === String(productId))
  const track = async (ref, city) => {
    const r = await API.trackCompetitor(ref, city)
    await refresh()
    return r
  }
  const untrack = async (productId) => {
    const c = list.find((x) => x.productId === String(productId))
    if (c) {
      await API.untrackCompetitor(c.id)
      await refresh()
    }
  }
  const poll = async (city) => {
    const r = await API.pollCompetitors(city)
    await refresh()
    return r
  }
  const createOpportunity = async (id, body) => {
    const r = await API.createOpportunity(id, body)
    await refresh()
    return r
  }
  const publishCompetitor = async (id, body) => {
    const r = await API.publishCompetitor(id, body)
    await refresh()
    return r
  }

  return <Ctx.Provider value={{ list, opportunities, loading, refresh, isTracked, track, untrack, poll, createOpportunity, publishCompetitor }}>{children}</Ctx.Provider>
}

export function useCompetitors() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCompetitors must be used within CompetitorsProvider')
  return ctx
}
