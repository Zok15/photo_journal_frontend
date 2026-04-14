<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { setSession } from '../lib/session'
import { t } from '../lib/i18n'

const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  loading.value = true
  error.value = ''

  try {
    const { data } = await api.post('/auth/login', {
      email: email.value,
      password: password.value,
    })

    setSession(data.token, data.user || null)

    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/series'
    router.push(redirect)
  } catch (e) {
    error.value = e?.response?.data?.message || t('Login failed.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page login-page">
    <section class="auth-card login-card">
      <div class="auth-brand login-brand">
        <img src="/logo.png" alt="Bird logo" class="auth-brand-logo brand-logo" />
        <p class="auth-eyebrow eyebrow">{{ t('Фото Дневник') }}</p>
      </div>
      <h1 class="auth-title">{{ t('Вход в дневник') }}</h1>
      <p class="auth-lead lead">{{ t('Авторизация для работы с вашими сериями и фотографиями.') }}</p>

      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span>Email</span>
          <input v-model="email" type="email" required />
        </label>

        <label class="field">
          <span>{{ t('Пароль') }}</span>
          <input v-model="password" type="password" required />
        </label>

        <button type="submit" class="primary-btn" :disabled="loading">
          {{ loading ? t('Входим...') : t('Войти') }}
        </button>

        <p class="aux"><RouterLink to="/forgot-password">{{ t('Забыли пароль?') }}</RouterLink></p>
        <p class="aux">{{ t('Нет аккаунта?') }} <RouterLink to="/register">{{ t('Зарегистрироваться') }}</RouterLink></p>

        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </section>
  </div>
</template>

<style scoped>
.error {
  margin: 0;
}
</style>
