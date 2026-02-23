export const HERO_MAX_POOL = 36
export const HERO_CACHE_TTL_MS = 20 * 60 * 1000
export const HERO_CACHE_KEY = 'home:hero:photo-pool:v1'

export function collectHeroPhotosFromSeries(items, resolvePhotoUrl) {
  const seen = new Set()
  const photos = []

  ;(Array.isArray(items) ? items : []).forEach((item) => {
    const previews = Array.isArray(item?.preview_photos) ? item.preview_photos : []
    previews.forEach((photo, index) => {
      const id = Number(photo?.id || 0) || `${item?.id || 'series'}-${index}`
      const rawSrc = String(photo?.public_url || '').trim() || resolvePhotoUrl(photo)
      if (!rawSrc) {
        return
      }

      const dedupeKey = `${id}:${rawSrc}`
      if (seen.has(dedupeKey)) {
        return
      }

      seen.add(dedupeKey)
      photos.push({
        id,
        src: rawSrc,
        alt: photo?.original_name || item?.title || `photo-${id}`,
      })
    })
  })

  return photos
}

export function shufflePhotos(items) {
  const shuffled = [...(Array.isArray(items) ? items : [])]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  return shuffled
}

export function readHeroCache(cacheKey = HERO_CACHE_KEY) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(cacheKey)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw)
    const expiresAt = Number(parsed?.expires_at || 0)
    const version = Number(parsed?.version || 0)
    const photos = Array.isArray(parsed?.photos) ? parsed.photos : []
    if (expiresAt <= Date.now() || version <= 0 || !photos.length) {
      return null
    }

    return { version, photos }
  } catch (_) {
    return null
  }
}

export function writeHeroCache(
  version,
  photos,
  options = {},
) {
  if (typeof window === 'undefined') {
    return
  }

  const cacheKey = String(options.cacheKey || HERO_CACHE_KEY)
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : HERO_CACHE_TTL_MS

  try {
    window.localStorage.setItem(cacheKey, JSON.stringify({
      version,
      expires_at: Date.now() + ttlMs,
      photos,
    }))
  } catch (_) {
    // Ignore localStorage errors (private mode/quota issues).
  }
}
