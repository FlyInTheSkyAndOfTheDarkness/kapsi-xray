import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { PageHead, Card, ConnectPrompt } from '../components/ui.jsx'
import { useStore } from '../state/Store.jsx'
import { exportCSV } from '../lib/csv.js'
import { tenge, tengeShort, num, pct } from '../lib/format.js'

function EditNumber({ value, min = 0, suffix, onSave, placeholder = '—' }) {
  return (
    <div className="inline-num">
      <input
        key={value ?? 'empty'}
        className="input mono cogs-input"
        type="number"
        min={min}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        onBlur={(e) => {
          const raw = e.target.value
          const v = raw === '' ? null : Math.max(min, Number(raw) || 0)
          if ((v ?? null) !== (value ?? null)) onSave(v)
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
      />
      {suffix && <span>{suffix}</span>}
    </div>
  )
}

export default function Products() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { hasStore, store, products, loading, setProductSettings, publishProduct } = useStore()
  const [q, setQ] = useState('')
  const [lossOnly, setLossOnly] = useState(false)
  const [saleMode, setSaleMode] = useState('all')
  const [sort, setSort] = useState({ key: 'title', dir: 'asc' })
  const [publishing, setPublishing] = useState({})
  const [rowMsg, setRowMsg] = useState({})

  const rows = useMemo(() => {
    let list = products.filter((p) => {
      if (lossOnly && !p.profit?.isLoss) return false
      if (saleMode !== 'all' && (p.saleMode || p.sourceType || 'regular') !== saleMode) return false
      if (q) {
        const s = q.toLowerCase()
        if (!p.title.toLowerCase().includes(s) && !p.id.includes(s) && !(p.brand || '').toLowerCase().includes(s)) return false
      }
      return true
    })
    const val = (p) => ({ price: p.price, stock: p.stock ?? -1, cost: p.cost ?? -1, margin: p.profit?.marginPct ?? -999, profit: p.profit?.unitNet ?? -1e15, title: p.title }[sort.key])
    list = [...list].sort((a, b) => {
      const av = val(a), bv = val(b)
      const c = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sort.dir === 'asc' ? c : -c
    })
    return list
  }, [products, q, lossOnly, saleMode, sort])

  const modeCounts = useMemo(() => products.reduce((acc, product) => {
    const mode = product.saleMode || product.sourceType || 'regular'
    acc[mode] = (acc[mode] || 0) + 1
    return acc
  }, { regular: 0, preorder: 0 }), [products])

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  const th = (key, label, right) => (
    <th className={right ? 't-right' : ''} onClick={() => toggleSort(key)}>
      {label}{sort.key === key && <span className="msym sort-ind">{sort.dir === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down'}</span>}
    </th>
  )

  const save = (sku, patch) => setProductSettings(sku, patch)
  const publish = async (sku) => {
    setPublishing((s) => ({ ...s, [sku]: true }))
    setRowMsg((s) => ({ ...s, [sku]: null }))
    try {
      const r = await publishProduct(sku)
      setRowMsg((s) => ({ ...s, [sku]: t('products.publish_ok', { code: r?.result?.code || r?.import?.code || '—' }) }))
    } catch (e) {
      setRowMsg((s) => ({ ...s, [sku]: e.code === 'no_token' ? t('products.no_token') : t('products.publish_err') }))
    } finally {
      setPublishing((s) => ({ ...s, [sku]: false }))
    }
  }

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
        <select className="select products-status-filter" value={saleMode} onChange={(event) => setSaleMode(event.target.value)} aria-label={t('products.sale_status')}>
          <option value="all">{t('common.all')} {products.length}</option>
          <option value="regular">{t('products.status_regular')} {modeCounts.regular}</option>
          <option value="preorder">{t('products.status_preorder')} {modeCounts.preorder}</option>
        </select>
        <span className="pill" style={{ marginLeft: 'auto' }}>{t('products.count_label', { n: num(rows.length) })}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => exportCSV('kaspi-xray-my-products.csv', [
          { key: 'title', label: t('common.product') }, { key: 'id', label: t('common.sku') }, { key: 'price', label: t('common.price') },
          { label: t('connect.cost'), value: (r) => r.cost || '' }, { label: t('products.stock'), value: (r) => r.stock ?? '' },
          { label: t('products.packaging'), value: (r) => r.packaging ?? '' }, { label: t('products.logistics'), value: (r) => r.logistics ?? '' },
          { label: t('common.margin'), value: (r) => (r.profit ? r.profit.marginPct.toFixed(1) : '') }, { label: t('products.profit_unit'), value: (r) => r.profit?.unitNet || '' },
        ], rows)}><span className="msym">download</span> CSV</button>
      </div>

      <Card pad={false}>
        <div className="tbl-wrap">
          <table className="tbl products-admin-table">
            <thead><tr>
              {th('title', t('common.product'))}
              {th('price', t('products.sale_price'), true)}
              <th className="no-sort t-right">{t('connect.cost')}</th>
              {th('stock', t('products.stock'), true)}
              {th('margin', t('common.margin'), true)}
              <th className="no-sort t-right">{t('products.packaging')}</th>
              <th className="no-sort t-right">{t('products.logistics')}</th>
              {th('profit', t('products.profit_unit'), true)}
              <th className="no-sort"></th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.profit?.isLoss ? 'loss-row' : ''}>
                  <td>
                    <div className="pcell" style={{ cursor: 'pointer' }} onClick={() => navigate(`/xray?q=${p.id}`)}>
                      <div className="pthumb" style={{ overflow: 'hidden' }}>{p.image ? <img src={p.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span className="msym">inventory_2</span>}</div>
                      <div>
                        <div className="pname" title={p.title}>{p.title}</div>
                        <div className="pmeta product-status-meta">
                          <span className={`mini-status ${p.saleMode === 'preorder' || p.sourceType === 'preorder' ? 'warn' : ''}`}>{p.saleMode === 'preorder' || p.sourceType === 'preorder' ? t('products.status_preorder') : t('products.status_regular')}</span>
                          <span>{p.categoryName || p.brand}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="t-right">
                    <EditNumber value={p.salePrice || p.price} suffix="₸" onSave={(v) => save(p.id, { salePrice: v })} />
                    {p.kaspiPrice && p.kaspiPrice !== p.price && <div className="tiny-muted">{t('products.kaspi_price')}: {tenge(p.kaspiPrice)}</div>}
                  </td>
                  <td className="t-right">
                    <EditNumber value={p.cost} suffix="₸" onSave={(v) => save(p.id, { cost: v })} />
                  </td>
                  <td className="t-right">
                    <EditNumber value={p.stock} onSave={(v) => save(p.id, { stock: v })} />
                  </td>
                  <td className="t-right">
                    <EditNumber value={p.targetMargin ?? (p.profit ? Math.round(p.profit.marginPct * 10) / 10 : null)} suffix="%" onSave={(v) => save(p.id, { targetMargin: v })} />
                    <div className={`tiny-muted mono ${p.profit && p.profit.marginPct < 0 ? 'num-neg' : ''}`}>{p.profit ? pct(p.profit.marginPct, 1) : '—'}</div>
                  </td>
                  <td className="t-right">
                    <EditNumber value={p.packaging} suffix="₸" onSave={(v) => save(p.id, { packaging: v })} />
                  </td>
                  <td className="t-right">
                    <EditNumber value={p.logistics} suffix="₸" onSave={(v) => save(p.id, { logistics: v })} />
                  </td>
                  <td className={`t-right mono ${p.profit ? (p.profit.unitNet < 0 ? 'num-neg' : 'num-pos') : ''}`}>{p.profit ? tengeShort(p.profit.unitNet, lang) : '—'}</td>
                  <td className="t-right">
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/xray?q=${p.id}`)} title="X-Ray"><span className="msym">radar</span></button>
                      {p.link && <a className="btn btn-ghost btn-sm" href={p.link} target="_blank" rel="noreferrer" title={t('preorder_detail.open_kaspi')}><span className="msym">open_in_new</span></a>}
                      <button className="btn btn-primary btn-sm" onClick={() => publish(p.id)} disabled={!store?.hasToken || publishing[p.id]}>
                        <span className={`msym ${publishing[p.id] ? 'spin' : ''}`}>{publishing[p.id] ? 'progress_activity' : 'cloud_upload'}</span>
                      </button>
                    </div>
                    {rowMsg[p.id] && <div className={`tiny-muted row-msg ${rowMsg[p.id].includes('ошиб') || rowMsg[p.id].includes('токен') ? 'num-neg' : 'num-pos'}`}>{rowMsg[p.id]}</div>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }} className="muted">{t('common.nothing')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {!store?.hasToken && <div className="mini-note"><span className="msym">key_off</span>{t('products.token_note')}</div>}
    </div>
  )
}
