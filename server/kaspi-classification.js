import * as kaspi from './kaspi.js'

const RU_WORDS = new Map(Object.entries({
  type: 'тип',
  material: 'материал',
  materials: 'материалы',
  color: 'цвет',
  colour: 'цвет',
  model: 'модель',
  brand: 'бренд',
  manufacturer: 'производитель',
  vendor: 'производителя',
  code: 'артикул',
  purpose: 'назначение',
  nozzles: 'насадки',
  nozzle: 'насадка',
  size: 'размер',
  format: 'формат',
  form: 'форма',
  shape: 'форма',
  width: 'ширина',
  height: 'высота',
  length: 'длина',
  depth: 'глубина',
  diameter: 'диаметр',
  weight: 'вес',
  volume: 'объём',
  capacity: 'ёмкость',
  power: 'мощность',
  voltage: 'напряжение',
  composition: 'состав',
  quantity: 'количество',
  number: 'количество',
  count: 'количество',
  country: 'страна производства',
  season: 'сезон',
  gender: 'пол',
  age: 'возраст',
  cover: 'обложка',
  equipment: 'комплектация',
  package: 'упаковка',
  packaging: 'упаковка',
  collection: 'коллекция',
  style: 'стиль',
  pattern: 'рисунок',
  function: 'функция',
  features: 'особенности',
  feature: 'особенность',
  compatibility: 'совместимость',
  application: 'применение',
  description: 'описание',
  dimensions: 'размеры',
  washing: 'возможность мытья',
  components: 'комплектация',
  additional: 'дополнительная информация',
  product: 'товар',
  name: 'название',
}))

const RU_PHRASES = new Map(Object.entries({
  'vendor code': 'Артикул производителя',
  'brand code': 'Код бренда',
  'country of origin': 'Страна производства',
  'country of manufacture': 'Страна производства',
  'model name': 'Название модели',
  'product type': 'Тип товара',
  'set contents': 'Комплектация',
  'number of nozzles': 'Количество насадок',
  'tool dimensions': 'Размеры инструмента',
  'additional information': 'Дополнительная информация',
  'nozzles description': 'Описание насадок',
  washing: 'Возможность мытья',
  components: 'Комплектация',
  additional: 'Дополнительная информация',
}))

export function normalizeKaspiAttributeCode(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s*\*\s*/g, '*')
    .replace(/\s+/g, ' ')
}

export function attributeMatchKey(value = '') {
  return normalizeKaspiAttributeCode(value)
    .toLowerCase()
    .replace(/[*._/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function codeLeaf(value = '') {
  const parts = normalizeKaspiAttributeCode(value).split('*').filter(Boolean)
  const leaf = parts.at(-1) || value
  return String(leaf).split('.').filter(Boolean).at(-1) || leaf
}

function definitionKeys(definition = {}) {
  return new Set([
    attributeMatchKey(definition.code),
    attributeMatchKey(definition.labelRu),
    attributeMatchKey(codeLeaf(definition.code)),
  ].filter(Boolean))
}

function humanizeEnglish(value = '') {
  const spaced = String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const lower = spaced.toLowerCase()
  if (RU_PHRASES.has(lower)) return RU_PHRASES.get(lower)
  const phraseSuffix = [...RU_PHRASES.entries()].find(([phrase]) => lower.endsWith(` ${phrase}`))
  if (phraseSuffix) return phraseSuffix[1]
  const lastWord = lower.split(' ').at(-1)
  if (RU_WORDS.has(lastWord)) {
    const translated = RU_WORDS.get(lastWord)
    return translated.charAt(0).toUpperCase() + translated.slice(1)
  }
  const translated = lower.split(' ').map((word) => RU_WORDS.get(word) || word).join(' ')
  return translated ? translated.charAt(0).toUpperCase() + translated.slice(1) : 'Характеристика'
}

export function attributeLabelRu(code = '', source = {}) {
  const explicit = String(source?.titleRu || source?.nameRu || source?.title || source?.name || '').trim()
  if (explicit && /[А-Яа-яЁё]/.test(explicit)) return explicit
  const leaf = codeLeaf(code)
  if (/[А-Яа-яЁё]/.test(leaf)) return leaf.replace(/\s+/g, ' ').trim()
  return humanizeEnglish(leaf)
}

export function normalizeClassificationAttributes(data) {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []
  const seen = new Set()
  return rows.map((row) => {
    const code = normalizeKaspiAttributeCode(row?.code)
    if (!code || seen.has(code)) return null
    seen.add(code)
    return {
      code,
      labelRu: attributeLabelRu(code, row),
      type: String(row?.type || 'string').trim().toLowerCase() || 'string',
      mandatory: !!row?.mandatory,
      multiValued: !!row?.multiValued,
      values: [],
    }
  }).filter(Boolean)
}

export function normalizeClassificationValues(data) {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []
  const seen = new Set()
  return rows.map((row) => {
    const code = String(row?.code ?? row?.value ?? '').trim()
    const name = String(row?.name ?? row?.title ?? code).trim()
    if (!code || seen.has(code)) return null
    seen.add(code)
    return { code, name: name || code }
  }).filter(Boolean)
}

async function mapLimit(rows, limit, mapper) {
  const result = new Array(rows.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor
      cursor += 1
      result[index] = await mapper(rows[index], index)
    }
  })
  await Promise.all(workers)
  return result
}

export async function loadClassificationAttributes(token, category) {
  const data = await kaspi.merchantClassificationAttributes(token, category)
  const attributes = normalizeClassificationAttributes(data)
  return mapLimit(attributes, 4, async (attribute) => {
    if (attribute.type !== 'enum') return attribute
    try {
      const values = await kaspi.merchantClassificationAttributeValues(token, category, attribute.code)
      return { ...attribute, values: normalizeClassificationValues(values) }
    } catch {
      return attribute
    }
  })
}

function splitValues(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  return String(value ?? '').split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean)
}

function valueMatch(value, allowed = []) {
  const clean = String(value || '').trim().toLowerCase()
  return allowed.find((item) => item.code.toLowerCase() === clean || item.name.toLowerCase() === clean) || null
}

function issue({ kind, action, definition, attribute, uiIndex = -1, message, allowedValues = [] }) {
  return {
    kind,
    action,
    field: kind === 'unknown_code' ? 'code' : 'value',
    uiIndex,
    code: attribute?.code || definition?.code || '',
    value: attribute?.value ?? '',
    labelRu: definition?.labelRu || attributeLabelRu(attribute?.code || definition?.code),
    message,
    advice: message,
    allowedValues: allowedValues.slice(0, 30),
  }
}

export function validateClassificationAttributes(attributes = [], definitions = []) {
  const byCode = new Map(definitions.map((definition) => [definition.code, definition]))
  const byKey = new Map()
  definitions.forEach((definition) => definitionKeys(definition).forEach((key) => {
    if (!byKey.has(key)) byKey.set(key, definition)
  }))
  const normalized = []
  const issues = []
  const seen = new Map()

  attributes.forEach((attribute, uiIndex) => {
    const sourceIndex = Number.isInteger(attribute?._uiIndex) ? attribute._uiIndex : uiIndex
    const rawCode = normalizeKaspiAttributeCode(attribute?.code)
    const rawValue = attribute?.value ?? ''
    if (!rawCode && !String(rawValue).trim()) return
    const definition = byCode.get(rawCode) || byKey.get(attributeMatchKey(rawCode))
    if (!definition) {
      issues.push(issue({
        kind: 'unknown_code',
        action: 'delete',
        attribute: { code: rawCode, value: rawValue },
        uiIndex: sourceIndex,
        message: 'Этой характеристики нет в справочнике выбранной категории Kaspi. Удалите строку.',
      }))
      return
    }

    const existing = seen.get(definition.code)
    if (existing) {
      if (!String(existing.value || '').trim() && String(rawValue || '').trim()) existing.value = rawValue
      return
    }
    const row = { code: definition.code, value: rawValue, uiIndex: sourceIndex, definition }
    seen.set(definition.code, row)
    normalized.push(row)
  })

  definitions.filter((definition) => definition.mandatory).forEach((definition) => {
    if (!seen.has(definition.code)) {
      const row = { code: definition.code, value: '', uiIndex: -1, definition }
      seen.set(definition.code, row)
      normalized.push(row)
    }
  })

  const valid = []
  normalized.forEach((row) => {
    const { definition } = row
    const text = String(row.value ?? '').trim()
    if (!text) {
      if (definition.mandatory) {
        issues.push(issue({
          kind: 'missing_value',
          action: 'fill',
          definition,
          attribute: row,
          uiIndex: row.uiIndex,
          message: `Заполните обязательное поле «${definition.labelRu}».`,
        }))
      }
      return
    }

    if (definition.type === 'enum' && definition.values.length) {
      const sourceValues = definition.multiValued ? splitValues(row.value) : [text]
      const matched = sourceValues.map((value) => valueMatch(value, definition.values))
      if (!sourceValues.length || matched.some((value) => !value)) {
        issues.push(issue({
          kind: 'invalid_enum',
          action: 'choose',
          definition,
          attribute: row,
          uiIndex: row.uiIndex,
          allowedValues: definition.values.map((item) => item.name),
          message: `Для поля «${definition.labelRu}» выберите значение из списка Kaspi.`,
        }))
        return
      }
      valid.push({ code: definition.code, value: matched.map((item) => item.code).join(', ') })
      return
    }

    if (definition.type === 'boolean') {
      const bool = /^(true|да|yes|1)$/i.test(text) ? 'true' : /^(false|нет|no|0)$/i.test(text) ? 'false' : null
      if (bool == null) {
        issues.push(issue({
          kind: 'invalid_boolean',
          action: 'choose',
          definition,
          attribute: row,
          uiIndex: row.uiIndex,
          allowedValues: ['Да', 'Нет'],
          message: `Для поля «${definition.labelRu}» выберите «Да» или «Нет».`,
        }))
        return
      }
      valid.push({ code: definition.code, value: bool })
      return
    }

    if (definition.type === 'number') {
      const number = Number(text.replace(',', '.'))
      if (!Number.isFinite(number)) {
        issues.push(issue({
          kind: 'invalid_number',
          action: 'fill',
          definition,
          attribute: row,
          uiIndex: row.uiIndex,
          message: `В поле «${definition.labelRu}» укажите число без лишнего текста.`,
        }))
        return
      }
      valid.push({ code: definition.code, value: String(number) })
      return
    }

    valid.push({ code: definition.code, value: text })
  })

  return {
    attributes: valid,
    issues,
    definitions,
  }
}
