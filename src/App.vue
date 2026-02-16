<script setup>
import { onMounted, ref } from 'vue'
import { api, setAuthToken } from './lib/api'

const email = ref('admin@example.com')
const password = ref('admin12345')
const token = ref(localStorage.getItem('pj_token') || '')
const user = ref(null)
const series = ref([])
const error = ref('')
const loading = ref(false)

async function login() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await api.post('/auth/login', {
      email: email.value,
      password: password.value,
    })

    token.value = data.token
    user.value = data.user
    localStorage.setItem('pj_token', token.value)
    setAuthToken(token.value)
    await loadSeries()
  } catch (e) {
    error.value = e?.response?.data?.message || 'Login failed'
  } finally {
    loading.value = false
  }
}

async function restore() {
  if (!token.value) return

  setAuthToken(token.value)

  try {
    const { data } = await api.get('/auth/me')
    user.value = data.data
    await loadSeries()
  } catch (_) {
    logoutLocal()
  }
}

async function loadSeries() {
  const { data } = await api.get('/series', { params: { per_page: 20 } })
  series.value = data.data || []
}

async function logout() {
  try {
    await api.post('/auth/logout')
  } finally {
    logoutLocal()
  }
}

function logoutLocal() {
  token.value = ''
  user.value = null
  series.value = []
  localStorage.removeItem('pj_token')
  setAuthToken('')
}

onMounted(restore)
</script>

<template>
  <main style="max-width: 960px; margin: 0 auto; padding: 24px; font-family: sans-serif;">
    <h1 style="margin-top: 0;">Photo Journal Frontend</h1>

    <section v-if="!token" style="max-width: 420px; border: 1px solid #ddd; padding: 16px; border-radius: 8px;">
      <h2 style="margin-top: 0;">Login</h2>

      <form @submit.prevent="login" style="display: grid; gap: 12px;">
        <label>
          Email
          <input v-model="email" type="email" style="width: 100%; padding: 8px;" />
        </label>

        <label>
          Password
          <input v-model="password" type="password" style="width: 100%; padding: 8px;" />
        </label>

        <button type="submit" :disabled="loading" style="padding: 8px 12px;">
          {{ loading ? 'Loading...' : 'Sign in' }}
        </button>

        <p v-if="error" style="margin: 0; color: #b91c1c;">{{ error }}</p>
      </form>
    </section>

    <section v-else>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 style="margin: 0;">Dashboard</h2>
        <button @click="logout" style="padding: 8px 12px;">Logout</button>
      </div>

      <p>Signed in as: <strong>{{ user?.email }}</strong></p>

      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Description</th>
            <th>Photos</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in series" :key="item.id">
            <td>{{ item.id }}</td>
            <td>{{ item.title }}</td>
            <td>{{ item.description }}</td>
            <td>{{ item.photos_count }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>
