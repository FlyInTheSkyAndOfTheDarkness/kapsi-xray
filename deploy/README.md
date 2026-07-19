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

## Update Existing Deploy

After uploading new code:

```bash
cd /opt/kaspi-xray/deploy
docker compose up -d --build
```

The database and uploads stay in `kaspi_xray_data`.
