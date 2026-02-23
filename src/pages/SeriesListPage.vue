<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { formatValidationErrorMessage } from '../lib/formErrors'
import { optimizeImagesForUpload } from '../lib/imageOptimizer'
import { getUser, setCurrentUser } from '../lib/session'
import { seriesPath, seriesSlugOrId } from '../lib/seriesPath'
import { buildStorageUrl, withCacheBust } from '../lib/url'
import { buildUploadValidationMessage, findInvalidUploadIssue } from '../lib/uploadPolicy'
import { currentLocale, t } from '../lib/i18n'

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
const previewImageLoaded = ref({})
const previewUrlVersion = ref(0)
const previewGridElements = new Map()
let previewResizeObserver = null
let searchDebounceTimer = null
let loadSeriesRequestId = 0
let refreshPreviewUrlsInFlight = false
let previewRefreshRetries = 0
const MAX_PREVIEW_REFRESH_RETRIES = 1
let skipNextRouteReload = false
let listStatusPollTimerId = null
let listStatusPollInFlight = false
const syncingQueryState = ref(false)
const LIST_STATUS_POLL_INTERVAL_MS = 5000
const LIST_STATUS_POLL_RETRY_MS = 9000
const PHOTO_UPLOAD_CHUNK_SIZE = 3

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
const calendarPickerRoot = ref(null)
const calendarPickerMode = ref(null)
const showCreateForm = ref(false)
const calendarMonthCursor = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const today = new Date()
const todayMonth = today.getMonth()
const todayYear = today.getFullYear()
const calendarMonthOptions = computed(() => {
  const locale = currentLocale.value === 'en' ? 'en-US' : 'ru-RU'

  return Array.from({ length: 12 }, (_, month) => ({
    value: month,
    label: new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2000, month, 1)),
  }))
})

const createTitle = ref('')
const createDescription = ref('')
const createIsPublic = ref(false)
const createFiles = ref([])
const createFilesInput = ref(null)
const creating = ref(false)
const createError = ref('')
const createWarnings = ref([])
const showMobileFilters = ref(false)
const TAG_ROWS_INITIAL = 4
const TAG_ROWS_STEP = 10
const visibleTagRows = ref(TAG_ROWS_INITIAL)
const tagRowsTotal = ref(0)
const tagVisibleHeight = ref(0)
const tagsCloudRef = ref(null)
const tagSearchInputRef = ref(null)
const showTagSearch = ref(false)
const tagSearchQuery = ref('')
let tagsLayoutObserver = null

const journalTitle = computed(() => {
  const title = currentUser.value?.journal_title
  return typeof title === 'string' && title.trim() ? title.trim() : t('Фото Дневник')
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

const filteredAvailableTags = computed(() => {
  const query = String(tagSearchQuery.value || '').trim().toLowerCase()
  if (!query) {
    return availableTags.value
  }

  const selected = new Set(selectedTags.value.map((tag) => String(tag || '').trim()).filter(Boolean))
  return availableTags.value.filter((tag) => {
    if (selected.has(tag)) {
      return true
    }

    return tag.toLowerCase().includes(query)
  })
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

const calendarMonthText = computed(() =>
  new Intl.DateTimeFormat(currentLocale.value === 'en' ? 'en-US' : 'ru-RU', { month: 'long' }).format(calendarMonthCursor.value)
)
const calendarYearText = computed(() => String(calendarMonthCursor.value.getFullYear()))

const selectedCalendarMonth = computed({
  get: () => calendarMonthCursor.value.getMonth(),
  set: (nextMonth) => {
    if (!Number.isFinite(nextMonth)) return
    const month = Math.min(11, Math.max(0, Math.trunc(nextMonth)))
    const year = calendarMonthCursor.value.getFullYear()
    calendarMonthCursor.value = new Date(year, month, 1)
  },
})

const selectedCalendarYear = computed({
  get: () => calendarMonthCursor.value.getFullYear(),
  set: (nextYear) => {
    if (!Number.isFinite(nextYear)) return
    const year = Math.trunc(nextYear)
    const month = calendarMonthCursor.value.getMonth()
    calendarMonthCursor.value = new Date(year, month, 1)
  },
})

const calendarYearOptions = computed(() => {
  const years = new Set([new Date().getFullYear(), selectedCalendarYear.value])

  for (let year = selectedCalendarYear.value - 6; year <= selectedCalendarYear.value + 2; year += 1) {
    years.add(year)
  }

  calendarMarkedDateKeys.value.forEach((iso) => {
    const year = Number.parseInt(String(iso || '').slice(0, 4), 10)
    if (Number.isFinite(year)) {
      years.add(year)
    }
  })

  return Array.from(years).sort((a, b) => a - b)
})

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
  const invalid = findInvalidUploadIssue(files)

  if (invalid) {
    createError.value = buildUploadValidationMessage(invalid)
    createFiles.value = []
    event.target.value = ''
    return
  }

  createError.value = ''
  createFiles.value = files
}

function formatValidationError(err) {
  return formatValidationErrorMessage(err, 'Request failed.')
}

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

function publicationStatus(item) {
  return String(item?.publication_status || '').trim()
}

const canViewModerationTags = computed(() => Boolean(currentUser.value?.can_moderate))
const canCreateSeries = computed(() => {
  if (currentUser.value?.can_moderate) {
    return true
  }

  return Boolean(currentUser.value?.email_verified_at)
})

function moderationTags(item) {
  const labels = Array.isArray(item?.moderation_labels) ? item.moderation_labels : []
  return labels
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

function hasPendingModerationItems() {
  return series.value.some((item) => publicationStatus(item) === 'pending_moderation')
}

function stopListStatusPolling() {
  if (listStatusPollTimerId !== null) {
    clearTimeout(listStatusPollTimerId)
    listStatusPollTimerId = null
  }
  listStatusPollInFlight = false
}

function scheduleListStatusPoll(delayMs) {
  if (listStatusPollTimerId !== null) {
    clearTimeout(listStatusPollTimerId)
  }
  listStatusPollTimerId = window.setTimeout(pollListStatusTick, delayMs)
}

async function pollListStatusTick() {
  listStatusPollTimerId = null
  if (listStatusPollInFlight) {
    return
  }

  listStatusPollInFlight = true
  if (!hasPendingModerationItems()) {
    listStatusPollInFlight = false
    return
  }

  try {
    const loaded = await loadSeries(page.value || 1, { silent: true, statusOnly: true })
    if (!hasPendingModerationItems()) {
      return
    }

    const nextDelay = loaded ? LIST_STATUS_POLL_INTERVAL_MS : LIST_STATUS_POLL_RETRY_MS
    scheduleListStatusPoll(nextDelay)
  } finally {
    listStatusPollInFlight = false
  }
}

function ensureListStatusPolling() {
  if (!hasPendingModerationItems()) {
    stopListStatusPolling()
    return
  }

  if (listStatusPollTimerId !== null || listStatusPollInFlight) {
    return
  }

  scheduleListStatusPoll(LIST_STATUS_POLL_INTERVAL_MS)
}

function visibilityLabel(item) {
  const status = publicationStatus(item)
  if (status === 'pending_moderation') {
    return t('На модерации')
  }
  if (status === 'rejected') {
    return t('Отклонена')
  }
  if (status === 'published') {
    const moderation = String(item?.moderation_status || '').trim()
    return moderation === 'manual_approved' ? t('Опубликована админом') : t('Публичная')
  }

  return t('Приватная')
}

function visibilityClass(item) {
  const status = publicationStatus(item)
  if (status === 'pending_moderation') {
    return 'series-visibility--pending'
  }
  if (status === 'rejected') {
    return 'series-visibility--rejected'
  }
  if (status === 'published') {
    return 'series-visibility--public'
  }

  return 'series-visibility--private'
}

function photoUrl(path) {
  return buildStorageUrl(path)
}

function publicPhotoUrl(photo) {
  const direct = String(photo?.public_url || '').trim()
  if (direct) {
    return direct
  }

  return photoUrl(photo?.path)
}

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
  return Number(lastTile?.id) === Number(tile?.photo?.id)
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
  const minPreviewRatio = 0.72
  const maxPreviewRatio = 2.4
  const items = photos.map((photo) => ({
    photo,
    ratio: Math.min(
      maxPreviewRatio,
      Math.max(minPreviewRatio, previewAspectRatios.value[photo.id] || 1),
    ),
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

      rows.push(
        {
          gap: previewGap,
          height: clampedHeight,
          tiles: chunk.map((item) => ({
            photo: item.photo,
            width: item.ratio * clampedHeight,
          })),
        }
      )
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

function toggleTagSearch() {
  showTagSearch.value = !showTagSearch.value
  if (showTagSearch.value) {
    nextTick(() => {
      tagSearchInputRef.value?.focus()
    })
    return
  }

  tagSearchQuery.value = ''
}

function shiftCalendarMonth(offset) {
  const current = calendarMonthCursor.value
  calendarMonthCursor.value = new Date(current.getFullYear(), current.getMonth() + offset, 1)
  calendarPickerMode.value = null
}

function toggleCalendarPicker(kind) {
  calendarPickerMode.value = calendarPickerMode.value === kind ? null : kind
}

function selectCalendarMonth(month) {
  selectedCalendarMonth.value = month
  calendarPickerMode.value = null
}

function selectCalendarYear(year) {
  selectedCalendarYear.value = year
  calendarPickerMode.value = null
}

function closeCalendarPicker() {
  calendarPickerMode.value = null
}

function onGlobalPointerDown(event) {
  const root = calendarPickerRoot.value
  if (!root) return

  if (!root.contains(event.target)) {
    closeCalendarPicker()
  }
}

function onGlobalKeyDown(event) {
  if (event.key === 'Escape') {
    closeCalendarPicker()
    if (showTagSearch.value) {
      showTagSearch.value = false
      tagSearchQuery.value = ''
    }
  }
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
    previewImageLoaded.value = {}
    return
  }

  const entries = items.map((entry) => {
    const photos = (entry?.preview_photos || [])
      .map((photo) => {
        const signedSrc = typeof photo?.preview_url === 'string' ? photo.preview_url : ''
        const directSrc = publicPhotoUrl(photo)
        const bustedDirectSrc = withCacheBust(directSrc, previewUrlVersion.value)
        return {
          id: photo.id,
          src: signedSrc || bustedDirectSrc || '',
          fallbackSrc: signedSrc && directSrc && signedSrc !== directSrc ? bustedDirectSrc : '',
          alt: photo.original_name || `photo-${photo.id}`,
        }
      })
      .filter((photo) => photo.src)

    return [entry.id, photos]
  })

  seriesPreviews.value = Object.fromEntries(entries)
  previewImageLoaded.value = {}
  const photos = Object.values(seriesPreviews.value).flat()
  await Promise.all(photos.map((photo) => ensurePreviewRatio(photo)))
}

function buildSeriesPreviewSignature(items) {
  return (items || [])
    .map((item) => `${Number(item?.id || 0)}:${Number(item?.photos_count || 0)}`)
    .join('|')
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

function onPreviewImageError(event, photo) {
  const target = event?.target
  if (!(target instanceof HTMLImageElement)) {
    return
  }

  const fallback = String(photo?.fallbackSrc || '').trim()
  if (fallback && target.src !== fallback) {
    target.src = fallback
    return
  }

  markPreviewImageLoaded(photo?.id)

  const currentSrc = String(target.currentSrc || target.src || '').trim()
  const looksLikeSignedUrl = currentSrc.includes('expires=') && currentSrc.includes('signature=')
  if (!looksLikeSignedUrl) {
    return
  }

  if (refreshPreviewUrlsInFlight || previewRefreshRetries >= MAX_PREVIEW_REFRESH_RETRIES) {
    return
  }

  previewRefreshRetries += 1
  refreshPreviewUrlsInFlight = true
  loadSeries(page.value)
    .catch(() => {})
    .finally(() => {
      refreshPreviewUrlsInFlight = false
    })
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
      maxDimension: 3840,
      fallbackToOriginal: true,
    })

    createWarnings.value = warnings

    if (!optimizedFiles.length) {
      createError.value = 'No files left after optimization.'
      return
    }

    const firstChunk = optimizedFiles.slice(0, PHOTO_UPLOAD_CHUNK_SIZE)
    const restChunks = optimizedFiles.slice(PHOTO_UPLOAD_CHUNK_SIZE)
    const failedUploads = []

    const formData = new FormData()
    formData.append('title', createTitle.value)

    if (createDescription.value.trim()) {
      formData.append('description', createDescription.value)
    }
    formData.append('is_public', createIsPublic.value ? '1' : '0')

    for (const file of firstChunk) {
      formData.append('photos[]', file)
    }

    const { data } = await api.post('/series', formData)
    failedUploads.push(...(data?.photos_failed || []))

    const createdSeriesKey = seriesSlugOrId(data)

    if (createdSeriesKey && restChunks.length) {
      for (let start = 0; start < restChunks.length; start += PHOTO_UPLOAD_CHUNK_SIZE) {
        const chunk = restChunks.slice(start, start + PHOTO_UPLOAD_CHUNK_SIZE)
        const chunkFormData = new FormData()

        for (const file of chunk) {
          chunkFormData.append('photos[]', file)
        }

        const response = await api.post(`/series/${createdSeriesKey}/photos`, chunkFormData)
        failedUploads.push(...(response?.data?.photos_failed || []))
      }
    }

    createWarnings.value = [...warnings, ...failedUploads]
    createTitle.value = ''
    createDescription.value = ''
    createIsPublic.value = false
    createFiles.value = []
    showCreateForm.value = false

    if (createFilesInput.value) {
      createFilesInput.value.value = ''
    }

    if (data?.id) {
      await router.push(seriesPath(data))
      return
    }

    await loadSeries(1)
  } catch (e) {
    createError.value = formatValidationError(e)
  } finally {
    creating.value = false
  }
}

async function loadSeries(targetPage = 1, options = {}) {
  const silent = Boolean(options?.silent)
  const statusOnly = Boolean(options?.statusOnly)
  const requestId = ++loadSeriesRequestId
  let loaded = false
  if (!silent) {
    loading.value = true
    error.value = ''
  }

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

    if (statusOnly) {
      params.status_only = 1
      params.include_blocking_tags = canViewModerationTags.value ? 1 : 0
    } else if (!silent) {
      // For regular loads force a fresh payload with preview URLs.
      // Silent moderation polling should not churn preview URLs to avoid flicker.
      params.preview_nonce = Date.now()
    }

    const { data } = await api.get('/series', {
      params,
    })

    if (requestId !== loadSeriesRequestId) {
      return
    }

    const items = data.data || []
    if (statusOnly) {
      const statusById = new Map(
        items.map((entry) => [Number(entry?.id || 0), entry]).filter(([id]) => id > 0),
      )
      series.value = series.value.map((entry) => {
        const next = statusById.get(Number(entry?.id || 0))
        if (!next) {
          return entry
        }

        const merged = {
          ...entry,
          publication_status: next.publication_status ?? entry.publication_status,
          moderation_status: next.moderation_status ?? entry.moderation_status,
          is_public: typeof next.is_public === 'boolean' ? next.is_public : entry.is_public,
        }

        if (Object.prototype.hasOwnProperty.call(next, 'moderation_labels')) {
          merged.moderation_labels = Array.isArray(next.moderation_labels) ? next.moderation_labels : []
        }

        return merged
      })
    } else {
      const previousItems = series.value
      const previousPreviewSignature = buildSeriesPreviewSignature(previousItems)
      const nextPreviewSignature = buildSeriesPreviewSignature(items)
      const calendarDates = Array.isArray(data?.calendar_dates)
        ? data.calendar_dates.map((value) => String(value || '').trim()).filter(Boolean)
        : Array.from(extractSeriesDateKeys(items))
      calendarMarkedDateKeys.value = calendarDates

      series.value = items
      page.value = data.current_page || targetPage
      lastPage.value = data.last_page || 1
      loadedPage.value = page.value
      const shouldRefreshPreviews = !silent || previousPreviewSignature !== nextPreviewSignature
      if (shouldRefreshPreviews) {
        previewUrlVersion.value = Date.now()
        await loadSeriesPreviews(series.value)
      }
    }
    previewRefreshRetries = 0
    loaded = true
    ensureListStatusPolling()
  } catch (e) {
    if (requestId !== loadSeriesRequestId) {
      return false
    }

    if (!silent) {
      error.value = e?.response?.data?.message || 'Failed to load series.'
    }
  } finally {
    if (!silent && requestId === loadSeriesRequestId) {
      loading.value = false
    }
  }

  return loaded
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

  window.addEventListener('pointerdown', onGlobalPointerDown)
  window.addEventListener('keydown', onGlobalKeyDown)

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
  stopListStatusPolling()

  if (tagsLayoutObserver) {
    tagsLayoutObserver.disconnect()
    tagsLayoutObserver = null
  }

  window.removeEventListener('pointerdown', onGlobalPointerDown)
  window.removeEventListener('keydown', onGlobalKeyDown)
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

watch([filteredAvailableTags, visibleTagRows], async () => {
  await nextTick()
  recalcTagRowsLayout()
}, { immediate: true })

watch(canCreateSeries, (allowed) => {
  if (!allowed) {
    showCreateForm.value = false
  }
})

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
          <button v-if="canCreateSeries" type="button" class="primary-btn" @click="showCreateForm = !showCreateForm">
            {{ showCreateForm ? t('Закрыть форму') : t('Новая серия') }}
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
          {{ showMobileFilters ? t('Скрыть фильтры') : t('Фильтр') }}
        </button>

        <aside class="filters-panel" :class="{ 'filters-panel--mobile-open': showMobileFilters }">
          <h2>{{ t('Фильтры') }}</h2>

          <section class="filter-group">
            <h3>{{ t('Дата') }}</h3>
            <div class="filter-row filter-range">
              <label class="filter-label">
                <span>{{ t('От') }}</span>
                <div class="range-input-wrap">
                  <input
                    v-model="rangeFromText"
                    type="text"
                    inputmode="numeric"
                    :placeholder="t('дд.мм.гг')"
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
                <span>{{ t('До') }}</span>
                <div class="range-input-wrap">
                  <input
                    v-model="rangeToText"
                    type="text"
                    inputmode="numeric"
                    :placeholder="t('дд.мм.гг')"
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
              <button type="button" class="chip" @click="clearDateRange">{{ t('Очистить диапазон') }}</button>
            </div>

            <div class="filter-row calendar-widget">
              <div ref="calendarPickerRoot" class="calendar-head">
                <button type="button" class="chip calendar-nav" @click="shiftCalendarMonth(-1)">←</button>
                <strong class="calendar-head-label">
                  <span class="calendar-head-part" @click="toggleCalendarPicker('month')">{{ calendarMonthText }}</span>
                  <span class="calendar-head-sep"> </span>
                  <span class="calendar-head-part" @click="toggleCalendarPicker('year')">{{ calendarYearText }}</span>
                </strong>
                <button type="button" class="chip calendar-nav" @click="shiftCalendarMonth(1)">→</button>

                <div v-if="calendarPickerMode === 'month'" class="calendar-picker-popover">
                  <div class="calendar-picker-months">
                    <button
                      v-for="month in calendarMonthOptions"
                      :key="month.value"
                      type="button"
                      class="calendar-picker-item"
                      :class="{
                        active: month.value === selectedCalendarMonth,
                        current: month.value === todayMonth,
                      }"
                      @click="selectCalendarMonth(month.value)"
                    >
                      {{ month.label }}
                    </button>
                  </div>
                </div>

                <div v-if="calendarPickerMode === 'year'" class="calendar-picker-popover">
                  <div class="calendar-picker-years">
                    <button
                      v-for="year in calendarYearOptions"
                      :key="year"
                      type="button"
                      class="calendar-picker-item"
                      :class="{
                        active: year === selectedCalendarYear,
                        current: year === todayYear,
                      }"
                      @click="selectCalendarYear(year)"
                    >
                      {{ year }}
                    </button>
                  </div>
                </div>
              </div>
              <div class="calendar-weekdays">
                <span>{{ t('Пн') }}</span><span>{{ t('Вт') }}</span><span>{{ t('Ср') }}</span><span>{{ t('Чт') }}</span><span>{{ t('Пт') }}</span><span>{{ t('Сб') }}</span><span>{{ t('Вс') }}</span>
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
            <div class="tags-head">
              <h3>{{ t('Теги') }}</h3>
              <div class="tags-search-box">
                <button
                  type="button"
                  class="tags-search-toggle"
                  :title="t('Поиск по тегам')"
                  :aria-label="t('Поиск по тегам')"
                  @click="toggleTagSearch"
                >
                  <svg
                    v-if="!showTagSearch"
                    class="tags-search-icon"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <circle cx="7" cy="7" r="4.5"></circle>
                    <line x1="10.5" y1="10.5" x2="14" y2="14"></line>
                  </svg>
                  <svg
                    v-else
                    class="tags-search-close-icon"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <line x1="4" y1="4" x2="12" y2="12"></line>
                    <line x1="12" y1="4" x2="4" y2="12"></line>
                  </svg>
                </button>
                <input
                  ref="tagSearchInputRef"
                  v-model="tagSearchQuery"
                  type="text"
                  class="tags-search-input"
                  :class="{ 'tags-search-input--visible': showTagSearch }"
                  :placeholder="t('Найти тег...')"
                />
              </div>
            </div>
            <div class="tags-cloud-shell">
              <div
                ref="tagsCloudRef"
                class="chip-row chips-wrap tags-cloud"
                :class="{ 'tags-cloud--collapsed': hasHiddenTagRows }"
                :style="tagCloudStyle"
              >
                <button
                  v-for="tag in filteredAvailableTags"
                  :key="tag"
                  type="button"
                  class="tag-chip"
                  :class="{ active: selectedTags.includes(tag) }"
                  @click="toggleTag(tag)"
                >
                  #{{ tag }}
                </button>
                <span v-if="!filteredAvailableTags.length" class="hint">
                  {{ availableTags.length ? t('Ничего не найдено') : t('Нет тегов') }}
                </span>
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
              <button type="button" class="chip" :class="{ active: activeSort === 'new' }" @click="activeSort = 'new'">
                {{ t('Новые') }}
              </button>
              <button type="button" class="chip" :class="{ active: activeSort === 'old' }" @click="activeSort = 'old'">
                {{ t('Старые') }}
              </button>
            </div>
          </section>
        </aside>

        <main class="content-panel">
          <section v-if="showCreateForm && canCreateSeries" class="create-card">
            <h2>{{ t('Новая серия') }}</h2>

            <form class="form" @submit.prevent="createSeries">
              <label>
                {{ t('Название') }}
                <input v-model="createTitle" type="text" maxlength="255" required />
              </label>

              <label>
                {{ t('Описание') }}
                <textarea v-model="createDescription" rows="3"></textarea>
              </label>

              <label class="checkbox-field">
                <input v-model="createIsPublic" type="checkbox" />
                <span>{{ t('Публичная серия') }}</span>
              </label>

              <label>
                {{ t('Фотографии') }}
                <input
                  ref="createFilesInput"
                  name="photos[]"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  multiple
                  @change="onCreateFilesChanged"
                />
              </label>
              <small class="hint">{{ t('Оптимизация перед отправкой: до 2MB после оптимизации, оригиналы до 100MB поддерживаются.') }}</small>
              <small class="hint" v-if="createFiles.length">{{ t('Выбрано: {count} файл(ов)', { count: createFiles.length }) }}</small>

              <p v-if="createError" class="error">{{ createError }}</p>

              <ul v-if="createWarnings.length" class="warnings">
                <li v-for="(warning, index) in createWarnings" :key="index">
                  {{ warning.original_name }}: {{ warning.message }}
                </li>
              </ul>

              <button type="submit" class="primary-btn" :disabled="creating">
                {{ creating ? t('Сохраняем...') : t('Создать серию') }}
              </button>
            </form>
          </section>

          <section class="search-row">
            <input v-model="searchInput" type="text" :placeholder="t('Искать по названию и описанию...')" />
          </section>

          <p v-if="loading" class="state-text">{{ t('Загрузка...') }}</p>
          <p v-else-if="error" class="error">{{ error }}</p>
          <p v-else-if="!series.length" class="state-text">{{ t('Серии не найдены.') }}</p>

          <div v-else class="series-grid">
            <article v-for="item in series" :key="item.id" class="series-card">
              <header class="series-card-header">
                <h3>
                  <RouterLink class="series-title-link" :to="seriesPath(item)">
                    {{ item.title }}
                  </RouterLink>
                </h3>
                <RouterLink class="view-link" :to="seriesPath(item)">{{ t('Открыть') }}</RouterLink>
              </header>

              <div class="series-meta">
                <span>{{ formatDate(item.created_at) }}</span>
                <span>{{ item.photos_count }} {{ t('фото') }}</span>
                <span
                  class="series-visibility"
                  :class="visibilityClass(item)"
                >
                  {{ visibilityLabel(item) }}
                </span>
              </div>

              <p v-if="item.description" class="series-desc">{{ item.description }}</p>

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
                    :class="{ 'preview-tile--loaded': isPreviewImageLoaded(tile.photo.id) }"
                    :style="{ width: `${tile.width}px`, height: `${row.height || 0}px` }"
                  >
                    <img
                      class="preview-tile-image"
                      :class="{ 'preview-tile-image--loaded': isPreviewImageLoaded(tile.photo.id) }"
                      :src="tile.photo.src"
                      :alt="tile.photo.alt"
                      @load="markPreviewImageLoaded(tile.photo.id)"
                      @error="onPreviewImageError($event, tile.photo)"
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

              <div v-if="(item.tags || []).length" class="series-card-tags">
                <button
                  v-for="tag in item.tags"
                  :key="tag.id"
                  type="button"
                  class="tag-chip"
                  :class="{ active: selectedTags.includes(tag.name) }"
                  @click="toggleTag(tag.name)"
                >
                  #{{ tag.name }}
                </button>
              </div>

              <div
                v-if="canViewModerationTags && moderationTags(item).length"
                class="series-card-tags series-card-tags--moderation"
              >
                <span
                  v-for="label in moderationTags(item)"
                  :key="`${item.id}-${label}`"
                  class="tag-chip tag-chip--moderation"
                >
                  #{{ label }}
                </span>
              </div>
            </article>
          </div>

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
.journal-page {
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
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.calendar-head-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-transform: capitalize;
  font-size: 14px;
}

.calendar-head-part {
  cursor: pointer;
}

.calendar-picker-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 20;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 12px 24px rgba(49, 58, 53, 0.12);
  padding: 8px;
  display: grid;
  gap: 8px;
}

.calendar-picker-months {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.calendar-picker-years {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.calendar-picker-item {
  border: 0;
  border-radius: 8px;
  background: #f1f5f0;
  color: var(--text);
  font-size: 12px;
  line-height: 1.2;
  padding: 6px 6px;
  cursor: pointer;
}

.calendar-picker-item:hover {
  background: #e5ece4;
}

.calendar-picker-item.active {
  background: var(--accent-soft);
  color: #3f6d56;
}

.calendar-picker-item.current:not(.active) {
  box-shadow: inset 0 0 0 1px rgba(79, 131, 102, 0.24);
  color: #4c6f5b;
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

.tags-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.tags-head h3 {
  margin: 0;
}

.tags-search-box {
  position: relative;
  width: 184px;
  height: 30px;
  flex: 0 0 184px;
}

.tags-search-toggle {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  flex: 0 0 auto;
  transition: color 0.18s ease;
}

.tags-search-icon {
  width: 20px;
  height: 20px;
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tags-search-close-icon {
  width: 20px;
  height: 20px;
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tags-search-input {
  position: absolute;
  right: 32px;
  top: 50%;
  transform: translateY(-50%) translateX(6px);
  width: 152px;
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f9faf8;
  color: var(--text);
  font-size: 13px;
  padding: 0 9px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.tags-search-input::placeholder {
  color: #aeb7ad;
}

.tags-search-input--visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(-50%) translateX(0);
}

.tags-search-input:focus {
  outline: none;
  border-color: #9bbca9;
  box-shadow: 0 0 0 2px rgba(155, 188, 169, 0.18);
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

.checkbox-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #4b574f;
}

.checkbox-field input[type='checkbox'] {
  width: 16px;
  height: 16px;
  margin: 0;
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
  flex-wrap: wrap;
  gap: 14px;
  color: var(--muted);
  font-size: 14px;
}

.series-visibility {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.01em;
}

.series-visibility--public {
  background: rgba(111, 161, 127, 0.18);
  color: #2f6942;
}

.series-visibility--private {
  background: rgba(125, 134, 128, 0.16);
  color: #4b574f;
}

.series-visibility--pending {
  background: rgba(171, 116, 32, 0.18);
  color: #8b5a14;
}

.series-visibility--rejected {
  background: rgba(179, 53, 53, 0.16);
  color: #922525;
}

.series-desc {
  margin: 12px 0;
  color: #4b574f;
  font-size: 18px;
}

.series-card-tags {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.series-card-tags--moderation {
  margin-top: 8px;
}

.tag-chip--moderation {
  background: rgba(179, 53, 53, 0.1);
  color: #922525;
  cursor: default;
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

.pager {
  margin-top: 14px;
  display: flex;
  gap: 8px;
  align-items: center;
}

.warnings {
  margin: 0;
  padding-left: 16px;
  color: #87520b;
}

.ghost-btn {
  border: 0;
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

  .tags-search-input {
    width: 122px;
    right: 30px;
  }

  .tags-search-box {
    width: 156px;
    flex-basis: 156px;
  }

}
</style>
