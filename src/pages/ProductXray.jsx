import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { useAppState } from '../state/AppState.jsx'
import { useCompetitors } from '../state/Competitors.jsx'
import { PageHead, StatCard, Card, Segmented } from '../components/ui.jsx'
import { TimeBars, Sparkline, ForecastBars } from '../components/Charts.jsx'
import { searchProducts, getOffers, getReviews, parseProductRef } from '../data/kaspiApi.js'
import { estimateSales, analyzeOffers, buildSalesSeries, resolveMultiplierKey, DEFAULT_MULTIPLIERS, REVIEW_TO_ORDER } from '../lib/salesEstimate.js'
import { buildAnnualForecast } from '../lib/forecast.js'
import { addSnapshot, getSnapshots, todayKey } from '../lib/store.js'
import { exportCSV } from '../lib/csv.js'
import { tenge, tengeShort, num, pct } from '../lib/format.js'

const EXAMPLES = ['iPhone 17 Pro', 'робот-пылесос', 'наушники', 'кофеварка']

/* deterministic demo fallback if Kaspi is unreachable (prod without proxy / anti-bot) */
function demoAnalytics(prod) {
  let h = 0
  for (const ch of String(prod.id || prod.title || 'x')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const r = (n) => ((h = (h * 1103515245 + 12345) >>> 0) % 1000) / 1000 - 0 + n * 0
  const price = prod.price || 20000 + Math.round(r() * 180000)
  const total = 40 + Math.round(r() * 3000)
  const rpm = 4 + r() * 60
  const sellers = 2 + Math.round(r() * 30)
  const offers = Array.from({ length: sellers }, (_, i) => ({
    merchant: ['Mechta', 'Technodom', 'Sulpak', 'ArrowX', 'Alser', 'Kymbat', 'DNS'][i % 7] + (i > 6 ? ' ' + i : ''),
    merchantRating: 4 + r() * 1,
    merchantReviews: Math.round(r() * 4000),
    price: Math.round((price * (0.97 + r() * 0.12)) / 10) * 10,
    kaspiDelivery: r() > 0.35,
    deliveryDuration: r() > 0.5 ? 'TODAY' : null,
  })).sort((a, b) => a.price - b.price)
  const byStar = { 5: Math.round(total * 0.78), 4: Math.round(total * 0.12), 3: Math.round(total * 0.05), 2: Math.round(total * 0.03), 1: Math.round(total * 0.02) }
  const est = estimateSales({ price, ratingsTotal: total, reviews: [], createdTime: null, multiplier: REVIEW_TO_ORDER })
  // force a velocity-like estimate for demo
  est.available = true
  est.monthlySales = Math.round(rpm * REVIEW_TO_ORDER)
  est.monthlyRevenue = est.monthlySales * price
  est.dailySales = Math.round((est.monthlySales / 30) * 10) / 10
  est.reviewsPerMonth = Math.round(rpm * 10) / 10
  est.confidence = 'low'
  est.multiplier = REVIEW_TO_ORDER
  return {
    product: { ...prod, price },
    offers,
    comp: analyzeOffers(offers),
    est,
    rating: { global: 4.7, ratingsTotal: total, commentsTotal: Math.round(total * 0.8), byStar },
    source: 'demo',
    catKey: 'default',
  }
}

export default function ProductXray() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { city, multipliers } = useAppState()
  const { isTracked, track } = useCompetitors()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') || '')
  const [phase, setPhase] = useState('idle') // idle | loading | results | detail | error
  const [results, setResults] = useState([])
  const [view, setView] = useState(null) // {product, offers, comp, est, rating, source}
  const [err, setErr] = useState(null)
  const [current, setCurrent] = useState(null) // last analysed product (for city re-fetch)
  const ran = useRef(false)
  const cityRef = useRef(city)

  // deep link: /xray?q=<sku|url|name> auto-runs the analysis once on mount
  useEffect(() => {
    const q = params.get('q')
    if (q && !ran.current) {
      ran.current = true
      run(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // re-fetch offers/prices when the selected city changes
  useEffect(() => {
    if (cityRef.current !== city) {
      cityRef.current = city
      if (current) loadDetail(current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city])

  async function loadDetail(prod) {
    setPhase('loading')
    setErr(null)
    setCurrent(prod)
    try {
      const [offers, rating] = await Promise.all([getOffers(prod.id, { city }), getReviews(prod.id)])
      const comp = analyzeOffers(offers)
      const price = prod.price || comp.min || 0
      // category-aware review→order ratio (user-tunable in Settings)
      const catKey = resolveMultiplierKey(offers[0] && offers[0].category, prod.title, prod.categoryName)
      const mult = multipliers[catKey] || DEFAULT_MULTIPLIERS[catKey] || DEFAULT_MULTIPLIERS.default
      const est = estimateSales({
        price,
        ratingsTotal: rating.ratingsTotal,
        reviews: rating.reviews,
        createdTime: prod.createdTime,
        multiplier: mult,
      })
      est.categoryKey = catKey
      const product = { ...prod, price }
      // record an observation snapshot (one per day) to build real history
      addSnapshot(product.id, {
        ts: Date.now(),
        date: todayKey(),
        price,
        buyBox: (comp.buyBox && comp.buyBox.price) || comp.min || price,
        sellers: comp.count,
        ratingsTotal: rating.ratingsTotal,
        commentsTotal: rating.commentsTotal,
        estSales: est.monthlySales,
        estRevenue: est.monthlyRevenue,
      })
      setView({ product, offers, comp, est, rating, source: 'live', catKey })
      setPhase('detail')
      // deep-link ?watch=1 auto-tracks the product (shareable "track this" link)
      if (params.get('watch') === '1' && !isTracked(product.id)) track(product.id, city).catch(() => {})
    } catch (e) {
      const v = demoAnalytics(prod)
      setView(v)
      setErr(t('xray.err_blocked'))
      setPhase('detail')
    }
  }

  async function run(input) {
    const q = (input ?? query).trim()
    if (!q) return
    setQuery(q)
    setPhase('loading')
    setErr(null)
    setResults([])
    const ref = parseProductRef(q)
    try {
      if (ref.kind === 'id') {
        const res = await searchProducts(ref.id).catch(() => [])
        const prod = res.find((p) => p.id === ref.id) || res[0] || { id: ref.id, title: `Kaspi #${ref.id}` }
        return loadDetail(prod)
      }
      const res = await searchProducts(ref.text)
      if (!res.length) {
        setErr(t('xray.err_notfound'))
        setPhase('error')
        return
      }
      if (res.length === 1) return loadDetail(res[0])
      setResults(res)
      setPhase('results')
    } catch (e) {
      // whole search failed -> demo detail from the query
      setView(demoAnalytics({ id: ref.id || '0', title: q, price: 0 }))
      setErr(t('xray.err_blocked'))
      setPhase('detail')
    }
  }

  return (
    <div className="fade-in">
      <PageHead title={t('xray.title')} sub={t('xray.subtitle')} />

      {/* search bar */}
      <div className="xray-search">
        <div className="search-box" style={{ maxWidth: 'none', flex: 1 }}>
          <span className="msym">search</span>
          <input
            className="input"
            placeholder={t('xray.search_ph')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
          />
        </div>
        <button className="btn btn-primary" onClick={() => run()}>
          <span className="msym">radar</span> {t('xray.search_btn')}
        </button>
      </div>
      <div className="xray-examples">
        <span className="soft">{t('xray.examples')}:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip-ex" onClick={() => run(ex)}>{ex}</button>
        ))}
      </div>

      {phase === 'idle' && (
        <div className="xray-empty card card-pad">
          <span className="msym">travel_explore</span>
          <p>{t('xray.empty_hint')}</p>
        </div>
      )}

      {phase === 'loading' && (
        <div className="xray-empty card card-pad">
          <span className="msym spin">progress_activity</span>
          <p>{t('xray.loading')}</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="hook" style={{ background: 'linear-gradient(100deg,#fff7ed,#fff 70%)', borderColor: '#fed7aa', color: '#9a3412' }}>
          <span className="msym">info</span>
          <span>{err}</span>
        </div>
      )}

      {phase === 'results' && (
        <Card title={t('xray.results')} sub={`${results.length}`}>
          <div className="res-grid">
            {results.map((p) => (
              <button key={p.id} className="res-card" onClick={() => loadDetail(p)}>
                <div className="res-thumb">
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="msym">image</span>}
                </div>
                <div className="res-body">
                  <div className="res-title" title={p.title}>{p.title}</div>
                  <div className="res-meta">{p.brand}</div>
                  <div className="res-price mono">{tenge(p.price)}</div>
                </div>
                <span className="msym res-go">chevron_right</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {phase === 'detail' && view && <Detail t={t} lang={lang} navigate={navigate} err={err} {...view} />}
    </div>
  )
}

function ConfPill({ t, level }) {
  const map = { high: 'pos', medium: 'pos', mid: 'pos', low: 'warn' }
  const lbl = level === 'high' ? t('xray.conf_high') : level === 'low' ? t('xray.conf_low') : t('xray.conf_mid')
  return <span className={`pill ${level === 'low' ? 'warn' : 'pos'}`}>{t('xray.confidence')}: {lbl}</span>
}

function Detail({ t, lang, navigate, err, product, offers, comp, est, rating, source, catKey }) {
  const { setMultiplier, multipliers, city } = useAppState()
  const { isTracked, track, untrack } = useCompetitors()
  const compLabel = { high: t('market.high'), mid: t('market.mid'), low: t('market.low') }
  const sorted = [...offers].sort((a, b) => a.price - b.price)
  const buyPrice = comp.min || product.price
  const maxStar = Math.max(1, ...Object.values(rating.byStar || {}))
  const watched = isTracked(product.id)
  const snaps = getSnapshots(product.id)

  // calibration: user enters real monthly sales -> implied review→order ratio
  const [realSales, setRealSales] = useState('')
  const impliedMult = realSales && est.reviewsPerMonth ? Math.round(Number(realSales) / est.reviewsPerMonth) : null

  const exportOffers = () =>
    exportCSV(
      `kaspi-xray-${product.id}-offers.csv`,
      [
        { key: 'merchant', label: t('xray.col_merchant') },
        { key: 'merchantRating', label: t('xray.col_mrating') },
        { key: 'price', label: t('xray.col_price') },
        { key: 'kaspiDelivery', label: t('xray.col_delivery'), value: (o) => (o.kaspiDelivery ? '1' : '0') },
      ],
      sorted
    )

  const [sp] = useSearchParams()
  const [period, setPeriod] = useState(sp.get('period') || 'd30')
  const [metric, setMetric] = useState(sp.get('metric') === 'revenue' ? 'revenue' : 'units')
  const [forecastMetric, setForecastMetric] = useState(sp.get('forecastMetric') === 'revenue' ? 'revenue' : 'units')
  const [cumulative, setCumulative] = useState(sp.get('cum') === '1')
  const series = useMemo(
    () => buildSalesSeries(rating.reviews, { period, multiplier: est.multiplier || REVIEW_TO_ORDER, total: rating.ratingsTotal, lang, price: product.price || 0 }),
    [period, rating, est.multiplier, lang, product.price]
  )
  const annual = useMemo(
    () => buildAnnualForecast(rating.reviews, { multiplier: est.multiplier || REVIEW_TO_ORDER, lang, price: product.price || 0, monthsBack: 12, monthsAhead: 6 }),
    [rating.reviews, est.multiplier, lang, product.price]
  )
  const periodOpts = [
    { value: 'd7', label: t('xray.p7') },
    { value: 'd14', label: t('xray.p14') },
    { value: 'd30', label: t('xray.p30') },
    { value: 'd90', label: t('xray.p90') },
    { value: 'month', label: t('xray.by_month') },
  ]
  const dynSub =
    metric === 'revenue'
      ? `${t('xray.revenue_total')}: ${tengeShort(series.totalRevenue, lang)}`
      : `${t('xray.period_total')}: ${num(series.totalSales)} ${t('xray.per_unit_short')}`

  return (
    <div className="fade-in">
      {/* product header */}
      <Card className="xray-head">
        <div className="xh-thumb">
          {product.image ? <img src={product.image} alt="" /> : <span className="msym">inventory_2</span>}
        </div>
        <div className="xh-main">
          <div className="xh-badges">
            <span className={`pill ${source === 'live' ? 'pos' : 'warn'}`}>
              <span className="msym">{source === 'live' ? 'bolt' : 'science'}</span>
              {source === 'live' ? t('xray.live') : t('xray.demo')}
            </span>
            {product.brand && <span className="pill brand">{product.brand}</span>}
            {rating.global && (
              <span className="rating"><span className="msym">star</span>{rating.global} · {num(rating.commentsTotal)}</span>
            )}
          </div>
          <h2 className="xh-title">{product.title}</h2>
          <div className="xh-price">
            <span className="xh-price-main mono">{tenge(product.price)}</span>
            {product.priceMinusBonus && (
              <span className="soft">· {tenge(product.priceMinusBonus)} {lang === 'en' ? 'with bonus' : 'с бонусами'}</span>
            )}
          </div>
          <div className="xh-actions">
            {product.link && (
              <a className="btn btn-ghost btn-sm" href={product.link} target="_blank" rel="noreferrer">
                <span className="msym">open_in_new</span> {t('xray.open_kaspi')}
              </a>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => navigate(`/calculator?price=${Math.round(product.price || 0)}`)}
            >
              <span className="msym">percent</span> {t('xray.to_calc')}
            </button>
            <button className={`btn btn-sm ${watched ? 'btn-primary' : 'btn-ghost'}`} onClick={() => (watched ? untrack(product.id) : track(product.id, city))}>
              <span className="msym">{watched ? 'visibility' : 'add_business'}</span>
              {watched ? t('xray.watching') : t('xray.watch')}
            </button>
          </div>
        </div>
      </Card>

      {err && (
        <div className="hook" style={{ background: 'linear-gradient(100deg,#fff7ed,#fff 70%)', borderColor: '#fed7aa', color: '#9a3412', marginTop: 18 }}>
          <span className="msym">info</span><span>{err}</span>
        </div>
      )}

      {/* KPI row */}
      <div className="stat-grid" style={{ marginTop: 18 }}>
        <StatCard
          icon="local_shipping"
          tone="good"
          label={t('xray.est_sales')}
          value={est.available ? `${num(est.monthlySales)} ${t('xray.per_unit_short')}` : '—'}
          hint={est.available ? `~${est.dailySales} ${t('xray.est_daily')}` : t('xray.no_reviews')}
        />
        <StatCard
          icon="payments"
          label={t('xray.est_revenue')}
          value={est.available ? tengeShort(est.monthlyRevenue, lang) : '—'}
          hint={est.available ? tenge(est.monthlyRevenue) : ''}
        />
        <StatCard icon="storefront" label={t('xray.sellers_count')} value={num(comp.count)} hint={compLabel[comp.level] + ' ' + t('xray.competition').toLowerCase()} tone={comp.level === 'high' ? 'bad' : 'neutral'} />
        <StatCard icon="reviews" label={t('xray.reviews_total')} value={num(rating.commentsTotal)} hint={`${num(rating.ratingsTotal)} ${t('xray.ratings')} · +${est.reviewsPerMonth || 0}/${t('common.month')}`} />
      </div>

      {/* sales dynamics over time */}
      <Card
        title={t('xray.sales_dynamics')}
        sub={dynSub}
        aside={<Segmented options={periodOpts} value={period} onChange={setPeriod} />}
        className="dyn-card"
      >
        <div className="dyn-controls">
          <Segmented
            options={[
              { value: 'units', label: t('xray.metric_units') },
              { value: 'revenue', label: t('xray.metric_revenue') },
            ]}
            value={metric}
            onChange={setMetric}
          />
          <button className={`chip-toggle ${cumulative ? 'on' : ''}`} onClick={() => setCumulative((v) => !v)}>
            <span className="msym">show_chart</span> {t('xray.cumulative')}
          </button>
        </div>
        <TimeBars
          series={series}
          metric={metric}
          cumulative={cumulative}
          lang={lang}
          labels={{
            sales: t('xray.sales_word'),
            ratings: t('xray.ratings'),
            empty: t('xray.no_reviews'),
            perPeriod: t('xray.bars_label'),
            cumulative: t('xray.cumulative'),
          }}
        />
        {series.partial && (
          <div className="mini-note" style={{ marginTop: 4 }}>
            <span className="msym">info</span>
            {t('xray.partial_note')}
          </div>
        )}
      </Card>

      <Card
        title={t('xray.annual_title')}
        sub={t('xray.annual_sub')}
        aside={
          <Segmented
            options={[
              { value: 'units', label: t('xray.metric_units') },
              { value: 'revenue', label: t('xray.metric_revenue') },
            ]}
            value={forecastMetric}
            onChange={setForecastMetric}
          />
        }
        className="dyn-card"
      >
        <div className="annual-kpis">
          <div className="metric"><div className="m-lbl">{t('xray.annual_sales')}</div><div className="m-val">{num(annual.annualSales)} {t('xray.per_unit_short')}</div></div>
          <div className="metric"><div className="m-lbl">{t('xray.annual_revenue')}</div><div className="m-val">{tengeShort(annual.annualRevenue, lang)}</div></div>
          <div className="metric"><div className="m-lbl">{t('xray.forecast_6m')}</div><div className="m-val">{forecastMetric === 'revenue' ? tengeShort(annual.forecastRevenue, lang) : `${num(annual.forecastSales)} ${t('xray.per_unit_short')}`}</div></div>
          <div className="metric"><div className="m-lbl">{t('xray.next_month')}</div><div className="m-val">{forecastMetric === 'revenue' ? tengeShort(annual.nextMonthRevenue, lang) : `${num(annual.nextMonthSales)} ${t('xray.per_unit_short')}`}</div></div>
        </div>
        <ForecastBars
          model={annual}
          metric={forecastMetric}
          lang={lang}
          labels={{
            actual: t('xray.history_12m'),
            forecast: t('xray.forecast'),
            ratings: t('xray.ratings'),
            units: t('xray.per_unit_short'),
            empty: t('xray.no_reviews'),
          }}
        />
        <div className="mini-note" style={{ marginTop: 8, alignItems: 'flex-start' }}>
          <span className="msym">auto_graph</span>
          {t('xray.forecast_note', { m: annual.nonZeroMonths })}
        </div>
      </Card>

      <div className="grid-2" style={{ marginTop: 18 }}>
        {/* sellers table */}
        <Card
          title={t('xray.offers_title')}
          sub={`${comp.count} · ${t('xray.price_spread')} ${pct(comp.spreadPct)}`}
          aside={<button className="btn btn-ghost btn-sm" onClick={exportOffers}><span className="msym">download</span> CSV</button>}
        >
          <div className="price-strip">
            <div><span className="ps-lbl">{t('xray.price_min')}</span><span className="ps-val mono num-pos">{tenge(comp.min)}</span></div>
            <div><span className="ps-lbl">{t('xray.price_avg')}</span><span className="ps-val mono">{tenge(comp.avg)}</span></div>
            <div><span className="ps-lbl">{t('xray.price_max')}</span><span className="ps-val mono">{tenge(comp.max)}</span></div>
          </div>
          <div className="tbl-wrap" style={{ marginTop: 14 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="no-sort">{t('xray.col_merchant')}</th>
                  <th className="no-sort t-right">{t('xray.col_mrating')}</th>
                  <th className="no-sort t-right">{t('xray.col_price')}</th>
                  <th className="no-sort t-center">{t('xray.col_delivery')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((o, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {o.price === buyPrice && <span className="pill pos" style={{ padding: '2px 7px', fontSize: 10 }}>{t('xray.buybox')}</span>}
                        <span style={{ fontWeight: 600 }}>{o.merchant}</span>
                      </div>
                    </td>
                    <td className="t-right mono">{o.merchantRating ? o.merchantRating.toFixed(1) : '—'}</td>
                    <td className={`t-right mono ${o.price === buyPrice ? 'num-pos' : ''}`}>{tenge(o.price)}</td>
                    <td className="t-center">{o.kaspiDelivery ? <span className="msym" style={{ color: 'var(--primary)' }}>check_circle</span> : <span className="soft">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* rating breakdown + estimate method */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Card title={t('xray.rating_breakdown')} sub={`${rating.global || '—'} · ${num(rating.ratingsTotal)} ${t('xray.ratings')}`}>
            <div className="rating-bars">
              {[5, 4, 3, 2, 1].map((star) => {
                const c = (rating.byStar && rating.byStar[star]) || 0
                return (
                  <div className="rb-row" key={star}>
                    <span className="rb-star">{star}<span className="msym">star</span></span>
                    <div className="rb-track"><div className="rb-fill" style={{ width: `${(c / maxStar) * 100}%` }} /></div>
                    <span className="rb-count mono muted">{num(c)}</span>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div className="card-title">{t('xray.est_sales')}</div>
              <ConfPill t={t} level={est.confidence} />
            </div>
            <div className="result-hero">
              <span className="rh-num pos">{est.available ? num(est.monthlySales) : '—'}</span>
              <span className="muted">{t('xray.per_unit_short')} / {t('common.month')}</span>
            </div>
            <div className="mini-note" style={{ alignItems: 'flex-start' }}>
              <span className="msym">insights</span>
              <span>{t('xray.method_note', { m: est.multiplier || REVIEW_TO_ORDER })}</span>
            </div>

            {/* calibration: derive the review→order ratio from a known sales figure */}
            <details className="calib">
              <summary><span className="msym">tune</span> {t('xray.calibrate')}</summary>
              <div className="calib-body">
                <div className="calib-cat">{t('xray.calibrate_cat')}: <b>{t(`cats.${catKey}`)}</b> · {t('xray.current_mult')} ×{est.multiplier}</div>
                <div className="calib-row">
                  <input className="input mono" type="number" placeholder={t('xray.real_sales_ph')} value={realSales} onChange={(e) => setRealSales(e.target.value)} />
                  {impliedMult ? (
                    <button className="btn btn-primary btn-sm" onClick={() => { setMultiplier(catKey, Math.max(1, impliedMult)); setRealSales('') }}>
                      ×{impliedMult} → {t('xray.calibrate_save')}
                    </button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" disabled>{t('xray.calibrate_save')}</button>
                  )}
                </div>
                <div className="calib-hint muted">{t('xray.calibrate_hint')}</div>
              </div>
            </details>
          </Card>
        </div>
      </div>

      {/* observation history (accumulated snapshots) */}
      <SnapshotHistory t={t} lang={lang} snaps={snaps} />
    </div>
  )
}

function SnapshotHistory({ t, lang, snaps }) {
  if (!snaps || !snaps.length) return null
  const prices = snaps.map((s) => s.price)
  const priceMin = Math.min(...prices)
  const priceMax = Math.max(...prices)
  const rows = [...snaps].reverse() // newest first
  const single = snaps.length < 2
  return (
    <Card
      title={t('xray.history_title')}
      sub={t('xray.history_sub')}
      className="fade-in"
      aside={
        <button
          className="btn btn-ghost btn-sm"
          onClick={() =>
            exportCSV(
              'kaspi-xray-history.csv',
              [
                { key: 'date', label: t('common.day') },
                { key: 'price', label: t('common.price') },
                { key: 'buyBox', label: t('xray.buybox') },
                { key: 'sellers', label: t('xray.sellers_count') },
                { key: 'commentsTotal', label: t('xray.reviews_total') },
                { key: 'estSales', label: t('xray.est_sales') },
              ],
              rows
            )
          }
        >
          <span className="msym">download</span> CSV
        </button>
      }
    >
      {single && (
        <div className="mini-note" style={{ marginTop: 0, marginBottom: 12 }}>
          <span className="msym">schedule</span>{t('xray.history_seed')}
        </div>
      )}
      <div className="hist-head">
        <div className="hist-spark">
          <div className="soft" style={{ fontSize: 12, marginBottom: 4 }}>{t('common.price')} · {tenge(priceMin)}–{tenge(priceMax)}</div>
          <Sparkline data={prices.length > 1 ? prices : [prices[0], prices[0]]} w={220} h={44} color="var(--primary)" />
        </div>
      </div>
      <div className="tbl-wrap" style={{ marginTop: 8 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th className="no-sort">{t('common.day')}</th>
              <th className="no-sort t-right">{t('common.price')}</th>
              <th className="no-sort t-right">{t('xray.sellers_count')}</th>
              <th className="no-sort t-right">{t('xray.reviews_total')}</th>
              <th className="no-sort t-right">{t('xray.est_sales')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={i}>
                <td className="mono">{s.date}</td>
                <td className="t-right mono">{tenge(s.price)}</td>
                <td className="t-right mono">{num(s.sellers)}</td>
                <td className="t-right mono">{num(s.commentsTotal)}</td>
                <td className="t-right mono">{num(s.estSales)} {t('xray.per_unit_short')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
