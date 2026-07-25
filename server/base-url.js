/* Public origin of this deployment. Kaspi and Taobao helpers both need an
   absolute URL, so it must be the address the outside world can reach. */

export function configuredBaseUrl() {
  return process.env.PUBLIC_BASE_URL ? String(process.env.PUBLIC_BASE_URL).replace(/\/$/, '') : ''
}

export function publicBaseUrl(req) {
  const configured = configuredBaseUrl()
  if (configured) return configured
  const protocol = req?.get?.('x-forwarded-proto') || req?.protocol || 'http'
  const host = req?.get?.('x-forwarded-host') || req?.get?.('host') || `localhost:${process.env.PORT || 8787}`
  return `${protocol}://${host}`
}
