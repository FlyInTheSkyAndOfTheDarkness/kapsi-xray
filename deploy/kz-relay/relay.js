/* ============================================================
   A CONNECT proxy for kaspi.kz, meant to run on a machine that
   is already on a Kazakh connection — a home PC, an office
   box — so the server can borrow its IP instead of renting one.

   Kaspi answers datacenter addresses with 429; a residential
   Kazakh address is the one it treats as an ordinary visitor.

   Node 18+, no dependencies:
     node relay.js
   Then, from the same machine, hand the port to the server:
     ssh -N -R 3128:127.0.0.1:3128 root@YOUR_SERVER
   and point the app at it:
     KASPI_PROXY_URL=http://127.0.0.1:3128
   ============================================================ */

import { createServer } from 'node:http'
import { connect } from 'node:net'

const PORT = Number(process.env.PORT) || 3128
/* Bound to loopback and reached over the SSH tunnel: nothing on the network
   can use this, which is what keeps it from being an open proxy. */
const HOST = process.env.HOST || '127.0.0.1'
/* Only Kaspi. A relay that forwards anywhere is an open proxy the moment the
   tunnel is misconfigured, and it would be someone else's traffic on your IP. */
const ALLOWED = /(^|\.)kaspi\.kz$/i

const server = createServer((req, res) => {
  // Plain HTTP has no business here — the app only ever speaks TLS to Kaspi.
  res.writeHead(405, { 'content-type': 'text/plain' })
  res.end('This relay only handles CONNECT to kaspi.kz\n')
})

server.on('connect', (req, client, head) => {
  const [host, rawPort] = String(req.url || '').split(':')
  const port = Number(rawPort) || 443
  if (!ALLOWED.test(host || '') || port !== 443) {
    console.warn(`refused ${req.url}`)
    client.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    return
  }
  const upstream = connect(port, host, () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head?.length) upstream.write(head)
    upstream.pipe(client)
    client.pipe(upstream)
  })
  // Either side dropping is routine (timeouts, aborted reads); tear down quietly.
  upstream.on('error', () => client.destroy())
  client.on('error', () => upstream.destroy())
})

server.listen(PORT, HOST, () => {
  console.log(`kaspi relay on ${HOST}:${PORT} — forwarding CONNECT to kaspi.kz only`)
})
