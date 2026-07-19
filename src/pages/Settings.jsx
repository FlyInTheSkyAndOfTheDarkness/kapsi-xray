import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/index.jsx'
import { useAppState, CITIES } from '../state/AppState.jsx'
import { PageHead, Card, Segmented } from '../components/ui.jsx'
import { CATEGORY_KEYS, DEFAULT_MULTIPLIERS } from '../lib/salesEstimate.js'
import { DEFAULT_FEE_RULES } from '../lib/feeRules.js'
import { API } from '../lib/api.js'

const feeFields = [
  ['delivery', '₸'],
  ['packaging', '₸'],
  ['returns', '%'],
]

function FeeInput({ value, onChange, suffix, min = 0 }) {
  return (
    <div className="fee-input">
      <input
        className="input mono"
        type="number"
        min={min}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Math.max(min, Number(e.target.value) || 0))}
      />
      <span>{suffix}</span>
    </div>
  )
}

function AiSettingsCard() {
  const { t } = useI18n()
  const [settings, setSettings] = useState({ provider: 'openai', defaultLanguage: 'ru', openaiConfigured: false, geminiConfigured: false })
  const [openaiKey, setOpenaiKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    API.aiSettings()
      .then((result) => setSettings(result.settings))
      .catch(() => setError(t('settings.ai_load_error')))
      .finally(() => setLoading(false))
  }, [t])

  const saveSettings = async (extra = {}, includeKeys = true) => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await API.saveAiSettings({
        provider: settings.provider,
        defaultLanguage: settings.defaultLanguage,
        ...(includeKeys ? { openaiKey, geminiKey } : {}),
        ...extra,
      })
      setSettings(result.settings)
      setOpenaiKey('')
      setGeminiKey('')
      setMessage(t('settings.ai_saved'))
    } catch {
      setError(t('settings.ai_save_error'))
    } finally {
      setSaving(false)
    }
  }

  const providerOptions = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'gemini', label: 'Gemini' },
  ]
  const languageOptions = [
    { value: 'ru', label: t('settings.ai_russian') },
    { value: 'kk', label: t('settings.ai_kazakh') },
  ]

  return (
    <Card className="ai-settings-card" title={t('settings.ai_title')} sub={t('settings.ai_sub')}>
      <div className="ai-settings-head">
        <label><span className="field-label">{t('settings.ai_provider')}</span><Segmented options={providerOptions} value={settings.provider} onChange={(provider) => setSettings((current) => ({ ...current, provider }))} /></label>
        <label><span className="field-label">{t('settings.ai_default_language')}</span><Segmented options={languageOptions} value={settings.defaultLanguage} onChange={(defaultLanguage) => setSettings((current) => ({ ...current, defaultLanguage }))} /></label>
      </div>
      <div className="ai-key-grid">
        <div className="ai-key-field">
          <div className="ai-key-label"><b>OpenAI API</b><span className={`pill ${settings.openaiConfigured ? 'pos' : ''}`}>{settings.openaiConfigured ? t('settings.ai_connected') : t('settings.ai_not_connected')}</span></div>
          <div className="ai-key-input"><input className="input mono" type="password" autoComplete="off" value={openaiKey} onChange={(event) => setOpenaiKey(event.target.value)} placeholder={settings.openaiConfigured ? t('settings.ai_key_saved') : 'sk-...'} />{settings.openaiConfigured && <button className="icon-btn danger" title={t('settings.ai_disconnect')} disabled={saving} onClick={() => saveSettings({ clearOpenai: true }, false)}><span className="msym">link_off</span></button>}</div>
        </div>
        <div className="ai-key-field">
          <div className="ai-key-label"><b>Google Gemini API</b><span className={`pill ${settings.geminiConfigured ? 'pos' : ''}`}>{settings.geminiConfigured ? t('settings.ai_connected') : t('settings.ai_not_connected')}</span></div>
          <div className="ai-key-input"><input className="input mono" type="password" autoComplete="off" value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} placeholder={settings.geminiConfigured ? t('settings.ai_key_saved') : 'AIza...'} />{settings.geminiConfigured && <button className="icon-btn danger" title={t('settings.ai_disconnect')} disabled={saving} onClick={() => saveSettings({ clearGemini: true }, false)}><span className="msym">link_off</span></button>}</div>
        </div>
      </div>
      <div className="ai-settings-footer">
        <div className="mini-note"><span className="msym">lock</span>{t('settings.ai_key_note')}</div>
        <button className="btn btn-primary" onClick={() => saveSettings()} disabled={loading || saving}><span className={`msym ${saving ? 'spin' : ''}`}>{saving ? 'progress_activity' : 'save'}</span>{t('settings.ai_save')}</button>
      </div>
      {(message || error) && <div className={error ? 'cf-err' : 'cf-ok'}><span className="msym">{error ? 'error' : 'check_circle'}</span>{error || message}</div>}
    </Card>
  )
}

export default function Settings() {
  const { t } = useI18n()
  const { city, setCity, multipliers, setMultiplier, resetMultipliers, feeRules, setCategoryFee, setRangeFee, setFeeMode, resetFeeRules } = useAppState()
  const feeCategoryKeys = [...CATEGORY_KEYS.filter((key) => key !== 'default'), 'default']
  const feeModeOptions = [
    { value: 'category', label: t('settings.fees_mode_category') },
    { value: 'range', label: t('settings.fees_mode_range') },
  ]

  return (
    <div className="fade-in">
      <PageHead title={t('settings.title')} sub={t('settings.subtitle')} />

      <div className="grid-2-eq">
        <Card title={t('settings.city_title')} sub={t('settings.city_sub')}>
          <select className="select" style={{ width: '100%' }} value={city} onChange={(e) => setCity(e.target.value)}>
            {CITIES.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="mini-note"><span className="msym">info</span>{t('settings.city_note')}</div>
        </Card>

        <Card title={t('settings.mult_title')} sub={t('settings.mult_sub')} aside={<button className="btn btn-ghost btn-sm" onClick={resetMultipliers}><span className="msym">restart_alt</span>{t('settings.reset')}</button>}>
          <div className="mult-grid">
            {CATEGORY_KEYS.map((key) => (
              <div className="mult-row" key={key}>
                <span className="mult-name">{t(`cats.${key}`)}</span>
                <div className="mult-input">
                  <button className="stepper" onClick={() => setMultiplier(key, Math.max(1, (multipliers[key] || DEFAULT_MULTIPLIERS[key]) - 1))}>−</button>
                  <input
                    className="input mono"
                    type="number"
                    min="1"
                    value={multipliers[key] ?? DEFAULT_MULTIPLIERS[key]}
                    onChange={(e) => setMultiplier(key, Math.max(1, Number(e.target.value) || 1))}
                  />
                  <button className="stepper" onClick={() => setMultiplier(key, (multipliers[key] || DEFAULT_MULTIPLIERS[key]) + 1)}>+</button>
                </div>
                {multipliers[key] !== DEFAULT_MULTIPLIERS[key] && (
                  <span className="mult-def">{t('settings.default')}: {DEFAULT_MULTIPLIERS[key]}</span>
                )}
              </div>
            ))}
          </div>
          <div className="mini-note" style={{ alignItems: 'flex-start' }}>
            <span className="msym">lightbulb</span>
            {t('settings.mult_note')}
          </div>
        </Card>
      </div>

      <AiSettingsCard />

      <Card
        title={t('settings.fees_title')}
        sub={t('settings.fees_sub')}
        aside={<button className="btn btn-ghost btn-sm" onClick={resetFeeRules}><span className="msym">restart_alt</span>{t('settings.reset')}</button>}
      >
        <div className="settings-mode-row">
          <span className="muted">{t('settings.fees_mode')}</span>
          <Segmented options={feeModeOptions} value={feeRules.mode || 'category'} onChange={setFeeMode} />
        </div>
        <div className="fees-grid">
          <div>
            <div className="section-kicker">{t('settings.fees_category')}</div>
            <div className="tbl-wrap">
              <table className="tbl fee-table">
                <thead>
                  <tr>
                    <th className="no-sort">{t('common.category')}</th>
                    {feeFields.map(([key]) => <th className="no-sort t-right" key={key}>{t(`settings.${key}`)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {feeCategoryKeys.map((key) => (
                    <tr key={key}>
                      <td>{t(`cats.${key}`)}</td>
                      {feeFields.map(([field, suffix]) => (
                        <td className="t-right" key={field}>
                          <FeeInput value={feeRules.category[key]?.[field] ?? DEFAULT_FEE_RULES.category[key][field]} suffix={suffix} onChange={(v) => setCategoryFee(key, { [field]: v })} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="section-kicker">{t('settings.fees_ranges')}</div>
            <div className="tbl-wrap">
              <table className="tbl fee-table">
                <thead>
                  <tr>
                    <th className="no-sort">{t('settings.range')}</th>
                    <th className="no-sort t-right">{t('settings.range_min')}</th>
                    <th className="no-sort t-right">{t('settings.range_max')}</th>
                    {feeFields.map(([key]) => <th className="no-sort t-right" key={key}>{t(`settings.${key}`)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {feeRules.ranges.map((range) => (
                    <tr key={range.id}>
                      <td>{t(`settings.range_${range.id}`)}</td>
                      <td className="t-right"><FeeInput value={range.min} suffix="₸" onChange={(v) => setRangeFee(range.id, { min: v })} /></td>
                      <td className="t-right"><FeeInput value={range.max ?? ''} suffix="₸" onChange={(v) => setRangeFee(range.id, { max: v || null })} /></td>
                      {feeFields.map(([field, suffix]) => (
                        <td className="t-right" key={field}>
                          <FeeInput value={range[field]} suffix={suffix} onChange={(v) => setRangeFee(range.id, { [field]: v })} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="mini-note" style={{ alignItems: 'flex-start', marginTop: 12 }}>
          <span className="msym">tune</span>
          {t('settings.fees_note')}
        </div>
      </Card>
    </div>
  )
}
