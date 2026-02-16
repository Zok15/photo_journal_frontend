<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { setSession } from '../lib/session'

const route = useRoute()
const router = useRouter()

const email = ref('admin@example.com')
const password = ref('admin12345')
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
    error.value = e?.response?.data?.message || 'Login failed.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <section class="login-card">
      <div class="login-brand">
        <img src="/logo.png" alt="Bird logo" class="brand-logo" />
        <p class="eyebrow">Фото Дневник</p>
      </div>
      <h1>Вход в дневник</h1>
      <p class="lead">Авторизация для работы с вашими сериями и фотографиями.</p>

      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span>Email</span>
          <input v-model="email" type="email" required />
        </label>

        <label class="field">
          <span>Пароль</span>
          <input v-model="password" type="password" required />
        </label>

        <button type="submit" class="primary-btn" :disabled="loading">
          {{ loading ? 'Входим...' : 'Войти' }}
        </button>

        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  --bg: #e8e9e6;
  --panel: #f4f5f2;
  --line: #dde0d9;
  --text: #313a35;
  --muted: #748077;
  --accent: #5d9776;
  min-height: calc(100vh - 58px);
  background:
    radial-gradient(700px 220px at 15% 0%, rgba(183, 201, 190, 0.35), transparent 65%),
    radial-gradient(860px 260px at 100% 15%, rgba(218, 206, 188, 0.28), transparent 70%),
    var(--bg);
  display: grid;
  place-items: center;
  padding: 24px;
}

.login-card {
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

.login-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-logo {
  width: 30px;
  height: 30px;
  display: block;
}

.login-card h1 {
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

.primary-btn {
  border: 0;
  border-radius: 9px;
  cursor: pointer;
  font-weight: 700;
  padding: 10px 14px;
  background: var(--accent);
  color: #eff7f2;
}

.primary-btn:hover {
  background: #4f8366;
}

.primary-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.error {
  color: #9f2f2f;
  margin: 0;
}
</style>
