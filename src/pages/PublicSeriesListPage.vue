<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from '../lib/api'
import { buildStorageUrl, withCacheBust } from '../lib/url'

const series = ref([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const lastPage = ref(1)
const previewVersion = ref(Date.now())

const searchInput = ref('')
const search = ref('')
const activeSort = ref('new')
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
const previewGridElements = new Map()
let previewResizeObserver = null
let authorSuggestBlurTimerId = null

const hasActiveFilters = computed(() => {
  return Boolean(
    search.value.trim()
      || selectedTags.value.length
      || dateFrom.value
      || dateTo.value
      || selectedAuthorId.value
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

function formatDate(value) {
  if (!value) {
    return 'Без даты'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Без даты'
  }

  return new Intl.DateTimeFormat('ru-RU', {
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
  return seriesPreviews.value[seriesId] || []
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

async function ensurePreviewRatio(photo) {
  if (!photo?.id || !photo?.src || previewAspectRatios.value[photo.id]) {
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

    previewAspectRatios.value = {
      ...previewAspectRatios.value,
      [photo.id]: Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
    }
  } catch (_) {
    previewAspectRatios.value = {
      ...previewAspectRatios.value,
      [photo.id]: 1,
    }
  }
}

function buildPreviewRows(photos, containerWidth) {
  const previewGap = 8
  const minPerRow = 2
  const maxPerRow = 5
  const targetRowHeight = 170
  const minRowHeight = 96
  const maxRowHeight = 260
  const items = photos.map((photo) => ({
    photo,
    ratio: previewAspectRatios.value[photo.id] || 1,
  }))

  if (!items.length) {
    return { rows: [] }
  }

  if (items.length === 1) {
    const ratio = items[0].ratio || 1
    const height = Math.max(120, Math.min(240, containerWidth / ratio))
    return {
      rows: [{ gap: 0, height, tiles: [{ photo: items[0].photo, width: ratio * height }] }],
    }
  }

  const minRows = Math.ceil(items.length / maxPerRow)
  const maxRows = Math.floor(items.length / minPerRow)
  let best = null

  for (let rowsCount = minRows; rowsCount <= maxRows; rowsCount += 1) {
    const base = Math.floor(items.length / rowsCount)
    const extra = items.length % rowsCount
    const counts = Array.from({ length: rowsCount }, (_, index) => base + (index < extra ? 1 : 0))

    if (counts.some((count) => count < minPerRow || count > maxPerRow)) {
      continue
    }

    const ratiosByRow = []
    let cursor = 0
    for (const count of counts) {
      const chunk = items.slice(cursor, cursor + count)
      cursor += count
      ratiosByRow.push(chunk.reduce((sum, item) => sum + item.ratio, 0))
    }

    const rowHeights = ratiosByRow.map((ratioSum, index) => {
      const rowWidth = containerWidth - previewGap * (counts[index] - 1)
      return rowWidth / ratioSum
    })

    const rows = []
    cursor = 0
    let emptySpace = 0
    let outOfRangePenalty = 0
    let targetDeviation = 0

    for (let rowIndex = 0; rowIndex < counts.length; rowIndex += 1) {
      const count = counts[rowIndex]
      const chunk = items.slice(cursor, cursor + count)
      cursor += count

      const rowHeight = rowHeights[rowIndex]
      const clampedHeight = Math.max(minRowHeight, Math.min(maxRowHeight, rowHeight))
      const widths = chunk.map((item) => item.ratio * clampedHeight)
      const rowTotalWidth = widths.reduce((sum, width) => sum + width, 0)
      const used = rowTotalWidth + previewGap * (count - 1)
      emptySpace += Math.abs(containerWidth - used)
      targetDeviation += Math.abs(targetRowHeight - clampedHeight)
      if (rowHeight !== clampedHeight) {
        outOfRangePenalty += Math.abs(rowHeight - clampedHeight) * 6
      }

      rows.push({
        gap: previewGap,
        height: clampedHeight,
        tiles: chunk.map((item) => ({
          photo: item.photo,
          width: item.ratio * clampedHeight,
        })),
      })
    }

    const score = emptySpace + targetDeviation * 1.4 + outOfRangePenalty
    if (!best || score < best.score) {
      best = { score, rows }
    }
  }

  if (!best) {
    const height = 160
    return {
      rows: [{
        gap: previewGap,
        height,
        tiles: items.map((item) => ({ photo: item.photo, width: item.ratio * height })),
      }],
    }
  }

  return { rows: best.rows }
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
    map[seriesId] = buildPreviewRows(photos, width)
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
  selectedTags.value = []
  dateFrom.value = ''
  dateTo.value = ''
  selectedAuthorId.value = ''
  authorSearchInput.value = ''
  showAuthorSuggestions.value = false
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
  loadPublicSeries(1)
}

function applyAuthorSuggestion() {
  if (!authorSuggestions.value.length) {
    if (!authorSearchInput.value.trim() && selectedAuthorId.value) {
      selectedAuthorId.value = ''
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
  loadPublicSeries(1)
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

    if (activeSort.value !== 'new') {
      params.sort = activeSort.value
    }

    const { data } = await api.get('/public/series', { params })

    series.value = Array.isArray(data?.data) ? data.data : []
    page.value = Number(data?.current_page || targetPage)
    lastPage.value = Number(data?.last_page || 1)
    availableTags.value = Array.isArray(data?.available_tags)
      ? data.available_tags.map((tag) => String(tag?.name || '').trim()).filter(Boolean)
      : []
    availableAuthors.value = Array.isArray(data?.authors) ? data.authors : []
    suggestedAuthors.value = Array.isArray(data?.author_suggestions) ? data.author_suggestions : []
    previewVersion.value = Date.now()
  } catch (e) {
    error.value = e?.response?.data?.message || 'Failed to load public series.'
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

onMounted(() => {
  previewResizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const matched = Array.from(previewGridElements.entries()).find(([, element]) => element === entry.target)
      if (!matched) {
        return
      }

      const [seriesId] = matched
      previewGridWidths.value = {
        ...previewGridWidths.value,
        [seriesId]: entry.contentRect.width,
      }
    })
  })
})

onBeforeUnmount(() => {
  if (previewResizeObserver) {
    previewResizeObserver.disconnect()
    previewResizeObserver = null
  }

  if (authorSuggestBlurTimerId !== null) {
    clearTimeout(authorSuggestBlurTimerId)
    authorSuggestBlurTimerId = null
  }

  previewGridElements.clear()
})

watch(
  seriesPreviews,
  (map) => {
    Object.values(map).forEach((photos) => {
      photos.forEach((photo) => {
        ensurePreviewRatio(photo)
      })
    })
  },
  { immediate: true },
)

loadPublicSeries()
</script>

<template>
  <div class="public-page">
    <div class="public-shell">
      <header class="public-header">
        <h1>Публичные серии</h1>
      </header>

      <div class="public-layout">
        <aside class="filters-panel">
          <section class="filter-group">
            <h3>Поиск</h3>
            <form class="search-form" @submit.prevent="submitSearch">
              <input v-model="searchInput" type="text" placeholder="Название или описание" />
              <button type="submit" class="ghost-btn">Найти</button>
            </form>
          </section>

          <section class="filter-group">
            <h3>Автор</h3>
            <div class="author-search-wrap">
              <input
                v-model="authorSearchInput"
                type="text"
                class="author-search-input"
                placeholder="Начните вводить имя автора..."
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
                      {{ author.series_count }} за {{ author.period_days }} дн.
                    </small>
                  </button>
                </li>
              </ul>
              <p
                v-else-if="showAuthorSuggestions && authorSearchInput.trim() && !authorSuggestions.length"
                class="author-suggest-empty"
              >
                Ничего не найдено
              </p>
            </div>
            <button
              v-if="selectedAuthorId || authorSearchInput.trim()"
              type="button"
              class="ghost-btn author-reset-btn"
              @click="clearAuthorFilter"
            >
              Все авторы
            </button>
          </section>

          <section class="filter-group">
            <h3>Теги</h3>
            <div class="chip-row">
              <button
                v-for="tag in availableTags"
                :key="tag"
                type="button"
                class="chip"
                :class="{ active: selectedTags.includes(tag) }"
                @click="toggleTag(tag)"
              >
                #{{ tag }}
              </button>
            </div>
          </section>

          <section class="filter-group">
            <h3>Дата</h3>
            <label class="date-label">
              От
              <input v-model="dateFrom" type="date" @change="loadPublicSeries(1)" />
            </label>
            <label class="date-label">
              До
              <input v-model="dateTo" type="date" @change="loadPublicSeries(1)" />
            </label>
          </section>

          <section class="filter-group">
            <h3>Сортировка</h3>
            <div class="chip-row">
              <button type="button" class="chip" :class="{ active: activeSort === 'new' }" @click="activeSort = 'new'; loadPublicSeries(1)">
                Новые
              </button>
              <button type="button" class="chip" :class="{ active: activeSort === 'old' }" @click="activeSort = 'old'; loadPublicSeries(1)">
                Старые
              </button>
            </div>
          </section>

          <button v-if="hasActiveFilters" type="button" class="ghost-btn reset-btn" @click="resetFilters">
            Сбросить фильтры
          </button>
        </aside>

        <main class="content-panel">
          <p v-if="loading" class="state-text">Загрузка...</p>
          <p v-else-if="error" class="error">{{ error }}</p>
          <p v-else-if="!series.length" class="state-text">Публичные серии не найдены.</p>

          <section v-else class="series-grid">
            <article v-for="item in series" :key="item.id" class="series-card">
              <header class="series-card-header">
                <h2>{{ item.title }}</h2>
                <RouterLink class="view-link" :to="`/series/${item.id}`">Открыть</RouterLink>
              </header>

              <div class="series-meta">
                <span>{{ formatDate(item.created_at) }}</span>
                <span>{{ item.photos_count }} фото</span>
                <span v-if="item.owner_name">Автор: {{ item.owner_name }}</span>
              </div>

              <p class="series-desc">{{ item.description || 'Описание пока не добавлено.' }}</p>

              <div
                v-if="previewTiles(item.id).length"
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
                    :style="{ width: `${tile.width}px`, height: `${row.height || 0}px` }"
                  >
                    <img
                      class="preview-tile-image"
                      :src="tile.photo.src"
                      :alt="tile.photo.alt"
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

              <div v-if="(item.tags || []).length" class="tags">
                <span v-for="tag in item.tags" :key="tag.id" class="tag-chip">#{{ tag.name }}</span>
              </div>
            </article>
          </section>

          <div class="pager" v-if="!loading && !error && lastPage > 1">
            <button type="button" class="ghost-btn" :disabled="page <= 1" @click="goToPage(page - 1)">Назад</button>
            <span>Страница {{ page }} / {{ lastPage }}</span>
            <button type="button" class="ghost-btn" :disabled="page >= lastPage" @click="goToPage(page + 1)">Вперёд</button>
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

.series-desc {
  margin: 10px 0;
  font-size: 17px;
  color: #4b574f;
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
}

.preview-tile-image {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: block;
  border-radius: 8px;
  border: 1px solid rgba(125, 134, 128, 0.25);
  background: #eef2ec;
  object-fit: contain;
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

  .filters-panel {
    border-right: 0;
    border-bottom: 1px solid #dde0d9;
  }

  .series-card h2 {
    font-size: 26px;
  }
}
</style>
