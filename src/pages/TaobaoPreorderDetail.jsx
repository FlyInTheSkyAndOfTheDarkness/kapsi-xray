import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { useStore } from '../state/Store.jsx'
import { API } from '../lib/api.js'
import { tenge } from '../lib/format.js'
import { Card, PageHead, Segmented } from '../components/ui.jsx'

const STATUS_META = {
  draft: { icon: 'edit_note', tone: 'brand' },
  processing: { icon: 'hourglass_top', tone: 'warn' },
  verifying: { icon: 'manage_search', tone: 'warn' },
  published: { icon: 'check_circle', tone: 'pos' },
  rejected: { icon: 'error', tone: 'neg' },
}

function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function cleanProduct(product = {}) {
  return {
    ...product,
    attributes: Array.isArray(product.attributes) ? product.attributes.map((item) => ({ code: item.code || '', value: item.value ?? '' })) : [],
    images: Array.isArray(product.images) ? product.images.map((item) => ({ url: typeof item === 'string' ? item : item?.url || '' })).filter((item) => item.url) : [],
    warehouses: Array.isArray(product.warehouses) ? product.warehouses.join(', ') : product.warehouses || '',
  }
}

function validPhotoUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function dateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export default function TaobaoPreorderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { stores, activeId } = useStore()
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [storeId, setStoreId] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [aiSettings, setAiSettings] = useState({ provider: 'openai', defaultLanguage: 'ru', openaiConfigured: false, geminiConfigured: false })
  const [aiProvider, setAiProvider] = useState('openai')
  const [aiLanguage, setAiLanguage] = useState('ru')
  const [selectedImages, setSelectedImages] = useState(new Set())
  const [aiResults, setAiResults] = useState({})
  const [localizing, setLocalizing] = useState(false)
  const [aiProgress, setAiProgress] = useState({ current: '', done: 0, total: 0 })
  const [aiMessage, setAiMessage] = useState('')
  const [aiError, setAiError] = useState('')
  const [imageViewer, setImageViewer] = useState(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [result, aiResult] = await Promise.all([
        API.taobaoPreorder(id),
        API.aiSettings().catch(() => null),
      ])
      const product = cleanProduct(result.preorder.product)
      setData(result.preorder)
      setDraft(product)
      setStoreId(result.preorder.storeId || result.preorder.store?.id || activeId || '')
      setSelectedImages(new Set(product.images.map((image) => image.url).slice(0, 10)))
      setAiResults({})
      if (aiResult?.settings) {
        setAiSettings(aiResult.settings)
        setAiProvider(aiResult.settings.provider)
        setAiLanguage(aiResult.settings.defaultLanguage)
      }
      setDirty(false)
    } catch {
      setError(t('preorder_detail.load_error'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!storeId && activeId) setStoreId(activeId)
  }, [activeId, storeId])

  useEffect(() => {
    const warn = (event) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    if (!imageViewer) return undefined
    const close = (event) => {
      if (event.key === 'Escape') setImageViewer(null)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [imageViewer])

  const selectedStore = stores.find((store) => store.id === storeId) || null
  const status = data?.import?.state || 'draft'
  const statusMeta = STATUS_META[status] || STATUS_META.processing
  const images = draft?.images || []
  const attrs = draft?.attributes || []
  const localPhotos = useMemo(() => images.some((image) => image.url.startsWith('/uploads/')), [images])
  const missingFields = useMemo(() => {
    const fields = ['sku', 'title', 'brand', 'category'].filter((field) => !String(draft?.[field] || '').trim())
    return Number(draft?.salePrice ?? draft?.price) > 0 ? fields : [...fields, 'price']
  }, [draft])
  const aiConfigured = aiProvider === 'gemini' ? aiSettings.geminiConfigured : aiSettings.openaiConfigured
  const aiPreviewCount = Object.keys(aiResults).length

  const updateDraft = (updater) => {
    setDraft((current) => updater(current))
    setDirty(true)
    setMessage('')
  }
  const setField = (key, value) => updateDraft((current) => ({ ...current, [key]: value }))
  const setAttribute = (index, key, value) => updateDraft((current) => ({
    ...current,
    attributes: current.attributes.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
  }))
  const removeAttribute = (index) => updateDraft((current) => ({ ...current, attributes: current.attributes.filter((_, itemIndex) => itemIndex !== index) }))
  const addAttribute = () => updateDraft((current) => ({ ...current, attributes: [...current.attributes, { code: '', value: '' }] }))
  const removeImage = (index) => {
    const sourceUrl = images[index]?.url
    const generatedUrl = aiResults[sourceUrl]?.localizedUrl
    if (generatedUrl) API.discardAiImages([generatedUrl]).catch(() => {})
    setSelectedImages((current) => {
      const next = new Set(current)
      next.delete(sourceUrl)
      return next
    })
    setAiResults((current) => {
      const next = { ...current }
      delete next[sourceUrl]
      return next
    })
    updateDraft((current) => ({ ...current, images: current.images.filter((_, itemIndex) => itemIndex !== index) }))
  }
  const moveImage = (index, direction) => updateDraft((current) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= current.images.length) return current
    const next = [...current.images]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    return { ...current, images: next }
  })

  const payload = () => ({
    ...draft,
    deliveryDays: Math.max(1, Math.round(Number(draft.deliveryDays) || 14)),
    price: Math.max(0, Math.round(Number(draft.salePrice ?? draft.price) || 0)),
    salePrice: Math.max(0, Math.round(Number(draft.salePrice ?? draft.price) || 0)),
    stock: Math.max(0, Math.round(Number(draft.stock) || 0)),
    quantity: Math.max(0, Math.round(Number(draft.stock) || 0)),
    warehouses: String(draft.warehouses || '').split(/[\n,;]/).map((value) => value.trim()).filter(Boolean),
  })

  const save = async ({ quiet = false } = {}) => {
    if (!draft) return null
    setSaving(true)
    setError('')
    if (!quiet) setMessage('')
    try {
      const result = await API.saveTaobaoPreorder(id, payload(), storeId || null)
      setData(result.preorder)
      setDraft(cleanProduct(result.preorder.product))
      setDirty(false)
      if (!quiet) setMessage(t('preorder_detail.saved'))
      return result.preorder
    } catch {
      setError(t('preorder_detail.save_error'))
      return null
    } finally {
      setSaving(false)
    }
  }

  const addPhotoUrl = () => {
    const url = photoUrl.trim()
    if (!url) return
    if (!validPhotoUrl(url)) {
      setError(t('preorder_detail.photo_url_error'))
      return
    }
    setError('')
    updateDraft((current) => ({ ...current, images: [...current.images, { url }] }))
    setPhotoUrl('')
  }

  const uploadPhotos = async (event) => {
    const files = [...(event.target.files || [])].slice(0, Math.max(0, 30 - images.length))
    event.target.value = ''
    if (!files.length) return
    setUploading(true)
    setError('')
    setMessage('')
    try {
      const saved = await save({ quiet: true })
      if (!saved) return
      let latest = null
      let uploaded = 0
      for (const file of files) {
        const encoded = await fileData(file)
        const result = await API.uploadTaobaoPreorderPhoto(id, { name: file.name, type: file.type, data: encoded })
        latest = result.preorder
        uploaded += 1
        setData(latest)
        setDraft(cleanProduct(latest.product))
      }
      if (latest) {
        setDirty(false)
        setMessage(t('preorder_detail.photos_uploaded', { count: uploaded }))
      }
    } catch (uploadError) {
      setError(uploadError.code === 'image_too_large' ? t('preorder_detail.photo_large') : t('preorder_detail.photo_error'))
    } finally {
      setUploading(false)
    }
  }

  const toggleImageSelection = (url) => {
    setAiError('')
    setSelectedImages((current) => {
      const next = new Set(current)
      if (next.has(url)) next.delete(url)
      else if (next.size < 10) next.add(url)
      else setAiError(t('preorder_detail.ai_limit'))
      return next
    })
  }

  const toggleAllImages = () => {
    setAiError('')
    const visible = images.map((image) => image.url).slice(0, 10)
    const allSelected = visible.length > 0 && visible.every((url) => selectedImages.has(url))
    setSelectedImages(new Set(allSelected ? [] : visible))
    if (images.length > 10 && !allSelected) setAiMessage(t('preorder_detail.ai_limit'))
  }

  const aiErrorText = (code) => {
    if (code === 'ai_not_configured') return t('preorder_detail.ai_no_key')
    if (code === 'ai_auth_failed') return t('preorder_detail.ai_auth_failed')
    if (code === 'ai_quota') return t('preorder_detail.ai_quota')
    if (code === 'ai_unavailable') return t('preorder_detail.ai_unavailable')
    if (code === 'bad_image_type') return t('preorder_detail.ai_bad_image_type')
    if (code === 'image_too_large') return t('preorder_detail.photo_large')
    if (code === 'image_unavailable' || code === 'image_not_in_preorder') return t('preorder_detail.ai_image_unavailable')
    return t('preorder_detail.ai_failed')
  }

  const localizeSelectedImages = async () => {
    if (!selectedImages.size || !aiConfigured || localizing) return
    setLocalizing(true)
    setAiError('')
    setAiMessage('')
    try {
      const saved = await save({ quiet: true })
      if (!saved) return
      const savedImages = cleanProduct(saved.product).images.map((image) => image.url)
      const targets = savedImages.filter((url) => selectedImages.has(url)).slice(0, 10)
      if (!targets.length) {
        setAiError(t('preorder_detail.ai_select'))
        return
      }
      const oldPreviews = targets.map((url) => aiResults[url]?.localizedUrl).filter(Boolean)
      if (oldPreviews.length) await API.discardAiImages(oldPreviews).catch(() => {})
      setAiResults((current) => {
        const next = { ...current }
        targets.forEach((url) => delete next[url])
        return next
      })
      let ready = 0
      let failed = 0
      let lastCode = ''
      setAiProgress({ current: targets[0], done: 0, total: targets.length })
      for (let index = 0; index < targets.length; index += 1) {
        const sourceUrl = targets[index]
        setAiProgress({ current: sourceUrl, done: index, total: targets.length })
        try {
          const result = await API.localizeAiImage({ preorderId: id, sourceUrl, provider: aiProvider, language: aiLanguage })
          setAiResults((current) => ({ ...current, [sourceUrl]: result }))
          ready += 1
        } catch (requestError) {
          failed += 1
          lastCode = requestError.code || ''
        }
        setAiProgress({ current: index + 1 < targets.length ? targets[index + 1] : '', done: index + 1, total: targets.length })
      }
      if (ready) setAiMessage(t('preorder_detail.ai_ready', { ready, total: targets.length }))
      if (failed) setAiError(failed === targets.length ? aiErrorText(lastCode) : t('preorder_detail.ai_partial', { failed }))
    } finally {
      setLocalizing(false)
      setAiProgress((current) => ({ ...current, current: '' }))
    }
  }

  const applyTranslations = (sources = Object.keys(aiResults)) => {
    const replacements = new Map(sources.map((sourceUrl) => [sourceUrl, aiResults[sourceUrl]?.localizedUrl]).filter(([, url]) => url))
    if (!replacements.size) return
    updateDraft((current) => ({
      ...current,
      images: current.images.map((image) => replacements.has(image.url) ? { url: replacements.get(image.url) } : image),
    }))
    setSelectedImages((current) => {
      const next = new Set(current)
      replacements.forEach((localizedUrl, sourceUrl) => {
        next.delete(sourceUrl)
        next.add(localizedUrl)
      })
      return next
    })
    setAiResults((current) => {
      const next = { ...current }
      replacements.forEach((_, sourceUrl) => delete next[sourceUrl])
      return next
    })
    setAiMessage(t('preorder_detail.ai_applied', { count: replacements.size }))
    setAiError('')
  }

  const discardTranslations = async (sources = Object.keys(aiResults)) => {
    const urls = sources.map((sourceUrl) => aiResults[sourceUrl]?.localizedUrl).filter(Boolean)
    if (urls.length) await API.discardAiImages(urls).catch(() => {})
    setAiResults((current) => {
      const next = { ...current }
      sources.forEach((sourceUrl) => delete next[sourceUrl])
      return next
    })
    setAiMessage(t('preorder_detail.ai_discarded'))
  }

  const publish = async () => {
    if (!draft || !storeId) return
    setPublishing(true)
    setMessage('')
    setError('')
    try {
      const saved = await save({ quiet: true })
      if (!saved) return
      const result = await API.importTaobao(id, { storeId, product: saved.product })
      setMessage(t('preorder_detail.published', { code: result.result?.code || result.import?.code || '—' }))
      await load()
    } catch (publishError) {
      setError(publishError.code === 'no_token' ? t('preorders.no_token') : publishError.code === 'missing_product_fields' ? t('taobao.err_fields') : t('preorder_detail.publish_error'))
    } finally {
      setPublishing(false)
    }
  }

  const deleteProduct = async () => {
    setDeleting(true)
    setError('')
    try {
      const previews = Object.values(aiResults).map((result) => result.localizedUrl).filter(Boolean)
      if (previews.length) await API.discardAiImages(previews).catch(() => {})
      await API.deleteTaobaoPreorder(id)
      navigate('/taobao/preorders', { replace: true })
    } catch {
      setError(t('preorder_detail.delete_error'))
      setDeleting(false)
    }
  }

  const goBack = async () => {
    if (dirty && !window.confirm(t('preorder_detail.discard_changes'))) return
    const previews = Object.values(aiResults).map((result) => result.localizedUrl).filter(Boolean)
    if (previews.length) await API.discardAiImages(previews).catch(() => {})
    navigate('/taobao/preorders')
  }

  if (loading) return <div className="preorder-detail-loading"><span className="msym spin">progress_activity</span></div>
  if (!draft || !data) return (
    <div className="fade-in">
      <PageHead title={t('preorder_detail.title')} sub={error} />
      <button className="btn btn-ghost" onClick={goBack}><span className="msym">arrow_back</span>{t('preorder_detail.back')}</button>
    </div>
  )
  const statusText = data.import?.reason || (
    status === 'published'
      ? t('preorders.published_note')
      : status === 'verifying'
        ? t('preorders.verifying_note')
        : status === 'draft'
          ? t('preorders.draft_note')
          : t('preorders.processing_note')
  )

  return (
    <div className="fade-in preorder-detail">
      <PageHead title={t('preorder_detail.title')} sub={`${draft.title || '—'} · SKU ${draft.sku || '—'}`}>
        {dirty && <span className="preorder-unsaved"><span className="msym">edit</span>{t('preorder_detail.unsaved')}</span>}
        <button className="btn btn-ghost" onClick={goBack}><span className="msym">arrow_back</span>{t('preorder_detail.back')}</button>
        <button className="btn btn-primary" onClick={() => save()} disabled={saving || !dirty}><span className={`msym ${saving ? 'spin' : ''}`}>{saving ? 'progress_activity' : 'save'}</span>{t('preorder_detail.save')}</button>
      </PageHead>

      <div className={`preorder-detail-status ${statusMeta.tone}`}>
        <span className="msym">{statusMeta.icon}</span>
        <div>
          <b>{t(`preorders.status_${status}`)}</b>
          <span>{statusText}</span>
        </div>
        <div className="preorder-status-actions">
          {data.import?.productLink && <a className="btn btn-primary btn-sm" href={data.import.productLink} target="_blank" rel="noreferrer"><span className="msym">open_in_new</span>{t('preorder_detail.open_kaspi')}</a>}
          {data.import?.technicalStatus && <span className="pill mono">{data.import.technicalStatus}</span>}
        </div>
      </div>
      {status === 'rejected' && data.import?.recommendation && <div className="preorder-detail-recommendation"><span className="msym">lightbulb</span>{data.import.recommendation}</div>}
      {!!data.history?.length && (
        <details className="preorder-history">
          <summary><span className="msym">history</span>{t('preorder_detail.history')}<span className="pill mono">{data.history.length}</span></summary>
          <div className="preorder-history-list">
            {data.history.map((attempt, index) => {
              const attemptMeta = STATUS_META[attempt.state] || STATUS_META.processing
              return (
                <div className="preorder-history-row" key={attempt.id || index}>
                  <span className={`msym ${attemptMeta.tone}`}>{attemptMeta.icon}</span>
                  <div><b>{t('preorder_detail.attempt', { n: attempt.attempt || data.history.length - index })}</b><span>{attempt.reason || t(`preorders.status_${attempt.state || 'processing'}`)}</span></div>
                  <div className="mono"><b>{attempt.code || '—'}</b><span>{dateTime(attempt.createdAt)}</span></div>
                </div>
              )
            })}
          </div>
        </details>
      )}

      {(message || error) && <div className={error ? 'cf-err' : 'cf-ok'}><span className="msym">{error ? 'error' : 'check_circle'}</span>{error || message}</div>}

      <div className="preorder-detail-grid">
        <Card title={t('preorder_detail.main_title')} sub={t('preorder_detail.main_sub')}>
          <div className="preorder-form-grid">
            <label><span className="field-label">{t('common.sku')}</span><input className="input mono" value={draft.sku || ''} onChange={(event) => setField('sku', event.target.value)} /></label>
            <label><span className="field-label">{t('common.brand')}</span><input className="input" value={draft.brand || ''} onChange={(event) => setField('brand', event.target.value)} /></label>
            <label className="span-2"><span className="field-label">{t('common.product')}</span><input className="input" value={draft.title || ''} onChange={(event) => setField('title', event.target.value)} /></label>
            <label className="span-2"><span className="field-label">{t('common.category')}</span><input className="input" value={draft.category || ''} onChange={(event) => setField('category', event.target.value)} /></label>
            <label className="span-2"><span className="field-label">{t('taobao.description')}</span><textarea className="input preorder-description" value={draft.description || ''} onChange={(event) => setField('description', event.target.value)} /></label>
          </div>
        </Card>

        <Card title={t('preorder_detail.publish_title')} sub={t('preorder_detail.publish_sub')}>
          <div className="preorder-publish-fields">
            <label><span className="field-label">{t('preorders.store')}</span><select className="select" value={storeId} onChange={(event) => { setStoreId(event.target.value); setDirty(true); setMessage('') }}><option value="">{t('taobao.pick_store')}</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
            <div className="preorder-form-grid">
              <label><span className="field-label">{t('products.sale_price')}</span><input className="input mono" type="number" min="1" value={draft.salePrice ?? draft.price ?? 0} onChange={(event) => setField('salePrice', event.target.value)} /></label>
              <label><span className="field-label">{t('taobao.delivery_days')}</span><input className="input mono" type="number" min="1" value={draft.deliveryDays ?? 14} onChange={(event) => setField('deliveryDays', event.target.value)} /></label>
              <label><span className="field-label">{t('common.stock')}</span><input className="input mono" type="number" min="0" value={draft.stock ?? 0} onChange={(event) => setField('stock', event.target.value)} /></label>
              <div className="preorder-price-hint"><span className="msym">payments</span>{tenge(draft.salePrice ?? draft.price ?? 0)}</div>
              <label className="span-2"><span className="field-label">{t('taobao.warehouses')}</span><input className="input" value={draft.warehouses || ''} onChange={(event) => setField('warehouses', event.target.value)} placeholder={t('taobao.warehouses_ph')} /></label>
            </div>
            {!selectedStore?.hasToken && <div className="mini-note"><span className="msym">key_off</span>{t('taobao.err_no_token')}</div>}
            {!!missingFields.length && <div className="mini-note warn"><span className="msym">error</span>{t('taobao.err_fields')}</div>}
            {localPhotos && <div className="mini-note warn"><span className="msym">cloud_off</span>{t('preorder_detail.local_photo_note')}</div>}
            <button className="btn btn-primary preorder-publish-button" onClick={publish} disabled={publishing || saving || !selectedStore?.hasToken || !!missingFields.length}><span className={`msym ${publishing ? 'spin' : ''}`}>{publishing ? 'progress_activity' : 'publish'}</span>{t(status === 'draft' ? 'preorder_detail.publish_first' : 'preorder_detail.publish')}</button>
          </div>
        </Card>
      </div>

      <Card title={t('preorder_detail.attributes_title')} sub={t('preorder_detail.attributes_sub')} aside={<button className="btn btn-ghost btn-sm" onClick={addAttribute}><span className="msym">add</span>{t('preorder_detail.add_attribute')}</button>}>
        <div className="preorder-attributes">
          {attrs.map((attribute, index) => (
            <div className="preorder-attribute-row" key={`${index}-${attribute.code}`}>
              <input className="input" value={attribute.code} onChange={(event) => setAttribute(index, 'code', event.target.value)} placeholder={t('preorder_detail.attribute_code')} />
              <input className="input" value={attribute.value} onChange={(event) => setAttribute(index, 'value', event.target.value)} placeholder={t('preorder_detail.attribute_value')} />
              <button className="icon-btn" title={t('preorder_detail.remove')} onClick={() => removeAttribute(index)}><span className="msym">delete</span></button>
            </div>
          ))}
          {!attrs.length && <div className="preorder-section-empty">{t('preorder_detail.no_attributes')}</div>}
        </div>
      </Card>

      <Card title={t('preorder_detail.photos_title')} sub={t('preorder_detail.photos_sub')} aside={(
        <label className={`btn btn-primary btn-sm ${uploading ? 'disabled' : ''}`}><span className={`msym ${uploading ? 'spin' : ''}`}>{uploading ? 'progress_activity' : 'upload'}</span>{t('preorder_detail.upload_photos')}<input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={uploadPhotos} /></label>
      )}>
        <div className="preorder-photo-add"><input className="input" value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} placeholder="https://..." /><button className="btn btn-ghost" onClick={addPhotoUrl} disabled={!photoUrl.trim()}><span className="msym">add_link</span>{t('preorder_detail.add_url')}</button></div>
        {!!images.length && (
          <div className="preorder-ai-panel">
            <div className="preorder-ai-title">
              <span className="msym">translate</span>
              <div><b>{t('preorder_detail.ai_title')}</b><span>{t('preorder_detail.ai_sub')}</span></div>
              <button className="btn btn-ghost btn-sm" onClick={toggleAllImages}><span className="msym">select_all</span>{t('preorder_detail.ai_selected', { count: selectedImages.size })}</button>
            </div>
            <div className="preorder-ai-controls">
              <label><span className="field-label">{t('preorder_detail.ai_provider')}</span><select className="select" value={aiProvider} onChange={(event) => { setAiProvider(event.target.value); setAiError(''); setAiMessage('') }}><option value="openai">OpenAI</option><option value="gemini">Gemini</option></select></label>
              <label><span className="field-label">{t('preorder_detail.ai_language')}</span><Segmented options={[{ value: 'ru', label: 'Русский' }, { value: 'kk', label: 'Қазақша' }]} value={aiLanguage} onChange={(value) => { setAiLanguage(value); setAiError(''); setAiMessage('') }} /></label>
              <button className="btn btn-primary preorder-ai-run" onClick={localizeSelectedImages} disabled={localizing || !selectedImages.size || !aiConfigured}><span className={`msym ${localizing ? 'spin' : ''}`}>{localizing ? 'progress_activity' : 'auto_awesome'}</span>{localizing ? t('preorder_detail.ai_progress', { done: aiProgress.done, total: aiProgress.total }) : t('preorder_detail.ai_run')}</button>
            </div>
            {!aiConfigured && <div className="preorder-ai-key-warning"><span className="msym">key_off</span><span>{t('preorder_detail.ai_no_key')}</span><button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')}><span className="msym">settings</span>{t('preorder_detail.ai_open_settings')}</button></div>}
            {(aiMessage || aiError) && <div className={aiError ? 'cf-err' : 'cf-ok'}><span className="msym">{aiError ? 'error' : 'check_circle'}</span>{aiError || aiMessage}</div>}
          </div>
        )}
        <div className="preorder-photo-grid">
          {images.map((image, index) => (
            <div className={`preorder-photo ${selectedImages.has(image.url) ? 'selected' : ''}`} key={`${image.url}-${index}`}>
              <img src={image.url} alt={`${draft.title} ${index + 1}`} />
              {index === 0 && <span className="pill brand">{t('preorder_detail.cover')}</span>}
              <button className="preorder-photo-select" title={selectedImages.has(image.url) ? t('preorder_detail.ai_unselect_photo') : t('preorder_detail.ai_select_photo')} onClick={() => toggleImageSelection(image.url)}><span className="msym">{selectedImages.has(image.url) ? 'check_box' : 'check_box_outline_blank'}</span></button>
              {aiResults[image.url] && <span className="preorder-photo-ai-ready"><span className="msym">check</span>{t('preorder_detail.ai_ready_badge')}</span>}
              {localizing && aiProgress.current === image.url && <span className="preorder-photo-ai-loading"><span className="msym spin">progress_activity</span></span>}
              <div className="preorder-photo-actions">
                <button className="icon-btn" title={t('preorder_detail.move_left')} disabled={index === 0} onClick={() => moveImage(index, -1)}><span className="msym">arrow_back</span></button>
                <button className="icon-btn" title={t('preorder_detail.move_right')} disabled={index === images.length - 1} onClick={() => moveImage(index, 1)}><span className="msym">arrow_forward</span></button>
                <button className="icon-btn danger" title={t('preorder_detail.remove')} onClick={() => removeImage(index)}><span className="msym">delete</span></button>
              </div>
            </div>
          ))}
          {!images.length && <div className="preorder-section-empty">{t('preorder_detail.no_photos')}</div>}
        </div>
        {!!aiPreviewCount && (
          <div className="preorder-ai-preview">
            <div className="preorder-ai-preview-head">
              <div><b>{t('preorder_detail.ai_preview_title')}</b><span>{t('preorder_detail.ai_preview_sub')}</span></div>
              <div><button className="btn btn-ghost btn-sm" onClick={() => discardTranslations()}><span className="msym">close</span>{t('preorder_detail.ai_discard_all')}</button><button className="btn btn-primary btn-sm" onClick={() => applyTranslations()}><span className="msym">done_all</span>{t('preorder_detail.ai_apply_all')}</button></div>
            </div>
            <div className="preorder-ai-preview-list">
              {Object.entries(aiResults).map(([sourceUrl, result], index) => (
                <article className="preorder-ai-compare" key={sourceUrl}>
                  <figure>
                    <button className="preorder-ai-image-open" type="button" title={t('preorder_detail.ai_open_large')} onClick={() => setImageViewer({ url: sourceUrl, title: `${t('preorder_detail.ai_original')} #${index + 1}` })}>
                      <img src={sourceUrl} alt={t('preorder_detail.ai_original')} />
                      <span className="msym">zoom_in</span>
                    </button>
                    <figcaption>{t('preorder_detail.ai_original')} #{index + 1}</figcaption>
                  </figure>
                  <span className="msym preorder-ai-arrow">arrow_forward</span>
                  <figure>
                    <button className="preorder-ai-image-open" type="button" title={t('preorder_detail.ai_open_large')} onClick={() => setImageViewer({ url: result.localizedUrl, title: `${t('preorder_detail.ai_translation')} · ${result.language === 'kk' ? 'Қазақша' : 'Русский'}` })}>
                      <img src={result.localizedUrl} alt={t('preorder_detail.ai_translation')} />
                      <span className="msym">zoom_in</span>
                    </button>
                    <figcaption>{t('preorder_detail.ai_translation')} · {result.language === 'kk' ? 'Қазақша' : 'Русский'}</figcaption>
                  </figure>
                  <div className="preorder-ai-compare-actions"><button className="icon-btn" title={t('preorder_detail.ai_discard')} onClick={() => discardTranslations([sourceUrl])}><span className="msym">close</span></button><button className="icon-btn primary" title={t('preorder_detail.ai_apply')} onClick={() => applyTranslations([sourceUrl])}><span className="msym">check</span></button></div>
                </article>
              ))}
            </div>
          </div>
        )}
      </Card>

      <section className="preorder-danger-zone">
        <div><b>{t('preorder_detail.delete_title')}</b><span>{t('preorder_detail.delete_note')}</span></div>
        {!confirmDelete ? (
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}><span className="msym">delete</span>{t('preorder_detail.delete')}</button>
        ) : (
          <div className="preorder-delete-confirm"><button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>{t('common.close')}</button><button className="btn btn-danger" onClick={deleteProduct} disabled={deleting}><span className={`msym ${deleting ? 'spin' : ''}`}>{deleting ? 'progress_activity' : 'delete_forever'}</span>{t('preorder_detail.delete_confirm')}</button></div>
        )}
      </section>
      {imageViewer && (
        <div className="image-viewer" role="dialog" aria-modal="true" aria-label={imageViewer.title} onMouseDown={() => setImageViewer(null)}>
          <div className="image-viewer-inner" onMouseDown={(event) => event.stopPropagation()}>
            <div className="image-viewer-head">
              <b>{imageViewer.title}</b>
              <button className="icon-btn" title={t('common.close')} onClick={() => setImageViewer(null)}><span className="msym">close</span></button>
            </div>
            <img src={imageViewer.url} alt={imageViewer.title} />
          </div>
        </div>
      )}
    </div>
  )
}
