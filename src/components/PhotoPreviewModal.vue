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
const previewViewportWidth = ref(0)
const previewViewportHeight = ref(0)
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
const pinchRafId = ref(0)
const pinchPendingZoom = ref(0)
const pinchPendingFocusX = ref(0)
const pinchPendingFocusY = ref(0)
let applyZoomVersion = 0

const previewImageStyle = computed(() => {
  if (!previewNaturalWidth.value || !previewNaturalHeight.value) {
    return {}
  }

  const stageWidth = previewViewportWidth.value > 0 ? previewViewportWidth.value : viewportWidth.value * 0.88
  const stageHeight = previewViewportHeight.value > 0 ? previewViewportHeight.value : (viewportHeight.value - 72)
  const maxWidth = Math.min(stageWidth, 1400)
  const maxHeight = Math.max(140, stageHeight)
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
    nextTick(() => {
      syncStageMetrics()
      const stage = previewStageRef.value
      if (stage) {
        stage.scrollLeft = 0
        stage.scrollTop = 0
      }
    })
  },
  { immediate: true },
)

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

async function applyZoom(nextZoom, focusClientX = null, focusClientY = null) {
  const currentVersion = ++applyZoomVersion
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
  const pointX = hasFocusPoint
    ? clamp(focusClientX - stageRect.left, 0, stage.clientWidth)
    : stage.clientWidth / 2
  const pointY = hasFocusPoint
    ? clamp(focusClientY - stageRect.top, 0, stage.clientHeight)
    : stage.clientHeight / 2

  const oldScrollWidth = Math.max(1, stage.scrollWidth)
  const oldScrollHeight = Math.max(1, stage.scrollHeight)
  const anchorX = stage.scrollLeft + pointX
  const anchorY = stage.scrollTop + pointY
  const anchorRatioX = clamp(anchorX / oldScrollWidth, 0, 1)
  const anchorRatioY = clamp(anchorY / oldScrollHeight, 0, 1)

  zoomPercent.value = boundedZoom
  await nextTick()

  // Ignore stale zoom operations that were superseded by newer gesture frames.
  if (currentVersion !== applyZoomVersion) {
    return
  }

  const nextStage = previewStageRef.value
  const nextImage = previewImageRef.value
  if (!nextStage || !nextImage) {
    return
  }

  if (boundedZoom <= 100) {
    nextStage.scrollLeft = 0
    nextStage.scrollTop = 0
    return
  }

  const targetContentX = anchorRatioX * Math.max(1, nextStage.scrollWidth)
  const targetContentY = anchorRatioY * Math.max(1, nextStage.scrollHeight)
  const nextScrollLeft = targetContentX - pointX
  const nextScrollTop = targetContentY - pointY
  const maxScrollLeft = Math.max(0, nextStage.scrollWidth - nextStage.clientWidth)
  const maxScrollTop = Math.max(0, nextStage.scrollHeight - nextStage.clientHeight)

  nextStage.scrollLeft = clamp(nextScrollLeft, 0, maxScrollLeft)
  nextStage.scrollTop = clamp(nextScrollTop, 0, maxScrollTop)
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
    syncStageMetrics()
  })
}

function syncViewport() {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
  syncStageMetrics()
}

function syncStageMetrics() {
  const stage = previewStageRef.value
  if (!stage) {
    return
  }

  const styles = window.getComputedStyle(stage)
  const paddingX = (Number.parseFloat(styles.paddingLeft || '0') || 0)
    + (Number.parseFloat(styles.paddingRight || '0') || 0)
  const paddingY = (Number.parseFloat(styles.paddingTop || '0') || 0)
    + (Number.parseFloat(styles.paddingBottom || '0') || 0)

  previewViewportWidth.value = Math.max(1, stage.clientWidth - paddingX)
  previewViewportHeight.value = Math.max(1, stage.clientHeight - paddingY)
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
      const focusClientX = (firstTouch.clientX + secondTouch.clientX) / 2
      const focusClientY = (firstTouch.clientY + secondTouch.clientY) / 2
      schedulePinchZoom(nextZoom, focusClientX, focusClientY)
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
    cancelPendingPinchZoom()
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

function schedulePinchZoom(nextZoom, focusClientX, focusClientY) {
  pinchPendingZoom.value = nextZoom
  pinchPendingFocusX.value = focusClientX
  pinchPendingFocusY.value = focusClientY

  if (pinchRafId.value) {
    return
  }

  pinchRafId.value = window.requestAnimationFrame(() => {
    pinchRafId.value = 0
    applyZoom(
      pinchPendingZoom.value,
      pinchPendingFocusX.value,
      pinchPendingFocusY.value,
    )
  })
}

function cancelPendingPinchZoom() {
  if (!pinchRafId.value) {
    return
  }

  window.cancelAnimationFrame(pinchRafId.value)
  pinchRafId.value = 0
}

onMounted(() => {
  window.addEventListener('resize', syncViewport)
  window.addEventListener('keydown', onPreviewKeyDown)
  nextTick(() => {
    syncStageMetrics()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewport)
  window.removeEventListener('keydown', onPreviewKeyDown)
  window.removeEventListener('mousemove', onPreviewMouseMove)
  window.removeEventListener('mouseup', stopPreviewDrag)
  cancelPendingPinchZoom()
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
        :class="{
          'preview-stage--dragging': isDraggingPreview,
          'preview-stage--fit': zoomPercent <= 100,
        }"
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
            'preview-inner--zoomed': zoomPercent > 100,
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
  height: calc(100dvh - 40px);
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

.preview-stage--fit {
  overflow: hidden;
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
  .preview-overlay {
    padding: 0;
  }

  .preview-shell {
    width: 100vw;
    height: 100dvh;
    border-radius: 0;
    border: 0;
  }

  .preview-stage {
    padding: 10px;
  }

  .preview-actions {
    gap: 6px;
  }

  .preview-toolbar {
    top: max(8px, env(safe-area-inset-top));
    right: calc(max(8px, env(safe-area-inset-right)) + 46px);
  }

  .preview-close-btn {
    top: max(8px, env(safe-area-inset-top));
    right: max(8px, env(safe-area-inset-right));
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
    left: max(6px, env(safe-area-inset-left));
  }

  .preview-nav-btn--right {
    right: max(6px, env(safe-area-inset-right));
  }
}
</style>
