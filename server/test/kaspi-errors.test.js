/* ============================================================
   Turning a Kaspi rejection into something a seller can act on.

   Kaspi answers in one run-on line with a sentence per field.
   Shown raw it is unreadable; the parser has to recover which
   field failed and what to do about it. The text below is
   verbatim from a real rejection.
   ============================================================ */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.KX_DATA_DIR = mkdtempSync(join(tmpdir(), 'kx-errors-test-'))

const { attributeIssues } = await import('../routes-taobao.js')

const KASPI_TEXT = 'Fans*Heating mode: Значение "да" поля "Fans*Heating mode", имеет не правильный тип, '
  + 'должен быть: Boolean Fans*Height adjustment: Значение "да" поля "Fans*Height adjustment", '
  + 'имеет не правильный тип, должен быть: Boolean Fans*Number of speeds: Поле должно содержать '
  + 'значение из справочника, задано: да Fans*Material: Поле должно содержать значение из справочника, '
  + 'задано: да Home equipment*Colour: Поле должно содержать значение из справочника, задано: да '
  + 'Fans*Type: Поле должно содержать значение из справочника, задано: да Fans*Power: Значение "да" '
  + 'поля "Fans*Power", имеет не правильный тип, должен быть: Double Fans*Rotate function: Значение '
  + '"да" поля "Fans*Rotate function", имеет не правильный тип, должен быть: Boolean ERRORS'

const SENT = [
  { code: 'Fans*Heating mode', value: 'да' },
  { code: 'Fans*Height adjustment', value: 'да' },
  { code: 'Fans*Number of speeds', value: 'да' },
  { code: 'Fans*Material', value: 'да' },
  { code: 'Home equipment*Colour', value: 'да' },
  { code: 'Fans*Type', value: 'да' },
  { code: 'Fans*Power', value: 'да' },
  { code: 'Fans*Rotate function', value: 'да' },
]

const product = { attributes: SENT.map((row) => ({ ...row })) }
const byCode = (issues, code) => issues.find((issue) => issue.code === code)

describe('reading a Kaspi rejection', () => {
  const issues = attributeIssues([KASPI_TEXT], product, SENT)

  it('splits the run-on line into one entry per field', () => {
    assert.equal(issues.length, 8)
    assert.deepEqual(issues.map((issue) => issue.code).sort(), SENT.map((row) => row.code).sort())
  })

  it('tells a numeric field from a yes/no one', () => {
    const power = byCode(issues, 'Fans*Power')
    assert.equal(power.kind, 'wrong_type')
    assert.match(power.advice, /числово/i)
    assert.match(power.advice, /без слов/i)

    const heating = byCode(issues, 'Fans*Heating mode')
    assert.equal(heating.kind, 'wrong_type')
    assert.equal(heating.action, 'choose')
    assert.match(heating.advice, /«Да» или «Нет»/)
  })

  it('recognises a value that is not in the Kaspi list', () => {
    const colour = byCode(issues, 'Home equipment*Colour')
    assert.equal(colour.kind, 'not_in_dictionary')
    assert.equal(colour.action, 'choose')
    assert.match(colour.advice, /из своего списка/)
  })

  it('quotes back the value that was rejected', () => {
    assert.equal(byCode(issues, 'Fans*Power').value, 'да')
    assert.equal(byCode(issues, 'Fans*Type').value, 'да')
    issues.forEach((issue) => assert.match(issue.advice, /«да»/))
  })

  it('names the field in Russian and points at its row', () => {
    const power = byCode(issues, 'Fans*Power')
    assert.ok(power.labelRu && power.labelRu !== 'Fans*Power', power.labelRu)
    assert.equal(power.uiIndex, 6)
  })

  it('says nothing when Kaspi sent no attribute complaints', () => {
    assert.deepEqual(attributeIssues(['Товар отклонён модератором.'], product, SENT), [])
  })
})
