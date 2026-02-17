import { describe, expect, it } from 'vitest'
import { shouldCacheRequest, shouldInvalidateSeriesCache } from './requestCache'

describe('requestCache', () => {
  it('does not cache series show with include_photos flag', () => {
    expect(shouldCacheRequest('get', '/series/5', { include_photos: 1 })).toBe(false)
    expect(shouldCacheRequest('get', '/series/5', { include_photos: 'true' })).toBe(false)
  })

  it('caches series list and series show without include_photos', () => {
    expect(shouldCacheRequest('get', '/series', {})).toBe(true)
    expect(shouldCacheRequest('get', '/series/5', {})).toBe(true)
  })

  it('invalidates cache for tags write endpoints', () => {
    expect(shouldInvalidateSeriesCache('patch', '/tags/10')).toBe(true)
    expect(shouldInvalidateSeriesCache('post', '/tags')).toBe(true)
  })
})
