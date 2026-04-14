<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { t } from '../lib/i18n'

const route = useRoute()
const router = useRouter()

const token = ref(String(route.query.token || '').trim())
const email = ref(String(route.query.email || '').trim())
const password = ref('')
const passwordConfirm = ref('')
const loading = ref(false)
const error = ref('')
const info = ref('')

const hasRequiredParams = computed(() => token.value !== '' && email.value !== '')

async function submit() {
  if (password.value !== passwordConfirm.value) {
    error.value = t('Пароли не совпадают.')
    return
  }

  loading.value = true
  error.value = ''
  info.value = ''

  try {
    const { data } = await api.post('/auth/reset-password', {
      token: token.value,
      email: email.value,
      password: password.value,
      password_confirmation: passwordConfirm.value,
    })
    info.value = data?.message || t('Пароль успешно обновлён.')
    setTimeout(() => {
      router.push('/login')
    }, 1200)
  } catch (e) {
    error.value = e?.response?.data?.message || t('Не удалось обновить пароль.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page reset-page">
    <section class="auth-card reset-card">
      <h1 class="auth-title">{{ t('Новый пароль') }}</h1>

      <p v-if="!hasRequiredParams" class="error">
        {{ t('Ссылка восстановления неполная или устарела.') }}
      </p>

      <template v-else>
        <p class="auth-lead lead">{{ t('Установите новый пароль для аккаунта {email}.', { email }) }}</p>

        <form class="form" @submit.prevent="submit">
          <label class="field">
            <span>{{ t('Пароль') }}</span>
            <input v-model="password" type="password" required minlength="8" />
          </label>

          <label class="field">
            <span>{{ t('Повторите пароль') }}</span>
            <input v-model="passwordConfirm" type="password" required minlength="8" />
          </label>

          <button type="submit" class="primary-btn" :disabled="loading">
            {{ loading ? t('Сохраняем...') : t('Сохранить новый пароль') }}
          </button>

          <p class="aux">
            <RouterLink to="/login">{{ t('Вернуться ко входу') }}</RouterLink>
          </p>

          <p v-if="info" class="info">{{ info }}</p>
          <p v-if="error" class="error">{{ error }}</p>
        </form>
      </template>
    </section>
  </div>
</template>

<style scoped>
.error {
  margin: 0;
}
</style>
