import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n/index.jsx'
import { PageHead, Card, ConnectPrompt } from '../components/ui.jsx'
import { useStore } from '../state/Store.jsx'
import { API } from '../lib/api.js'
import { tenge, num } from '../lib/format.js'

const initialForm = { sku: '', minPrice: '', frequencyMinutes: 60, stock: '', warehouses: '', active: false }

function statusText(t, rule) {
  if (rule.lastError === 'no_token') return t('repricer.err_no_token')
  if (rule.lastError === 'no_competitors') return t('repricer.err_no_competitors')
  if (rule.lastError) return t('repricer.err_generic')
  if (rule.lastAction === 'price_changed') return t('repricer.action_changed')
  if (rule.lastAction === 'min_price') return t('repricer.action_min')
  if (rule.lastAction === 'unchanged') return t('repricer.action_unchanged')
  return t('repricer.not_run')
}

export default function Repricer() {
  const { t } = useI18n()
  const { hasStore, store, products, loading, activeId } = useStore()
  const [rules, setRules] = useState([])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!activeId) return
    API.repricers(activeId).then((r) => setRules(r.rules || [])).catch(() => setRules([]))
  }, [activeId])

  useEffect(() => {
    if (!form.sku && products[0]) {
      setForm((s) => ({ ...s, sku: products[0].id, minPrice: Math.max(0, (products[0].price || 0) - 1) }))
    }
  }, [products, form.sku])

  const selected = useMemo(() => products.find((p) => p.id === form.sku) || products[0] || null, [products, form.sku])
  const rulesBySku = useMemo(() => new Set(rules.map((r) => r.sku)), [rules])

  if (!hasStore && !loading) return <div className="fade-in"><PageHead title={t('repricer.title')} sub={t('repricer.subtitle')} /><ConnectPrompt /></div>

  const set = (key) => (value) => setForm((s) => ({ ...s, [key]: value }))
  const chooseSku = (sku) => {
    const p = products.find((x) => x.id === sku)
    setForm((s) => ({ ...s, sku, minPrice: Math.max(0, Number(p?.price || s.minPrice || 0) - 1) }))
  }

  const createRule = async () => {
    if (!activeId || !selected) return
    setBusy(true); setMsg(null)
    try {
      const r = await API.createRepricer(activeId, {
        sku: selected.id,
        product: selected,
        minPrice: form.minPrice,
        step: 1,
        frequencyMinutes: form.frequencyMinutes,
        warehouses: form.warehouses,
        stock: form.stock,
        currentPrice: selected.price,
        active: form.active && !!store?.hasToken,
      })
      setRules((list) => [r.rule, ...list.filter((x) => x.id !== r.rule.id)])
      setMsg(t('repricer.created'))
    } catch {
      setMsg(t('repricer.err_create'))
    } finally {
      setBusy(false)
    }
  }

  const updateRule = async (rule, patch) => {
    const optimistic = { ...rule, ...patch }
    setRules((list) => list.map((r) => (r.id === rule.id ? optimistic : r)))
    try {
      const r = await API.updateRepricer(activeId, rule.id, patch)
      setRules((list) => list.map((x) => (x.id === rule.id ? r.rule : x)))
    } catch {
      setRules((list) => list.map((r) => (r.id === rule.id ? rule : r)))
    }
  }

  const runRule = async (rule) => {
    setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, running: true } : r)))
    try {
      const r = await API.runRepricer(activeId, rule.id)
      setRules((list) => list.map((x) => (x.id === rule.id ? r.rule : x)))
    } catch {
      setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, running: false, lastError: 'repricer_failed' } : r)))
    }
  }

  const deleteRule = async (rule) => {
    setRules((list) => list.filter((r) => r.id !== rule.id))
    await API.deleteRepricer(activeId, rule.id).catch(() => {})
  }

  return (
    <div className="fade-in">
      <PageHead title={t('repricer.title')} sub={t('repricer.subtitle')} />

      {!store?.hasToken && <div className="hook" style={{ background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412' }}><span className="msym">key_off</span><span>{t('repricer.need_token')}</span></div>}

      <Card title={t('repricer.new_rule')} sub={t('repricer.new_rule_sub')} className="repricer-form">
        <div className="repricer-grid">
          <label style={{ gridColumn: '1 / -1' }}>
            <span className="field-label">{t('common.product')}</span>
            <select className="select repricer-select" value={form.sku} onChange={(e) => chooseSku(e.target.value)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.title} · {tenge(p.price)}</option>)}
            </select>
          </label>
          <label><span className="field-label">{t('repricer.min_price')}</span><input className="input mono" type="number" min="0" value={form.minPrice} onChange={(e) => set('minPrice')(e.target.value)} /></label>
          <label><span className="field-label">{t('repricer.frequency')}</span><input className="input mono" type="number" min="5" value={form.frequencyMinutes} onChange={(e) => set('frequencyMinutes')(e.target.value)} /></label>
          <label><span className="field-label">{t('repricer.stock')}</span><input className="input mono" type="number" min="0" value={form.stock} onChange={(e) => set('stock')(e.target.value)} /></label>
          <label><span className="field-label">{t('repricer.warehouses')}</span><input className="input" value={form.warehouses} onChange={(e) => set('warehouses')(e.target.value)} placeholder={t('repricer.warehouses_ph')} /></label>
        </div>
        <div className="repricer-actions">
          <label className={`chk ${form.active ? 'on' : ''}`}><input type="checkbox" checked={form.active} onChange={(e) => set('active')(e.target.checked)} /> {t('repricer.activate_now')}</label>
          <button className="btn btn-primary" onClick={createRule} disabled={busy || !selected || !form.minPrice || !store?.hasToken || rulesBySku.has(selected?.id)}>
            <span className={`msym ${busy ? 'spin' : ''}`}>{busy ? 'progress_activity' : 'add'}</span>{t('repricer.create')}
          </button>
        </div>
        {rulesBySku.has(selected?.id) && <div className="mini-note"><span className="msym">info</span>{t('repricer.exists')}</div>}
        {msg && <div className="mini-note"><span className="msym">info</span>{msg}</div>}
      </Card>

      <Card title={t('repricer.rules')} sub={t('repricer.rules_sub')} pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th className="no-sort">{t('common.product')}</th>
              <th className="no-sort t-right">{t('repricer.min_price')}</th>
              <th className="no-sort t-right">{t('repricer.frequency')}</th>
              <th className="no-sort">{t('repricer.warehouses')}</th>
              <th className="no-sort t-right">{t('repricer.last_competitor')}</th>
              <th className="no-sort">{t('repricer.status')}</th>
              <th className="no-sort t-right">{t('repricer.active')}</th>
              <th className="no-sort"></th>
            </tr></thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td><div className="pcell"><div className="pthumb"><span className="msym">price_change</span></div><div><div className="pname">{rule.title}</div><div className="pmeta">{rule.sku}</div></div></div></td>
                  <td className="t-right"><input className="input mono cogs-input" type="number" min="0" defaultValue={rule.minPrice} onBlur={(e) => updateRule(rule, { minPrice: e.target.value })} /></td>
                  <td className="t-right"><input className="input mono cogs-input" type="number" min="5" defaultValue={rule.frequencyMinutes} onBlur={(e) => updateRule(rule, { frequencyMinutes: e.target.value })} /></td>
                  <td><input className="input repricer-warehouse-input" defaultValue={(rule.warehouses || []).join(', ')} onBlur={(e) => updateRule(rule, { warehouses: e.target.value })} /></td>
                  <td className="t-right mono">{rule.lastCompetitorPrice ? tenge(rule.lastCompetitorPrice) : '—'}<div className="tiny-muted">{num(rule.competitors || 0)} {t('common.sellers')}</div></td>
                  <td><span className={`pill ${rule.lastError ? 'warn' : rule.lastAction === 'price_changed' ? 'pos' : ''}`}>{statusText(t, rule)}</span></td>
                  <td className="t-right"><label className={`chk ${rule.active ? 'on' : ''}`}><input type="checkbox" checked={!!rule.active} disabled={!store?.hasToken} onChange={(e) => updateRule(rule, { active: e.target.checked })} /> {rule.active ? t('repricer.on') : t('repricer.off')}</label></td>
                  <td className="t-right">
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => runRule(rule)} disabled={!store?.hasToken || rule.running}><span className={`msym ${rule.running ? 'spin' : ''}`}>{rule.running ? 'progress_activity' : 'play_arrow'}</span></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => deleteRule(rule)}><span className="msym">delete</span></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rules.length && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }} className="muted">{t('repricer.empty')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
