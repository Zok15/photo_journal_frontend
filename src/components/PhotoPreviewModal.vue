<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  photo: {
    type: Object,
    default: null,
  },
  src: {
    type: String,
    default: '',
  },
  canPrev: {
    type: Boolean,
    default: false,
  },
  canNext: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close', 'prev', 'next'])

const zoomPercent = ref(100)
const previewNaturalWidth = ref(0)
const previewNaturalHeight = ref(0)
const viewportWidth = ref(window.innerWidth)
const viewportHeight = ref(window.innerHeight)
const previewStageRef = ref(null)
const isDraggingPreview = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragScrollLeft = ref(0)
const dragScrollTop = ref(0)

const previewImageStyle = computed(() => {
  if (!previewNaturalWidth.value || !previewNaturalHeight.value) {
    return {}
  }

  const maxWidth = Math.min(viewportWidth.value * 0.88, 1400)
  const maxHeight = Math.max(200, viewportHeight.value - 72)
  const fitScale = Math.min(
    maxWidth / previewNaturalWidth.value,
    maxHeight / previewNaturalHeight.value,
    1,
  )
  const zoomScale = zoomPercent.value / 100
  const finalWidth = Math.round(previewNaturalWidth.value * fitScale * zoomScale)
  const finalHeight = Math.round(previewNaturalHeight.value * fitScale * zoomScale)

  return {
    width: `${Math.max(1, finalWidth)}px`,
    height: `${Math.max(1, finalHeight)}px`,
    maxWidth: 'none',
    maxHeight: 'none',
  }
})

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (!isOpen || wasOpen) {
      return
    }

    // Reset zoom only when opening modal first time.
    // Navigation between photos keeps current zoom level.
    zoomPercent.value = 100
    previewNaturalWidth.value = 0
    previewNaturalHeight.value = 0
    isDraggingPreview.value = false
  },
  { immediate: true },
)

function zoomIn() {
  zoomPercent.value = Math.min(300, zoomPercent.value + 10)
}

function zoomOut() {
  zoomPercent.value = Math.max(50, zoomPercent.value - 10)
}

function onPreviewImageLoad(event) {
  previewNaturalWidth.value = event.target?.naturalWidth || 0
  previewNaturalHeight.value = event.target?.naturalHeight || 0
}

function syncViewport() {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
}

function onPreviewMouseDown(event) {
  const stage = previewStageRef.value
  if (!stage) {
    return
  }

  isDraggingPreview.value = true
  dragStartX.value = event.clientX
  dragStartY.value = event.clientY
  dragScrollLeft.value = stage.scrollLeft
  dragScrollTop.value = stage.scrollTop
}

function onPreviewMouseMove(event) {
  if (!isDraggingPreview.value) {
    return
  }

  const stage = previewStageRef.value
  if (!stage) {
    return
  }

  const dx = event.clientX - dragStartX.value
  const dy = event.clientY - dragStartY.value

  stage.scrollLeft = dragScrollLeft.value - dx
  stage.scrollTop = dragScrollTop.value - dy
}

function stopPreviewDrag() {
  isDraggingPreview.value = false
}

onMounted(() => {
  window.addEventListener('resize', syncViewport)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewport)
})
</script>

<template>
  <div v-if="open && photo" class="preview-overlay" @click.self="emit('close')">
    <div class="preview-shell">
      <button
        type="button"
        class="preview-nav-btn preview-nav-btn--left"
        :disabled="!canPrev"
        @click="emit('prev')"
      >
        ‹
      </button>

      <button
        type="button"
        class="preview-nav-btn preview-nav-btn--right"
        :disabled="!canNext"
        @click="emit('next')"
      >
        ›
      </button>

      <div class="preview-toolbar">
        <div class="preview-actions">
          <button type="button" class="preview-btn" @click="zoomOut">-</button>
          <span class="zoom-value">{{ zoomPercent }}%</span>
          <button type="button" class="preview-btn" @click="zoomIn">+</button>
          <button type="button" class="preview-btn preview-btn-close" @click="emit('close')">×</button>
        </div>
      </div>

      <div
        ref="previewStageRef"
        class="preview-stage"
        :class="{ 'preview-stage--dragging': isDraggingPreview }"
        @mousedown="onPreviewMouseDown"
        @mousemove="onPreviewMouseMove"
        @mouseup="stopPreviewDrag"
        @mouseleave="stopPreviewDrag"
      >
        <div class="preview-inner">
          <img
            class="preview-image"
            :src="src"
            :alt="photo.original_name || 'photo'"
            :style="previewImageStyle"
            @load="onPreviewImageLoad"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(25, 31, 27, 0.84);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 20px;
}

.preview-shell {
  position: relative;
  width: min(92vw, 1400px);
  height: calc(100vh - 40px);
  border-radius: 12px;
  border: 1px solid #56645a;
  background: #222924;
  overflow: hidden;
}

.preview-toolbar {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 3;
  height: 40px;
  background: #1e2621;
  border: 1px solid #445247;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-btn {
  border: 0;
  border-radius: 7px;
  min-width: 30px;
  height: 30px;
  cursor: pointer;
  font-weight: 700;
  color: #eef4ef;
  background: rgba(49, 65, 56, 0.86);
  padding: 0 9px;
}

.preview-btn:hover {
  background: rgba(78, 101, 88, 0.92);
}

.preview-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.zoom-value {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  color: #eef4ef;
  font-weight: 700;
  min-width: 56px;
  text-align: center;
}

.preview-btn-close {
  min-width: 32px;
  font-size: 18px;
}

.preview-stage {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 16px;
  cursor: grab;
  user-select: none;
}

.preview-stage--dragging {
  cursor: grabbing;
}

.preview-inner {
  min-width: 100%;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-image {
  display: block;
  width: auto;
  height: auto;
  max-width: min(88vw, 1400px);
  max-height: calc(100vh - 72px);
  object-fit: contain;
  pointer-events: none;
}

.preview-nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 4;
  border: 0;
  width: 42px;
  height: 64px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 34px;
  line-height: 1;
  color: #eef4ef;
  background: rgba(30, 38, 33, 0.72);
}

.preview-nav-btn:hover {
  background: rgba(62, 77, 68, 0.9);
}

.preview-nav-btn:disabled {
  opacity: 0.28;
  cursor: default;
}

.preview-nav-btn--left {
  left: 10px;
}

.preview-nav-btn--right {
  right: 10px;
}

@media (max-width: 680px) {
  .preview-actions {
    gap: 6px;
  }

  .preview-toolbar {
    top: 8px;
    right: 8px;
  }

  .preview-nav-btn {
    width: 36px;
    height: 54px;
    font-size: 28px;
  }

  .preview-nav-btn--left {
    left: 6px;
  }

  .preview-nav-btn--right {
    right: 6px;
  }
}
</style>
