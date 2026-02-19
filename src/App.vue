<script setup>
import { computed } from 'vue'
import { api } from './lib/api'
import { logout as performLogout } from './lib/logout'
import { isAuthenticated } from './lib/session'
import { availableLocales, currentLocale, setLocale, t } from './lib/i18n'

const signedIn = computed(() => isAuthenticated.value)

async function logout() {
  try {
    await api.post('/auth/logout')
  } catch (_) {
    // Ignore backend logout errors; local session must still be cleared.
  }

  await performLogout({ reason: 'manual' })
}

function onLocaleChange(event) {
  setLocale(event.target.value)
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink to="/" class="brand brand-link">
        <img src="/logo.png" alt="Bird logo" class="brand-logo" />
        <strong>PhotoLog</strong>
      </RouterLink>

      <nav class="app-nav">
        <label class="locale-select-wrap">
          <span class="locale-label">{{ t('Язык интерфейса') }}</span>
          <select class="locale-select" :value="currentLocale" @change="onLocaleChange">
            <option v-for="loc in availableLocales" :key="loc" :value="loc">
              {{ loc === 'ru' ? t('Русский') : t('Английский') }}
            </option>
          </select>
        </label>
        <RouterLink to="/public/series" class="nav-link">{{ t('Публичные') }}</RouterLink>
        <RouterLink v-if="signedIn" to="/series" class="nav-link">{{ t('Серии') }}</RouterLink>
        <RouterLink v-if="signedIn" to="/profile" class="nav-link">{{ t('Профиль') }}</RouterLink>
        <RouterLink v-if="!signedIn" to="/login" class="nav-link">{{ t('Вход') }}</RouterLink>
        <RouterLink v-if="!signedIn" to="/register" class="nav-link">{{ t('Регистрация') }}</RouterLink>
        <button v-if="signedIn" type="button" class="logout-btn" @click="logout">{{ t('Выход') }}</button>
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

.brand-link {
  color: inherit;
  text-decoration: none;
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

.locale-select-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.locale-label {
  font-size: 12px;
  color: #55615a;
}

.locale-select {
  border: 1px solid #d6dbd4;
  border-radius: 9px;
  background: #edf1ec;
  color: #35403a;
  font-weight: 700;
  padding: 7px 8px;
  line-height: 1;
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
