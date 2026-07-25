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
const DAY = 86400000
const addDays = (date, days) => new Date(date.getTime() + days * DAY)
const startOfDay = (date) => {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}
const daysBetween = (from, to) => Math.max(1, Math.round((to - from) / DAY))

function monthLabel(date, lang) {
  const months = MONTHS_SHORT[lang] || MONTHS_SHORT.ru
  return `${months[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`
}

function weightedAvg(values) {
  const clean = values.filter((v) => Number.isFinite(v) && v >= 0)
  if (!clean.length) return 0
  let weight = 0
  let total = 0
  clean.forEach((value, index) => {
    const w = 1 + index * 0.18
    weight += w
    total += value * w
  })
  return total / weight
}

export function buildAnnualForecast(reviews = [], opts = {}) {
  const {
    multiplier = REVIEW_TO_ORDER,
    price = 0,
    lang = 'ru',
    daysBack = 365,
    monthsAhead = 6,
  } = opts
  const now = startOfDay(opts.now || new Date())
  const rangeEnd = addDays(now, 1)
  const rangeStart = addDays(rangeEnd, -daysBack)
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startMonth = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
  const dates = reviews.map((r) => parseKaspiDate(r.date)).filter(Boolean)

  const history = []
  for (let month = new Date(startMonth); month <= currentMonth; month = addMonths(month, 1)) {
    const next = addMonths(month, 1)
    const bucketStart = month < rangeStart ? rangeStart : month
    const bucketEnd = next > rangeEnd ? rangeEnd : next
    const days = daysBetween(bucketStart, bucketEnd)
    const ratings = dates.filter((d) => d >= bucketStart && d < bucketEnd).length
    const sales = Math.round(ratings * multiplier)
    history.push({
      key: monthKey(month),
      label: monthLabel(month, lang),
      month: month.getMonth(),
      year: month.getFullYear(),
      days,
      ratings,
      sales,
      revenue: Math.round(sales * price),
      avgDailySales: sales / days,
      normalizedSales: (sales / days) * 30.4375,
      partial: bucketStart > month || bucketEnd < next,
      forecast: false,
    })
  }

  const annualSales = history.reduce((s, x) => s + x.sales, 0)
  const annualRevenue = history.reduce((s, x) => s + x.revenue, 0)
  const annualRatings = history.reduce((s, x) => s + x.ratings, 0)
  const nonZeroMonths = history.filter((x) => x.ratings > 0).length
  const usable = history.filter((x) => x.days >= 14 || x.ratings > 0)
  const demand = usable.map((x) => x.normalizedSales)
  const recentAvg = weightedAvg(demand.slice(-3))
  const prevAvg = weightedAvg(demand.slice(-6, -3))
  const allAvg = avg(demand.filter((x) => x > 0))
  const base = recentAvg || allAvg || avg(demand) || 0
  const rawTrend = prevAvg > 0 ? (recentAvg - prevAvg) / prevAvg : 0
  const trendPct = clamp(rawTrend, -0.45, 0.45)
  const forecastTrendPct = clamp(rawTrend, -0.28, 0.38)
  const seasonalBase = allAvg || base || 1

  const forecast = Array.from({ length: monthsAhead }, (_, i) => {
    const month = addMonths(currentMonth, i + 1)
    const sameMonth = history.find((x) => x.month === month.getMonth() && x.normalizedSales > 0 && x.days >= 14)
    const trendFactor = clamp(1 + forecastTrendPct * ((i + 1) / 6), 0.68, 1.45)
    const trendProjection = base * trendFactor
    const seasonalProjection = sameMonth
      ? sameMonth.normalizedSales * clamp(1 + forecastTrendPct * 0.25, 0.78, 1.18)
      : trendProjection
    const seasonalLift = sameMonth ? sameMonth.normalizedSales / seasonalBase : 1
    const seasonalWeight = sameMonth ? clamp(0.5 + Math.max(0, seasonalLift - 1) * 0.22 + i * 0.02, 0.52, 0.8) : 0
    const blended = sameMonth
      ? seasonalProjection * seasonalWeight + trendProjection * (1 - seasonalWeight)
      : trendProjection
    const sales = Math.max(0, Math.round(blended))
    return {
      key: monthKey(month),
      label: monthLabel(month, lang),
      month: month.getMonth(),
      year: month.getFullYear(),
      days: daysBetween(month, addMonths(month, 1)),
      ratings: null,
      seasonalSales: sameMonth ? Math.round(sameMonth.normalizedSales) : null,
      seasonalWeight,
      sales,
      revenue: Math.round(sales * price),
      avgDailySales: sales / daysBetween(month, addMonths(month, 1)),
      normalizedSales: sales,
      partial: false,
      forecast: true,
    }
  })

  const forecastSales = forecast.reduce((s, x) => s + x.sales, 0)
  const forecastRevenue = forecast.reduce((s, x) => s + x.revenue, 0)
  const confidence = nonZeroMonths >= 8 && annualRatings >= 30 ? 'high' : nonZeroMonths >= 4 && annualRatings >= 10 ? 'medium' : 'low'
  const rows = [...history, ...forecast]
  rows.forEach((row, index) => {
    const prev = rows[index - 1]
    row.momPct = prev?.sales > 0 ? ((row.sales - prev.sales) / prev.sales) * 100 : null
    row.shareOfYear = !row.forecast && annualSales > 0 ? (row.sales / annualSales) * 100 : null
  })

  return {
    history,
    forecast,
    rows,
    annualSales,
    annualRevenue,
    annualRatings,
    forecastSales,
    forecastRevenue,
    avgMonthlySales: Math.round(annualSales / Math.max(1, history.length)),
    avgDailySales: annualSales / Math.max(1, daysBack),
    nextMonthSales: forecast[0]?.sales || 0,
    nextMonthRevenue: forecast[0]?.revenue || 0,
    trendPct,
    confidence,
    nonZeroMonths,
    daysBack,
    hasData: nonZeroMonths > 0,
  }
}
