<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from '../lib/api'
import { currentLocale, t } from '../lib/i18n'
import { isAuthenticated } from '../lib/session'
import { seriesPath } from '../lib/seriesPath'
import { buildStorageUrl, withCacheBust } from '../lib/url'

const signedIn = computed(() => isAuthenticated.value)

const featuredSeries = ref([])
const featuredLoading = ref(true)
const featuredError = ref('')
const previewVersion = ref(Date.now())
const heroPhotoPool = ref([])
const heroCacheVersion = ref(0)
const HERO_MAX_POOL = 36
const HERO_CACHE_TTL_MS = 20 * 60 * 1000
const HERO_CACHE_KEY = 'home:hero:photo-pool:v1'
const HERO_ROW_GAP = 8
const HERO_INNER_VERTICAL_PADDING = 10
const HERO_STACK_BREAKPOINT = 1100
const SHOWCASE_SMALL_BREAKPOINT = 1100
const SHOWCASE_LARGE_MAX = 6
const SHOWCASE_SMALL_MAX = 4
const heroGridWidth = ref(0)
const heroTextHeight = ref(0)
const heroTextRef = ref(null)
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1440)
const heroAspectRatios = ref({})
const heroImageLoaded = ref({})
const coverImageLoaded = ref({})
const heroGridElements = new Set()
let heroResizeObserver = null
let heroRefreshTimerId = null

const TAG_LABELS = {
  travel: { ru: 'Путешествия', en: 'Travel' },
  street: { ru: 'Улица', en: 'Street' },
  portrait: { ru: 'Портрет', en: 'Portrait' },
  nature: { ru: 'Природа', en: 'Nature' },
  landscape: { ru: 'Пейзаж', en: 'Landscape' },
  city: { ru: 'Город', en: 'City' },
  bird: { ru: 'Птицы', en: 'Birds' },
  flower: { ru: 'Цветы', en: 'Flowers' },
  animal: { ru: 'Животные', en: 'Animals' },
  food: { ru: 'Еда', en: 'Food' },
  people: { ru: 'Люди', en: 'People' },
  architecture: { ru: 'Архитектура', en: 'Architecture' },
}

function photoUrl(photo) {
  const direct = String(photo?.preview_url || '').trim() || String(photo?.public_url || '').trim()
  if (direct) {
    return direct
  }

  return buildStorageUrl(photo?.path)
}

function collectHeroPhotosFromSeries(items) {
  const seen = new Set()
  const photos = []

  items.forEach((item) => {
    const previews = Array.isArray(item?.preview_photos) ? item.preview_photos : []
    previews.forEach((photo, index) => {
      const id = Number(photo?.id || 0) || `${item?.id || 'series'}-${index}`
      const rawSrc = String(photo?.public_url || '').trim() || photoUrl(photo)
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

function shufflePhotos(items) {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  return shuffled
}

function readHeroCache() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(HERO_CACHE_KEY)
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

function writeHeroCache(version, photos) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(HERO_CACHE_KEY, JSON.stringify({
      version,
      expires_at: Date.now() + HERO_CACHE_TTL_MS,
      photos,
    }))
  } catch (_) {
    // Ignore localStorage errors (private mode/quota issues).
  }
}

function coverUrl(item) {
  const cover = item?.preview_photos?.[0]
  if (!cover) {
    return ''
  }

  return withCacheBust(photoUrl(cover), previewVersion.value)
}

function hasCover(item) {
  return Boolean(coverUrl(item))
}

function normalizeTagValue(value) {
  return String(value || '').trim().toLowerCase()
}

function formatTagLabel(rawTag) {
  const source = String(rawTag || '').trim()
  const normalized = normalizeTagValue(source)
  const locale = currentLocale.value === 'en' ? 'en' : 'ru'
  const mapped = TAG_LABELS[normalized]?.[locale]
  if (mapped) {
    return mapped
  }

  const prepared = source.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!prepared) {
    return source
  }

  return prepared
    .split(' ')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

const topTagLinks = computed(() => {
  const byTag = new Map()

  featuredSeries.value.forEach((item) => {
    const tags = Array.isArray(item?.tags) ? item.tags : []
    tags.forEach((tag) => {
      const raw = String(tag?.name || '').trim()
      if (!raw) {
        return
      }

      const key = normalizeTagValue(raw)
      const existing = byTag.get(key) || { raw, count: 0 }
      existing.count += 1
      if (!existing.raw) {
        existing.raw = raw
      }
      byTag.set(key, existing)
    })
  })

  return Array.from(byTag.entries())
    .sort((a, b) => {
      if (b[1].count !== a[1].count) {
        return b[1].count - a[1].count
      }

      return a[1].raw.localeCompare(b[1].raw)
    })
    .slice(0, 4)
    .map(([key, value]) => ({
      key,
      raw: value.raw,
      label: formatTagLabel(value.raw),
      to: { path: '/public/series', query: { tag: value.raw } },
    }))
})

const showcaseSeries = computed(() => {
  const limit = viewportWidth.value <= SHOWCASE_SMALL_BREAKPOINT
    ? SHOWCASE_SMALL_MAX
    : SHOWCASE_LARGE_MAX
  return featuredSeries.value.slice(0, limit)
})
const isHeroStacked = computed(() => viewportWidth.value <= HERO_STACK_BREAKPOINT)

const heroPhotos = computed(() => {
  const source = heroPhotoPool.value.length
    ? heroPhotoPool.value
    : collectHeroPhotosFromSeries(featuredSeries.value).slice(0, HERO_MAX_POOL)
  const cacheVersion = heroCacheVersion.value > 0 ? heroCacheVersion.value : previewVersion.value

  return source.map((photo) => ({
    ...photo,
    src: withCacheBust(photo.src, cacheVersion),
  }))
})

async function ensureHeroRatio(photo) {
  if (!photo?.id || !photo?.src || heroAspectRatios.value[photo.id]) {
    return
  }

  try {
    const ratio = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          resolve(1)
          return
        }

        resolve(image.naturalWidth / image.naturalHeight)
      }
      image.onerror = reject
      image.src = photo.src
    })

    heroAspectRatios.value = {
      ...heroAspectRatios.value,
      [photo.id]: Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
    }
  } catch (_) {
    heroAspectRatios.value = {
      ...heroAspectRatios.value,
      [photo.id]: 1,
    }
  }
}

function buildHeroLayout(photos, containerWidth, targetTotalHeight) {
  const items = photos
    .map((photo) => ({
      photo,
      ratio: heroAspectRatios.value[photo.id] || 1,
    }))
    .filter((item) => item.ratio > 0)

  if (!items.length) {
    return []
  }

  const minGap = 2
  const maxGap = 20
  const targetGap = 8
  const minRowHeight = 70
  const maxRowHeight = 320
  const maxCount = Math.min(items.length, 18)
  const minPerRow = 2
  const maxPerRow = 7
  let best = null

  function evaluateCandidate(chunk, rowCounts) {
    const rows = []
    let cursor = 0
    for (const count of rowCounts) {
      const rowItems = chunk.slice(cursor, cursor + count)
      cursor += count
      const ratioSum = rowItems.reduce((sum, item) => sum + item.ratio, 0)
      rows.push({
        items: rowItems,
        count,
        ratioSum: ratioSum || 0.0001,
      })
    }

    const denominator = (rows.length - 1) - rows.reduce((sum, row) => {
      return sum + ((row.count - 1) / row.ratioSum)
    }, 0)
    if (Math.abs(denominator) < 0.0001) {
      return
    }

    const widthsPart = rows.reduce((sum, row) => sum + (containerWidth / row.ratioSum), 0)
    const gap = (targetTotalHeight - widthsPart) / denominator
    if (!Number.isFinite(gap) || gap < minGap || gap > maxGap) {
      return
    }

    const preparedRows = rows.map((row) => {
      const height = (containerWidth - gap * (row.count - 1)) / row.ratioSum
      return {
        gap,
        height,
        tiles: row.items.map((item) => ({
          photo: item.photo,
          width: item.ratio * height,
        })),
      }
    })

    const tooSmall = preparedRows.some((row) => row.height < minRowHeight)
    const tooLarge = preparedRows.some((row) => row.height > maxRowHeight)
    if (tooSmall || tooLarge) {
      return
    }

    const heights = preparedRows.map((row) => row.height)
    const mean = heights.reduce((sum, value) => sum + value, 0) / heights.length
    const variance = heights.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / heights.length
    const stdDev = Math.sqrt(variance)
    const score = Math.abs(gap - targetGap) * 2.4 + stdDev + (chunk.length * 0.05)

    if (!best || score < best.score) {
      best = { score, rows: preparedRows }
    }
  }

  for (let count = 4; count <= maxCount; count += 1) {
    const chunk = items.slice(0, count)

    for (let first = minPerRow; first <= count - minPerRow; first += 1) {
      const second = count - first
      if (first > maxPerRow || second > maxPerRow) {
        continue
      }
      evaluateCandidate(chunk, [first, second])
    }

    for (let first = minPerRow; first <= count - minPerRow * 2; first += 1) {
      for (let second = minPerRow; second <= count - first - minPerRow; second += 1) {
        const third = count - first - second
        if (first > maxPerRow || second > maxPerRow || third > maxPerRow || third < minPerRow) {
          continue
        }
        evaluateCandidate(chunk, [first, second, third])
      }
    }
  }

  if (!best) {
    const fallback = items.slice(0, Math.min(6, items.length))
    const split = Math.max(2, Math.ceil(fallback.length / 2))
    const rows = [fallback.slice(0, split), fallback.slice(split)].filter((row) => row.length)
    const gap = 8
    return rows.map((rowItems) => {
      const ratioSum = rowItems.reduce((sum, item) => sum + item.ratio, 0) || 0.0001
      const height = Math.max(minRowHeight, Math.min(maxRowHeight, (containerWidth - gap * (rowItems.length - 1)) / ratioSum))
      return {
        gap,
        height,
        tiles: rowItems.map((item) => ({ photo: item.photo, width: item.ratio * height })),
      }
    })
  }

  return best.rows
}

const heroRows = computed(() => {
  const width = heroGridWidth.value || 560
  const allPhotos = heroPhotos.value
  if (!allPhotos.length) {
    return []
  }

  const targetRowsHeight = isHeroStacked.value
    ? Math.max(220, Math.min(420, width * 0.72))
    : Math.max(
      180,
      (heroTextHeight.value || 0) - (HERO_INNER_VERTICAL_PADDING * 2),
    )
  const pool = allPhotos.slice(0, Math.min(HERO_MAX_POOL, allPhotos.length))
  return buildHeroLayout(pool, width, targetRowsHeight)
})

const heroGridGap = computed(() => Number(heroRows.value[0]?.gap ?? HERO_ROW_GAP))
function setHeroGridRef(element) {
  if (element) {
    heroGridElements.add(element)
    heroGridWidth.value = element.clientWidth || heroGridWidth.value
    if (heroResizeObserver) {
      heroResizeObserver.observe(element)
    }
    return
  }

  heroGridElements.clear()
}

function isHeroImageLoaded(photoId) {
  return Boolean(heroImageLoaded.value[String(photoId)])
}

function markHeroImageLoaded(photoId) {
  const key = String(photoId || '').trim()
  if (!key || heroImageLoaded.value[key]) {
    return
  }

  heroImageLoaded.value = {
    ...heroImageLoaded.value,
    [key]: true,
  }
}

function isCoverImageLoaded(seriesId) {
  return Boolean(coverImageLoaded.value[String(seriesId)])
}

function markCoverImageLoaded(seriesId) {
  const key = String(seriesId || '').trim()
  if (!key || coverImageLoaded.value[key]) {
    return
  }

  coverImageLoaded.value = {
    ...coverImageLoaded.value,
    [key]: true,
  }
}

function formatPhotoCount(value) {
  const count = Math.max(0, Number(value || 0))
  return t('{count} фото', { count })
}

function onViewportResize() {
  viewportWidth.value = window.innerWidth || HERO_STACK_BREAKPOINT
}

async function loadFeaturedSeries() {
  featuredLoading.value = true
  featuredError.value = ''

  try {
    const quickParams = {
      per_page: 24,
      preview_nonce: Date.now(),
    }
    const { data } = await api.get('/public/series', {
      params: {
        ...quickParams,
        page: 1,
      },
    })
    const firstPageItems = Array.isArray(data?.data) ? data.data : []
    featuredSeries.value = firstPageItems
    previewVersion.value = Date.now()
    featuredLoading.value = false

    // Expand photo pool in background without blocking the first visible render.
    void (async () => {
      try {
        const fullParams = {
          per_page: 100,
          preview_nonce: Date.now(),
        }
        const fullFirst = await api.get('/public/series', {
          params: { ...fullParams, page: 1 },
        })
        const fullFirstItems = Array.isArray(fullFirst?.data?.data) ? fullFirst.data.data : []
        const lastPage = Math.max(1, Number(fullFirst?.data?.last_page || 1))

        if (lastPage <= 1) {
          featuredSeries.value = fullFirstItems
          previewVersion.value = Date.now()
          return
        }

        const pageRequests = []
        for (let page = 2; page <= lastPage; page += 1) {
          pageRequests.push(
            api.get('/public/series', {
              params: { ...fullParams, page },
            }),
          )
        }

        const pageResults = await Promise.allSettled(pageRequests)
        const restItems = pageResults.flatMap((result) => {
          if (result.status !== 'fulfilled') {
            return []
          }

          return Array.isArray(result.value?.data?.data) ? result.value.data.data : []
        })

        featuredSeries.value = [...fullFirstItems, ...restItems]
        previewVersion.value = Date.now()
      } catch (_) {
        // Keep quick results when background expansion fails.
      }
    })()
  } catch (e) {
    featuredError.value = e?.response?.data?.message || t('Не удалось загрузить витрину серий.')
    featuredSeries.value = []
  } finally {
    featuredLoading.value = false
  }
}

async function fetchPublicSeriesPages(perPage = 100) {
  const first = await api.get('/public/series', {
    params: { per_page: perPage, page: 1 },
  })

  const firstItems = Array.isArray(first?.data?.data) ? first.data.data : []
  const lastPage = Math.max(1, Number(first?.data?.last_page || 1))
  if (lastPage <= 1) {
    return firstItems
  }

  const pageRequests = []
  for (let page = 2; page <= lastPage; page += 1) {
    pageRequests.push(
      api.get('/public/series', {
        params: { per_page: perPage, page },
      }),
    )
  }

  const pageResults = await Promise.allSettled(pageRequests)
  const restItems = pageResults.flatMap((result) => {
    if (result.status !== 'fulfilled') {
      return []
    }

    return Array.isArray(result.value?.data?.data) ? result.value.data.data : []
  })

  return [...firstItems, ...restItems]
}

async function loadHeroPhotoPool() {
  const cached = readHeroCache()
  if (cached) {
    heroPhotoPool.value = cached.photos
    heroCacheVersion.value = cached.version
    return
  }

  try {
    const allSeries = await fetchPublicSeriesPages(100)
    const randomizedPool = shufflePhotos(collectHeroPhotosFromSeries(allSeries))
      .slice(0, HERO_MAX_POOL)
    const version = Math.floor(Date.now() / HERO_CACHE_TTL_MS)
    if (!randomizedPool.length) {
      return
    }

    heroPhotoPool.value = randomizedPool
    heroCacheVersion.value = version
    writeHeroCache(version, randomizedPool)
  } catch (_) {
    // Keep fallback pool derived from featuredSeries.
  }
}

onMounted(() => {
  heroResizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.target === heroTextRef.value) {
        heroTextHeight.value = entry.target.getBoundingClientRect().height
        return
      }

      if (heroGridElements.has(entry.target)) {
        heroGridWidth.value = entry.contentRect.width
      }
    })
  })

  if (heroTextRef.value) {
    heroResizeObserver.observe(heroTextRef.value)
    heroTextHeight.value = heroTextRef.value.getBoundingClientRect().height || 0
  }

  window.addEventListener('resize', onViewportResize, { passive: true })
  onViewportResize()
  loadHeroPhotoPool()
  heroRefreshTimerId = window.setInterval(() => {
    loadHeroPhotoPool()
  }, HERO_CACHE_TTL_MS)
  loadFeaturedSeries()
})

onBeforeUnmount(() => {
  if (heroResizeObserver) {
    heroResizeObserver.disconnect()
    heroResizeObserver = null
  }

  window.removeEventListener('resize', onViewportResize)
  heroGridElements.clear()
  if (heroRefreshTimerId !== null) {
    window.clearInterval(heroRefreshTimerId)
    heroRefreshTimerId = null
  }
})

watch(
  heroPhotos,
  (photos) => {
    heroImageLoaded.value = {}
    photos.forEach((photo) => {
      ensureHeroRatio(photo)
    })
  },
  { immediate: true },
)

watch(
  featuredSeries,
  () => {
    coverImageLoaded.value = {}
  },
  { deep: false },
)
</script>

<template>
  <div class="home-page">
    <section class="hero">
      <div
        ref="heroTextRef"
        class="hero-text reveal reveal--one"
      >
        <p class="eyebrow">{{ t('СЕРИИ ФОТОГРАФИЙ ДЛЯ ВЕБА') }}</p>
        <h1>{{ t('Удобный фотоархив серий для веба') }}</h1>
        <p class="lead">
          {{ t('PhotoLog помогает хранить серии фотографий в аккуратной структуре и быстро находить нужное по названию, описанию, тегам, дате и автору.') }}
        </p>

        <div class="hero-actions">
          <RouterLink to="/public/series" class="primary-btn">{{ t('Открыть галерею') }}</RouterLink>
          <RouterLink :to="signedIn ? '/series' : '/login'" class="ghost-btn">{{ signedIn ? t('Перейти в мой журнал') : t('Войти в журнал') }}</RouterLink>
        </div>

        <ul class="hero-metrics">
          <li>
            <strong>2 MB</strong>
            <span>{{ t('Автооптимизация перед загрузкой') }}</span>
          </li>
          <li>
            <strong>5+</strong>
            <span>{{ t('Параметров фильтрации') }}</span>
          </li>
          <li>
            <strong>Web</strong>
            <span>{{ t('Подготовка изображений для веба') }}</span>
          </li>
        </ul>
      </div>

      <div
        class="hero-visual reveal reveal--two"
        aria-hidden="true"
        :style="!isHeroStacked && heroTextHeight ? { height: `${heroTextHeight}px` } : undefined"
      >
        <div
          v-if="heroRows.length"
          :ref="setHeroGridRef"
          class="hero-preview-grid"
          :style="{ rowGap: `${heroGridGap}px` }"
        >
          <div
            v-for="(row, rowIndex) in heroRows"
            :key="`hero-row-${rowIndex}`"
            class="hero-preview-row"
            :style="{ columnGap: `${row.gap}px` }"
          >
            <div
              v-for="tile in row.tiles"
              :key="tile.photo.id"
              class="hero-preview-tile"
              :class="{ 'hero-preview-tile--loaded': isHeroImageLoaded(tile.photo.id) }"
              :style="{ width: `${tile.width}px`, height: `${row.height || 0}px` }"
            >
              <img
                class="hero-preview-image"
                :class="{ 'hero-preview-image--loaded': isHeroImageLoaded(tile.photo.id) }"
                :src="tile.photo.src"
                :alt="tile.photo.alt"
                loading="lazy"
                @load="markHeroImageLoaded(tile.photo.id)"
                @error="markHeroImageLoaded(tile.photo.id)"
              />
            </div>
          </div>
        </div>
        <div v-else class="hero-photo-placeholder"></div>
      </div>
    </section>

    <section class="benefits reveal reveal--three">
      <article class="benefit-card">
        <h2>{{ t('Оптимизация без лишних действий') }}</h2>
        <p>{{ t('Сервис готовит изображения для быстрой загрузки страниц с сохранением качества.') }}</p>
      </article>
      <article class="benefit-card">
        <h2>{{ t('Понятный поиск по архиву') }}</h2>
        <p>{{ t('Используйте теги, даты, автора и текст, чтобы быстро найти нужную серию.') }}</p>
      </article>
      <article class="benefit-card">
        <h2>{{ t('Серии вместо разрозненных файлов') }}</h2>
        <p>{{ t('Фотографии удобно хранить и просматривать как цельные истории с описанием и контекстом.') }}</p>
      </article>
    </section>

    <section class="quick-search reveal reveal--four">
      <p>{{ t('Популярные теги:') }}</p>
      <div class="quick-search-links">
        <RouterLink
          v-for="link in topTagLinks"
          :key="link.key"
          class="chip-link"
          :to="link.to"
        >
          {{ link.label }}
        </RouterLink>
        <RouterLink v-if="!topTagLinks.length" class="chip-link" :to="{ path: '/public/series', query: { sort: 'new' } }">
          {{ t('Новые серии') }}
        </RouterLink>
      </div>
    </section>

    <section class="showcase reveal reveal--five">
      <div class="showcase-head">
        <h2>{{ t('Галерея') }}</h2>
        <RouterLink to="/public/series" class="showcase-all">{{ t('Смотреть все') }}</RouterLink>
      </div>

      <p v-if="featuredLoading" class="state-text">{{ t('Загрузка...') }}</p>
      <p v-else-if="featuredError" class="error">{{ featuredError }}</p>

      <div v-else class="showcase-grid">
        <article v-for="item in showcaseSeries" :key="item.id" class="series-card">
          <RouterLink class="series-card-link" :to="seriesPath(item)">
            <div
              class="series-cover"
              :class="{
                'series-cover--loaded': isCoverImageLoaded(item.id),
                'series-cover--placeholder': !hasCover(item),
              }"
            >
              <img
                v-if="hasCover(item)"
                class="series-cover-image"
                :class="{ 'series-cover-image--loaded': isCoverImageLoaded(item.id) }"
                :src="coverUrl(item)"
                :alt="item.title || t('Без названия')"
                loading="lazy"
                @load="markCoverImageLoaded(item.id)"
                @error="markCoverImageLoaded(item.id)"
              />
              <div v-else class="series-cover-placeholder">
                <span>{{ t('Фото недоступно') }}</span>
              </div>
            </div>

            <div class="series-content">
              <h3>{{ item.title || t('Без названия') }}</h3>
              <p class="meta-line">
                <span>{{ formatPhotoCount(item.photos_count) }}</span>
                <span v-if="item.author_name">{{ item.author_name }}</span>
              </p>
              <p v-if="item.description" class="description">{{ item.description }}</p>
            </div>
          </RouterLink>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-page {
  min-height: calc(100vh - 58px);
  background:
    radial-gradient(880px 300px at -8% 2%, rgba(127, 186, 153, 0.26), transparent 64%),
    radial-gradient(720px 300px at 100% 10%, rgba(230, 177, 92, 0.22), transparent 68%),
    linear-gradient(180deg, #eef2ec 0%, #e7ebe5 40%, #e5e9e2 100%);
  color: var(--text);
  padding: 28px clamp(16px, 4vw, 42px) 38px;
  display: grid;
  gap: 26px;
}

.hero {
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: clamp(14px, 2.5vw, 28px);
  align-items: start;
}

.hero-text {
  border: 1px solid #ced8cf;
  border-radius: 24px;
  background: linear-gradient(160deg, rgba(249, 251, 247, 0.96), rgba(237, 243, 235, 0.92));
  box-shadow: 0 24px 44px rgba(61, 74, 66, 0.12);
  padding: clamp(18px, 3vw, 32px);
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #496352;
}

.hero-text h1 {
  margin: 0;
  font-size: clamp(30px, 4.4vw, 54px);
  line-height: 0.95;
  letter-spacing: -0.03em;
  max-width: 13ch;
}

.lead {
  margin: 14px 0 0;
  max-width: 58ch;
  font-size: clamp(15px, 1.8vw, 18px);
  line-height: 1.5;
  color: #49594f;
}

.hero-actions {
  margin-top: 18px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.hero-actions :deep(.primary-btn),
.hero-actions :deep(.ghost-btn) {
  padding: 11px 14px;
  border-radius: 11px;
}

.hero-actions :deep(.primary-btn) {
  text-decoration: none;
}

.hero-actions :deep(.ghost-btn) {
  display: inline-flex;
  align-items: center;
}

.hero-metrics {
  margin: 18px 0 0;
  padding: 14px 0 0;
  border-top: 1px dashed #bfd0c0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.hero-metrics li {
  display: grid;
  gap: 5px;
}

.hero-metrics strong {
  font-size: clamp(22px, 2.3vw, 30px);
  line-height: 1;
  letter-spacing: -0.03em;
  color: #2f5642;
}

.hero-metrics span {
  font-size: 12px;
  color: #53635a;
}

.hero-visual {
  box-sizing: border-box;
  border-radius: 24px;
  border: 1px solid #ced8cf;
  background: linear-gradient(145deg, #f3f7f1, #e7eee5);
  box-shadow: 0 24px 44px rgba(61, 74, 66, 0.12);
  padding: 10px;
  overflow: hidden;
}

.hero-preview-grid {
  height: 100%;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  align-content: start;
  display: grid;
  gap: 8px;
}

.hero-preview-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.hero-preview-tile {
  position: relative;
  flex: 0 0 auto;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 8px;
  background: #e8eee6;
}

.hero-preview-tile::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      110deg,
      rgba(198, 207, 199, 0.32) 8%,
      rgba(231, 236, 231, 0.72) 18%,
      rgba(198, 207, 199, 0.32) 33%
    );
  background-size: 220% 100%;
  animation: preview-tile-shimmer 1.2s linear infinite;
  opacity: 0.9;
  transition: opacity 0.16s ease;
}

.hero-preview-tile--loaded::before {
  opacity: 0;
}

.hero-preview-image {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: block;
  border-radius: 8px;
  border: 1px solid rgba(125, 134, 128, 0.25);
  background: #eef2ec;
  object-fit: contain;
  opacity: 0;
  transform: scale(1.01);
  transition: opacity 0.18s ease-out, transform 0.22s ease-out;
}

.hero-preview-image--loaded {
  opacity: 1;
  transform: none;
}

.series-cover {
  position: relative;
}

.series-cover::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background:
    linear-gradient(
      110deg,
      rgba(198, 207, 199, 0.32) 8%,
      rgba(231, 236, 231, 0.72) 18%,
      rgba(198, 207, 199, 0.32) 33%
    );
  background-size: 220% 100%;
  animation: preview-tile-shimmer 1.2s linear infinite;
  opacity: 0.9;
  transition: opacity 0.16s ease;
}

.series-cover--placeholder::before {
  opacity: 0;
}

.series-cover--loaded::before {
  opacity: 0;
}

.series-cover-image {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0;
  transform: scale(1.01);
  transition: opacity 0.18s ease-out, transform 0.22s ease-out;
}

.series-cover-image--loaded {
  opacity: 1;
  transform: none;
}

.hero-photo-placeholder,
.series-cover-placeholder {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: #5f6f66;
  font-size: 13px;
  background:
    linear-gradient(150deg, rgba(160, 189, 170, 0.35), rgba(228, 205, 168, 0.24)),
    repeating-linear-gradient(45deg, #e6ece3 0 10px, #edf2ea 10px 20px);
}

.hero-photo-placeholder {
  min-height: 280px;
  border-radius: 14px;
}

@keyframes preview-tile-shimmer {
  from {
    background-position-x: 220%;
  }

  to {
    background-position-x: -220%;
  }
}

.benefits {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.benefit-card {
  border: 1px solid #ced8cf;
  border-radius: 18px;
  background: rgba(247, 249, 245, 0.88);
  box-shadow: 0 14px 30px rgba(61, 74, 66, 0.08);
  padding: 16px;
}

.benefit-card h2 {
  margin: 0;
  font-size: clamp(19px, 1.8vw, 24px);
  line-height: 1.06;
  letter-spacing: -0.02em;
}

.benefit-card p {
  margin: 9px 0 0;
  color: #4f5f56;
  line-height: 1.42;
}

.quick-search {
  border: 1px solid #ced8cf;
  border-radius: 16px;
  background: rgba(241, 246, 239, 0.86);
  padding: 14px;
  display: grid;
  gap: 10px;
}

.quick-search p {
  margin: 0;
  color: #475a4f;
  font-weight: 700;
}

.quick-search-links {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.chip-link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  color: #2f5642;
  border: 1px solid #bed0bf;
  border-radius: 999px;
  background: rgba(221, 238, 228, 0.72);
  padding: 8px 12px;
  font-weight: 700;
  line-height: 1;
}

.chip-link:hover {
  background: rgba(207, 231, 215, 0.9);
}

.showcase {
  border: 1px solid #ced8cf;
  border-radius: 20px;
  background: rgba(248, 250, 247, 0.9);
  padding: 18px;
  box-shadow: 0 18px 30px rgba(61, 74, 66, 0.08);
}

.showcase-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.showcase-head h2 {
  margin: 0;
  font-size: clamp(24px, 2.5vw, 34px);
  letter-spacing: -0.03em;
}

.showcase-all {
  color: #335e49;
  text-decoration: none;
  font-weight: 700;
}

.showcase-all:hover {
  text-decoration: underline;
}

.showcase-grid {
  margin-top: 12px;
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.series-card {
  border: 1px solid #d8e0d6;
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
}

.series-card-link {
  color: inherit;
  text-decoration: none;
  display: grid;
}

.series-cover {
  aspect-ratio: 16 / 10;
  background: #dbe5d9;
}

.series-content {
  padding: 12px;
}

.series-content h3 {
  margin: 0;
  font-size: 20px;
  letter-spacing: -0.02em;
}

.meta-line {
  margin: 7px 0 0;
  color: #5c6d63;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  font-size: 13px;
}

.description {
  margin: 8px 0 0;
  color: #4e5f56;
  line-height: 1.4;
}

.reveal {
  animation: revealUp 0.55s ease both;
}

.reveal--two {
  animation-delay: 0.08s;
}

.reveal--three {
  animation-delay: 0.15s;
}

.reveal--four {
  animation-delay: 0.22s;
}

.reveal--five {
  animation-delay: 0.28s;
}

@keyframes revealUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 1100px) {
  .hero {
    grid-template-columns: 1fr;
  }

  .benefits {
    grid-template-columns: 1fr;
  }

  .showcase-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .home-page {
    padding-inline: 14px;
  }

  .hero-text h1 {
    max-width: 100%;
  }

  .hero-metrics {
    grid-template-columns: 1fr;
  }

  .showcase {
    padding: 14px;
  }

  .showcase-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reveal {
    animation: none;
  }
}
</style>
