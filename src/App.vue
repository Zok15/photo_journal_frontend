<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { api } from './lib/api'
import { clearSession, isAuthenticated } from './lib/session'

const router = useRouter()

const signedIn = computed(() => isAuthenticated.value)

async function logout() {
  try {
    await api.post('/auth/logout')
  } catch (_) {
    // Ignore backend logout errors; local session must still be cleared.
  } finally {
    clearSession()
    router.push({ name: 'login' })
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <strong>Photo Journal</strong>

      <nav class="app-nav">
        <RouterLink v-if="signedIn" to="/series">Series</RouterLink>
        <RouterLink v-if="!signedIn" to="/login">Login</RouterLink>
        <button v-if="signedIn" type="button" @click="logout">Logout</button>
      </nav>
    </header>

    <main class="app-content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  max-width: 980px;
  margin: 0 auto;
  padding: 24px;
  font-family: Arial, sans-serif;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.app-nav {
  display: flex;
  gap: 12px;
  align-items: center;
}

.app-nav button {
  cursor: pointer;
}

.app-content {
  min-height: 320px;
}
</style>
