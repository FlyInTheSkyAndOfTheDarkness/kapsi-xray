import { useState } from 'react'
import { useI18n, LANGS } from '../i18n/index.jsx'
import { useAuth } from '../state/Auth.jsx'

export default function Login() {
  const { t, lang, setLang } = useI18n()
  const { login, register } = useAuth()
  const [mode, setMode] = useState('login') // login | register
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const errText = (code) =>
    ({
      bad_email: t('auth.err_email'),
      weak_password: t('auth.err_weak'),
      email_taken: t('auth.err_taken'),
      bad_credentials: t('auth.err_creds'),
      access_denied: t('auth.err_access'),
    })[code] || t('auth.err_generic')

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      if (mode === 'login') await login(email.trim(), password)
      else await register(email.trim(), password)
    } catch (ex) {
      setErr(errText(ex.code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-lang">
        {LANGS.map((l) => (
          <button key={l.code} className={l.code === lang ? 'on' : ''} onClick={() => setLang(l.code)}>{l.label}</button>
        ))}
      </div>
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-logo"><span className="msym">radar</span></div>
          <div className="brand-name">Kaspi <span>X-Ray</span></div>
        </div>
        <p className="auth-sub">{t('auth.subtitle')}</p>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>{t('auth.login')}</button>
          <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>{t('auth.register')}</button>
        </div>

        <form onSubmit={submit}>
          <label className="field-label">{t('auth.email')}</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seller@shop.kz" autoComplete="email" required />
          <div style={{ height: 12 }} />
          <label className="field-label">{t('auth.password')}</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={6} />
          {err && <div className="cf-err" style={{ marginTop: 12 }}><span className="msym">error</span>{err}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', marginTop: 18 }}>
            {busy ? <span className="msym spin">progress_activity</span> : <span className="msym">{mode === 'login' ? 'login' : 'person_add'}</span>}
            {mode === 'login' ? t('auth.login') : t('auth.register')}
          </button>
        </form>

        <div className="auth-note">{t('auth.note')}</div>
      </div>
    </div>
  )
}
