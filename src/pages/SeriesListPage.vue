<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from '../lib/api'
import { optimizeImagesForUpload } from '../lib/imageOptimizer'

const series = ref([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const lastPage = ref(1)
const seriesPreviews = ref({})

const search = ref('')
const activePeriod = ref('week')
const showCreateForm = ref(false)

const createTitle = ref('')
const createDescription = ref('')
const createFiles = ref([])
const createFilesInput = ref(null)
const creating = ref(false)
const createError = ref('')
const createWarnings = ref([])
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_RAW_FILE_SIZE_BYTES = 25 * 1024 * 1024

const filteredSeries = computed(() => {
  const query = search.value.trim().toLowerCase()

  if (!query) {
    return series.value
  }

  return series.value.filter((item) => {
    const haystack = `${item.title || ''} ${item.description || ''}`.toLowerCase()
    return haystack.includes(query)
  })
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
          photos_limit: 4,
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

onMounted(() => {
  loadSeries(1)
})
</script>

<template>
  <div class="journal-page">
    <div class="journal-shell">
      <header class="journal-header">
        <h1>Фото Дневник</h1>

        <div class="header-actions">
          <button type="button" class="ghost-btn">▦</button>
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
            <div class="chip-row">
              <button type="button" class="chip" :class="{ active: activePeriod === 'day' }" @click="activePeriod = 'day'">Сегодня</button>
              <button type="button" class="chip" :class="{ active: activePeriod === 'week' }" @click="activePeriod = 'week'">Неделя</button>
              <button type="button" class="chip" :class="{ active: activePeriod === 'month' }" @click="activePeriod = 'month'">Месяц</button>
            </div>
          </section>

          <section class="filter-group">
            <h3>Теги</h3>
            <div class="chip-row chips-wrap">
              <span class="tag-chip">#birds</span>
              <span class="tag-chip">#flowers</span>
              <span class="tag-chip">#spring</span>
            </div>
          </section>

          <section class="filter-group">
            <h3>Сортировка</h3>
            <div class="sort-box">Новые сверху</div>
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
                <h3>{{ item.title }}</h3>
                <RouterLink class="view-link" :to="`/series/${item.id}`">Открыть</RouterLink>
              </header>

              <div class="series-meta">
                <span>{{ formatDate(item.created_at) }}</span>
                <span>{{ item.photos_count }} фото</span>
              </div>

              <p class="series-desc">{{ item.description || 'Описание пока не добавлено.' }}</p>

              <div v-if="previewTiles(item.id).length" class="preview-grid">
                <img
                  v-for="slot in previewTiles(item.id)"
                  :key="slot.id"
                  class="preview-tile-image"
                  :src="slot.src"
                  :alt="slot.alt"
                />
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

.chip.active {
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
  transition: transform 0.2s ease;
}

.series-card:hover {
  transform: translateY(-2px);
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
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preview-tile-image {
  width: min(100%, 350px);
  height: 220px;
  border-radius: 8px;
  border: 1px solid rgba(125, 134, 128, 0.25);
  object-fit: contain;
  background: #eef2ec;
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

  .preview-tile-image {
    height: 180px;
  }

}
</style>
