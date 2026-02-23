<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from './lib/api'
import { logout as performLogout } from './lib/logout'
import { getUser, isAuthenticated, setCurrentUser } from './lib/session'
import { availableLocales, currentLocale, localeLabel, setLocale, t } from './lib/i18n'
import { applySeoForRoute } from './lib/seo'

const route = useRoute()
const signedIn = computed(() => isAuthenticated.value)
const currentUser = computed(() => getUser())
const journalMenuLabel = computed(() => {
  const title = String(currentUser.value?.journal_title || '').trim()
  return title || t('Мой фотодневник')
})
const userMenuOpen = ref(false)
const userMenuRef = ref(null)
const verificationResending = ref(false)
const verificationInfo = ref('')
const verificationError = ref('')

const emailVerificationRequired = computed(() => {
  if (!signedIn.value) {
    return false
  }

  if (route.name === 'verify-email') {
    return false
  }

  return !currentUser.value?.email_verified_at
})

const verificationEmail = computed(() => String(currentUser.value?.email || '').trim())

function localizeVerificationApiMessage(rawMessage, fallbackKey) {
  const message = String(rawMessage || '').trim()
  if (!message) {
    return t(fallbackKey)
  }

  if (message === 'Verification email has been sent.') {
    return t('Письмо для подтверждения отправлено повторно.')
  }

  if (message === 'Email already verified.') {
    return t('Email уже подтверждён.')
  }

  if (message === 'Verification email service is unavailable.') {
    return t('Сервис отправки писем недоступен.')
  }

  return message
}

async function changeLocale(nextLocale) {
  if (nextLocale === currentLocale.value) {
    return
  }

  const previous = currentLocale.value
  setLocale(nextLocale)

  if (!signedIn.value) {
    return
  }

  try {
    const { data } = await api.patch('/profile', { locale: nextLocale })
    const user = data?.data || null
    if (user) {
      setCurrentUser(user)
    }
  } catch (_) {
    // Keep UI consistent with server profile if update fails.
    setLocale(previous)
  }
}

async function logout() {
  try {
    await api.post('/auth/logout')
  } catch (_) {
    // Ignore backend logout errors; local session must still be cleared.
  }

  await performLogout({ reason: 'manual' })
  userMenuOpen.value = false
}

async function ensureCurrentUser() {
  if (!signedIn.value || currentUser.value?.id) {
    return
  }

  try {
    const { data } = await api.get('/profile')
    const user = data?.data || null
    if (user) {
      setCurrentUser(user)
    }
  } catch (_) {
    // Keep app usable even if profile request fails.
  }
}

async function resendVerificationEmail() {
  if (!emailVerificationRequired.value || verificationResending.value) {
    return
  }

  verificationResending.value = true
  verificationInfo.value = ''
  verificationError.value = ''

  try {
    const { data } = await api.post('/auth/email/verification-notification', {
      locale: currentLocale.value,
    })
    verificationInfo.value = localizeVerificationApiMessage(
      data?.message,
      'Письмо для подтверждения отправлено повторно.',
    )
  } catch (e) {
    verificationError.value = localizeVerificationApiMessage(
      e?.response?.data?.message,
      'Не удалось отправить письмо подтверждения.',
    )
  } finally {
    verificationResending.value = false
  }
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
  ensureCurrentUser()
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('keydown', onKeyDown)
})

watch(
  [() => route.fullPath, () => currentLocale.value],
  () => {
    applySeoForRoute(route, { locale: currentLocale.value, t })
  },
  { immediate: true },
)

watch(
  () => emailVerificationRequired.value,
  (required) => {
    if (!required) {
      verificationInfo.value = ''
      verificationError.value = ''
    }
  },
)
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
            @click="changeLocale(loc)"
          >
            {{ localeLabel(loc) }}
          </button>
        </div>

        <RouterLink to="/public/series" class="public-link">{{ t('Галерея') }}</RouterLink>
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
            <RouterLink to="/series" class="user-menu-item" @click="onUserMenuAction">{{ journalMenuLabel }}</RouterLink>
            <RouterLink to="/profile" class="user-menu-item" @click="onUserMenuAction">{{ t('Профиль') }}</RouterLink>
            <button type="button" class="user-menu-item user-menu-item--danger" @click="logout">{{ t('Выход') }}</button>
          </div>
        </div>
      </nav>
    </header>

    <section v-if="emailVerificationRequired" class="verification-banner" role="status" aria-live="polite">
      <div class="verification-banner__text">
        <strong>{{ t('Подтвердите email, чтобы активировать все возможности аккаунта.') }}</strong>
        <span v-if="verificationEmail">{{ t('Мы отправили письмо на {email}.', { email: verificationEmail }) }}</span>
      </div>
      <div class="verification-banner__actions">
        <button type="button" class="verification-btn" :disabled="verificationResending" @click="resendVerificationEmail">
          {{ verificationResending ? t('Отправляем...') : t('Отправить письмо повторно') }}
        </button>
      </div>
      <p v-if="verificationInfo" class="verification-banner__info">{{ verificationInfo }}</p>
      <p v-if="verificationError" class="verification-banner__error">{{ verificationError }}</p>
    </section>

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

.verification-banner {
  border-bottom: 1px solid #e2d9bf;
  background: #fff8e5;
  color: #54420d;
  padding: 10px 20px;
  display: grid;
  gap: 6px;
}

.verification-banner__text {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}

.verification-banner__text span {
  color: #6f5a1f;
}

.verification-banner__actions {
  display: flex;
}

.verification-btn {
  border: 1px solid #d5bf79;
  background: #fff4cf;
  color: #5a450f;
  border-radius: 8px;
  padding: 6px 10px;
  font-weight: 700;
  cursor: pointer;
}

.verification-btn:disabled {
  cursor: default;
  opacity: 0.75;
}

.verification-banner__info,
.verification-banner__error {
  margin: 0;
}

.verification-banner__info {
  color: #2f7a43;
}

.verification-banner__error {
  color: #a12222;
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

  .verification-banner {
    padding: 10px 12px;
  }
}

.app-content {
  min-height: calc(100vh - 58px);
}
</style>
