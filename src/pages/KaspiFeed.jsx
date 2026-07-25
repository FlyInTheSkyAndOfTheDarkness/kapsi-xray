import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { useStore } from '../state/Store.jsx'
import { API } from '../lib/api.js'
import { tenge } from '../lib/format.js'
import { Card, ConnectPrompt, PageHead, Segmented } from '../components/ui.jsx'
import TaobaoTabs from '../components/TaobaoTabs.jsx'

/* Issues are ordered by how much they block the offer: the first four keep the
   product out of the XML entirely, the rest are advisory. */
const BLOCKING = ['no_sku', 'no_model', 'no_price', 'no_warehouse', 'duplicate_sku']

function WarehouseEditor({ rows, onChange, t }) {
  const patch = (index, changes) => onChange(rows.map((row, i) => (i === index ? { ...row, ...changes } : row)))
  return (
    <div className="feed-warehouses">
      {rows.map((row, index) => (
        <div className="feed-warehouse-row" key={index}>
          <input
            className="input mono"
            value={row.id}
            onChange={(event) => patch(index, { id: event.target.value })}
            placeholder={t('feed.warehouses_ph')}
          />
          <Segmented
            options={[{ value: 'yes', label: t('feed.wh_yes') }, { value: 'no', label: t('feed.wh_no') }]}
            value={row.available ? 'yes' : 'no'}
            onChange={(value) => patch(index, { available: value === 'yes' })}
          />
          <button className="icon-btn" title={t('preorder_detail.remove')} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            <span className="msym">delete</span>
          </button>
        </div>
      ))}
      {!rows.length && <div className="preorder-section-empty">{t('feed.wh_empty')}</div>}
      <button className="btn btn-ghost btn-sm" onClick={() => onChange([...rows, { id: '', available: rows.length === 0 }])}>
        <span className="msym">add</span>{t('feed.wh_add')}
      </button>
    </div>
  )
}

function dateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function emptyForm() {
  return {
    active: true,
    company: '',
    warehouses: [],
    preorderDays: 14,
    stock: 10,
    includePaused: true,
    autoPublish: false,
    basicLogin: '',
    basicPassword: '',
  }
}

function formFromFeed(feed) {
  return {
    active: feed.active !== false,
    company: feed.company || '',
    warehouses: (feed.warehouses || []).map((row) => ({ id: row.id, available: row.available !== false })),
    preorderDays: feed.preorderDays ?? 14,
    stock: feed.stock ?? 10,
    includePaused: feed.includePaused !== false,
    autoPublish: !!feed.autoPublish,
    basicLogin: feed.basicLogin || '',
    basicPassword: '',
  }
}

export default function KaspiFeed() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { stores, activeId, setActive } = useStore()
  const [data, setData] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [xml, setXml] = useState('')
  const [check, setCheck] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async (storeId) => {
    if (!storeId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setCheck(null)
    try {
      const result = await API.kaspiFeed(storeId)
      setData(result)
      setForm(formFromFeed(result.feed))
      setXml(await API.kaspiFeedXml(storeId).catch(() => ''))
    } catch {
      setError(t('feed.load_error'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setMessage('')
  }

  const applyResult = (result) => {
    setData(result)
    setForm(formFromFeed(result.feed))
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const body = {
        ...form,
        warehouses: form.warehouses.filter((row) => row.id.trim()),
        preorderDays: Number(form.preorderDays) || 1,
        stock: Number(form.stock) || 0,
      }
      // An empty password field means "keep the stored one".
      if (!body.basicPassword) delete body.basicPassword
      applyResult(await API.saveKaspiFeed(activeId, body))
      setXml(await API.kaspiFeedXml(activeId).catch(() => ''))
      setMessage(t('feed.saved'))
    } catch {
      setError(t('feed.save_error'))
    } finally {
      setSaving(false)
    }
  }

  const rotate = async () => {
    if (!window.confirm(t('feed.rotate_confirm'))) return
    setSaving(true)
    setError('')
    try {
      applyResult(await API.rotateKaspiFeed(activeId))
      setCheck(null)
      setMessage(t('feed.rotated'))
    } catch {
      setError(t('feed.save_error'))
    } finally {
      setSaving(false)
    }
  }

  const runCheck = async () => {
    setChecking(true)
    setError('')
    try {
      setCheck(await API.checkKaspiFeed(activeId))
    } catch {
      setError(t('feed.check_error'))
    } finally {
      setChecking(false)
    }
  }

  const copy = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      window.setTimeout(() => setCopied(''), 1800)
    } catch {
      setError(t('feed.copy_error'))
    }
  }

  if (!stores.length) return <ConnectPrompt />

  const feed = data?.feed
  const entries = data?.entries || []
  const blocked = entries.filter((entry) => !entry.included)
  const store = stores.find((item) => item.id === activeId) || null

  // Everything that has to be true before the link is pasted into the Kaspi cabinet.
  const selling = (feed?.warehouses || []).filter((row) => row.available)
  const readiness = feed ? [
    { key: 'public', ok: !/localhost|127\.0\.0\.1/.test(feed.url), detail: feed.url },
    { key: 'reachable', ok: !!check?.ok, detail: check ? (check.ok ? t('feed.ready_reachable_ok') : t('feed.ready_reachable_no')) : t('feed.ready_reachable_unknown') },
    { key: 'warehouses', ok: selling.length > 0, detail: selling.map((row) => row.id).join(', ') || t('feed.wh_empty') },
    { key: 'offers', ok: data.offerCount > 0, detail: t('feed.ready_offers_detail', { included: data.offerCount, total: entries.length }) },
    { key: 'fetched', ok: !!feed.lastFetchAt, detail: feed.lastFetchAt ? dateTime(feed.lastFetchAt) : t('feed.never_fetched') },
  ] : []

  return (
    <div className="fade-in">
      <PageHead title={t('feed.title')} sub={t('feed.subtitle')}>
        <select className="select" value={activeId || ''} onChange={(event) => setActive(event.target.value)}>
          {stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={save} disabled={saving || loading}>
          <span className={`msym ${saving ? 'spin' : ''}`}>{saving ? 'progress_activity' : 'save'}</span>
          {t('feed.save')}
        </button>
      </PageHead>
      <TaobaoTabs />

      {(message || error) && <div className={error ? 'cf-err' : 'cf-ok'}><span className="msym">{error ? 'error' : 'check_circle'}</span>{error || message}</div>}

      {loading ? (
        <div className="preorder-empty"><span className="msym spin">progress_activity</span><p>{t('feed.loading')}</p></div>
      ) : !feed ? (
        <div className="preorder-empty"><span className="msym">rss_feed</span><p>{t('feed.load_error')}</p></div>
      ) : (
        <>
          <Card title={t('feed.ready_title')} sub={t('feed.ready_sub')}>
            <ul className="feed-ready">
              {readiness.map((item) => (
                <li key={item.key} className={item.ok ? 'ok' : 'todo'}>
                  <span className="msym">{item.ok ? 'check_circle' : 'radio_button_unchecked'}</span>
                  <div><b>{t(`feed.ready_${item.key}`)}</b><span>{item.detail}</span></div>
                </li>
              ))}
            </ul>
            <div className="mini-note warn">
              <span className="msym">warning</span>{t('feed.assortment_warning')}
            </div>
          </Card>

          <Card title={t('feed.url_title')} sub={t('feed.url_sub')}>
            <div className="feed-url-row">
              <input className="input mono feed-url" value={feed.url} readOnly onFocus={(event) => event.target.select()} />
              <button className="btn btn-ghost" onClick={() => copy(feed.url, 'url')}>
                <span className="msym">{copied === 'url' ? 'check' : 'content_copy'}</span>
                {copied === 'url' ? t('feed.copied') : t('feed.copy')}
              </button>
              <button className="btn btn-ghost" onClick={runCheck} disabled={checking}>
                <span className={`msym ${checking ? 'spin' : ''}`}>{checking ? 'progress_activity' : 'network_check'}</span>
                {t('feed.check')}
              </button>
              <button className="btn btn-ghost danger" onClick={rotate} disabled={saving}>
                <span className="msym">autorenew</span>{t('feed.rotate')}
              </button>
            </div>

            {check && (
              <div className={check.ok ? 'cf-ok' : 'cf-err'}>
                <span className="msym">{check.ok ? 'check_circle' : 'error'}</span>
                {check.ok
                  ? t('feed.check_ok', { offers: check.offers, bytes: check.bytes })
                  : check.reachable === false
                    ? t('feed.check_unreachable')
                    : check.status === 409
                      ? t('feed.check_empty')
                      : t('feed.check_bad', { status: check.status || '—', type: check.contentType || '—' })}
              </div>
            )}

            <ol className="feed-steps">
              <li>{t('feed.step_1')}</li>
              <li>{t('feed.step_2')}</li>
              <li>{t('feed.step_3')}</li>
              <li>{t('feed.step_4')}</li>
            </ol>

            <div className="feed-stats">
              <div><span>{t('feed.offers_now')}</span><b>{data.offerCount}</b></div>
              <div><span>{t('feed.last_fetch')}</span><b>{dateTime(feed.lastFetchAt)}</b></div>
              <div><span>{t('feed.fetch_count')}</span><b>{feed.fetchCount}</b></div>
              <div><span>{t('feed.merchant_id')}</span><b className="mono">{store?.merchantId || '—'}</b></div>
            </div>
            {!feed.lastFetchAt && <div className="mini-note"><span className="msym">schedule</span>{t('feed.never_fetched')}</div>}
          </Card>

          <div className="feed-grid">
            <Card title={t('feed.settings_title')} sub={t('feed.settings_sub')}>
              <div className="preorder-form-grid">
                <div className="span-2">
                  <span className="field-label">{t('feed.warehouses')}</span>
                  <WarehouseEditor rows={form.warehouses} onChange={(rows) => setField('warehouses', rows)} t={t} />
                  <span className="field-hint">{t('feed.warehouses_hint')}</span>
                </div>
                <label>
                  <span className="field-label">{t('feed.preorder_days')}</span>
                  <input className="input mono" type="number" min="1" max="30" value={form.preorderDays} onChange={(event) => setField('preorderDays', event.target.value)} />
                  <span className="field-hint">{t('feed.preorder_days_hint')}</span>
                </label>
                <label>
                  <span className="field-label">{t('feed.stock')}</span>
                  <input className="input mono" type="number" min="0" value={form.stock} onChange={(event) => setField('stock', event.target.value)} />
                  <span className="field-hint">{t('feed.stock_hint')}</span>
                </label>
                <label className="span-2">
                  <span className="field-label">{t('feed.company')}</span>
                  <input className="input" value={form.company} onChange={(event) => setField('company', event.target.value)} placeholder={store?.name || ''} />
                </label>
              </div>
              <label className="feed-toggle">
                <input type="checkbox" checked={form.active} onChange={(event) => setField('active', event.target.checked)} />
                <span><b>{t('feed.active')}</b>{t('feed.active_hint')}</span>
              </label>
              <label className="feed-toggle">
                <input type="checkbox" checked={form.includePaused} onChange={(event) => setField('includePaused', event.target.checked)} />
                <span><b>{t('feed.include_paused')}</b>{t('feed.include_paused_hint')}</span>
              </label>
              <label className="feed-toggle">
                <input type="checkbox" checked={form.autoPublish} onChange={(event) => setField('autoPublish', event.target.checked)} />
                <span><b>{t('feed.auto_publish')}</b>{t('feed.auto_publish_hint')}</span>
              </label>
            </Card>

            <Card title={t('feed.auth_title')} sub={t('feed.auth_sub')}>
              <div className="preorder-form-grid">
                <label className="span-2">
                  <span className="field-label">{t('feed.login')}</span>
                  <input className="input" autoComplete="off" value={form.basicLogin} onChange={(event) => setField('basicLogin', event.target.value)} placeholder={t('feed.login_ph')} />
                </label>
                <label className="span-2">
                  <span className="field-label">{t('feed.password')}</span>
                  <input className="input" type="password" autoComplete="new-password" value={form.basicPassword} onChange={(event) => setField('basicPassword', event.target.value)} placeholder={feed.hasBasicPassword ? t('feed.password_saved') : t('feed.password_ph')} />
                </label>
              </div>
              <div className="mini-note"><span className="msym">info</span>{t('feed.auth_note')}</div>
            </Card>
          </div>

          <Card
            className="feed-entries"
            pad={false}
            title={t('feed.entries_title')}
            sub={t('feed.entries_sub', { included: data.offerCount, total: entries.length })}
          >
            {!entries.length ? (
              <div className="preorder-empty">
                <span className="msym">inventory_2</span>
                <p>{t('feed.entries_empty')}</p>
                <button className="btn btn-primary" onClick={() => navigate('/taobao')}><span className="msym">add</span>{t('preorders.add')}</button>
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{t('preorders.product')}</th>
                      <th>{t('common.sku')}</th>
                      <th>{t('products.sale_price')}</th>
                      <th>{t('feed.preorder_col')}</th>
                      <th>{t('feed.warehouses')}</th>
                      <th>{t('feed.state')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <button className="preorder-title" onClick={() => navigate(`/taobao/preorders/${entry.id}`)}>{entry.title}</button>
                        </td>
                        <td className="mono" data-label={t('common.sku')}>{entry.sku || '—'}</td>
                        <td data-label={t('products.sale_price')}>{entry.price ? tenge(entry.price) : '—'}</td>
                        <td data-label={t('feed.preorder_col')}>{entry.preorderDays} {t('preorders.days')} · {entry.stock ?? '—'} {t('feed.pcs')}</td>
                        <td data-label={t('feed.warehouses')}>
                          {entry.warehouses.length ? entry.warehouses.map((warehouse) => (
                            <span key={warehouse.id} className={`feed-wh-chip mono ${warehouse.available ? 'on' : ''}`}>
                              <span className="msym">{warehouse.available ? 'check' : 'close'}</span>{warehouse.id}
                            </span>
                          )) : '—'}
                        </td>
                        <td data-label={t('feed.state')}>
                          {entry.included
                            ? <span className="pill pos"><span className="msym">check_circle</span>{entry.paused ? t('feed.state_paused') : t('feed.state_included')}</span>
                            : <span className="pill neg"><span className="msym">block</span>{t('feed.state_blocked')}</span>}
                          {entry.issues.map((issue) => (
                            <div key={issue} className={BLOCKING.includes(issue) ? 'feed-issue blocking' : 'feed-issue'}>
                              <span className="msym">{BLOCKING.includes(issue) ? 'error' : 'info'}</span>{t(`feed.issue_${issue}`)}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {!!blocked.length && (
            <div className="mini-note warn"><span className="msym">warning</span>{t('feed.blocked_note', { count: blocked.length })}</div>
          )}

          <details className="feed-preview">
            <summary><span className="msym">code</span>{t('feed.preview_title')}</summary>
            <div className="feed-preview-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => copy(xml, 'xml')}>
                <span className="msym">{copied === 'xml' ? 'check' : 'content_copy'}</span>{t('feed.copy_xml')}
              </button>
            </div>
            <pre className="feed-xml mono">{xml || '—'}</pre>
          </details>
        </>
      )}
    </div>
  )
}
