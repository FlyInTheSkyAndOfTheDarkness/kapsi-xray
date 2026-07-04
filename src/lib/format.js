/* Number & currency formatting for Kaspi X-Ray (KZT ₸, RU/KK spacing). */

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

/** 1234567 -> "1 234 567 ₸" */
export function tenge(v, { sign = false } = {}) {
  const n = Math.round(Number(v) || 0)
  const s = nf0.format(Math.abs(n))
  const pfx = n < 0 ? '−' : sign && n > 0 ? '+' : ''
  return `${pfx}${s} ₸`
}

/** Compact currency for axes/pills: 1 250 000 -> "1,25 млн ₸" */
export function tengeShort(v, lang = 'ru') {
  const n = Number(v) || 0
  const abs = Math.abs(n)
  const u = {
    ru: { m: 'млн', k: 'тыс' },
    kk: { m: 'млн', k: 'мың' },
    en: { m: 'M', k: 'K' },
  }[lang] || { m: 'млн', k: 'тыс' }
  const sign = n < 0 ? '−' : ''
  if (abs >= 1e6) return `${sign}${nf1.format(abs / 1e6)} ${u.m} ₸`
  if (abs >= 1e3) return `${sign}${nf0.format(abs / 1e3)} ${u.k} ₸`
  return `${sign}${nf0.format(abs)} ₸`
}

export function num(v) {
  return nf0.format(Math.round(Number(v) || 0))
}

export function pct(v, digits = 0) {
  const n = Number(v) || 0
  const f = digits ? nf1 : nf0
  return `${n > 0 ? '' : ''}${f.format(n)}%`
}

export function pctSigned(v, digits = 0) {
  const n = Number(v) || 0
  const f = digits ? nf1 : nf0
  const pfx = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${pfx}${f.format(Math.abs(n))}%`
}
