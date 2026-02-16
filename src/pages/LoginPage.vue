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
  <section class="card">
    <h1>Sign In</h1>

    <form class="form" @submit.prevent="submit">
      <label>
        Email
        <input v-model="email" type="email" required />
      </label>

      <label>
        Password
        <input v-model="password" type="password" required />
      </label>

      <button type="submit" :disabled="loading">
        {{ loading ? 'Signing in...' : 'Sign in' }}
      </button>

      <p v-if="error" class="error">{{ error }}</p>
    </form>
  </section>
</template>

<style scoped>
.card {
  max-width: 420px;
  border: 1px solid #ddd;
  padding: 16px;
  border-radius: 8px;
}

.form {
  display: grid;
  gap: 12px;
}

.form input {
  width: 100%;
  padding: 8px;
  box-sizing: border-box;
}

.error {
  color: #b91c1c;
  margin: 0;
}
</style>
