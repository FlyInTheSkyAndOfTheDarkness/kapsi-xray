import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { useAppState } from '../state/AppState.jsx'
import { useCompetitors } from '../state/Competitors.jsx'
import { PageHead, Card } from '../components/ui.jsx'
import { Sparkline } from '../components/Charts.jsx'
import { exportCSV } from '../lib/csv.js'
import { tenge, tengeShort, num, pctSigned } from '../lib/format.js'

export default function Competitors() {
  const { t, lang } = useI18n()
  const { city } = useAppState()
  const navigate = useNavigate()
  const { list, loading, track, untrack, poll } = useCompetitors()
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [polling, setPolling] = useState(false)

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

      <div className="mini-note"><span className="msym">schedule</span>{t('competitors.note')}</div>
    </div>
  )
}
