import { Navigate, Routes, Route, useParams } from 'react-router-dom'
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
import TaobaoImport from './pages/TaobaoImport.jsx'
import TaobaoPreorders from './pages/TaobaoPreorders.jsx'
import TaobaoPreorderDetail from './pages/TaobaoPreorderDetail.jsx'
import KaspiFeed from './pages/KaspiFeed.jsx'
import Repricer from './pages/Repricer.jsx'
import Admin from './pages/Admin.jsx'

function LegacyTaobaoPreorder() {
  const { id } = useParams()
  return <Navigate replace to={id ? `/taobao/preorders/${id}` : '/taobao/preorders'} />
}

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
        <Route path="/repricer" element={<Repricer />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/taobao" element={<TaobaoImport />} />
        <Route path="/taobao/preorders" element={<TaobaoPreorders />} />
        <Route path="/taobao/preorders/:id" element={<TaobaoPreorderDetail />} />
        <Route path="/taobao/feed" element={<KaspiFeed />} />
        <Route path="/admin" element={user.role === 'admin' ? <Admin /> : <Navigate replace to="/" />} />
        <Route path="/taobao-preorders" element={<LegacyTaobaoPreorder />} />
        <Route path="/taobao-preorders/:id" element={<LegacyTaobaoPreorder />} />
        <Route path="*" element={<Overview />} />
      </Routes>
    </Shell>
  )
}
