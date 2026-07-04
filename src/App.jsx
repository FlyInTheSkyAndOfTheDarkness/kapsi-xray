import { Routes, Route } from 'react-router-dom'
import { useAuth } from './state/Auth.jsx'
import Shell from './components/Shell.jsx'
import Login from './pages/Login.jsx'
import Overview from './pages/Overview.jsx'
import Products from './pages/Products.jsx'
import UnitEconomics from './pages/UnitEconomics.jsx'
import ABCAnalysis from './pages/ABCAnalysis.jsx'
import Market from './pages/Market.jsx'
import ProductXray from './pages/ProductXray.jsx'
import Competitors from './pages/Competitors.jsx'
import Settings from './pages/Settings.jsx'
import Connect from './pages/Connect.jsx'
import Calculator from './pages/Calculator.jsx'

export default function App() {
  const { ready, user } = useAuth()

  if (!ready) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <span className="msym spin" style={{ fontSize: 40, color: 'var(--primary)' }}>progress_activity</span>
      </div>
    )
  }
  if (!user) return <Login />

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/products" element={<Products />} />
        <Route path="/unit-economics" element={<UnitEconomics />} />
        <Route path="/abc" element={<ABCAnalysis />} />
        <Route path="/market" element={<Market />} />
        <Route path="/xray" element={<ProductXray />} />
        <Route path="/competitors" element={<Competitors />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="*" element={<Overview />} />
      </Routes>
    </Shell>
  )
}
