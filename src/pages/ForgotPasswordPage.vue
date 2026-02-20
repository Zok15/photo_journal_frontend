<script setup>
import { ref } from 'vue'
import { api } from '../lib/api'
import { t } from '../lib/i18n'

const email = ref('')
const loading = ref(false)
const error = ref('')
const info = ref('')

async function submit() {
  loading.value = true
  error.value = ''
  info.value = ''

  try {
    const { data } = await api.post('/auth/forgot-password', {
      email: email.value,
    })
    info.value = data?.message || t('Если аккаунт существует, мы отправили ссылку для восстановления.')
  } catch (e) {
    error.value = e?.response?.data?.message || t('Не удалось отправить ссылку для восстановления.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="forgot-page">
    <section class="forgot-card">
      <h1>{{ t('Восстановление пароля') }}</h1>
      <p class="lead">{{ t('Введите email, и мы отправим ссылку для установки нового пароля.') }}</p>

      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span>Email</span>
          <input v-model="email" type="email" required />
        </label>

        <button type="submit" class="primary-btn" :disabled="loading">
          {{ loading ? t('Отправляем...') : t('Отправить ссылку') }}
        </button>

        <p class="aux">
          <RouterLink to="/login">{{ t('Вернуться ко входу') }}</RouterLink>
        </p>

        <p v-if="info" class="info">{{ info }}</p>
        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </section>
  </div>
</template>

<style scoped>
.forgot-page {
  min-height: calc(100vh - 58px);
  background:
    radial-gradient(700px 220px at 15% 0%, rgba(183, 201, 190, 0.35), transparent 65%),
    radial-gradient(860px 260px at 100% 15%, rgba(218, 206, 188, 0.28), transparent 70%),
    var(--bg);
  display: grid;
  place-items: center;
  padding: 24px;
}

.forgot-card {
  width: min(460px, 100%);
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  box-shadow: 0 20px 40px rgba(79, 86, 80, 0.1);
  padding: 22px;
  color: var(--text);
}

.forgot-card h1 {
  margin: 0 0 6px;
  font-size: 34px;
  letter-spacing: -0.03em;
}

.lead {
  margin: 0 0 16px;
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

.aux {
  margin: 0;
}

.aux a {
  color: #335e49;
  font-weight: 700;
  text-decoration: none;
}

.aux a:hover {
  text-decoration: underline;
}

.info {
  margin: 0;
  color: #2f6942;
}

.error {
  margin: 0;
}
</style>
