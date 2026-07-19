import { NavLink } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'

export default function TaobaoTabs({ preorderCount }) {
  const { t } = useI18n()
  return (
    <nav className="workspace-tabs" aria-label={t('taobao.workspace_title')}>
      <NavLink to="/taobao" end className={({ isActive }) => (isActive ? 'active' : '')}>
        <span className="msym">travel_explore</span>
        <span>{t('taobao.workspace_analysis')}</span>
      </NavLink>
      <NavLink to="/taobao/preorders" className={({ isActive }) => (isActive ? 'active' : '')}>
        <span className="msym">inventory</span>
        <span>{t('taobao.workspace_preorders')}</span>
        {preorderCount != null && <span className="workspace-tab-count mono">{preorderCount}</span>}
      </NavLink>
    </nav>
  )
}
