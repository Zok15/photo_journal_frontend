<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { formatValidationErrorMessage } from '../lib/formErrors'
import { setCurrentUser } from '../lib/session'

const router = useRouter()
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const success = ref('')

const form = ref({
  name: '',
  journal_title: '',
})

function formatValidationError(err) {
  return formatValidationErrorMessage(err, 'Request failed.')
}

async function loadProfile() {
  loading.value = true
  error.value = ''
  success.value = ''

  try {
    const { data } = await api.get('/profile')
    const user = data?.data || {}

    form.value.name = user.name || ''
    form.value.journal_title = user.journal_title || ''
    setCurrentUser(user)
  } catch (e) {
    error.value = e?.response?.data?.message || 'Failed to load profile.'
  } finally {
    loading.value = false
  }
}

async function saveProfile() {
  success.value = ''
  error.value = ''

  if (!form.value.name.trim()) {
    error.value = 'Имя обязательно.'
    return
  }

  saving.value = true

  try {
    const { data } = await api.patch('/profile', {
      name: form.value.name.trim(),
      journal_title: form.value.journal_title.trim() || null,
    })

    const user = data?.data || null
    if (user) {
      setCurrentUser(user)
    }

    success.value = 'Профиль обновлён.'
  } catch (e) {
    error.value = formatValidationError(e)
  } finally {
    saving.value = false
  }
}

function goBack() {
  const back = window.history.state?.back
  if (typeof back === 'string' && back.startsWith('/')) {
    router.back()
    return
  }

  router.push('/')
}

onMounted(() => {
  loadProfile()
})
</script>

<template>
  <div class="profile-page">
    <div class="profile-shell">
      <p class="back-link"><a href="/" @click.prevent="goBack">← Назад</a></p>

      <header class="profile-header">
        <h1>Личный кабинет</h1>
        <p class="lead">Настройки имени и названия вашего журнала.</p>
      </header>

      <p v-if="loading" class="state-text">Загрузка...</p>
      <p v-else-if="error" class="error">{{ error }}</p>

      <form v-else class="form" @submit.prevent="saveProfile">
        <label class="field">
          <span>Имя</span>
          <input v-model="form.name" type="text" maxlength="255" required />
        </label>

        <label class="field">
          <span>Название журнала</span>
          <input v-model="form.journal_title" type="text" maxlength="255" placeholder="Мой фотодневник" />
        </label>

        <p class="hint">Текущее отображаемое название: {{ form.journal_title || 'Фото Дневник' }}</p>

        <p v-if="success" class="success">{{ success }}</p>
        <p v-if="error" class="error">{{ error }}</p>

        <div class="actions-row">
          <button type="submit" class="primary-btn" :disabled="saving">
            {{ saving ? 'Сохраняем...' : 'Сохранить' }}
          </button>
          <RouterLink class="ghost-btn" to="/series">Назад</RouterLink>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.profile-page {
  min-height: calc(100vh - 58px);
  background:
    radial-gradient(700px 220px at 15% 0%, rgba(183, 201, 190, 0.35), transparent 65%),
    radial-gradient(860px 260px at 100% 15%, rgba(218, 206, 188, 0.28), transparent 70%),
    var(--bg);
  display: grid;
  padding: 18px;
}

.profile-shell {
  max-width: 980px;
  width: 100%;
  margin: 0 auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  box-shadow: 0 20px 40px rgba(79, 86, 80, 0.1);
  padding: 18px;
  color: var(--text);
}

.back-link {
  margin: 0 0 8px;
}

.back-link a {
  color: #3f6d56;
  text-decoration: none;
  font-weight: 700;
}

.back-link a:hover {
  text-decoration: underline;
}

.profile-header h1 {
  margin: 0;
  font-size: 42px;
  letter-spacing: -0.03em;
}

.lead {
  margin: 8px 0 16px;
  color: #4b574f;
}

.form {
  display: grid;
  gap: 12px;
}

.field {
  display: grid;
  gap: 4px;
}

.field span {
  color: var(--muted);
  font-size: 13px;
}

.field input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 11px;
  border: 1px solid #cfd6ce;
  border-radius: 8px;
  background: #fff;
}

.hint {
  margin: 0;
}

.actions-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.success {
  color: #2f7a43;
  margin: 0;
}

.error {
  margin: 0;
}

@media (max-width: 700px) {
  .profile-page {
    padding: 10px 0 20px;
  }

  .profile-shell {
    border-radius: 0;
    padding: 14px;
  }

  .profile-header h1 {
    font-size: 32px;
  }
}
</style>
