import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_FEE_RULES, normalizeFeeRules } from '../lib/feeRules.js'
import { DEFAULT_MULTIPLIERS } from '../lib/salesEstimate.js'
import { loadSettings, saveSettings, loadWatchlist, saveWatchlist } from '../lib/store.js'

const AppStateContext = createContext(null)

export const CITIES = [
  { id: '750000000', name: 'Алматы' },
  { id: '710000000', name: 'Астана' },
  { id: '511010000', name: 'Шымкент' },
  { id: '351010000', name: 'Караганда' },
  { id: '151010000', name: 'Актобе' },
  { id: '311010000', name: 'Тараз' },
  { id: '551010000', name: 'Павлодар' },
  { id: '191010000', name: 'Атырау' },
]

const DEFAULT_SETTINGS = {
  city: '750000000',
  multipliers: { ...DEFAULT_MULTIPLIERS },
  feeRules: normalizeFeeRules(DEFAULT_FEE_RULES),
  store: null, // { merchantId, name, rating, reviews, productCount, connectedAt }
}

export function AppStateProvider({ children }) {
  const [settings, setSettings] = useState(() => {
    const saved = loadSettings()
    return saved
      ? {
          ...DEFAULT_SETTINGS,
          ...saved,
          multipliers: { ...DEFAULT_MULTIPLIERS, ...(saved.multipliers || {}) },
          feeRules: normalizeFeeRules(saved.feeRules),
        }
      : DEFAULT_SETTINGS
  })
  const [watchlist, setWatchlist] = useState(() => loadWatchlist())

  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => saveWatchlist(watchlist), [watchlist])

  const value = useMemo(() => {
    const setCity = (city) => setSettings((s) => ({ ...s, city }))
    const setMultiplier = (key, val) =>
      setSettings((s) => ({ ...s, multipliers: { ...s.multipliers, [key]: val } }))
    const resetMultipliers = () => setSettings((s) => ({ ...s, multipliers: { ...DEFAULT_MULTIPLIERS } }))
    const setCategoryFee = (key, patch) =>
      setSettings((s) => {
        const feeRules = normalizeFeeRules(s.feeRules)
        return { ...s, feeRules: { ...feeRules, category: { ...feeRules.category, [key]: { ...feeRules.category[key], ...patch } } } }
      })
    const setRangeFee = (id, patch) =>
      setSettings((s) => {
        const feeRules = normalizeFeeRules(s.feeRules)
        return { ...s, feeRules: { ...feeRules, ranges: feeRules.ranges.map((r) => (r.id === id ? { ...r, ...patch } : r)) } }
      })
    const setFeeMode = (mode) =>
      setSettings((s) => {
        const feeRules = normalizeFeeRules(s.feeRules)
        return { ...s, feeRules: { ...feeRules, mode: mode === 'range' ? 'range' : 'category' } }
      })
    const resetFeeRules = () => setSettings((s) => ({ ...s, feeRules: normalizeFeeRules(DEFAULT_FEE_RULES) }))

    const connectStore = (store) => setSettings((s) => ({ ...s, store: { ...store, connectedAt: Date.now() } }))
    const disconnectStore = () => setSettings((s) => ({ ...s, store: null }))

    const isWatched = (id) => watchlist.some((w) => w.id === id)
    const toggleWatch = (product) =>
      setWatchlist((list) =>
        list.some((w) => w.id === product.id)
          ? list.filter((w) => w.id !== product.id)
          : [...list, { id: product.id, title: product.title, image: product.image || null, price: product.price || 0, addedTs: Date.now() }]
      )
    const removeWatch = (id) => setWatchlist((list) => list.filter((w) => w.id !== id))

    return {
      settings,
      city: settings.city,
      multipliers: settings.multipliers,
      feeRules: settings.feeRules,
      setCity,
      setMultiplier,
      resetMultipliers,
      setCategoryFee,
      setRangeFee,
      setFeeMode,
      resetFeeRules,
      store: settings.store,
      connectStore,
      disconnectStore,
      watchlist,
      isWatched,
      toggleWatch,
      removeWatch,
    }
  }, [settings, watchlist])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState() {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
