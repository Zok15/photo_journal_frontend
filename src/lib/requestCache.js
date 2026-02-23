const DEFAULT_TTL_MS = 20_000

const responseCache = new Map()
const inflightCache = new Map()

function stableParams(params) {
  if (!params || typeof params !== 'object') {
    return ''
  }

  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))

  return entries
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${encodeURIComponent(key)}=${value.map((v) => encodeURIComponent(String(v))).join(',')}`
      }

      return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    })
    .join('&')
}

export function createGetCacheKey(url, params) {
  const serialized = stableParams(params)
  return serialized ? `${url}?${serialized}` : String(url)
}

export function getCachedResponse(key) {
  const cached = responseCache.get(key)
  if (!cached) {
    return null
  }

  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(key)
    return null
  }

  return cached.response
}

export function setCachedResponse(key, response, ttlMs = DEFAULT_TTL_MS) {
  responseCache.set(key, {
    response,
    expiresAt: Date.now() + ttlMs,
  })
}

export function getInflightRequest(key) {
  return inflightCache.get(key) || null
}

export function setInflightRequest(key, promise) {
  inflightCache.set(key, promise)
}

export function clearInflightRequest(key) {
  inflightCache.delete(key)
}

export function clearApiCache() {
  responseCache.clear()
  inflightCache.clear()
}

function isTrueLike(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function normalizePath(url) {
  const raw = String(url || '').trim()
  if (!raw) {
    return ''
  }

  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const pathname = new URL(raw).pathname || ''
      return pathname.replace(/^\/api\/v\d+(?=\/|$)/, '') || pathname
    }

    const pathname = new URL(raw, 'http://local').pathname || ''
    return pathname.replace(/^\/api\/v\d+(?=\/|$)/, '') || pathname
  } catch (_) {
    return raw.startsWith('/') ? raw : `/${raw}`
  }
}

export function shouldCacheRequest(method, url, params = null) {
  if (String(method || '').toLowerCase() !== 'get') {
    return false
  }

  const path = normalizePath(url)
  if (!/^\/series(?:\/[^/]+)?$/.test(path)) {
    return false
  }

  const isSeriesShow = /^\/series\/[^/]+$/.test(path)
  if (!isSeriesShow) {
    // Series list changes frequently (reorder, tag updates, uploads/deletes).
    // Avoid stale list state in current tab: always fetch list from backend.
    return false
  }

  // Series show with include_photos returns temporary signed preview URLs.
  // These links expire quickly, so caching that payload causes broken previews (403).
  if (isTrueLike(params?.include_photos)) {
    return false
  }

  return true
}

export function shouldInvalidateSeriesCache(method, url) {
  const normalizedMethod = String(method || '').toLowerCase()
  if (!['post', 'patch', 'put', 'delete'].includes(normalizedMethod)) {
    return false
  }

  const path = normalizePath(url)
  return /^\/series(?:\/|$)/.test(path) || /^\/tags(?:\/|$)/.test(path)
}
