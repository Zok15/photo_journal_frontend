<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { resolveMissingAspectRatios } from '../lib/imageAspectRatio'
import { buildPreviewRowsWithClampedHeights } from '../lib/previewRows'
import { seriesPath } from '../lib/seriesPath'
import { buildStorageUrl, withCacheBust } from '../lib/url'
import { currentLocale, t } from '../lib/i18n'

const route = useRoute()
const router = useRouter()

const series = ref([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const lastPage = ref(1)
const previewVersion = ref(Date.now())

const searchInput = ref('')
const search = ref('')
const activeSort = ref('new')
const dateField = ref('added')
const selectedTags = ref([])
const dateFrom = ref('')
const dateTo = ref('')
const selectedAuthorId = ref('')
const authorSearchInput = ref('')
const showAuthorSuggestions = ref(false)
const suggestedAuthors = ref([])
const availableTags = ref([])
const availableAuthors = ref([])
const previewGridWidths = ref({})
const previewAspectRatios = ref({})
const previewImageLoaded = ref({})
const previewGridElements = new Map()
const showMobileFilters = ref(false)
const MOBILE_PREVIEW_BREAKPOINT = 960
const MOBILE_MAX_PREVIEW_TILES = 8
const isMobilePreviewViewport = ref(
  typeof window !== 'undefined' ? window.innerWidth <= MOBILE_PREVIEW_BREAKPOINT : false,
)
const TAG_ROWS_INITIAL = 4
const TAG_ROWS_STEP = 10
const visibleTagRows = ref(TAG_ROWS_INITIAL)
const tagRowsTotal = ref(0)
const tagVisibleHeight = ref(0)
const tagsCloudRef = ref(null)
let previewResizeObserver = null
let tagsLayoutObserver = null
let authorSuggestBlurTimerId = null

const hasActiveFilters = computed(() => {
  return Boolean(
    search.value.trim()
      || selectedTags.value.length
      || dateFrom.value
      || dateTo.value
      || selectedAuthorId.value
      || dateField.value !== 'added'
      || activeSort.value !== 'new',
  )
})

const filteredAuthors = computed(() => {
  const query = authorSearchInput.value.trim().toLowerCase()
  if (!query) {
    return availableAuthors.value
  }

  return availableAuthors.value.filter((author) => {
    const name = String(author?.name || '').toLowerCase()
    return name.includes(query)
  })
})

const authorSuggestions = computed(() => {
  const query = authorSearchInput.value.trim()
  if (!query) {
    return suggestedAuthors.value.slice(0, 5)
  }

  return filteredAuthors.value.slice(0, 8)
})

const hasHiddenTagRows = computed(() => {
  return tagRowsTotal.value > visibleTagRows.value
})

const canCollapseTagRows = computed(() => {
  return visibleTagRows.value > TAG_ROWS_INITIAL
})

const tagCloudStyle = computed(() => {
  if (!hasHiddenTagRows.value || tagVisibleHeight.value <= 0) {
    return {}
  }

  return {
    maxHeight: `${tagVisibleHeight.value}px`,
  }
})

function formatDate(value) {
  if (!value) {
    return t('Без даты')
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return t('Без даты')
  }

  const locale = currentLocale.value === 'en' ? 'en-US' : 'ru-RU'

  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function photoUrl(photo) {
  const direct = String(photo?.preview_url || '').trim() || String(photo?.public_url || '').trim()
  if (direct) {
    return direct
  }

  return buildStorageUrl(photo?.path)
}

function previewUrl(photo) {
  return withCacheBust(photoUrl(photo), previewVersion.value)
}

const seriesPreviews = computed(() => {
  const map = {}

  series.value.forEach((item) => {
    const seriesId = Number(item?.id || 0)
    if (!seriesId) {
      return
    }

    const photos = (item?.preview_photos || [])
      .map((photo, index) => ({
        id: Number(photo?.id || 0) || `${seriesId}-${index}`,
        src: previewUrl(photo),
        alt: photo?.original_name || `photo-${photo?.id || index}`,
      }))
      .filter((photo) => photo.src)

    map[seriesId] = photos
  })

  return map
})

function previewTiles(seriesId) {
  const tiles = seriesPreviews.value[seriesId] || []
  if (!isMobilePreviewViewport.value) {
    return tiles
  }

  return tiles.slice(0, MOBILE_MAX_PREVIEW_TILES)
}

function previewOverflowCount(item) {
  const total = Number(item?.photos_count || 0)
  const shown = previewTiles(item?.id).length
  return Math.max(0, total - shown)
}

function shouldShowPreviewOverflowOnTile(item, tile) {
  const tiles = previewTiles(item?.id)
  if (!tiles.length || previewOverflowCount(item) <= 0) {
    return false
  }

  const lastTile = tiles[tiles.length - 1]
  return String(lastTile?.id) === String(tile?.photo?.id)
}

function setPreviewGridRef(seriesId, element) {
  const previous = previewGridElements.get(seriesId)
  if (previous && previous !== element && previewResizeObserver) {
    previewResizeObserver.unobserve(previous)
  }

  if (!element) {
    previewGridElements.delete(seriesId)
    delete previewGridWidths.value[seriesId]
    return
  }

  previewGridElements.set(seriesId, element)
  previewGridWidths.value[seriesId] = element.clientWidth || 0
  if (previewResizeObserver) {
    previewResizeObserver.observe(element)
  }
}

function syncPreviewViewportMode() {
  if (typeof window === 'undefined') {
    return
  }

  isMobilePreviewViewport.value = window.innerWidth <= MOBILE_PREVIEW_BREAKPOINT
}

function isPreviewImageLoaded(photoId) {
  return Boolean(previewImageLoaded.value[String(photoId)])
}

function markPreviewImageLoaded(photoId) {
  const key = String(photoId || '').trim()
  if (!key || previewImageLoaded.value[key]) {
    return
  }

  previewImageLoaded.value = {
    ...previewImageLoaded.value,
    [key]: true,
  }
}

const previewRowsBySeries = computed(() => {
  const map = {}

  series.value.forEach((item) => {
    const seriesId = Number(item?.id || 0)
    if (!seriesId) {
      return
    }

    const photos = previewTiles(seriesId)
    if (!photos.length) {
      return
    }

    const width = previewGridWidths.value[seriesId] || 920
    map[seriesId] = buildPreviewRowsWithClampedHeights(
      photos,
      width,
      previewAspectRatios.value,
      {
        gap: 8,
        minPerRow: 2,
        maxPerRow: 5,
        mobileMinPerRow: 3,
        mobileMaxPerRow: 4,
        mobileBreakPoint: MOBILE_PREVIEW_BREAKPOINT,
        strictRatioOnMobile: true,
        forceMobileLayout: isMobilePreviewViewport.value,
        targetRowHeight: 170,
        minRowHeight: 96,
        maxRowHeight: 260,
        minPreviewRatio: 0.72,
        maxPreviewRatio: 2.4,
        singleMinHeight: 120,
        singleMaxHeight: 240,
        fallbackHeight: 160,
      },
    )
  })

  return map
})

function toggleTag(tagName) {
  if (selectedTags.value.includes(tagName)) {
    selectedTags.value = selectedTags.value.filter((name) => name !== tagName)
  } else {
    selectedTags.value = [...selectedTags.value, tagName]
  }

  loadPublicSeries(1)
}

function resetFilters() {
  search.value = ''
  searchInput.value = ''
  activeSort.value = 'new'
  dateField.value = 'added'
  selectedTags.value = []
  dateFrom.value = ''
  dateTo.value = ''
  selectedAuthorId.value = ''
  authorSearchInput.value = ''
  showAuthorSuggestions.value = false
  updateAuthorQuery('')
  loadPublicSeries(1)
}

function onAuthorInput() {
  selectedAuthorId.value = ''
  showAuthorSuggestions.value = true
}

function openAuthorSuggestions() {
  if (authorSuggestBlurTimerId !== null) {
    clearTimeout(authorSuggestBlurTimerId)
    authorSuggestBlurTimerId = null
  }
  showAuthorSuggestions.value = true
}

function closeAuthorSuggestions() {
  authorSuggestBlurTimerId = window.setTimeout(() => {
    showAuthorSuggestions.value = false
    authorSuggestBlurTimerId = null
  }, 120)
}

function pickAuthorSuggestion(author) {
  const authorId = Number(author?.id || 0)
  if (!authorId) {
    return
  }

  selectedAuthorId.value = String(authorId)
  authorSearchInput.value = String(author?.name || '').trim()
  showAuthorSuggestions.value = false
  updateAuthorQuery(selectedAuthorId.value)
  loadPublicSeries(1)
}

function toggleMobileFilters() {
  showMobileFilters.value = !showMobileFilters.value
}

function applyAuthorSuggestion() {
  if (!authorSuggestions.value.length) {
    if (!authorSearchInput.value.trim() && selectedAuthorId.value) {
      selectedAuthorId.value = ''
      updateAuthorQuery('')
      loadPublicSeries(1)
    }
    return
  }

  const exact = authorSuggestions.value.find(
    (author) => String(author?.name || '').toLowerCase() === authorSearchInput.value.trim().toLowerCase(),
  )
  pickAuthorSuggestion(exact || authorSuggestions.value[0])
}

function clearAuthorFilter() {
  if (!selectedAuthorId.value && !authorSearchInput.value.trim()) {
    return
  }

  selectedAuthorId.value = ''
  authorSearchInput.value = ''
  showAuthorSuggestions.value = false
  updateAuthorQuery('')
  loadPublicSeries(1)
}

function updateAuthorQuery(authorId) {
  const nextQuery = { ...route.query }
  if (authorId) {
    nextQuery.author_id = String(authorId)
  } else {
    delete nextQuery.author_id
  }

  router.replace({ query: nextQuery }).catch(() => {})
}

async function loadPublicSeries(targetPage = 1) {
  loading.value = true
  error.value = ''

  try {
    const params = {
      per_page: 10,
      page: targetPage,
      preview_nonce: Date.now(),
    }

    const searchValue = search.value.trim()
    if (searchValue) {
      params.search = searchValue
    }

    if (selectedTags.value.length) {
      params.tag = selectedTags.value.join(',')
    }

    if (selectedAuthorId.value) {
      params.author_id = Number(selectedAuthorId.value)
    }

    if (dateFrom.value) {
      params.date_from = dateFrom.value
    }

    if (dateTo.value) {
      params.date_to = dateTo.value
    }
    if (dateField.value !== 'added') {
      params.date_field = dateField.value
    }

    if (activeSort.value !== 'new') {
      params.sort = activeSort.value
    }

    const { data } = await api.get('/public/series', { params })

    series.value = Array.isArray(data?.data) ? data.data : []
    previewImageLoaded.value = {}
    page.value = Number(data?.current_page || targetPage)
    lastPage.value = Number(data?.last_page || 1)
    availableTags.value = Array.isArray(data?.available_tags)
      ? data.available_tags.map((tag) => String(tag?.name || '').trim()).filter(Boolean)
      : []
    availableAuthors.value = Array.isArray(data?.authors) ? data.authors : []
    suggestedAuthors.value = Array.isArray(data?.author_suggestions) ? data.author_suggestions : []
    if (selectedAuthorId.value && !authorSearchInput.value.trim()) {
      const selectedAuthor = availableAuthors.value.find(
        (author) => String(author?.id) === String(selectedAuthorId.value),
      )
      if (selectedAuthor?.name) {
        authorSearchInput.value = String(selectedAuthor.name)
      }
    }
    previewVersion.value = Date.now()
  } catch (e) {
    error.value = e?.response?.data?.message || t('Failed to load public series.')
  } finally {
    loading.value = false
  }
}

function submitSearch() {
  search.value = searchInput.value
  loadPublicSeries(1)
}

function goToPage(nextPage) {
  if (loading.value || nextPage < 1 || nextPage > lastPage.value || nextPage === page.value) {
    return
  }

  loadPublicSeries(nextPage)
}

function recalcTagRowsLayout() {
  const container = tagsCloudRef.value
  if (!container) {
    tagRowsTotal.value = 0
    tagVisibleHeight.value = 0
    return
  }

  const chips = Array.from(container.querySelectorAll('.tag-chip'))
  if (!chips.length) {
    tagRowsTotal.value = 0
    tagVisibleHeight.value = 0
    return
  }

  const rowsByTop = new Map()
  for (const chip of chips) {
    const top = chip.offsetTop
    const bottom = chip.offsetTop + chip.offsetHeight
    const current = rowsByTop.get(top) || { top, bottom }
    current.bottom = Math.max(current.bottom, bottom)
    rowsByTop.set(top, current)
  }

  const rows = Array.from(rowsByTop.values()).sort((a, b) => a.top - b.top)
  tagRowsTotal.value = rows.length

  if (rows.length <= visibleTagRows.value) {
    tagVisibleHeight.value = rows.at(-1)?.bottom || 0
    return
  }

  const fullRowsIndex = Math.min(rows.length, visibleTagRows.value) - 1
  const nextRowIndex = Math.min(rows.length - 1, visibleTagRows.value)
  const fullBottom = rows[fullRowsIndex]?.bottom || 0
  const nextRow = rows[nextRowIndex] || null

  if (!nextRow) {
    tagVisibleHeight.value = fullBottom
    return
  }

  const nextRowHeight = nextRow.bottom - nextRow.top
  tagVisibleHeight.value = Math.round(fullBottom + nextRowHeight * 0.45)
}

function expandTagRows() {
  visibleTagRows.value += TAG_ROWS_STEP
}

function collapseTagRows() {
  visibleTagRows.value = TAG_ROWS_INITIAL
}

function normalizeSort(value) {
  return ['new', 'old', 'taken_new', 'taken_old'].includes(value) ? value : 'new'
}

function parseTagQuery(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => String(entry || '').split(','))
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function applyFiltersFromQuery(query = {}) {
  search.value = String(query.search || '').trim()
  searchInput.value = search.value
  activeSort.value = normalizeSort(String(query.sort || '').trim())
  dateField.value = ['added', 'taken'].includes(String(query.date_field || '').trim())
    ? String(query.date_field || '').trim()
    : 'added'
  selectedTags.value = parseTagQuery(query.tag)
  dateFrom.value = String(query.date_from || '').trim()
  dateTo.value = String(query.date_to || '').trim()
  selectedAuthorId.value = String(query.author_id || '').trim()
  authorSearchInput.value = ''
  showAuthorSuggestions.value = false
}

onMounted(() => {
  previewResizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const matched = Array.from(previewGridElements.entries()).find(([, element]) => element === entry.target)
      if (!matched) {
        return
      }

      const [seriesId] = matched
      const nextWidth = entry.contentRect.width
      if (previewGridWidths.value[seriesId] !== nextWidth) {
        previewGridWidths.value = {
          ...previewGridWidths.value,
          [seriesId]: nextWidth,
        }
      }
    })
  })

  tagsLayoutObserver = new ResizeObserver(() => {
    recalcTagRowsLayout()
  })
  if (tagsCloudRef.value) {
    tagsLayoutObserver.observe(tagsCloudRef.value)
  }

  window.addEventListener('resize', syncPreviewViewportMode)
  syncPreviewViewportMode()
})

onBeforeUnmount(() => {
  if (previewResizeObserver) {
    previewResizeObserver.disconnect()
    previewResizeObserver = null
  }

  if (tagsLayoutObserver) {
    tagsLayoutObserver.disconnect()
    tagsLayoutObserver = null
  }

  if (authorSuggestBlurTimerId !== null) {
    clearTimeout(authorSuggestBlurTimerId)
    authorSuggestBlurTimerId = null
  }

  window.removeEventListener('resize', syncPreviewViewportMode)
  previewGridElements.clear()
})

watch(
  seriesPreviews,
  async (map) => {
    const photos = Object.values(map).flat()
    const ratioPatch = await resolveMissingAspectRatios(
      photos,
      previewAspectRatios.value,
      (photo) => photo?.src,
    )
    if (Object.keys(ratioPatch).length) {
      previewAspectRatios.value = {
        ...previewAspectRatios.value,
        ...ratioPatch,
      }
    }
  },
  { immediate: true },
)

watch(
  () => route.fullPath,
  () => {
    applyFiltersFromQuery(route.query)
    loadPublicSeries(1)
  },
  { immediate: true },
)

watch([availableTags, visibleTagRows], async () => {
  await nextTick()
  recalcTagRowsLayout()
}, { immediate: true })
</script>

<template>
  <div class="public-page">
    <div class="public-shell">
      <header class="public-header">
        <h1>{{ t('Галерея') }}</h1>
      </header>

      <div class="public-layout">
        <div class="filters-mobile-actions">
          <button
            type="button"
            class="filters-toggle-mobile"
            :aria-expanded="showMobileFilters ? 'true' : 'false'"
            @click="toggleMobileFilters"
          >
            <span class="filters-toggle-icon">⚲</span>
            {{ showMobileFilters ? t('Скрыть фильтры') : t('Фильтр') }}
          </button>
          <button
            v-if="hasActiveFilters"
            type="button"
            class="filters-reset-mobile"
            :title="t('Сбросить фильтры')"
            :aria-label="t('Сбросить фильтры')"
            @click="resetFilters"
          >
            ↺
          </button>
        </div>

        <aside class="filters-panel" :class="{ 'filters-panel--mobile-open': showMobileFilters }">
          <section class="filter-group">
            <h3>{{ t('Поиск') }}</h3>
            <form class="search-form" @submit.prevent="submitSearch">
              <input v-model="searchInput" type="text" :placeholder="t('Название или описание')" />
              <button type="submit" class="ghost-btn">{{ t('Найти') }}</button>
            </form>
          </section>

          <section class="filter-group">
            <h3>{{ t('Автор') }}</h3>
            <div class="author-search-wrap">
              <input
                v-model="authorSearchInput"
                type="text"
                class="author-search-input"
                :placeholder="t('Начните вводить имя автора...')"
                @input="onAuthorInput"
                @focus="openAuthorSuggestions"
                @blur="closeAuthorSuggestions"
                @keydown.enter.prevent="applyAuthorSuggestion"
                @keydown.esc.prevent="showAuthorSuggestions = false"
              />
              <ul
                v-if="showAuthorSuggestions && authorSuggestions.length"
                class="author-suggestions"
              >
                <li v-for="author in authorSuggestions" :key="author.id">
                  <button type="button" @mousedown.prevent @click="pickAuthorSuggestion(author)">
                    <span>{{ author.name }}</span>
                    <small v-if="!authorSearchInput.trim() && author.series_count" class="author-suggestion-meta">
                      {{ author.series_count }} {{ t('за') }} {{ author.period_days }} {{ t('дн.') }}
                    </small>
                  </button>
                </li>
              </ul>
              <p
                v-else-if="showAuthorSuggestions && authorSearchInput.trim() && !authorSuggestions.length"
                class="author-suggest-empty"
              >
                {{ t('Ничего не найдено') }}
              </p>
            </div>
            <button
              v-if="selectedAuthorId || authorSearchInput.trim()"
              type="button"
              class="ghost-btn author-reset-btn"
              @click="clearAuthorFilter"
            >
              {{ t('Все авторы') }}
            </button>
          </section>

          <section class="filter-group">
            <h3>{{ t('Дата') }}</h3>
            <div class="chip-row">
              <button type="button" class="chip" :class="{ active: dateField === 'added' }" @click="dateField = 'added'; loadPublicSeries(1)">
                {{ t('Дата добавления') }}
              </button>
              <button type="button" class="chip" :class="{ active: dateField === 'taken' }" @click="dateField = 'taken'; loadPublicSeries(1)">
                {{ t('Дата съёмки') }}
              </button>
            </div>
            <label class="date-label">
              {{ t('От') }}
              <input v-model="dateFrom" type="date" @change="loadPublicSeries(1)" />
            </label>
            <label class="date-label">
              {{ t('До') }}
              <input v-model="dateTo" type="date" @change="loadPublicSeries(1)" />
            </label>
          </section>

          <section class="filter-group">
            <h3>{{ t('Теги') }}</h3>
            <div class="tags-cloud-shell">
              <div
                ref="tagsCloudRef"
                class="chip-row tags-cloud"
                :class="{ 'tags-cloud--collapsed': hasHiddenTagRows }"
                :style="tagCloudStyle"
              >
                <button
                  v-for="tag in availableTags"
                  :key="tag"
                  type="button"
                  class="chip tag-chip"
                  :class="{ active: selectedTags.includes(tag) }"
                  @click="toggleTag(tag)"
                >
                  #{{ tag }}
                </button>
              </div>

              <div v-if="hasHiddenTagRows" class="tags-fade-overlay"></div>
              <button
                v-if="hasHiddenTagRows"
                type="button"
                class="tags-expand-btn"
                :title="t('Показать ещё')"
                @click="expandTagRows"
              >
                <span class="tags-chevron tags-chevron--down" aria-hidden="true"></span>
              </button>
            </div>

            <div v-if="canCollapseTagRows" class="chip-row tags-collapse-row">
              <button type="button" class="tags-expand-btn tags-collapse-btn" :title="t('Свернуть')" @click="collapseTagRows">
                <span class="tags-chevron tags-chevron--up" aria-hidden="true"></span>
              </button>
            </div>
          </section>

          <section class="filter-group">
            <h3>{{ t('Сортировка') }}</h3>
            <div class="chip-row">
              <span class="sort-group-label">{{ t('По дате добавления') }}</span>
              <button type="button" class="chip" :class="{ active: activeSort === 'new' }" @click="activeSort = 'new'; loadPublicSeries(1)">
                {{ t('Новые') }}
              </button>
              <button type="button" class="chip" :class="{ active: activeSort === 'old' }" @click="activeSort = 'old'; loadPublicSeries(1)">
                {{ t('Старые') }}
              </button>
            </div>
            <div class="chip-row sort-row-secondary">
              <span class="sort-group-label">{{ t('По дате съёмки') }}</span>
              <button type="button" class="chip" :class="{ active: activeSort === 'taken_new' }" @click="activeSort = 'taken_new'; loadPublicSeries(1)">
                {{ t('Новые') }}
              </button>
              <button type="button" class="chip" :class="{ active: activeSort === 'taken_old' }" @click="activeSort = 'taken_old'; loadPublicSeries(1)">
                {{ t('Старые') }}
              </button>
            </div>
          </section>

          <button v-if="hasActiveFilters" type="button" class="ghost-btn reset-btn" @click="resetFilters">
            {{ t('Сбросить фильтры') }}
          </button>
        </aside>

        <main class="content-panel">
          <p v-if="loading" class="state-text">{{ t('Загрузка...') }}</p>
          <p v-else-if="error" class="error">{{ error }}</p>
          <p v-else-if="!series.length" class="state-text">{{ t('Серии в галерее не найдены.') }}</p>

          <section v-else class="series-grid">
            <article v-for="item in series" :key="item.id" class="series-card">
              <header class="series-card-header">
                <h2>
                  <RouterLink class="series-title-link" :to="seriesPath(item)">
                    {{ item.title }}
                  </RouterLink>
                </h2>
                <RouterLink class="view-link" :to="seriesPath(item)">{{ t('Открыть') }}</RouterLink>
              </header>

              <div class="series-meta">
                <span>{{ formatDate(item.created_at) }}</span>
                <span v-if="item.taken_at">{{ t('Съёмка') }}: {{ formatDate(item.taken_at) }}</span>
                <span>{{ item.photos_count }} {{ t('фото') }}</span>
                <span v-if="item.owner_name">
                  {{ t('Автор') }}:
                  <RouterLink class="author-link" :to="{ path: '/public/series', query: { ...route.query, author_id: String(item.user_id) } }">
                    {{ item.owner_name }}
                  </RouterLink>
                </span>
              </div>

              <RouterLink
                v-if="item.description"
                class="series-body-link"
                :to="seriesPath(item)"
              >
                <p class="series-desc">{{ item.description }}</p>
              </RouterLink>

              <RouterLink
                v-if="previewTiles(item.id).length"
                class="series-body-link"
                :to="seriesPath(item)"
              >
                <div
                :ref="(element) => setPreviewGridRef(item.id, element)"
                class="preview-grid"
              >
                <div
                  v-for="(row, rowIndex) in (previewRowsBySeries[item.id]?.rows || [])"
                  :key="`${item.id}-${rowIndex}`"
                  class="preview-row"
                  :style="{ columnGap: `${row.gap}px` }"
                >
                  <div
                    v-for="tile in row.tiles"
                    :key="tile.photo.id"
                    class="preview-tile"
                    :class="{ 'preview-tile--loaded': isPreviewImageLoaded(tile.photo.id) }"
                    :style="{ width: `${tile.width}px`, height: `${row.height || 0}px` }"
                  >
                    <img
                      class="preview-tile-image"
                      :class="{
                        'preview-tile-image--loaded': isPreviewImageLoaded(tile.photo.id),
                        'preview-tile-image--contain': isMobilePreviewViewport,
                      }"
                      :src="tile.photo.src"
                      :alt="tile.photo.alt"
                      @load="markPreviewImageLoaded(tile.photo.id)"
                      @error="markPreviewImageLoaded(tile.photo.id)"
                    />
                    <div
                      v-if="shouldShowPreviewOverflowOnTile(item, tile)"
                      class="preview-more-badge"
                    >
                      +{{ previewOverflowCount(item) }}
                    </div>
                  </div>
                </div>
              </div>
              </RouterLink>

              <div v-if="(item.tags || []).length" class="tags">
                <button
                  v-for="tag in item.tags"
                  :key="tag.id"
                  type="button"
                  class="tag-chip tag-chip--action"
                  :class="{ active: selectedTags.includes(tag.name) }"
                  @click="toggleTag(tag.name)"
                >
                  #{{ tag.name }}
                </button>
              </div>
            </article>
          </section>

          <div class="pager" v-if="!loading && !error && lastPage > 1">
            <button type="button" class="ghost-btn" :disabled="page <= 1" @click="goToPage(page - 1)">{{ t('Назад') }}</button>
            <span>{{ t('Страница') }} {{ page }} / {{ lastPage }}</span>
            <button type="button" class="ghost-btn" :disabled="page >= lastPage" @click="goToPage(page + 1)">{{ t('Вперёд') }}</button>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
.public-page {
  min-height: calc(100vh - 72px);
  padding: 24px 8px 36px;
  background:
    radial-gradient(700px 220px at 15% 0%, rgba(183, 201, 190, 0.35), transparent 65%),
    radial-gradient(860px 260px at 100% 15%, rgba(218, 206, 188, 0.28), transparent 70%),
    #f4f5f2;
}

.public-shell {
  max-width: 1260px;
  margin: 0 auto;
  border: 1px solid #dde0d9;
  border-radius: 18px;
  background: #fbfcfa;
  box-shadow: 0 20px 40px rgba(79, 86, 80, 0.1);
  overflow: hidden;
}

.public-header {
  padding: 16px 20px;
  border-bottom: 1px solid #dde0d9;
}

.public-header h1 {
  margin: 0;
  font-size: 36px;
}

.public-layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
}

.filters-mobile-actions {
  display: none;
}

.filters-toggle-mobile {
  border: 1px solid #d6dbd4;
  border-radius: 9px;
  background: #edf1ec;
  color: #35403a;
  padding: 7px 11px;
  font-weight: 700;
  cursor: pointer;
}

.filters-toggle-icon {
  margin-right: 8px;
}

.filters-reset-mobile {
  border: 1px solid #d6dbd4;
  border-radius: 9px;
  background: #edf1ec;
  color: #35403a;
  width: 38px;
  height: 34px;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.filters-panel {
  padding: 16px;
  border-right: 1px solid #dde0d9;
  background: #f7f8f4;
}

.filter-group + .filter-group {
  margin-top: 14px;
}

.filter-group h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #55615a;
}

.search-form {
  display: grid;
  gap: 8px;
}

.search-form input,
.author-search-input,
.date-label input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dde0d9;
  border-radius: 8px;
  background: #fff;
  padding: 9px 10px;
}

.author-search-input {
  margin-bottom: 0;
}

.author-search-wrap {
  position: relative;
}

.author-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 12;
  margin: 0;
  padding: 4px;
  list-style: none;
  border: 1px solid #ced8cd;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 8px 18px rgba(33, 49, 41, 0.12);
}

.author-suggestions li + li {
  margin-top: 2px;
}

.author-suggestions button {
  width: 100%;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #3f5a4a;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.2;
  padding: 5px 7px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.author-suggestions button:hover {
  background: #eef3ed;
}

.author-suggestion-meta {
  color: #71807a;
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
}

.author-suggest-empty {
  margin: 6px 0 0;
  font-size: 12px;
  color: #71807a;
}

.author-reset-btn {
  margin-top: 8px;
  width: 100%;
}

.date-label {
  display: grid;
  gap: 4px;
  margin-top: 6px;
  color: #617067;
  font-size: 13px;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sort-row-secondary {
  margin-top: 8px;
}

.sort-group-label {
  width: 100%;
  font-size: 12px;
  color: #71807a;
}

.tags-cloud-shell {
  position: relative;
  padding-bottom: 34px;
}

.tags-cloud {
  transition: max-height 0.24s ease;
}

.tags-cloud--collapsed {
  overflow: hidden;
}

.tags-fade-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 34px;
  height: 96px;
  pointer-events: none;
  background:
    linear-gradient(
      to bottom,
      rgba(247, 248, 244, 0.04) 0%,
      rgba(247, 248, 244, 0.72) 54%,
      rgba(247, 248, 244, 0.98) 100%
    );
}

.tags-expand-btn {
  position: absolute;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  width: 40px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: rgba(154, 198, 176, 0.25);
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tags-expand-btn:hover {
  background: rgba(154, 198, 176, 0.38);
}

.tags-chevron {
  width: 12px;
  height: 12px;
  border-right: 3px solid rgba(238, 244, 239, 0.95);
  border-bottom: 3px solid rgba(238, 244, 239, 0.95);
  border-radius: 2px;
  display: block;
}

.tags-chevron--down {
  transform: rotate(45deg) translate(-1px, -1px);
}

.tags-chevron--up {
  transform: rotate(-135deg) translate(-1px, -1px);
}

.tags-collapse-row {
  margin-top: 6px;
  justify-content: center;
}

.tags-collapse-btn {
  position: static;
  transform: none;
  width: 34px;
  height: 24px;
  background: #e3ebe4;
}

.tags-collapse-btn:hover {
  background: #d5e5da;
}

.chip,
.ghost-btn {
  border: 1px solid #d6dbd4;
  border-radius: 9px;
  background: #edf1ec;
  color: #35403a;
  padding: 7px 11px;
  font-weight: 700;
  cursor: pointer;
}

.chip {
  font-size: 12px;
}

.chip.active {
  background: #ddeee4;
  border-color: #b9d5c4;
  color: #335e49;
}

.reset-btn {
  margin-top: 16px;
  width: 100%;
}

.content-panel {
  padding: 18px;
}

.series-grid {
  display: grid;
  gap: 14px;
}

.series-card {
  border: 1px solid #dde0d9;
  border-radius: 12px;
  background: #fff;
  padding: 14px;
}

.series-card-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.series-card h2 {
  margin: 0;
  font-size: 34px;
  line-height: 1;
}

.series-title-link {
  color: inherit;
  text-decoration: none;
}

.series-title-link:hover {
  text-decoration: underline;
}

.view-link {
  text-decoration: none;
  color: #335e49;
  font-weight: 700;
}

.view-link:hover {
  text-decoration: underline;
}

.series-meta {
  margin-top: 7px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  color: #657067;
  font-size: 14px;
}

.author-link {
  color: #335e49;
  font-weight: 700;
  text-decoration: none;
}

.author-link:hover {
  text-decoration: underline;
}

.series-desc {
  margin: 10px 0;
  font-size: 17px;
  color: #4b574f;
}

.series-body-link {
  display: block;
  color: inherit;
  text-decoration: none;
}

.preview-grid {
  margin-top: 10px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  display: grid;
  gap: 8px;
}

.preview-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.preview-tile {
  position: relative;
  flex: 0 0 auto;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 8px;
  background: #e8eee6;
}

.preview-tile::before {
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

.preview-tile--loaded::before {
  opacity: 0;
}

.preview-tile-image {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: block;
  border-radius: 8px;
  border: 1px solid rgba(125, 134, 128, 0.25);
  background: #eef2ec;
  object-fit: cover;
  opacity: 0;
  transform: scale(1.01);
  transition: opacity 0.18s ease-out, transform 0.22s ease-out;
}

.preview-tile-image--loaded {
  opacity: 1;
  transform: none;
}

.preview-tile-image--contain {
  object-fit: contain !important;
}

@keyframes preview-tile-shimmer {
  from {
    background-position-x: 220%;
  }

  to {
    background-position-x: -220%;
  }
}

.preview-more-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 2;
  border-radius: 999px;
  background: rgba(21, 28, 24, 0.72);
  color: #f6faf7;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  padding: 6px 9px;
  backdrop-filter: blur(2px);
}

.tags {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-chip {
  border: 1px solid #ced8cd;
  border-radius: 999px;
  background: #eef3ed;
  color: #4f6354;
  padding: 3px 9px;
  font-size: 12px;
}

.tag-chip--action {
  cursor: pointer;
}

.tag-chip--action.active {
  background: #ddeee4;
  border-color: #b9d5c4;
  color: #335e49;
}

.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
}

.error {
  color: #a24949;
}

@media (max-width: 960px) {
  .public-layout {
    grid-template-columns: 1fr;
  }

  .filters-mobile-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 14px 16px 0;
  }

  .filters-panel {
    display: none;
    border-right: 0;
    border-bottom: 1px solid #dde0d9;
  }

  .filters-panel.filters-panel--mobile-open {
    display: block;
  }

  .series-card h2 {
    font-size: 26px;
  }

  .preview-grid {
    gap: 8px;
  }

  .preview-row {
    overflow: hidden;
  }

  .preview-tile-image {
    object-fit: contain;
  }
}
</style>
