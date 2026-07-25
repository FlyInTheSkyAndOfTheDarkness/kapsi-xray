import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { API } from '../lib/api.js'
import { exportCSV } from '../lib/csv.js'
import { tenge, num } from '../lib/format.js'
import { PageHead, StatCard, Card, Segmented } from '../components/ui.jsx'
import TaobaoTabs from '../components/TaobaoTabs.jsx'

function marketplaceName(product) {
  const source = `${product?.source || ''} ${product?.sourceUrl || ''} ${product?.finalUrl || ''}`
  return /1688/i.test(source) ? '1688' : 'Taobao'
}

const HANDOFF_PREFIX = 'KX_TAOBAO_PAYLOAD:'

export default function TaobaoImport() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [sourceMode, setSourceMode] = useState('link')
  const [url, setUrl] = useState('')
  const [shippingCny, setShippingCny] = useState(0)
  const [markupPct, setMarkupPct] = useState(0)
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [browserKeyBusy, setBrowserKeyBusy] = useState(false)
  const [bookmarklet, setBookmarklet] = useState(null)
  const [notice, setNotice] = useState('')
  const [blockedUrl, setBlockedUrl] = useState('')
  const browserPayloadRef = useRef({ busy: false, key: '' })
  const bookmarkletLinkRef = useRef(null)

  const product = result?.product?.product
  const savedId = result?.product?.id
  const specs = product?.specs || []
  const images = product?.images || []
  const draft = product?.draft || null
  const sourceLabel = marketplaceName(product)

  const loadProduct = (response, message = '') => {
    setResult(response)
    setError('')
    setBlockedUrl('')
    setNotice(message)
  }

  const receiveBrowserPayload = useCallback(async (payload) => {
    const dedupeKey = `${payload.sourceUrl || payload.url || ''}|${payload.title || ''}|${payload.priceCny || payload.price || ''}`
    if (!dedupeKey.trim() || browserPayloadRef.current.busy || browserPayloadRef.current.key === dedupeKey) return
    browserPayloadRef.current = { busy: true, key: dedupeKey }
    setSourceMode('browser')
    setNotice(t('taobao.browser_receiving'))
    setError('')
    try {
      const response = await API.taobaoBrowserPayload(payload)
      loadProduct(response, t('taobao.browser_loaded'))
    } catch (requestError) {
      setError(requestError.status === 401 ? t('taobao.err_login') : t('taobao.err_generic'))
    } finally {
      browserPayloadRef.current.busy = false
    }
  }, [t])

  const cleanTaobaoUrl = (value) => {
    try {
      const parsed = new URL(String(value || '').trim())
      const offerId = parsed.searchParams.get('offerId') || parsed.pathname.match(/\/offer\/(\d{6,})\.html/i)?.[1]
      const host = parsed.hostname.toLowerCase()
      if (host === '1688.com' || host.endsWith('.1688.com')) {
        if (offerId) return `https://detail.1688.com/offer/${encodeURIComponent(offerId)}.html`
      }
      const itemId = parsed.searchParams.get('id') || parsed.searchParams.get('itemId')
      if (itemId) return `${parsed.origin}${parsed.pathname}?id=${encodeURIComponent(itemId)}`
    } catch {
      /* keep original */
    }
    return String(value || '').trim()
  }

  const createBookmarklet = async () => {
    setBrowserKeyBusy(true)
    try {
      const response = await API.taobaoBrowserKey()
      setBookmarklet(response.bookmarklet)
    } catch {
      setError(t('taobao.err_generic'))
    } finally {
      setBrowserKeyBusy(false)
    }
  }

  useEffect(() => {
    createBookmarklet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (bookmarklet && bookmarkletLinkRef.current) bookmarkletLinkRef.current.setAttribute('href', bookmarklet)
  }, [bookmarklet, sourceMode])

  useEffect(() => {
    const id = params.get('import')
    if (!id) return
    API.taobaoProduct(id)
      .then((response) => loadProduct(response, t('taobao.browser_loaded')))
      .catch(() => setError(t('taobao.err_generic')))
  }, [params, t])

  useEffect(() => {
    if (!params.get('browser')) return undefined
    setSourceMode('browser')
    setNotice((current) => current || t('taobao.browser_waiting'))
    let attempts = 0
    const readHandoff = () => {
      const raw = String(window.name || '')
      if (!raw.startsWith(HANDOFF_PREFIX)) return false
      try {
        const message = JSON.parse(decodeURIComponent(raw.slice(HANDOFF_PREFIX.length)))
        window.name = ''
        if (message?.type === 'KX_TAOBAO_PAYLOAD' && message.payload) {
          receiveBrowserPayload(message.payload)
          return true
        }
      } catch {
        window.name = ''
      }
      return false
    }
    if (readHandoff()) return undefined
    const timer = setInterval(() => {
      attempts += 1
      if (readHandoff() || attempts >= 40) clearInterval(timer)
    }, 250)
    return () => clearInterval(timer)
  }, [params, receiveBrowserPayload, t])

  useEffect(() => {
    const onMessage = async (event) => {
      if (event.data?.type !== 'KX_TAOBAO_PAYLOAD') return
      if (!/taobao|tmall|tb\.cn|1688/i.test(String(event.origin || ''))) return
      receiveBrowserPayload(event.data.payload || {})
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [receiveBrowserPayload])

  const analyze = async () => {
    if (!url.trim()) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await API.analyzeTaobao({ url: url.trim(), shippingCny, markupPct, rate: rate || undefined })
      loadProduct(response)
    } catch (requestError) {
      if (requestError.code === 'taobao_blocked') {
        setBlockedUrl(cleanTaobaoUrl(url))
        setSourceMode('browser')
        setError(t('taobao.err_blocked_browser'))
        setNotice(t('taobao.browser_next_step'))
      } else {
        const message = requestError.code === 'bad_url'
          ? t('taobao.err_url')
          : requestError.code === 'parse_failed'
            ? t('taobao.err_parse')
            : t('taobao.err_generic')
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  const copyBookmarklet = async () => {
    if (!bookmarklet) return
    await navigator.clipboard.writeText(bookmarklet).catch(() => {})
    setNotice(t('taobao.bookmarklet_copied'))
  }

  const downloadZip = async () => {
    if (!savedId) return
    try {
      const blob = await API.taobaoImagesZip(savedId)
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `${draft?.sku || `${sourceLabel.toLowerCase()}-images`}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch {
      setError(t('taobao.err_images'))
    }
  }

  return (
    <div className="fade-in taobao-workspace">
      <PageHead title={t('taobao.title')} sub={t('taobao.subtitle')} />
      <TaobaoTabs />

      <Card className="taobao-source-card">
        <div className="taobao-source-head">
          <Segmented options={[
            { value: 'link', label: t('taobao.source_link') },
            { value: 'browser', label: t('taobao.source_browser') },
          ]} value={sourceMode} onChange={setSourceMode} />
        </div>

        {sourceMode === 'link' ? (
          <>
            <div className="cf-row">
              <div className="search-box taobao-url-field">
                <span className="msym">link</span>
                <input className="input" placeholder={t('taobao.input_ph')} value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && analyze()} />
              </div>
              <button className="btn btn-primary" onClick={analyze} disabled={busy || !url.trim()}>
                <span className={`msym ${busy ? 'spin' : ''}`}>{busy ? 'progress_activity' : 'travel_explore'}</span>
                {t('taobao.analyze')}
              </button>
            </div>
            <div className="taobao-controls">
              <label><span className="field-label">{t('taobao.shipping')}</span><input className="input mono" type="number" min="0" value={shippingCny} onChange={(event) => setShippingCny(event.target.value)} /></label>
              <label><span className="field-label">{t('taobao.markup')}</span><input className="input mono" type="number" min="0" value={markupPct} onChange={(event) => setMarkupPct(event.target.value)} /></label>
              <label><span className="field-label">{t('taobao.rate')}</span><input className="input mono" type="number" min="0" placeholder={t('taobao.rate_auto')} value={rate} onChange={(event) => setRate(event.target.value)} /></label>
            </div>
            <div className="mini-note"><span className="msym">policy</span>{t('taobao.note')}</div>
          </>
        ) : (
          <div className="browser-parser">
            <div>
              <div className="card-title">{t('taobao.browser_title')}</div>
              <div className="card-sub">{t('taobao.browser_sub')}</div>
              {bookmarklet && <div className="mini-note"><span className="msym">drag_click</span>{t('taobao.bookmarklet_hint')}</div>}
              {blockedUrl && <div className="mini-note warn"><span className="msym">lock</span>{t('taobao.browser_blocked_hint')}</div>}
            </div>
            <div className="browser-actions">
              {blockedUrl && <a className="btn btn-ghost" href={blockedUrl} target="_blank" rel="noreferrer"><span className="msym">open_in_new</span>{t('taobao.open_taobao_product')}</a>}
              {!bookmarklet && (
                <button className="btn btn-ghost" onClick={createBookmarklet} disabled={browserKeyBusy}>
                  <span className={`msym ${browserKeyBusy ? 'spin' : ''}`}>{browserKeyBusy ? 'progress_activity' : 'bookmark_add'}</span>
                  {t('taobao.create_bookmarklet')}
                </button>
              )}
              {bookmarklet && (
                <>
                  <a ref={bookmarkletLinkRef} className="btn btn-primary" href="#taobao-bookmarklet" onClick={(event) => { event.preventDefault(); copyBookmarklet() }} draggable="true" title={t('taobao.drag_bookmarklet')}>
                    <span className="msym">shopping_bag</span>{t('taobao.bookmarklet_name')}
                  </a>
                  <button className="icon-btn" onClick={copyBookmarklet} title={t('taobao.copy_bookmarklet')}><span className="msym">content_copy</span></button>
                </>
              )}
            </div>
          </div>
        )}

        {notice && <div className="cf-ok"><span className="msym">check_circle</span>{notice}</div>}
        {error && <div className="cf-err"><span className="msym">error</span>{error}</div>}
      </Card>

      {product && (
        <>
          <Card className="store-head taobao-product-head">
            <div className="sh-logo"><span className="msym">shopping_bag</span></div>
            <div className="taobao-product-title">
              <div className="xh-badges">
                <span className="pill brand">{sourceLabel}</span>
                <span className="pill pos">{t('taobao.translated')}</span>
                <span className="pill warn"><span className="msym">event_repeat</span>{t('taobao.preorder_badge')}</span>
              </div>
              <h2 className="xh-title">{product.titleRu || product.title}</h2>
              <a className="taobao-source-link" href={product.finalUrl} target="_blank" rel="noreferrer">{product.finalUrl}</a>
            </div>
          </Card>

          <div className="stat-grid taobao-stats">
            <StatCard icon="currency_yuan" label={t('taobao.price_cny')} value={`¥${num(product.priceCny || 0)}`} />
            <StatCard icon="currency_exchange" label={t('taobao.rate_used')} value={num(product.rate || 0)} />
            <StatCard icon="payments" label={t('taobao.price_kzt')} value={tenge(product.priceKzt || 0)} />
            <StatCard icon="image" label={t('taobao.images')} value={num(images.length)} />
          </div>

          <div className="grid-2 taobao-result-grid">
            <Card title={t('taobao.specs')} sub={t('taobao.specs_sub')} pad={false} aside={(
              <button className="btn btn-ghost btn-sm" onClick={() => exportCSV('taobao-specs.csv', [
                { key: 'keyRu', label: t('taobao.spec_key') },
                { key: 'valueRu', label: t('taobao.spec_value') },
                { key: 'key', label: 'ZH key' },
                { key: 'value', label: 'ZH value' },
              ], specs)}><span className="msym">download</span>CSV</button>
            )}>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>{t('taobao.spec_key')}</th><th>{t('taobao.spec_value')}</th><th className="muted">中文</th></tr></thead>
                  <tbody>{specs.map((spec, index) => <tr key={`${spec.key}-${index}`}><td>{spec.keyRu}</td><td>{spec.valueRu}</td><td className="muted">{spec.key}: {spec.value}</td></tr>)}</tbody>
                </table>
              </div>
            </Card>

            <Card title={t('taobao.draft_ready')} sub={t('taobao.draft_ready_sub')}>
              <dl className="taobao-draft-summary">
                <div><dt>{t('common.sku')}</dt><dd className="mono">{draft?.sku || '—'}</dd></div>
                <div><dt>{t('common.brand')}</dt><dd>{draft?.brand || '—'}</dd></div>
                <div><dt>{t('common.category')}</dt><dd>{draft?.category || '—'}</dd></div>
                <div><dt>{t('preorders.preorder')}</dt><dd>{draft?.deliveryDays || 14} {t('preorders.days')}</dd></div>
              </dl>
              <button className="btn btn-primary taobao-open-draft" onClick={() => navigate(`/taobao/preorders/${savedId}`)}>
                <span className="msym">edit_note</span>{t('taobao.open_draft')}
              </button>
            </Card>
          </div>

          <Card title={t('taobao.images_title')} sub={t('taobao.images_sub')} aside={(
            <button className="btn btn-ghost btn-sm" onClick={downloadZip} disabled={!images.length}><span className="msym">folder_zip</span>{t('taobao.download_zip')}</button>
          )}>
            <div className="taobao-images">
              {images.map((src, index) => <div className="taobao-img" key={src}><img src={src} alt={`${sourceLabel} ${index + 1}`} /></div>)}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
