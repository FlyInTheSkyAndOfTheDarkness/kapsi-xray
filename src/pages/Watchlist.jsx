import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { useAppState } from '../state/AppState.jsx'
import { PageHead, Card } from '../components/ui.jsx'
import { Sparkline } from '../components/Charts.jsx'
import { getSnapshots } from '../lib/store.js'
import { exportCSV } from '../lib/csv.js'
import { tenge, tengeShort, num } from '../lib/format.js'

export default function Watchlist() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const { watchlist, removeWatch } = useAppState()

  // enrich each watched product with its latest observation snapshot
  const rows = watchlist
    .map((w) => {
      const snaps = getSnapshots(w.id)
      const last = snaps[snaps.length - 1] || null
      return { ...w, snaps, last, prices: snaps.map((s) => s.price) }
    })
    .sort((a, b) => (b.last?.estRevenue || 0) - (a.last?.estRevenue || 0))

  const doExport = () =>
    exportCSV(
      'kaspi-xray-watchlist.csv',
      [
        { key: 'title', label: t('common.product') },
        { key: 'id', label: t('common.sku') },
        { label: t('common.price'), value: (r) => r.last?.price ?? r.price },
        { label: t('xray.sellers_count'), value: (r) => r.last?.sellers ?? '' },
        { label: t('xray.est_sales'), value: (r) => r.last?.estSales ?? '' },
        { label: t('xray.est_revenue'), value: (r) => r.last?.estRevenue ?? '' },
      ],
      rows
    )

  return (
    <div className="fade-in">
      <PageHead title={t('watchlist.title')} sub={t('watchlist.subtitle')}>
        {rows.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={doExport}><span className="msym">download</span> CSV</button>
        )}
      </PageHead>

      {!rows.length ? (
        <div className="xray-empty card card-pad">
          <span className="msym">bookmark_add</span>
          <p>{t('watchlist.empty')}</p>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/xray')}>
            <span className="msym">radar</span> {t('nav.xray')}
          </button>
        </div>
      ) : (
        <Card pad={false}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="no-sort">{t('common.product')}</th>
                  <th className="no-sort t-right">{t('common.price')}</th>
                  <th className="no-sort t-right">{t('xray.est_sales')}</th>
                  <th className="no-sort t-right">{t('xray.est_revenue')}</th>
                  <th className="no-sort t-right">{t('xray.sellers_count')}</th>
                  <th className="no-sort t-center">{t('watchlist.price_history')}</th>
                  <th className="no-sort"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="pcell" style={{ cursor: 'pointer' }} onClick={() => navigate(`/xray?q=${r.id}`)}>
                        <div className="pthumb" style={{ overflow: 'hidden' }}>
                          {r.image ? <img src={r.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span className="msym">inventory_2</span>}
                        </div>
                        <div>
                          <div className="pname" title={r.title}>{r.title}</div>
                          <div className="pmeta">{r.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="t-right mono">{tenge(r.last?.price ?? r.price)}</td>
                    <td className="t-right mono">{r.last ? `${num(r.last.estSales)} ${t('xray.per_unit_short')}` : '—'}</td>
                    <td className="t-right mono">{r.last ? tengeShort(r.last.estRevenue, lang) : '—'}</td>
                    <td className="t-right mono">{r.last ? num(r.last.sellers) : '—'}</td>
                    <td className="t-center">
                      {r.prices.length > 1 ? <Sparkline data={r.prices} w={84} h={26} color="var(--primary)" /> : <span className="soft" style={{ fontSize: 12 }}>1 {t('watchlist.point')}</span>}
                    </td>
                    <td className="t-right">
                      <button className="icon-btn" style={{ width: 32, height: 32 }} title={t('watchlist.remove')} onClick={() => removeWatch(r.id)}>
                        <span className="msym" style={{ fontSize: 18 }}>close</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mini-note"><span className="msym">info</span>{t('watchlist.note')}</div>
    </div>
  )
}
