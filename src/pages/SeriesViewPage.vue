<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { optimizeImagesForUpload } from '../lib/imageOptimizer'
import LazyPhotoThumb from '../components/LazyPhotoThumb.vue'
import PhotoPreviewModal from '../components/PhotoPreviewModal.vue'

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
const editError = ref('')
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
const newTagName = ref('')
const addingTag = ref(false)
const removingTagId = ref(null)
const tagEditError = ref('')
const showTagInput = ref(false)
const tagSuggestions = ref([])
const tagSuggestionsLoading = ref(false)
const photoUrlVersion = ref(0)
let tagSuggestTimerId = null
let tagSuggestRequestId = 0

const selectedPhoto = ref(null)

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_RAW_FILE_SIZE_BYTES = 25 * 1024 * 1024

const photoList = computed(() => item.value?.photos || [])
const seriesTags = computed(() => {
  const tags = (item.value?.tags || [])
    .map((tag) => ({
      id: Number(tag?.id || 0),
      name: String(tag?.name || '').trim(),
    }))
    .filter((tag) => tag.id > 0 && tag.name)

  return tags.sort((a, b) => a.name.localeCompare(b.name))
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

function withCacheBust(url) {
  const source = String(url || '').trim()
  if (!source) {
    return ''
  }

  const separator = source.includes('?') ? '&' : '?'
  return `${source}${separator}v=${photoUrlVersion.value}`
}

function resolvedPhotoUrl(photo) {
  const signed = String(photo?.preview_url || '').trim()
  if (signed) {
    return signed
  }

  return withCacheBust(photoUrl(photo?.path))
}

function resolvedPhotoFallbackUrl(photo) {
  if (!photo?.preview_url) {
    return ''
  }

  return withCacheBust(photoUrl(photo?.path))
}

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
  const invalid = files.find((file) => file.size > MAX_RAW_FILE_SIZE_BYTES || !ALLOWED_TYPES.includes(file.type))

  if (invalid) {
    uploadError.value = `File "${invalid.name}" is invalid. Use JPG/PNG/WEBP up to 25MB.`
    uploadFiles.value = []
    event.target.value = ''
    return
  }

  uploadError.value = ''
  uploadFiles.value = files
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

function openEditSeries() {
  if (!item.value) return

  isEditingSeries.value = true
  editError.value = ''
  editTitle.value = item.value.title || ''
  editDescription.value = item.value.description || ''
}

function cancelEditSeries() {
  isEditingSeries.value = false
  editError.value = ''
}

async function saveSeries() {
  if (!item.value) return
  if (!editTitle.value.trim()) {
    editError.value = 'Название обязательно.'
    return
  }

  savingSeries.value = true
  editError.value = ''

  try {
    const { data } = await api.patch(`/series/${item.value.id}`, {
      title: editTitle.value,
      description: editDescription.value || null,
    })

    const updated = data?.data || {}
    item.value = {
      ...item.value,
      ...updated,
      photos: item.value?.photos || [],
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
  }
}

function onPhotoDragStart(photo, event) {
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

  try {
    await api.patch(`/series/${item.value.id}/photos/reorder`, {
      photo_ids: nextOrder.map((photo) => photo.id),
    })
  } catch (e) {
    item.value = {
      ...item.value,
      photos: previousOrder,
    }
    photoOrderError.value = e?.response?.data?.message || 'Не удалось сохранить порядок фото.'
  } finally {
    reorderingPhotos.value = false
    onPhotoDragEnd()
  }
}

function openDeleteSeriesModal() {
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
  if (!item.value) return

  deletingSeries.value = true
  deleteSeriesError.value = ''

  try {
    await api.delete(`/series/${item.value.id}`)
    showDeleteSeriesModal.value = false
    await router.push('/series')
  } catch (e) {
    deleteSeriesError.value = e?.response?.data?.message || 'Не удалось удалить серию.'
  } finally {
    deletingSeries.value = false
  }
}

async function uploadPhotos() {
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
      maxDimension: 2560,
    })

    uploadWarnings.value = warnings

    if (!optimizedFiles.length) {
      uploadError.value = 'No files left after optimization.'
      return
    }

    const formData = new FormData()

    for (const file of optimizedFiles) {
      formData.append('photos[]', file)
    }

    const { data } = await api.post(`/series/${route.params.id}/photos`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })

    uploadWarnings.value = [...warnings, ...(data.photos_failed || [])]
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
  if (!item.value || !photo) return
  openDeletePhotoModal(photo)
}

async function confirmDeletePhoto() {
  if (!item.value || !photoToDelete.value) return

  const deletedPhotoId = Number(photoToDelete.value.id)
  let deleted = false
  deletingPhoto.value = true
  deletePhotoError.value = ''

  try {
    await api.delete(`/series/${item.value.id}/photos/${deletedPhotoId}`)
    deleted = true
  } catch (e) {
    deletePhotoError.value = e?.response?.data?.message || 'Не удалось удалить фото.'
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
  if (!item.value || !photo) return

  const currentName = String(photo.original_name || '')
  const dotIndex = currentName.lastIndexOf('.')
  const currentExtension = dotIndex > 0 ? currentName.slice(dotIndex + 1) : 'jpg'
  const currentBaseName = dotIndex > 0 ? currentName.slice(0, dotIndex) : currentName || String(photo.id)

  const nextName = window.prompt(
    `Новое название файла (расширение .${currentExtension} менять нельзя)`,
    currentBaseName
  )
  if (nextName === null) return

  const normalized = nextName.trim()
  if (!normalized) return

  try {
    await api.patch(`/series/${item.value.id}/photos/${photo.id}`, {
      original_name: normalized,
    })

    await loadSeries()
  } catch (e) {
    error.value = e?.response?.data?.message || 'Не удалось переименовать фото.'
  }
}

function downloadPhotoOriginal(photo) {
  if (!item.value?.id || !photo?.id) return

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

  api.get(`/series/${item.value.id}/photos/${photo.id}/download`, {
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
    error.value = e?.response?.data?.message || 'Не удалось скачать оригинал фото.'
  })
}

async function refreshAutoTags() {
  if (!item.value?.id) return

  refreshingTags.value = true
  refreshTagsError.value = ''
  refreshTagsInfo.value = ''

  try {
    const { data } = await api.post(`/series/${item.value.id}/photos/retag`)
    const processed = Number(data?.data?.processed || 0)
    const failed = Number(data?.data?.failed || 0)
    const tagsCount = Number(data?.data?.tags_count || 0)
    const visionEnabled = Boolean(data?.data?.vision_enabled)
    const visionHealthy = Boolean(data?.data?.vision_healthy)

    refreshTagsInfo.value = failed > 0
      ? `Теги обновлены для ${processed} фото, ошибок: ${failed}.`
      : `Теги обновлены для ${processed} фото.`

    if (tagsCount === 0) {
      if (!visionEnabled) {
        refreshTagsInfo.value = `${refreshTagsInfo.value} Vision-теггер выключен (VISION_TAGGER_ENABLED=false).`
      } else if (!visionHealthy) {
        refreshTagsInfo.value = `${refreshTagsInfo.value} Vision-теггер недоступен по сети.`
      }
    }

    await loadSeries()
  } catch (e) {
    refreshTagsError.value = e?.response?.data?.message || 'Не удалось обновить теги.'
  } finally {
    refreshingTags.value = false
  }
}

async function addSeriesTag() {
  if (!item.value?.id) return

  const prepared = String(newTagName.value || '').trim()
  if (!prepared) {
    tagEditError.value = 'Введите тег.'
    return
  }

  addingTag.value = true
  tagEditError.value = ''

  try {
    const { data } = await api.post(`/series/${item.value.id}/tags`, {
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
  if (!item.value?.id || !tag?.id) return

  removingTagId.value = tag.id
  tagEditError.value = ''

  try {
    const { data } = await api.delete(`/series/${item.value.id}/tags/${tag.id}`)
    item.value = mergeSeriesPayload(data?.data)
  } catch (e) {
    tagEditError.value = e?.response?.data?.message || 'Не удалось удалить тег.'
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
  if (query.length < 1) {
    tagSuggestions.value = []
    tagSuggestionsLoading.value = false
    return
  }

  const requestId = ++tagSuggestRequestId
  tagSuggestionsLoading.value = true

  try {
    const { data } = await api.get('/tags/suggest', {
      params: {
        q: query,
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

  if (!silent) {
    loading.value = true
    error.value = ''
  }

  try {
    const { data } = await api.get(`/series/${route.params.id}`, {
      params: {
        include_photos: 1,
        photos_limit: 50,
      },
    })

    photoUrlVersion.value = Date.now()
    item.value = data.data
  } catch (e) {
    if (!silent) {
      error.value = e?.response?.data?.message || 'Failed to load series.'
    }
  } finally {
    if (!silent) {
      loading.value = false
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  loadSeries()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (tagSuggestTimerId !== null) {
    clearTimeout(tagSuggestTimerId)
    tagSuggestTimerId = null
  }
})

watch(() => route.params.id, () => {
  closePreview()
  loadSeries()
})
</script>

<template>
  <div class="series-page">
    <div class="series-shell">
      <p class="back-link"><RouterLink to="/series">← К списку серий</RouterLink></p>

      <p v-if="loading" class="state-text">Загрузка...</p>
      <p v-else-if="error" class="error">{{ error }}</p>

      <template v-else-if="item">
        <header class="series-header">
          <div>
            <h1>{{ item.title }}</h1>
            <p class="series-meta">{{ formatDate(item.created_at) }} · {{ item.photos_count }} фото</p>
          </div>
          <div class="series-actions">
            <button type="button" class="ghost-btn" @click="showUploadForm = !showUploadForm">
              {{ showUploadForm ? 'Скрыть форму' : 'Добавить фото' }}
            </button>
            <button type="button" class="ghost-btn" :disabled="refreshingTags" @click="refreshAutoTags">
              {{ refreshingTags ? 'Обновляем теги...' : 'Обновить теги' }}
            </button>
            <button type="button" class="ghost-btn icon-btn" @click="openEditSeries" title="Редактировать">
              ✎
            </button>
            <button type="button" class="danger-btn icon-btn" @click="openDeleteSeriesModal" title="Удалить серию">
              🗑
            </button>
          </div>
        </header>

        <p class="series-description">{{ item.description || 'Описание пока не добавлено.' }}</p>
        <div class="series-tags">
          <span v-for="tag in seriesTags" :key="tag.id" class="series-tag">
            #{{ tag.name }}
            <button
              type="button"
              class="series-tag-remove"
              :disabled="removingTagId === tag.id"
              @click="removeSeriesTag(tag)"
            >
              ×
            </button>
          </span>

          <button
            v-if="!showTagInput"
            type="button"
            class="series-tag-add"
            @click="openTagInput"
          >
            +
          </button>

          <form v-else class="series-tag-inline-form" @submit.prevent="addSeriesTag">
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
              <div v-if="tagSuggestionsLoading" class="series-tag-suggest-hint">Поиск...</div>
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
        <p v-if="refreshTagsError" class="error">{{ refreshTagsError }}</p>
        <p v-else-if="refreshTagsInfo" class="hint">{{ refreshTagsInfo }}</p>
        <p v-if="tagEditError" class="error">{{ tagEditError }}</p>

        <section v-if="showUploadForm" class="upload-panel">
          <h2>Добавить фото</h2>

          <form class="upload-form" @submit.prevent="uploadPhotos">
            <input
              ref="uploadInput"
              name="photos[]"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              multiple
              @change="onUploadFilesChanged"
            />

            <small class="hint">Оптимизация перед отправкой: до 2MB на файл.</small>
            <small class="hint" v-if="uploadFiles.length">Выбрано: {{ uploadFiles.length }} файл(ов)</small>

            <p v-if="uploadError" class="error">{{ uploadError }}</p>

            <ul v-if="uploadWarnings.length" class="warnings">
              <li v-for="(warning, index) in uploadWarnings" :key="index">
                {{ warning.original_name }}: {{ warning.message }}
              </li>
            </ul>

            <button type="submit" class="primary-btn" :disabled="uploading">
              {{ uploading ? 'Загрузка...' : 'Загрузить фото' }}
            </button>
          </form>
        </section>

        <section v-if="isEditingSeries" class="upload-panel">
          <h2>Редактировать серию</h2>
          <form class="upload-form" @submit.prevent="saveSeries">
            <label>
              Название
              <input v-model="editTitle" type="text" maxlength="255" required />
            </label>
            <label>
              Описание
              <textarea v-model="editDescription" rows="3"></textarea>
            </label>

            <p v-if="editError" class="error">{{ editError }}</p>

            <div class="inline-actions">
              <button type="submit" class="primary-btn" :disabled="savingSeries">
                {{ savingSeries ? 'Сохраняем...' : 'Сохранить' }}
              </button>
              <button type="button" class="ghost-btn" @click="cancelEditSeries">Отмена</button>
            </div>
          </form>
        </section>

        <p v-if="photoOrderError" class="error">{{ photoOrderError }}</p>

        <section class="photo-grid" v-if="photoList.length">
          <article
            v-for="photo in photoList"
            :key="photo.id"
            class="photo-card"
            :class="{
              'photo-card--dragging': draggingPhotoId === photo.id,
              'photo-card--drag-over': dragOverPhotoId === photo.id,
            }"
            draggable="true"
            @dragstart="onPhotoDragStart(photo, $event)"
            @dragenter.prevent="onPhotoDragEnter(photo)"
            @dragover.prevent
            @drop.prevent="onPhotoDrop(photo)"
            @dragend="onPhotoDragEnd"
            @click="openPreview(photo)"
          >
            <LazyPhotoThumb
              :src="resolvedPhotoUrl(photo)"
              :fallback-src="resolvedPhotoFallbackUrl(photo)"
              :alt="photo.original_name || 'photo'"
            />
            <div class="thumb-meta">
              <strong>#{{ photo.id }} {{ photo.original_name }}</strong>
              <div class="thumb-bottom">
                <span>{{ photo.mime }} · {{ formatSize(photo.size) }}</span>
                <div class="thumb-actions">
                  <button type="button" class="icon-ghost-btn" title="Скачать оригинал" @click.stop="downloadPhotoOriginal(photo)">⤓</button>
                  <button type="button" class="icon-ghost-btn" title="Переименовать" @click.stop="renamePhoto(photo)">✎</button>
                  <button type="button" class="icon-ghost-btn" title="Удалить" @click.stop="deletePhoto(photo)">🗑</button>
                </div>
              </div>
            </div>
          </article>
        </section>

        <p v-else class="state-text">В этой серии пока нет фото.</p>
      </template>
    </div>

    <PhotoPreviewModal
      :open="Boolean(selectedPhoto)"
      :photo="selectedPhoto"
      :src="resolvedPhotoUrl(selectedPhoto)"
      @close="closePreview"
    />

    <div v-if="showDeleteSeriesModal" class="confirm-overlay" @click.self="closeDeleteSeriesModal">
      <div class="confirm-modal">
        <h2>Удалить серию?</h2>
        <p>
          Серия <strong>{{ item?.title || 'Без названия' }}</strong> будет удалена без возможности
          восстановления.
        </p>

        <p v-if="deleteSeriesError" class="error">{{ deleteSeriesError }}</p>

        <div class="confirm-actions">
          <button type="button" class="danger-btn" :disabled="deletingSeries" @click="deleteSeries">
            {{ deletingSeries ? 'Удаляем...' : 'Удалить навсегда' }}
          </button>
          <button type="button" class="ghost-btn" :disabled="deletingSeries" @click="closeDeleteSeriesModal">
            Отмена
          </button>
        </div>
      </div>
    </div>

    <div v-if="showDeletePhotoModal" class="confirm-overlay" @click.self="closeDeletePhotoModal">
      <div class="confirm-modal">
        <h2>Удалить фото?</h2>
        <p>
          Фото
          <strong>{{ photoToDelete?.original_name || `#${photoToDelete?.id || ''}` }}</strong>
          будет удалено без возможности восстановления.
        </p>

        <p v-if="deletePhotoError" class="error">{{ deletePhotoError }}</p>

        <div class="confirm-actions">
          <button type="button" class="danger-btn" :disabled="deletingPhoto" @click="confirmDeletePhoto">
            {{ deletingPhoto ? 'Удаляем...' : 'Удалить навсегда' }}
          </button>
          <button type="button" class="ghost-btn" :disabled="deletingPhoto" @click="closeDeletePhotoModal">
            Отмена
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.series-page {
  --bg: #e8e9e6;
  --panel: #f4f5f2;
  --line: #dde0d9;
  --text: #313a35;
  --muted: #748077;
  --accent: #5d9776;
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
  padding: 18px;
}

.back-link {
  margin: 0 0 10px;
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
  line-height: 1;
  letter-spacing: -0.03em;
}

.series-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.series-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.series-meta {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 15px;
}

.series-description {
  margin: 12px 0 16px;
  font-size: 19px;
  color: #4b574f;
}

.series-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: -6px 0 14px;
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

.inline-actions {
  display: flex;
  gap: 8px;
}

.hint {
  color: var(--muted);
}

.photo-grid {
  column-count: 2;
  column-gap: 10px;
}

.photo-card {
  display: inline-block;
  width: 100%;
  margin: 0 0 10px;
  break-inside: avoid;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  background: #fcfdfb;
  cursor: grab;
  user-select: none;
}

.photo-card:active {
  cursor: grabbing;
}

.photo-card--dragging {
  opacity: 0.55;
}

.photo-card--drag-over {
  border-color: #87ad98;
  box-shadow: inset 0 0 0 2px rgba(79, 131, 102, 0.18);
}

.thumb-meta {
  display: grid;
  gap: 3px;
  padding: 8px;
  font-size: 13px;
}

.thumb-meta span {
  color: var(--muted);
}

.thumb-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.thumb-actions {
  display: flex;
  gap: 6px;
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

.primary-btn {
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  font-weight: 700;
  padding: 10px 14px;
  background: var(--accent);
  color: #eff7f2;
  width: fit-content;
}

.primary-btn:hover {
  background: #4f8366;
}

.primary-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ghost-btn {
  border: 1px solid #c8d2c8;
  border-radius: 9px;
  cursor: pointer;
  font-weight: 700;
  padding: 8px 12px;
  background: #edf1ec;
  color: var(--text);
}

.ghost-btn:hover {
  background: #e3eae2;
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

@media (min-width: 1200px) {
  .photo-grid {
    column-count: 3;
  }
}

@media (min-width: 1550px) {
  .photo-grid {
    column-count: 4;
  }
}

@media (max-width: 680px) {
  .series-page {
    padding: 10px 0 20px;
  }

  .series-shell {
    border-radius: 0;
    padding: 14px;
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

  .photo-grid {
    column-count: 1;
  }
}
</style>
