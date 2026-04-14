<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatValidationErrorMessage } from '../lib/formErrors'
import LazyPhotoThumb from '../components/LazyPhotoThumb.vue'
import PhotoPreviewModal from '../components/PhotoPreviewModal.vue'
import { seriesPath, seriesSlugOrId } from '../lib/seriesPath'
import { buildStorageUrl, withCacheBust } from '../lib/url'
import { buildUploadValidationMessage, findInvalidUploadIssue } from '../lib/uploadPolicy'
import { getUser, isAuthenticated, setCurrentUser } from '../lib/session'
import { currentLocale, t } from '../lib/i18n'
import { usePreviewGrid } from '../composables/usePreviewGrid'
import { useSeriesDownload } from '../composables/useSeriesDownload'
import { useSeriesTags } from '../composables/useSeriesTags'
import {
  deleteSeries as deleteSeriesRequest,
  deleteSeriesPhoto,
  getPublicSeries,
  getSeries,
  publishSeriesAsAdmin,
  refreshSeriesAutoTags,
  renameSeriesPhoto,
  reorderSeriesPhotos,
  updateSeries,
  uploadSeriesPhotos,
} from '../services/seriesService'
import { getProfile } from '../services/profileService'

const route = useRoute()
const router = useRouter()
const {
  downloadPhotoOriginal: downloadSeriesPhoto,
  downloadProgressText,
  downloadSeries,
  isPhotoDownloading,
  isSeriesDownloading,
} = useSeriesDownload({ t })

// `item` — главный объект страницы. В нем хранится вся серия:
// мета-данные, фото, теги, статус публикации и прочие поля из API.
const item = ref(null)
const loading = ref(true)
const error = ref('')

// Состояние формы загрузки фото.
const uploadFiles = ref([])
const uploadInput = ref(null)
const uploading = ref(false)
const uploadError = ref('')
const uploadWarnings = ref([])
const showUploadForm = ref(false)

// Состояние редактирования самой серии.
const isEditingSeries = ref(false)
const editTitle = ref('')
const editDescription = ref('')
const editIsPublic = ref(false)
const editError = ref('')
const editInfo = ref('')
const savingSeries = ref(false)
const showDeleteSeriesModal = ref(false)
const deletingSeries = ref(false)
const deleteSeriesError = ref('')

// Состояние удаления отдельной фотографии.
const showDeletePhotoModal = ref(false)
const photoToDelete = ref(null)
const deletingPhoto = ref(false)
const deletePhotoError = ref('')

// Состояние drag-and-drop сортировки фотографий.
const draggingPhotoId = ref(null)
const dragOverPhotoId = ref(null)
const reorderingPhotos = ref(false)
const photoOrderError = ref('')

// После drag-and-drop браузер может сгенерировать лишний клик.
// Этот флаг временно запрещает открытие preview после перетаскивания.
const suppressPreviewOpen = ref(false)

// Состояние ручного обновления автоматически сгенерированных тегов.
const refreshingTags = ref(false)
const refreshTagsError = ref('')
const refreshTagsInfo = ref('')

// Состояние админской публикации серии.
const adminPublishError = ref('')
const adminPublishInfo = ref('')
const publishingByAdmin = ref(false)

// Версия URL нужна для принудительного обновления картинок через cache busting.
const photoUrlVersion = ref(0)

// Для каждой фотографии отдельно храним:
// 1) открыта ли EXIF-панель
// 2) куда ее лучше раскрывать — вверх или вниз
const openExifByPhotoId = ref({})
const exifPlacementByPhotoId = ref({})
let statusPollTimerId = null
let statusPollInFlight = false
let tagsPollTimerId = null
let tagsPollInFlight = false
let tagsPollAttempts = 0

const STATUS_POLL_INTERVAL_MS = 5000
const STATUS_POLL_RETRY_MS = 9000
const TAGS_POLL_INTERVAL_MS = 3500
const TAGS_POLL_RETRY_MS = 7000
const TAGS_POLL_MAX_ATTEMPTS = 20
const PHOTO_UPLOAD_CHUNK_SIZE = 3

const selectedPhoto = ref(null)
const currentUser = ref(getUser())

// Безопасный доступ к массиву фото.
const photoList = computed(() => item.value?.photos || [])

// Индекс выбранного фото нужен для стрелочной навигации в preview-модалке.
const selectedPhotoIndex = computed(() => {
  if (!selectedPhoto.value) {
    return -1
  }

  return photoList.value.findIndex((photo) => Number(photo?.id) === Number(selectedPhoto.value?.id))
})
const canPreviewPrev = computed(() => selectedPhotoIndex.value > 0)
const canPreviewNext = computed(() => {
  return selectedPhotoIndex.value >= 0 && selectedPhotoIndex.value < photoList.value.length - 1
})

// Редактировать серию может только ее владелец.
// Это клиентская проверка для UI, а не замена серверной авторизации.
const canEditSeries = computed(() => {
  const ownerId = Number(item.value?.user_id || 0)
  const currentUserId = Number(currentUser.value?.id || 0)

  return ownerId > 0 && currentUserId > 0 && ownerId === currentUserId
})

// Модератору показываем дополнительные moderation-данные.
const canViewModerationTags = computed(() => Boolean(currentUser.value?.can_moderate))

// Нормализуем теги и сортируем их по имени,
// чтобы отображение было стабильным и предсказуемым.
const seriesTags = computed(() => {
  const tags = (item.value?.tags || [])
    .map((tag) => ({
      id: Number(tag?.id || 0),
      name: String(tag?.name || '').trim(),
    }))
    .filter((tag) => tag.id > 0 && tag.name)

  return tags.sort((a, b) => a.name.localeCompare(b.name))
})
const showPendingTagsHint = computed(() => {
  return Number(item.value?.photos_count || 0) > 0 && seriesTags.value.length === 0
})

// Админ может опубликовать только те серии, которые ждут модерации или были отклонены.
const canAdminPublishSeries = computed(() => {
  if (!canViewModerationTags.value) {
    return false
  }

  const status = publicationStatus(item.value)
  return status === 'pending_moderation' || status === 'rejected'
})
const moderationTags = computed(() => {
  const labels = Array.isArray(item.value?.moderation_labels) ? item.value.moderation_labels : []
  return labels
    .map((value) => String(value || '').trim())
    .filter(Boolean)
})

// Некоторые API-методы возвращают только часть данных серии.
// Эта функция аккуратно объединяет новый кусок данных с уже загруженным объектом.
function mergeSeriesPayload(next) {
  if (!next) {
    return item.value
  }

  if (!item.value) {
    return next
  }

  return {
    ...item.value,
    ...next,
    photos: Array.isArray(next.photos) ? next.photos : (item.value.photos || []),
  }
}

function stopStatusPolling() {
  if (statusPollTimerId !== null) {
    clearTimeout(statusPollTimerId)
    statusPollTimerId = null
  }
  statusPollInFlight = false
}

// Перезаписываем таймер, чтобы в любой момент был только один активный polling.
function scheduleStatusPoll(delayMs) {
  if (statusPollTimerId !== null) {
    clearTimeout(statusPollTimerId)
  }
  statusPollTimerId = window.setTimeout(pollSeriesStatusTick, delayMs)
}

// Один "тик" проверки статуса публикации на сервере.
async function pollSeriesStatusTick() {
  statusPollTimerId = null
  if (statusPollInFlight) {
    return
  }

  statusPollInFlight = true
  if (publicationStatus(item.value) !== 'pending_moderation') {
    statusPollInFlight = false
    return
  }

  try {
    const loaded = await loadSeries({ silent: true, statusOnly: true })
    if (publicationStatus(item.value) !== 'pending_moderation') {
      return
    }

    const nextDelay = loaded ? STATUS_POLL_INTERVAL_MS : STATUS_POLL_RETRY_MS
    scheduleStatusPoll(nextDelay)
  } finally {
    statusPollInFlight = false
  }
}

// Polling статуса нужен только пока серия находится на модерации.
function ensureStatusPolling() {
  if (publicationStatus(item.value) !== 'pending_moderation') {
    stopStatusPolling()
    return
  }

  if (statusPollTimerId !== null || statusPollInFlight) {
    return
  }

  scheduleStatusPoll(STATUS_POLL_INTERVAL_MS)
}

function hasPendingAutoTags() {
  return Number(item.value?.photos_count || 0) > 0 && seriesTags.value.length === 0
}

// Полностью останавливаем polling тегов и сбрасываем счетчик попыток.
function stopTagsPolling() {
  if (tagsPollTimerId !== null) {
    clearTimeout(tagsPollTimerId)
    tagsPollTimerId = null
  }
  tagsPollInFlight = false
  tagsPollAttempts = 0
}

// Планируем следующую фоновую проверку тегов.
function scheduleTagsPoll(delayMs) {
  if (tagsPollTimerId !== null) {
    clearTimeout(tagsPollTimerId)
  }
  tagsPollTimerId = window.setTimeout(pollSeriesTagsTick, delayMs)
}

// Один "тик" polling-а автотегов.
async function pollSeriesTagsTick() {
  tagsPollTimerId = null
  if (tagsPollInFlight) {
    return
  }

  tagsPollInFlight = true
  if (!hasPendingAutoTags() || tagsPollAttempts >= TAGS_POLL_MAX_ATTEMPTS) {
    tagsPollInFlight = false
    return
  }

  tagsPollAttempts += 1

  try {
    const loaded = await loadSeriesTagsOnly()
    if (!hasPendingAutoTags() || tagsPollAttempts >= TAGS_POLL_MAX_ATTEMPTS) {
      return
    }

    const nextDelay = loaded ? TAGS_POLL_INTERVAL_MS : TAGS_POLL_RETRY_MS
    scheduleTagsPoll(nextDelay)
  } finally {
    tagsPollInFlight = false
  }
}

// Polling автотегов нужен только в промежуточном состоянии:
// фотографии уже есть, а теги еще не успели появиться.
function ensureTagsPolling() {
  if (!hasPendingAutoTags()) {
    stopTagsPolling()
    return
  }

  if (tagsPollAttempts >= TAGS_POLL_MAX_ATTEMPTS) {
    return
  }

  if (tagsPollTimerId !== null || tagsPollInFlight) {
    return
  }

  scheduleTagsPoll(TAGS_POLL_INTERVAL_MS)
}

// Упрощенная загрузка серии: обновляем только теги и несколько связанных полей,
// не загружая заново весь список фотографий.
async function loadSeriesTagsOnly() {
  const seriesKey = currentSeriesKey()
  if (!seriesKey || !item.value) {
    return false
  }

  try {
    let data = null

    if (isAuthenticated.value) {
      try {
        const response = await getSeries(seriesKey, {
          include_blocking_tags: canViewModerationTags.value ? 1 : 0,
        })
        data = response.data
      } catch (e) {
        if (e?.response?.status !== 401) {
          throw e
        }
      }
    }

    if (!data) {
      const response = await getPublicSeries(seriesKey, {
        include_blocking_tags: canViewModerationTags.value ? 1 : 0,
      })
      data = response.data
    }

    const next = data?.data || null
    if (!next || !item.value) {
      return false
    }

    item.value.tags = Array.isArray(next.tags) ? next.tags : []

    if (Object.prototype.hasOwnProperty.call(next, 'photos_count')) {
      const parsed = Number(next.photos_count)
      if (Number.isFinite(parsed) && parsed >= 0) {
        item.value.photos_count = parsed
      }
    }

    if (Object.prototype.hasOwnProperty.call(next, 'moderation_labels')) {
      item.value.moderation_labels = Array.isArray(next.moderation_labels) ? next.moderation_labels : []
    }

    return true
  } catch (_) {
    return false
  }
}

// Серия может идентифицироваться и slug, и id.
// Если после загрузки у нас уже есть нормализованный ключ — берем его.
function currentSeriesKey() {
  const keyFromItem = seriesSlugOrId(item.value)
  if (keyFromItem) {
    return keyFromItem
  }

  return String(route.params.slug || '').trim()
}

async function downloadWholeSeries() {
  const seriesKey = currentSeriesKey()
  if (!seriesKey) {
    return
  }

  error.value = ''

  try {
    await downloadSeries({
      seriesKey,
      photos: photoList.value.length === Number(item.value?.photos_count || 0) ? photoList.value : null,
      fallbackMessage: t('Не удалось скачать серию целиком.'),
    })
  } catch (e) {
    error.value = e?.message || t('Не удалось скачать серию целиком.')
  }
}

// Возвращаем пользователя назад, если переход был внутри приложения.
// Если истории нет, ведем на главную.
function goBack() {
  const back = window.history.state?.back
  if (typeof back === 'string' && back.startsWith('/')) {
    router.back()
    return
  }

  router.push('/')
}

function photoUrl(path) {
  return buildStorageUrl(path)
}

// Для публичного изображения сначала используем URL, который уже прислал сервер.
function publicPhotoUrl(photo) {
  const direct = String(photo?.public_url || '').trim()
  if (direct) {
    return direct
  }

  return photoUrl(photo?.path)
}

// Для превью предпочитаем специальный `preview_url`,
// а если его нет — строим обычный URL и добавляем cache-bust параметр.
function resolvedPhotoUrl(photo) {
  const signed = String(photo?.preview_url || '').trim()
  if (signed) {
    return signed
  }

  return withCacheBust(publicPhotoUrl(photo), photoUrlVersion.value)
}

// В полноэкранной модалке стараемся показать оригинал.
function resolvedPhotoOriginalUrl(photo) {
  const original = withCacheBust(publicPhotoUrl(photo), photoUrlVersion.value)
  if (original) {
    return original
  }

  return resolvedPhotoUrl(photo)
}

// Fallback на обычный URL, если preview URL недоступен.
function resolvedPhotoFallbackUrl(photo) {
  if (!photo?.preview_url) {
    return ''
  }

  return withCacheBust(publicPhotoUrl(photo), photoUrlVersion.value)
}

// Форматируем дату с учетом текущей локали интерфейса.
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

// То же самое, но вместе со временем.
function formatDateTime(value) {
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
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

// Безопасное форматирование дробных чисел.
function formatDecimal(value, maxFractionDigits = 2) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    return ''
  }

  return num.toLocaleString(currentLocale.value === 'en' ? 'en-US' : 'ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  })
}

// Перевод размера файла в удобочитаемый формат.
function formatSize(bytes) {
  if (!Number.isFinite(bytes)) {
    return 'n/a'
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const EXIF_WHITE_BALANCE_LABELS = {
  auto: 'Авто',
  automatic: 'Авто',
  manual: 'Ручной',
  daylight: 'Дневной свет',
  sunny: 'Солнечно',
  cloudy: 'Облачно',
  shade: 'Тень',
  tungsten: 'Лампа накаливания',
  incandescent: 'Лампа накаливания',
  fluorescent: 'Флуоресцентный',
  flash: 'Вспышка',
  custom: 'Пользовательский',
  kelvin: 'Кельвины',
}

const EXIF_COLOR_SPACE_LABELS = {
  srgb: 'sRGB',
  'adobe rgb': 'Adobe RGB',
  adobe_rgb: 'Adobe RGB',
  displayp3: 'Display P3',
  'display p3': 'Display P3',
  p3: 'Display P3',
  prophotorgb: 'ProPhoto RGB',
  'prophoto rgb': 'ProPhoto RGB',
  uncalibrated: 'Некалиброванное',
}

function normalizeExifEnumValue(value) {
  return String(value || '').trim().toLowerCase()
}

// Сервер может прислать строковое enum-значение в разных форматах:
// с разным регистром, пробелами, `_` или `-`.
// Нормализуем его и пытаемся найти локализованный вариант в словаре.
function localizeExifEnumValue(value, dictionary) {
  const raw = String(value || '').trim()
  if (!raw) {
    return ''
  }

  const normalized = normalizeExifEnumValue(raw)
  const compact = normalized.replace(/[\s_-]+/g, '')
  const localized = dictionary[normalized] || dictionary[compact]
  if (!localized) {
    return raw
  }

  return t(localized)
}

// Преобразуем "сырые" EXIF-метаданные фотографии в список строк для отображения.
// Так шаблон становится проще: ему не нужно знать детали форматов и полей EXIF.
function exifRowsForPhoto(photo) {
  const meta = photo?.metadata
  if (!meta || typeof meta !== 'object') {
    return []
  }

  const rows = []
  const cameraMake = String(meta.camera_make || '').trim()
  const cameraModel = String(meta.camera_model || '').trim()
  const cameraName = [cameraMake, cameraModel].filter(Boolean).join(' ')

  if (cameraName) {
    rows.push({ key: 'camera', label: t('Камера'), value: cameraName })
  }

  const lensModel = String(meta.lens_model || '').trim()
  if (lensModel) {
    rows.push({ key: 'lens', label: t('Объектив'), value: lensModel })
  }

  if (meta.taken_at) {
    rows.push({ key: 'taken_at', label: t('Снято'), value: formatDateTime(meta.taken_at) })
  }

  const iso = Number(meta.iso)
  if (Number.isFinite(iso) && iso > 0) {
    rows.push({ key: 'iso', label: t('ISO'), value: String(Math.round(iso)) })
  }

  const exposureTime = String(meta.exposure_time || '').trim()
  if (exposureTime) {
    rows.push({ key: 'exposure', label: t('Выдержка'), value: exposureTime })
  }

  const aperture = formatDecimal(meta.aperture, 2)
  if (aperture) {
    rows.push({ key: 'aperture', label: t('Диафрагма'), value: `f/${aperture}` })
  }

  const focalLength = formatDecimal(meta.focal_length_mm, 1)
  if (focalLength) {
    rows.push({ key: 'focal', label: t('Фокусное'), value: `${focalLength} ${t('мм')}` })
  }

  const width = Number(meta.width)
  const height = Number(meta.height)
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    rows.push({ key: 'size', label: t('Размер'), value: `${Math.round(width)} × ${Math.round(height)} px` })
  }

  if (typeof meta.flash_fired === 'boolean') {
    rows.push({
      key: 'flash',
      label: t('Вспышка'),
      value: meta.flash_fired ? t('Сработала') : t('Не срабатывала'),
    })
  }

  const whiteBalance = String(meta.white_balance_mode || '').trim()
  if (whiteBalance) {
    rows.push({
      key: 'white_balance',
      label: t('Баланс белого'),
      value: localizeExifEnumValue(whiteBalance, EXIF_WHITE_BALANCE_LABELS),
    })
  }

  const colorSpace = String(meta.color_space || '').trim()
  if (colorSpace) {
    rows.push({
      key: 'color_space',
      label: t('Цветовое пространство'),
      value: localizeExifEnumValue(colorSpace, EXIF_COLOR_SPACE_LABELS),
    })
  }

  const sourceSize = Number(meta.source_file_size)
  if (Number.isFinite(sourceSize) && sourceSize > 0) {
    rows.push({ key: 'source_size', label: t('Размер оригинала'), value: formatSize(sourceSize) })
  }

  return rows
}

// Проверяем, открыта ли EXIF-панель у конкретного фото.
function isExifOpen(photo) {
  const photoId = Number(photo?.id || 0)
  if (!photoId) {
    return false
  }

  return Boolean(openExifByPhotoId.value[photoId])
}

// Узнаем, куда нужно раскрывать EXIF у конкретной фотографии.
function exifPlacement(photo) {
  const photoId = Number(photo?.id || 0)
  if (!photoId) {
    return 'down'
  }

  return exifPlacementByPhotoId.value[photoId] === 'up' ? 'up' : 'down'
}

// Перед открытием EXIF оцениваем свободное место вокруг кнопки.
// Если снизу мало пространства, раскрываем панель вверх.
function updateExifPlacement(photo, event) {
  const photoId = Number(photo?.id || 0)
  if (!photoId) {
    return
  }

  const target = event?.currentTarget
  if (!target || typeof target.getBoundingClientRect !== 'function') {
    exifPlacementByPhotoId.value = {
      ...exifPlacementByPhotoId.value,
      [photoId]: 'down',
    }
    return
  }

  const rect = target.getBoundingClientRect()
  const rows = exifRowsForPhoto(photo).length
  const estimatedHeight = Math.min(360, Math.max(120, 20 + rows * 24))
  const viewportHeight = window.innerHeight || 0
  const spaceBelow = Math.max(0, viewportHeight - rect.bottom - 10)
  const spaceAbove = Math.max(0, rect.top - 10)
  const direction = (spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove) ? 'down' : 'up'

  exifPlacementByPhotoId.value = {
    ...exifPlacementByPhotoId.value,
    [photoId]: direction,
  }
}

// Открываем или закрываем EXIF по клику.
function toggleExif(photo, event) {
  const photoId = Number(photo?.id || 0)
  if (!photoId) {
    return
  }

  const current = Boolean(openExifByPhotoId.value[photoId])
  if (!current) {
    updateExifPlacement(photo, event)
  }
  openExifByPhotoId.value = {
    ...openExifByPhotoId.value,
    [photoId]: !current,
  }
}

// Закрываем все EXIF-панели разом.
function closeAllExifPanels() {
  if (!Object.keys(openExifByPhotoId.value || {}).length) {
    return
  }

  openExifByPhotoId.value = {}
}

function onDocumentPointerDown(event) {
  const target = event?.target
  if (!(target instanceof Element)) {
    return
  }

  if (target.closest('.photo-exif') || target.closest('.exif-btn')) {
    return
  }

  closeAllExifPanels()
}

// После выбора файлов сразу валидируем список на клиенте,
// чтобы не отправлять заведомо неподходящие файлы на сервер.
function onUploadFilesChanged(event) {
  const files = Array.from(event.target.files || [])
  const invalid = findInvalidUploadIssue(files)

  if (invalid) {
    uploadError.value = buildUploadValidationMessage(invalid)
    uploadFiles.value = []
    event.target.value = ''
    return
  }

  uploadError.value = ''
  uploadFiles.value = files
}

function formatValidationError(err) {
  return formatValidationErrorMessage(err, 'Request failed.')
}

const {
  newTagName,
  addingTag,
  removingTagId,
  tagEditError,
  showTagInput,
  tagSuggestions,
  tagSuggestionsLoading,
  addSeriesTag,
  openTagInput,
  closeTagInput,
  removeSeriesTag,
  pickSuggestedTag,
  scheduleTagSuggestions,
  cleanupSeriesTags,
} = useSeriesTags({
  canEditSeries,
  item,
  mergeSeriesPayload,
  currentSeriesKey,
  formatValidationError,
  t,
})

const {
  previewGridRef,
  previewRows,
} = usePreviewGrid({
  photoList,
  resolvePhotoUrl: resolvedPhotoUrl,
})

// Приводим статус публикации к строке для безопасных сравнений.
function publicationStatus(series) {
  return String(series?.publication_status || '').trim()
}

// Текстовый человекочитаемый статус серии.
function visibilityLabel(series) {
  const status = publicationStatus(series)
  if (status === 'pending_moderation') {
    return t('На модерации')
  }
  if (status === 'rejected') {
    return t('Отклонена')
  }
  if (status === 'published') {
    return t('Публичная')
  }

  return t('Приватная')
}

// CSS-класс для цветовой подсветки статуса.
function visibilityClass(series) {
  const status = publicationStatus(series)
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

// Открываем форму редактирования и заполняем ее текущими значениями серии.
function openEditSeries() {
  if (!item.value || !canEditSeries.value) return

  isEditingSeries.value = true
  editError.value = ''
  editInfo.value = ''
  editTitle.value = item.value.title || ''
  editDescription.value = item.value.description || ''
  editIsPublic.value = Boolean(item.value.is_public) || publicationStatus(item.value) === 'pending_moderation'
}

// Закрываем форму редактирования и очищаем сообщения.
function cancelEditSeries() {
  isEditingSeries.value = false
  editError.value = ''
  editInfo.value = ''
}

// Сохраняем изменения серии на сервере.
async function saveSeries() {
  if (!item.value || !canEditSeries.value) return
  const seriesKey = currentSeriesKey()
  if (!seriesKey) return
  if (!editTitle.value.trim()) {
    editError.value = t('Название обязательно.')
    return
  }

  savingSeries.value = true
  editError.value = ''
  editInfo.value = ''

  try {
    const { data } = await updateSeries(seriesKey, {
      title: editTitle.value,
      description: editDescription.value || null,
      is_public: editIsPublic.value,
    })

    // Обновляем локальный объект ответом сервера,
    // но не теряем уже загруженные фотографии.
    const updated = data?.data || {}
    item.value = {
      ...item.value,
      ...updated,
      photos: item.value?.photos || [],
    }
    if (publicationStatus(updated) === 'pending_moderation') {
      editInfo.value = t('Серия отправлена на модерацию перед публикацией.')
    }
    ensureStatusPolling()
    isEditingSeries.value = false
  } catch (e) {
    editError.value = formatValidationError(e)
  } finally {
    savingSeries.value = false
  }
}

function openPreview(photo) {
  if (reorderingPhotos.value || draggingPhotoId.value !== null || suppressPreviewOpen.value) {
    suppressPreviewOpen.value = false
    return
  }

  selectedPhoto.value = photo
}

// Закрываем preview-модалку.
function closePreview() {
  selectedPhoto.value = null
}

// Переход к предыдущему фото внутри preview.
function openPrevPhoto() {
  if (!canPreviewPrev.value) {
    return
  }

  selectedPhoto.value = photoList.value[selectedPhotoIndex.value - 1] || null
}

// Переход к следующему фото внутри preview.
function openNextPhoto() {
  if (!canPreviewNext.value) {
    return
  }

  selectedPhoto.value = photoList.value[selectedPhotoIndex.value + 1] || null
}

// Глобальные клавиши страницы: Escape закрывает открытые окна,
// стрелки листают фотографии в preview.
function onKeydown(event) {
  if (event.key === 'Escape' && showDeletePhotoModal.value) {
    closeDeletePhotoModal()
    return
  }

  if (event.key === 'Escape' && showDeleteSeriesModal.value) {
    closeDeleteSeriesModal()
    return
  }

  if (event.key === 'Escape' && selectedPhoto.value) {
    closePreview()
    return
  }

  if (event.key === 'ArrowLeft' && selectedPhoto.value) {
    event.preventDefault()
    openPrevPhoto()
    return
  }

  if (event.key === 'ArrowRight' && selectedPhoto.value) {
    event.preventDefault()
    openNextPhoto()
  }
}

// Начало drag-and-drop. Запоминаем id переносимой фотографии.
function onPhotoDragStart(photo, event) {
  if (!canEditSeries.value) {
    return
  }

  if (reorderingPhotos.value) {
    return
  }
  if (isExifOpen(photo)) {
    return
  }

  const photoId = Number(photo?.id || 0)
  if (!Number.isInteger(photoId) || photoId <= 0) {
    return
  }

  draggingPhotoId.value = photoId
  dragOverPhotoId.value = null
  photoOrderError.value = ''

  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(photoId))
  }
}

// Подсветка карточки, над которой сейчас проходит перенос.
function onPhotoDragEnter(photo) {
  if (draggingPhotoId.value === null || draggingPhotoId.value === photo.id) {
    return
  }

  dragOverPhotoId.value = photo.id
}

// Очищаем все временные drag-флаги.
function onPhotoDragEnd() {
  draggingPhotoId.value = null
  dragOverPhotoId.value = null
}

// Главная логика изменения порядка фото.
// Сначала меняем UI локально, затем подтверждаем порядок на сервере.
async function onPhotoDrop(targetPhoto) {
  if (!canEditSeries.value) {
    onPhotoDragEnd()
    return
  }

  const sourceId = Number(draggingPhotoId.value || 0)
  const targetId = Number(targetPhoto?.id || 0)
  if (
    !item.value
    || !Number.isInteger(sourceId)
    || sourceId <= 0
    || !Number.isInteger(targetId)
    || targetId <= 0
    || sourceId === targetId
  ) {
    onPhotoDragEnd()
    return
  }

  const toPhotoIds = (photos) => {
    const ids = []
    for (const photo of photos) {
      const id = Number(photo?.id || 0)
      if (!Number.isInteger(id) || id <= 0) {
        return null
      }
      ids.push(id)
    }

    const unique = new Set(ids)
    if (unique.size !== ids.length) {
      return null
    }

    return ids
  }

  // Вспомогательная функция: переставить один элемент на позицию другого.
  const moveByIds = (photos, fromPhotoId, toPhotoId) => {
    const next = [...photos]
    const fromIndex = next.findIndex((photo) => Number(photo?.id || 0) === fromPhotoId)
    const toIndex = next.findIndex((photo) => Number(photo?.id || 0) === toPhotoId)
    if (fromIndex < 0 || toIndex < 0) {
      return null
    }

    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    return next
  }

  const previousOrder = [...photoList.value]
  let nextOrder = moveByIds(previousOrder, sourceId, targetId)
  if (!nextOrder) {
    onPhotoDragEnd()
    return
  }

  let nextIds = toPhotoIds(nextOrder)
  if (!nextIds) {
    photoOrderError.value = t('Не удалось сохранить порядок фото.')
    onPhotoDragEnd()
    loadSeries({ silent: true }).catch(() => {})
    return
  }

  item.value = {
    ...item.value,
    photos: nextOrder,
  }

  // После drop браузер может сгенерировать click по карточке.
  // На один тик запрещаем открывать preview, чтобы не было ложного открытия.
  suppressPreviewOpen.value = true
  setTimeout(() => {
    suppressPreviewOpen.value = false
  }, 0)

  reorderingPhotos.value = true
  photoOrderError.value = ''
  const seriesKey = currentSeriesKey()
  if (!seriesKey) {
    reorderingPhotos.value = false
    onPhotoDragEnd()
    return
  }

  try {
    const patchOrder = async (photoIds) => reorderSeriesPhotos(seriesKey, photoIds)

    await patchOrder(nextIds)
  } catch (e) {
    // Специальный случай: сервер говорит, что клиент отправил устаревший порядок.
    // Тогда перечитываем свежий список фото и пробуем переставить заново.
    const exactOrderError = String(e?.response?.data?.message || '')
      .toLowerCase()
      .includes('photo_ids must contain all photos of the series exactly once')

    if (exactOrderError) {
      const reloaded = await loadSeries({ silent: true, includePhotos: true })
      if (reloaded && Array.isArray(photoList.value) && photoList.value.length) {
        const retryOrder = moveByIds(photoList.value, sourceId, targetId)
        const retryIds = retryOrder ? toPhotoIds(retryOrder) : null
        if (retryOrder && retryIds) {
          item.value = {
            ...item.value,
            photos: retryOrder,
          }
          try {
            await reorderSeriesPhotos(seriesKey, retryIds)
            reorderingPhotos.value = false
            onPhotoDragEnd()
            return
          } catch (_) {
            // fall through to common rollback below
          }
        }
      }
    }

    item.value = {
      ...item.value,
      photos: previousOrder,
    }
    photoOrderError.value = e?.response?.data?.message || t('Не удалось сохранить порядок фото.')
  } finally {
    reorderingPhotos.value = false
    onPhotoDragEnd()
  }
}

// Открываем модалку удаления серии.
function openDeleteSeriesModal() {
  if (!canEditSeries.value) {
    return
  }

  showDeleteSeriesModal.value = true
  deleteSeriesError.value = ''
}

// Во время активного удаления запрещаем закрытие, чтобы пользователь
// не потерял контекст посреди выполнения запроса.
function closeDeleteSeriesModal() {
  if (deletingSeries.value) {
    return
  }

  showDeleteSeriesModal.value = false
  deleteSeriesError.value = ''
}

// Готовим модалку удаления фото.
function openDeletePhotoModal(photo) {
  if (!photo) return
  photoToDelete.value = photo
  showDeletePhotoModal.value = true
  deletePhotoError.value = ''
}

// `force` нужен для сценария успешного удаления, когда модалку надо закрыть гарантированно.
function closeDeletePhotoModal(force = false) {
  if (deletingPhoto.value && !force) {
    return
  }

  photoToDelete.value = null
  showDeletePhotoModal.value = false
  deletePhotoError.value = ''
}

// Удаление серии целиком.
async function deleteSeries() {
  if (!item.value || !canEditSeries.value) return
  const seriesKey = currentSeriesKey()
  if (!seriesKey) return

  deletingSeries.value = true
  deleteSeriesError.value = ''

  try {
    await deleteSeriesRequest(seriesKey)
    showDeleteSeriesModal.value = false
    await router.push('/series')
  } catch (e) {
    deleteSeriesError.value = e?.response?.data?.message || t('Не удалось удалить серию.')
  } finally {
    deletingSeries.value = false
  }
}

// Загружаем фотографии на сервер небольшими пачками.
// Это уменьшает размер одного запроса и упрощает обработку частичных ошибок.
async function uploadPhotos() {
  if (!canEditSeries.value) {
    return
  }
  const seriesKey = currentSeriesKey()
  if (!seriesKey) return

  uploadError.value = ''
  uploadWarnings.value = []

  if (!uploadFiles.value.length) {
    uploadError.value = 'Please select at least one photo.'
    return
  }

  uploading.value = true

  try {
    const optimizedFiles = [...uploadFiles.value]
    uploadWarnings.value = []

    if (!optimizedFiles.length) {
      uploadError.value = 'No files selected.'
      return
    }

    const failedUploads = []

    for (let start = 0; start < optimizedFiles.length; start += PHOTO_UPLOAD_CHUNK_SIZE) {
      const chunk = optimizedFiles.slice(start, start + PHOTO_UPLOAD_CHUNK_SIZE)
      const formData = new FormData()

      for (const file of chunk) {
        formData.append('photos[]', file)
      }

      const { data } = await uploadSeriesPhotos(seriesKey, formData)
      failedUploads.push(...(data?.photos_failed || []))
    }

    // Если часть файлов не загрузилась, покажем предупреждения по каждому файлу.
    uploadWarnings.value = failedUploads
    uploadFiles.value = []
    showUploadForm.value = false

    if (uploadInput.value) {
      uploadInput.value.value = ''
    }

    await loadSeries()
  } catch (e) {
    uploadError.value = formatValidationError(e)
  } finally {
    uploading.value = false
  }
}

// Здесь удаление еще не происходит — только открываем подтверждение.
async function deletePhoto(photo) {
  if (!item.value || !photo || !canEditSeries.value) return
  openDeletePhotoModal(photo)
}

// Реальное удаление фото после подтверждения в модалке.
async function confirmDeletePhoto() {
  if (!item.value || !photoToDelete.value || !canEditSeries.value) return
  const seriesKey = currentSeriesKey()
  if (!seriesKey) return

  const deletedPhotoId = Number(photoToDelete.value.id)
  let deleted = false
  deletingPhoto.value = true
  deletePhotoError.value = ''

  try {
    await deleteSeriesPhoto(seriesKey, deletedPhotoId)
    deleted = true
  } catch (e) {
    deletePhotoError.value = e?.response?.data?.message || t('Не удалось удалить фото.')
  } finally {
    deletingPhoto.value = false
  }

  if (!deleted) {
    return
  }

  closeDeletePhotoModal(true)

  // Если удалили фото, которое было открыто в preview, закрываем модалку.
  if (selectedPhoto.value?.id === deletedPhotoId) {
    closePreview()
  }

  // Apply immediate UI update so modal/list do not depend on follow-up reload.
  if (item.value) {
    const currentPhotos = Array.isArray(item.value.photos) ? item.value.photos : []
    const nextPhotos = currentPhotos.filter((photo) => Number(photo?.id) !== deletedPhotoId)
    const currentCount = Number(item.value.photos_count)
    const nextCount = Number.isFinite(currentCount)
      ? Math.max(0, currentCount - 1)
      : nextPhotos.length

    item.value = {
      ...item.value,
      photos: nextPhotos,
      photos_count: nextCount,
    }
  }

  loadSeries({ silent: true }).catch(() => {})
}

// Переименование пока реализовано через системный `prompt`.
// Это простой способ, но UX здесь менее удобный, чем у обычной формы.
async function renamePhoto(photo) {
  if (!item.value || !photo || !canEditSeries.value) return
  const seriesKey = currentSeriesKey()
  if (!seriesKey) return

  const currentName = String(photo.original_name || '')
  const dotIndex = currentName.lastIndexOf('.')
  const currentExtension = dotIndex > 0 ? currentName.slice(dotIndex + 1) : 'jpg'
  const currentBaseName = dotIndex > 0 ? currentName.slice(0, dotIndex) : currentName || String(photo.id)

  const nextName = window.prompt(
    t('Новое название файла (расширение .{ext} менять нельзя)', { ext: currentExtension }),
    currentBaseName
  )
  if (nextName === null) return

  const normalized = nextName.trim()
  if (!normalized) return

  try {
    await renameSeriesPhoto(seriesKey, photo.id, normalized)

    await loadSeries()
  } catch (e) {
    error.value = e?.response?.data?.message || t('Не удалось переименовать фото.')
  }
}

// На странице серии уже есть массив фотографий, поэтому
// скачивание одной фотографии сводится к вызову общего composable.
async function downloadPhotoOriginal(photo) {
  const seriesKey = currentSeriesKey()
  if (!seriesKey || !photo?.id) return

  error.value = ''

  downloadSeriesPhoto(seriesKey, photo, t('Не удалось скачать оригинал фото.')).catch((e) => {
    error.value = e?.message || t('Не удалось скачать оригинал фото.')
  })
}

// Ручной запуск обновления автоматически сгенерированных тегов.
async function refreshAutoTags() {
  if (!canEditSeries.value) return
  const seriesKey = currentSeriesKey()
  if (!seriesKey) return

  refreshingTags.value = true
  refreshTagsError.value = ''
  refreshTagsInfo.value = ''

  try {
    const { data } = await refreshSeriesAutoTags(seriesKey)
    const processed = Number(data?.data?.processed || 0)
    const failed = Number(data?.data?.failed || 0)
    const tagsCount = Number(data?.data?.tags_count || 0)
    const visionEnabled = Boolean(data?.data?.vision_enabled)
    const visionHealthy = Boolean(data?.data?.vision_healthy)

    refreshTagsInfo.value = failed > 0
      ? t('Теги обновлены для {processed} фото, ошибок: {failed}.', { processed, failed })
      : t('Теги обновлены для {processed} фото.', { processed })

    if (tagsCount === 0) {
      if (!visionEnabled) {
        refreshTagsInfo.value = `${refreshTagsInfo.value} ${t('Vision-теггер выключен (VISION_TAGGER_ENABLED=false).')}`
      } else if (!visionHealthy) {
        refreshTagsInfo.value = `${refreshTagsInfo.value} ${t('Vision-теггер недоступен по сети.')}`
      }
    }

    // После пересчета перечитываем серию, чтобы UI отобразил новые теги и статусы.
    await loadSeries()
  } catch (e) {
    refreshTagsError.value = e?.response?.data?.message || t('Не удалось обновить теги.')
  } finally {
    refreshingTags.value = false
  }
}

// Админская публикация серии в обход обычного пользовательского сценария.
async function adminPublishSeries() {
  if (!canAdminPublishSeries.value) {
    return
  }

  const seriesKey = currentSeriesKey()
  if (!seriesKey) {
    return
  }

  publishingByAdmin.value = true
  adminPublishError.value = ''
  adminPublishInfo.value = ''

  try {
    const { data } = await publishSeriesAsAdmin(seriesKey)
    item.value = mergeSeriesPayload(data?.data || null)
    adminPublishInfo.value = t('Серия опубликована админом.')
  } catch (e) {
    adminPublishError.value = e?.response?.data?.message || t('Не удалось опубликовать серию.')
  } finally {
    publishingByAdmin.value = false
  }
}

// Главная загрузка серии.
// Умеет работать в нескольких режимах:
// - обычная загрузка со спиннером
// - тихое обновление без смены общего loading
// - загрузка только статуса без фотографий
async function loadSeries(options = {}) {
  const silent = Boolean(options?.silent)
  const statusOnly = Boolean(options?.statusOnly)
  const includePhotos = typeof options?.includePhotos === 'boolean'
    ? options.includePhotos
    : !statusOnly
  let loaded = false

  if (!silent) {
    loading.value = true
    error.value = ''
  }

  try {
    let data = null

    // Если пользователь авторизован, сначала пробуем приватный endpoint:
    // он может вернуть больше данных, чем публичный.
    if (isAuthenticated.value) {
      try {
        const response = await getSeries(
          route.params.slug,
          includePhotos
            ? { include_photos: 1, photos_limit: 100 }
            : {
              status_only: 1,
              include_blocking_tags: canViewModerationTags.value ? 1 : 0,
            },
        )
        data = response.data
      } catch (e) {
        if (e?.response?.status !== 401) {
          throw e
        }
      }
    }

    if (!data) {
      const response = await getPublicSeries(
        route.params.slug,
        includePhotos
          ? { include_photos: 1, photos_limit: 100 }
          : {
            status_only: 1,
            include_blocking_tags: canViewModerationTags.value ? 1 : 0,
          },
      )
      data = response.data
    }

    // Если фотографии реально перечитались, меняем версию URL,
    // чтобы браузер не показывал устаревший кеш картинок.
    if (!silent && includePhotos && Array.isArray(data?.data?.photos)) {
      photoUrlVersion.value = Date.now()
    }
    item.value = mergeSeriesPayload(data?.data || null)
    loaded = true
    ensureStatusPolling()
    ensureTagsPolling()
    const canonical = seriesPath(item.value)
    if (canonical !== route.path) {
      // Если сервер сообщил более правильный canonical path,
      // тихо выравниваем URL в адресной строке.
      router.replace(canonical).catch(() => {})
    }
  } catch (e) {
    if (!silent) {
      if (e?.response?.status === 404) {
        error.value = t('Серия не найдена или не является публичной.')
      } else {
        error.value = e?.response?.data?.message || t('Failed to load series.')
      }
    }
  } finally {
    if (!silent) {
      loading.value = false
    }
  }

  return loaded
}

// Метаданные профиля нужны здесь в основном для вычисления прав:
// владелец ли это, может ли пользователь модерировать и т.д.
async function loadProfileMeta() {
  if (!isAuthenticated.value) {
    return
  }

  if (currentUser.value?.id) {
    return
  }

  try {
    const { data } = await getProfile()
    const user = data?.data || null
    if (!user) {
      return
    }

    currentUser.value = user
    setCurrentUser(user)
  } catch (_) {
    // Keep read-only mode when profile metadata is unavailable.
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointerdown', onDocumentPointerDown)

  // Сначала узнаем пользователя, затем грузим серию.
  // Так права и кнопки действий будут корректны уже при первом рендере.
  loadProfileMeta().finally(() => {
    loadSeries()
  })
})

onBeforeUnmount(() => {
  // Чистим глобальные слушатели и таймеры, чтобы не оставлять "висящие" эффекты
  // после ухода со страницы.
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerdown', onDocumentPointerDown)
  stopStatusPolling()
  stopTagsPolling()
  cleanupSeriesTags()
})

// Если пользователь перешел на другую серию, не размонтируя компонент,
// сбрасываем состояние, привязанное к предыдущей серии, и загружаем новую.
watch(() => route.params.slug, () => {
  stopStatusPolling()
  stopTagsPolling()
  openExifByPhotoId.value = {}
  exifPlacementByPhotoId.value = {}
  closePreview()
  loadProfileMeta().finally(() => {
    loadSeries()
  })
})

</script>

<template>
  <div class="series-page">
    <div class="series-shell">
      <p class="back-link"><a href="/" @click.prevent="goBack">{{ t('← Назад') }}</a></p>

      <p v-if="loading" class="state-text">{{ t('Загрузка...') }}</p>
      <p v-else-if="error" class="error">{{ error }}</p>

      <template v-else-if="item">
        <header class="series-header">
          <div>
            <h1>{{ item.title }}</h1>
            <p class="series-meta">
              {{ formatDate(item.created_at) }} · {{ item.photos_count }} {{ t('фото') }}
              <span v-if="item.taken_at">{{ t('Съёмка') }}: {{ formatDate(item.taken_at) }}</span>
              <span
                class="series-visibility"
                :class="visibilityClass(item)"
              >
                {{ visibilityLabel(item) }}
              </span>
            </p>
          </div>
          <div v-if="canEditSeries || canAdminPublishSeries" class="series-actions">
            <button
              v-if="canEditSeries"
              type="button"
              class="ghost-btn"
              @click="showUploadForm = !showUploadForm"
            >
              {{ showUploadForm ? t('Скрыть форму') : t('Добавить фото') }}
            </button>
            <button
              v-if="canEditSeries"
              type="button"
              class="ghost-btn"
              :disabled="isSeriesDownloading(currentSeriesKey())"
              @click="downloadWholeSeries"
            >
              {{
                isSeriesDownloading(currentSeriesKey())
                  ? (downloadProgressText(currentSeriesKey()) || t('Скачиваем серию...'))
                  : t('Скачать серию')
              }}
            </button>
            <button
              v-if="canEditSeries"
              type="button"
              class="ghost-btn"
              :disabled="refreshingTags"
              @click="refreshAutoTags"
            >
              {{ refreshingTags ? t('Обновляем теги...') : t('Обновить теги') }}
            </button>
            <button
              v-if="canAdminPublishSeries"
              type="button"
              class="ghost-btn"
              :disabled="publishingByAdmin"
              @click="adminPublishSeries"
            >
              {{ publishingByAdmin ? t('Публикуем...') : t('Опубликовать (админ)') }}
            </button>
            <button
              v-if="canEditSeries"
              type="button"
              class="ghost-btn icon-btn"
              @click="openEditSeries"
              :title="t('Редактировать')"
            >
              ✎
            </button>
            <button
              v-if="canEditSeries"
              type="button"
              class="danger-btn icon-btn"
              @click="openDeleteSeriesModal"
              :title="t('Удалить серию')"
            >
              🗑
            </button>
          </div>
        </header>

        <p v-if="item.description" class="series-description">{{ item.description }}</p>
        <p v-if="item.moderation_reason && publicationStatus(item) === 'rejected'" class="error">{{ item.moderation_reason }}</p>
        <p v-if="adminPublishError" class="error">{{ adminPublishError }}</p>
        <p v-else-if="adminPublishInfo" class="hint">{{ adminPublishInfo }}</p>
        <div class="series-tags">
          <span v-for="tag in seriesTags" :key="tag.id" class="series-tag">
            #{{ tag.name }}
            <button
              v-if="canEditSeries && isEditingSeries"
              type="button"
              class="series-tag-remove"
              :disabled="removingTagId === tag.id"
              @click="removeSeriesTag(tag)"
            >
              ×
            </button>
          </span>

          <button
            v-if="canEditSeries && isEditingSeries && !showTagInput"
            type="button"
            class="series-tag-add"
            @click="openTagInput"
          >
            +
          </button>

          <form v-if="canEditSeries && isEditingSeries && showTagInput" class="series-tag-inline-form" @submit.prevent="addSeriesTag">
            <div class="series-tag-input-wrap">
              <input
                v-model="newTagName"
                type="text"
                maxlength="50"
                placeholder="new tag"
                @keydown.esc.prevent="closeTagInput"
                @input="scheduleTagSuggestions"
                @focus="scheduleTagSuggestions"
              />
              <div v-if="tagSuggestionsLoading" class="series-tag-suggest-hint">{{ t('Поиск...') }}</div>
              <ul v-else-if="tagSuggestions.length" class="series-tag-suggestions">
                <li v-for="name in tagSuggestions" :key="name">
                  <button type="button" @click="pickSuggestedTag(name)">#{{ name }}</button>
                </li>
              </ul>
            </div>
            <button type="submit" class="series-tag-inline-btn" :disabled="addingTag">
              {{ addingTag ? '...' : 'OK' }}
            </button>
            <button type="button" class="series-tag-inline-btn" :disabled="addingTag" @click="closeTagInput">
              ×
            </button>
          </form>
        </div>
        <p v-if="showPendingTagsHint" class="hint tags-pending-hint">
          {{ t('Теги появятся через несколько секунд. Мы добавляем их автоматически.') }}
        </p>
        <p v-if="canViewModerationTags && moderationTags.length" class="moderation-tags">
          <strong>{{ t('Модерация') }}:</strong>
          <span
            v-for="label in moderationTags"
            :key="label"
            class="series-tag series-tag--moderation"
          >
            #{{ label }}
          </span>
        </p>
        <p v-if="refreshTagsError" class="error">{{ refreshTagsError }}</p>
        <p v-else-if="refreshTagsInfo" class="hint">{{ refreshTagsInfo }}</p>
        <p v-if="tagEditError" class="error">{{ tagEditError }}</p>

        <section v-if="canEditSeries && showUploadForm" class="upload-panel">
          <h2>{{ t('Добавить фото') }}</h2>

          <form class="upload-form" @submit.prevent="uploadPhotos">
            <input
              ref="uploadInput"
              name="photos[]"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              multiple
              @change="onUploadFilesChanged"
            />

            <small class="hint">{{ t('Оптимизация перед отправкой: до 2MB после оптимизации, оригиналы до 100MB поддерживаются.') }}</small>
            <small class="hint" v-if="uploadFiles.length">{{ t('Выбрано: {count} файл(ов)', { count: uploadFiles.length }) }}</small>

            <p v-if="uploadError" class="error">{{ uploadError }}</p>

            <ul v-if="uploadWarnings.length" class="warnings">
              <li v-for="(warning, index) in uploadWarnings" :key="index">
                {{ warning.original_name }}: {{ warning.message }}
              </li>
            </ul>

            <button type="submit" class="primary-btn" :disabled="uploading">
              {{ uploading ? t('Загрузка...') : t('Загрузить фото') }}
            </button>
          </form>
        </section>

        <section v-if="canEditSeries && isEditingSeries" class="upload-panel">
          <h2>{{ t('Редактировать серию') }}</h2>
          <form class="upload-form" @submit.prevent="saveSeries">
            <label>
              {{ t('Название') }}
              <input v-model="editTitle" type="text" maxlength="255" required />
            </label>
            <label>
              {{ t('Описание') }}
              <textarea v-model="editDescription" rows="3"></textarea>
            </label>
            <label class="checkbox-field">
              <input v-model="editIsPublic" type="checkbox" />
              <span>{{ t('Публичная серия') }}</span>
            </label>

            <p v-if="editError" class="error">{{ editError }}</p>
            <p v-else-if="editInfo" class="hint">{{ editInfo }}</p>

            <div class="inline-actions">
              <button type="submit" class="primary-btn" :disabled="savingSeries">
                {{ savingSeries ? t('Сохраняем...') : t('Сохранить') }}
              </button>
              <button type="button" class="ghost-btn" @click="cancelEditSeries">{{ t('Отмена') }}</button>
            </div>
          </form>
        </section>

        <p v-if="photoOrderError" class="error">{{ photoOrderError }}</p>

        <section v-if="photoList.length" ref="previewGridRef" class="preview-grid">
          <div
            v-for="(row, rowIndex) in previewRows"
            :key="`row-${rowIndex}`"
            class="preview-row"
            :style="{ columnGap: `${row.gap}px` }"
          >
            <article
              v-for="tile in row.tiles"
              :key="tile.photo.id"
              class="preview-card"
              :class="{
                'preview-card--dragging': draggingPhotoId === tile.photo.id,
                'preview-card--drag-over': dragOverPhotoId === tile.photo.id,
              }"
              :style="{ width: `${tile.width}px` }"
              :draggable="canEditSeries && !isExifOpen(tile.photo)"
              @dragstart="onPhotoDragStart(tile.photo, $event)"
              @dragenter.prevent="onPhotoDragEnter(tile.photo)"
              @dragover.prevent
              @drop.prevent="onPhotoDrop(tile.photo)"
              @dragend="onPhotoDragEnd"
            >
              <div
                class="preview-card-image-wrap"
                :style="{ height: `${row.height}px` }"
                @click="openPreview(tile.photo)"
              >
                <LazyPhotoThumb
                  class="preview-card-image"
                  :src="resolvedPhotoUrl(tile.photo)"
                  :fallback-src="resolvedPhotoFallbackUrl(tile.photo)"
                  :alt="tile.photo.original_name || 'photo'"
                  :eager="true"
                />
              </div>
              <div class="preview-card-meta">
                <strong class="preview-card-name" :title="tile.photo.original_name || ''">{{ tile.photo.original_name }}</strong>
                <div class="thumb-bottom">
                  <span>{{ tile.photo.mime }} · {{ formatSize(tile.photo.size) }}</span>
                  <div class="thumb-actions">
                    <button
                      v-if="exifRowsForPhoto(tile.photo).length"
                      type="button"
                      class="icon-ghost-btn exif-btn"
                      :title="t('Показать EXIF')"
                      @click.stop="toggleExif(tile.photo, $event)"
                    >
                      {{ isExifOpen(tile.photo) ? t('EXIF −') : t('EXIF') }}
                    </button>
                    <button
                      v-if="canEditSeries"
                      type="button"
                      class="icon-ghost-btn"
                      :disabled="isPhotoDownloading(currentSeriesKey(), tile.photo.id) || isSeriesDownloading(currentSeriesKey())"
                      :title="t('Скачать оригинал')"
                      @click.stop="downloadPhotoOriginal(tile.photo)"
                    >
                      {{ isPhotoDownloading(currentSeriesKey(), tile.photo.id) ? '…' : '⤓' }}
                    </button>
                    <button v-if="canEditSeries" type="button" class="icon-ghost-btn" :title="t('Переименовать')" @click.stop="renamePhoto(tile.photo)">✎</button>
                    <button v-if="canEditSeries" type="button" class="icon-ghost-btn" :title="t('Удалить')" @click.stop="deletePhoto(tile.photo)">🗑</button>
                  </div>
                </div>
                <div
                  v-if="isExifOpen(tile.photo)"
                  class="photo-exif"
                  :class="{
                    'photo-exif--up': exifPlacement(tile.photo) === 'up',
                    'photo-exif--down': exifPlacement(tile.photo) === 'down',
                  }"
                  draggable="false"
                  @click.stop
                  @mousedown.stop.prevent
                  @dragstart.stop.prevent
                >
                  <div v-for="row in exifRowsForPhoto(tile.photo)" :key="`${tile.photo.id}-${row.key}`" class="photo-exif-row">
                    <span class="photo-exif-label">{{ row.label }}</span>
                    <span class="photo-exif-value">{{ row.value }}</span>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>

      <p v-else class="state-text">{{ t('В этой серии пока нет фото.') }}</p>
      </template>
    </div>

    <PhotoPreviewModal
      :open="Boolean(selectedPhoto)"
      :photo="selectedPhoto"
      :src="resolvedPhotoOriginalUrl(selectedPhoto)"
      :can-prev="canPreviewPrev"
      :can-next="canPreviewNext"
      @close="closePreview"
      @prev="openPrevPhoto"
      @next="openNextPhoto"
    />

    <div v-if="canEditSeries && showDeleteSeriesModal" class="confirm-overlay" @click.self="closeDeleteSeriesModal">
      <div class="confirm-modal">
        <h2>{{ t('Удалить серию?') }}</h2>
        <p>
          {{ t('Серия') }} <strong>{{ item?.title || t('Без названия') }}</strong> {{ t('будет удалена без возможности восстановления.') }}
        </p>

        <p v-if="deleteSeriesError" class="error">{{ deleteSeriesError }}</p>

        <div class="confirm-actions">
          <button type="button" class="danger-btn" :disabled="deletingSeries" @click="deleteSeries">
            {{ deletingSeries ? t('Удаляем...') : t('Удалить навсегда') }}
          </button>
          <button type="button" class="ghost-btn" :disabled="deletingSeries" @click="closeDeleteSeriesModal">
            {{ t('Отмена') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="canEditSeries && showDeletePhotoModal" class="confirm-overlay" @click.self="closeDeletePhotoModal">
      <div class="confirm-modal">
        <h2>{{ t('Удалить фото?') }}</h2>
        <p>
          {{ t('Фото') }}
          <strong>{{ photoToDelete?.original_name || `#${photoToDelete?.id || ''}` }}</strong>
          {{ t('будет удалено без возможности восстановления.') }}
        </p>

        <p v-if="deletePhotoError" class="error">{{ deletePhotoError }}</p>

        <div class="confirm-actions">
          <button type="button" class="danger-btn" :disabled="deletingPhoto" @click="confirmDeletePhoto">
            {{ deletingPhoto ? t('Удаляем...') : t('Удалить навсегда') }}
          </button>
          <button type="button" class="ghost-btn" :disabled="deletingPhoto" @click="closeDeletePhotoModal">
            {{ t('Отмена') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.series-page {
  min-height: calc(100vh - 58px);
  padding: 18px;
  background:
    radial-gradient(650px 180px at 15% 0%, rgba(183, 201, 190, 0.35), transparent 65%),
    radial-gradient(900px 230px at 100% 15%, rgba(218, 206, 188, 0.28), transparent 70%),
    var(--bg);
  color: var(--text);
}

.series-shell {
  max-width: 1360px;
  margin: 0 auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  box-shadow: 0 18px 36px rgba(79, 86, 80, 0.1);
  padding: 24px;
}

.back-link {
  margin: 0 0 18px;
}

.back-link a {
  color: #3f6d56;
  text-decoration: none;
  font-weight: 700;
}

.back-link a:hover {
  text-decoration: underline;
}

.series-header h1 {
  margin: 0;
  font-size: 48px;
  line-height: 1.04;
  letter-spacing: -0.03em;
}

.series-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 8px;
}

.series-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.series-meta {
  margin: 12px 0 0;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 15px;
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

.series-description {
  margin: 16px 0 18px;
  font-size: 19px;
  line-height: 1.42;
  color: #4b574f;
}

.series-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 20px;
}

.moderation-tags {
  margin: -6px 0 16px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.series-tag--moderation {
  background: rgba(179, 53, 53, 0.1);
  border-color: rgba(179, 53, 53, 0.28);
  color: #922525;
}

.series-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #ced8cd;
  border-radius: 999px;
  background: #eef3ed;
  color: #4f6354;
  padding: 2px 8px;
  font-size: 12px;
  line-height: 1.2;
}

.series-tag-remove {
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #4f6354;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  width: 16px;
  height: 16px;
  font-size: 14px;
}

.series-tag-remove:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.series-tag-add {
  position: relative;
  display: inline-grid;
  place-items: center;
  border: 1px dashed #9db5a4;
  border-radius: 999px;
  background: #f4f8f2;
  color: #3f6d56;
  cursor: pointer;
  width: 26px;
  height: 24px;
  line-height: 0;
  font-size: 0;
  padding: 0;
  vertical-align: middle;
}

.series-tag-add::before {
  content: '+';
  position: absolute;
  left: 50%;
  top: 50%;
  font-size: 16px;
  line-height: 1;
  transform: translate(-50%, -50%);
}

.series-tag-inline-form {
  display: inline-flex;
  align-items: flex-start;
  gap: 4px;
}

.series-tag-input-wrap {
  position: relative;
}

.series-tag-inline-form input {
  width: 128px;
  box-sizing: border-box;
  border: 1px solid #ced8cd;
  border-radius: 999px;
  background: #fff;
  color: #4f6354;
  padding: 3px 9px;
  font-size: 12px;
  line-height: 1.2;
}

.series-tag-suggest-hint {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  font-size: 11px;
  color: #71807a;
}

.series-tag-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  margin: 0;
  padding: 4px;
  list-style: none;
  min-width: 148px;
  max-width: 220px;
  border: 1px solid #ced8cd;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 8px 18px rgba(33, 49, 41, 0.12);
}

.series-tag-suggestions li + li {
  margin-top: 2px;
}

.series-tag-suggestions button {
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
}

.series-tag-suggestions button:hover {
  background: #eef3ed;
}

.series-tag-inline-btn {
  border: 1px solid #ced8cd;
  border-radius: 999px;
  background: #eef3ed;
  color: #4f6354;
  cursor: pointer;
  min-width: 24px;
  height: 22px;
  font-size: 11px;
  padding: 0 7px;
}

.tags-pending-hint {
  margin: 8px 0 0;
}

.upload-panel {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fbfcfa;
  padding: 14px;
  margin-bottom: 16px;
}

.upload-panel h2 {
  margin: 0 0 10px;
}

.preview-grid {
  width: 100%;
  max-width: 100%;
  display: grid;
  row-gap: 12px;
  margin-top: 8px;
  overflow: visible;
}

.preview-row {
  width: 100%;
  max-width: 100%;
  display: flex;
  align-items: flex-start;
  overflow: visible;
}

.preview-card {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: visible;
  background: #fcfdfb;
  user-select: none;
}

.preview-card[draggable='true'] {
  cursor: grab;
}

.preview-card[draggable='true']:active {
  cursor: grabbing;
}

.preview-card--dragging {
  opacity: 0.55;
}

.preview-card--drag-over {
  border-color: #87ad98;
  box-shadow: inset 0 0 0 2px rgba(79, 131, 102, 0.18);
}

.preview-card-image-wrap {
  width: 100%;
  background: #f3f6f1;
  cursor: zoom-in;
  overflow: hidden;
  border-radius: 10px 10px 0 0;
}

.preview-card-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  --thumb-min-height: 0px;
}

.preview-card-image :deep(.thumb-wrap) {
  height: 100%;
  min-height: 0;
}

.preview-card-image :deep(.thumb) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.preview-card-meta {
  position: relative;
  display: grid;
  gap: 5px;
  padding: 10px;
  font-size: 13px;
  border-top: 1px solid #e4e9e2;
  background: #fcfdfb;
  border-radius: 0 0 10px 10px;
  z-index: 2;
  overflow: visible;
}

.preview-card-meta span {
  color: var(--muted);
}

.preview-card-name {
  min-width: 0;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.thumb-bottom {
  display: grid;
  width: 100%;
  grid-template-columns: 1fr;
  align-items: start;
  gap: 8px;
}

.thumb-bottom span {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

.thumb-actions {
  display: inline-flex;
  flex-wrap: nowrap;
  gap: 6px;
  justify-self: end;
  align-items: center;
  max-width: 100%;
}

.icon-ghost-btn {
  border: 1px solid #c9d3c8;
  border-radius: 7px;
  background: #eef2ec;
  color: #4a5b4f;
  cursor: pointer;
  min-width: 30px;
  height: 28px;
  line-height: 1;
  padding: 0;
}

.icon-ghost-btn:hover {
  background: #e3e9e1;
}

.exif-btn {
  min-width: 56px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 700;
}

.photo-exif {
  display: grid;
  gap: 4px;
  position: absolute;
  right: 8px;
  z-index: 40;
  width: max-content;
  max-width: min(420px, calc(100vw - 36px));
  padding: 9px 10px;
  border: 1px solid #d3dbd0;
  border-radius: 9px;
  background: #f8faf6;
  box-shadow: 0 10px 24px rgba(38, 50, 42, 0.14);
}

.photo-exif--up {
  bottom: calc(100% + 6px);
}

.photo-exif--down {
  top: calc(100% + 6px);
}

.photo-exif-row {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
}

.photo-exif-label {
  color: #71807a;
  font-size: 11px;
}

.photo-exif-value {
  color: #3f4f45;
  font-size: 12px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.warnings {
  margin: 0;
  padding-left: 16px;
  color: #87520b;
}

@media (max-width: 680px) {
  .series-page {
    padding: 10px 0 20px;
  }

  .series-shell {
    border-radius: 0;
    padding: 16px 14px;
  }

  .series-header h1 {
    font-size: 32px;
  }

  .series-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .series-description {
    font-size: 17px;
  }

  .preview-grid {
    width: 100%;
    row-gap: 10px;
    margin-top: 6px;
  }

  .preview-row {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr;
    row-gap: 10px;
  }

  .preview-card {
    width: 100% !important;
  }

  .preview-card-image-wrap {
    min-height: 180px;
  }

  .preview-card-meta {
    padding: 9px;
    gap: 4px;
  }

  .preview-card-meta span {
    font-size: 12px;
    line-height: 1.25;
  }

  .thumb-actions {
    justify-self: start;
    gap: 5px;
  }

  .icon-ghost-btn {
    min-width: 26px;
    height: 24px;
    font-size: 13px;
  }

  .exif-btn {
    min-width: 46px;
    padding: 0 6px;
    font-size: 10px;
  }

  .photo-exif-row {
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 6px;
  }

  .photo-exif {
    right: 6px;
    max-width: calc(100vw - 24px);
    padding: 8px 9px;
  }
}
</style>
