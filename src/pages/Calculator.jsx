import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { PageHead, Card } from '../components/ui.jsx'
import { Waterfall } from '../components/Charts.jsx'
import { unitEconomics, recommendedPrice, breakEvenPrice } from '../lib/economics.js'
import { tenge, num, pct } from '../lib/format.js'

const TARGET_MARGIN = 25

function Field({ label, value, onChange, suffix }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          className="input mono"
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        {suffix && (
          <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-soft)', fontSize: 13, pointerEvents: 'none' }}>{suffix}</span>
        )}
      </div>
    </div>
  )
}

export default function Calculator() {
  const { t, lang } = useI18n()
  const [params] = useSearchParams()
  const seedPrice = Number(params.get('price'))
  const [f, setF] = useState({
    price: seedPrice > 0 ? seedPrice : 24900,
    purchase: seedPrice > 0 ? Math.round(seedPrice * 0.62) : 15200,
    commission: 12,
    tax: 3,
    delivery: 900,
    packaging: 250,
    returns: 6,
  })
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }))
  const clean = useMemo(() => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? 0 : v])), [f])

  const econ = useMemo(() => unitEconomics(clean), [clean])
  const recPrice = useMemo(() => recommendedPrice(clean, TARGET_MARGIN), [clean])
  const bePrice = useMemo(() => breakEvenPrice(clean), [clean])

  const wfLabels = {
    sale_price: t('unit.sale_price'),
    purchase: t('unit.purchase'),
    kaspi_commission: t('unit.kaspi_commission'),
    delivery: t('unit.delivery'),
    tax: t('unit.tax'),
    packaging: t('unit.packaging'),
    returns_cost: t('unit.returns_cost'),
    net: t('unit.net'),
  }

  return (
    <div className="fade-in">
      <PageHead title={t('calc.title')} sub={t('calc.subtitle')} />

      <div className="split">
        <Card title={t('calc.inputs')}>
          <div className="field-row">
            <Field label={t('unit.sale_price')} value={f.price} onChange={set('price')} suffix="₸" />
            <Field label={t('unit.purchase')} value={f.purchase} onChange={set('purchase')} suffix="₸" />
          </div>
          <div className="field-row">
            <Field label={t('calc.commission_pct')} value={f.commission} onChange={set('commission')} suffix="%" />
            <Field label={t('calc.tax_pct')} value={f.tax} onChange={set('tax')} suffix="%" />
          </div>
          <div className="field-row">
            <Field label={t('calc.delivery_cost')} value={f.delivery} onChange={set('delivery')} suffix="₸" />
            <Field label={t('calc.packaging_cost')} value={f.packaging} onChange={set('packaging')} suffix="₸" />
          </div>
          <Field label={t('calc.returns_pct')} value={f.returns} onChange={set('returns')} suffix="%" />
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Card>
            <div className="card-hd">
              <div className="card-title">{t('calc.result')}</div>
              {econ.isLoss ? (
                <span className="pill neg"><span className="msym">warning</span>{t('calc.unprofitable')}</span>
              ) : (
                <span className="pill pos"><span className="msym">check_circle</span>{t('calc.profitable')}</span>
              )}
            </div>

            <div className="result-hero">
              <span className={`rh-num ${econ.net < 0 ? 'neg' : 'pos'}`}>{tenge(econ.net, { sign: true })}</span>
              <span className="muted">{t('calc.net_per_unit')}</span>
            </div>

            <div className="metric-row">
              <div className="metric">
                <div className="m-lbl">{t('common.margin')}</div>
                <div className={`m-val ${econ.marginPct < 0 ? 'num-neg' : ''}`}>{pct(econ.marginPct, 1)}</div>
              </div>
              <div className="metric">
                <div className="m-lbl">{t('common.roi')}</div>
                <div className="m-val">{pct(econ.roiPct)}</div>
              </div>
              <div className="metric">
                <div className="m-lbl">{t('calc.break_even')}</div>
                <div className="m-val">{bePrice ? tenge(bePrice) : '—'}</div>
              </div>
            </div>

            {recPrice && (
              <div className="mini-note">
                <span className="msym">sell</span>
                {t('calc.recommend_price', { m: TARGET_MARGIN })}: <b style={{ color: 'var(--primary)', marginLeft: 4 }}>{tenge(recPrice)}</b>
              </div>
            )}
          </Card>

          <Card title={t('unit.waterfall')} sub={`${t('unit.margin_of_price')}: ${pct(econ.marginPct, 1)}`}>
            <Waterfall econ={econ} labels={wfLabels} lang={lang} />
          </Card>
        </div>
      </div>
    </div>
  )
}
