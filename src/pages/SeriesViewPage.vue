<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../lib/api'
import { optimizeImagesForUpload } from '../lib/imageOptimizer'

const route = useRoute()

const item = ref(null)
const loading = ref(true)
const error = ref('')

const uploadFiles = ref([])
const uploadInput = ref(null)
const uploading = ref(false)
const uploadError = ref('')
const uploadWarnings = ref([])

const selectedPhoto = ref(null)
const zoomPercent = ref(100)
const previewNaturalWidth = ref(0)
const previewNaturalHeight = ref(0)
const viewportWidth = ref(window.innerWidth)
const viewportHeight = ref(window.innerHeight)

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_RAW_FILE_SIZE_BYTES = 25 * 1024 * 1024

const photoList = computed(() => item.value?.photos || [])

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

function resolvedPhotoUrl(photo) {
  return photo?.preview_url || photoUrl(photo?.path)
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

function openPreview(photo) {
  selectedPhoto.value = photo
  zoomPercent.value = 100
  previewNaturalWidth.value = 0
  previewNaturalHeight.value = 0
}

function closePreview() {
  selectedPhoto.value = null
  zoomPercent.value = 100
  previewNaturalWidth.value = 0
  previewNaturalHeight.value = 0
}

function zoomIn() {
  zoomPercent.value = Math.min(300, zoomPercent.value + 10)
}

function zoomOut() {
  zoomPercent.value = Math.max(50, zoomPercent.value - 10)
}

function onPreviewImageLoad(event) {
  previewNaturalWidth.value = event.target?.naturalWidth || 0
  previewNaturalHeight.value = event.target?.naturalHeight || 0
}

function syncViewport() {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
}

const previewImageStyle = computed(() => {
  if (!previewNaturalWidth.value || !previewNaturalHeight.value) {
    return {}
  }

  const maxWidth = Math.min(viewportWidth.value * 0.88, 1400)
  const maxHeight = Math.max(200, viewportHeight.value - 72)
  const fitScale = Math.min(
    maxWidth / previewNaturalWidth.value,
    maxHeight / previewNaturalHeight.value,
    1
  )
  const zoomScale = zoomPercent.value / 100
  const finalWidth = Math.round(previewNaturalWidth.value * fitScale * zoomScale)
  const finalHeight = Math.round(previewNaturalHeight.value * fitScale * zoomScale)

  return {
    width: `${Math.max(1, finalWidth)}px`,
    height: `${Math.max(1, finalHeight)}px`,
    maxWidth: 'none',
    maxHeight: 'none',
  }
})

function onKeydown(event) {
  if (event.key === 'Escape' && selectedPhoto.value) {
    closePreview()
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

async function loadSeries() {
  loading.value = true
  error.value = ''

  try {
    const { data } = await api.get(`/series/${route.params.id}`, {
      params: {
        include_photos: 1,
        photos_limit: 50,
      },
    })

    item.value = data.data
  } catch (e) {
    error.value = e?.response?.data?.message || 'Failed to load series.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', syncViewport)
  loadSeries()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', syncViewport)
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
        </header>

        <p class="series-description">{{ item.description || 'Описание пока не добавлено.' }}</p>

        <section class="upload-panel">
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

        <section class="photo-grid" v-if="photoList.length">
          <article v-for="photo in photoList" :key="photo.id" class="photo-card" @click="openPreview(photo)">
            <img class="thumb" :src="resolvedPhotoUrl(photo)" :alt="photo.original_name || 'photo'" />
            <div class="thumb-meta">
              <strong>#{{ photo.id }} {{ photo.original_name }}</strong>
              <span>{{ photo.mime }} · {{ formatSize(photo.size) }}</span>
            </div>
          </article>
        </section>

        <p v-else class="state-text">В этой серии пока нет фото.</p>
      </template>
    </div>

    <div v-if="selectedPhoto" class="preview-overlay" @click.self="closePreview">
      <div class="preview-shell">
        <div class="preview-toolbar">
          <div class="preview-actions">
            <button type="button" class="preview-btn" @click="zoomOut">-</button>
            <span class="zoom-value">{{ zoomPercent }}%</span>
            <button type="button" class="preview-btn" @click="zoomIn">+</button>
            <button type="button" class="preview-btn preview-btn-close" @click="closePreview">×</button>
          </div>
        </div>

        <div class="preview-stage">
          <div class="preview-inner">
            <img
              class="preview-image"
              :src="resolvedPhotoUrl(selectedPhoto)"
              :alt="selectedPhoto.original_name || 'photo'"
              :style="previewImageStyle"
              @load="onPreviewImageLoad"
            />
          </div>
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

.hint {
  color: var(--muted);
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.photo-card {
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  background: #fcfdfb;
  cursor: zoom-in;
}

.thumb {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
  background: linear-gradient(135deg, #8fb39b 0%, #d6e2cf 45%, #f0e8d8 100%);
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

.preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(25, 31, 27, 0.84);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 20px;
}

.preview-shell {
  position: relative;
  width: min(92vw, 1400px);
  height: calc(100vh - 40px);
  border-radius: 12px;
  border: 1px solid #56645a;
  background: #222924;
  overflow: hidden;
}

.preview-toolbar {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 3;
  height: 40px;
  background: #1e2621;
  border: 1px solid #445247;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
}

.preview-actions {
  display: flex;
  gap: 8px;
}

.preview-btn {
  border: 0;
  border-radius: 7px;
  min-height: 28px;
  cursor: pointer;
  font-weight: 700;
  color: #eef4ef;
  background: rgba(49, 65, 56, 0.86);
  padding: 4px 9px;
}

.preview-btn:hover {
  background: rgba(78, 101, 88, 0.92);
}

.zoom-value {
  color: #eef4ef;
  font-weight: 700;
  min-width: 52px;
  text-align: center;
}

.preview-btn-close {
  min-width: 30px;
  padding: 0;
  font-size: 18px;
}

.preview-stage {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 16px;
}

.preview-inner {
  min-width: 100%;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-image {
  display: block;
  width: auto;
  height: auto;
  max-width: min(88vw, 1400px);
  max-height: calc(100vh - 72px);
  object-fit: contain;
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
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 1550px) {
  .photo-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
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

  .series-description {
    font-size: 17px;
  }

  .photo-grid {
    grid-template-columns: 1fr;
  }

  .thumb {
    height: auto;
  }

  .preview-actions {
    gap: 6px;
  }

  .preview-toolbar {
    top: 8px;
    right: 8px;
  }
}
</style>
