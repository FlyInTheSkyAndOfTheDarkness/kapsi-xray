import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { translations } from './translations.js'

const I18nContext = createContext(null)

export const LANGS = [
  { code: 'ru', label: 'Рус', full: 'Русский' },
  { code: 'kk', label: 'Қаз', full: 'Қазақша' },
  { code: 'en', label: 'Eng', full: 'English' },
]

const STORE_KEY = 'kx-lang'

function detectInitial() {
  const saved = typeof localStorage !== 'undefined' && localStorage.getItem(STORE_KEY)
  if (saved && translations[saved]) return saved
  return 'ru'
}

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(detectInitial)

  useEffect(() => {
    localStorage.setItem(STORE_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo(() => {
    const dict = translations[lang] || translations.ru
    /**
     * t('a.b.c') — dotted lookup with fallback to Russian, then to the key.
     * Supports {var} interpolation via the second argument.
     */
    const t = (key, vars) => {
      const read = (d) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d)
      let str = read(dict)
      if (str === undefined) str = read(translations.ru)
      if (str === undefined) return key
      if (vars && typeof str === 'string') {
        str = str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`))
      }
      return str
    }
    return { lang, setLang, t }
  }, [lang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
