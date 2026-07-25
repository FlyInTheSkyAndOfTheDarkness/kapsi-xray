import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { API } from '../lib/api.js'
import { tenge } from '../lib/format.js'
import { Card, PageHead, Segmented } from '../components/ui.jsx'
import TaobaoTabs from '../components/TaobaoTabs.jsx'

/* The real path to the shelf: our draft → card in Kaspi → SKU in the price list →
   Kaspi pulls the feed → seller links it in «Без привязки» → on sale. */
const STAGE_META = {
  draft: { icon: 'edit_note', tone: 'brand' },
  card_sent: { icon: 'hourglass_top', tone: 'warn' },
  in_feed: { icon: 'rss_feed', tone: 'warn' },
  awaiting_link: { icon: 'link_off', tone: 'neg' },
  on_sale: { icon: 'check_circle', tone: 'pos' },
  blocked: { icon: 'error', tone: 'neg' },
}
const STAGES = ['draft', 'card_sent', 'in_feed', 'awaiting_link', 'on_sale', 'blocked']

function dateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function StagePill({ stage, t }) {
  const meta = STAGE_META[stage] || STAGE_META.card_sent
  return (
    <span className={`pill ${meta.tone}`}>
      <span className="msym">{meta.icon}</span>
      {t(`preorders.stage_${stage || 'card_sent'}`)}
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

  const hasProcessing = rows.some((row) => ['card_sent', 'in_feed'].includes(row.stage))
  useEffect(() => {
    if (!hasProcessing) return undefined
    const timer = window.setInterval(() => load({ sync: true, quiet: true }), 20_000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProcessing])

  const counts = useMemo(() => rows.reduce((acc, row) => {
    const stage = row.stage || 'card_sent'
    acc[stage] = (acc[stage] || 0) + 1
    return acc
  }, Object.fromEntries(STAGES.map((stage) => [stage, 0]))), [rows])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter !== 'all' && (row.stage || 'card_sent') !== filter) return false
      return !query || `${row.title} ${row.sku} ${row.store?.name || ''}`.toLowerCase().includes(query)
    })
  }, [rows, filter, search])

  const awaitingLink = counts.awaiting_link || 0

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
    ...STAGES.map((stage) => ({ value: stage, label: `${t(`preorders.stage_${stage}`)} ${counts[stage]}` })),
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
                  const stage = row.stage || 'card_sent'
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
                        <StagePill stage={stage} t={t} />
                        {stage !== 'draft' && <div className="preorder-meta mono">{row.import?.technicalStatus || 'UPLOADED'}</div>}
                      </td>
                      <td className="preorder-result" data-label={t('preorders.result')}>
                        {stage === 'awaiting_link' ? (
                          <>
                            <div className="preorder-reason">{t('preorders.awaiting_link_note')}</div>
                            <div className="preorder-advice"><span className="msym">lightbulb</span>{t('preorders.awaiting_link_how')}</div>
                          </>
                        ) : stage === 'blocked' ? (
                          <>
                            <div className="preorder-reason">{row.import?.reason || row.feed?.issues?.map((issue) => t(`feed.issue_${issue}`)).join(' ')}</div>
                            <div className="preorder-advice"><span className="msym">lightbulb</span>{row.import?.recommendation || t('preorders.blocked_how')}</div>
                          </>
                        ) : stage === 'on_sale' ? (
                          <>
                            <div className="preorder-success"><span className="msym">verified</span>{t('preorders.published_note')}</div>
                            {row.import?.productLink && <a className="preorder-link" href={row.import.productLink} target="_blank" rel="noreferrer"><span className="msym">open_in_new</span>{t('preorder_detail.open_kaspi')}</a>}
                          </>
                        ) : stage === 'draft' ? (
                          <div className="preorder-draft"><span className="msym">edit_note</span>{t('preorders.draft_note')}</div>
                        ) : stage === 'in_feed' ? (
                          <div className="preorder-wait"><span className="msym">rss_feed</span>{t('preorders.in_feed_note')}</div>
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
                          {stage === 'blocked' && row.import?.state === 'rejected' && !row.cardLocked && row.store?.hasToken && (
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
