import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useI18n, LANGS } from '../i18n/index.jsx'
import { useAppState, CITIES } from '../state/AppState.jsx'
import { useAuth } from '../state/Auth.jsx'
import { useAlerts } from '../state/Alerts.jsx'
import { tenge, pctSigned } from '../lib/format.js'

function timeAgo(ts, t) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return t('alerts.now')
  if (s < 3600) return `${Math.floor(s / 60)} ${t('alerts.min')}`
  if (s < 86400) return `${Math.floor(s / 3600)} ${t('alerts.hour')}`
  return `${Math.floor(s / 86400)} ${t('alerts.day')}`
}

function AlertRow({ a, t, onGo }) {
  const meta = {
    price_down: { icon: 'trending_down', cls: 'pos', txt: t('alerts.price_down') },
    price_up: { icon: 'trending_up', cls: 'neg', txt: t('alerts.price_up') },
    buybox: { icon: 'emoji_events', cls: 'warn', txt: t('alerts.buybox') },
    sellers: { icon: 'storefront', cls: 'muted', txt: t('alerts.sellers') },
  }[a.type] || { icon: 'notifications', cls: 'muted', txt: '' }
  const detail =
    a.type === 'price_down' || a.type === 'price_up'
      ? `${tenge(a.oldValue)} → ${tenge(a.newValue)} (${pctSigned(a.deltaPct, 1)})`
      : a.type === 'buybox'
        ? `${a.oldValue} → ${a.newValue}`
        : `${a.oldValue} → ${a.newValue} ${t('xray.sellers_count').toLowerCase()}`
  return (
    <button className={`alert-row ${a.read ? '' : 'unread'}`} onClick={() => onGo(a.productId)}>
      <span className={`alert-ic ${meta.cls}`}><span className="msym">{meta.icon}</span></span>
      <div className="alert-body">
        <div className="alert-title" title={a.title}>{a.title}</div>
        <div className="alert-detail">{meta.txt}: <b>{detail}</b></div>
      </div>
      <span className="alert-time">{timeAgo(a.ts, t)}</span>
    </button>
  )
}

function NotificationBell() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { alerts, unread, markAllRead, clear } = useAlerts()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && unread) markAllRead()
  }
  const go = (pid) => { setOpen(false); navigate(`/xray?q=${pid}`) }

  return (
    <div className="bell-wrap" ref={ref}>
      <button className="icon-btn bell-btn" onClick={toggle} title={t('alerts.title')}>
        <span className="msym">notifications</span>
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bell-head">
            <span>{t('alerts.title')}</span>
            {alerts.length > 0 && <button className="bell-clear" onClick={clear}>{t('alerts.clear')}</button>}
          </div>
          <div className="bell-list">
            {alerts.length === 0 ? (
              <div className="bell-empty"><span className="msym">notifications_off</span><p>{t('alerts.empty')}</p></div>
            ) : (
              alerts.map((a) => <AlertRow key={a.id} a={a} t={t} onGo={go} />)
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const NAV = [
  {
    section: 'section_store',
    items: [
      { to: '/', key: 'overview', icon: 'dashboard', end: true },
      { to: '/products', key: 'products', icon: 'inventory_2' },
      { to: '/repricer', key: 'repricer', icon: 'price_change' },
      { to: '/unit-economics', key: 'unit', icon: 'calculate' },
      { to: '/abc', key: 'abc', icon: 'donut_large' },
    ],
  },
  {
    section: 'section_market',
    items: [
      { to: '/xray', key: 'xray', icon: 'radar' },
      { to: '/competitors', key: 'competitors', icon: 'monitoring' },
      { to: '/market', key: 'market', icon: 'insights' },
    ],
  },
  {
    section: 'section_tools',
    items: [
      { to: '/calculator', key: 'calc', icon: 'percent' },
      { to: '/taobao', key: 'taobao', icon: 'shopping_bag' },
      { to: '/taobao/feed', key: 'feed', icon: 'rss_feed' },
      { to: '/admin', key: 'admin', icon: 'admin_panel_settings', adminOnly: true },
      { to: '/settings', key: 'settings', icon: 'tune' },
    ],
  },
]

function CitySelector() {
  const { city, setCity } = useAppState()
  return (
    <label className="city-select" title="Город (для продавцов и цен)">
      <span className="msym">location_on</span>
      <select value={city} onChange={(e) => setCity(e.target.value)}>
        {CITIES.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </label>
  )
}

function LangSwitcher() {
  const { lang, setLang } = useI18n()
  return (
    <div className="langsw" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l.code}
          className={l.code === lang ? 'on' : ''}
          onClick={() => setLang(l.code)}
          title={l.full}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}

function Sidebar({ open, onClose }) {
  const { t } = useI18n()
  const { store } = useAppState()
  const { user } = useAuth()
  const navigate = useNavigate()
  return (
    <>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">
            <span className="msym">radar</span>
          </div>
          <div className="brand-txt">
            <div className="brand-name">Kaspi <span>X-Ray</span></div>
            <div className="brand-tag">{t('brand.tag')}</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((grp) => (
            <div className="nav-grp" key={grp.section}>
              <div className="nav-grp-title">{t(`nav.${grp.section}`)}</div>
              {grp.items.filter((it) => !it.adminOnly || user?.role === 'admin').map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={onClose}
                >
                  <span className="msym">{it.icon}</span>
                  <span>{t(`nav.${it.key}`)}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <button className="side-cta card" onClick={() => { onClose(); navigate('/connect') }}>
          {store ? (
            <>
              <div className="side-cta-badge"><span className="msym" style={{ fontSize: 14, verticalAlign: '-2px' }}>storefront</span> {t('connect.connected')}</div>
              <div className="side-cta-title">{store.name}</div>
              <span className="btn btn-primary btn-sm"><span className="msym">insights</span> {t('connect.open')}</span>
            </>
          ) : (
            <>
              <div className="side-cta-badge"><span className="msym">storefront</span> {t('common.demo_note')}</div>
              <div className="side-cta-title">{t('topbar.connect')}</div>
              <span className="btn btn-primary btn-sm"><span className="msym">bolt</span> {t('topbar.connect')}</span>
            </>
          )}
        </button>
      </aside>
    </>
  )
}

export default function Shell({ children }) {
  const { t } = useI18n()
  const { store } = useAppState()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <div className="app">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn burger" onClick={() => setOpen(true)} aria-label="Menu">
            <span className="msym">menu</span>
          </button>
          <button className="store-chip" onClick={() => navigate('/connect')}>
            <span className="store-dot" style={store ? undefined : { background: 'var(--text-soft)', boxShadow: 'none' }} />
            <span className="store-name">{store ? store.name : t('topbar.not_connected')}</span>
            <span className={`pill ${store ? 'pos' : 'warn'}`}>{store ? t('connect.public_badge') : t('topbar.connect_cta')}</span>
          </button>
          <div className="topbar-right">
            <CitySelector />
            <NotificationBell />
            <LangSwitcher />
            <div className="user-menu">
              <button className="icon-btn" title={user?.email} onClick={() => setOpen(false) || logout()}>
                <span className="msym">logout</span>
              </button>
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
        <footer className="foot">
          <span>{t('footer.rights')}</span>
          <span className="soft">{t('footer.disclaimer')}</span>
        </footer>
      </div>
    </div>
  )
}
