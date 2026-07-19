/* Periodic competitor tracking: snapshot every tracked product on an interval
   so price/position history accrues even when nobody has the app open. */

import { all } from './db.js'
import { snapshotProduct } from './analyze.js'
import { recordSnapshot } from './routes-competitors.js'
import { checkAndEmitAlerts } from './alerts.js'
import { DEFAULT_CITY } from './kaspi.js'
import { runRepricer } from './repricer.js'

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

export function startScheduler() {
  // first pass shortly after boot, then every N hours
  setTimeout(pollAll, 30_000)
  setInterval(pollAll, HOURS * 3600_000)
  setTimeout(pollRepricers, 45_000)
  setInterval(pollRepricers, 60_000)
  console.log(`[scheduler] competitor polling every ${HOURS}h`)
  console.log('[scheduler] repricer checks every 1m')
}
