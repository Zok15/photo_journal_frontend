<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from '../lib/api'
import { optimizeImagesForUpload } from '../lib/imageOptimizer'

const series = ref([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const lastPage = ref(1)

const createTitle = ref('')
const createDescription = ref('')
const createFiles = ref([])
const createFilesInput = ref(null)
const creating = ref(false)
const createError = ref('')
const createWarnings = ref([])
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_RAW_FILE_SIZE_BYTES = 25 * 1024 * 1024

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
  } catch (e) {
    error.value = e?.response?.data?.message || 'Failed to load series.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadSeries(1)
})
</script>

<template>
  <section>
    <h1>Series</h1>

    <section class="card">
      <h2>Create Series + Upload Photos</h2>

      <form class="form" @submit.prevent="createSeries">
        <label>
          Title
          <input v-model="createTitle" type="text" maxlength="255" required />
        </label>

        <label>
          Description
          <textarea v-model="createDescription" rows="3"></textarea>
        </label>

        <label>
          Photos
          <input
            ref="createFilesInput"
            name="photos[]"
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            multiple
            @change="onCreateFilesChanged"
          />
        </label>
        <small>Images are optimized for web before upload (target: up to 2MB per file).</small>
        <small v-if="createFiles.length">Selected: {{ createFiles.length }} file(s)</small>

        <p v-if="createError" class="error">{{ createError }}</p>

        <ul v-if="createWarnings.length" class="warnings">
          <li v-for="(warning, index) in createWarnings" :key="index">
            {{ warning.original_name }}: {{ warning.message }}
          </li>
        </ul>

        <button type="submit" :disabled="creating">
          {{ creating ? 'Uploading...' : 'Create series' }}
        </button>
      </form>
    </section>

    <p v-if="loading">Loading...</p>
    <p v-else-if="error" class="error">{{ error }}</p>

    <table v-else class="table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Title</th>
          <th>Description</th>
          <th>Photos</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in series" :key="item.id">
          <td>{{ item.id }}</td>
          <td>{{ item.title }}</td>
          <td>{{ item.description }}</td>
          <td>{{ item.photos_count }}</td>
          <td>
            <RouterLink :to="`/series/${item.id}`">View</RouterLink>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="pager" v-if="!loading && !error">
      <button type="button" :disabled="page <= 1" @click="loadSeries(page - 1)">Prev</button>
      <span>Page {{ page }} / {{ lastPage }}</span>
      <button type="button" :disabled="page >= lastPage" @click="loadSeries(page + 1)">Next</button>
    </div>
  </section>
</template>

<style scoped>
.card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
}

.form {
  display: grid;
  gap: 12px;
}

.form input,
.form textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
}

.error {
  color: #b91c1c;
}

.warnings {
  margin: 0;
  padding-left: 18px;
  color: #92400e;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table th,
.table td {
  border: 1px solid #ddd;
  padding: 8px;
  text-align: left;
}

.pager {
  margin-top: 12px;
  display: flex;
  gap: 10px;
  align-items: center;
}
</style>
