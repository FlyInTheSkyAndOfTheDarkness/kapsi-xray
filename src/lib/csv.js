/* CSV export helper — builds a UTF-8 CSV (BOM for Excel) and triggers a download. */

function cell(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * @param {string} filename  e.g. 'kaspi-xray-products.csv'
 * @param {Array<{key,label}>} columns
 * @param {Array<object>} rows
 */
export function exportCSV(filename, columns, rows) {
  const header = columns.map((c) => cell(c.label)).join(';')
  const body = rows.map((r) => columns.map((c) => cell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(';')).join('\n')
  const csv = '﻿' + header + '\n' + body
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
