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
  <div class="auth-page forgot-page">
    <section class="auth-card forgot-card">
      <h1 class="auth-title">{{ t('Восстановление пароля') }}</h1>
      <p class="auth-lead lead">{{ t('Введите email, и мы отправим ссылку для установки нового пароля.') }}</p>

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
.error {
  margin: 0;
}
</style>
