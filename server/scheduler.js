/* Periodic competitor tracking: snapshot every tracked product on an interval
   so price/position history accrues even when nobody has the app open. */

import { all, filter, find, update } from './db.js'
import { snapshotProduct } from './analyze.js'
import { recordSnapshot } from './routes-competitors.js'
import { checkAndEmitAlerts } from './alerts.js'
import { DEFAULT_CITY } from './kaspi.js'
import { runRepricer } from './repricer.js'
import { publishPreorderCard } from './routes-taobao.js'
import { mergeProduct } from './taobao-product.js'
import { configuredBaseUrl } from './base-url.js'

const HOURS = Number(process.env.POLL_HOURS || 6)
const AUTO_PUBLISH_PER_RUN = Number(process.env.AUTO_PUBLISH_PER_RUN || 5)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pollAll() {
  const comps = all('competitors')
  if (!comps.length) return
  console.log(`[scheduler] polling ${comps.length} tracked products…`)
  let ok = 0
  for (const c of comps) {
    try {
      const snap = await snapshotProduct(c.productId, { city: DEFAULT_CITY })
      recordSnapshot(c.userId, 'competitor', c.id, snap)
      checkAndEmitAlerts(c.userId, c.id, snap)
      ok++
    } catch {
      /* skip transient failures */
    }
    await sleep(800) // be gentle with Kaspi
  }
  console.log(`[scheduler] done: ${ok}/${comps.length} updated`)
}

async function pollRepricers() {
  const now = Date.now()
  const due = all('repricers').filter((r) => r.active && (!r.nextRunAt || r.nextRunAt <= now))
  if (!due.length) return
  console.log(`[scheduler] running ${due.length} repricer rules...`)
  let ok = 0
  for (const rule of due) {
    try {
      await runRepricer(rule)
      ok++
    } catch {
      /* skip transient failures; the manual run endpoint exposes details */
    }
    await sleep(1200)
  }
  console.log(`[scheduler] repricer done: ${ok}/${due.length}`)
}

/** Drafts complete enough for Kaspi to accept the card, never sent before. */
function autoPublishCandidates(feed) {
  return filter('taobaoProducts', (row) => row.userId === feed.userId && row.preferredStoreId === feed.storeId)
    .filter((row) => !row.autoPublishedAt)
    .filter((row) => !filter('imports', (item) => item.userId === feed.userId && item.taobaoProductId === row.id).length)
    .filter((row) => {
      const draft = mergeProduct(row, row.product?.draft || {})
      return draft.feedEnabled
        && ['sku', 'title', 'brand', 'category'].every((field) => String(draft[field] || '').trim())
        && Number(draft.salePrice ?? draft.price) > 0
    })
}

/* Cards for new Taobao/1688 drafts go out on their own when the store's feed
   has auto-publish on. Only first attempts — a card Kaspi rejected is left to
   the seller, so a bad draft can never loop against the import API. */
async function pollAutoPublish() {
  const feeds = all('feeds').filter((feed) => feed.autoPublish && feed.active !== false)
  if (!feeds.length) return
  const baseUrl = configuredBaseUrl()
  if (!baseUrl) {
    console.warn('[scheduler] auto-publish skipped: set PUBLIC_BASE_URL so Kaspi can load product photos')
    return
  }
  for (const feed of feeds) {
    const store = find('stores', (row) => row.id === feed.storeId && row.userId === feed.userId)
    if (!store?.token) continue
    const candidates = autoPublishCandidates(feed).slice(0, AUTO_PUBLISH_PER_RUN)
    for (const row of candidates) {
      update('taobaoProducts', row.id, { autoPublishedAt: Date.now() })
      try {
        const result = await publishPreorderCard({
          userId: feed.userId,
          productRow: row,
          storeId: feed.storeId,
          sourceProduct: row.product?.draft || {},
          baseUrl,
        })
        console.log(`[scheduler] auto-publish ${row.id}: ${result.ok ? result.import?.code || 'sent' : result.error}`)
      } catch (e) {
        console.error(`[scheduler] auto-publish ${row.id} failed:`, e.message)
      }
      await sleep(1500)
    }
  }
}

export function startScheduler() {
  // first pass shortly after boot, then every N hours
  setTimeout(pollAll, 30_000)
  setInterval(pollAll, HOURS * 3600_000)
  setTimeout(pollRepricers, 45_000)
  setInterval(pollRepricers, 60_000)
  setTimeout(pollAutoPublish, 60_000)
  setInterval(pollAutoPublish, 10 * 60_000)
  console.log(`[scheduler] competitor polling every ${HOURS}h`)
  console.log('[scheduler] repricer checks every 1m')
  console.log('[scheduler] Taobao/1688 auto-publish every 10m')
}
