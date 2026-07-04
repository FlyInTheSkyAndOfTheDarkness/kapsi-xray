/* Backend API client — JWT auth, JSON, typed errors. */

const TOKEN_KEY = 'kx-token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (auth && token) headers.Authorization = 'Bearer ' + token
  const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`)
    err.status = res.status
    err.code = data && data.error
    throw err
  }
  return data
}

export const API = {
  register: (email, password) => api('/auth/register', { method: 'POST', body: { email, password }, auth: false }),
  login: (email, password) => api('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => api('/auth/me'),

  stores: () => api('/stores'),
  connectStore: (ref, city) => api('/stores/connect', { method: 'POST', body: { ref, city } }),
  store: (id, city) => api(`/stores/${id}${city ? `?city=${city}` : ''}`),
  deleteStore: (id) => api(`/stores/${id}`, { method: 'DELETE' }),
  setCogs: (id, sku, cost) => api(`/stores/${id}/cogs`, { method: 'PUT', body: { sku, cost } }),
  setToken: (id, token) => api(`/stores/${id}/token`, { method: 'POST', body: { token } }),

  competitors: () => api('/competitors'),
  trackCompetitor: (ref, city) => api('/competitors', { method: 'POST', body: { ref, city } }),
  untrackCompetitor: (id) => api(`/competitors/${id}`, { method: 'DELETE' }),
  competitorHistory: (id) => api(`/competitors/${id}/history`),
  pollCompetitors: (city) => api('/competitors/poll', { method: 'POST', body: { city } }),

  alerts: () => api('/alerts'),
  markAlertsRead: (ids) => api('/alerts/read', { method: 'POST', body: { ids } }),
  clearAlerts: () => api('/alerts', { method: 'DELETE' }),
  _devNudge: (cid, factor) => api(`/_dev/nudge/${cid}`, { method: 'POST', body: { factor } }),
}
