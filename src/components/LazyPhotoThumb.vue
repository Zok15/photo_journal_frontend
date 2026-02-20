<script setup>
import { ref, watch } from 'vue'
import { t } from '../lib/i18n'

const props = defineProps({
  src: {
    type: String,
    default: '',
  },
  fallbackSrc: {
    type: String,
    default: '',
  },
  alt: {
    type: String,
    default: 'photo',
  },
})

const currentSrc = ref('')
const loaded = ref(false)
const failed = ref(false)

watch(
  () => [props.src, props.fallbackSrc],
  () => {
    currentSrc.value = props.src || props.fallbackSrc || ''
    loaded.value = false
    failed.value = false
  },
  { immediate: true },
)

function onLoad() {
  loaded.value = true
}

function onError() {
  const fallback = String(props.fallbackSrc || '').trim()
  if (fallback && currentSrc.value !== fallback) {
    currentSrc.value = fallback
    loaded.value = false
    failed.value = false
    return
  }

  failed.value = true
  loaded.value = true
}
</script>

<template>
  <div class="thumb-wrap">
    <div v-if="!loaded" class="thumb-skeleton"></div>
    <div v-if="loaded && failed" class="thumb-fallback">{{ t('Фото недоступно') }}</div>
    <img
      class="thumb"
      :class="{ 'thumb--loaded': loaded, 'thumb--failed': failed, 'thumb--hidden': failed }"
      :src="currentSrc"
      :alt="alt"
      loading="lazy"
      decoding="async"
      @load="onLoad"
      @error="onError"
    />
  </div>
</template>

<style scoped>
.thumb-wrap {
  position: relative;
  min-height: var(--thumb-min-height, 160px);
  background: #eef2ec;
}

.thumb-skeleton {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      110deg,
      rgba(198, 207, 199, 0.32) 8%,
      rgba(231, 236, 231, 0.7) 18%,
      rgba(198, 207, 199, 0.32) 33%
    );
  background-size: 200% 100%;
  animation: thumb-skeleton 1.3s linear infinite;
}

.thumb {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
  opacity: 0;
  transform: scale(1.01);
  transition: opacity 0.18s ease-out, transform 0.22s ease-out;
  background: linear-gradient(135deg, #8fb39b 0%, #d6e2cf 45%, #f0e8d8 100%);
}

.thumb--loaded {
  opacity: 1;
  transform: none;
}

.thumb--failed {
  filter: grayscale(0.25);
}

.thumb--hidden {
  opacity: 0;
}

.thumb-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #5e6c62;
  font-size: 13px;
  background: linear-gradient(135deg, #ecf1ea 0%, #e4ebe1 100%);
}

@keyframes thumb-skeleton {
  from {
    background-position-x: 200%;
  }

  to {
    background-position-x: -200%;
  }
}
</style>
