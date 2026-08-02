import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { API } from '../lib/api.js'
import { recommendedPrice, storeProfit } from '../lib/economics.js'
import { resolveFeeRules } from '../lib/feeRules.js'
import { useAuth } from './Auth.jsx'
import { useAppState } from './AppState.jsx'

const Ctx = createContext(null)

function profitFees(product, feeRules) {
  const fees = resolveFeeRules(product, feeRules)
  if (product.packaging != null) fees.packaging = Number(product.packaging) || 0
  if (product.logistics != null) fees.delivery = Number(product.logistics) || 0
  return fees
}

function withProfit(product, feeRules) {
  return { ...product, profit: storeProfit(product.price, product.cost, product.est?.sales, profitFees(product, feeRules)) }
}

function applyProductPatch(product, patch = {}, feeRules) {
  const next = { ...product, ...patch }
  if (Object.prototype.hasOwnProperty.call(patch, 'targetMargin') && !Object.prototype.hasOwnProperty.call(patch, 'salePrice') && next.cost > 0) {
    const rec = recommendedPrice({ price: next.price, purchase: next.cost, ...profitFees(next, feeRules) }, Number(next.targetMargin) || 0)
    if (rec && rec > 0) {
      next.salePrice = Math.round(rec)
      next.price = next.salePrice
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'salePrice')) {
    const salePrice = Number(patch.salePrice) || 0
    next.salePrice = salePrice || null
    next.price = salePrice || product.kaspiPrice || product.price
  }
  return next
}

/**
 * Loads the user's active connected store catalog from the backend and shares
 * it across "Мой магазин" pages (Overview / Products / Unit / ABC / Connect).
 * No demo data — everything derives from the real connected store.
 */
export function StoreDataProvider({ children }) {
  const { user } = useAuth()
  const { city, feeRules, connectStore, disconnectStore } = useAppState()
  const [stores, setStores] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [data, setData] = useState(null) // { store, products, truncated }
  const [loading, setLoading] = useState(false)
  const [sellerSummary, setSellerSummary] = useState(null)
  const [sellerLoading, setSellerLoading] = useState(false)

  const loadSellerSummary = useCallback(async (id, params = {}) => {
    if (!id) return null
    setSellerLoading(true)
    try {
      const r = await API.sellerSummary(id, { days: 30, size: 50, entries: 1, ...params })
      setSellerSummary(r)
      return r
    } finally {
      setSellerLoading(false)
    }
  }, [])

  const loadStore = useCallback(
    async (id) => {
      if (!id) return
      setLoading(true)
      try {
        const r = await API.store(id, city)
        const products = (r.products || []).map((p) => withProfit(p, feeRules))
        setData({ ...r, products })
        connectStore({ merchantId: r.store.merchantId, name: r.store.name, rating: r.store.rating, reviews: r.store.reviews, productCount: r.store.productCount })
        if (r.store.hasToken) loadSellerSummary(id).catch(() => setSellerSummary(null))
        else setSellerSummary(null)
      } catch {
        /* ignore */
      } finally {
        setLoading(false)
      }
    },
    [city, connectStore, feeRules, loadSellerSummary]
  )

  const refreshStores = useCallback(async () => {
    if (!user) {
      setStores([])
      setData(null)
      setActiveId(null)
      setSellerSummary(null)
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
        setSellerSummary(null)
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
  }, [city, feeRules])

  const setActive = (id) => {
    setActiveId(id)
    loadStore(id)
  }

  const setCogs = (sku, cost) => {
    setData((d) => (d ? { ...d, products: d.products.map((p) => (p.id === sku ? withProfit({ ...p, cost }, feeRules) : p)) } : d))
    if (activeId) API.setCogs(activeId, sku, cost).catch(() => {})
  }

  const setProductSettings = (sku, patch) => {
    const current = data?.products?.find((p) => p.id === sku)
    const nextProduct = current ? applyProductPatch(current, patch, feeRules) : null
    const persistPatch = nextProduct?.salePrice && !Object.prototype.hasOwnProperty.call(patch, 'salePrice') ? { ...patch, salePrice: nextProduct.salePrice } : patch
    setData((d) => (d ? { ...d, products: d.products.map((p) => (p.id === sku ? withProfit(applyProductPatch(p, patch, feeRules), feeRules) : p)) } : d))
    if (activeId) API.setProductSettings(activeId, sku, persistPatch).catch(() => {})
  }

  const publishProduct = async (sku) => {
    if (!activeId) return null
    const product = data?.products?.find((p) => p.id === sku)
    if (!product) return null
    return API.publishProduct(activeId, sku, {
      product,
      settings: {
        cost: product.cost,
        salePrice: product.salePrice || product.price,
        stock: product.stock,
        packaging: product.packaging,
        logistics: product.logistics,
        warehouses: product.warehouses,
      },
    })
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
    const clean = String(token || '').trim()
    const r = await API.setToken(activeId, clean)
    setStores((s) => s.map((x) => (x.id === activeId ? { ...x, hasToken: !!clean } : x)))
    setData((d) => (d ? { ...d, store: { ...d.store, hasToken: !!clean } } : d))
    if (clean) await loadSellerSummary(activeId).catch(() => setSellerSummary(null))
    else setSellerSummary(null)
    return r
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
        /* Why the catalog looks the way it does. Kaspi rate-limits by IP, so
           "empty" and "from cache" are ordinary states the seller must see. */
        stale: data?.stale || false,
        fetchedAt: data?.fetchedAt || null,
        warning: data?.warning || null,
        loading,
        sellerLoading,
        sellerSummary,
        hasStore: !!data,
        refresh: () => loadStore(activeId),
        refreshSellerSummary: (params) => loadSellerSummary(activeId, params),
        refreshStores,
        setCogs,
        setProductSettings,
        publishProduct,
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
