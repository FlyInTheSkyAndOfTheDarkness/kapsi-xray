import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { PageHead, StatCard, Card, ConnectPrompt } from '../components/ui.jsx'
import { DonutBreakdown, BarList } from '../components/Charts.jsx'
import { useStore } from '../state/Store.jsx'
import { tenge, tengeShort, num, pct } from '../lib/format.js'

export default function Overview() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { hasStore, store, products, loading } = useStore()
  const [selectedId, setSelectedId] = useState(null)

  const agg = useMemo(() => {
    const revenue = products.reduce((s, p) => s + (p.est?.revenue || 0), 0)
    const sales = products.reduce((s, p) => s + (p.est?.sales || 0), 0)
    const profit = products.reduce((s, p) => s + (p.profit?.monthlyProfit || 0), 0)
    const withCost = products.filter((p) => p.cost)
    const lossCount = products.filter((p) => p.profit?.isLoss).length
    // expense structure across products that have a cost entered
    const exp = { cogs: 0, commission: 0, delivery: 0, tax: 0, packaging: 0, returns: 0 }
    withCost.forEach((p) => {
      const e = p.profit?.econ
      const units = p.est?.sales || 0
      if (!e) return
      exp.cogs += p.cost * units
      exp.commission += e.commission * units
      exp.delivery += e.delivery * units
      exp.tax += e.tax * units
      exp.packaging += e.packaging * units
      exp.returns += e.returnsCost * units
    })
    // revenue by category
    const byCat = {}
    products.forEach((p) => {
      const k = String(p.categoryName || '—').split(/[/·]/)[0].trim() || '—'
      byCat[k] = (byCat[k] || 0) + (p.est?.revenue || 0)
    })
    return { revenue, sales, profit, withCost: withCost.length, lossCount, avgCheck: sales ? revenue / sales : 0, exp, byCat }
  }, [products])

  if (!hasStore && !loading) return (
    <div className="fade-in">
      <PageHead title={t('overview.title')} sub={t('overview.subtitle')} />
      <ConnectPrompt />
    </div>
  )
  if (loading && !products.length) return (
    <div className="fade-in"><PageHead title={t('overview.title')} sub={t('overview.subtitle')} /><div className="xray-empty card card-pad"><span className="msym spin">progress_activity</span></div></div>
  )

  const top5 = [...products].sort((a, b) => (b.est?.revenue || 0) - (a.est?.revenue || 0)).slice(0, 5)
    .map((p) => ({ label: p.title, value: p.est?.revenue || 0, sub: `${num(p.est?.sales || 0)} ${t('xray.per_unit_short')} · ${tenge(p.price)}` }))
  const catBars = Object.entries(agg.byCat).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ label: k, value: v }))
  const productList = [...products].sort((a, b) => (b.profit?.monthlyProfit || b.est?.revenue || 0) - (a.profit?.monthlyProfit || a.est?.revenue || 0)).slice(0, 10)
  const selected = products.find((p) => p.id === selectedId) || productList[0] || products[0]
  const expItems = [
    { label: t('overview.exp_cogs'), value: agg.exp.cogs },
    { label: t('overview.exp_commission'), value: agg.exp.commission },
    { label: t('overview.exp_delivery'), value: agg.exp.delivery },
    { label: t('overview.exp_tax'), value: agg.exp.tax },
    { label: t('overview.exp_returns'), value: agg.exp.returns },
    { label: t('overview.exp_packaging'), value: agg.exp.packaging },
  ].filter((x) => x.value > 0).sort((a, b) => b.value - a.value)
  const expTotal = expItems.reduce((s, x) => s + x.value, 0)

  return (
    <div className="fade-in">
      <PageHead title={store?.name || t('overview.title')} sub={t('overview.subtitle_real')} />

      <div className="hook" style={{ background: 'linear-gradient(100deg,#eff6ff,#fff 70%)', borderColor: '#bfdbfe', color: '#1e3a8a' }}>
        <span className="msym" style={{ color: 'var(--primary)' }}>insights</span>
        <span>{t('overview.est_note')}</span>
      </div>

      <div className="stat-grid">
        <StatCard icon="payments" label={t('connect.est_revenue')} value={tengeShort(agg.revenue, lang)} hint={tenge(agg.revenue)} />
        <StatCard icon="savings" tone={agg.profit >= 0 ? 'good' : 'bad'} label={t('connect.est_profit')} value={agg.withCost ? tengeShort(agg.profit, lang) : '—'} hint={`${agg.withCost}/${products.length} ${t('connect.with_cost')}`} />
        <StatCard icon="local_shipping" label={t('overview.orders_cnt')} value={num(agg.sales)} hint={t('xray.per_unit_short') + ' / ' + t('common.month')} />
        <StatCard icon="receipt_long" label={t('overview.avg_check')} value={tenge(agg.avgCheck)} />
        <StatCard icon="inventory_2" label={t('connect.products')} value={num(products.length)} />
        <StatCard icon="trending_down" tone={agg.lossCount ? 'bad' : 'neutral'} label={t('overview.loss_products')} value={num(agg.lossCount)} hint={t('overview.loss_alert_sub')} />
      </div>

      <div className="grid-2">
        <Card title={t('overview.top5_revenue')} sub={t('common.month')}>
          <BarList items={top5} lang={lang} />
        </Card>
        <Card title={t('overview.expense_structure')} sub={agg.withCost ? `${tengeShort(expTotal, lang)}` : ''}>
          {expTotal > 0 ? (
            <DonutBreakdown items={expItems} lang={lang} centerLabel={t('common.total')} centerValue={tengeShort(expTotal, lang)} />
          ) : (
            <div className="xray-empty" style={{ padding: '30px 10px' }}><span className="msym">savings</span><p>{t('overview.need_cogs')}</p></div>
          )}
        </Card>
      </div>

      {selected && (
        <Card title={t('overview.product_analytics')} sub={t('overview.product_analytics_sub')} className="product-drilldown">
          <div className="product-drill-grid">
            <div className="product-drill-list">
              {productList.map((p) => (
                <button key={p.id} className={p.id === selected.id ? 'on' : ''} onClick={() => setSelectedId(p.id)}>
                  <span>{p.title}</span>
                  <b className={p.profit?.isLoss ? 'num-neg' : ''}>{p.profit ? tengeShort(p.profit.monthlyProfit, lang) : tengeShort(p.est?.revenue || 0, lang)}</b>
                </button>
              ))}
            </div>
            <div className="product-drill-detail">
              <div className="pcell product-drill-head">
                <div className="pthumb" style={{ overflow: 'hidden' }}>{selected.image ? <img src={selected.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span className="msym">inventory_2</span>}</div>
                <div><div className="pname">{selected.title}</div><div className="pmeta">{selected.id} · {selected.categoryName || selected.brand}</div></div>
              </div>
              <div className="metric-row">
                <div className="metric"><div className="m-lbl">{t('common.price')}</div><div className="m-val">{tenge(selected.price)}</div></div>
                <div className="metric"><div className="m-lbl">{t('connect.cost')}</div><div className="m-val">{selected.cost ? tenge(selected.cost) : '—'}</div></div>
                <div className="metric"><div className="m-lbl">{t('common.margin')}</div><div className={`m-val ${selected.profit?.marginPct < 0 ? 'num-neg' : ''}`}>{selected.profit ? pct(selected.profit.marginPct, 1) : '—'}</div></div>
                <div className="metric"><div className="m-lbl">{t('products.profit_unit')}</div><div className={`m-val ${selected.profit?.unitNet < 0 ? 'num-neg' : ''}`}>{selected.profit ? tenge(selected.profit.unitNet, { sign: true }) : '—'}</div></div>
              </div>
              <div className="quick-actions">
                <button className="btn btn-primary btn-sm" onClick={() => navigate(`/xray?q=${selected.id}`)}><span className="msym">radar</span>{t('overview.open_xray')}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/products')}><span className="msym">edit</span>{t('overview.edit_product')}</button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card title={t('overview.by_category')} sub={t('connect.est_revenue')}>
        <BarList items={catBars} lang={lang} />
      </Card>
    </div>
  )
}
