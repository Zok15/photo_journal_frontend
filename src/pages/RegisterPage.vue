<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { setSession } from '../lib/session'
import { currentLocale, t } from '../lib/i18n'

const route = useRoute()
const router = useRouter()

const name = ref('')
const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const personalDataConsent = ref(false)
const loading = ref(false)
const error = ref('')

async function submit() {
  if (password.value !== passwordConfirm.value) {
    error.value = t('Пароли не совпадают.')
    return
  }

  loading.value = true
  error.value = ''

  try {
    const { data } = await api.post('/auth/register', {
      name: name.value,
      email: email.value,
      password: password.value,
      personal_data_consent: personalDataConsent.value,
      locale: currentLocale.value,
    })

    setSession(data.token, data.user || null)

    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/series'
    router.push(redirect)
  } catch (e) {
    error.value = e?.response?.data?.message || t('Registration failed.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page register-page">
    <section class="auth-card register-card">
      <div class="auth-brand register-brand">
        <img src="/logo.png" alt="Bird logo" class="auth-brand-logo brand-logo" />
        <p class="auth-eyebrow eyebrow">{{ t('Фото Дневник') }}</p>
      </div>
      <h1 class="auth-title">{{ t('Регистрация') }}</h1>
      <p class="auth-lead lead">{{ t('Создайте аккаунт для работы с вашими сериями и фотографиями.') }}</p>

      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span>{{ t('Имя') }}</span>
          <input v-model="name" type="text" required maxlength="255" />
        </label>

        <label class="field">
          <span>Email</span>
          <input v-model="email" type="email" required />
        </label>

        <label class="field">
          <span>{{ t('Пароль') }}</span>
          <input v-model="password" type="password" required minlength="8" />
        </label>

        <label class="field">
          <span>{{ t('Повторите пароль') }}</span>
          <input v-model="passwordConfirm" type="password" required minlength="8" />
        </label>

        <label class="consent-field">
          <input v-model="personalDataConsent" type="checkbox" required />
          <span>
            {{ t('Я согласен(а) на обработку персональных данных') }}
            {{ t('и принимаю') }}
            <RouterLink to="/privacy-policy">{{ t('Политику конфиденциальности') }}</RouterLink>
          </span>
        </label>

        <button type="submit" class="primary-btn" :disabled="loading">
          {{ loading ? t('Создаем аккаунт...') : t('Зарегистрироваться') }}
        </button>

        <p class="aux">{{ t('Уже есть аккаунт?') }} <RouterLink to="/login">{{ t('Войти') }}</RouterLink></p>

        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </section>
  </div>
</template>

<style scoped>
.consent-field {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--muted);
  font-size: 14px;
}

.consent-field input[type='checkbox'] {
  margin-top: 2px;
}

.consent-field a {
  margin-left: 4px;
  color: #335e49;
  font-weight: 700;
  text-decoration: none;
}

.consent-field a:hover {
  text-decoration: underline;
}

.error {
  margin: 0;
}
</style>
