<script setup>
import { onMounted, ref, watch } from 'vue'
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
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_RAW_FILE_SIZE_BYTES = 25 * 1024 * 1024

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
        include_photos: true,
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

onMounted(loadSeries)
watch(() => route.params.id, loadSeries)
</script>

<template>
  <section>
    <p><RouterLink to="/series">← Back to series</RouterLink></p>

    <p v-if="loading">Loading...</p>
    <p v-else-if="error" class="error">{{ error }}</p>

    <div v-else-if="item">
      <h1>{{ item.title }}</h1>
      <p>{{ item.description }}</p>
      <p><strong>Photos:</strong> {{ item.photos_count }}</p>

      <section class="card">
        <h2>Upload More Photos</h2>

        <form class="form" @submit.prevent="uploadPhotos">
          <input
            ref="uploadInput"
            name="photos[]"
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            multiple
            @change="onUploadFilesChanged"
          />
          <small>Images are optimized for web before upload (target: up to 2MB per file).</small>
          <small v-if="uploadFiles.length">Selected: {{ uploadFiles.length }} file(s)</small>

          <p v-if="uploadError" class="error">{{ uploadError }}</p>

          <ul v-if="uploadWarnings.length" class="warnings">
            <li v-for="(warning, index) in uploadWarnings" :key="index">
              {{ warning.original_name }}: {{ warning.message }}
            </li>
          </ul>

          <button type="submit" :disabled="uploading">
            {{ uploading ? 'Uploading...' : 'Upload photos' }}
          </button>
        </form>
      </section>

      <h2>Photo list</h2>
      <ul class="photo-list">
        <li v-for="photo in item.photos || []" :key="photo.id" class="photo-item">
          <div><strong>#{{ photo.id }}</strong> {{ photo.original_name }}</div>
          <div class="meta">{{ photo.mime }} | {{ photo.size }} bytes</div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.form {
  display: grid;
  gap: 10px;
}

.error {
  color: #b91c1c;
}

.warnings {
  margin: 0;
  padding-left: 18px;
  color: #92400e;
}

.photo-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}

.photo-item {
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 10px;
}

.meta {
  color: #555;
  font-size: 13px;
}
</style>
