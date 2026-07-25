const ICONS = {
  add: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  add_link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  add_photo_alternate: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 11h.01"/><path d="m4 17 5-5 4 4 2-2 5 5"/><path d="M18 8v4"/><path d="M16 10h4"/>',
  admin_panel_settings: '<path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z"/><path d="M12 9v6"/><path d="M9 12h6"/>',
  arrow_back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  arrow_forward: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  auto_awesome: '<path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"/>',
  calculate: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8"/><path d="M8 11h2"/><path d="M12 11h2"/><path d="M16 11h.01"/><path d="M8 15h2"/><path d="M12 15h2"/><path d="M16 15h.01"/>',
  category: '<path d="M4 4h7v7H4z"/><path d="M13 4h7v7h-7z"/><path d="M4 13h7v7H4z"/><path d="M13 13h7v7h-7z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  check_circle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  cloud_off: '<path d="m3 3 18 18"/><path d="M8.5 8.5A5 5 0 0 1 18 10a4 4 0 0 1 1.5 7.7"/><path d="M16 18H7a4 4 0 0 1-.7-7.9"/>',
  content_copy: '<rect x="8" y="8" width="11" height="13" rx="2"/><path d="M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
  currency_exchange: '<path d="M7 7h8a4 4 0 0 1 4 4"/><path d="m16 4 3 3-3 3"/><path d="M17 17H9a4 4 0 0 1-4-4"/><path d="m8 20-3-3 3-3"/>',
  currency_yuan: '<path d="m7 4 5 7 5-7"/><path d="M8 11h8"/><path d="M8 15h8"/><path d="M12 11v9"/>',
  dashboard: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  delete: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/>',
  donut_large: '<path d="M12 3a9 9 0 1 1-8 5"/><path d="M12 3v7h7"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>',
  edit_note: '<path d="M4 6h10"/><path d="M4 10h10"/><path d="M4 14h7"/><path d="M14 20l6-6"/><path d="m15 19 4 1 1-4"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 17h.01"/>',
  event_repeat: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M4 10h16"/><path d="M8 15h6"/><path d="m12 13 2 2-2 2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
  hourglass_top: '<path d="M6 3h12"/><path d="M6 21h12"/><path d="M7 3c0 5 10 5 10 10s-10 5-10 8"/><path d="M17 3c0 5-10 5-10 10s10 5 10 8"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 11h.01"/><path d="m4 17 5-5 4 4 2-2 5 5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  insights: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 4-4 3 3 5-7"/>',
  inventory: '<path d="M9 3h6l2 3v15H7V6l2-3Z"/><path d="M9 6h6"/><path d="M10 11h4"/><path d="M10 15h4"/>',
  inventory_2: '<path d="M4 7 12 3l8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7"/><path d="M12 11v10"/>',
  key_off: '<path d="m3 3 18 18"/><path d="M15 11a4 4 0 0 0-5-5"/><path d="M9.5 9.5a4 4 0 1 0 5 5"/><path d="M14 14h7v3h-3v3h-3"/>',
  lightbulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  location_on: '<path d="M12 21s7-5.2 7-12a7 7 0 0 0-14 0c0 6.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  manage_search: '<path d="M10 17a7 7 0 1 1 5-2"/><path d="m14 14 5 5"/><path d="M7 10h6"/><path d="M10 7v6"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  monitoring: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-6"/>',
  notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  open_in_new: '<path d="M14 4h6v6"/><path d="m10 14 10-10"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/>',
  payments: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
  percent: '<path d="m19 5-14 14"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>',
  photo_library: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M3 9V5a2 2 0 0 1 2-2h4"/><path d="m6 17 4-4 3 3 2-2 3 3"/>',
  policy: '<path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-5"/>',
  price_change: '<path d="M4 7h16"/><path d="M4 17h16"/><path d="M7 7v10"/><path d="M17 7v10"/><path d="M12 9v6"/><path d="m10 13 2 2 2-2"/>',
  progress_activity: '<path d="M21 12a9 9 0 0 1-9 9"/><path d="M12 3a9 9 0 0 1 9 9"/>',
  publish: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/><path d="M5 21h14"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12 18 6"/><path d="M12 3v2"/><path d="M21 12h-2"/>',
  rule: '<path d="M4 4h16v16H4z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/>',
  rss_feed: '<path d="M5 19h.01"/><path d="M4 4a16 16 0 0 1 16 16"/><path d="M4 11a9 9 0 0 1 9 9"/>',
  save: '<path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8"/><path d="M8 21v-7h8v7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
  select_all: '<path d="M4 4h6"/><path d="M4 4v6"/><path d="M20 4h-6"/><path d="M20 4v6"/><path d="M4 20h6"/><path d="M4 20v-6"/><path d="M20 20h-6"/><path d="M20 20v-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3-.2-.1a1.7 1.7 0 0 0-2 .2 1.7 1.7 0 0 0-.8 1.7V22h-5v-.2a1.7 1.7 0 0 0-.9-1.6 1.7 1.7 0 0 0-1.9-.3l-.2.1-2-3 .1-.1A1.7 1.7 0 0 0 5 15a1.7 1.7 0 0 0-1.5-1H3v-4h.5A1.7 1.7 0 0 0 5 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3 .2.1a1.7 1.7 0 0 0 2-.2A1.7 1.7 0 0 0 9.6 2h5a1.7 1.7 0 0 0 .8 1.8 1.7 1.7 0 0 0 2 .2l.2-.1 2 3-.1.1A1.7 1.7 0 0 0 19 9c.2.6.8 1 1.5 1h.5v4h-.5a1.7 1.7 0 0 0-1.1 1Z"/>',
  shopping_bag: '<path d="M6 8h12l1 13H5L6 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  storefront: '<path d="M4 9h16l-1-5H5L4 9Z"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/><path d="M4 9c1 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0"/>',
  translate: '<path d="M4 5h9"/><path d="M9 3v2c0 4-2 7-5 9"/><path d="M5 9c1 2 3 4 6 5"/><path d="M13 20l4-9 4 9"/><path d="M15 16h4"/>',
  travel_explore: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/><path d="M8 11h6"/><path d="M11 8v6"/>',
  tune: '<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h2"/><path d="M10 12h10"/><circle cx="8" cy="12" r="2"/><path d="M4 18h12"/><path d="M20 18h0"/><circle cx="18" cy="18" r="2"/>',
  upload: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/><path d="M5 21h14"/>',
  vpn_key: '<circle cx="7" cy="12" r="4"/><path d="M11 12h10"/><path d="M17 12v4"/><path d="M20 12v3"/>',
  warning: '<path d="M12 3 22 20H2L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
}

const GENERIC = '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/>'

function svgFor(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || GENERIC}</svg>`
}

function symbolFontReady() {
  return Boolean(document.fonts?.check?.('24px "Material Symbols Outlined"'))
}

function applyFallback(root = document) {
  const nodes = []
  if (root instanceof Element && root.classList.contains('msym')) nodes.push(root)
  root.querySelectorAll?.('.msym').forEach((node) => nodes.push(node))
  nodes.forEach((node) => {
    const name = String(node.dataset.symbolName || node.textContent || '').trim()
    if (!/^[a-z0-9_]{2,40}$/.test(name)) return
    if (node.dataset.symbolFallback === 'true' && node.dataset.symbolName === name && node.querySelector('svg')) return
    node.dataset.symbolName = name
    node.dataset.symbolFallback = 'true'
    node.setAttribute('aria-hidden', 'true')
    node.innerHTML = svgFor(name)
  })
}

export function startMaterialSymbolFallback() {
  if (typeof document === 'undefined') return
  let enabled = false
  let queued = false
  const scan = () => {
    if (!enabled || queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      applyFallback(document)
    })
  }
  const enable = () => {
    if (enabled || symbolFontReady()) return
    enabled = true
    applyFallback(document)
    const observer = new MutationObserver(scan)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  }
  if (document.fonts?.ready) document.fonts.ready.then(enable).catch(enable)
  window.setTimeout(enable, 1800)
}
