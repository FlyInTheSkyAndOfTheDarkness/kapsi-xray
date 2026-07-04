import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { API } from '../lib/api.js'
import { storeProfit } from '../lib/economics.js'
import { useAuth } from './Auth.jsx'
import { useAppState } from './AppState.jsx'

const Ctx = createContext(null)

/**
 * Loads the user's active connected store catalog from the backend and shares
 * it across "Мой магазин" pages (Overview / Products / Unit / ABC / Connect).
 * No demo data — everything derives from the real connected store.
 */
export function StoreDataProvider({ children }) {
  const { user } = useAuth()
  const { city, connectStore, disconnectStore } = useAppState()
  const [stores, setStores] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [data, setData] = useState(null) // { store, products, truncated }
  const [loading, setLoading] = useState(false)

  const loadStore = useCallback(
    async (id) => {
      if (!id) return
      setLoading(true)
      try {
        const r = await API.store(id, city)
        setData(r)
        connectStore({ merchantId: r.store.merchantId, name: r.store.name, rating: r.store.rating, reviews: r.store.reviews, productCount: r.store.productCount })
      } catch {
        /* ignore */
      } finally {
        setLoading(false)
      }
    },
    [city, connectStore]
  )

  const refreshStores = useCallback(async () => {
    if (!user) {
      setStores([])
      setData(null)
      setActiveId(null)
      return
    }
    try {
      const r = await API.stores()
      setStores(r.stores)
      if (r.stores.length) {
        const id = activeId && r.stores.some((s) => s.id === activeId) ? activeId : r.stores[0].id
        setActiveId(id)
        loadStore(id)
      } else {
        setData(null)
        setActiveId(null)
        disconnectStore()
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    refreshStores()
  }, [user, refreshStores])

  useEffect(() => {
    if (activeId) loadStore(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city])

  const setActive = (id) => {
    setActiveId(id)
    loadStore(id)
  }

  const setCogs = (sku, cost) => {
    setData((d) => (d ? { ...d, products: d.products.map((p) => (p.id === sku ? { ...p, cost, profit: storeProfit(p.price, cost, p.est?.sales) } : p)) } : d))
    if (activeId) API.setCogs(activeId, sku, cost).catch(() => {})
  }

  const connect = async (ref) => {
    const r = await API.connectStore(ref, city)
    await refreshStores()
    setActive(r.store.id)
    return r
  }
  const disconnect = async () => {
    if (!activeId) return
    await API.deleteStore(activeId).catch(() => {})
    setData(null)
    setActiveId(null)
    disconnectStore()
    await refreshStores()
  }
  const setToken = async (token) => {
    if (!activeId) return
    await API.setToken(activeId, token).catch(() => {})
    setStores((s) => s.map((x) => (x.id === activeId ? { ...x, hasToken: !!token } : x)))
  }

  return (
    <Ctx.Provider
      value={{
        stores,
        activeId,
        setActive,
        store: data?.store || null,
        products: data?.products || [],
        truncated: data?.truncated || false,
        loading,
        hasStore: !!data,
        refresh: () => loadStore(activeId),
        refreshStores,
        setCogs,
        connect,
        disconnect,
        setToken,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useStore() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore must be used within StoreDataProvider')
  return ctx
}
