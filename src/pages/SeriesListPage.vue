<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from '../lib/api'
import { optimizeImagesForUpload } from '../lib/imageOptimizer'
import { getUser, setCurrentUser } from '../lib/session'

const series = ref([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const lastPage = ref(1)
const seriesPreviews = ref({})
const currentUser = ref(getUser())
const previewGridWidths = ref({})
const previewAspectRatios = ref({})
const previewGridElements = new Map()
let previewResizeObserver = null

const search = ref('')
const activeSort = ref('new')
const selectedTags = ref([])
const dateFrom = ref('')
const dateTo = ref('')
const selectedCalendarDate = ref('')
const rangeFromText = ref('')
const rangeToText = ref('')
const nativeFromInput = ref(null)
const nativeToInput = ref(null)
const showCreateForm = ref(false)
const calendarMonthCursor = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

const createTitle = ref('')
const createDescription = ref('')
const createFiles = ref([])
const createFilesInput = ref(null)
const creating = ref(false)
const createError = ref('')
const createWarnings = ref([])
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_RAW_FILE_SIZE_BYTES = 25 * 1024 * 1024

const journalTitle = computed(() => {
  const title = currentUser.value?.journal_title
  return typeof title === 'string' && title.trim() ? title.trim() : 'Фото Дневник'
})

const availableTags = computed(() => {
  const tags = new Set()

  series.value.forEach((item) => {
    ;(item.tags || []).forEach((tag) => {
      const name = String(tag?.name || '').trim().toLowerCase()
      if (name) tags.add(name)
    })
  })

  return Array.from(tags).sort((a, b) => a.localeCompare(b))
})

function toLocalDateKey(input) {
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const seriesDateKeys = computed(() => {
  const keys = new Set()

  series.value.forEach((item) => {
    if (!item.created_at) {
      return
    }

    const key = toLocalDateKey(item.created_at)
    if (!key) return
    keys.add(key)
  })

  return keys
})

const calendarMonthLabel = computed(() =>
  new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(calendarMonthCursor.value)
)

const calendarCells = computed(() => {
  const cursor = calendarMonthCursor.value
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const first = new Date(year, month, 1)
  const firstWeekday = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push({ key: `empty-${i}`, empty: true })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day)
    const key = toLocalDateKey(date)
    cells.push({
      key,
      empty: false,
      day,
      iso: key,
      hasSeries: seriesDateKeys.value.has(key),
    })
  }

  return cells
})

const filteredSeries = computed(() => {
  const query = search.value.trim().toLowerCase()

  const result = series.value.filter((item) => {
    const haystack = `${item.title || ''} ${item.description || ''}`.toLowerCase()
    const queryMatch = !query || haystack.includes(query)

    const created = new Date(item.created_at || 0)
    const createdTime = created.getTime()
    let dateMatch = Number.isFinite(createdTime)

    if (selectedCalendarDate.value) {
      const from = new Date(`${selectedCalendarDate.value}T00:00:00`).getTime()
      const to = new Date(`${selectedCalendarDate.value}T23:59:59.999`).getTime()
      dateMatch = dateMatch && createdTime >= from && createdTime <= to
    } else {
      const fromTime = dateFrom.value ? new Date(`${dateFrom.value}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY
      const toTime = dateTo.value ? new Date(`${dateTo.value}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY
      dateMatch = dateMatch && createdTime >= Math.min(fromTime, toTime) && createdTime <= Math.max(fromTime, toTime)
    }

    const seriesTags = new Set((item.tags || []).map((tag) => String(tag?.name || '').trim().toLowerCase()).filter(Boolean))
    const tagsMatch =
      selectedTags.value.length === 0 ||
      selectedTags.value.every((tag) => seriesTags.has(tag))

    return queryMatch && dateMatch && tagsMatch
  })

  result.sort((a, b) => {
    const timeA = new Date(a.created_at || 0).getTime()
    const timeB = new Date(b.created_at || 0).getTime()
    return activeSort.value === 'new' ? timeB - timeA : timeA - timeB
  })

  return result
})

function onCreateFilesChanged(event) {
  const files = Array.from(event.target.files || [])
  const invalid = files.find((file) => file.size > MAX_RAW_FILE_SIZE_BYTES || !ALLOWED_TYPES.includes(file.type))

  if (invalid) {
    createError.value = `File "${invalid.name}" is invalid. Use JPG/PNG/WEBP up to 25MB.`
    createFiles.value = []
    event.target.value = ''
    return
  }

  createError.value = ''
  createFiles.value = files
}

function formatValidationError(err) {
  const fallback = err?.response?.data?.message || 'Request failed.'
  const errors = err?.response?.data?.errors

  if (!errors) {
    return fallback
  }

  const lines = Object.values(errors)
    .flat()
    .filter(Boolean)

  if (!lines.length) {
    return fallback
  }

  return `${fallback} ${lines.join(' ')}`
}

function formatDate(value) {
  if (!value) {
    return 'No date'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'No date'
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function apiOrigin() {
  const base = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8091/api/v1'
  return base.replace(/\/api\/v1\/?$/, '')
}

function photoUrl(path) {
  if (!path) {
    return ''
  }

  return `${apiOrigin()}/storage/${path}`
}

function previewTiles(seriesId) {
  return seriesPreviews.value[seriesId] || []
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
  const items = photos.map((photo) => ({
    photo,
    ratio: previewAspectRatios.value[photo.id] || 1,
  }))

  if (!items.length) {
    return { height: 0, rows: [] }
  }

  if (items.length === 1) {
    const ratio = items[0].ratio || 1
    const height = Math.max(120, Math.min(240, containerWidth / ratio))
    return {
      height,
      rows: [{ gap: 0, tiles: [{ photo: items[0].photo, width: ratio * height }] }],
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
    const maxAllowedHeight = Math.min(...rowHeights)
    const averageHeight = rowHeights.reduce((sum, value) => sum + value, 0) / rowHeights.length
    const height = Math.max(96, Math.min(260, averageHeight, maxAllowedHeight))

    const rows = []
    cursor = 0
    let emptySpace = 0

    for (let rowIndex = 0; rowIndex < counts.length; rowIndex += 1) {
      const count = counts[rowIndex]
      const chunk = items.slice(cursor, cursor + count)
      cursor += count
      const widths = chunk.map((item) => item.ratio * height)
      const used = widths.reduce((sum, width) => sum + width, 0) + previewGap * (count - 1)
      emptySpace += Math.max(0, containerWidth - used)
      const rowTotalWidth = widths.reduce((sum, width) => sum + width, 0)
      const dynamicGap = count > 1 ? Math.max(0, (containerWidth - rowTotalWidth) / (count - 1)) : 0

      rows.push(
        {
          gap: dynamicGap,
          tiles: chunk.map((item) => ({
            photo: item.photo,
            width: item.ratio * height,
          })),
        }
      )
    }

    const score = emptySpace + Math.abs(170 - height) * 3
    if (!best || score < best.score) {
      best = { score, height, rows }
    }
  }

  if (!best) {
    const height = 160
    return {
      height,
      rows: [{
        gap: 0,
        tiles: items.map((item) => ({ photo: item.photo, width: item.ratio * height })),
      }],
    }
  }

  return { height: best.height, rows: best.rows }
}

function previewRows(seriesId) {
  const photos = previewTiles(seriesId)
  const width = previewGridWidths.value[seriesId] || 920
  return buildPreviewRows(photos, width)
}

function toggleTag(tag) {
  if (selectedTags.value.includes(tag)) {
    selectedTags.value = selectedTags.value.filter((item) => item !== tag)
    return
  }

  selectedTags.value = [...selectedTags.value, tag]
}

function shiftCalendarMonth(offset) {
  const current = calendarMonthCursor.value
  calendarMonthCursor.value = new Date(current.getFullYear(), current.getMonth() + offset, 1)
}

function pickCalendarDate(iso) {
  selectedCalendarDate.value = iso
  dateFrom.value = ''
  dateTo.value = ''
  rangeFromText.value = ''
  rangeToText.value = ''
}

function isDateInRange(iso) {
  return selectedCalendarDate.value === iso
}

function clearDateRange() {
  dateFrom.value = ''
  dateTo.value = ''
  rangeFromText.value = ''
  rangeToText.value = ''
  selectedCalendarDate.value = ''
}

function formatIsoToShort(iso) {
  if (!iso) return ''
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year.slice(-2)}`
}

function parseShortDate(value) {
  const clean = value.trim()
  if (!clean) return ''

  const match = clean.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  let year = Number(match[3])

  if (match[3].length === 2) {
    year += 2000
  }

  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function applyRangeInput(field) {
  const raw = field === 'from' ? rangeFromText.value : rangeToText.value
  const parsed = parseShortDate(raw)

  if (parsed === null) {
    if (field === 'from') rangeFromText.value = dateFrom.value ? formatIsoToShort(dateFrom.value) : ''
    if (field === 'to') rangeToText.value = dateTo.value ? formatIsoToShort(dateTo.value) : ''
    return
  }

  if (field === 'from') {
    dateFrom.value = parsed
    rangeFromText.value = parsed ? formatIsoToShort(parsed) : ''
  }

  if (field === 'to') {
    dateTo.value = parsed
    rangeToText.value = parsed ? formatIsoToShort(parsed) : ''
  }

  selectedCalendarDate.value = ''
}

function openNativePicker(field) {
  const input = field === 'from' ? nativeFromInput.value : nativeToInput.value
  if (!input) return

  if (typeof input.showPicker === 'function') {
    input.showPicker()
    return
  }

  input.focus()
}

function onNativeRangePicked(field, event) {
  const value = event?.target?.value || ''
  if (!value) return

  if (field === 'from') {
    dateFrom.value = value
  } else {
    dateTo.value = value
  }

  selectedCalendarDate.value = ''
}

watch(dateFrom, (value) => {
  rangeFromText.value = value ? formatIsoToShort(value) : ''
})

watch(dateTo, (value) => {
  rangeToText.value = value ? formatIsoToShort(value) : ''
})

async function loadSeriesPreviews(items) {
  if (!items.length) {
    seriesPreviews.value = {}
    return
  }

  const entries = await Promise.all(items.map(async (entry) => {
    try {
      const { data } = await api.get(`/series/${entry.id}`, {
        params: {
          include_photos: 1,
          photos_limit: Math.min(entry.photos_count || 30, 30),
        },
      })

      const photos = (data?.data?.photos || [])
        .map((photo) => ({
          id: photo.id,
          src: photo.preview_url || photoUrl(photo.path),
          alt: photo.original_name || `photo-${photo.id}`,
        }))
        .filter((photo) => photo.src)

      return [entry.id, photos]
    } catch (_) {
      return [entry.id, []]
    }
  }))

  seriesPreviews.value = Object.fromEntries(entries)
  const photos = Object.values(seriesPreviews.value).flat()
  await Promise.all(photos.map((photo) => ensurePreviewRatio(photo)))
}

async function createSeries() {
  createError.value = ''
  createWarnings.value = []

  if (!createTitle.value.trim()) {
    createError.value = 'Title is required.'
    return
  }

  if (!createFiles.value.length) {
    createError.value = 'Please select at least one photo.'
    return
  }

  creating.value = true

  try {
    const { files: optimizedFiles, warnings } = await optimizeImagesForUpload(createFiles.value, {
      maxBytes: 2 * 1024 * 1024,
      maxDimension: 2560,
    })

    createWarnings.value = warnings

    if (!optimizedFiles.length) {
      createError.value = 'No files left after optimization.'
      return
    }

    const formData = new FormData()
    formData.append('title', createTitle.value)

    if (createDescription.value.trim()) {
      formData.append('description', createDescription.value)
    }

    for (const file of optimizedFiles) {
      formData.append('photos[]', file)
    }

    const { data } = await api.post('/series', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })

    createWarnings.value = [...warnings, ...(data.photos_failed || [])]
    createTitle.value = ''
    createDescription.value = ''
    createFiles.value = []
    showCreateForm.value = false

    if (createFilesInput.value) {
      createFilesInput.value.value = ''
    }

    await loadSeries(1)
  } catch (e) {
    createError.value = formatValidationError(e)
  } finally {
    creating.value = false
  }
}

async function loadSeries(targetPage = 1) {
  loading.value = true
  error.value = ''

  try {
    const { data } = await api.get('/series', {
      params: {
        per_page: 10,
        page: targetPage,
      },
    })

    series.value = data.data || []
    page.value = data.current_page || targetPage
    lastPage.value = data.last_page || 1
    await loadSeriesPreviews(series.value)
  } catch (e) {
    error.value = e?.response?.data?.message || 'Failed to load series.'
  } finally {
    loading.value = false
  }
}

async function loadProfileMeta() {
  try {
    const { data } = await api.get('/profile')
    const user = data?.data || null

    if (!user) {
      return
    }

    currentUser.value = user
    setCurrentUser(user)
  } catch (_) {
    // Keep default title when profile metadata is unavailable.
  }
}

onMounted(() => {
  previewResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const matched = Array.from(previewGridElements.entries()).find(([, element]) => element === entry.target)
      if (!matched) {
        continue
      }

      const [seriesId] = matched
      previewGridWidths.value = {
        ...previewGridWidths.value,
        [seriesId]: entry.contentRect.width,
      }
    }
  })

  loadSeries(1)
  loadProfileMeta()
})

onBeforeUnmount(() => {
  if (previewResizeObserver) {
    previewResizeObserver.disconnect()
    previewResizeObserver = null
  }
  previewGridElements.clear()
})
</script>

<template>
  <div class="journal-page">
    <div class="journal-shell">
      <header class="journal-header">
        <h1>{{ journalTitle }}</h1>

        <div class="header-actions">
          <button type="button" class="primary-btn" @click="showCreateForm = !showCreateForm">
            {{ showCreateForm ? 'Закрыть форму' : 'Новая серия' }}
          </button>
        </div>
      </header>

      <div class="journal-body">
        <aside class="filters-panel">
          <h2>Фильтры</h2>

          <section class="filter-group">
            <h3>Дата</h3>
            <div class="filter-row filter-range">
              <label class="filter-label">
                <span>От</span>
                <div class="range-input-wrap">
                  <input
                    v-model="rangeFromText"
                    type="text"
                    inputmode="numeric"
                    placeholder="дд.мм.гг"
                    @blur="applyRangeInput('from')"
                  />
                  <button type="button" class="range-picker-btn" @click="openNativePicker('from')">📅</button>
                  <input
                    ref="nativeFromInput"
                    type="date"
                    class="native-picker-proxy"
                    @change="onNativeRangePicked('from', $event)"
                  />
                </div>
              </label>
              <label class="filter-label">
                <span>До</span>
                <div class="range-input-wrap">
                  <input
                    v-model="rangeToText"
                    type="text"
                    inputmode="numeric"
                    placeholder="дд.мм.гг"
                    @blur="applyRangeInput('to')"
                  />
                  <button type="button" class="range-picker-btn" @click="openNativePicker('to')">📅</button>
                  <input
                    ref="nativeToInput"
                    type="date"
                    class="native-picker-proxy"
                    @change="onNativeRangePicked('to', $event)"
                  />
                </div>
              </label>
            </div>

            <div class="chip-row filter-row">
              <button type="button" class="chip" @click="clearDateRange">Очистить диапазон</button>
            </div>

            <div class="filter-row calendar-widget">
              <div class="calendar-head">
                <button type="button" class="chip calendar-nav" @click="shiftCalendarMonth(-1)">←</button>
                <strong>{{ calendarMonthLabel }}</strong>
                <button type="button" class="chip calendar-nav" @click="shiftCalendarMonth(1)">→</button>
              </div>
              <div class="calendar-weekdays">
                <span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span>
              </div>
              <div class="calendar-grid">
                <button
                  v-for="cell in calendarCells"
                  :key="cell.key"
                  type="button"
                  class="calendar-day"
                  :class="{ empty: cell.empty, selected: !cell.empty && isDateInRange(cell.iso) }"
                  :disabled="cell.empty"
                  @click="!cell.empty && pickCalendarDate(cell.iso)"
                >
                  <span>{{ cell.day }}</span>
                  <i v-if="!cell.empty && cell.hasSeries" class="calendar-dot"></i>
                </button>
              </div>
            </div>
          </section>

          <section class="filter-group">
            <h3>Теги</h3>
            <div class="chip-row chips-wrap">
              <button
                v-for="tag in availableTags"
                :key="tag"
                type="button"
                class="tag-chip"
                :class="{ active: selectedTags.includes(tag) }"
                @click="toggleTag(tag)"
              >
                #{{ tag }}
              </button>
              <span v-if="!availableTags.length" class="hint">Нет тегов</span>
            </div>
          </section>

          <section class="filter-group">
            <h3>Сортировка</h3>
            <div class="chip-row">
              <button type="button" class="chip" :class="{ active: activeSort === 'new' }" @click="activeSort = 'new'">
                Новые
              </button>
              <button type="button" class="chip" :class="{ active: activeSort === 'old' }" @click="activeSort = 'old'">
                Старые
              </button>
            </div>
          </section>
        </aside>

        <main class="content-panel">
          <section v-if="showCreateForm" class="create-card">
            <h2>Новая серия</h2>

            <form class="form" @submit.prevent="createSeries">
              <label>
                Название
                <input v-model="createTitle" type="text" maxlength="255" required />
              </label>

              <label>
                Описание
                <textarea v-model="createDescription" rows="3"></textarea>
              </label>

              <label>
                Фотографии
                <input
                  ref="createFilesInput"
                  name="photos[]"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  multiple
                  @change="onCreateFilesChanged"
                />
              </label>
              <small class="hint">Оптимизация перед отправкой: до 2MB на файл.</small>
              <small class="hint" v-if="createFiles.length">Выбрано: {{ createFiles.length }} файл(ов)</small>

              <p v-if="createError" class="error">{{ createError }}</p>

              <ul v-if="createWarnings.length" class="warnings">
                <li v-for="(warning, index) in createWarnings" :key="index">
                  {{ warning.original_name }}: {{ warning.message }}
                </li>
              </ul>

              <button type="submit" class="primary-btn" :disabled="creating">
                {{ creating ? 'Сохраняем...' : 'Создать серию' }}
              </button>
            </form>
          </section>

          <section class="search-row">
            <input v-model="search" type="text" placeholder="Искать по названию и описанию..." />
          </section>

          <p v-if="loading" class="state-text">Загрузка...</p>
          <p v-else-if="error" class="error">{{ error }}</p>
          <p v-else-if="!filteredSeries.length" class="state-text">Серии не найдены.</p>

          <div v-else class="series-grid">
            <article v-for="item in filteredSeries" :key="item.id" class="series-card">
              <header class="series-card-header">
                <h3>
                  <RouterLink class="series-title-link" :to="`/series/${item.id}`">
                    {{ item.title }}
                  </RouterLink>
                </h3>
                <RouterLink class="view-link" :to="`/series/${item.id}`">Открыть</RouterLink>
              </header>

              <div class="series-meta">
                <span>{{ formatDate(item.created_at) }}</span>
                <span>{{ item.photos_count }} фото</span>
              </div>

              <p class="series-desc">{{ item.description || 'Описание пока не добавлено.' }}</p>

              <div
                v-if="previewTiles(item.id).length"
                :ref="(element) => setPreviewGridRef(item.id, element)"
                class="preview-grid"
              >
                <div
                  v-for="(row, rowIndex) in previewRows(item.id).rows"
                  :key="`${item.id}-${rowIndex}`"
                  class="preview-row"
                  :style="{ columnGap: `${row.gap}px` }"
                >
                  <div
                    v-for="tile in row.tiles"
                    :key="tile.photo.id"
                    class="preview-tile"
                    :style="{ width: `${tile.width}px`, height: `${previewRows(item.id).height}px` }"
                  >
                    <img
                      class="preview-tile-image"
                      :src="tile.photo.src"
                      :alt="tile.photo.alt"
                    />
                  </div>
                </div>
              </div>
            </article>
          </div>

          <div class="pager" v-if="!loading && !error && lastPage > 1">
            <button type="button" class="ghost-btn" :disabled="page <= 1" @click="loadSeries(page - 1)">Назад</button>
            <span>Страница {{ page }} / {{ lastPage }}</span>
            <button type="button" class="ghost-btn" :disabled="page >= lastPage" @click="loadSeries(page + 1)">Вперёд</button>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
.journal-page {
  --bg: #e8e9e6;
  --panel: #f4f5f2;
  --line: #dde0d9;
  --text: #313a35;
  --muted: #748077;
  --accent: #5d9776;
  --accent-soft: #ddeee4;
  --chip: #edf1ec;
  min-height: calc(100vh - 72px);
  padding: 24px 8px 36px;
  background:
    radial-gradient(700px 220px at 15% 0%, rgba(183, 201, 190, 0.35), transparent 65%),
    radial-gradient(860px 260px at 100% 15%, rgba(218, 206, 188, 0.28), transparent 70%),
    var(--bg);
  color: var(--text);
  font-family: 'Manrope', 'Trebuchet MS', 'Verdana', sans-serif;
}

.journal-shell {
  max-width: 1260px;
  margin: 0 auto;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--panel);
  box-shadow: 0 20px 40px rgba(79, 86, 80, 0.1);
  overflow: hidden;
}

.journal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 22px;
  border-bottom: 1px solid var(--line);
}

.journal-header h1 {
  margin: 0;
  font-size: 36px;
  letter-spacing: -0.03em;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.journal-body {
  display: grid;
  grid-template-columns: 300px 1fr;
}

.filters-panel {
  border-right: 1px solid var(--line);
  padding: 20px;
}

.filters-panel h2 {
  margin: 0 0 20px;
  font-size: 28px;
}

.filter-group {
  padding: 14px 0 18px;
  border-bottom: 1px solid var(--line);
}

.filter-group h3 {
  margin: 0 0 10px;
  font-size: 19px;
}

.chip-row {
  display: flex;
  gap: 8px;
}

.filter-row {
  margin-top: 10px;
}

.filter-label {
  display: grid;
  gap: 4px;
  color: var(--muted);
  font-size: 13px;
}

.filter-label input {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f9faf8;
  color: var(--text);
  padding: 8px 9px;
  font-size: 14px;
}

.filter-label input::placeholder {
  color: #aeb7ad;
}

.filter-range {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.range-input-wrap {
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  align-items: center;
}

.range-picker-btn {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f2f5f0;
  cursor: pointer;
  padding: 7px 9px;
  line-height: 1;
}

.native-picker-proxy {
  position: absolute;
  inset: 0;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.calendar-widget {
  border-top: 1px dashed var(--line);
  padding-top: 10px;
}

.calendar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.calendar-head strong {
  text-transform: capitalize;
  font-size: 14px;
}

.calendar-nav {
  padding: 6px 9px;
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
  margin-bottom: 4px;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}

.calendar-day {
  border: 1px solid var(--line);
  background: #f9faf8;
  border-radius: 6px;
  min-height: 34px;
  padding: 4px 0 2px;
  display: grid;
  justify-items: center;
  align-content: center;
  cursor: pointer;
  color: var(--text);
  font-size: 12px;
}

.calendar-day.empty {
  visibility: hidden;
}

.calendar-day.selected {
  background: var(--accent-soft);
  border-color: #87ad98;
}

.calendar-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: #4f8366;
  display: block;
  margin-top: 1px;
}

.chips-wrap {
  flex-wrap: wrap;
}

.chip,
.tag-chip,
.sort-box {
  border: 0;
  border-radius: 8px;
  background: var(--chip);
  color: var(--text);
  padding: 9px 12px;
  font-size: 14px;
}

.chip {
  cursor: pointer;
}

.tag-chip {
  cursor: pointer;
}

.chip.active {
  background: var(--accent-soft);
  color: #3f6d56;
}

.tag-chip.active {
  background: var(--accent-soft);
  color: #3f6d56;
}

.content-panel {
  padding: 20px;
}

.create-card {
  background: #fbfcfa;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 12px;
}

.create-card h2 {
  margin: 0 0 10px;
  font-size: 22px;
}

.form {
  display: grid;
  gap: 10px;
}

.form input,
.form textarea {
  width: 100%;
  box-sizing: border-box;
  margin-top: 4px;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}

.search-row {
  margin-bottom: 14px;
}

.search-row input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #f9faf8;
  padding: 12px 14px;
  font-size: 16px;
}

.series-grid {
  display: grid;
  gap: 14px;
}

.series-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fbfcfa;
  padding: 14px;
}

.series-card-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

.series-card h3 {
  margin: 0;
  font-size: 38px;
  line-height: 1;
  letter-spacing: -0.03em;
}

.series-title-link {
  color: inherit;
  text-decoration: none;
}

.series-title-link:hover {
  text-decoration: underline;
}

.view-link {
  color: #3f6d56;
  text-decoration: none;
  font-weight: 700;
}

.view-link:hover {
  text-decoration: underline;
}

.series-meta {
  margin-top: 7px;
  display: flex;
  gap: 14px;
  color: var(--muted);
  font-size: 14px;
}

.series-desc {
  margin: 12px 0;
  color: #4b574f;
  font-size: 18px;
}

.preview-grid {
  margin-top: 10px;
  width: 100%;
  display: grid;
  gap: 8px;
}

.preview-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 0;
  width: 100%;
}

.preview-tile {
  flex: 0 0 auto;
  overflow: hidden;
}

.preview-tile-image {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 8px;
  border: 1px solid rgba(125, 134, 128, 0.25);
  background: #eef2ec;
  object-fit: contain;
}

.pager {
  margin-top: 14px;
  display: flex;
  gap: 8px;
  align-items: center;
}

.hint {
  color: var(--muted);
}

.error {
  color: #9f2f2f;
}

.warnings {
  margin: 0;
  padding-left: 16px;
  color: #87520b;
}

.state-text {
  color: var(--muted);
}

.primary-btn,
.ghost-btn {
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  font-weight: 700;
  padding: 10px 14px;
}

.primary-btn {
  background: var(--accent);
  color: #eff7f2;
}

.primary-btn:hover {
  background: #4f8366;
}

.primary-btn:disabled,
.ghost-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ghost-btn {
  background: var(--chip);
  color: var(--text);
}

@media (max-width: 1100px) {
  .journal-body {
    grid-template-columns: 1fr;
  }

  .filters-panel {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
}

@media (max-width: 720px) {
  .journal-page {
    padding: 12px 0 20px;
  }

  .journal-shell {
    border-radius: 0;
  }

  .journal-header {
    padding: 14px;
    align-items: start;
    gap: 12px;
    flex-direction: column;
  }

  .journal-header h1 {
    font-size: 30px;
  }

  .series-card h3 {
    font-size: 30px;
  }

}
</style>
