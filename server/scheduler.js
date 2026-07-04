/* Periodic competitor tracking: snapshot every tracked product on an interval
   so price/position history accrues even when nobody has the app open. */

import { all } from './db.js'
import { snapshotProduct } from './analyze.js'
import { recordSnapshot } from './routes-competitors.js'
import { checkAndEmitAlerts } from './alerts.js'
import { DEFAULT_CITY } from './kaspi.js'

const HOURS = Number(process.env.POLL_HOURS || 6)
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

export function startScheduler() {
  // first pass shortly after boot, then every N hours
  setTimeout(pollAll, 30_000)
  setInterval(pollAll, HOURS * 3600_000)
  console.log(`[scheduler] competitor polling every ${HOURS}h`)
}
