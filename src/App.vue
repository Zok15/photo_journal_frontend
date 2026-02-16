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
      <div class="brand">
        <img src="/logo.png" alt="Bird logo" class="brand-logo" />
        <strong>Photo Journal</strong>
      </div>

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
  min-height: 100vh;
  font-family: 'Manrope', 'Trebuchet MS', 'Verdana', sans-serif;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 22px;
  border-bottom: 1px solid #dadfd8;
  background: #f3f4f1;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-logo {
  width: 34px;
  height: 34px;
  display: block;
}

.app-nav {
  display: flex;
  gap: 12px;
  align-items: center;
}

.app-nav button {
  cursor: pointer;
  border: 0;
  border-radius: 8px;
  background: #dfe8df;
  padding: 7px 10px;
}

.app-content {
  min-height: calc(100vh - 58px);
}
</style>
