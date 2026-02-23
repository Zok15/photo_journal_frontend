<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { api } from '../lib/api'
import { getToken } from '../lib/session'
import { t } from '../lib/i18n'

const route = useRoute()

const loading = ref(true)
const success = ref(false)
const message = ref('')

const primaryLink = computed(() => (getToken() ? '/series' : '/login'))
const primaryLabel = computed(() => (getToken() ? t('Перейти в мой журнал') : t('Перейти ко входу')))

async function verify() {
  const id = String(route.query.id || '').trim()
  const hash = String(route.query.hash || '').trim()
  const expires = String(route.query.expires || '').trim()
  const signature = String(route.query.signature || '').trim()

  if (!id || !hash || !expires || !signature) {
    loading.value = false
    success.value = false
    message.value = t('Ссылка подтверждения неполная или устарела.')
    return
  }

  try {
    const { data } = await api.get(`/auth/verify-email/${encodeURIComponent(id)}/${encodeURIComponent(hash)}`, {
      params: { expires, signature },
    })
    success.value = true
    message.value = data?.message || t('Email подтверждён.')
  } catch (e) {
    success.value = false
    message.value = e?.response?.data?.message || t('Не удалось подтвердить email.')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  verify()
})
</script>

<template>
  <div class="verify-page">
    <section class="verify-card">
      <div class="verify-brand">
        <img src="/logo.png" alt="Bird logo" class="brand-logo" />
        <p class="eyebrow">{{ t('Фото Дневник') }}</p>
      </div>

      <h1>{{ t('Подтверждение email') }}</h1>
      <p class="lead">{{ t('Проверяем ссылку подтверждения...') }}</p>

      <p v-if="loading" class="state-text">{{ t('Проверяем...') }}</p>
      <p v-else :class="success ? 'success' : 'error'">{{ message }}</p>

      <div class="actions">
        <RouterLink class="primary-btn link-btn" :to="primaryLink">{{ primaryLabel }}</RouterLink>
        <RouterLink class="aux-link" to="/">{{ t('На главную') }}</RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.verify-page {
  min-height: calc(100vh - 58px);
  background:
    radial-gradient(700px 220px at 15% 0%, rgba(183, 201, 190, 0.35), transparent 65%),
    radial-gradient(860px 260px at 100% 15%, rgba(218, 206, 188, 0.28), transparent 70%),
    var(--bg);
  display: grid;
  place-items: center;
  padding: 24px;
}

.verify-card {
  width: min(520px, 100%);
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  box-shadow: 0 20px 40px rgba(79, 86, 80, 0.1);
  padding: 22px;
  color: var(--text);
  display: grid;
  gap: 10px;
}

.verify-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-logo {
  width: 30px;
  height: 30px;
  display: block;
}

.eyebrow {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.verify-card h1 {
  margin: 8px 0 0;
  font-size: 34px;
  letter-spacing: -0.03em;
}

.lead {
  margin: 0;
  color: #4b574f;
}

.state-text,
.success,
.error {
  margin: 0;
}

.success {
  color: #2f7a43;
}

.actions {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.link-btn {
  text-decoration: none;
}

.aux-link {
  color: #335e49;
  font-weight: 700;
  text-decoration: none;
}

.aux-link:hover {
  text-decoration: underline;
}
</style>
