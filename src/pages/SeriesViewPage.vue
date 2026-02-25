<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { formatValidationErrorMessage } from '../lib/formErrors'
import { resolveMissingAspectRatios } from '../lib/imageAspectRatio'
import { optimizeImagesForUpload } from '../lib/imageOptimizer'
import { buildPreviewRowsWithDynamicGrid } from '../lib/previewRows'
import LazyPhotoThumb from '../components/LazyPhotoThumb.vue'
import PhotoPreviewModal from '../components/PhotoPreviewModal.vue'
import { seriesPath, seriesSlugOrId } from '../lib/seriesPath'
import { buildStorageUrl, withCacheBust } from '../lib/url'
import { buildUploadValidationMessage, findInvalidUploadIssue } from '../lib/uploadPolicy'
import { getUser, isAuthenticated, setCurrentUser } from '../lib/session'
import { currentLocale, t } from '../lib/i18n'

const route = useRoute()
const router = useRouter()

const item = ref(null)
const loading = ref(true)
const error = ref('')

const uploadFiles = ref([])
const uploadInput = ref(null)
const uploading = ref(false)
const uploadError = ref('')
const uploadWarnings = ref([])
const showUploadForm = ref(false)

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
const showDeletePhotoModal = ref(false)
const photoToDelete = ref(null)
const deletingPhoto = ref(false)
const deletePhotoError = ref('')
const draggingPhotoId = ref(null)
const dragOverPhotoId = ref(null)
const reorderingPhotos = ref(false)
const photoOrderError = ref('')
const suppressPreviewOpen = ref(false)
const refreshingTags = ref(false)
const refreshTagsError = ref('')
const refreshTagsInfo = ref('')
const adminPublishError = ref('')
const adminPublishInfo = ref('')
const publishingByAdmin = ref(false)
const newTagName = ref('')
const addingTag = ref(false)
const removingTagId = ref(null)
const tagEditError = ref('')
const showTagInput = ref(false)
const tagSuggestions = ref([])
const tagSuggestionsLoading = ref(false)
const photoUrlVersion = ref(0)
const previewGridWidth = ref(0)
const previewAspectRatios = ref({})
const previewGridRef = ref(null)
let previewResizeObserver = null
let tagSuggestTimerId = null
let tagSuggestRequestId = 0
let previewRatioRequestId = 0
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

const photoList = computed(() => item.value?.photos || [])
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
const canEditSeries = computed(() => {
  const ownerId = Number(item.value?.user_id || 0)
  const currentUserId = Number(currentUser.value?.id || 0)

  return ownerId > 0 && currentUserId > 0 && ownerId === currentUserId
})
const canViewModerationTags = computed(() => Boolean(currentUser.value?.can_moderate))
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

const attachedTagLookup = computed(() => {
  return new Set(seriesTags.value.map((tag) => tag.name.toLowerCase()))
})

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

function scheduleStatusPoll(delayMs) {
  if (statusPollTimerId !== null) {
    clearTimeout(statusPollTimerId)
  }
  statusPollTimerId = window.setTimeout(pollSeriesStatusTick, delayMs)
}

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

function stopTagsPolling() {
  if (tagsPollTimerId !== null) {
    clearTimeout(tagsPollTimerId)
    tagsPollTimerId = null
  }
  tagsPollInFlight = false
  tagsPollAttempts = 0
}

function scheduleTagsPoll(delayMs) {
  if (tagsPollTimerId !== null) {
    clearTimeout(tagsPollTimerId)
  }
  tagsPollTimerId = window.setTimeout(pollSeriesTagsTick, delayMs)
}

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

async function loadSeriesTagsOnly() {
  const seriesKey = currentSeriesKey()
  if (!seriesKey || !item.value) {
    return false
  }

  try {
    let data = null

    if (isAuthenticated.value) {
      try {
        const response = await api.get(`/series/${seriesKey}`, {
          params: {
            include_blocking_tags: canViewModerationTags.value ? 1 : 0,
          },
        })
        data = response.data
      } catch (e) {
        if (e?.response?.status !== 401) {
          throw e
        }
      }
    }

    if (!data) {
      const response = await api.get(`/public/series/${seriesKey}`, {
        params: {
          include_blocking_tags: canViewModerationTags.value ? 1 : 0,
        },
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

function currentSeriesKey() {
  const keyFromItem = seriesSlugOrId(item.value)
  if (keyFromItem) {
    return keyFromItem
  }

  return String(route.params.slug || '').trim()
}

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

function publicPhotoUrl(photo) {
  const direct = String(photo?.public_url || '').trim()
  if (direct) {
    return direct
  }

  return photoUrl(photo?.path)
}

function resolvedPhotoUrl(photo) {
  const signed = String(photo?.preview_url || '').trim()
  if (signed) {
    return signed
  }

  return withCacheBust(publicPhotoUrl(photo), photoUrlVersion.value)
}

function resolvedPhotoOriginalUrl(photo) {
  const original = withCacheBust(publicPhotoUrl(photo), photoUrlVersion.value)
  if (original) {
    return original
  }

  return resolvedPhotoUrl(photo)
}

function resolvedPhotoFallbackUrl(photo) {
  if (!photo?.preview_url) {
    return ''
  }

  return withCacheBust(publicPhotoUrl(photo), photoUrlVersion.value)
}

const previewRows = computed(() => {
  const photos = photoList.value
  if (!photos.length) {
    return []
  }

  const width = previewGridWidth.value || 1120
  return buildPreviewRowsWithDynamicGrid(
    photos,
    width,
    previewAspectRatios.value,
    {
      gap: 10,
      minPerRow: 2,
      maxPerRow: 5,
      minTileWidthMobile: 180,
      minTileWidthDesktop: 180,
      mobileBreakPoint: 760,
      targetRowHeight: 300,
      minRowHeight: 210,
      maxRowHeight: 420,
      singleMaxHeight: 300,
    },
  ).rows
})

function syncPreviewGridObserver() {
  if (!previewResizeObserver) {
    return
  }

  previewResizeObserver.disconnect()

  if (!previewGridRef.value) {
    return
  }

  previewResizeObserver.observe(previewGridRef.value)
  previewGridWidth.value = previewGridRef.value.clientWidth || 0
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

function publicationStatus(series) {
  return String(series?.publication_status || '').trim()
}

function visibilityLabel(series) {
  const status = publicationStatus(series)
  if (status === 'pending_moderation') {
    return t('На модерации')
  }
  if (status === 'rejected') {
    return t('Отклонена')
  }
  if (status === 'published') {
    const moderation = String(series?.moderation_status || '').trim()
    return moderation === 'manual_approved' ? t('Опубликована админом') : t('Публичная')
  }

  return t('Приватная')
}

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

function openEditSeries() {
  if (!item.value || !canEditSeries.value) return

  isEditingSeries.value = true
  editError.value = ''
  editInfo.value = ''
  editTitle.value = item.value.title || ''
  editDescription.value = item.value.description || ''
  editIsPublic.value = Boolean(item.value.is_public) || publicationStatus(item.value) === 'pending_moderation'
}

function cancelEditSeries() {
  isEditingSeries.value = false
  editError.value = ''
  editInfo.value = ''
}

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
    const { data } = await api.patch(`/series/${seriesKey}`, {
      title: editTitle.value,
      description: editDescription.value || null,
      is_public: editIsPublic.value,
    })

    const updated = data?.data || {}
    item.value = {
      ...item.value,
      ...updated,
      photos: item.value?.photos || [],
    }
    if (publicationStatus(updated) === 'pending_moderation') {
      editInfo.value = t('Серия отправлена на модерацию перед публикацией.')
    }
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

function closePreview() {
  selectedPhoto.value = null
}

function openPrevPhoto() {
  if (!canPreviewPrev.value) {
    return
  }

  selectedPhoto.value = photoList.value[selectedPhotoIndex.value - 1] || null
}

function openNextPhoto() {
  if (!canPreviewNext.value) {
    return
  }

  selectedPhoto.value = photoList.value[selectedPhotoIndex.value + 1] || null
}

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

function onPhotoDragStart(photo, event) {
  if (!canEditSeries.value) {
    return
  }

  if (reorderingPhotos.value) {
    return
  }

  draggingPhotoId.value = photo.id
  dragOverPhotoId.value = null
  photoOrderError.value = ''

  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(photo.id))
  }
}

function onPhotoDragEnter(photo) {
  if (draggingPhotoId.value === null || draggingPhotoId.value === photo.id) {
    return
  }

  dragOverPhotoId.value = photo.id
}

function onPhotoDragEnd() {
  draggingPhotoId.value = null
  dragOverPhotoId.value = null
}

async function onPhotoDrop(targetPhoto) {
  if (!canEditSeries.value) {
    onPhotoDragEnd()
    return
  }

  if (!item.value || draggingPhotoId.value === null || draggingPhotoId.value === targetPhoto.id) {
    onPhotoDragEnd()
    return
  }

  const previousOrder = [...photoList.value]
  const fromIndex = previousOrder.findIndex((photo) => photo.id === draggingPhotoId.value)
  const toIndex = previousOrder.findIndex((photo) => photo.id === targetPhoto.id)

  if (fromIndex < 0 || toIndex < 0) {
    onPhotoDragEnd()
    return
  }

  const nextOrder = [...previousOrder]
  const [moved] = nextOrder.splice(fromIndex, 1)
  nextOrder.splice(toIndex, 0, moved)

  item.value = {
    ...item.value,
    photos: nextOrder,
  }

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
    await api.patch(`/series/${seriesKey}/photos/reorder`, {
      photo_ids: nextOrder.map((photo) => photo.id),
    })
  } catch (e) {
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

function openDeleteSeriesModal() {
  if (!canEditSeries.value) {
    return
  }

  showDeleteSeriesModal.value = true
  deleteSeriesError.value = ''
}

function closeDeleteSeriesModal() {
  if (deletingSeries.value) {
    return
  }

  showDeleteSeriesModal.value = false
  deleteSeriesError.value = ''
}

function openDeletePhotoModal(photo) {
  if (!photo) return
  photoToDelete.value = photo
  showDeletePhotoModal.value = true
  deletePhotoError.value = ''
}

function closeDeletePhotoModal(force = false) {
  if (deletingPhoto.value && !force) {
    return
  }

  photoToDelete.value = null
  showDeletePhotoModal.value = false
  deletePhotoError.value = ''
}

async function deleteSeries() {
  if (!item.value || !canEditSeries.value) return
  const seriesKey = currentSeriesKey()
  if (!seriesKey) return

  deletingSeries.value = true
  deleteSeriesError.value = ''

  try {
    await api.delete(`/series/${seriesKey}`)
    showDeleteSeriesModal.value = false
    await router.push('/series')
  } catch (e) {
    deleteSeriesError.value = e?.response?.data?.message || t('Не удалось удалить серию.')
  } finally {
    deletingSeries.value = false
  }
}

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
    const { files: optimizedFiles, warnings } = await optimizeImagesForUpload(uploadFiles.value, {
      maxBytes: 2 * 1024 * 1024,
      maxDimension: 3840,
      fallbackToOriginal: true,
    })

    uploadWarnings.value = warnings

    if (!optimizedFiles.length) {
      uploadError.value = 'No files left after optimization.'
      return
    }

    const failedUploads = []

    for (let start = 0; start < optimizedFiles.length; start += PHOTO_UPLOAD_CHUNK_SIZE) {
      const chunk = optimizedFiles.slice(start, start + PHOTO_UPLOAD_CHUNK_SIZE)
      const formData = new FormData()

      for (const file of chunk) {
        formData.append('photos[]', file)
      }

      const { data } = await api.post(`/series/${seriesKey}/photos`, formData)
      failedUploads.push(...(data?.photos_failed || []))
    }

    uploadWarnings.value = [...warnings, ...failedUploads]
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

async function deletePhoto(photo) {
  if (!item.value || !photo || !canEditSeries.value) return
  openDeletePhotoModal(photo)
}

async function confirmDeletePhoto() {
  if (!item.value || !photoToDelete.value || !canEditSeries.value) return
  const seriesKey = currentSeriesKey()
  if (!seriesKey) return

  const deletedPhotoId = Number(photoToDelete.value.id)
  let deleted = false
  deletingPhoto.value = true
  deletePhotoError.value = ''

  try {
    await api.delete(`/series/${seriesKey}/photos/${deletedPhotoId}`)
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
    await api.patch(`/series/${seriesKey}/photos/${photo.id}`, {
      original_name: normalized,
    })

    await loadSeries()
  } catch (e) {
    error.value = e?.response?.data?.message || t('Не удалось переименовать фото.')
  }
}

function downloadPhotoOriginal(photo) {
  const seriesKey = currentSeriesKey()
  if (!seriesKey || !photo?.id) return

  const fallbackName = photo?.original_name || `photo-${photo?.id || 'original'}.jpg`
  const parseFileName = (contentDisposition) => {
    if (!contentDisposition) return fallbackName

    const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
    if (utfMatch?.[1]) {
      try {
        return decodeURIComponent(utfMatch[1].replace(/["']/g, ''))
      } catch (_) {
        return utfMatch[1].replace(/["']/g, '')
      }
    }

    const asciiMatch = contentDisposition.match(/filename="?([^\";]+)"?/i)
    return asciiMatch?.[1] || fallbackName
  }

  api.get(`/series/${seriesKey}/photos/${photo.id}/download`, {
    responseType: 'blob',
  }).then((response) => {
    const fileName = parseFileName(response.headers?.['content-disposition'])
    const blobUrl = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = fileName
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
  }).catch((e) => {
    error.value = e?.response?.data?.message || t('Не удалось скачать оригинал фото.')
  })
}

async function refreshAutoTags() {
  if (!canEditSeries.value) return
  const seriesKey = currentSeriesKey()
  if (!seriesKey) return

  refreshingTags.value = true
  refreshTagsError.value = ''
  refreshTagsInfo.value = ''

  try {
    const { data } = await api.post(`/series/${seriesKey}/photos/retag`)
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

    await loadSeries()
  } catch (e) {
    refreshTagsError.value = e?.response?.data?.message || t('Не удалось обновить теги.')
  } finally {
    refreshingTags.value = false
  }
}

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
    const { data } = await api.post(`/admin/series/${seriesKey}/publish`)
    item.value = mergeSeriesPayload(data?.data || null)
    adminPublishInfo.value = t('Серия опубликована админом.')
  } catch (e) {
    adminPublishError.value = e?.response?.data?.message || t('Не удалось опубликовать серию.')
  } finally {
    publishingByAdmin.value = false
  }
}

async function addSeriesTag() {
  if (!canEditSeries.value) return
  const seriesKey = currentSeriesKey()
  if (!seriesKey) return

  const prepared = String(newTagName.value || '').trim()
  if (!prepared) {
    tagEditError.value = t('Введите тег.')
    return
  }

  addingTag.value = true
  tagEditError.value = ''

  try {
    const { data } = await api.post(`/series/${seriesKey}/tags`, {
      tags: [prepared],
    })

    item.value = mergeSeriesPayload(data?.data)
    newTagName.value = ''
    tagSuggestions.value = []
    closeTagInput()
  } catch (e) {
    tagEditError.value = formatValidationError(e)
  } finally {
    addingTag.value = false
  }
}

function openTagInput() {
  if (!canEditSeries.value) return
  showTagInput.value = true
  tagEditError.value = ''
  scheduleTagSuggestions()
}

function closeTagInput() {
  if (addingTag.value) return
  showTagInput.value = false
  newTagName.value = ''
  tagSuggestions.value = []
  tagSuggestionsLoading.value = false
  if (tagSuggestTimerId !== null) {
    clearTimeout(tagSuggestTimerId)
    tagSuggestTimerId = null
  }
}

async function removeSeriesTag(tag) {
  if (!tag?.id || !canEditSeries.value) return
  const seriesKey = currentSeriesKey()
  if (!seriesKey) return

  removingTagId.value = tag.id
  tagEditError.value = ''

  try {
    const { data } = await api.delete(`/series/${seriesKey}/tags/${tag.id}`)
    item.value = mergeSeriesPayload(data?.data)
  } catch (e) {
    tagEditError.value = e?.response?.data?.message || t('Не удалось удалить тег.')
  } finally {
    removingTagId.value = null
  }
}

function pickSuggestedTag(name) {
  newTagName.value = name
  tagSuggestions.value = []
}

function scheduleTagSuggestions() {
  if (!showTagInput.value) return

  if (tagSuggestTimerId !== null) {
    clearTimeout(tagSuggestTimerId)
  }

  tagSuggestTimerId = window.setTimeout(() => {
    fetchTagSuggestions()
  }, 180)
}

async function fetchTagSuggestions() {
  const query = String(newTagName.value || '').trim()

  const requestId = ++tagSuggestRequestId
  tagSuggestionsLoading.value = true

  try {
    const { data } = await api.get('/tags/suggest', {
      params: {
        q: query || undefined,
        limit: 8,
      },
    })

    if (requestId !== tagSuggestRequestId) {
      return
    }

    const current = query.toLowerCase()
    const existing = attachedTagLookup.value
    tagSuggestions.value = (Array.isArray(data?.data) ? data.data : [])
      .map((tag) => String(tag?.name || '').trim())
      .filter(Boolean)
      .filter((name) => name.toLowerCase() !== current)
      .filter((name) => !existing.has(name.toLowerCase()))
      .slice(0, 8)
  } catch (_) {
    if (requestId === tagSuggestRequestId) {
      tagSuggestions.value = []
    }
  } finally {
    if (requestId === tagSuggestRequestId) {
      tagSuggestionsLoading.value = false
    }
  }
}

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

    if (isAuthenticated.value) {
      try {
        const response = await api.get(`/series/${route.params.slug}`, {
          params: includePhotos
            ? { include_photos: 1 }
            : {
              status_only: 1,
              include_blocking_tags: canViewModerationTags.value ? 1 : 0,
            },
        })
        data = response.data
      } catch (e) {
        if (e?.response?.status !== 401) {
          throw e
        }
      }
    }

    if (!data) {
      const response = await api.get(`/public/series/${route.params.slug}`, {
        params: includePhotos
          ? { include_photos: 1 }
          : {
            status_only: 1,
            include_blocking_tags: canViewModerationTags.value ? 1 : 0,
          },
      })
      data = response.data
    }

    if (!silent && includePhotos && Array.isArray(data?.data?.photos)) {
      photoUrlVersion.value = Date.now()
    }
    item.value = mergeSeriesPayload(data?.data || null)
    loaded = true
    ensureStatusPolling()
    ensureTagsPolling()
    const canonical = seriesPath(item.value)
    if (canonical !== route.path) {
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

async function loadProfileMeta() {
  if (!isAuthenticated.value) {
    return
  }

  if (currentUser.value?.id) {
    return
  }

  try {
    const { data } = await api.get('/profile')
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
  previewResizeObserver = new ResizeObserver((entries) => {
    const [entry] = entries
    const width = Number(entry?.contentRect?.width || 0)
    if (width > 0) {
      previewGridWidth.value = width
    }
  })

  syncPreviewGridObserver()

  window.addEventListener('keydown', onKeydown)
  loadProfileMeta().finally(() => {
    loadSeries()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  previewResizeObserver?.disconnect()
  previewResizeObserver = null
  stopStatusPolling()
  stopTagsPolling()
  if (tagSuggestTimerId !== null) {
    clearTimeout(tagSuggestTimerId)
    tagSuggestTimerId = null
  }
})

watch(() => route.params.slug, () => {
  stopStatusPolling()
  stopTagsPolling()
  closePreview()
  loadProfileMeta().finally(() => {
    loadSeries()
  })
})

watch(photoList, async (photos) => {
  const requestId = ++previewRatioRequestId
  previewAspectRatios.value = {}
  const ratioPatch = await resolveMissingAspectRatios(
    photos,
    {},
    (photo) => resolvedPhotoUrl(photo),
  )
  if (requestId !== previewRatioRequestId) {
    return
  }

  previewAspectRatios.value = ratioPatch
  syncPreviewGridObserver()
}, { immediate: true })

watch(previewGridRef, () => {
  syncPreviewGridObserver()
}, { immediate: true })
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
              :draggable="canEditSeries"
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
                  <div v-if="canEditSeries" class="thumb-actions">
                    <button type="button" class="icon-ghost-btn" :title="t('Скачать оригинал')" @click.stop="downloadPhotoOriginal(tile.photo)">⤓</button>
                    <button type="button" class="icon-ghost-btn" :title="t('Переименовать')" @click.stop="renamePhoto(tile.photo)">✎</button>
                    <button type="button" class="icon-ghost-btn" :title="t('Удалить')" @click.stop="deletePhoto(tile.photo)">🗑</button>
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

.upload-form {
  display: grid;
  gap: 8px;
}

.upload-form input,
.upload-form textarea {
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

.inline-actions {
  display: flex;
  gap: 8px;
}

.preview-grid {
  width: 100%;
  max-width: 100%;
  display: grid;
  row-gap: 12px;
  margin-top: 8px;
  overflow-x: hidden;
}

.preview-row {
  width: 100%;
  max-width: 100%;
  display: flex;
  align-items: flex-start;
  overflow: hidden;
}

.preview-card {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
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
}

.preview-card-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  --thumb-min-height: 0px;
}

.preview-card-meta {
  display: grid;
  gap: 5px;
  padding: 10px;
  font-size: 13px;
  border-top: 1px solid #e4e9e2;
  background: #fcfdfb;
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
  flex-wrap: wrap;
  gap: 6px;
  flex: 0 0 auto;
  justify-self: end;
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

.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(26, 31, 28, 0.65);
  display: grid;
  place-items: center;
  z-index: 70;
  padding: 16px;
}

.confirm-modal {
  width: min(520px, 100%);
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #f9faf7;
  padding: 16px;
  box-shadow: 0 22px 46px rgba(44, 54, 47, 0.25);
}

.confirm-modal h2 {
  margin: 0 0 8px;
}

.confirm-modal p {
  margin: 0 0 8px;
}

.confirm-modal input {
  width: 100%;
  box-sizing: border-box;
  margin-top: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  padding: 10px 11px;
}

.confirm-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.danger-btn {
  border: 1px solid #bc7a7a;
  border-radius: 9px;
  cursor: pointer;
  font-weight: 700;
  padding: 8px 12px;
  background: #f8e9e9;
  color: #7a1e1e;
}

.danger-btn:hover {
  background: #f1dede;
}

.danger-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.icon-btn {
  min-width: 38px;
  padding: 8px 0;
  font-size: 16px;
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
    row-gap: 10px;
    margin-top: 6px;
  }

  .preview-row {
    display: grid;
    grid-template-columns: 1fr;
    row-gap: 10px;
  }

  .preview-card {
    width: 100% !important;
  }

  .preview-card-image-wrap {
    height: auto !important;
    aspect-ratio: 4 / 3;
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
}
</style>
