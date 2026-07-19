import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

// Kaspi only serves its JSON APIs server-side (browser calls are blocked by CORS),
// so in dev we proxy /kaspi/* -> https://kaspi.kz/* and inject the headers Kaspi
// expects. For production, deploy the same proxy as a tiny backend/edge function.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5175,
    open: true,
    proxy: {
      // backend API (auth, stores, COGS, competitors)
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/kaspi': {
        target: 'https://kaspi.kz',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/kaspi/, ''),
        headers: {
          'User-Agent': UA,
          Referer: 'https://kaspi.kz/shop/',
          Origin: 'https://kaspi.kz',
          'Accept-Language': 'ru-RU,ru;q=0.9',
        },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            proxyReq.setHeader('User-Agent', UA)
            proxyReq.setHeader('Accept', 'application/json, text/plain, */*')
            proxyReq.setHeader('X-KS-City', '750000000')
            // offers endpoint validates a product-specific referer
            const m = req.url && req.url.match(/offers\/(\d+)/)
            proxyReq.setHeader('Referer', m ? `https://kaspi.kz/shop/p/x-${m[1]}/` : 'https://kaspi.kz/shop/')
          })
        },
      },
    },
  },
})
