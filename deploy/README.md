# Kaspi X-Ray Server Deploy

Production runs as one Docker container:

- React frontend is built into `dist/`
- Node backend serves `dist/`, `/api`, `/kaspi`, and `/uploads`
- persistent data is stored in Docker volume `kaspi_xray_data`
- nginx proxies the subdomain to `127.0.0.1:8787`

## 1. Prepare DNS

Create an `A` record for the chosen subdomain:

```text
kaspi.example.kz -> SERVER_IP
```

Replace `kaspi.example.kz` in the files below with the real subdomain.

## 2. Upload Project

On the server:

```bash
mkdir -p /opt/kaspi-xray
```

Upload this repository into `/opt/kaspi-xray`.

## 3. Configure Environment

```bash
cd /opt/kaspi-xray/deploy
cp kaspi-xray.env.example kaspi-xray.env
openssl rand -hex 32
```

Edit `kaspi-xray.env`:

```text
JWT_SECRET=<generated value>
PUBLIC_BASE_URL=https://kaspi.example.kz
OPENAI_API_KEY=<optional>
GEMINI_API_KEY=<optional>
```

## 4. Start App

```bash
cd /opt/kaspi-xray/deploy
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8787/api/health
```

## 5. Configure Nginx

```bash
sudo cp nginx/kaspi-xray.conf /etc/nginx/sites-available/kaspi-xray.conf
sudo ln -s /etc/nginx/sites-available/kaspi-xray.conf /etc/nginx/sites-enabled/kaspi-xray.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Enable HTTPS

```bash
sudo certbot --nginx -d kaspi.example.kz
```

## Kaspi Egress (when the catalog is empty)

Kaspi rate-limits by IP. From a datacenter address even a cold request comes
back `429` with an HTML anti-bot page, and the app then shows a store with no
products. Check what Kaspi tells this server:

```bash
curl http://127.0.0.1:8787/api/health          # proxy state + active cooldown
docker compose logs --tail=200 kaspi-xray | grep -i unavailable
```

If it is `429`, requests need a Kazakh exit. Options, cheapest first:

### Borrow a Kazakh connection you already have (free)

`kz-relay/relay.js` is a dependency-free CONNECT proxy that only forwards to
`kaspi.kz`. Run it on any machine on a Kazakh connection — a home PC is fine —
and hand the port to the server over SSH:

```bash
# on the Kazakh machine (Node 18+)
node deploy/kz-relay/relay.js
ssh -N -R 3128:127.0.0.1:3128 root@YOUR_SERVER
```

```text
# in kaspi-xray.env
KASPI_PROXY_URL=http://127.0.0.1:3128
```

The relay binds to loopback and refuses every host but Kaspi, so the tunnel
cannot turn it into an open proxy. The catalog only refreshes every
`KASPI_CACHE_TTL_MS`, and the last good copy is kept in the database, so the
tunnel does not have to be up around the clock.

### A rented Kazakh proxy

Any HTTP(S) proxy works — set `KASPI_PROXY_URL=http://user:pass@host:port`.
Test a candidate before committing to it:

```bash
docker exec kaspi-xray node -e "
const {ProxyAgent}=require('undici');
fetch('https://kaspi.kz/yml/product-view/pl/results?text=iphone&page=0&limit=5&ui=d&i=-1&c=750000000',
{dispatcher:new ProxyAgent(process.env.P),headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json','Referer':'https://kaspi.kz/shop/','X-KS-City':'750000000'}})
.then(async r=>console.log(r.status, r.headers.get('content-type')))
.catch(e=>console.log('FAIL',e.cause?.code||e.message))" \
  -e P=http://user:pass@host:port
```

`200 application/json` means it works; `429` means try another. A Kazakh *data
centre* IP can be throttled much like a foreign one — residential addresses
fare best.

Only the public listing goes through the proxy. The merchant cabinet API keeps
to direct egress so the seller's token never reaches a third-party relay; set
`KASPI_PROXY_MERCHANT_API=1` if that API turns out to be blocked as well.

## Update Existing Deploy

After uploading new code:

```bash
cd /opt/kaspi-xray/deploy
docker compose up -d --build
```

The database and uploads stay in `kaspi_xray_data`.
