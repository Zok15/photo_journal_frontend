<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { setSession } from '../lib/session'

const route = useRoute()
const router = useRouter()

const name = ref('')
const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  if (password.value !== passwordConfirm.value) {
    error.value = 'Пароли не совпадают.'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const { data } = await api.post('/auth/register', {
      name: name.value,
      email: email.value,
      password: password.value,
    })

    setSession(data.token, data.user || null)

    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/series'
    router.push(redirect)
  } catch (e) {
    error.value = e?.response?.data?.message || 'Registration failed.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="register-page">
    <section class="register-card">
      <div class="register-brand">
        <img src="/logo.png" alt="Bird logo" class="brand-logo" />
        <p class="eyebrow">Фото Дневник</p>
      </div>
      <h1>Регистрация</h1>
      <p class="lead">Создайте аккаунт для работы с вашими сериями и фотографиями.</p>

      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span>Имя</span>
          <input v-model="name" type="text" required maxlength="255" />
        </label>

        <label class="field">
          <span>Email</span>
          <input v-model="email" type="email" required />
        </label>

        <label class="field">
          <span>Пароль</span>
          <input v-model="password" type="password" required minlength="8" />
        </label>

        <label class="field">
          <span>Повторите пароль</span>
          <input v-model="passwordConfirm" type="password" required minlength="8" />
        </label>

        <button type="submit" class="primary-btn" :disabled="loading">
          {{ loading ? 'Создаем аккаунт...' : 'Зарегистрироваться' }}
        </button>

        <p class="aux">Уже есть аккаунт? <RouterLink to="/login">Войти</RouterLink></p>

        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </section>
  </div>
</template>

<style scoped>
.register-page {
  min-height: calc(100vh - 58px);
  background:
    radial-gradient(700px 220px at 15% 0%, rgba(183, 201, 190, 0.35), transparent 65%),
    radial-gradient(860px 260px at 100% 15%, rgba(218, 206, 188, 0.28), transparent 70%),
    var(--bg);
  display: grid;
  place-items: center;
  padding: 24px;
}

.register-card {
  width: min(460px, 100%);
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  box-shadow: 0 20px 40px rgba(79, 86, 80, 0.1);
  padding: 22px;
  color: var(--text);
}

.eyebrow {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.register-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-logo {
  width: 30px;
  height: 30px;
  display: block;
}

.register-card h1 {
  margin: 8px 0 6px;
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
  font-size: 14px;
  color: var(--muted);
}

.aux a {
  color: #335e49;
  font-weight: 700;
  text-decoration: none;
}

.aux a:hover {
  text-decoration: underline;
}

.error {
  margin: 0;
}
</style>
