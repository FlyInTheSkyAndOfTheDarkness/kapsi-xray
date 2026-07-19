import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { PageHead, Card, ConnectPrompt } from '../components/ui.jsx'
import { Waterfall } from '../components/Charts.jsx'
import { useStore } from '../state/Store.jsx'
import { useAppState } from '../state/AppState.jsx'
import { unitEconomics } from '../lib/economics.js'
import { resolveFeeRules } from '../lib/feeRules.js'
import { tenge, num, pct } from '../lib/format.js'

export default function UnitEconomics() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { hasStore, products, loading, setCogs } = useStore()
  const { feeRules } = useAppState()
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState(null)

  const list = useMemo(() => {
    const s = q.toLowerCase()
    return products.filter((p) => !s || p.title.toLowerCase().includes(s) || p.id.includes(s))
  }, [products, q])
  const product = products.find((p) => p.id === selId) || products[0]
  const [costDraft, setCostDraft] = useState('')

  if (!hasStore && !loading) return <div className="fade-in"><PageHead title={t('unit.title')} sub={t('unit.subtitle')} /><ConnectPrompt /></div>
  if (!product) return <div className="fade-in"><PageHead title={t('unit.title')} sub={t('unit.subtitle')} /><div className="xray-empty card card-pad"><span className="msym spin">progress_activity</span></div></div>

  const cost = product.cost || 0
  const fees = resolveFeeRules(product, feeRules)
  if (product.packaging != null) fees.packaging = Number(product.packaging) || 0
  if (product.logistics != null) fees.delivery = Number(product.logistics) || 0
  const econ = cost > 0 ? unitEconomics({ price: product.price, purchase: cost, ...fees }) : null
  const wfLabels = { sale_price: t('unit.sale_price'), purchase: t('unit.purchase'), kaspi_commission: t('unit.kaspi_commission'), delivery: t('unit.delivery'), tax: t('unit.tax'), packaging: t('unit.packaging'), returns_cost: t('unit.returns_cost'), net: t('unit.net') }

  return (
    <div className="fade-in">
      <PageHead title={t('unit.title')} sub={t('unit.subtitle')} />
      <div className="split">
        <Card title={t('unit.pick')}>
          <div className="search-box" style={{ maxWidth: '100%', marginBottom: 12 }}><span className="msym">search</span>
            <input className="input" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="picker-list">
            {list.map((p) => (
              <li key={p.id} className={p.id === product.id ? 'on' : ''} onClick={() => { setSelId(p.id); setCostDraft('') }}>
                <div style={{ minWidth: 0 }}><div className="pl-name">{p.title}</div><div className="pl-sku">{p.id} · {tenge(p.price)}</div></div>
                <span className={`mono ${p.profit ? (p.profit.isLoss ? 'num-neg' : 'num-pos') : 'soft'}`} style={{ fontSize: 12.5 }}>{p.profit ? tenge(p.profit.unitNet, { sign: true }) : '—'}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Card>
            <div className="card-hd">
              <div><div className="card-title">{product.title}</div><div className="card-sub">{product.id} · {product.categoryName}</div></div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/xray?q=${product.id}`)}><span className="msym">radar</span> X-Ray</button>
            </div>

            {/* COGS entry */}
            <div className="field-row" style={{ marginBottom: 4 }}>
              <div className="field">
                <label className="field-label">{t('unit.sale_price')}</label>
                <input className="input mono" value={tenge(product.price)} readOnly />
              </div>
              <div className="field">
                <label className="field-label">{t('connect.cost')}</label>
                <input className="input mono" type="number" min="0" placeholder="—" defaultValue={cost || ''} key={product.id}
                  onBlur={(e) => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== cost) setCogs(product.id, v) }}
                  onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
              </div>
            </div>

            {econ ? (
              <>
                <div className="result-hero" style={{ marginTop: 8 }}>
                  <span className={`rh-num ${econ.net < 0 ? 'neg' : 'pos'}`}>{tenge(econ.net, { sign: true })}</span>
                  <span className="muted">{t('unit.per_unit')}</span>
                </div>
                <div className="metric-row">
                  <div className="metric"><div className="m-lbl">{t('common.margin')}</div><div className={`m-val ${econ.marginPct < 0 ? 'num-neg' : ''}`}>{pct(econ.marginPct, 1)}</div></div>
                  <div className="metric"><div className="m-lbl">{t('common.roi')}</div><div className="m-val">{pct(econ.roiPct)}</div></div>
                  <div className="metric"><div className="m-lbl">{t('common.profit')} / {t('common.month')}</div><div className={`m-val ${product.profit?.monthlyProfit < 0 ? 'num-neg' : ''}`}>{tenge(product.profit?.monthlyProfit || 0)}</div></div>
                </div>
              </>
            ) : (
              <div className="mini-note" style={{ marginTop: 12 }}><span className="msym">savings</span>{t('unit.need_cost')}</div>
            )}
          </Card>

          {econ && <Card title={t('unit.waterfall')} sub={`${t('unit.margin_of_price')}: ${pct(econ.marginPct, 1)}`}><Waterfall econ={econ} labels={wfLabels} lang={lang} /></Card>}
        </div>
      </div>
    </div>
  )
}
