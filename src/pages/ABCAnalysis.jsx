import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { PageHead, Card, ConnectPrompt } from '../components/ui.jsx'
import { ParetoCurve } from '../components/Charts.jsx'
import { useStore } from '../state/Store.jsx'
import { classifyABC, sum } from '../lib/economics.js'
import { tenge, num, pct } from '../lib/format.js'

export default function ABCAnalysis() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { hasStore, products, loading } = useStore()

  // ABC by estimated revenue (turnover) — always available for the public catalog
  const classified = useMemo(
    () => classifyABC(products.map((p) => ({ id: p.id, name: p.title, categoryName: p.categoryName, sales: p.est?.sales || 0, revenue: p.est?.revenue || 0, marginPct: p.profit?.marginPct, totalProfit: p.est?.revenue || 0 }))),
    [products]
  )

  if (!hasStore && !loading) return <div className="fade-in"><PageHead title={t('abc.title')} sub={t('abc.subtitle_real')} /><ConnectPrompt /></div>

  const groups = ['A', 'B', 'C'].map((g) => {
    const items = classified.filter((x) => x.abc === g)
    return { g, items, revenue: sum(items, (x) => x.revenue), count: items.length }
  })
  const totalRev = sum(groups, (x) => x.revenue) || 1
  const descKey = { A: 'a_desc', B: 'b_desc', C: 'c_desc' }

  return (
    <div className="fade-in">
      <PageHead title={t('abc.title')} sub={t('abc.subtitle_real')} />

      <div className="abc-cards">
        {groups.map(({ g, revenue, count }) => (
          <div className={`abc-card ${g.toLowerCase()}`} key={g}>
            <div className="ac-grade">{g}</div>
            <div className="ac-desc">{t(`abc.${descKey[g]}`)}</div>
            <div className="ac-stats">
              <div className="ac-stat"><b>{count}</b><span>{t('abc.products_in')}</span></div>
              <div className="ac-stat"><b>{pct((revenue / totalRev) * 100)}</b><span>{t('abc.share_rev')}</span></div>
              <div className="ac-stat"><b>{tenge(revenue)}</b><span>{t('common.revenue')}</span></div>
            </div>
          </div>
        ))}
      </div>

      <Card title={t('abc.pareto')} sub={t('abc.cum_share_rev')}>
        <ParetoCurve items={classified} labels={{ cum_share: t('abc.cum_share_rev') }} />
      </Card>
      <div style={{ height: 18 }} />

      <Card pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th className="no-sort">{t('abc.group')}</th>
              <th className="no-sort">{t('common.product')}</th>
              <th className="no-sort t-right">{t('common.sales')}</th>
              <th className="no-sort t-right">{t('common.revenue')}</th>
              <th className="no-sort t-right">{t('common.margin')}</th>
              <th className="no-sort t-right">{t('abc.cum_share_rev')}</th>
              <th className="no-sort"></th>
            </tr></thead>
            <tbody>
              {classified.map((p) => (
                <tr key={p.id}>
                  <td><span className={`badge-abc ${p.abc.toLowerCase()}`}>{p.abc}</span></td>
                  <td><div className="pname" title={p.name}>{p.name}</div><div className="pmeta">{p.categoryName}</div></td>
                  <td className="t-right mono">{num(p.sales)}</td>
                  <td className="t-right mono">{tenge(p.revenue)}</td>
                  <td className="t-right mono">{p.marginPct != null ? pct(p.marginPct, 1) : '—'}</td>
                  <td className="t-right mono muted">{pct(p.cumShare, 1)}</td>
                  <td className="t-right"><button className="btn btn-ghost btn-sm" onClick={() => navigate(`/xray?q=${p.id}`)}><span className="msym">radar</span></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
