import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { I18nProvider } from './i18n/index.jsx'
import { AuthProvider } from './state/Auth.jsx'
import { AppStateProvider } from './state/AppState.jsx'
import { StoreDataProvider } from './state/Store.jsx'
import { CompetitorsProvider } from './state/Competitors.jsx'
import { AlertsProvider } from './state/Alerts.jsx'
import { startMaterialSymbolFallback } from './lib/materialSymbolFallback.js'
import './styles/theme.css'
import './styles/global.css'
import './styles/shell.css'
import './styles/pages.css'
import './styles/charts.css'
import './styles/xray.css'

startMaterialSymbolFallback()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <AuthProvider>
        <AppStateProvider>
          <StoreDataProvider>
            <CompetitorsProvider>
              <AlertsProvider>
                <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                  <App />
                </BrowserRouter>
              </AlertsProvider>
            </CompetitorsProvider>
          </StoreDataProvider>
        </AppStateProvider>
      </AuthProvider>
    </I18nProvider>
  </React.StrictMode>,
)
