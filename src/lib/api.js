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
    err.data = data
    throw err
  }
  return data
}

export async function apiBlob(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {}
  const token = getToken()
  if (auth && token) headers.Authorization = 'Bearer ' + token
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.blob()
}

export const API = {
  register: (email, password) => api('/auth/register', { method: 'POST', body: { email, password }, auth: false }),
  login: (email, password) => api('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => api('/auth/me'),

  stores: () => api('/stores'),
  connectStore: (ref, city) => api('/stores/connect', { method: 'POST', body: { ref, city } }),
  store: (id, city) => api(`/stores/${id}${city ? `?city=${city}` : ''}`),
  deleteStore: (id) => api(`/stores/${id}`, { method: 'DELETE' }),
  storeCategories: (id, params = {}) => api(`/stores/${id}/classification/categories${query(params)}`),
  storeAttributes: (id, params = {}) => api(`/stores/${id}/classification/attributes${query(params)}`),
  storePreorderFeed: (id) => api(`/stores/${id}/preorder-feed`),
  saveStorePreorderFeed: (id, body = {}) => api(`/stores/${id}/preorder-feed`, { method: 'PUT', body }),
  setCogs: (id, sku, cost) => api(`/stores/${id}/cogs`, { method: 'PUT', body: { sku, cost } }),
  setProductSettings: (id, sku, body = {}) => api(`/stores/${id}/products/${encodeURIComponent(sku)}/settings`, { method: 'PUT', body }),
  publishProduct: (id, sku, body = {}) => api(`/stores/${id}/products/${encodeURIComponent(sku)}/publish`, { method: 'POST', body }),
  setToken: (id, token) => api(`/stores/${id}/token`, { method: 'POST', body: { token } }),
  storeOrders: (id, params = {}) => api(`/stores/${id}/orders${query(params)}`),
  sellerSummary: (id, params = {}) => api(`/stores/${id}/seller-summary${query(params)}`),
  importProducts: (id, products) => api(`/stores/${id}/import-products`, { method: 'POST', body: { products } }),
  importStatus: (id, code) => api(`/stores/${id}/imports/${encodeURIComponent(code)}`),
  repricers: (id) => api(`/stores/${id}/repricers`),
  createRepricer: (id, body = {}) => api(`/stores/${id}/repricers`, { method: 'POST', body }),
  updateRepricer: (id, rid, body = {}) => api(`/stores/${id}/repricers/${rid}`, { method: 'PUT', body }),
  deleteRepricer: (id, rid) => api(`/stores/${id}/repricers/${rid}`, { method: 'DELETE' }),
  runRepricer: (id, rid) => api(`/stores/${id}/repricers/${rid}/run`, { method: 'POST' }),

  aiSettings: () => api('/ai/settings'),
  saveAiSettings: (body = {}) => api('/ai/settings', { method: 'PUT', body }),
  localizeAiImage: (body = {}) => api('/ai/images/localize', { method: 'POST', body }),
  discardAiImages: (urls = []) => api('/ai/images/discard', { method: 'POST', body: { urls } }),

  adminSummary: () => api('/admin/summary'),
  adminGrantAccess: (body = {}) => api('/admin/access', { method: 'POST', body }),
  adminUpdateUser: (id, body = {}) => api(`/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body }),

  competitors: () => api('/competitors'),
  opportunities: () => api('/competitors/opportunities'),
  trackCompetitor: (ref, city) => api('/competitors', { method: 'POST', body: { ref, city } }),
  untrackCompetitor: (id) => api(`/competitors/${id}`, { method: 'DELETE' }),
  competitorHistory: (id) => api(`/competitors/${id}/history`),
  createOpportunity: (id, body = {}) => api(`/competitors/${id}/opportunity`, { method: 'POST', body }),
  publishCompetitor: (id, body = {}) => api(`/competitors/${id}/publish`, { method: 'POST', body }),
  pollCompetitors: (city) => api('/competitors/poll', { method: 'POST', body: { city } }),

  alerts: () => api('/alerts'),
  markAlertsRead: (ids) => api('/alerts/read', { method: 'POST', body: { ids } }),
  clearAlerts: () => api('/alerts', { method: 'DELETE' }),
  _devNudge: (cid, factor) => api(`/_dev/nudge/${cid}`, { method: 'POST', body: { factor } }),

  analyzeTaobao: (body) => api('/taobao/analyze', { method: 'POST', body }),
  taobaoBrowserKey: () => api('/taobao/browser-key', { method: 'POST' }),
  taobaoBrowserPayload: (payload) => api('/taobao/browser-payload', { method: 'POST', body: { payload } }),
  taobaoPreorders: () => api('/taobao/preorders'),
  taobaoPreorder: (id) => api(`/taobao/preorders/${encodeURIComponent(id)}`),
  saveTaobaoPreorder: (id, product, storeId) => api(`/taobao/preorders/${encodeURIComponent(id)}`, { method: 'PUT', body: { product, storeId } }),
  suggestTaobaoAttributes: (id, body = {}) => api(`/taobao/preorders/${encodeURIComponent(id)}/ai-attributes`, { method: 'POST', body }),
  uploadTaobaoPreorderPhoto: (id, body) => api(`/taobao/preorders/${encodeURIComponent(id)}/photos`, { method: 'POST', body }),
  deleteTaobaoPreorder: (id) => api(`/taobao/preorders/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  refreshTaobaoPreorders: (ids) => api('/taobao/preorders/refresh', { method: 'POST', body: ids ? { ids } : {} }),
  retryTaobaoPreorder: (id, body = {}) => api(`/taobao/preorders/${encodeURIComponent(id)}/retry`, { method: 'POST', body }),
  unlockPreorderCard: (id) => api(`/taobao/preorders/${encodeURIComponent(id)}/unlock-card`, { method: 'POST' }),
  taobaoProduct: (id) => api(`/taobao/${encodeURIComponent(id)}`),
  importTaobao: (id, body = {}) => api(`/taobao/${id}/import`, { method: 'POST', body }),
  taobaoImagesZip: (id) => apiBlob(`/taobao/${id}/images.zip`),
  taobaoPhoto: (id, index) => apiBlob(`/taobao/${id}/photo/${index}`),
}

function query(params) {
  const q = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  })
  const s = q.toString()
  return s ? `?${s}` : ''
}
