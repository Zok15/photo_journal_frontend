import { describe, expect, it } from 'vitest'
import { shouldCacheRequest, shouldInvalidateSeriesCache } from './requestCache'

describe('requestCache', () => {
  it('does not cache series show with include_photos flag', () => {
    expect(shouldCacheRequest('get', '/series/5', { include_photos: 1 })).toBe(false)
    expect(shouldCacheRequest('get', '/series/5', { include_photos: 'true' })).toBe(false)
    expect(shouldCacheRequest('get', '/series/spring-25', { include_photos: 1 })).toBe(false)
  })

  it('does not cache series show with status_only flag', () => {
    expect(shouldCacheRequest('get', '/series/5', { status_only: 1 })).toBe(false)
    expect(shouldCacheRequest('get', '/series/5', { status_only: 'true' })).toBe(false)
    expect(shouldCacheRequest('get', '/series/spring-25', { status_only: 1 })).toBe(false)
  })

  it('does not cache series list and caches series show by id or slug without include_photos', () => {
    expect(shouldCacheRequest('get', '/series', {})).toBe(false)
    expect(shouldCacheRequest('get', '/series/5', {})).toBe(true)
    expect(shouldCacheRequest('get', '/series/spring-25', {})).toBe(true)
  })

  it('invalidates cache for tags write endpoints', () => {
    expect(shouldInvalidateSeriesCache('patch', '/tags/10')).toBe(true)
    expect(shouldInvalidateSeriesCache('post', '/tags')).toBe(true)
  })

  it('invalidates cache for absolute and relative series write endpoints', () => {
    expect(shouldInvalidateSeriesCache('patch', '/series/12/photos/reorder')).toBe(true)
    expect(shouldInvalidateSeriesCache('patch', 'series/12/photos/reorder')).toBe(true)
    expect(shouldInvalidateSeriesCache('patch', 'http://127.0.0.1:8091/api/v1/series/12/photos/reorder')).toBe(true)
  })

  it('caches series read requests for absolute and relative urls', () => {
    expect(shouldCacheRequest('get', 'series')).toBe(false)
    expect(shouldCacheRequest('get', 'http://127.0.0.1:8091/api/v1/series/5', {})).toBe(true)
    expect(shouldCacheRequest('get', 'http://127.0.0.1:8091/api/v1/series/spring-25', {})).toBe(true)
    expect(shouldCacheRequest('get', 'http://127.0.0.1:8091/api/v1/series/5', { include_photos: 1 })).toBe(false)
    expect(shouldCacheRequest('get', 'http://127.0.0.1:8091/api/v1/series/spring-25', { include_photos: 1 })).toBe(false)
    expect(shouldCacheRequest('get', 'http://127.0.0.1:8091/api/v1/series/5', { status_only: 1 })).toBe(false)
  })
})
