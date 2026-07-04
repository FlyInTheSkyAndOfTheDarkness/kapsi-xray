import { useMemo, useState } from 'react'
import { useI18n } from '../i18n/index.jsx'
import { PageHead, Card, Segmented } from '../components/ui.jsx'
import { BarList } from '../components/Charts.jsx'
import { CATEGORIES, BRANDS } from '../data/mockData.js'
import { exportCSV } from '../lib/csv.js'
import { tenge, tengeShort, num, pct } from '../lib/format.js'

/** Opportunity index: turnover captured per seller (demand ÷ competition),
    normalised to the strongest category => 0..100. High turnover with few
    sellers scores highest; a crowded category is penalised. */
function opportunity(cat, maxRevPerSeller) {
  const revPerSeller = cat.revenue / cat.sellers
  return Math.round(Math.max(8, Math.min(100, (revPerSeller / maxRevPerSeller) * 100)))
}

export default function Market() {
  const { t, lang } = useI18n()
  const [view, setView] = useState('cat')

  const maxRevPerSeller = Math.max(...CATEGORIES.map((c) => c.revenue / c.sellers))

  const cats = useMemo(
    () =>
      CATEGORIES.map((c) => ({ ...c, opp: opportunity(c, maxRevPerSeller) })).sort((a, b) => b.revenue - a.revenue),
    []
  )

  const demandLabel = (d) => t(`market.${d}`)
  const demandTone = { high: 'pos', mid: 'warn', low: '' }

  const catBars = cats.map((c) => ({ label: c.name, value: c.revenue, sub: `${num(c.sales)} ${t('market.market_sales')} · ${c.sellers} ${t('common.sellers')}` }))
  const brandBars = BRANDS.slice().sort((a, b) => b.revenue - a.revenue).map((b) => ({ label: b.name, value: b.revenue, sub: `${num(b.sales)} ${t('market.market_sales')} · ${b.sellers} ${t('common.sellers')}` }))

  const oppColor = (v) => (v >= 66 ? 'var(--success)' : v >= 40 ? 'var(--warning)' : 'var(--text-soft)')

  return (
    <div className="fade-in">
      <PageHead title={t('market.title')} sub={t('market.subtitle')}>
        <Segmented
          options={[
            { value: 'cat', label: t('market.by_category') },
            { value: 'brand', label: t('market.top_brands') },
          ]}
          value={view}
          onChange={setView}
        />
        <button
          className="btn btn-ghost btn-sm"
          onClick={() =>
            exportCSV(
              'kaspi-xray-market.csv',
              [
                { key: 'name', label: t('common.category') },
                { key: 'revenue', label: t('market.market_revenue') },
                { key: 'sales', label: t('market.market_sales') },
                { key: 'sellers', label: t('common.sellers') },
                { key: 'avgPrice', label: t('market.avg_price') },
                { key: 'opp', label: t('market.opportunity') },
              ],
              cats
            )
          }
        >
          <span className="msym">download</span> CSV
        </button>
      </PageHead>

      <div className="grid-2">
        <Card title={view === 'cat' ? t('market.by_category') : t('market.top_brands')} sub={t('market.market_revenue')}>
          <BarList items={view === 'cat' ? catBars : brandBars} lang={lang} valueFmt={(v) => tengeShort(v, lang)} />
        </Card>

        <Card title={t('market.opportunity')} sub={t('market.opp_hint')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {cats.map((c) => (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center' }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{c.name}</span>
                <span className="opp-meter">
                  <span className="opp-fill" style={{ width: `${c.opp}%`, background: oppColor(c.opp) }} />
                </span>
                <span className="mono" style={{ fontWeight: 700, minWidth: 34, textAlign: 'right', color: oppColor(c.opp) }}>{c.opp}</span>
              </div>
            ))}
          </div>
          <div className="mini-note">
            <span className="msym">lightbulb</span>
            {t('market.opp_hint')}
          </div>
        </Card>
      </div>

      <Card pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="no-sort">{t('common.category')}</th>
                <th className="no-sort t-right">{t('market.market_revenue')}</th>
                <th className="no-sort t-right">{t('market.market_sales')}</th>
                <th className="no-sort t-right">{t('common.sellers')}</th>
                <th className="no-sort t-right">{t('market.avg_price')}</th>
                <th className="no-sort t-center">{t('market.demand')}</th>
                <th className="no-sort t-right">{t('market.opportunity')}</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td className="t-right mono">{tenge(c.revenue)}</td>
                  <td className="t-right mono">{num(c.sales)}</td>
                  <td className="t-right mono">{num(c.sellers)}</td>
                  <td className="t-right mono">{tenge(c.avgPrice)}</td>
                  <td className="t-center"><span className={`pill ${demandTone[c.demand]}`}>{demandLabel(c.demand)}</span></td>
                  <td className="t-right mono" style={{ color: oppColor(c.opp), fontWeight: 700 }}>{c.opp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
