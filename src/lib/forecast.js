import { parseKaspiDate, REVIEW_TO_ORDER } from './salesEstimate.js'

const MONTHS_SHORT = {
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  kk: ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0)
const addMonths = (date, n) => new Date(date.getFullYear(), date.getMonth() + n, 1)
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function monthLabel(date, lang) {
  const months = MONTHS_SHORT[lang] || MONTHS_SHORT.ru
  return `${months[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`
}

export function buildAnnualForecast(reviews = [], opts = {}) {
  const {
    multiplier = REVIEW_TO_ORDER,
    price = 0,
    lang = 'ru',
    monthsBack = 12,
    monthsAhead = 6,
  } = opts
  const now = new Date()
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const start = addMonths(currentMonth, -(monthsBack - 1))
  const dates = reviews.map((r) => parseKaspiDate(r.date)).filter(Boolean)

  const history = Array.from({ length: monthsBack }, (_, i) => {
    const month = addMonths(start, i)
    const next = addMonths(month, 1)
    const ratings = dates.filter((d) => d >= month && d < next).length
    const sales = Math.round(ratings * multiplier)
    return {
      key: monthKey(month),
      label: monthLabel(month, lang),
      month: month.getMonth(),
      year: month.getFullYear(),
      ratings,
      sales,
      revenue: Math.round(sales * price),
      forecast: false,
    }
  })

  const annualSales = history.reduce((s, x) => s + x.sales, 0)
  const annualRevenue = history.reduce((s, x) => s + x.revenue, 0)
  const nonZeroMonths = history.filter((x) => x.ratings > 0).length
  const recentAvg = avg(history.slice(-3).map((x) => x.sales))
  const prevAvg = avg(history.slice(-6, -3).map((x) => x.sales))
  const allAvg = avg(history.filter((x) => x.sales > 0).map((x) => x.sales))
  const base = recentAvg || allAvg || 0
  const rawTrend = prevAvg > 0 ? (recentAvg - prevAvg) / prevAvg : 0
  const trendPct = clamp(rawTrend, -0.35, 0.35)
  const seasonalBase = allAvg || base || 1

  const forecast = Array.from({ length: monthsAhead }, (_, i) => {
    const month = addMonths(currentMonth, i + 1)
    const sameMonth = history.find((x) => x.month === month.getMonth())
    const seasonal = sameMonth?.sales > 0 ? clamp(sameMonth.sales / seasonalBase, 0.65, 1.35) : 1
    const trendFactor = clamp(1 + trendPct * ((i + 1) / 3), 0.35, 1.85)
    const sales = Math.max(0, Math.round(base * seasonal * trendFactor))
    return {
      key: monthKey(month),
      label: monthLabel(month, lang),
      month: month.getMonth(),
      year: month.getFullYear(),
      ratings: null,
      sales,
      revenue: Math.round(sales * price),
      forecast: true,
    }
  })

  const forecastSales = forecast.reduce((s, x) => s + x.sales, 0)
  const forecastRevenue = forecast.reduce((s, x) => s + x.revenue, 0)
  const confidence = nonZeroMonths >= 8 ? 'high' : nonZeroMonths >= 4 ? 'medium' : 'low'

  return {
    history,
    forecast,
    rows: [...history, ...forecast],
    annualSales,
    annualRevenue,
    forecastSales,
    forecastRevenue,
    avgMonthlySales: Math.round(annualSales / Math.max(1, monthsBack)),
    nextMonthSales: forecast[0]?.sales || 0,
    nextMonthRevenue: forecast[0]?.revenue || 0,
    trendPct,
    confidence,
    nonZeroMonths,
    hasData: nonZeroMonths > 0,
  }
}
