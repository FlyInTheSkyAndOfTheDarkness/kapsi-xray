import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { API } from '../lib/api.js'
import { tenge } from '../lib/format.js'
import { Card, PageHead, Segmented } from '../components/ui.jsx'
import TaobaoTabs from '../components/TaobaoTabs.jsx'

const STATUS_META = {
  draft: { icon: 'edit_note', tone: 'brand' },
  processing: { icon: 'hourglass_top', tone: 'warn' },
  verifying: { icon: 'manage_search', tone: 'warn' },
  published: { icon: 'check_circle', tone: 'pos' },
  rejected: { icon: 'cancel', tone: 'neg' },
}

function dateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function StatusPill({ state, t }) {
  const meta = STATUS_META[state] || STATUS_META.processing
  return (
    <span className={`pill ${meta.tone}`}>
      <span className="msym">{meta.icon}</span>
      {t(`preorders.status_${state || 'processing'}`)}
    </span>
  )
}

export default function TaobaoPreorders() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [retrying, setRetrying] = useState('')
  const [error, setError] = useState('')

  const load = async ({ sync = false, quiet = false } = {}) => {
    if (!quiet) sync ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const data = sync ? await API.refreshTaobaoPreorders() : await API.taobaoPreorders()
      setRows(data.preorders || [])
    } catch {
      setError(t('preorders.load_error'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load({ sync: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasProcessing = rows.some((row) => ['processing', 'verifying'].includes(row.import?.state))
  useEffect(() => {
    if (!hasProcessing) return undefined
    const timer = window.setInterval(() => load({ sync: true, quiet: true }), 20_000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProcessing])

  const counts = useMemo(() => rows.reduce((acc, row) => {
    const state = row.import?.state || 'processing'
    acc[state] = (acc[state] || 0) + 1
    return acc
  }, { draft: 0, processing: 0, verifying: 0, published: 0, rejected: 0 }), [rows])

  // Kaspi pulled the price list but the product is still unlinked in the cabinet.
  const awaitingLink = rows.filter((row) => row.stage === 'awaiting_link').length

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter !== 'all' && row.import?.state !== filter) return false
      return !query || `${row.title} ${row.sku} ${row.store?.name || ''}`.toLowerCase().includes(query)
    })
  }, [rows, filter, search])

  const retry = async (row) => {
    setRetrying(row.id)
    setError('')
    try {
      await API.retryTaobaoPreorder(row.id)
      await load({ sync: true, quiet: true })
    } catch (e) {
      setError(e.code === 'no_token' ? t('preorders.no_token') : t('preorders.retry_error'))
      await load({ quiet: true })
    } finally {
      setRetrying('')
    }
  }

  const filters = [
    { value: 'all', label: `${t('preorders.filter_all')} ${rows.length}` },
    { value: 'draft', label: `${t('preorders.status_draft')} ${counts.draft}` },
    { value: 'processing', label: `${t('preorders.status_processing')} ${counts.processing}` },
    { value: 'verifying', label: `${t('preorders.status_verifying')} ${counts.verifying}` },
    { value: 'published', label: `${t('preorders.status_published')} ${counts.published}` },
    { value: 'rejected', label: `${t('preorders.status_rejected')} ${counts.rejected}` },
  ]

  return (
    <div className="fade-in">
      <PageHead title={t('preorders.title')} sub={t('preorders.subtitle')}>
        <button className="btn btn-ghost" onClick={() => load({ sync: true })} disabled={refreshing}>
          <span className={`msym ${refreshing ? 'spin' : ''}`}>{refreshing ? 'progress_activity' : 'sync'}</span>
          {t('preorders.refresh')}
        </button>
        <button className="btn btn-primary" onClick={() => navigate('/taobao')}>
          <span className="msym">add</span>{t('preorders.add')}
        </button>
      </PageHead>
      <TaobaoTabs preorderCount={rows.length} />

      {awaitingLink > 0 && (
        <div className="preorder-link-banner">
          <span className="msym">link_off</span>
          <div>
            <b>{t('preorders.awaiting_link_title', { count: awaitingLink })}</b>
            <span>{t('preorders.awaiting_link_how')}</span>
          </div>
          <a className="btn btn-primary btn-sm" href="https://kaspi.kz/mc/#/unrecognized" target="_blank" rel="noreferrer">
            <span className="msym">open_in_new</span>{t('preorders.open_cabinet')}
          </a>
        </div>
      )}

      <Card className="preorders-list" pad={false} title={t('preorders.list_title')} sub={t('preorders.list_sub')} aside={(
        <input className="input preorder-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('preorders.search')} />
      )}>
        <div className="preorders-toolbar">
          <div className="preorder-filter-control">
            <Segmented options={filters} value={filter} onChange={setFilter} />
            <select className="select preorder-filter-select" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t('preorders.status')}>
              {filters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          {hasProcessing && <span className="preorder-auto"><span className="status-dot" />{t('preorders.auto_refresh')}</span>}
        </div>

        {error && <div className="cf-err preorder-message"><span className="msym">error</span>{error}</div>}
        {loading ? (
          <div className="preorder-empty"><span className="msym spin">progress_activity</span><p>{t('preorders.loading')}</p></div>
        ) : visible.length === 0 ? (
          <div className="preorder-empty"><span className="msym">inventory_2</span><p>{rows.length ? t('preorders.empty_filter') : t('preorders.empty')}</p></div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl preorder-table">
              <thead>
                <tr>
                  <th>{t('preorders.product')}</th>
                  <th>{t('preorders.store')}</th>
                  <th>{t('preorders.preorder')}</th>
                  <th>{t('preorders.status')}</th>
                  <th>{t('preorders.result')}</th>
                  <th aria-label={t('preorders.actions')} />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const state = row.import?.state || 'processing'
                  const busy = retrying === row.id
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="preorder-product">
                          <div className="preorder-thumb">
                            {row.image ? <img src={row.image} alt="" /> : <span className="msym">image_not_supported</span>}
                          </div>
                          <div>
                          <button className="preorder-title" onClick={() => navigate(`/taobao/preorders/${row.id}`)}>{row.title}</button>
                            <div className="preorder-meta mono">SKU {row.sku || '—'} · {dateTime(row.updatedAt)}</div>
                          </div>
                        </div>
                      </td>
                      <td data-label={t('preorders.store')}>
                        <div className="preorder-store">{row.store?.name || '—'}</div>
                        <div className="preorder-meta">{row.store?.merchantId ? `ID ${row.store.merchantId}` : ''}</div>
                      </td>
                      <td data-label={t('preorders.preorder')}>
                        <strong>{row.deliveryDays} {t('preorders.days')}</strong>
                        <div className="preorder-meta">{t('preorders.stock')}: {row.stock ?? '—'}</div>
                        <div className="preorder-meta">{t('products.sale_price')}: {row.price ? tenge(row.price) : '—'}</div>
                      </td>
                      <td data-label={t('preorders.status')}>
                        <StatusPill state={state} t={t} />
                        {state !== 'draft' && <div className="preorder-meta mono">{row.import?.technicalStatus || 'UPLOADED'}</div>}
                      </td>
                      <td className="preorder-result" data-label={t('preorders.result')}>
                        {state === 'rejected' ? (
                          <>
                            <div className="preorder-reason">{row.import?.reason}</div>
                            <div className="preorder-advice"><span className="msym">lightbulb</span>{row.import?.recommendation}</div>
                          </>
                        ) : state === 'published' ? (
                          <>
                            <div className="preorder-success"><span className="msym">verified</span>{t('preorders.published_note')}</div>
                            {row.import?.productLink && <a className="preorder-link" href={row.import.productLink} target="_blank" rel="noreferrer"><span className="msym">open_in_new</span>{t('preorder_detail.open_kaspi')}</a>}
                          </>
                        ) : state === 'draft' ? (
                          <div className="preorder-draft"><span className="msym">edit_note</span>{t('preorders.draft_note')}</div>
                        ) : state === 'verifying' ? (
                          <div className="preorder-wait"><span className="msym">manage_search</span>{t('preorders.verifying_note')}</div>
                        ) : (
                          <div className="preorder-wait"><span className="msym">schedule</span>{t('preorders.processing_note')}</div>
                        )}
                        {row.import?.code && <div className="preorder-code mono">{t('preorders.import_code')}: {row.import.code}</div>}
                      </td>
                      <td>
                        <div className="preorder-actions">
                          <button className="icon-btn" title={t('preorders.edit')} onClick={() => navigate(`/taobao/preorders/${row.id}`)}>
                            <span className="msym">edit</span>
                          </button>
                          {state === 'rejected' && row.store?.hasToken && (
                            <button className="btn btn-primary btn-sm" onClick={() => retry(row)} disabled={busy}>
                              <span className={`msym ${busy ? 'spin' : ''}`}>{busy ? 'progress_activity' : 'refresh'}</span>
                              {t('preorders.retry')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
