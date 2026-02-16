<script setup>
import { computed } from 'vue'
import { api } from './lib/api'
import { logout as performLogout } from './lib/logout'
import { isAuthenticated } from './lib/session'

const signedIn = computed(() => isAuthenticated.value)

async function logout() {
  try {
    await api.post('/auth/logout')
  } catch (_) {
    // Ignore backend logout errors; local session must still be cleared.
  }

  await performLogout({ reason: 'manual' })
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
        <RouterLink v-if="signedIn" to="/series" class="nav-link">Серии</RouterLink>
        <RouterLink v-if="signedIn" to="/profile" class="nav-link">Профиль</RouterLink>
        <RouterLink v-if="!signedIn" to="/login" class="nav-link">Вход</RouterLink>
        <button v-if="signedIn" type="button" class="logout-btn" @click="logout">Выход</button>
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
  --line: #dde0d9;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
  background: #f4f5f2;
  box-shadow: 0 6px 18px rgba(79, 86, 80, 0.08);
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
  gap: 8px;
  align-items: center;
}

.nav-link,
.logout-btn {
  text-decoration: none;
  color: #35403a;
  background: #edf1ec;
  border: 1px solid #d6dbd4;
  border-radius: 9px;
  font-weight: 700;
  padding: 8px 12px;
  line-height: 1;
}

.nav-link.router-link-active {
  background: #ddeee4;
  border-color: #b9d5c4;
  color: #335e49;
}

.nav-link:hover,
.logout-btn:hover {
  background: #e4eae3;
}

.logout-btn {
  cursor: pointer;
}

@media (max-width: 700px) {
  .app-header {
    padding: 10px 12px;
    gap: 10px;
    flex-direction: column;
    align-items: flex-start;
  }

  .app-nav {
    width: 100%;
    flex-wrap: wrap;
  }
}

.app-content {
  min-height: calc(100vh - 58px);
}
</style>
