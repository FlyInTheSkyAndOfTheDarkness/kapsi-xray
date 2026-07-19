import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n/index.jsx'
import { API } from '../lib/api.js'
import { num } from '../lib/format.js'
import { Card, PageHead } from '../components/ui.jsx'

const EMPTY = { metrics: {}, users: [], grants: [] }

function fmtDate(ts, lang) {
  if (!ts) return '—'
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}

function Stat({ icon, value, label, hint, cls = '' }) {
  return (
    <Card className={`stat ${cls}`}>
      <div className="stat-top">
        <span className="stat-ic msym">{icon}</span>
      </div>
      <div className="stat-val">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </Card>
  )
}

function statusPill(status, t) {
  return status === 'blocked'
    ? <span className="pill neg"><span className="msym">block</span>{t('admin.status_blocked')}</span>
    : <span className="pill pos"><span className="msym">check_circle</span>{t('admin.status_active')}</span>
}

function rolePill(role, t) {
  return role === 'admin'
    ? <span className="pill brand"><span className="msym">admin_panel_settings</span>{t('admin.role_admin')}</span>
    : <span className="pill"><span className="msym">person</span>{t('admin.role_user')}</span>
}

export default function Admin() {
  const { t, lang } = useI18n()
  const [data, setData] = useState(EMPTY)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('user')
  const [status, setStatus] = useState('active')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const load = async () => {
    setErr(null)
    try {
      setData(await API.adminSummary())
    } catch {
      setErr(t('admin.err_load'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const pendingGrants = useMemo(() => (data.grants || []).filter((grant) => !grant.registered), [data.grants])

  const grant = async (event) => {
    event.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const result = await API.adminGrantAccess({ email, role, status })
      setData(result.summary || EMPTY)
      setEmail('')
      setRole('user')
      setStatus('active')
    } catch (e) {
      setErr(e.code === 'bad_email' ? t('admin.err_email') : e.code === 'last_admin' ? t('admin.err_last_admin') : t('admin.err_save'))
    } finally {
      setBusy(false)
    }
  }

  const updateUser = async (user, patch) => {
    setErr(null)
    try {
      const result = await API.adminUpdateUser(user.id, patch)
      setData(result.summary || EMPTY)
    } catch (e) {
      setErr(e.code === 'last_admin' ? t('admin.err_last_admin') : t('admin.err_save'))
    }
  }

  const metrics = data.metrics || {}

  return (
    <div className="fade-in">
      <PageHead title={t('admin.title')} sub={t('admin.subtitle')} />

      <div className="stat-grid">
        <Stat icon="group" value={num(metrics.users || 0)} label={t('admin.metric_users')} hint={`${num(metrics.activeUsers || 0)} ${t('admin.metric_active')}`} />
        <Stat icon="storefront" value={num(metrics.stores || 0)} label={t('admin.metric_stores')} hint={`${num(metrics.storesWithToken || 0)} ${t('admin.metric_tokens')}`} cls="good" />
        <Stat icon="inventory_2" value={num(metrics.products || 0)} label={t('admin.metric_products')} />
        <Stat icon="shopping_bag" value={num(metrics.taobaoProducts || 0)} label={t('admin.metric_taobao')} hint={`${num(metrics.imports || 0)} ${t('admin.metric_imports')}`} cls="gold" />
        <Stat icon="price_change" value={num(metrics.repricers || 0)} label={t('admin.metric_repricers')} hint={`${num(metrics.competitors || 0)} ${t('admin.metric_competitors')}`} />
      </div>

      <div className="admin-grid">
        <Card className="card-pad admin-access-card">
          <div className="card-hd">
            <div>
              <div className="card-title">{t('admin.access_title')}</div>
              <div className="card-sub">{t('admin.access_sub')}</div>
            </div>
          </div>
          <form className="admin-access-form" onSubmit={grant}>
            <label>
              <span className="field-label">{t('auth.email')}</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seller@shop.kz" required />
            </label>
            <label>
              <span className="field-label">{t('admin.role')}</span>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="user">{t('admin.role_user')}</option>
                <option value="admin">{t('admin.role_admin')}</option>
              </select>
            </label>
            <label>
              <span className="field-label">{t('admin.status')}</span>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">{t('admin.status_active')}</option>
                <option value="blocked">{t('admin.status_blocked')}</option>
              </select>
            </label>
            <button className="btn btn-primary" disabled={busy}>
              <span className={`msym ${busy ? 'spin' : ''}`}>{busy ? 'progress_activity' : 'person_add'}</span>
              {t('admin.grant')}
            </button>
          </form>
          {err && <div className="cf-err admin-error"><span className="msym">error</span>{err}</div>}
        </Card>

        <Card className="card-pad">
          <div className="card-hd">
            <div>
              <div className="card-title">{t('admin.pending_title')}</div>
              <div className="card-sub">{t('admin.pending_sub')}</div>
            </div>
            <span className="pill">{pendingGrants.length}</span>
          </div>
          <div className="admin-grant-list">
            {pendingGrants.length ? pendingGrants.map((grant) => (
              <div className="admin-grant-row" key={grant.id}>
                <div>
                  <b>{grant.email}</b>
                  <span>{fmtDate(grant.updatedAt || grant.createdAt, lang)}</span>
                </div>
                <div className="admin-grant-meta">{rolePill(grant.role, t)}{statusPill(grant.status, t)}</div>
              </div>
            )) : <div className="admin-empty">{t('admin.pending_empty')}</div>}
          </div>
        </Card>
      </div>

      <Card pad={false}>
        <div className="card-hd admin-table-head">
          <div>
            <div className="card-title">{t('admin.users_title')}</div>
            <div className="card-sub">{t('admin.users_sub')}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            <span className={`msym ${loading ? 'spin' : ''}`}>{loading ? 'progress_activity' : 'refresh'}</span>
            {t('admin.refresh')}
          </button>
        </div>
        <div className="tbl-wrap">
          <table className="tbl admin-users-table">
            <thead>
              <tr>
                <th className="no-sort">{t('admin.user')}</th>
                <th className="no-sort">{t('admin.access')}</th>
                <th className="no-sort t-right">{t('admin.metric_stores')}</th>
                <th className="no-sort t-right">{t('admin.metric_products')}</th>
                <th className="no-sort t-right">{t('admin.metric_taobao')}</th>
                <th className="no-sort t-right">{t('admin.metric_competitors')}</th>
                <th className="no-sort">{t('admin.activity')}</th>
                <th className="no-sort t-right">{t('admin.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(data.users || []).map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="admin-user-cell">
                      <span className="admin-avatar">{user.email.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <b>{user.email}</b>
                        <span>ID {user.id.slice(0, 8)} · {fmtDate(user.createdAt, lang)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="admin-pill-stack">
                      {rolePill(user.role, t)}
                      {statusPill(user.status, t)}
                    </div>
                  </td>
                  <td className="t-right mono">
                    {num(user.metrics.stores)}
                    <div className="tiny-muted">{num(user.metrics.storesWithToken)} {t('admin.metric_tokens')}</div>
                  </td>
                  <td className="t-right mono">{num(user.metrics.products)}</td>
                  <td className="t-right mono">
                    {num(user.metrics.taobaoProducts)}
                    <div className="tiny-muted">{num(user.metrics.imports)} {t('admin.metric_imports')}</div>
                  </td>
                  <td className="t-right mono">
                    {num(user.metrics.competitors)}
                    <div className="tiny-muted">{num(user.metrics.repricers)} {t('admin.metric_repricers_short')}</div>
                  </td>
                  <td>
                    <div className="admin-activity">
                      <b>{fmtDate(user.lastLoginAt, lang)}</b>
                      <span>{t('admin.last_action')}: {fmtDate(user.metrics.lastActivityAt, lang)}</span>
                    </div>
                  </td>
                  <td className="t-right">
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => updateUser(user, { role: user.role === 'admin' ? 'user' : 'admin' })}>
                        <span className="msym">{user.role === 'admin' ? 'person' : 'admin_panel_settings'}</span>
                      </button>
                      <button className={`btn btn-sm ${user.status === 'active' ? 'btn-danger' : 'btn-primary'}`} onClick={() => updateUser(user, { status: user.status === 'active' ? 'blocked' : 'active' })}>
                        <span className="msym">{user.status === 'active' ? 'block' : 'check_circle'}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!data.users?.length && <tr><td colSpan={8} className="t-center muted" style={{ padding: 36 }}>{loading ? t('common.loading') : t('common.nothing')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
