/* ============================================================
   Kaspi category attributes — the types the import API expects.

   The classifier answers with Java type names, and the import
   API rejects a value whose JSON type does not match:
   «Значение "true" поля "Fans*Rotate function" имеет не
   правильный тип, должен быть: Boolean».
   ============================================================ */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const { validateClassificationAttributes, normalizeClassificationAttributes } = await import('../kaspi-classification.js')

const define = (code, type, extra = {}) => ({ code, labelRu: code, type, mandatory: false, multiValued: false, values: [], ...extra })
const valueOf = (result, code) => result.attributes.find((row) => row.code === code)?.value

describe('attribute types reach Kaspi as JSON, not as text', () => {
  it('sends booleans as booleans', () => {
    const result = validateClassificationAttributes(
      [{ code: 'Fans*Rotate function', value: 'true' }, { code: 'Fans*Heating mode', value: 'false' }],
      [define('Fans*Rotate function', 'boolean'), define('Fans*Heating mode', 'boolean')],
    )
    assert.equal(valueOf(result, 'Fans*Rotate function'), true)
    assert.equal(valueOf(result, 'Fans*Heating mode'), false)
    assert.deepEqual(result.issues, [])
    // false must survive the trip: it is a value, not an empty field.
    assert.match(JSON.stringify(result.attributes), /"value":false/)
  })

  it('sends numbers as numbers', () => {
    const result = validateClassificationAttributes(
      [{ code: 'Fans*Power', value: '50' }, { code: 'Fans*Weight', value: '1,5' }],
      [define('Fans*Power', 'double'), define('Fans*Weight', 'double')],
    )
    assert.equal(valueOf(result, 'Fans*Power'), 50)
    assert.equal(typeof valueOf(result, 'Fans*Power'), 'number')
    assert.equal(valueOf(result, 'Fans*Weight'), 1.5)
  })

  it('recognises the type names the classifier actually returns', () => {
    // normalizeClassificationAttributes lower-cases them; Kaspi writes Boolean, Double, Long.
    const definitions = normalizeClassificationAttributes([
      { code: 'A*Flag', type: 'Boolean' },
      { code: 'A*Size', type: 'Double' },
      { code: 'A*Count', type: 'Long' },
    ])
    const result = validateClassificationAttributes(
      [{ code: 'A*Flag', value: 'Да' }, { code: 'A*Size', value: '12.5' }, { code: 'A*Count', value: '3' }],
      definitions,
    )
    assert.equal(valueOf(result, 'A*Flag'), true)
    assert.equal(valueOf(result, 'A*Size'), 12.5)
    assert.equal(valueOf(result, 'A*Count'), 3)
  })

  it('leaves text and enum values as strings', () => {
    const result = validateClassificationAttributes(
      [{ code: 'A*Colour', value: 'Белый' }, { code: 'A*Material', value: 'пластик' }],
      [
        define('A*Colour', 'enum', { values: [{ code: 'white', name: 'Белый' }] }),
        define('A*Material', 'string'),
      ],
    )
    assert.equal(valueOf(result, 'A*Colour'), 'white')
    assert.equal(valueOf(result, 'A*Material'), 'пластик')
  })

  it('reports a value it cannot type rather than guessing', () => {
    const result = validateClassificationAttributes(
      [{ code: 'A*Flag', value: 'иногда' }, { code: 'A*Size', value: 'большой' }],
      [define('A*Flag', 'boolean'), define('A*Size', 'double')],
    )
    assert.deepEqual(result.attributes, [])
    assert.deepEqual(result.issues.map((row) => row.kind).sort(), ['invalid_boolean', 'invalid_number'])
  })
})
