import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { PageHead, Card, ConnectPrompt } from '../components/ui.jsx'
import { useStore } from '../state/Store.jsx'
import { exportCSV } from '../lib/csv.js'
import { tenge, tengeShort, num, pct } from '../lib/format.js'

export default function Products() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { hasStore, products, loading, setCogs } = useStore()
  const [q, setQ] = useState('')
  const [lossOnly, setLossOnly] = useState(false)
  const [sort, setSort] = useState({ key: 'revenue', dir: 'desc' })

  const rows = useMemo(() => {
    let list = products.filter((p) => {
      if (lossOnly && !p.profit?.isLoss) return false
      if (q) {
        const s = q.toLowerCase()
        if (!p.title.toLowerCase().includes(s) && !p.id.includes(s) && !(p.brand || '').toLowerCase().includes(s)) return false
      }
      return true
    })
    const val = (p) => ({ revenue: p.est?.revenue || 0, sales: p.est?.sales || 0, price: p.price, margin: p.profit?.marginPct ?? -999, profit: p.profit?.monthlyProfit ?? -1e15, title: p.title }[sort.key])
    list = [...list].sort((a, b) => {
      const av = val(a), bv = val(b)
      const c = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sort.dir === 'asc' ? c : -c
    })
    return list
  }, [products, q, lossOnly, sort])

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  const th = (key, label, right) => (
    <th className={right ? 't-right' : ''} onClick={() => toggleSort(key)}>
      {label}{sort.key === key && <span className="msym sort-ind">{sort.dir === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down'}</span>}
    </th>
  )

  if (!hasStore && !loading) return <div className="fade-in"><PageHead title={t('products.title')} sub={t('products.subtitle_real')} /><ConnectPrompt /></div>

  return (
    <div className="fade-in">
      <PageHead title={t('products.title')} sub={t('products.subtitle_real')} />

      <div className="filters">
        <div className="search-box"><span className="msym">search</span>
          <input className="input" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className={`chk ${lossOnly ? 'on' : ''}`}>
          <input type="checkbox" checked={lossOnly} onChange={(e) => setLossOnly(e.target.checked)} /> {t('common.show_loss_only')}
        </label>
        <span className="pill" style={{ marginLeft: 'auto' }}>{t('products.count_label', { n: num(rows.length) })}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => exportCSV('kaspi-xray-my-products.csv', [
          { key: 'title', label: t('common.product') }, { key: 'id', label: t('common.sku') }, { key: 'price', label: t('common.price') },
          { label: t('connect.cost'), value: (r) => r.cost || '' }, { label: t('common.sales'), value: (r) => r.est?.sales || 0 }, { label: t('common.revenue'), value: (r) => r.est?.revenue || 0 },
          { label: t('common.margin'), value: (r) => (r.profit ? r.profit.marginPct.toFixed(1) : '') }, { label: t('connect.est_profit'), value: (r) => r.profit?.monthlyProfit || '' },
        ], rows)}><span className="msym">download</span> CSV</button>
      </div>

      <Card pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              {th('title', t('common.product'))}
              {th('price', t('common.price'), true)}
              <th className="no-sort t-right">{t('connect.cost')}</th>
              {th('sales', t('common.sales'), true)}
              {th('revenue', t('common.revenue'), true)}
              {th('margin', t('common.margin'), true)}
              {th('profit', t('connect.est_profit'), true)}
              <th className="no-sort"></th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.profit?.isLoss ? 'loss-row' : ''}>
                  <td>
                    <div className="pcell" style={{ cursor: 'pointer' }} onClick={() => navigate(`/xray?q=${p.id}`)}>
                      <div className="pthumb" style={{ overflow: 'hidden' }}>{p.image ? <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span className="msym">inventory_2</span>}</div>
                      <div><div className="pname" title={p.title}>{p.title}</div><div className="pmeta">{p.categoryName || p.brand}</div></div>
                    </div>
                  </td>
                  <td className="t-right mono">{tenge(p.price)}</td>
                  <td className="t-right">
                    <input className="input mono cogs-input" type="number" min="0" defaultValue={p.cost || ''} placeholder="—"
                      onBlur={(e) => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== (p.cost || 0)) setCogs(p.id, v) }}
                      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </td>
                  <td className="t-right mono">{num(p.est?.sales || 0)}</td>
                  <td className="t-right mono">{tenge(p.est?.revenue || 0)}</td>
                  <td className={`t-right mono ${p.profit && p.profit.marginPct < 0 ? 'num-neg' : ''}`}>{p.profit ? pct(p.profit.marginPct, 1) : '—'}</td>
                  <td className={`t-right mono ${p.profit ? (p.profit.monthlyProfit < 0 ? 'num-neg' : 'num-pos') : ''}`}>{p.profit ? tengeShort(p.profit.monthlyProfit, lang) : '—'}</td>
                  <td className="t-right"><button className="btn btn-ghost btn-sm" onClick={() => navigate(`/xray?q=${p.id}`)}><span className="msym">radar</span></button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }} className="muted">{t('common.nothing')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="mini-note"><span className="msym">info</span>{t('overview.est_note')}</div>
    </div>
  )
}
