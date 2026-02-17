import axios from 'axios'
import { normalizeApiError } from './errors'
import {
  clearApiCache,
  clearInflightRequest,
  createGetCacheKey,
  getCachedResponse,
  getInflightRequest,
  setCachedResponse,
  setInflightRequest,
  shouldCacheRequest,
  shouldInvalidateSeriesCache,
} from './requestCache'

const fallbackBaseURL = 'http://127.0.0.1:8091/api/v1'
const baseURL = import.meta.env.VITE_API_BASE_URL || fallbackBaseURL

if (import.meta.env.DEV && !import.meta.env.VITE_API_BASE_URL) {
  console.warn(`[api] VITE_API_BASE_URL is not set, fallback is used: ${fallbackBaseURL}`)
}

export const api = axios.create({
  baseURL,
  headers: {
    Accept: 'application/json',
  },
})

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`
  } else {
    delete api.defaults.headers.common.Authorization
  }
}

const originalGet = api.get.bind(api)

function cachePayloadFromResponse(response) {
  return {
    data: response.data,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }
}

function fetchAndStoreGet(url, config, key) {
  const request = originalGet(url, config)
    .then((response) => {
      setCachedResponse(key, cachePayloadFromResponse(response))
      return response
    })
    .finally(() => {
      clearInflightRequest(key)
    })

  setInflightRequest(key, request)

  return request
}

api.get = function getWithCache(url, config = {}) {
  if (!shouldCacheRequest('get', url, config?.params)) {
    return originalGet(url, config)
  }

  const key = createGetCacheKey(url, config?.params)
  const cached = getCachedResponse(key)
  if (cached) {
    if (!getInflightRequest(key)) {
      // SWR: serve cached response immediately and refresh in background.
      fetchAndStoreGet(url, config, key).catch(() => {})
    }

    return Promise.resolve({
      data: cached.data,
      status: cached.status,
      statusText: cached.statusText,
      headers: cached.headers,
      config,
      request: { fromCache: true, staleWhileRevalidate: true },
    })
  }

  const inflight = getInflightRequest(key)
  if (inflight) {
    return inflight
  }

  return fetchAndStoreGet(url, config, key)
}

api.interceptors.response.use(
  (response) => {
    if (shouldInvalidateSeriesCache(response?.config?.method, response?.config?.url)) {
      clearApiCache()
    }

    return response
  },
  async (error) => {
    if (shouldInvalidateSeriesCache(error?.config?.method, error?.config?.url)) {
      clearApiCache()
    }

    if (error?.response?.status === 401) {
      const { logout } = await import('./logout')
      await logout({ reason: 'expired' })
    }

    return Promise.reject(normalizeApiError(error))
  },
)
