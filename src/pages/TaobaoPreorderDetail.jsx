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

/* Once the card is with Kaspi the seller's next move is in the cabinet, filling
   Kaspi's own form. These make this page the place they copy from. */
function CopyButton({ value, title }) {
  const [done, setDone] = useState(false)
  const text = String(value ?? '').trim()
  const copy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      window.setTimeout(() => setDone(false), 1500)
    } catch {
      /* clipboard refused — the field itself is still selectable */
    }
  }
  return (
    <button type="button" className={`copy-btn ${done ? 'done' : ''}`} onClick={copy} disabled={!text} title={title}>
      <span className="msym">{done ? 'check' : 'content_copy'}</span>
    </button>
  )
}

function CopyLabel({ text, value, title }) {
  return (
    <span className="field-label with-copy">
      {text}
      <CopyButton value={value} title={title} />
    </span>
  )
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

function missingLabel(t, field) {
  const labels = {
    sku: t('common.sku'),
    title: t('common.product'),
    brand: t('common.brand'),
    category: t('common.category'),
    price: t('common.price'),
    stock: t('common.stock'),
    warehouses: t('taobao.warehouses'),
    deliveryDays: t('taobao.delivery_days'),
    images: t('preorder_detail.photos_title'),
    attributes: t('preorder_detail.attributes_required_short'),
  }
  return labels[field] || field
}

function localFeedUrl(url = '') {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i.test(String(url || ''))
}

function attributeKey(attribute = {}) {
  return `${String(attribute.code || '').trim()}|${String(attribute.value || '').trim()}`
}

function isPlatformAttribute(attribute = {}) {
  const code = String(attribute.code || '').trim()
  return /^предзаказ$/i.test(code) || /^срок доставки/i.test(code)
}

function attributeMatchKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[*._/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function attributeLeaf(value = '') {
  return String(value || '').split('*').filter(Boolean).at(-1)?.split('.').filter(Boolean).at(-1) || value
}

function definitionKeys(definition = {}) {
  return new Set([
    attributeMatchKey(definition.code),
    attributeMatchKey(definition.labelRu),
    attributeMatchKey(attributeLeaf(definition.code)),
  ].filter(Boolean))
}

function definitionsByAlias(definitions = []) {
  const result = new Map()
  definitions.forEach((definition) => definitionKeys(definition).forEach((key) => {
    if (!result.has(key)) result.set(key, definition)
  }))
  return result
}

function findDefinition(code, definitions = [], aliases = null) {
  const byAlias = aliases || definitionsByAlias(definitions)
  return byAlias.get(attributeMatchKey(code)) || null
}

function normalizeValueForDefinition(definition, value) {
  const text = String(value ?? '').trim()
  if (!text || !definition) return text
  if (definition.type === 'enum' && definition.values?.length) {
    const sourceValues = definition.multiValued ? text.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean) : [text]
    return sourceValues.map((item) => allowedValue(item, definition.values)?.code || item).join(', ')
  }
  if (definition.type === 'boolean') {
    if (/^(true|да|yes|1)$/i.test(text)) return 'true'
    if (/^(false|нет|no|0)$/i.test(text)) return 'false'
  }
  return text
}

function reconcileAttributes(attributes = [], definitions = []) {
  if (!definitions.length) return { attributes, removed: 0, changed: false }
  const byKey = definitionsByAlias(definitions)
  const platform = attributes.filter(isPlatformAttribute)
  const official = new Map()
  let removed = 0

  attributes.filter((attribute) => !isPlatformAttribute(attribute)).forEach((attribute) => {
    const definition = byKey.get(attributeMatchKey(attribute.code))
    if (!definition) {
      removed += 1
      return
    }
    const current = official.get(definition.code)
    const value = normalizeValueForDefinition(definition, attribute.value)
    if (!current || (!String(current.value || '').trim() && value)) {
      official.set(definition.code, { code: definition.code, value })
    }
  })

  definitions.filter((definition) => definition.mandatory).forEach((definition) => {
    if (!official.has(definition.code)) official.set(definition.code, { code: definition.code, value: '' })
  })

  const next = [...platform, ...official.values()]
  const before = attributes.map(attributeKey).join('\n')
  const after = next.map(attributeKey).join('\n')
  return { attributes: next, removed, changed: before !== after }
}

function allowedValue(value, values = []) {
  const clean = String(value || '').trim().toLowerCase()
  return values.find((item) => String(item.code || '').toLowerCase() === clean || String(item.name || '').toLowerCase() === clean) || null
}

function validateAttributes(attributes = [], definitions = []) {
  if (!definitions.length) return []
  const byAlias = definitionsByAlias(definitions)
  const rows = attributes.map((attribute, index) => ({ attribute, index })).filter(({ attribute }) => !isPlatformAttribute(attribute))
  const byAttribute = new Map()
  rows.forEach(({ attribute, index }) => {
    const definition = findDefinition(attribute.code, definitions, byAlias)
    if (definition) byAttribute.set(definition.code, { attribute, index })
  })
  const issues = []

  rows.forEach(({ attribute, index }) => {
    const definition = findDefinition(attribute.code, definitions, byAlias)
    if (!definition) {
      issues.push({
        kind: 'unknown_code',
        action: 'delete',
        field: 'code',
        uiIndex: index,
        code: attribute.code,
        value: attribute.value,
        labelRu: attribute.code || 'Неизвестная характеристика',
        advice: 'Этого поля нет в выбранной категории Kaspi. Удалите строку.',
      })
      return
    }
    const text = String(attribute.value ?? '').trim()
    if (!text && definition.mandatory) {
      issues.push({
        kind: 'missing_value',
        action: 'fill',
        field: 'value',
        uiIndex: index,
        code: definition.code,
        value: '',
        labelRu: definition.labelRu,
        advice: `Заполните обязательное поле «${definition.labelRu}».`,
      })
      return
    }
    if (!text) return
    if (definition.type === 'enum' && definition.values?.length) {
      const sourceValues = definition.multiValued ? text.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean) : [text]
      if (sourceValues.some((value) => !allowedValue(value, definition.values))) {
        issues.push({
          kind: 'invalid_enum',
          action: 'choose',
          field: 'value',
          uiIndex: index,
          code: definition.code,
          value: text,
          labelRu: definition.labelRu,
          allowedValues: definition.values.map((item) => item.name),
          advice: `Для поля «${definition.labelRu}» выберите значение из списка Kaspi.`,
        })
      }
    } else if (definition.type === 'boolean' && !/^(true|false|да|нет|yes|no|1|0)$/i.test(text)) {
      issues.push({
        kind: 'invalid_boolean',
        action: 'choose',
        field: 'value',
        uiIndex: index,
        code: definition.code,
        value: text,
        labelRu: definition.labelRu,
        allowedValues: ['Да', 'Нет'],
        advice: `Для поля «${definition.labelRu}» выберите «Да» или «Нет».`,
      })
    } else if (definition.type === 'number' && !Number.isFinite(Number(text.replace(',', '.')))) {
      issues.push({
        kind: 'invalid_number',
        action: 'fill',
        field: 'value',
        uiIndex: index,
        code: definition.code,
        value: text,
        labelRu: definition.labelRu,
        advice: `В поле «${definition.labelRu}» укажите только число.`,
      })
    }
  })

  definitions.filter((definition) => definition.mandatory && !byAttribute.has(definition.code)).forEach((definition) => {
    issues.push({
      kind: 'missing_value',
      action: 'fill',
      field: 'value',
      uiIndex: -1,
      code: definition.code,
      value: '',
      labelRu: definition.labelRu,
      advice: `Добавьте и заполните обязательное поле «${definition.labelRu}».`,
    })
  })
  return issues
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
  const [unlockedForEdit, setUnlockedForEdit] = useState(false)
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
  const [categoryQuery, setCategoryQuery] = useState('')
  const [categoryResults, setCategoryResults] = useState([])
  const [categoryLoading, setCategoryLoading] = useState(false)
  const [categoryError, setCategoryError] = useState('')
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [attributeDefs, setAttributeDefs] = useState([])
  const [attributesLoading, setAttributesLoading] = useState(false)
  const [attributesError, setAttributesError] = useState('')
  const [attributeAiBusy, setAttributeAiBusy] = useState(false)
  const [attributeAiMessage, setAttributeAiMessage] = useState('')
  const [attributeAiError, setAttributeAiError] = useState('')
  const [feedInfo, setFeedInfo] = useState(null)
  const [feedLoading, setFeedLoading] = useState(false)
  const [feedError, setFeedError] = useState('')
  const [feedCopied, setFeedCopied] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [validationAttempted, setValidationAttempted] = useState(false)
  const [serverAttributeIssues, setServerAttributeIssues] = useState([])

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
      setValidationAttempted(false)
      setServerAttributeIssues([])
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
    if (!stores.length) return
    const exists = storeId && stores.some((store) => store.id === storeId)
    if (!storeId || !exists) setStoreId(activeId || stores[0].id)
  }, [activeId, storeId, stores])

  useEffect(() => {
    setCategoryResults([])
    setCategoryError('')
    setAttributeDefs([])
    setAttributesError('')
  }, [storeId])

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
  const categoryCode = String(draft?.category || '').trim()
  useEffect(() => {
    if (!selectedStore?.id) {
      setFeedInfo(null)
      return undefined
    }
    let cancelled = false
    setFeedInfo(null)
    setFeedLoading(true)
    setFeedError('')
    API.storePreorderFeed(selectedStore.id)
      .then((result) => { if (!cancelled) setFeedInfo(result.feed || null) })
      .catch(() => { if (!cancelled) { setFeedInfo(null); setFeedError(t('preorder_detail.feed_error')) } })
      .finally(() => { if (!cancelled) setFeedLoading(false) })
    return () => { cancelled = true }
  }, [selectedStore?.id, t])

  useEffect(() => {
    if (!selectedStore?.hasToken || !/^Master\s*-/i.test(categoryCode)) {
      setAttributeDefs([])
      setAttributesError('')
      return undefined
    }
    let cancelled = false
    setAttributesLoading(true)
    setAttributesError('')
    API.storeAttributes(selectedStore.id, { category: categoryCode })
      .then((result) => {
        if (cancelled) return
        const definitions = result.attributes || []
        setAttributeDefs(definitions)
        updateDraft((current) => {
          const existing = Array.isArray(current.attributes) ? current.attributes : []
          const reconciled = reconcileAttributes(existing, definitions)
          return reconciled.changed ? { ...current, attributes: reconciled.attributes } : current
        })
      })
      .catch(() => { if (!cancelled) { setAttributeDefs([]); setAttributesError(t('preorder_detail.attributes_load_error')) } })
      .finally(() => { if (!cancelled) setAttributesLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore?.id, selectedStore?.hasToken, categoryCode])

  const status = data?.import?.state || 'draft'
  const statusMeta = STATUS_META[status] || STATUS_META.processing
  const images = draft?.images || []
  const attrs = draft?.attributes || []
  const editableAttributeRows = useMemo(
    () => attrs.map((attribute, index) => ({ attribute, index })).filter(({ attribute }) => !isPlatformAttribute(attribute)),
    [attrs],
  )
  const kaspiAttrs = useMemo(() => attrs.filter((attribute) => {
    const code = String(attribute?.code || '').trim()
    return code && !/^предзаказ$/i.test(code) && !/^срок доставки/i.test(code)
  }), [attrs])
  const mandatoryAttributeDefs = useMemo(() => attributeDefs.filter((definition) => definition.mandatory), [attributeDefs])
  const missingMandatoryAttributes = useMemo(() => {
    if (!mandatoryAttributeDefs.length) return []
    const aliases = definitionsByAlias(attributeDefs)
    const values = new Map()
    kaspiAttrs.forEach((attribute) => {
      const definition = findDefinition(attribute.code, attributeDefs, aliases)
      if (definition) values.set(definition.code, attribute.value)
    })
    return mandatoryAttributeDefs.filter((definition) => {
      const value = values.get(definition.code)
      return value == null || String(value).trim() === ''
    })
  }, [attributeDefs, kaspiAttrs, mandatoryAttributeDefs])
  const attributeDefMap = useMemo(() => definitionsByAlias(attributeDefs), [attributeDefs])
  const feed = data?.priceList || data?.import?.priceList || feedInfo || null
  const feedIsLocal = feed?.url && localFeedUrl(feed.url)
  /* Photos we host ourselves — uploaded by hand, or mirrored off the marketplace
     CDN — are only a problem when Kaspi cannot reach this platform at all. The
     feed URL is built from PUBLIC_BASE_URL, so it answers exactly that. */
  const platformIsLocal = feed?.url ? feedIsLocal : localFeedUrl(window.location.origin)
  const selfHostedPhotos = useMemo(() => images.some((image) => image.url.startsWith('/uploads/')), [images])
  const localPhotos = selfHostedPhotos && platformIsLocal
  /* The card is with Kaspi and the seller is now retyping it into the cabinet.
     Freeze what Kaspi already holds so a stray keystroke cannot put the two out
     of step; price, stock and lead time stay live — those travel by feed. */
  const cardFrozen = !!data?.cardLocked && !unlockedForEdit
  const missingFields = useMemo(() => {
    const fields = ['sku', 'title', 'brand', 'category'].filter((field) => !String(draft?.[field] || '').trim())
    const warehouses = String(draft?.warehouses || '').split(/[\n,;]/).map((value) => value.trim()).filter(Boolean)
    const days = Number(draft?.deliveryDays)
    if (!(Number(draft?.salePrice ?? draft?.price) > 0)) fields.push('price')
    if (!(Number(draft?.stock ?? draft?.quantity) > 0)) fields.push('stock')
    if (!warehouses.length) fields.push('warehouses')
    if (!Number.isFinite(days) || days < 1 || days > 30) fields.push('deliveryDays')
    if (!images.length) fields.push('images')
    if (missingMandatoryAttributes.length) fields.push('attributes')
    return fields
  }, [draft, images.length, missingMandatoryAttributes.length])
  const missingText = missingFields.map((field) => missingLabel(t, field)).join(', ')
  const hasOnlyPlatformAttributes = attrs.length > 0 && !kaspiAttrs.length
  const categoryNeedsKaspiCode = !!String(draft?.category || '').trim() && !/^Master\s*-/i.test(String(draft?.category || '').trim())
  const hasCategoryCode = /^Master\s*-/i.test(String(draft?.category || '').trim())
  const categoryInputValue = categoryOpen ? categoryQuery : (draft?.categoryTitle && draft?.category ? `${draft.categoryTitle} · ${draft.category}` : draft?.category || '')
  const aiConfigured = aiProvider === 'gemini' ? aiSettings.geminiConfigured : aiSettings.openaiConfigured
  const attributeAiProvider = aiConfigured ? aiProvider : (aiSettings.openaiConfigured ? 'openai' : aiSettings.geminiConfigured ? 'gemini' : aiProvider)
  const attributeAiConfigured = attributeAiProvider === 'gemini' ? aiSettings.geminiConfigured : aiSettings.openaiConfigured
  const aiPreviewCount = Object.keys(aiResults).length
  const kaspiAttributeIssues = data?.import?.attributeIssues || []
  const liveAttributeIssues = useMemo(() => validateAttributes(attrs, attributeDefs), [attributeDefs, attrs])
  const clientAttributeIssues = validationAttempted ? liveAttributeIssues : []
  const attributeAiTargets = useMemo(() => {
    const codes = new Set(liveAttributeIssues.filter((issue) => issue.action !== 'delete').map((issue) => issue.code))
    return attributeDefs.filter((definition) => definition.mandatory && codes.has(definition.code))
  }, [attributeDefs, liveAttributeIssues])
  const unresolvedKaspiAttributeIssues = useMemo(() => {
    if (!attributeDefs.length) return kaspiAttributeIssues
    const aliases = definitionsByAlias(attributeDefs)
    return kaspiAttributeIssues.filter((issue) => {
      const definition = findDefinition(issue.code, attributeDefs, aliases)
      if (!definition) return true
      const indexed = Number.isInteger(issue.uiIndex) && issue.uiIndex >= 0 ? attrs[issue.uiIndex] : null
      const current = indexed && findDefinition(indexed.code, attributeDefs, aliases)?.code === definition.code
        ? indexed
        : attrs.find((attribute) => findDefinition(attribute.code, attributeDefs, aliases)?.code === definition.code)
      if (!current) return true
      return validateAttributes([current], [definition]).length > 0
    })
  }, [attributeDefs, attrs, kaspiAttributeIssues])
  const activeAttributeIssues = useMemo(() => {
    const seen = new Set()
    return [...serverAttributeIssues, ...clientAttributeIssues, ...unresolvedKaspiAttributeIssues].filter((issue) => {
      const key = `${issue.kind || issue.field}|${issue.uiIndex}|${issue.code}|${issue.value}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [clientAttributeIssues, serverAttributeIssues, unresolvedKaspiAttributeIssues])
  const kaspiIssueRows = useMemo(() => {
    const rows = new Map()
    activeAttributeIssues.forEach((issue) => {
      if (Number.isInteger(issue.uiIndex) && issue.uiIndex >= 0) {
        const current = attrs[issue.uiIndex]
        const currentDefinition = findDefinition(current?.code, attributeDefs)
        const issueDefinition = findDefinition(issue.code, attributeDefs)
        const sameDefinition = currentDefinition && issueDefinition && currentDefinition.code === issueDefinition.code
        if (!current || !issue.code || sameDefinition || attributeMatchKey(current.code) === attributeMatchKey(issue.code)) rows.set(issue.uiIndex, issue)
      }
      const key = attributeKey(issue)
      attrs.forEach((attribute, index) => {
        if (attributeKey(attribute) === key) rows.set(index, issue)
      })
    })
    return rows
  }, [activeAttributeIssues, attributeDefs, attrs])

  const updateDraft = (updater) => {
    setDraft((current) => updater(current))
    setDirty(true)
    setMessage('')
  }
  const setField = (key, value) => updateDraft((current) => ({ ...current, [key]: value }))
  const setAttribute = (index, key, value) => {
    setServerAttributeIssues((current) => current.filter((issue) => issue.uiIndex !== index))
    updateDraft((current) => ({
      ...current,
      attributes: current.attributes.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const next = { ...item, [key]: value }
        const definition = findDefinition(next.code, attributeDefs)
        return definition ? { ...next, code: definition.code } : next
      }),
    }))
  }
  const setEnumAttribute = (index, multiValued, event) => {
    const value = multiValued
      ? [...event.target.selectedOptions].map((option) => option.value).filter(Boolean).join(', ')
      : event.target.value
    setAttribute(index, 'value', value)
  }
  const removeAttribute = (index) => updateDraft((current) => ({ ...current, attributes: current.attributes.filter((_, itemIndex) => itemIndex !== index) }))
  const addAttribute = () => updateDraft((current) => ({ ...current, attributes: [...current.attributes, { code: '', value: '' }] }))
  const addRequiredAttributes = () => {
    const mandatory = mandatoryAttributeDefs.length ? mandatoryAttributeDefs : attributeDefs.filter((definition) => definition.mandatory)
    if (!mandatory.length) return
    updateDraft((current) => {
      const existing = Array.isArray(current.attributes) ? current.attributes : []
      const aliases = definitionsByAlias(attributeDefs)
      const existingCodes = new Set(existing.map((attribute) => findDefinition(attribute.code, attributeDefs, aliases)?.code).filter(Boolean))
      const missing = mandatory
        .filter((definition) => !existingCodes.has(definition.code))
        .map((definition) => ({ code: definition.code, value: '' }))
      return missing.length ? { ...current, attributes: [...existing, ...missing] } : current
    })
  }
  const attributeAiErrorText = (code) => {
    if (code === 'ai_not_configured') return t('preorder_detail.ai_no_key')
    if (code === 'ai_auth_failed') return t('preorder_detail.ai_auth_failed')
    if (code === 'ai_quota') return t('preorder_detail.ai_quota')
    if (code === 'ai_unavailable') return t('preorder_detail.ai_unavailable')
    return t('preorder_detail.ai_attributes_failed')
  }
  const fillRequiredAttributesWithAi = async () => {
    if (!attributeAiTargets.length || attributeAiBusy) return
    if (!attributeAiConfigured) {
      setAttributeAiError(t('preorder_detail.ai_no_key'))
      return
    }
    setAttributeAiBusy(true)
    setAttributeAiError('')
    setAttributeAiMessage('')
    try {
      const result = await API.suggestTaobaoAttributes(id, {
        provider: attributeAiProvider,
        product: payload(),
        attributes: attributeAiTargets,
      })
      const suggestions = Array.isArray(result.suggestions) ? result.suggestions : []
      if (!suggestions.length) {
        setAttributeAiError(t('preorder_detail.ai_attributes_empty'))
        return
      }
      updateDraft((current) => {
        const next = Array.isArray(current.attributes) ? [...current.attributes] : []
        const targetCodes = new Set(attributeAiTargets.map((attribute) => attribute.code))
        suggestions.forEach((suggestion) => {
          const code = String(suggestion.code || '').trim()
          const value = String(suggestion.value || '').trim()
          if (!code || !value) return
          const index = next.findIndex((attribute) => String(attribute.code || '').trim() === code)
          if (index >= 0) {
            if (targetCodes.has(code)) next[index] = { ...next[index], value }
          } else {
            next.push({ code, value })
          }
        })
        return { ...current, attributes: next }
      })
      setAttributeAiMessage(t('preorder_detail.ai_attributes_applied', { count: suggestions.length }))
    } catch (requestError) {
      setAttributeAiError(attributeAiErrorText(requestError.code || ''))
    } finally {
      setAttributeAiBusy(false)
    }
  }
  const handleCategoryInput = (value) => {
    const clean = String(value || '')
    const code = /^Master\s*-/i.test(clean.trim()) ? clean.trim() : ''
    setCategoryQuery(clean)
    setCategoryOpen(true)
    setCategoryError('')
    updateDraft((current) => ({ ...current, category: code, categoryTitle: '' }))
  }
  const openCategoryPicker = () => {
    setCategoryOpen(true)
    if (!selectedStore?.hasToken) {
      setCategoryError(t('preorder_detail.category_need_token'))
      return
    }
    if (!categoryResults.length && !categoryLoading) searchCategories(draft?.categoryTitle || draft?.title || draft?.category || categoryQuery || '')
  }
  const searchCategories = async (query = categoryQuery || draft?.category || draft?.title || '') => {
    if (categoryLoading) return
    if (!selectedStore?.hasToken) {
      setCategoryOpen(true)
      setCategoryError(t('preorder_detail.category_need_token'))
      return
    }
    const clean = String(query || '').trim()
    setCategoryQuery(clean)
    setCategoryOpen(true)
    setCategoryLoading(true)
    setCategoryError('')
    try {
      const result = await API.storeCategories(selectedStore.id, { q: clean, limit: 24 })
      setCategoryResults(result.categories || [])
    } catch (requestError) {
      setCategoryError(requestError.code === 'no_token' ? t('preorders.no_token') : t('preorder_detail.category_lookup_error'))
      setCategoryResults([])
    } finally {
      setCategoryLoading(false)
    }
  }
  const pickCategory = (category) => {
    updateDraft((current) => ({ ...current, category: category.code, categoryTitle: category.title }))
    setCategoryQuery(category.title)
    setCategoryOpen(false)
    setCategoryResults([])
    setError('')
  }
  /* Kaspi's own form wants the photos as files, so hand over the whole set at
     once. The server fetches them, which also covers any still on the source CDN. */
  const downloadPhotos = async () => {
    try {
      const blob = await API.taobaoImagesZip(id)
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `${draft?.sku || 'kaspi'}-photos.zip`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch {
      setError(t('preorder_detail.photos_zip_error'))
    }
  }
  const copyAllAttributes = async () => {
    const text = (draft?.attributes || [])
      .filter((attribute) => attribute.code && String(attribute.value ?? '').trim())
      .map((attribute) => `${attributeDefMap.get(attributeMatchKey(attribute.code))?.labelRu || attribute.code}\t${attribute.value}`)
      .join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setMessage(t('preorder_detail.attributes_copied'))
    } catch {
      setError(t('preorder_detail.copy_error'))
    }
  }
  const copyFeedUrl = async () => {
    if (!feed?.url) return
    try {
      await navigator.clipboard.writeText(feed.url)
      setFeedCopied(true)
      setTimeout(() => setFeedCopied(false), 1800)
    } catch {
      setFeedError(t('preorder_detail.feed_copy_error'))
    }
  }
  /* Switching a pickup point off keeps it in the XML with available="no" — the
     only way Kaspi stops selling from it. */
  const saveWarehouses = async (warehouses) => {
    if (!storeId) return
    setFeedError('')
    try {
      const result = await API.saveStorePreorderFeed(storeId, { warehouses })
      setFeedInfo(result.feed)
    } catch {
      setFeedError(t('preorder_detail.save_error'))
    }
  }

  const unlockCard = async () => {
    if (!window.confirm(t('preorder_detail.unlock_confirm'))) return
    setUnlocking(true)
    setError('')
    try {
      const result = await API.unlockPreorderCard(id)
      setData(result.preorder)
      setMessage(t('preorder_detail.unlocked'))
    } catch {
      setError(t('preorder_detail.save_error'))
    } finally {
      setUnlocking(false)
    }
  }

  const scrollToPhotos = () => {
    document.getElementById('preorder-photos')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const scrollToAttributes = () => {
    document.getElementById('preorder-attributes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const fixAttributeList = () => {
    updateDraft((current) => ({
      ...current,
      attributes: reconcileAttributes(current.attributes, attributeDefs).attributes,
    }))
    setServerAttributeIssues([])
    setValidationAttempted(true)
  }
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
    preorder: true,
    preOrder: true,
    saleMode: 'preorder',
    sourceType: 'taobao',
    deliveryDays: Math.min(30, Math.max(1, Math.round(Number(draft.deliveryDays) || 14))),
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
    setValidationAttempted(true)
    setServerAttributeIssues([])
    const localIssues = validateAttributes(attrs, attributeDefs)
    if (categoryNeedsKaspiCode) {
      setError(t('preorder_detail.category_code_note'))
      document.querySelector('.category-code-field')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (localIssues.length) {
      setError(t('preorder_detail.attribute_validation_summary', { count: localIssues.length }))
      setTimeout(scrollToAttributes, 0)
      return
    }
    if (missingFields.length) {
      setError(t('preorder_detail.preorder_missing', { fields: missingText }))
      return
    }
    setPublishing(true)
    setMessage('')
    setError('')
    try {
      const saved = await save({ quiet: true })
      if (!saved) return
      const result = await API.importTaobao(id, { storeId, product: saved.product })
      if (result.priceList) setFeedInfo(result.priceList)
      setMessage(t('preorder_detail.published', { code: result.result?.code || result.import?.code || '—' }))
      await load()
    } catch (publishError) {
      const serverMissing = publishError.data?.missing
      const serverMissingText = Array.isArray(serverMissing) ? serverMissing.map((field) => missingLabel(t, field)).join(', ') : ''
      const attributeIssues = Array.isArray(publishError.data?.issues) ? publishError.data.issues : []
      if (attributeIssues.length) {
        setServerAttributeIssues(attributeIssues)
        setValidationAttempted(true)
        setError(t('preorder_detail.attribute_validation_summary', { count: attributeIssues.length }))
        setTimeout(scrollToAttributes, 0)
        return
      }
      setError(publishError.code === 'no_token'
        ? t('preorders.no_token')
        : publishError.code === 'bad_category'
          ? t('preorder_detail.category_code_note')
        : (publishError.code === 'missing_product_fields' || publishError.code === 'missing_preorder_fields')
          ? t('preorder_detail.preorder_missing', { fields: serverMissingText || missingText || '—' })
          : t('preorder_detail.publish_error'))
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
      {!!activeAttributeIssues.length && (
        <div className="preorder-attribute-alert">
          <div className="preorder-attribute-alert-head">
            <span className="msym">rule</span>
            <div><b>{t('preorder_detail.kaspi_attribute_errors_title')}</b><span>{t('preorder_detail.kaspi_attribute_errors_sub')}</span></div>
            <button className="btn btn-ghost btn-sm" type="button" onClick={scrollToAttributes}><span className="msym">arrow_downward</span>{t('preorder_detail.to_attributes')}</button>
          </div>
          <div className="preorder-attribute-alert-list">
            {activeAttributeIssues.map((issue, issueIndex) => (
              <div className="preorder-attribute-alert-row" key={`${issue.path}-${issue.code}-${issue.value}`}>
                <b>{issue.labelRu || t('preorder_detail.kaspi_attribute_error_row', { n: Number.isInteger(issue.uiIndex) && issue.uiIndex >= 0 ? issue.uiIndex + 1 : (issue.index ?? issueIndex) + 1 })}</b>
                <span>{issue.action === 'delete' ? t('preorder_detail.attribute_action_delete') : issue.action === 'choose' ? t('preorder_detail.attribute_action_choose') : t('preorder_detail.attribute_action_fill')}</span>
                <em>{issue.advice || issue.message || issue.detail}</em>
                {!!issue.allowedValues?.length && <small>{t('preorder_detail.attribute_allowed')}: {issue.allowedValues.slice(0, 8).join(', ')}{issue.allowedValues.length > 8 ? '…' : ''}</small>}
              </div>
            ))}
          </div>
          {!!attributeDefs.length && activeAttributeIssues.some((issue) => issue.field === 'code' || issue.action === 'delete') && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={fixAttributeList}><span className="msym">auto_fix_high</span>{t('preorder_detail.fix_attribute_list')}</button>
          )}
        </div>
      )}
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

      {cardFrozen && (
        <div className="preorder-copy-bar">
          <span className="msym">content_paste</span>
          <div>
            <b>{t('preorder_detail.copy_mode_title')}</b>
            <span>{t('preorder_detail.copy_mode_sub')}</span>
          </div>
          <button className="btn btn-primary btn-sm" type="button" onClick={downloadPhotos} disabled={!images.length}>
            <span className="msym">folder_zip</span>{t('preorder_detail.download_photos')}
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setUnlockedForEdit(true)}>
            <span className="msym">edit</span>{t('preorder_detail.edit_card')}
          </button>
        </div>
      )}

      <div className="preorder-detail-grid">
        <Card title={t('preorder_detail.main_title')} sub={t('preorder_detail.main_sub')}>
          <div className={`preorder-form-grid ${cardFrozen ? 'frozen' : ''}`}>
            <label><CopyLabel text={t('common.sku')} value={draft.sku} title={t('preorder_detail.copy')} /><input className="input mono" value={draft.sku || ''} readOnly={cardFrozen} onChange={(event) => setField('sku', event.target.value)} /></label>
            <label><CopyLabel text={t('common.brand')} value={draft.brand} title={t('preorder_detail.copy')} /><input className="input" value={draft.brand || ''} readOnly={cardFrozen} onChange={(event) => setField('brand', event.target.value)} /></label>
            <label className="span-2"><CopyLabel text={t('common.product')} value={draft.title} title={t('preorder_detail.copy')} /><input className="input" value={draft.title || ''} readOnly={cardFrozen} onChange={(event) => setField('title', event.target.value)} /></label>
            <div className="span-2">
              <CopyLabel text={t('common.category')} value={draft.categoryTitle || draft.category} title={t('preorder_detail.copy')} />
              <div className="category-code-field">
                <input className="input" value={categoryInputValue} readOnly={cardFrozen} onFocus={cardFrozen ? undefined : openCategoryPicker} onChange={(event) => handleCategoryInput(event.target.value)} placeholder={t('preorder_detail.category_code_ph')} />
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => searchCategories(draft.categoryTitle || draft.title || categoryQuery)} disabled={categoryLoading}>
                  <span className={`msym ${categoryLoading ? 'spin' : ''}`}>{categoryLoading ? 'progress_activity' : 'manage_search'}</span>{t('preorder_detail.category_lookup')}
                </button>
              </div>
              <div className="category-code-help">
                <span className="msym">{hasCategoryCode ? 'check_circle' : 'info'}</span>
                <span>{hasCategoryCode ? t('preorder_detail.category_selected_note') : t('preorder_detail.category_doc_note')}</span>
              </div>
              {categoryOpen && (
                <div className="category-picker">
                  {!selectedStore?.hasToken ? (
                    <div className="category-picker-token">
                      <span className="msym">key_off</span>
                      <div><b>{t('preorder_detail.category_token_title')}</b><span>{t('preorder_detail.category_need_token')}</span></div>
                      <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate('/connect')}><span className="msym">vpn_key</span>{t('preorder_detail.category_open_token')}</button>
                    </div>
                  ) : (
                    <>
                      <div className="category-picker-search">
                        <input className="input" value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && searchCategories()} placeholder={t('preorder_detail.category_search_ph')} />
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => searchCategories()} disabled={categoryLoading}>
                          <span className={`msym ${categoryLoading ? 'spin' : ''}`}>{categoryLoading ? 'progress_activity' : 'search'}</span>{t('preorder_detail.category_search')}
                        </button>
                        <button className="icon-btn" type="button" title={t('common.close')} onClick={() => setCategoryOpen(false)}><span className="msym">close</span></button>
                      </div>
                      {categoryError && <div className="cf-err"><span className="msym">error</span>{categoryError}</div>}
                      {categoryLoading && <div className="category-picker-empty"><span className="msym spin">progress_activity</span>{t('preorder_detail.category_loading')}</div>}
                      {!categoryLoading && !categoryError && !categoryResults.length && <div className="category-picker-empty"><span className="msym">category</span>{t('preorder_detail.category_empty')}</div>}
                      {!categoryLoading && !!categoryResults.length && (
                        <div className="category-picker-list">
                          {categoryResults.map((category) => (
                            <button className="category-picker-row" type="button" key={category.code} onClick={() => pickCategory(category)}>
                              <b>{category.title}</b>
                              <span>{category.code}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <label className="span-2"><CopyLabel text={t('taobao.description')} value={draft.description} title={t('preorder_detail.copy')} /><textarea className="input preorder-description" value={draft.description || ''} readOnly={cardFrozen} onChange={(event) => setField('description', event.target.value)} /></label>
          </div>
        </Card>

        <Card title={t('preorder_detail.publish_title')} sub={t('preorder_detail.publish_sub')}>
          <div className="preorder-publish-fields">
            <label><span className="field-label">{t('preorders.store')}</span><select className="select" value={storeId} onChange={(event) => { setStoreId(event.target.value); setDirty(true); setMessage('') }}><option value="">{t('taobao.pick_store')}</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
            <div className="preorder-form-grid">
              <label><span className="field-label">{t('products.sale_price')}</span><input className="input mono" type="number" min="1" value={draft.salePrice ?? draft.price ?? 0} onChange={(event) => setField('salePrice', event.target.value)} /></label>
              <label><span className="field-label">{t('taobao.delivery_days')}</span><input className="input mono" type="number" min="1" max="30" value={draft.deliveryDays ?? 14} onChange={(event) => setField('deliveryDays', event.target.value)} /></label>
              <label><span className="field-label">{t('common.stock')}</span><input className="input mono" type="number" min="1" value={draft.stock ?? 0} onChange={(event) => setField('stock', event.target.value)} /></label>
              <div className="preorder-price-hint"><span className="msym">payments</span>{tenge(draft.salePrice ?? draft.price ?? 0)}</div>
              <label className="span-2"><span className="field-label">{t('taobao.warehouses')}</span><input className="input" value={draft.warehouses || ''} onChange={(event) => setField('warehouses', event.target.value)} placeholder={t('taobao.warehouses_ph')} /></label>
            </div>
            <div className={`preorder-publish-photos ${images.length ? '' : 'empty'}`}>
              <div className="preorder-publish-photo-preview">
                {images[0]?.url ? <img src={images[0].url} alt={t('preorder_detail.publish_photos_title')} referrerPolicy="no-referrer" /> : <span className="msym">add_photo_alternate</span>}
              </div>
              <div className="preorder-publish-photo-body">
                <div className="preorder-publish-photo-head">
                  <b>{t('preorder_detail.publish_photos_title')}</b>
                  <span className={`pill ${images.length ? 'brand' : ''}`}>{t('preorder_detail.photos_count', { count: images.length })}</span>
                </div>
                <p>{images.length ? t('preorder_detail.publish_photos_sub') : t('preorder_detail.publish_photos_empty')}</p>
                <div className="preorder-publish-photo-actions">
                  <label className={`btn btn-ghost btn-sm ${uploading ? 'disabled' : ''}`}>
                    <span className={`msym ${uploading ? 'spin' : ''}`}>{uploading ? 'progress_activity' : 'upload'}</span>
                    {t('preorder_detail.upload_photos')}
                    <input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={uploadPhotos} />
                  </label>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={scrollToPhotos}><span className="msym">photo_library</span>{t('preorder_detail.photos_manage')}</button>
                </div>
              </div>
            </div>
            {!selectedStore?.hasToken && <div className="mini-note"><span className="msym">key_off</span>{t('taobao.err_no_token')}</div>}
            {!!missingFields.length && <div className="mini-note warn"><span className="msym">error</span>{t('preorder_detail.preorder_missing', { fields: missingText })}</div>}
            {!!missingMandatoryAttributes.length && <div className="mini-note warn"><span className="msym">rule</span>{t('preorder_detail.attributes_required_missing', { count: missingMandatoryAttributes.length })}</div>}
            {!missingFields.length && categoryNeedsKaspiCode && <div className="mini-note warn"><span className="msym">category</span>{t('preorder_detail.category_code_note')}</div>}
            {!missingFields.length && hasOnlyPlatformAttributes && <div className="mini-note"><span className="msym">info</span>{t('preorder_detail.attributes_optional')}</div>}
            {hasCategoryCode && <div className="mini-note"><span className="msym">fact_check</span>{t('preorder_detail.category_verify_note', { category: draft.categoryTitle || draft.category })}</div>}
            {localPhotos && <div className="mini-note warn"><span className="msym">cloud_off</span>{t('preorder_detail.local_photo_note')}</div>}
            <div className="preorder-feed-card">
              <div className="preorder-feed-head">
                <span className="msym">rss_feed</span>
                <div><b>{t('preorder_detail.feed_title')}</b><span>{t('preorder_detail.feed_sub')}</span></div>
                <span className="pill mono">{feedLoading ? '...' : `${feed?.items || 0}`}</span>
              </div>
              {feed?.url ? (
                <div className="preorder-feed-url">
                  <input className="input mono" readOnly value={feed.url} />
                  <button className="btn btn-ghost btn-sm" type="button" onClick={copyFeedUrl}><span className="msym">{feedCopied ? 'check' : 'content_copy'}</span>{feedCopied ? t('preorder_detail.feed_copied') : t('preorder_detail.feed_copy')}</button>
                  <a className="btn btn-ghost btn-sm" href={feed.url} target="_blank" rel="noreferrer"><span className="msym">open_in_new</span>{t('preorder_detail.feed_open')}</a>
                </div>
              ) : (
                <div className="mini-note"><span className="msym">info</span>{feedError || t('preorder_detail.feed_wait')}</div>
              )}
              {feed?.url && <div className={`mini-note ${feedIsLocal ? 'warn' : ''}`}><span className="msym">{feedIsLocal ? 'warning' : 'settings'}</span>{feedIsLocal ? t('preorder_detail.feed_local_note') : t('preorder_detail.feed_note')}</div>}
              {!!feed?.warehouses?.length && (
                <div className="preorder-feed-warehouses">
                  <span className="field-label">{t('preorder_detail.feed_warehouses')}</span>
                  {feed.warehouses.map((warehouse) => (
                    <label key={warehouse.id} className="preorder-feed-warehouse">
                      <input
                        type="checkbox"
                        checked={warehouse.available !== false}
                        onChange={(event) => saveWarehouses(feed.warehouses.map((row) => (
                          row.id === warehouse.id ? { ...row, available: event.target.checked } : row
                        )))}
                      />
                      <span className="mono">{warehouse.id}</span>
                      <span>{warehouse.available !== false ? t('preorder_detail.feed_wh_yes') : t('preorder_detail.feed_wh_no')}</span>
                    </label>
                  ))}
                  <span className="field-hint">{t('preorder_detail.feed_warehouses_hint')}</span>
                </div>
              )}
            </div>
            {data.cardLocked ? (
              <div className="preorder-card-lock">
                <div><span className="msym">lock</span><b>{t('preorder_detail.card_locked')}</b></div>
                <p>{t('preorder_detail.card_locked_note')}</p>
                <button className="btn btn-ghost btn-sm" type="button" onClick={unlockCard} disabled={unlocking}>
                  <span className={`msym ${unlocking ? 'spin' : ''}`}>{unlocking ? 'progress_activity' : 'lock_open'}</span>
                  {t('preorder_detail.unlock_card')}
                </button>
              </div>
            ) : (
              <button className="btn btn-primary preorder-publish-button" onClick={publish} disabled={publishing || saving || attributesLoading || !selectedStore?.hasToken}><span className={`msym ${publishing ? 'spin' : ''}`}>{publishing ? 'progress_activity' : 'publish'}</span>{t(status === 'draft' ? 'preorder_detail.publish_first' : 'preorder_detail.publish')}</button>
            )}
          </div>
        </Card>
      </div>

      <div id="preorder-attributes">
        <Card title={t('preorder_detail.attributes_title')} sub={t('preorder_detail.attributes_sub')} aside={(
          <>
            <button className="btn btn-ghost btn-sm" type="button" onClick={copyAllAttributes} disabled={!draft.attributes?.length}><span className="msym">content_copy</span>{t('preorder_detail.copy_all_attributes')}</button>
            {!cardFrozen && !!attributeAiTargets.length && <button className="btn btn-primary btn-sm" onClick={fillRequiredAttributesWithAi} disabled={attributeAiBusy || !attributeAiConfigured}><span className={`msym ${attributeAiBusy ? 'spin' : ''}`}>{attributeAiBusy ? 'progress_activity' : 'auto_awesome'}</span>{attributeAiBusy ? t('preorder_detail.ai_attributes_progress') : t('preorder_detail.ai_attributes_run')}</button>}
            {!cardFrozen && !!mandatoryAttributeDefs.length && <button className="btn btn-ghost btn-sm" onClick={addRequiredAttributes}><span className="msym">rule</span>{t('preorder_detail.add_required_attributes')}</button>}
            {!cardFrozen && <button className="btn btn-ghost btn-sm" onClick={addAttribute}><span className="msym">add</span>{t('preorder_detail.add_attribute')}</button>}
          </>
        )}>
        <div className="preorder-attributes">
          {attributesLoading && <div className="mini-note"><span className="msym spin">progress_activity</span>{t('preorder_detail.attributes_loading')}</div>}
          {attributesError && <div className="cf-err"><span className="msym">error</span>{attributesError}</div>}
          {(attributeAiMessage || attributeAiError) && <div className={attributeAiError ? 'cf-err' : 'cf-ok'}><span className="msym">{attributeAiError ? 'error' : 'check_circle'}</span>{attributeAiError || attributeAiMessage}</div>}
          {!!attributeAiTargets.length && !attributeAiConfigured && <div className="preorder-ai-key-warning preorder-attribute-ai-key"><span className="msym">key_off</span><span>{t('preorder_detail.ai_no_key')}</span><button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')}><span className="msym">settings</span>{t('preorder_detail.ai_open_settings')}</button></div>}
          {!!mandatoryAttributeDefs.length && <div className="mini-note" style={{ alignItems: 'flex-start' }}><span className="msym">rule</span>{t('preorder_detail.attributes_required_note', { count: mandatoryAttributeDefs.length })}</div>}
          <div className="preorder-attribute-cheatsheet">
            <div><span className="msym">tips_and_updates</span><b>{t('preorder_detail.attribute_cheat_title')}</b></div>
            <ul>
              <li>{t('preorder_detail.attribute_cheat_1')}</li>
              <li>{t('preorder_detail.attribute_cheat_2')}</li>
              <li>{t('preorder_detail.attribute_cheat_3')}</li>
            </ul>
          </div>
          {editableAttributeRows.map(({ attribute, index }) => {
            const definition = attributeDefMap.get(attributeMatchKey(attribute.code))
            const isRequired = !!definition?.mandatory
            const isMissing = isRequired && !String(attribute.value || '').trim()
            const kaspiIssue = kaspiIssueRows.get(index)
            const enumValues = definition?.values || []
            const currentEnumValues = String(attribute.value || '').split(/[,;\n]+/).map((value) => value.trim()).filter(Boolean)
            const selectedEnumValues = currentEnumValues.map((value) => allowedValue(value, enumValues)?.code || value)
            const booleanValue = /^(true|да|yes|1)$/i.test(String(attribute.value || '').trim())
              ? 'true'
              : /^(false|нет|no|0)$/i.test(String(attribute.value || '').trim())
                ? 'false'
                : ''
            return (
              <div className={`preorder-attribute-row ${isMissing ? 'missing' : ''} ${kaspiIssue ? 'kaspi-error' : ''}`} key={`${index}-${attribute.code}`}>
                <div className="preorder-attribute-name">
                  {attributeDefs.length ? (
                    <select className="select" value={definition?.code || attribute.code} disabled={cardFrozen} onChange={(event) => setAttribute(index, 'code', event.target.value)}>
                      {!attribute.code && <option value="">{t('preorder_detail.attribute_code')}</option>}
                      {attribute.code && !definition && <option value={attribute.code}>{t('preorder_detail.attribute_unknown')}</option>}
                      {attributeDefs.map((item) => <option key={item.code} value={item.code}>{item.labelRu || item.code}{item.mandatory ? ' *' : ''}</option>)}
                    </select>
                  ) : (
                    <input className="input" value={attribute.code} readOnly={cardFrozen} onChange={(event) => setAttribute(index, 'code', event.target.value)} placeholder={t('preorder_detail.attribute_code')} />
                  )}
                  {definition && <span>{t('preorder_detail.attribute_technical_code')}: <code>{definition.code}</code></span>}
                </div>
                <div className="preorder-attribute-value">
                  {definition?.type === 'enum' && enumValues.length ? (
                    <select
                      className="select"
                      multiple={definition.multiValued}
                      size={definition.multiValued ? Math.min(5, Math.max(3, enumValues.length)) : undefined}
                      value={definition.multiValued ? selectedEnumValues : (selectedEnumValues[0] || '')}
                      disabled={cardFrozen}
                      onChange={(event) => setEnumAttribute(index, definition.multiValued, event)}
                    >
                      {!definition.multiValued && <option value="">{t('preorder_detail.attribute_choose_value')}</option>}
                      {!definition.multiValued && attribute.value && !allowedValue(attribute.value, enumValues) && <option value={attribute.value}>{t('preorder_detail.attribute_invalid_value')}: {attribute.value}</option>}
                      {enumValues.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                    </select>
                  ) : definition?.type === 'boolean' ? (
                    <select className="select" value={booleanValue} disabled={cardFrozen} onChange={(event) => setAttribute(index, 'value', event.target.value)}>
                      <option value="">{t('preorder_detail.attribute_choose_value')}</option>
                      <option value="true">{t('preorder_detail.attribute_yes')}</option>
                      <option value="false">{t('preorder_detail.attribute_no')}</option>
                    </select>
                  ) : (
                    <input className="input" type={definition?.type === 'number' ? 'number' : 'text'} value={attribute.value} readOnly={cardFrozen} onChange={(event) => setAttribute(index, 'value', event.target.value)} placeholder={definition ? t('preorder_detail.attribute_value_typed', { type: definition.type }) : t('preorder_detail.attribute_value')} />
                  )}
                  {definition && <span>{t(`preorder_detail.attribute_type_${definition.type}`)}{definition.multiValued ? ` · ${t('preorder_detail.attribute_multi')}` : ''}{isRequired ? ` · ${t('preorder_detail.attribute_required')}` : ''}</span>}
                  {definition?.type === 'enum' && !!enumValues.length && (
                    <span className="preorder-attribute-hint">
                      <span className="msym">checklist</span>
                      {t('preorder_detail.attribute_hint_enum')}: {enumValues.slice(0, 12).map((item) => item.name).join(', ')}
                      {enumValues.length > 12 ? ` · ${t('preorder_detail.attribute_hint_more', { count: enumValues.length - 12 })}` : ''}
                    </span>
                  )}
                  {definition?.type === 'boolean' && <span className="preorder-attribute-hint"><span className="msym">toggle_on</span>{t('preorder_detail.attribute_hint_boolean')}</span>}
                  {definition?.type === 'number' && <span className="preorder-attribute-hint"><span className="msym">pin</span>{t('preorder_detail.attribute_hint_number')}</span>}
                  {definition?.type === 'string' && <span className="preorder-attribute-hint"><span className="msym">text_fields</span>{t('preorder_detail.attribute_hint_string')}</span>}
                  {kaspiIssue && <span className="preorder-attribute-problem">{kaspiIssue.advice || kaspiIssue.detail}</span>}
                </div>
                <CopyButton value={attribute.value} title={t('preorder_detail.copy')} />
                {!cardFrozen && <button className="icon-btn" title={t('preorder_detail.remove')} onClick={() => removeAttribute(index)}><span className="msym">delete</span></button>}
              </div>
            )
          })}
          {!editableAttributeRows.length && <div className="preorder-section-empty">{t('preorder_detail.no_attributes')}</div>}
        </div>
        </Card>
      </div>

      <div id="preorder-photos">
        <Card title={t('preorder_detail.photos_title')} sub={t('preorder_detail.photos_sub')} aside={(
          <>
            <button className="btn btn-ghost btn-sm" type="button" onClick={downloadPhotos} disabled={!images.length}><span className="msym">folder_zip</span>{t('preorder_detail.download_photos')}</button>
            <label className={`btn btn-primary btn-sm ${uploading ? 'disabled' : ''}`}><span className={`msym ${uploading ? 'spin' : ''}`}>{uploading ? 'progress_activity' : 'upload'}</span>{t('preorder_detail.upload_photos')}<input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={uploadPhotos} /></label>
          </>
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
              <img src={image.url} alt={`${draft.title} ${index + 1}`} referrerPolicy="no-referrer" />
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
                      <img src={sourceUrl} alt={t('preorder_detail.ai_original')} referrerPolicy="no-referrer" />
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
      </div>

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
            <img src={imageViewer.url} alt={imageViewer.title} referrerPolicy="no-referrer" />
          </div>
        </div>
      )}
    </div>
  )
}
