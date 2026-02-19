<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from '../lib/api'
import { buildStorageUrl, withCacheBust } from '../lib/url'

const series = ref([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const lastPage = ref(1)
const previewVersion = ref(Date.now())

const searchInput = ref('')
const search = ref('')
const activeSort = ref('new')
const selectedTags = ref([])
const dateFrom = ref('')
const dateTo = ref('')
const selectedAuthorId = ref('')
const availableTags = ref([])
const availableAuthors = ref([])

const hasActiveFilters = computed(() => {
  return Boolean(
    search.value.trim()
      || selectedTags.value.length
      || dateFrom.value
      || dateTo.value
      || selectedAuthorId.value
      || activeSort.value !== 'new',
  )
})

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

function photoUrl(photo) {
  const direct = String(photo?.preview_url || '').trim() || String(photo?.public_url || '').trim()
  if (direct) {
    return direct
  }

  return buildStorageUrl(photo?.path)
}

function previewUrl(photo) {
  return withCacheBust(photoUrl(photo), previewVersion.value)
}

function toggleTag(tagName) {
  if (selectedTags.value.includes(tagName)) {
    selectedTags.value = selectedTags.value.filter((name) => name !== tagName)
  } else {
    selectedTags.value = [...selectedTags.value, tagName]
  }

  loadPublicSeries(1)
}

function resetFilters() {
  search.value = ''
  searchInput.value = ''
  activeSort.value = 'new'
  selectedTags.value = []
  dateFrom.value = ''
  dateTo.value = ''
  selectedAuthorId.value = ''
  loadPublicSeries(1)
}

async function loadPublicSeries(targetPage = 1) {
  loading.value = true
  error.value = ''

  try {
    const params = {
      per_page: 10,
      page: targetPage,
      preview_nonce: Date.now(),
    }

    const searchValue = search.value.trim()
    if (searchValue) {
      params.search = searchValue
    }

    if (selectedTags.value.length) {
      params.tag = selectedTags.value.join(',')
    }

    if (selectedAuthorId.value) {
      params.author_id = Number(selectedAuthorId.value)
    }

    if (dateFrom.value) {
      params.date_from = dateFrom.value
    }

    if (dateTo.value) {
      params.date_to = dateTo.value
    }

    if (activeSort.value !== 'new') {
      params.sort = activeSort.value
    }

    const { data } = await api.get('/public/series', { params })

    series.value = Array.isArray(data?.data) ? data.data : []
    page.value = Number(data?.current_page || targetPage)
    lastPage.value = Number(data?.last_page || 1)
    availableTags.value = Array.isArray(data?.available_tags)
      ? data.available_tags.map((tag) => String(tag?.name || '').trim()).filter(Boolean)
      : []
    availableAuthors.value = Array.isArray(data?.authors) ? data.authors : []
    previewVersion.value = Date.now()
  } catch (e) {
    error.value = e?.response?.data?.message || 'Failed to load public series.'
  } finally {
    loading.value = false
  }
}

function submitSearch() {
  search.value = searchInput.value
  loadPublicSeries(1)
}

function goToPage(nextPage) {
  if (loading.value || nextPage < 1 || nextPage > lastPage.value || nextPage === page.value) {
    return
  }

  loadPublicSeries(nextPage)
}

loadPublicSeries()
</script>

<template>
  <div class="public-page">
    <div class="public-shell">
      <header class="public-header">
        <h1>Публичные серии</h1>
      </header>

      <div class="public-layout">
        <aside class="filters-panel">
          <section class="filter-group">
            <h3>Поиск</h3>
            <form class="search-form" @submit.prevent="submitSearch">
              <input v-model="searchInput" type="text" placeholder="Название или описание" />
              <button type="submit" class="ghost-btn">Найти</button>
            </form>
          </section>

          <section class="filter-group">
            <h3>Автор</h3>
            <select v-model="selectedAuthorId" class="author-select" @change="loadPublicSeries(1)">
              <option value="">Все авторы</option>
              <option v-for="author in availableAuthors" :key="author.id" :value="String(author.id)">
                {{ author.name }}
              </option>
            </select>
          </section>

          <section class="filter-group">
            <h3>Теги</h3>
            <div class="chip-row">
              <button
                v-for="tag in availableTags"
                :key="tag"
                type="button"
                class="chip"
                :class="{ active: selectedTags.includes(tag) }"
                @click="toggleTag(tag)"
              >
                #{{ tag }}
              </button>
            </div>
          </section>

          <section class="filter-group">
            <h3>Дата</h3>
            <label class="date-label">
              От
              <input v-model="dateFrom" type="date" @change="loadPublicSeries(1)" />
            </label>
            <label class="date-label">
              До
              <input v-model="dateTo" type="date" @change="loadPublicSeries(1)" />
            </label>
          </section>

          <section class="filter-group">
            <h3>Сортировка</h3>
            <div class="chip-row">
              <button type="button" class="chip" :class="{ active: activeSort === 'new' }" @click="activeSort = 'new'; loadPublicSeries(1)">
                Новые
              </button>
              <button type="button" class="chip" :class="{ active: activeSort === 'old' }" @click="activeSort = 'old'; loadPublicSeries(1)">
                Старые
              </button>
            </div>
          </section>

          <button v-if="hasActiveFilters" type="button" class="ghost-btn reset-btn" @click="resetFilters">
            Сбросить фильтры
          </button>
        </aside>

        <main class="content-panel">
          <p v-if="loading" class="state-text">Загрузка...</p>
          <p v-else-if="error" class="error">{{ error }}</p>
          <p v-else-if="!series.length" class="state-text">Публичные серии не найдены.</p>

          <section v-else class="series-grid">
            <article v-for="item in series" :key="item.id" class="series-card">
              <header class="series-card-header">
                <h2>{{ item.title }}</h2>
                <RouterLink class="view-link" :to="`/series/${item.id}`">Открыть</RouterLink>
              </header>

              <div class="series-meta">
                <span>{{ formatDate(item.created_at) }}</span>
                <span>{{ item.photos_count }} фото</span>
                <span v-if="item.owner_name">Автор: {{ item.owner_name }}</span>
              </div>

              <p class="series-desc">{{ item.description || 'Описание пока не добавлено.' }}</p>

              <div v-if="(item.preview_photos || []).length" class="preview-grid">
                <img
                  v-for="photo in item.preview_photos"
                  :key="photo.id"
                  class="preview-tile-image"
                  :src="previewUrl(photo)"
                  :alt="photo.original_name || 'photo'"
                />
              </div>

              <div v-if="(item.tags || []).length" class="tags">
                <span v-for="tag in item.tags" :key="tag.id" class="tag-chip">#{{ tag.name }}</span>
              </div>
            </article>
          </section>

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
.public-page {
  min-height: calc(100vh - 72px);
  padding: 24px 8px 36px;
  background:
    radial-gradient(700px 220px at 15% 0%, rgba(183, 201, 190, 0.35), transparent 65%),
    radial-gradient(860px 260px at 100% 15%, rgba(218, 206, 188, 0.28), transparent 70%),
    #f4f5f2;
}

.public-shell {
  max-width: 1260px;
  margin: 0 auto;
  border: 1px solid #dde0d9;
  border-radius: 18px;
  background: #fbfcfa;
  box-shadow: 0 20px 40px rgba(79, 86, 80, 0.1);
  overflow: hidden;
}

.public-header {
  padding: 16px 20px;
  border-bottom: 1px solid #dde0d9;
}

.public-header h1 {
  margin: 0;
  font-size: 36px;
}

.public-layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
}

.filters-panel {
  padding: 16px;
  border-right: 1px solid #dde0d9;
  background: #f7f8f4;
}

.filter-group + .filter-group {
  margin-top: 14px;
}

.filter-group h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #55615a;
}

.search-form {
  display: grid;
  gap: 8px;
}

.search-form input,
.author-select,
.date-label input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dde0d9;
  border-radius: 8px;
  background: #fff;
  padding: 9px 10px;
}

.date-label {
  display: grid;
  gap: 4px;
  margin-top: 6px;
  color: #617067;
  font-size: 13px;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip,
.ghost-btn {
  border: 1px solid #d6dbd4;
  border-radius: 9px;
  background: #edf1ec;
  color: #35403a;
  padding: 7px 11px;
  font-weight: 700;
  cursor: pointer;
}

.chip {
  font-size: 12px;
}

.chip.active {
  background: #ddeee4;
  border-color: #b9d5c4;
  color: #335e49;
}

.reset-btn {
  margin-top: 16px;
  width: 100%;
}

.content-panel {
  padding: 18px;
}

.series-grid {
  display: grid;
  gap: 14px;
}

.series-card {
  border: 1px solid #dde0d9;
  border-radius: 12px;
  background: #fff;
  padding: 14px;
}

.series-card-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.series-card h2 {
  margin: 0;
  font-size: 34px;
  line-height: 1;
}

.view-link {
  text-decoration: none;
  color: #335e49;
  font-weight: 700;
}

.view-link:hover {
  text-decoration: underline;
}

.series-meta {
  margin-top: 7px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  color: #657067;
  font-size: 14px;
}

.series-desc {
  margin: 10px 0;
  font-size: 17px;
  color: #4b574f;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.preview-tile-image {
  width: 100%;
  height: 120px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid rgba(125, 134, 128, 0.25);
  background: #eef2ec;
}

.tags {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-chip {
  border: 1px solid #ced8cd;
  border-radius: 999px;
  background: #eef3ed;
  color: #4f6354;
  padding: 3px 9px;
  font-size: 12px;
}

.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
}

.error {
  color: #a24949;
}

@media (max-width: 960px) {
  .public-layout {
    grid-template-columns: 1fr;
  }

  .filters-panel {
    border-right: 0;
    border-bottom: 1px solid #dde0d9;
  }

  .series-card h2 {
    font-size: 26px;
  }
}
</style>
