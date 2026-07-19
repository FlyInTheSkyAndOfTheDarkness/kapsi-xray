import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { useAppState } from '../state/AppState.jsx'
import { useCompetitors } from '../state/Competitors.jsx'
import { useStore } from '../state/Store.jsx'
import { PageHead, Card } from '../components/ui.jsx'
import { exportCSV } from '../lib/csv.js'
import { tenge, num } from '../lib/format.js'

export default function Competitors() {
  const { t } = useI18n()
  const { city } = useAppState()
  const navigate = useNavigate()
  const { store, activeId } = useStore()
  const { list, opportunities, loading, track, untrack, poll, createOpportunity, publishCompetitor } = useCompetitors()
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [polling, setPolling] = useState(false)
  const [publishTarget, setPublishTarget] = useState(null)
  const [publishForm, setPublishForm] = useState({ sku: '', title: '', brand: '', category: '' })
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishMsg, setPublishMsg] = useState(null)
  const [publishErr, setPublishErr] = useState(null)
  const opportunityIds = new Set(opportunities.map((o) => o.competitorId))

  const add = async () => {
    if (!ref.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await track(ref.trim(), city)
      setRef('')
    } catch (e) {
      setErr(e.code === 'already_tracked' ? t('competitors.err_dup') : e.code === 'bad_ref' ? t('competitors.err_ref') : t('competitors.err_generic'))
    } finally {
      setBusy(false)
    }
  }
  const doPoll = async () => {
    setPolling(true)
    try {
      await poll(city)
    } finally {
      setPolling(false)
    }
  }

  const doExport = () =>
    exportCSV('kaspi-xray-competitors.csv', [
      { key: 'title', label: t('common.product') },
      { key: 'productId', label: t('common.sku') },
      { label: t('common.price'), value: (r) => r.last?.price ?? '' },
      { label: t('xray.buybox'), value: (r) => r.last?.buyBoxMerchant ?? '' },
      { label: t('xray.sellers_count'), value: (r) => r.last?.sellers ?? '' },
      { label: t('connect.est_sales'), value: (r) => r.last?.estSales ?? '' },
      { label: t('connect.est_revenue'), value: (r) => r.last?.estRevenue ?? '' },
    ], list)

  const openPublish = (c) => {
    setPublishTarget(c)
    setPublishForm({ sku: `KX-${c.productId}`, title: c.title || '', brand: '', category: '' })
    setPublishMsg(null)
    setPublishErr(null)
  }
  const updatePublish = (key, value) => setPublishForm((f) => ({ ...f, [key]: value }))
  const saveOpportunity = async () => {
    if (!publishTarget) return
    setPublishBusy(true); setPublishErr(null); setPublishMsg(null)
    try {
      await createOpportunity(publishTarget.id, { storeId: activeId, product: publishForm })
      setPublishMsg(t('competitors.opportunity_saved'))
    } catch {
      setPublishErr(t('competitors.opportunity_err'))
    } finally {
      setPublishBusy(false)
    }
  }
  const publishNow = async () => {
    if (!publishTarget) return
    setPublishBusy(true); setPublishErr(null); setPublishMsg(null)
    try {
      const r = await publishCompetitor(publishTarget.id, { storeId: activeId, product: publishForm })
      setPublishMsg(t('competitors.import_started', { code: r.result?.code || r.import?.code || '—' }))
    } catch (e) {
      setPublishErr(e.code === 'no_token' ? t('competitors.no_token') : e.code === 'missing_product_fields' ? t('competitors.missing_fields') : t('competitors.import_err'))
    } finally {
      setPublishBusy(false)
    }
  }

  return (
    <div className="fade-in">
      <PageHead title={t('competitors.title')} sub={t('competitors.subtitle')}>
        {list.length > 0 && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={doPoll} disabled={polling}>
              <span className={`msym ${polling ? 'spin' : ''}`}>{polling ? 'progress_activity' : 'refresh'}</span> {t('competitors.poll')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={doExport}><span className="msym">download</span> CSV</button>
          </>
        )}
      </PageHead>

      <Card className="connect-form" style={{ marginBottom: 18 }}>
        <div className="cf-row">
          <div className="search-box" style={{ maxWidth: 'none', flex: 1 }}>
            <span className="msym">add_business</span>
            <input className="input" placeholder={t('competitors.input_ph')} value={ref} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </div>
          <button className="btn btn-primary" onClick={add} disabled={busy}>
            <span className={`msym ${busy ? 'spin' : ''}`}>{busy ? 'progress_activity' : 'visibility'}</span> {t('competitors.add')}
          </button>
        </div>
        {err && <div className="cf-err"><span className="msym">error</span>{err}</div>}
      </Card>

      {loading && !list.length ? (
        <div className="xray-empty card card-pad"><span className="msym spin">progress_activity</span></div>
      ) : !list.length ? (
        <div className="xray-empty card card-pad">
          <span className="msym">monitoring</span>
          <p>{t('competitors.empty')}</p>
        </div>
      ) : (
        <Card pad={false}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="no-sort">{t('common.product')}</th>
                  <th className="no-sort t-right">{t('common.price')}</th>
                  <th className="no-sort t-right">{t('competitors.change')}</th>
                  <th className="no-sort">{t('xray.buybox')}</th>
                  <th className="no-sort t-right">{t('xray.sellers_count')}</th>
                  <th className="no-sort t-right">{t('connect.est_sales')}</th>
                  <th className="no-sort t-center">{t('watchlist.price_history')}</th>
                  <th className="no-sort"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const prices = [] // history sparkline built from points if present
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="pcell" style={{ cursor: 'pointer' }} onClick={() => navigate(`/xray?q=${c.productId}`)}>
                          <div className="pthumb" style={{ overflow: 'hidden' }}>
                            {c.image ? <img src={c.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span className="msym">inventory_2</span>}
                          </div>
                          <div>
                            <div className="pname" title={c.title}>{c.title}</div>
                            <div className="pmeta">{c.productId} · {c.points} {t('competitors.points')}</div>
                          </div>
                        </div>
                      </td>
                      <td className="t-right mono">{tenge(c.last?.price)}</td>
                      <td className={`t-right mono ${c.priceChange < 0 ? 'num-pos' : c.priceChange > 0 ? 'num-neg' : 'muted'}`}>
                        {c.priceChange ? tenge(c.priceChange, { sign: true }) : '—'}
                      </td>
                      <td className="muted">{c.last?.buyBoxMerchant || '—'}</td>
                      <td className="t-right mono">{num(c.last?.sellers || 0)}</td>
                      <td className="t-right mono">{num(c.last?.estSales || 0)} {t('xray.per_unit_short')}</td>
                      <td className="t-center">
                        <span className="soft" style={{ fontSize: 12 }}>{c.points} {t('watchlist.point')}</span>
                      </td>
                      <td className="t-right">
                        <button className="icon-btn" style={{ width: 32, height: 32, marginRight: 6 }} title={t('competitors.sell_action')} onClick={() => openPublish(c)}>
                          <span className="msym" style={{ fontSize: 18 }}>{opportunityIds.has(c.id) ? 'inventory' : 'add_business'}</span>
                        </button>
                        <button className="icon-btn" style={{ width: 32, height: 32 }} title={t('competitors.remove')} onClick={() => untrack(c.productId)}>
                          <span className="msym" style={{ fontSize: 18 }}>close</span>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {publishTarget && (
        <Card title={t('competitors.publish_title')} sub={t('competitors.publish_sub')} className="fade-in">
          <div className="publish-head">
            <div className="pcell">
              <div className="pthumb" style={{ overflow: 'hidden' }}>{publishTarget.image ? <img src={publishTarget.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span className="msym">inventory_2</span>}</div>
              <div>
                <div className="pname" title={publishTarget.title}>{publishTarget.title}</div>
                <div className="pmeta">{publishTarget.productId} · {tenge(publishTarget.last?.price || 0)}</div>
              </div>
            </div>
            <button className="icon-btn" title={t('common.close')} onClick={() => setPublishTarget(null)}><span className="msym">close</span></button>
          </div>
          <div className="publish-grid">
            <label><span className="field-label">{t('common.sku')}</span><input className="input mono" value={publishForm.sku} onChange={(e) => updatePublish('sku', e.target.value)} /></label>
            <label><span className="field-label">{t('common.product')}</span><input className="input" value={publishForm.title} onChange={(e) => updatePublish('title', e.target.value)} /></label>
            <label><span className="field-label">{t('common.brand')}</span><input className="input" value={publishForm.brand} onChange={(e) => updatePublish('brand', e.target.value)} placeholder={t('competitors.brand_ph')} /></label>
            <label><span className="field-label">{t('common.category')}</span><input className="input" value={publishForm.category} onChange={(e) => updatePublish('category', e.target.value)} placeholder={t('competitors.category_ph')} /></label>
          </div>
          <div className="cf-row" style={{ marginTop: 14, justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="mini-note" style={{ marginTop: 0 }}>
              <span className="msym">verified_user</span>
              {store?.hasToken ? t('competitors.token_ready') : t('competitors.no_token')}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" onClick={saveOpportunity} disabled={publishBusy}><span className="msym">draft</span> {t('competitors.save_opportunity')}</button>
              <button className="btn btn-primary" onClick={publishNow} disabled={publishBusy || !store?.hasToken}>
                <span className={`msym ${publishBusy ? 'spin' : ''}`}>{publishBusy ? 'progress_activity' : 'upload'}</span> {t('competitors.import_to_kaspi')}
              </button>
            </div>
          </div>
          {publishMsg && <div className="cf-ok"><span className="msym">check_circle</span>{publishMsg}</div>}
          {publishErr && <div className="cf-err"><span className="msym">error</span>{publishErr}</div>}
          <div className="mini-note"><span className="msym">info</span>{t('competitors.publish_note')}</div>
        </Card>
      )}

      {opportunities.length > 0 && (
        <div className="mini-note"><span className="msym">inventory</span>{t('competitors.opportunities_count', { n: opportunities.length })}</div>
      )}

      <div className="mini-note"><span className="msym">schedule</span>{t('competitors.note')}</div>
    </div>
  )
}
