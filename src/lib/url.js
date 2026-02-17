export const FALLBACK_API_BASE_URL = 'http://127.0.0.1:8091/api/v1'

export function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || FALLBACK_API_BASE_URL
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
