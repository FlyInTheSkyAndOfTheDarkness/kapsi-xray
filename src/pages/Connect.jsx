import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { useStore } from '../state/Store.jsx'
import { PageHead, StatCard, Card } from '../components/ui.jsx'
import { exportCSV } from '../lib/csv.js'
import { tenge, tengeShort, num, pct } from '../lib/format.js'

export default function Connect() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { hasStore, store, products, truncated, loading, stores, activeId, setActive, connect, disconnect, setCogs, setToken } = useStore()
  const [params] = useSearchParams()
  const [input, setInput] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const ran = useRef(false)

  useEffect(() => {
    const m = params.get('m')
    if (m && !ran.current) { ran.current = true; doConnect(m) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doConnect(ref) {
    setBusy(true); setErr(null)
    try { await connect(ref || input); setInput('') }
    catch (e) { setErr(e.code === 'bad_ref' ? t('connect.err_parse') : e.code === 'empty' ? t('connect.err_empty') : t('connect.err_generic')) }
    finally { setBusy(false) }
  }

  const totals = useMemo(() => {
    const revenue = products.reduce((s, r) => s + (r.est?.revenue || 0), 0)
    const sales = products.reduce((s, r) => s + (r.est?.sales || 0), 0)
    const profit = products.reduce((s, r) => s + (r.profit?.monthlyProfit || 0), 0)
    const withCost = products.filter((r) => r.cost).length
    return { revenue, sales, profit, withCost }
  }, [products])

  const showForm = !hasStore && !loading

  return (
    <div className="fade-in">
      <PageHead title={t('connect.title')} sub={t('connect.subtitle')}>
        {stores.length > 1 && <select className="select" value={activeId || ''} onChange={(e) => setActive(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        {hasStore && <button className="btn btn-ghost btn-sm" onClick={disconnect}><span className="msym">link_off</span> {t('connect.disconnect')}</button>}
      </PageHead>

      <Card className="connect-form" style={{ marginBottom: 18 }}>
        <div className="cf-row">
          <div className="search-box" style={{ maxWidth: 'none', flex: 1 }}><span className="msym">storefront</span>
            <input className="input" placeholder={t('connect.input_ph')} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doConnect()} />
          </div>
          <button className="btn btn-primary" onClick={() => doConnect()} disabled={busy}><span className={`msym ${busy ? 'spin' : ''}`}>{busy ? 'progress_activity' : 'link'}</span> {t('connect.connect')}</button>
        </div>
        {err && <div className="cf-err"><span className="msym">error</span>{err}</div>}
        {showForm && (
          <div className="cf-how">
            <div className="cf-how-item"><span className="msym">public</span><div><b>{t('connect.public_title')}</b><div className="muted">{t('connect.public_desc')}</div></div></div>
            <div className="cf-how-item"><span className="msym">lock</span><div><b>{t('connect.private_title')}</b><div className="muted">{t('connect.private_desc')}</div></div></div>
          </div>
        )}
      </Card>

      {loading && !hasStore && <div className="xray-empty card card-pad"><span className="msym spin">progress_activity</span><p>{t('connect.loading')}</p></div>}

      {hasStore && store && (
        <div className="fade-in">
          <Card className="store-head">
            <div className="sh-logo"><span className="msym">storefront</span></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="xh-badges">
                <span className="pill pos"><span className="msym">public</span>{t('connect.public_badge')}</span>
                {store.rating && <span className="rating"><span className="msym">star</span>{store.rating} · {num(store.reviews || 0)}</span>}
                {store.hasToken && <span className="pill brand"><span className="msym">key</span>API</span>}
              </div>
              <h2 className="xh-title">{store.name}</h2>
              <div className="muted">ID {store.merchantId} · {products.length} {t('connect.products')}{truncated ? '+' : ''}</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/')}><span className="msym">dashboard</span> {t('nav.overview')}</button>
          </Card>

          <div className="stat-grid" style={{ marginTop: 18 }}>
            <StatCard icon="inventory_2" label={t('connect.products')} value={`${num(products.length)}${truncated ? '+' : ''}`} />
            <StatCard icon="payments" label={t('connect.est_revenue')} value={tengeShort(totals.revenue, lang)} hint={tenge(totals.revenue)} />
            <StatCard icon="savings" tone={totals.profit >= 0 ? 'good' : 'bad'} label={t('connect.est_profit')} value={totals.profit ? tengeShort(totals.profit, lang) : '—'} hint={`${totals.withCost}/${products.length} ${t('connect.with_cost')}`} />
            <StatCard icon="local_shipping" label={t('connect.est_sales')} value={`${num(totals.sales)} ${t('xray.per_unit_short')}`} />
          </div>

          <Card title={t('connect.catalog')} sub={t('connect.catalog_cogs')} pad={false}
            aside={<button className="btn btn-ghost btn-sm" onClick={() => exportCSV('kaspi-xray-store.csv', [
              { key: 'title', label: t('common.product') }, { key: 'id', label: t('common.sku') }, { key: 'price', label: t('common.price') },
              { label: t('connect.cost'), value: (r) => r.cost || '' }, { label: t('connect.est_sales'), value: (r) => r.est?.sales || 0 },
              { label: t('common.margin'), value: (r) => (r.profit ? r.profit.marginPct.toFixed(1) : '') }, { label: t('connect.est_profit'), value: (r) => r.profit?.monthlyProfit || '' },
            ], products)}><span className="msym">download</span> CSV</button>}>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>
                  <th className="no-sort">{t('common.product')}</th><th className="no-sort t-right">{t('common.price')}</th><th className="no-sort t-right">{t('connect.cost')}</th>
                  <th className="no-sort t-right">{t('connect.est_sales')}</th><th className="no-sort t-right">{t('common.margin')}</th><th className="no-sort t-right">{t('connect.est_profit')}</th><th className="no-sort"></th>
                </tr></thead>
                <tbody>
                  {products.map((r) => (
                    <tr key={r.id} className={r.profit?.isLoss ? 'loss-row' : ''}>
                      <td><div className="pcell" style={{ cursor: 'pointer' }} onClick={() => navigate(`/xray?q=${r.id}`)}>
                        <div className="pthumb" style={{ overflow: 'hidden' }}>{r.image ? <img src={r.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span className="msym">inventory_2</span>}</div>
                        <div><div className="pname" title={r.title}>{r.title}</div><div className="pmeta">{r.categoryName || r.brand}</div></div>
                      </div></td>
                      <td className="t-right mono">{tenge(r.price)}</td>
                      <td className="t-right"><input className="input mono cogs-input" type="number" min="0" defaultValue={r.cost || ''} placeholder="—"
                        onBlur={(e) => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== (r.cost || 0)) setCogs(r.id, v) }} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} /></td>
                      <td className="t-right mono">{num(r.est?.sales || 0)} {t('xray.per_unit_short')}</td>
                      <td className={`t-right mono ${r.profit && r.profit.marginPct < 0 ? 'num-neg' : ''}`}>{r.profit ? pct(r.profit.marginPct, 1) : '—'}</td>
                      <td className={`t-right mono ${r.profit ? (r.profit.monthlyProfit < 0 ? 'num-neg' : 'num-pos') : ''}`}>{r.profit ? tengeShort(r.profit.monthlyProfit, lang) : '—'}</td>
                      <td className="t-right"><button className="btn btn-ghost btn-sm" onClick={() => navigate(`/xray?q=${r.id}`)}><span className="msym">radar</span></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t('connect.token_title')} sub={t('connect.token_sub')} className="fade-in">
            <div className="cf-row">
              <div className="search-box" style={{ maxWidth: 'none', flex: 1 }}><span className="msym">key</span>
                <input className="input mono" type="password" placeholder={t('connect.token_ph')} value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
              </div>
              <button className="btn btn-ghost" onClick={() => { setToken(tokenInput); setTokenInput('') }} disabled={!tokenInput}><span className="msym">save</span> {t('connect.token_save')}</button>
            </div>
            <div className="mini-note" style={{ alignItems: 'flex-start' }}><span className="msym">info</span>{t('connect.token_note')}</div>
          </Card>
        </div>
      )}
    </div>
  )
}
