import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { pctSigned } from '../lib/format.js'

/** Empty state shown on "My store" pages when no store is connected. */
export function ConnectPrompt() {
  const { t } = useI18n()
  const navigate = useNavigate()
  return (
    <div className="xray-empty card card-pad fade-in">
      <span className="msym">add_business</span>
      <p style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 16 }}>{t('mystore.no_store_title')}</p>
      <p>{t('mystore.no_store_text')}</p>
      <button className="btn btn-primary" onClick={() => navigate('/connect')}>
        <span className="msym">storefront</span> {t('topbar.connect')}
      </button>
    </div>
  )
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div className="page-head-row">
        <div>
          <h1>{title}</h1>
          {sub && <p className="sub">{sub}</p>}
        </div>
        {children && <div className="page-head-aside">{children}</div>}
      </div>
    </div>
  )
}

/**
 * StatCard — a KPI tile (dataviz: a headline number is not a chart).
 * @param icon material symbol, value big number, label, delta (%), spark optional
 */
export function StatCard({ icon, label, value, delta, tone = 'neutral', sparkSlot, hint }) {
  const deltaTone = delta == null ? '' : delta >= 0 ? 'pos' : 'neg'
  return (
    <div className={`stat card ${tone}`}>
      <div className="stat-top">
        <span className="stat-ic msym">{icon}</span>
        {delta != null && (
          <span className={`pill ${deltaTone === 'pos' ? 'pos' : 'neg'}`}>
            <span className="msym">{delta >= 0 ? 'trending_up' : 'trending_down'}</span>
            {pctSigned(delta, 1)}
          </span>
        )}
      </div>
      <div className="stat-val mono">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
      {sparkSlot && <div className="stat-spark">{sparkSlot}</div>}
    </div>
  )
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Card({ title, sub, aside, children, className = '', pad = true }) {
  return (
    <section className={`card ${pad ? 'card-pad' : ''} ${className}`}>
      {(title || aside) && (
        <div className="card-hd">
          <div>
            {title && <div className="card-title">{title}</div>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}
