<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { optimizeImagesForUpload } from '../lib/imageOptimizer'
import { getUser, setCurrentUser } from '../lib/session'

const series = ref([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const lastPage = ref(1)
const loadedPage = ref(0)
const seriesPreviews = ref({})
const currentUser = ref(getUser())
const calendarMarkedDateKeys = ref([])
const fetchedTags = ref([])
const previewGridWidths = ref({})
const previewAspectRatios = ref({})
const previewGridElements = new Map()
let previewResizeObserver = null
let searchDebounceTimer = null
let loadSeriesRequestId = 0
let loadCalendarMarksRequestId = 0
let skipNextRouteReload = false
const syncingQueryState = ref(false)
const calendarMarksCache = new Map()

const route = useRoute()
const router = useRouter()

const search = ref('')
const searchInput = ref('')
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
const showMobileFilters = ref(false)
const TAG_ROWS_INITIAL = 4
const TAG_ROWS_STEP = 10
const visibleTagRows = ref(TAG_ROWS_INITIAL)
const tagRowsTotal = ref(0)
const tagVisibleHeight = ref(0)
const tagsCloudRef = ref(null)
let tagsLayoutObserver = null

const journalTitle = computed(() => {
  const title = currentUser.value?.journal_title
  return typeof title === 'string' && title.trim() ? title.trim() : 'Фото Дневник'
})

const availableTags = computed(() => {
  const tags = new Set()

  fetchedTags.value.forEach((name) => {
    const normalized = String(name || '').trim()
    if (normalized) tags.add(normalized)
  })

  series.value.forEach((item) => {
    ;(item.tags || []).forEach((tag) => {
      const name = String(tag?.name || '').trim()
      if (name) tags.add(name)
    })
  })

  selectedTags.value.forEach((name) => {
    const normalized = String(name || '').trim()
    if (normalized) tags.add(normalized)
  })

  return Array.from(tags).sort((a, b) => a.localeCompare(b))
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
    '--tags-visible-height': `${tagVisibleHeight.value}px`,
  }
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

const seriesDateKeys = computed(() => new Set(calendarMarkedDateKeys.value))

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

function buildQueryState() {
  const query = {}

  const searchValue = search.value.trim()
  if (searchValue) query.search = searchValue

  if (selectedTags.value.length) {
    query.tag = selectedTags.value.join(',')
  }

  if (selectedCalendarDate.value) {
    query.date = selectedCalendarDate.value
  } else {
    if (dateFrom.value) query.date_from = dateFrom.value
    if (dateTo.value) query.date_to = dateTo.value
  }

  if (activeSort.value !== 'new') {
    query.sort = activeSort.value
  }

  if (page.value > 1) {
    query.page = String(page.value)
  }

  return query
}

function applyRouteQuery(query) {
  syncingQueryState.value = true
  try {
    const nextSearch = typeof query.search === 'string' ? query.search : ''
    search.value = nextSearch
    searchInput.value = nextSearch

    const nextSort = typeof query.sort === 'string' && ['new', 'old'].includes(query.sort) ? query.sort : 'new'
    activeSort.value = nextSort

    const tags = typeof query.tag === 'string'
      ? query.tag.split(',').map((item) => item.trim()).filter(Boolean)
      : []
    selectedTags.value = tags

    const pickedDate = typeof query.date === 'string' ? query.date : ''
    selectedCalendarDate.value = pickedDate
    dateFrom.value = pickedDate ? '' : (typeof query.date_from === 'string' ? query.date_from : '')
    dateTo.value = pickedDate ? '' : (typeof query.date_to === 'string' ? query.date_to : '')

    const nextPage = Number.parseInt(String(query.page || '1'), 10)
    page.value = Number.isFinite(nextPage) && nextPage > 0 ? nextPage : 1
  } finally {
    syncingQueryState.value = false
  }
}

function syncStateToQuery() {
  if (syncingQueryState.value) return

  const nextQuery = buildQueryState()
  const currentQuery = route.query || {}

  const currentNormalized = JSON.stringify(Object.keys(currentQuery).sort().reduce((acc, key) => {
    acc[key] = currentQuery[key]
    return acc
  }, {}))
  const nextNormalized = JSON.stringify(Object.keys(nextQuery).sort().reduce((acc, key) => {
    acc[key] = nextQuery[key]
    return acc
  }, {}))

  if (currentNormalized === nextNormalized) {
    return
  }

  skipNextRouteReload = true
  router.replace({ query: nextQuery }).catch(() => {
    skipNextRouteReload = false
  })
}

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

function extractSeriesDateKeys(items) {
  const keys = new Set()

  ;(items || []).forEach((item) => {
    if (!item?.created_at) {
      return
    }

    const key = toLocalDateKey(item.created_at)
    if (key) {
      keys.add(key)
    }
  })

  return keys
}

function buildCalendarMarksQueryKey() {
  return JSON.stringify({
    search: search.value.trim(),
    tag: selectedTags.value.join(','),
    sort: activeSort.value,
  })
}

async function loadCalendarMarksWithoutDateFilter() {
  const cacheKey = buildCalendarMarksQueryKey()
  if (calendarMarksCache.has(cacheKey)) {
    calendarMarkedDateKeys.value = [...calendarMarksCache.get(cacheKey)]
    return
  }

  const requestId = ++loadCalendarMarksRequestId
  const params = {
    per_page: 100,
    page: 1,
  }

  const searchValue = search.value.trim()
  if (searchValue) {
    params.search = searchValue
  }

  if (selectedTags.value.length) {
    params.tag = selectedTags.value.join(',')
  }

  if (activeSort.value !== 'new') {
    params.sort = activeSort.value
  }

  try {
    const keys = new Set()
    let currentPage = 1
    let last = 1

    while (currentPage <= last) {
      const { data } = await api.get('/series', {
        params: {
          ...params,
          page: currentPage,
        },
      })

      if (requestId !== loadCalendarMarksRequestId) {
        return
      }

      const incoming = extractSeriesDateKeys(data?.data || [])
      for (const key of incoming) {
        keys.add(key)
      }

      const nextLast = Number(data?.last_page || 1)
      last = Number.isFinite(nextLast) && nextLast > 0 ? nextLast : 1
      currentPage += 1
    }

    const result = Array.from(keys)
    calendarMarksCache.set(cacheKey, result)
    calendarMarkedDateKeys.value = result
  } catch (_) {
    // Keep existing calendar marks if background refresh failed.
  }
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
    const nonLastRowGaps = []

    for (let rowIndex = 0; rowIndex < counts.length; rowIndex += 1) {
      const count = counts[rowIndex]
      const chunk = items.slice(cursor, cursor + count)
      cursor += count
      const widths = chunk.map((item) => item.ratio * height)
      const rowTotalWidth = widths.reduce((sum, width) => sum + width, 0)
      const dynamicGap = count > 1 ? Math.max(0, (containerWidth - rowTotalWidth) / (count - 1)) : 0
      const used = rowTotalWidth + dynamicGap * (count - 1)

      if (rowIndex < counts.length - 1) {
        emptySpace += Math.max(0, containerWidth - used)
        if (count > 1) {
          nonLastRowGaps.push(dynamicGap)
        }
      }

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

    if (rows.length > 1) {
      const lastRow = rows[rows.length - 1]
      if (lastRow.tiles.length > 1) {
        const averageGap = nonLastRowGaps.length
          ? nonLastRowGaps.reduce((sum, gap) => sum + gap, 0) / nonLastRowGaps.length
          : previewGap
        lastRow.gap = Math.max(0, averageGap)
      } else {
        lastRow.gap = 0
      }
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

  // Keep first N rows fully visible and show only part of the next row.
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

function shiftCalendarMonth(offset) {
  const current = calendarMonthCursor.value
  calendarMonthCursor.value = new Date(current.getFullYear(), current.getMonth() + offset, 1)
}

function pickCalendarDate(iso) {
  if (selectedCalendarDate.value === iso) {
    selectedCalendarDate.value = ''
    return
  }

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

  const entries = items.map((entry) => {
    const photos = (entry?.preview_photos || [])
      .map((photo) => {
        const signedSrc = typeof photo?.preview_url === 'string' ? photo.preview_url : ''
        const directSrc = photoUrl(photo?.path)
        return {
          id: photo.id,
          src: signedSrc || directSrc || '',
          fallbackSrc: signedSrc && directSrc && signedSrc !== directSrc ? directSrc : '',
          alt: photo.original_name || `photo-${photo.id}`,
        }
      })
      .filter((photo) => photo.src)

    return [entry.id, photos]
  })

  seriesPreviews.value = Object.fromEntries(entries)
  const photos = Object.values(seriesPreviews.value).flat()
  await Promise.all(photos.map((photo) => ensurePreviewRatio(photo)))
}

function onPreviewImageError(event, photo) {
  const target = event?.target
  if (!(target instanceof HTMLImageElement)) {
    return
  }

  const fallback = String(photo?.fallbackSrc || '').trim()
  if (fallback && target.src !== fallback) {
    target.src = fallback
  }
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
  const requestId = ++loadSeriesRequestId
  loading.value = true
  error.value = ''

  try {
    const params = {
      per_page: 10,
      page: targetPage,
    }

    const searchValue = search.value.trim()
    if (searchValue) {
      params.search = searchValue
    }

    if (selectedTags.value.length) {
      params.tag = selectedTags.value.join(',')
    }

    if (selectedCalendarDate.value) {
      params.date_from = selectedCalendarDate.value
      params.date_to = selectedCalendarDate.value
    } else {
      if (dateFrom.value) params.date_from = dateFrom.value
      if (dateTo.value) params.date_to = dateTo.value
    }

    if (activeSort.value !== 'new') {
      params.sort = activeSort.value
    }

    const { data } = await api.get('/series', {
      params,
    })

    if (requestId !== loadSeriesRequestId) {
      return
    }

    const items = data.data || []
    const incomingDateKeys = extractSeriesDateKeys(items)
    const hasDateFilter = Boolean(selectedCalendarDate.value || dateFrom.value || dateTo.value)

    if (hasDateFilter) {
      const merged = new Set(calendarMarkedDateKeys.value)
      for (const key of incomingDateKeys) {
        merged.add(key)
      }
      calendarMarkedDateKeys.value = Array.from(merged)
      loadCalendarMarksWithoutDateFilter()
    } else {
      calendarMarkedDateKeys.value = Array.from(incomingDateKeys)
      loadCalendarMarksWithoutDateFilter()
    }

    series.value = items
    page.value = data.current_page || targetPage
    lastPage.value = data.last_page || 1
    loadedPage.value = page.value
    await loadSeriesPreviews(series.value)
  } catch (e) {
    if (requestId !== loadSeriesRequestId) {
      return
    }

    error.value = e?.response?.data?.message || 'Failed to load series.'
  } finally {
    if (requestId === loadSeriesRequestId) {
      loading.value = false
    }
  }
}

function goToPage(targetPage) {
  if (loading.value) return
  if (targetPage < 1 || targetPage > lastPage.value) return
  if (targetPage === page.value) return
  page.value = targetPage
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

async function loadAvailableTags() {
  try {
    const { data } = await api.get('/tags', {
      params: {
        limit: 500,
      },
    })

    fetchedTags.value = (Array.isArray(data?.data) ? data.data : [])
      .map((tag) => String(tag?.name || '').trim())
      .filter(Boolean)
  } catch (_) {
    // Keep page-level fallback tags when global tags request is unavailable.
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

  tagsLayoutObserver = new ResizeObserver(() => {
    recalcTagRowsLayout()
  })
  if (tagsCloudRef.value) {
    tagsLayoutObserver.observe(tagsCloudRef.value)
  }

  applyRouteQuery(route.query)
  loadSeries(page.value || 1)
  loadProfileMeta()
  loadAvailableTags()
})

onBeforeUnmount(() => {
  if (previewResizeObserver) {
    previewResizeObserver.disconnect()
    previewResizeObserver = null
  }
  previewGridElements.clear()
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }

  if (tagsLayoutObserver) {
    tagsLayoutObserver.disconnect()
    tagsLayoutObserver = null
  }
})

watch(() => route.query, (query) => {
  applyRouteQuery(query)
  if (skipNextRouteReload) {
    skipNextRouteReload = false
    return
  }

  loadSeries(page.value)
})

watch(searchInput, (value) => {
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer)
  }

  searchDebounceTimer = window.setTimeout(() => {
    search.value = String(value || '')
  }, 300)
})

watch([search, selectedTags, dateFrom, dateTo, selectedCalendarDate, activeSort], () => {
  if (syncingQueryState.value) {
    return
  }

  if (page.value !== 1) {
    page.value = 1
    return
  }

  syncStateToQuery()
  loadSeries(1)
})

watch(page, () => {
  if (syncingQueryState.value) {
    return
  }

  syncStateToQuery()
  loadSeries(page.value)
})

watch([availableTags, visibleTagRows], async () => {
  await nextTick()
  recalcTagRowsLayout()
}, { immediate: true })

function toggleMobileFilters() {
  showMobileFilters.value = !showMobileFilters.value
}
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
        <button
          type="button"
          class="filters-toggle-mobile"
          :aria-expanded="showMobileFilters ? 'true' : 'false'"
          @click="toggleMobileFilters"
        >
          <span class="filters-toggle-icon">⚲</span>
          {{ showMobileFilters ? 'Скрыть фильтры' : 'Фильтр' }}
        </button>

        <aside class="filters-panel" :class="{ 'filters-panel--mobile-open': showMobileFilters }">
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
            <div class="tags-cloud-shell">
              <div
                ref="tagsCloudRef"
                class="chip-row chips-wrap tags-cloud"
                :class="{ 'tags-cloud--collapsed': hasHiddenTagRows }"
                :style="tagCloudStyle"
              >
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

              <div v-if="hasHiddenTagRows" class="tags-fade-overlay"></div>
              <button
                v-if="hasHiddenTagRows"
                type="button"
                class="tags-expand-btn"
                title="Показать ещё"
                @click="expandTagRows"
              >
                <span class="tags-chevron tags-chevron--down" aria-hidden="true"></span>
              </button>
            </div>

            <div v-if="canCollapseTagRows" class="chip-row tags-collapse-row">
              <button type="button" class="tags-expand-btn tags-collapse-btn" title="Свернуть" @click="collapseTagRows">
                <span class="tags-chevron tags-chevron--up" aria-hidden="true"></span>
              </button>
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
            <input v-model="searchInput" type="text" placeholder="Искать по названию и описанию..." />
          </section>

          <p v-if="loading" class="state-text">Загрузка...</p>
          <p v-else-if="error" class="error">{{ error }}</p>
          <p v-else-if="!series.length" class="state-text">Серии не найдены.</p>

          <div v-else class="series-grid">
            <article v-for="item in series" :key="item.id" class="series-card">
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
                      @error="onPreviewImageError($event, tile.photo)"
                    />
                  </div>
                </div>
              </div>
            </article>
          </div>

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

.filters-toggle-mobile {
  display: none;
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
      rgba(244, 245, 242, 0.04) 0%,
      rgba(244, 245, 242, 0.7) 54%,
      rgba(244, 245, 242, 0.98) 100%
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
  min-width: 0;
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
  width: 100%;
  min-width: 0;
}

.search-row input {
  display: block;
  width: 100%;
  max-width: 100%;
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
  box-sizing: border-box;
  overflow: hidden;
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

  .filters-toggle-mobile {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: max-content;
    margin: 14px 20px 0;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--chip);
    color: var(--text);
    font-weight: 700;
    padding: 9px 12px;
    cursor: pointer;
  }

  .filters-toggle-icon {
    font-size: 14px;
    line-height: 1;
  }

  .filters-panel {
    display: none;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .filters-panel.filters-panel--mobile-open {
    display: block;
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
