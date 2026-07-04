/* ============================================================
   Lightweight SVG charts for Kaspi X-Ray.
   Built per the dataviz method: one axis, thin marks, rounded
   4px data-ends, 2px surface gaps, recessive grid, direct
   labels + hover tooltips, legend for >=2 series. Text always
   in ink tokens; color carries entity identity only.
   ============================================================ */

import { useState } from 'react'
import { tenge, tengeShort, num, pct } from '../lib/format.js'

/* Categorical palette — validated (CVD ΔE 46, light surface). */
export const CAT_COLORS = ['#0052cc', '#10b981', '#f59e0b', '#7c5cff', '#ef4444', '#06b6d4']

/* ------------------------------------------------------------------
   Sparkline — tiny trend line for table rows. No axis, no hover.
   ------------------------------------------------------------------ */
export function Sparkline({ data, w = 88, h = 28, color }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const stepX = w / (data.length - 1)
  const y = (v) => h - 3 - ((v - min) / span) * (h - 6)
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${(i * stepX).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const up = data[data.length - 1] >= data[0]
  const stroke = color || (up ? 'var(--success)' : 'var(--danger)')
  return (
    <svg width={w} height={h} className="spark" aria-hidden="true">
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(w).toFixed(1)} cy={y(data[data.length - 1]).toFixed(1)} r="2.6" fill={stroke} />
    </svg>
  )
}

/* ------------------------------------------------------------------
   LineArea — profit & revenue over time. Two series share one ₸
   axis (profit ⊂ revenue). Crosshair + tooltip on hover.
   ------------------------------------------------------------------ */
export function LineArea({ rows, lang = 'ru', labels }) {
  const [hi, setHi] = useState(null)
  const W = 720
  const H = 260
  const padL = 12
  const padR = 12
  const padT = 16
  const padB = 26
  const iw = W - padL - padR
  const ih = H - padT - padB
  const n = rows.length
  const maxV = Math.max(...rows.map((r) => r.revenue)) * 1.08
  const x = (i) => padL + (i / (n - 1)) * iw
  const y = (v) => padT + ih - (v / maxV) * ih

  const line = (sel) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(sel(r)).toFixed(1)}`).join(' ')
  const area = (sel) => `${line(sel)} L${x(n - 1).toFixed(1)} ${(padT + ih).toFixed(1)} L${x(0).toFixed(1)} ${(padT + ih).toFixed(1)} Z`

  const grid = [0, 0.25, 0.5, 0.75, 1]
  const onMove = (e) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - padL) / iw) * (n - 1))
    setHi(Math.max(0, Math.min(n - 1, i)))
  }
  return (
    <div className="chart-block">
      <div className="legend">
        <span className="lg"><i className="sw" style={{ background: 'var(--primary)' }} />{labels?.revenue}</span>
        <span className="lg"><i className="sw" style={{ background: 'var(--success)' }} />{labels?.profit}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="linechart" onMouseMove={onMove} onMouseLeave={() => setHi(null)} preserveAspectRatio="none">
        <defs>
          <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0052cc" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#0052cc" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="gPro" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g, i) => (
          <line key={i} x1={padL} x2={W - padR} y1={padT + ih * g} y2={padT + ih * g} stroke="#eef1f3" strokeWidth="1" />
        ))}
        <path d={area((r) => r.revenue)} fill="url(#gRev)" />
        <path d={area((r) => r.profit)} fill="url(#gPro)" />
        <path d={line((r) => r.revenue)} fill="none" stroke="var(--primary)" strokeWidth="2.4" strokeLinejoin="round" />
        <path d={line((r) => r.profit)} fill="none" stroke="var(--success)" strokeWidth="2.4" strokeLinejoin="round" />
        {hi != null && (
          <g>
            <line x1={x(hi)} x2={x(hi)} y1={padT} y2={padT + ih} stroke="#c9d2dc" strokeWidth="1" strokeDasharray="4 4" />
            <circle cx={x(hi)} cy={y(rows[hi].revenue)} r="4" fill="var(--primary)" stroke="#fff" strokeWidth="2" />
            <circle cx={x(hi)} cy={y(rows[hi].profit)} r="4" fill="var(--success)" stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hi != null && (
        <div className="chart-tip" style={{ left: `${(x(hi) / W) * 100}%` }}>
          <div className="tip-hd">−{rows[hi].dayAgo} {labels?.dayShort}</div>
          <div className="tip-row"><i className="sw" style={{ background: 'var(--primary)' }} />{labels?.revenue}: <b>{tenge(rows[hi].revenue)}</b></div>
          <div className="tip-row"><i className="sw" style={{ background: 'var(--success)' }} />{labels?.profit}: <b>{tenge(rows[hi].profit)}</b></div>
        </div>
      )}
      <div className="axis-x">
        <span>−{rows[0].dayAgo} {labels?.dayShort}</span>
        <span>{labels?.today}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------
   DonutBreakdown — expense structure (part-to-whole). Direct
   labels satisfy the low-contrast relief requirement. Hover = segment.
   ------------------------------------------------------------------ */
export function DonutBreakdown({ items, lang = 'ru', centerLabel, centerValue }) {
  const [hi, setHi] = useState(null)
  const total = items.reduce((s, x) => s + x.value, 0) || 1
  const R = 78
  const r = 50
  const cx = 92
  const cy = 92
  let acc = -Math.PI / 2
  const gap = 0.03 // 2px surface gap between segments
  const arcs = items.map((it, idx) => {
    const frac = it.value / total
    const a0 = acc + gap / 2
    const a1 = acc + frac * Math.PI * 2 - gap / 2
    acc += frac * Math.PI * 2
    const large = a1 - a0 > Math.PI ? 1 : 0
    const p = (ang, rad) => [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]
    const [x0, y0] = p(a0, R)
    const [x1, y1] = p(a1, R)
    const [x2, y2] = p(a1, r)
    const [x3, y3] = p(a0, r)
    const d = `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`
    return { d, color: CAT_COLORS[idx % CAT_COLORS.length], frac, ...it }
  })
  return (
    <div className="donut-block">
      <svg viewBox="0 0 184 184" width="184" height="184" className="donut">
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color} opacity={hi == null || hi === i ? 1 : 0.35}
            onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} style={{ transition: 'opacity .15s' }} />
        ))}
        <text x="92" y="86" textAnchor="middle" className="donut-c1">{centerLabel}</text>
        <text x="92" y="106" textAnchor="middle" className="donut-c2">
          {hi != null ? pct(arcs[hi].frac * 100) : centerValue}
        </text>
      </svg>
      <ul className="donut-legend">
        {arcs.map((a, i) => (
          <li key={i} className={hi === i ? 'on' : ''} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
            <i className="sw" style={{ background: a.color }} />
            <span className="dl-name">{a.label}</span>
            <span className="dl-val mono">{tengeShort(a.value, lang)}</span>
            <span className="dl-pct mono muted">{pct(a.frac * 100)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------
   BarList — horizontal magnitude bars, single hue. Direct labels.
   value can be negative (loss) -> danger color.
   ------------------------------------------------------------------ */
export function BarList({ items, lang = 'ru', valueFmt, signed = false }) {
  const [hi, setHi] = useState(null)
  const max = Math.max(...items.map((x) => Math.abs(x.value)), 1)
  const fmt = valueFmt || ((v) => tengeShort(v, lang))
  return (
    <ul className="barlist">
      {items.map((it, i) => {
        const w = (Math.abs(it.value) / max) * 100
        const neg = it.value < 0
        return (
          <li key={i} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
            <div className="bl-top">
              <span className="bl-name" title={it.label}>{it.label}</span>
              <span className={`bl-val mono ${neg ? 'num-neg' : signed ? 'num-pos' : ''}`}>{fmt(it.value)}</span>
            </div>
            <div className="bl-track">
              <div className="bl-fill" style={{ width: `${w}%`, background: neg ? 'var(--danger-500)' : 'var(--gradient-primary)', opacity: hi == null || hi === i ? 1 : 0.55 }} />
            </div>
            {it.sub && <div className="bl-sub muted">{it.sub}</div>}
          </li>
        )
      })}
    </ul>
  )
}

/* ------------------------------------------------------------------
   Waterfall — unit economics: price minus each cost = net.
   Single ₸ axis. Cost steps neutral, net green/red (status).
   ------------------------------------------------------------------ */
export function Waterfall({ econ, labels, lang = 'ru' }) {
  const steps = [
    { key: 'price', label: labels.sale_price, value: econ.price, type: 'base' },
    { key: 'purchase', label: labels.purchase, value: -econ.purchase, type: 'cost' },
    { key: 'commission', label: labels.kaspi_commission, value: -econ.commission, type: 'cost' },
    { key: 'delivery', label: labels.delivery, value: -econ.delivery, type: 'cost' },
    { key: 'tax', label: labels.tax, value: -econ.tax, type: 'cost' },
    { key: 'packaging', label: labels.packaging, value: -econ.packaging, type: 'cost' },
    { key: 'returns', label: labels.returns_cost, value: -econ.returnsCost, type: 'cost' },
    { key: 'net', label: labels.net, value: econ.net, type: 'net' },
  ]
  const max = econ.price * 1.02
  let running = 0
  const rows = steps.map((s) => {
    if (s.type === 'base') {
      const r = { ...s, from: 0, to: s.value }
      running = s.value
      return r
    }
    if (s.type === 'net') {
      return { ...s, from: 0, to: s.value }
    }
    const from = running
    running += s.value
    return { ...s, from: running, to: from }
  })
  return (
    <div className="waterfall">
      {rows.map((r, i) => {
        const left = (Math.min(r.from, r.to) / max) * 100
        const width = (Math.abs(r.to - r.from) / max) * 100
        const bg = r.type === 'base' ? 'var(--gradient-primary)' : r.type === 'net' ? (econ.net < 0 ? 'var(--danger-500)' : 'var(--success)') : '#cbd5e1'
        return (
          <div className="wf-row" key={i}>
            <div className="wf-label">{r.label}</div>
            <div className="wf-track">
              <div className="wf-bar" style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%`, background: bg }} />
            </div>
            <div className={`wf-val mono ${r.type === 'cost' ? 'muted' : r.value < 0 ? 'num-neg' : 'num-pos'}`}>
              {r.type === 'cost' ? `−${num(Math.abs(r.value))} ₸` : tenge(r.value)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------
   TimeBars — estimated sales per day/month bucket. One measure, one
   hue, rounded bar tops anchored to the baseline, hover tooltip,
   sparse x labels. Zero buckets render as a faint baseline tick.
   ------------------------------------------------------------------ */
export function TimeBars({ series, labels, metric = 'units', cumulative = false, lang = 'ru' }) {
  const [hi, setHi] = useState(null)
  const b = series.buckets
  if (!b || !b.length) return <p className="muted">{labels.empty}</p>
  const isRev = metric === 'revenue'
  const val = (d) => (isRev ? d.revenue : d.sales)
  const cum = (d) => (isRev ? d.cumRevenue : d.cumSales)
  const fmt = (v) => (isRev ? tengeShort(v, lang) : num(v))
  const unitWord = isRev ? '₸' : labels.sales

  const W = 720
  const H = 230
  const padL = 8
  const padR = cumulative ? 46 : 8
  const padT = 14
  const padB = 30
  const iw = W - padL - padR
  const ih = H - padT - padB
  const n = b.length
  const max = Math.max(1, ...b.map(val))
  const slot = iw / n
  const gap = n > 45 ? 1.5 : n > 20 ? 3 : 6
  const bw = Math.max(2, slot - gap)
  const baseY = padT + ih
  const y = (v) => baseY - (v / max) * ih

  const cumMax = Math.max(1, ...b.map(cum))
  const cx = (i) => padL + i * slot + slot / 2
  const cy = (v) => baseY - (v / cumMax) * ih
  const cumPath = b.map((d, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)} ${cy(cum(d)).toFixed(1)}`).join(' ')

  const grid = [0, 0.5, 1]
  const idxs = n <= 12 ? b.map((_, i) => i) : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1]

  return (
    <div className="chart-block">
      {cumulative && (
        <div className="legend">
          <span className="lg"><i className="sw" style={{ background: 'var(--primary)' }} />{labels.perPeriod}</span>
          <span className="lg"><i className="sw" style={{ background: '#334155', borderRadius: 2, height: 3 }} />{labels.cumulative}</span>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="linechart" onMouseLeave={() => setHi(null)}>
        {grid.map((g, i) => (
          <line key={i} x1={padL} x2={W - padR} y1={padT + ih * g} y2={padT + ih * g} stroke="#eef1f3" strokeWidth="1" />
        ))}
        {b.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2
          const h = val(d) > 0 ? Math.max(2, baseY - y(val(d))) : 0
          const on = hi === i
          return (
            <g key={i}>
              <rect x={padL + i * slot} y={padT} width={slot} height={ih} fill="transparent" onMouseEnter={() => setHi(i)} />
              {h > 0 ? (
                <rect x={x} y={baseY - h} width={bw} height={h} rx={Math.min(4, bw / 2)} fill={on ? 'var(--primary-600)' : 'var(--primary)'} opacity={hi == null || on ? 1 : 0.55} />
              ) : (
                <rect x={x} y={baseY - 2} width={bw} height={2} rx={1} fill="#dbe3ea" />
              )}
            </g>
          )
        })}
        {cumulative && (
          <g>
            <path d={cumPath} fill="none" stroke="#334155" strokeWidth="2" strokeLinejoin="round" opacity="0.9" />
            <circle cx={cx(n - 1)} cy={cy(cum(b[n - 1]))} r="3.5" fill="#334155" stroke="#fff" strokeWidth="1.5" />
            {hi != null && <circle cx={cx(hi)} cy={cy(cum(b[hi]))} r="3.5" fill="#334155" stroke="#fff" strokeWidth="1.5" />}
          </g>
        )}
        {idxs.map((i) => (
          <text key={i} x={padL + i * slot + slot / 2} y={H - 10} textAnchor="middle" className="ax-lbl">{b[i].label}</text>
        ))}
      </svg>
      {hi != null && (
        <div className="chart-tip" style={{ left: `${(cx(hi) / W) * 100}%` }}>
          <div className="tip-hd">{b[hi].label}</div>
          <div className="tip-row"><b>{fmt(val(b[hi]))}</b> {unitWord}</div>
          {cumulative && <div className="tip-row soft-tip">∑ {fmt(cum(b[hi]))} {unitWord}</div>}
          <div className="tip-row soft-tip">{num(b[hi].ratings)} {labels.ratings}</div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------
   ParetoCurve — ABC cumulative profit share on ONE % axis.
   Points colored by A/B/C group (identity via secondary encoding
   + legend), 80%/95% reference lines.
   ------------------------------------------------------------------ */
export function ParetoCurve({ items, labels }) {
  const [hi, setHi] = useState(null)
  const W = 720
  const H = 240
  const padL = 34
  const padR = 12
  const padT = 14
  const padB = 26
  const iw = W - padL - padR
  const ih = H - padT - padB
  const n = items.length
  const x = (i) => padL + (i / (n - 1 || 1)) * iw
  const y = (v) => padT + ih - (v / 100) * ih
  const grpColor = { A: 'var(--c-a)', B: 'var(--c-b)', C: 'var(--c-c)' }
  const line = items.map((it, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(it.cumShare).toFixed(1)}`).join(' ')
  return (
    <div className="chart-block">
      <div className="legend">
        {['A', 'B', 'C'].map((g) => (
          <span className="lg" key={g}><i className="sw" style={{ background: grpColor[g] }} />{g}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="linechart" onMouseLeave={() => setHi(null)}>
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="#eef1f3" strokeWidth="1" />
            <text x={padL - 6} y={y(g) + 3} textAnchor="end" className="ax-lbl">{g}</text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(80)} y2={y(80)} stroke="var(--primary-400)" strokeWidth="1" strokeDasharray="5 4" opacity="0.6" />
        <path d={line} fill="none" stroke="#334155" strokeWidth="2" strokeLinejoin="round" />
        {items.map((it, i) => (
          <circle key={i} cx={x(i)} cy={y(it.cumShare)} r={hi === i ? 5.5 : 3.4}
            fill={grpColor[it.abc]} stroke="#fff" strokeWidth="1.5"
            onMouseEnter={() => setHi(i)} style={{ cursor: 'pointer' }} />
        ))}
      </svg>
      {hi != null && (
        <div className="chart-tip" style={{ left: `${(x(hi) / W) * 100}%` }}>
          <div className="tip-hd"><span className={`badge-abc ${items[hi].abc.toLowerCase()}`}>{items[hi].abc}</span> {items[hi].name}</div>
          <div className="tip-row">{labels.cum_share}: <b>{pct(items[hi].cumShare, 1)}</b></div>
        </div>
      )}
    </div>
  )
}
