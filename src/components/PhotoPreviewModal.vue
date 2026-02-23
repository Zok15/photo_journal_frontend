<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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
const previewImageRef = ref(null)
const isZoomOverflowing = ref(false)
const isZoomOverflowingX = ref(false)
const isZoomOverflowingY = ref(false)
const isDraggingPreview = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragScrollLeft = ref(0)
const dragScrollTop = ref(0)
const isTouchPanning = ref(false)
const touchPanStartX = ref(0)
const touchPanStartY = ref(0)
const pinchStartDistance = ref(0)
const pinchStartZoom = ref(100)

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
    isZoomOverflowing.value = false
    isZoomOverflowingX.value = false
    isZoomOverflowingY.value = false
    isDraggingPreview.value = false
  },
  { immediate: true },
)

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

async function applyZoom(nextZoom, focusClientX = null, focusClientY = null) {
  const boundedZoom = clamp(nextZoom, 50, 300)
  if (boundedZoom === zoomPercent.value) {
    return
  }

  const stage = previewStageRef.value
  const image = previewImageRef.value

  if (!stage || !image) {
    zoomPercent.value = boundedZoom
    return
  }

  const stageRect = stage.getBoundingClientRect()
  const hasFocusPoint = Number.isFinite(focusClientX) && Number.isFinite(focusClientY)
  const centerContentX = hasFocusPoint
    ? stage.scrollLeft + (focusClientX - stageRect.left)
    : stage.scrollLeft + stage.clientWidth / 2
  const centerContentY = hasFocusPoint
    ? stage.scrollTop + (focusClientY - stageRect.top)
    : stage.scrollTop + stage.clientHeight / 2
  const imageLeft = image.offsetLeft
  const imageTop = image.offsetTop
  const imageWidth = image.clientWidth
  const imageHeight = image.clientHeight
  const relX = imageWidth > 0 ? clamp((centerContentX - imageLeft) / imageWidth, 0, 1) : 0.5
  const relY = imageHeight > 0 ? clamp((centerContentY - imageTop) / imageHeight, 0, 1) : 0.5

  zoomPercent.value = boundedZoom
  await nextTick()

  const nextStage = previewStageRef.value
  const nextImage = previewImageRef.value
  if (!nextStage || !nextImage) {
    return
  }

  const targetContentX = nextImage.offsetLeft + relX * nextImage.clientWidth
  const targetContentY = nextImage.offsetTop + relY * nextImage.clientHeight
  const nextScrollLeft = targetContentX - nextStage.clientWidth / 2
  const nextScrollTop = targetContentY - nextStage.clientHeight / 2
  const maxScrollLeft = Math.max(0, nextStage.scrollWidth - nextStage.clientWidth)
  const maxScrollTop = Math.max(0, nextStage.scrollHeight - nextStage.clientHeight)

  nextStage.scrollLeft = clamp(nextScrollLeft, 0, maxScrollLeft)
  nextStage.scrollTop = clamp(nextScrollTop, 0, maxScrollTop)
  refreshZoomOverflow()
}

function zoomIn() {
  applyZoom(zoomPercent.value + 10)
}

function zoomOut() {
  applyZoom(zoomPercent.value - 10)
}

function onPreviewWheel(event) {
  if (!(event.ctrlKey || event.metaKey)) {
    return
  }

  event.preventDefault()
  const step = event.deltaY < 0 ? 12 : -12
  applyZoom(zoomPercent.value + step, event.clientX, event.clientY)
}

function onPreviewDoubleClick(event) {
  event.preventDefault()
  const targetZoom = zoomPercent.value > 100 ? 100 : 200
  applyZoom(targetZoom, event.clientX, event.clientY)
}

function onPreviewKeyDown(event) {
  if (!props.open) {
    return
  }

  const key = String(event.key || '')
  if (key === '+' || key === '=') {
    event.preventDefault()
    applyZoom(zoomPercent.value + 10)
    return
  }

  if (key === '-' || key === '_') {
    event.preventDefault()
    applyZoom(zoomPercent.value - 10)
    return
  }

  if (key === '0') {
    event.preventDefault()
    applyZoom(100)
  }
}

function onPreviewImageLoad(event) {
  previewNaturalWidth.value = event.target?.naturalWidth || 0
  previewNaturalHeight.value = event.target?.naturalHeight || 0
  nextTick(() => {
    refreshZoomOverflow()
  })
}

function syncViewport() {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
  nextTick(() => {
    refreshZoomOverflow()
  })
}

function refreshZoomOverflow() {
  const stage = previewStageRef.value
  const image = previewImageRef.value

  if (!stage || !image || zoomPercent.value <= 100) {
    isZoomOverflowing.value = false
    isZoomOverflowingX.value = false
    isZoomOverflowingY.value = false
    return
  }

  const overflowX = image.offsetWidth > stage.clientWidth + 1
  const overflowY = image.offsetHeight > stage.clientHeight + 1
  isZoomOverflowingX.value = overflowX
  isZoomOverflowingY.value = overflowY
  isZoomOverflowing.value = overflowX || overflowY
}

function onPreviewMouseDown(event) {
  if (event.button !== 0) {
    return
  }

  const stage = previewStageRef.value
  if (!stage) {
    return
  }

  event.preventDefault()
  isDraggingPreview.value = true
  dragStartX.value = event.clientX
  dragStartY.value = event.clientY
  dragScrollLeft.value = stage.scrollLeft
  dragScrollTop.value = stage.scrollTop
  window.addEventListener('mousemove', onPreviewMouseMove)
  window.addEventListener('mouseup', stopPreviewDrag)
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
  window.removeEventListener('mousemove', onPreviewMouseMove)
  window.removeEventListener('mouseup', stopPreviewDrag)
  isDraggingPreview.value = false
}

function distanceBetweenTouches(firstTouch, secondTouch) {
  const dx = secondTouch.clientX - firstTouch.clientX
  const dy = secondTouch.clientY - firstTouch.clientY
  return Math.hypot(dx, dy)
}

function onPreviewTouchStart(event) {
  const stage = previewStageRef.value
  if (!stage) {
    return
  }

  if (event.touches.length === 2) {
    event.preventDefault()
    const firstTouch = event.touches[0]
    const secondTouch = event.touches[1]
    pinchStartDistance.value = distanceBetweenTouches(firstTouch, secondTouch)
    pinchStartZoom.value = zoomPercent.value
    isTouchPanning.value = false
    return
  }

  if (event.touches.length === 1 && zoomPercent.value > 100) {
    const touch = event.touches[0]
    isTouchPanning.value = true
    touchPanStartX.value = touch.clientX
    touchPanStartY.value = touch.clientY
    dragScrollLeft.value = stage.scrollLeft
    dragScrollTop.value = stage.scrollTop
    return
  }

  isTouchPanning.value = false
}

function onPreviewTouchMove(event) {
  const stage = previewStageRef.value
  if (!stage) {
    return
  }

  if (event.touches.length === 2 && pinchStartDistance.value > 0) {
    event.preventDefault()
    const firstTouch = event.touches[0]
    const secondTouch = event.touches[1]
    const currentDistance = distanceBetweenTouches(firstTouch, secondTouch)
    if (currentDistance <= 0) {
      return
    }

    const scale = currentDistance / pinchStartDistance.value
    const nextZoom = clamp(Math.round(pinchStartZoom.value * scale), 50, 300)
    if (nextZoom !== zoomPercent.value) {
      zoomPercent.value = nextZoom
      nextTick(() => {
        refreshZoomOverflow()
      })
    }
    return
  }

  if (event.touches.length === 1 && isTouchPanning.value && zoomPercent.value > 100) {
    event.preventDefault()
    const touch = event.touches[0]
    const dx = touch.clientX - touchPanStartX.value
    const dy = touch.clientY - touchPanStartY.value

    stage.scrollLeft = dragScrollLeft.value - dx
    stage.scrollTop = dragScrollTop.value - dy
  }
}

function onPreviewTouchEnd(event) {
  if (event.touches.length < 2) {
    pinchStartDistance.value = 0
  }

  if (event.touches.length === 1 && zoomPercent.value > 100) {
    const stage = previewStageRef.value
    const touch = event.touches[0]
    if (stage && touch) {
      isTouchPanning.value = true
      touchPanStartX.value = touch.clientX
      touchPanStartY.value = touch.clientY
      dragScrollLeft.value = stage.scrollLeft
      dragScrollTop.value = stage.scrollTop
      return
    }
  }

  if (event.touches.length === 0) {
    isTouchPanning.value = false
  }
}

onMounted(() => {
  window.addEventListener('resize', syncViewport)
  window.addEventListener('keydown', onPreviewKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewport)
  window.removeEventListener('keydown', onPreviewKeyDown)
  window.removeEventListener('mousemove', onPreviewMouseMove)
  window.removeEventListener('mouseup', stopPreviewDrag)
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

      <button type="button" class="preview-close-btn" @click="emit('close')">×</button>

      <div class="preview-toolbar">
        <div class="preview-actions">
          <button type="button" class="preview-btn" @click="zoomOut">-</button>
          <span class="zoom-value">{{ zoomPercent }}%</span>
          <button type="button" class="preview-btn" @click="zoomIn">+</button>
        </div>
      </div>

      <div
        ref="previewStageRef"
        class="preview-stage"
        :class="{ 'preview-stage--dragging': isDraggingPreview }"
        @mousedown="onPreviewMouseDown"
        @dblclick="onPreviewDoubleClick"
        @wheel="onPreviewWheel"
        @touchstart="onPreviewTouchStart"
        @touchmove="onPreviewTouchMove"
        @touchend="onPreviewTouchEnd"
        @touchcancel="onPreviewTouchEnd"
      >
        <div
          class="preview-inner"
          :class="{
            'preview-inner--zoomed': zoomPercent > 100 && isZoomOverflowing,
            'preview-inner--overflow-x': zoomPercent > 100 && isZoomOverflowingX,
            'preview-inner--overflow-y': zoomPercent > 100 && isZoomOverflowingY,
          }"
        >
          <img
            ref="previewImageRef"
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
  right: 62px;
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

.preview-close-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 4;
  border: 0;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 24px;
  line-height: 1;
  color: #eef4ef;
  background: rgba(30, 38, 33, 0.86);
}

.preview-close-btn:hover {
  background: rgba(62, 77, 68, 0.92);
}

.preview-stage {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 16px;
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.preview-stage--dragging {
  cursor: grabbing;
}

.preview-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-inner--zoomed {
  width: max-content;
  height: max-content;
  min-width: 100%;
  min-height: 100%;
}

.preview-inner--overflow-x {
  justify-content: flex-start;
}

.preview-inner--overflow-y {
  align-items: flex-start;
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
    right: 54px;
  }

  .preview-close-btn {
    top: 8px;
    right: 8px;
    width: 38px;
    height: 38px;
    font-size: 22px;
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
