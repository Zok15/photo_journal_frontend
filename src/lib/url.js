export const FALLBACK_API_BASE_URL = 'http://127.0.0.1:8091/api/v1'

export function getApiBaseUrl() {
  const configuredBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '').trim()
  if (configuredBaseUrl) {
    return configuredBaseUrl
  }

  if (import.meta.env.DEV) {
    return FALLBACK_API_BASE_URL
  }

  const browserOrigin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : ''

  return browserOrigin ? `${browserOrigin}/api/v1` : FALLBACK_API_BASE_URL
}

export function getApiOrigin() {
  return getApiBaseUrl().replace(/\/api\/v1\/?$/, '')
}

export function buildStorageUrl(path) {
  if (!path) {
    return ''
  }

  return `${getApiOrigin()}/storage/${path}`
}

export function withCacheBust(url, version) {
  const source = String(url || '').trim()
  if (!source) {
    return ''
  }

  const separator = source.includes('?') ? '&' : '?'
  return `${source}${separator}v=${version}`
}
