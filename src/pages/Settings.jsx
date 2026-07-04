import { useI18n } from '../i18n/index.jsx'
import { useAppState, CITIES } from '../state/AppState.jsx'
import { PageHead, Card } from '../components/ui.jsx'
import { CATEGORY_KEYS, DEFAULT_MULTIPLIERS } from '../lib/salesEstimate.js'

export default function Settings() {
  const { t } = useI18n()
  const { city, setCity, multipliers, setMultiplier, resetMultipliers } = useAppState()

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
    </div>
  )
}
