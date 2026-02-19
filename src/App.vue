<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from './lib/api'
import { logout as performLogout } from './lib/logout'
import { isAuthenticated } from './lib/session'
import { availableLocales, currentLocale, localeLabel, setLocale, t } from './lib/i18n'

const signedIn = computed(() => isAuthenticated.value)
const userMenuOpen = ref(false)
const userMenuRef = ref(null)

async function logout() {
  try {
    await api.post('/auth/logout')
  } catch (_) {
    // Ignore backend logout errors; local session must still be cleared.
  }

  await performLogout({ reason: 'manual' })
  userMenuOpen.value = false
}

function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value
}

function closeUserMenu() {
  userMenuOpen.value = false
}

function onUserMenuAction() {
  closeUserMenu()
}

function onPointerDown(event) {
  if (!userMenuOpen.value) {
    return
  }

  if (userMenuRef.value?.contains(event.target)) {
    return
  }

  closeUserMenu()
}

function onKeyDown(event) {
  if (event.key === 'Escape') {
    closeUserMenu()
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink to="/" class="brand brand-link">
        <img src="/logo.png" alt="Bird logo" class="brand-logo" />
        <strong>PhotoLog</strong>
      </RouterLink>

      <nav class="app-nav">
        <div class="locale-switch" role="group" :aria-label="t('Язык интерфейса')">
          <button
            v-for="loc in availableLocales"
            :key="loc"
            type="button"
            class="locale-btn"
            :class="{ 'locale-btn--active': currentLocale === loc }"
            @click="setLocale(loc)"
          >
            {{ localeLabel(loc) }}
          </button>
        </div>

        <RouterLink to="/public/series" class="public-link">{{ t('Публичные') }}</RouterLink>
        <RouterLink v-if="!signedIn" to="/login" class="nav-link">{{ t('Вход') }}</RouterLink>
        <RouterLink v-if="!signedIn" to="/register" class="nav-link">{{ t('Регистрация') }}</RouterLink>

        <div v-if="signedIn" ref="userMenuRef" class="user-menu">
          <button
            type="button"
            class="user-menu-trigger"
            :aria-expanded="userMenuOpen ? 'true' : 'false'"
            :title="t('Профиль')"
            @click="toggleUserMenu"
          >
            <span aria-hidden="true">👤</span>
          </button>

          <div v-if="userMenuOpen" class="user-menu-dropdown">
            <RouterLink to="/series" class="user-menu-item" @click="onUserMenuAction">{{ t('Серии') }}</RouterLink>
            <RouterLink to="/profile" class="user-menu-item" @click="onUserMenuAction">{{ t('Профиль') }}</RouterLink>
            <button type="button" class="user-menu-item user-menu-item--danger" @click="logout">{{ t('Выход') }}</button>
          </div>
        </div>
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
  width: 40px;
  height: 40px;
  display: block;
}

.app-nav {
  display: flex;
  gap: 8px;
  align-items: center;
}

.locale-switch {
  display: inline-flex;
  border: 1px solid #d6dbd4;
  border-radius: 10px;
  overflow: hidden;
  background: #edf1ec;
}

.locale-btn {
  border: 0;
  background: transparent;
  color: #35403a;
  font-weight: 700;
  padding: 8px 10px;
  line-height: 1;
  cursor: pointer;
}

.locale-btn + .locale-btn {
  border-left: 1px solid #d6dbd4;
}

.locale-btn--active {
  background: #ddeee4;
  color: #335e49;
}

.public-link {
  color: #335e49;
  text-decoration: none;
  font-weight: 700;
  padding: 4px 2px;
  border-bottom: 2px solid transparent;
  line-height: 1;
}

.public-link:hover {
  border-bottom-color: #335e49;
}

.nav-link,
.user-menu-item {
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
.user-menu-item:hover {
  background: #e4eae3;
}

.user-menu {
  position: relative;
}

.user-menu-trigger {
  border: 1px solid #d6dbd4;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  background: #edf1ec;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.user-menu-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 160px;
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid #d6dbd4;
  border-radius: 10px;
  background: #f7f9f6;
  box-shadow: 0 12px 26px rgba(52, 62, 56, 0.14);
  z-index: 20;
}

.user-menu-item {
  width: 100%;
  box-sizing: border-box;
  text-align: left;
}

.user-menu-item--danger {
  color: #7a1e1e;
  background: #f8e9e9;
  border-color: #bc7a7a;
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
