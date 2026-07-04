/* ============================================================
   Deterministic mock dataset for Kaspi X-Ray.
   Seeded PRNG => stable numbers across reloads, hand-tuned so a
   realistic share of SKUs sell at a loss (the product's core hook).
   Product names stay in Russian (real Kaspi model names).
   ============================================================ */

import { unitEconomics } from '../lib/economics.js'

/* ---- seeded PRNG (mulberry32) ---- */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20260704)
const rint = (min, max) => Math.floor(min + rnd() * (max - min + 1))
const rfloat = (min, max) => min + rnd() * (max - min)
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

/* ---- category model: Kaspi commission ranges differ by category ---- */
export const CATEGORIES = [
  { id: 'electronics', name: 'Электроника', commission: 9, revenue: 4_820_000_000, sales: 128_400, sellers: 3120, avgPrice: 62_000, demand: 'high' },
  { id: 'home', name: 'Дом и кухня', commission: 12, revenue: 2_140_000_000, sales: 96_700, sellers: 2470, avgPrice: 18_500, demand: 'high' },
  { id: 'beauty', name: 'Красота и уход', commission: 14, revenue: 1_360_000_000, sales: 142_300, sellers: 1980, avgPrice: 7_400, demand: 'high' },
  { id: 'kids', name: 'Детские товары', commission: 11, revenue: 980_000_000, sales: 58_200, sellers: 1240, avgPrice: 12_900, demand: 'mid' },
  { id: 'auto', name: 'Авто', commission: 10, revenue: 760_000_000, sales: 31_500, sellers: 890, avgPrice: 21_800, demand: 'mid' },
  { id: 'sport', name: 'Спорт и отдых', commission: 12, revenue: 540_000_000, sales: 27_900, sellers: 760, avgPrice: 15_200, demand: 'mid' },
  { id: 'garden', name: 'Дача и сад', commission: 13, revenue: 320_000_000, sales: 19_300, sellers: 540, avgPrice: 11_100, demand: 'low' },
  { id: 'pet', name: 'Зоотовары', commission: 12, revenue: 210_000_000, sales: 24_600, sellers: 410, avgPrice: 6_300, demand: 'low' },
]

export const BRANDS = [
  { name: 'Xiaomi', category: 'electronics', revenue: 612_000_000, sales: 14_200, sellers: 640, avgPrice: 43_000 },
  { name: 'Samsung', category: 'electronics', revenue: 588_000_000, sales: 9_800, sellers: 520, avgPrice: 74_000 },
  { name: 'Tefal', category: 'home', revenue: 214_000_000, sales: 11_600, sellers: 300, avgPrice: 18_400 },
  { name: 'Bosch', category: 'home', revenue: 198_000_000, sales: 6_400, sellers: 280, avgPrice: 31_000 },
  { name: 'CeraVe', category: 'beauty', revenue: 176_000_000, sales: 22_800, sellers: 190, avgPrice: 7_700 },
  { name: 'La Roche-Posay', category: 'beauty', revenue: 142_000_000, sales: 12_100, sellers: 160, avgPrice: 11_700 },
  { name: 'Chicco', category: 'kids', revenue: 98_000_000, sales: 7_300, sellers: 120, avgPrice: 13_400 },
  { name: 'Nike', category: 'sport', revenue: 88_000_000, sales: 4_900, sellers: 210, avgPrice: 18_000 },
]

/* ---- product name pools per category ---- */
const NAMES = {
  electronics: ['Смартфон Redmi Note 13', 'Наушники Xiaomi Buds 5', 'Powerbank 20000 mAh', 'Робот-пылесос Mi Vacuum', 'Смарт-часы Amazfit GTR', 'Планшет Redmi Pad SE', 'ТВ-приставка Xiaomi 4K', 'Веб-камера Full HD'],
  home: ['Сковорода Tefal 26 см', 'Блендер погружной Bosch', 'Набор кастрюль 6 предметов', 'Электрочайник 1.7 л', 'Кофеварка капельная', 'Мясорубка электрическая', 'Утюг с парогенератором', 'Термос 1 л'],
  beauty: ['Крем CeraVe увлажняющий', 'Сыворотка с витамином C', 'Гель для умывания 236 мл', 'Маска для волос кератин', 'Тональный крем SPF30', 'Набор кистей для макияжа', 'Массажёр для лица', 'Парфюм 50 мл'],
  kids: ['Автокресло Chicco 9-36 кг', 'Конструктор 500 деталей', 'Развивающий коврик', 'Ночник-проектор', 'Бутылочка антиколик', 'Санки-коляска', 'Набор для творчества', 'Радионяня'],
  auto: ['Видеорегистратор 2К', 'Компрессор автомобильный', 'Органайзер в багажник', 'Держатель для телефона', 'Пусковое устройство', 'Коврики салонные 3D', 'Чехлы на сиденья', 'Ароматизатор мембранный'],
  sport: ['Гантели разборные 20 кг', 'Коврик для йоги 6 мм', 'Эспандер многофункц.', 'Фитнес-браслет', 'Палатка 3-местная', 'Рюкзак туристический 40л', 'Скакалка скоростная', 'Бутылка спортивная 1л'],
  garden: ['Секатор садовый', 'Шланг поливочный 25 м', 'Триммер аккумуляторный', 'Набор садовых инструментов', 'Опрыскиватель 5 л', 'Гамак с каркасом', 'Мангал складной', 'Тачка садовая 90 л'],
  pet: ['Корм для кошек 2 кг', 'Автопоилка для собак', 'Когтеточка с домиком', 'Лежанка для питомца', 'Переноска пластиковая', 'Шлейка светоотражающая', 'Игрушка интерактивная', 'Наполнитель комкующийся'],
}

const DEMAND_BY_CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]))

/* ---- weekly sparkline series generator (7 pts, seeded, trend-aware) ---- */
function series(base, trend) {
  const pts = []
  let v = base * rfloat(0.85, 1.0)
  for (let i = 0; i < 7; i++) {
    v = Math.max(0, v * (1 + trend / 100 / 6) * rfloat(0.92, 1.09))
    pts.push(Math.round(v))
  }
  return pts
}

/* ---- build products ---- */
function buildProducts() {
  const products = []
  let idx = 0
  for (const cat of CATEGORIES) {
    const names = NAMES[cat.id]
    const count = cat.id === 'electronics' || cat.id === 'home' || cat.id === 'beauty' ? names.length : Math.min(names.length, 4)
    for (let i = 0; i < count; i++) {
      idx++
      const price = Math.round((cat.avgPrice * rfloat(0.45, 2.4)) / 100) * 100
      // Purchase cost: usually 55-75% of price, but some are badly priced (loss-makers)
      const badlyPriced = rnd() < 0.22
      const costRatio = badlyPriced ? rfloat(0.78, 0.95) : rfloat(0.5, 0.72)
      const purchase = Math.round((price * costRatio) / 50) * 50
      const commission = cat.commission + rint(-1, 2)
      // realistic per-SKU monthly order counts for a single seller;
      // cheaper/high-demand SKUs move more units than pricey ones.
      const demandBase = DEMAND_BY_CAT[cat.id].demand === 'high' ? 62 : DEMAND_BY_CAT[cat.id].demand === 'mid' ? 34 : 18
      const priceDamp = price > 80_000 ? 0.4 : price > 35_000 ? 0.7 : 1
      const salesMonth = Math.max(5, Math.round((rfloat(0.5, 2.4) * demandBase * priceDamp) / 5) * 5)
      const trend = rint(-28, 42)
      const rating = +(rfloat(3.6, 5.0)).toFixed(1)
      const sellers = rint(2, 46)
      const stock = rint(0, 380)

      const econ = unitEconomics({
        price,
        purchase,
        commission,
        tax: 3,
        delivery: cat.id === 'electronics' ? 1500 : 900,
        packaging: 250,
        returns: rint(2, 14),
      })

      products.push({
        id: 'P' + String(idx).padStart(3, '0'),
        sku: cat.id.slice(0, 2).toUpperCase() + '-' + String(1000 + idx),
        name: names[i],
        category: cat.id,
        categoryName: cat.name,
        brand: pick(BRANDS.filter((b) => b.category === cat.id).map((b) => b.name)) || pick(['NoName', 'OEM', 'Local', 'Generic']),
        price,
        purchase,
        commission,
        tax: 3,
        delivery: cat.id === 'electronics' ? 1500 : 900,
        packaging: 250,
        returns: econ ? undefined : undefined,
        returnsPct: rint(2, 14),
        rating,
        sellers,
        stock,
        salesMonth,
        trend,
        series: series(salesMonth / 4.3, trend),
        // economics
        unitNet: econ.net,
        marginPct: econ.marginPct,
        roiPct: econ.roiPct,
        isLoss: econ.isLoss,
        revenue: price * salesMonth,
        totalProfit: econ.net * salesMonth,
      })
    }
  }
  return products.sort((a, b) => b.revenue - a.revenue)
}

export const PRODUCTS = buildProducts()

/* ---- catalog monthly aggregates: the single source of truth ----
   The store overview, its daily chart and per-product monthly figures
   all derive from here, so every screen tells one consistent story. */
export const MONTHLY = {
  revenue: PRODUCTS.reduce((s, p) => s + p.revenue, 0),
  profit: PRODUCTS.reduce((s, p) => s + p.totalProfit, 0),
  orders: PRODUCTS.reduce((s, p) => s + p.salesMonth, 0),
}

const PERIOD_DAYS = { d7: 7, d30: 30, d90: 90 }
// d90 spans 3 months (with mild growth), d7 is a slice of the month
const PERIOD_FACTOR = { d7: 7 / 30, d30: 1, d90: 3.05 }

/* Daily series whose totals sum to the period's catalog-derived totals. */
function buildDailySeries(period) {
  const days = PERIOD_DAYS[period]
  const targetRev = MONTHLY.revenue * PERIOD_FACTOR[period]
  const targetProfit = MONTHLY.profit * PERIOD_FACTOR[period]
  // seeded weights with a gentle upward trend, then normalise to sum 1
  const raw = []
  for (let i = 0; i < days; i++) {
    const trend = 1 + (i / days) * 0.22
    raw.push(rfloat(0.75, 1.25) * trend)
  }
  const wsum = raw.reduce((s, x) => s + x, 0)
  const avgMargin = MONTHLY.revenue ? MONTHLY.profit / MONTHLY.revenue : 0.2
  const rows = []
  for (let i = 0; i < days; i++) {
    const w = raw[i] / wsum
    const revenue = Math.round(targetRev * w)
    // per-day margin wobbles a little around the catalog average
    const profit = Math.round(revenue * avgMargin * rfloat(0.82, 1.18))
    const orders = Math.round((MONTHLY.orders * PERIOD_FACTOR[period]) * w)
    rows.push({ dayAgo: days - 1 - i, revenue, profit, orders })
  }
  return rows
}

export const DAILY = {
  d7: buildDailySeries('d7'),
  d30: buildDailySeries('d30'),
  d90: buildDailySeries('d90'),
}

/* ---- pre-aggregated store KPIs per period (catalog-derived) ---- */
export function storeKpis(period = 'd30') {
  const f = PERIOD_FACTOR[period]
  const revenue = Math.round(MONTHLY.revenue * f)
  const profit = Math.round(MONTHLY.profit * f)
  const orders = Math.round(MONTHLY.orders * f)
  return {
    revenue,
    profit,
    orders,
    avgCheck: orders ? revenue / orders : 0,
    marginPct: revenue ? (profit / revenue) * 100 : 0,
    returnsRate: 6.4,
    lossCount: PRODUCTS.filter((p) => p.isLoss).length,
    delta: {
      revenue: 11.5,
      profit: 8.2,
      orders: 6.1,
      avgCheck: 3.4,
      returnsRate: -0.8,
    },
  }
}

/* ---- expense structure (aggregated across catalog, monthly) ---- */
export function expenseStructure() {
  const acc = { cogs: 0, commission: 0, delivery: 0, tax: 0, returns: 0, packaging: 0 }
  for (const p of PRODUCTS) {
    const e = unitEconomics({
      price: p.price,
      purchase: p.purchase,
      commission: p.commission,
      tax: p.tax,
      delivery: p.delivery,
      packaging: p.packaging,
      returns: p.returnsPct,
    })
    acc.cogs += p.purchase * p.salesMonth
    acc.commission += e.commission * p.salesMonth
    acc.delivery += e.delivery * p.salesMonth
    acc.tax += e.tax * p.salesMonth
    acc.returns += e.returnsCost * p.salesMonth
    acc.packaging += e.packaging * p.salesMonth
  }
  return acc
}

/** Expand a product into the unitEconomics input shape. */
export function toEconInput(p) {
  return {
    price: p.price,
    purchase: p.purchase,
    commission: p.commission,
    tax: p.tax,
    delivery: p.delivery,
    packaging: p.packaging,
    returns: p.returnsPct,
  }
}
