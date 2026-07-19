# Kaspi X-Ray — single container: builds the frontend and runs the backend,
# which serves the built SPA + /api + the /kaspi proxy on one port.
FROM node:22-alpine

WORKDIR /app

# --- frontend deps + build ---
COPY package.json package-lock.json ./
RUN npm install
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build          # -> /app/dist

# --- backend deps ---
COPY server ./server
RUN cd server && npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# server/index.js serves ../dist (SPA), /api and the /kaspi passthrough.
# It imports ../src/lib/*.js at runtime, so /app/src is kept in the image.
CMD ["node", "server/index.js"]
