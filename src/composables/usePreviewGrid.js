import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resolveMissingAspectRatios } from '../lib/imageAspectRatio'
import { buildPreviewRowsWithDynamicGrid } from '../lib/previewRows'

export function usePreviewGrid(options) {
  const {
    photoList,
    resolvePhotoUrl,
  } = options

  const previewGridWidth = ref(0)
  const previewAspectRatios = ref({})
  const previewGridRef = ref(null)

  let previewResizeObserver = null
  let previewRatioRequestId = 0

  const previewRows = computed(() => {
    const photos = photoList.value
    if (!photos.length) {
      return []
    }

    const width = previewGridWidth.value || 1120
    return buildPreviewRowsWithDynamicGrid(
      photos,
      width,
      previewAspectRatios.value,
      {
        gap: 10,
        minPerRow: 3,
        maxPerRow: 6,
        preferredPerRow: 4,
        mobileMinPerRow: 1,
        mobileMaxPerRow: 2,
        minTileWidthMobile: 200,
        minTileWidthDesktop: 260,
        maxTileWidthMobile: 340,
        maxTileWidthDesktop: 420,
        mobileBreakPoint: 760,
        stretchLastRow: true,
        clampRowHeights: false,
      },
    ).rows
  })

  function syncPreviewGridObserver() {
    if (!previewResizeObserver) {
      return
    }

    previewResizeObserver.disconnect()

    if (!previewGridRef.value) {
      return
    }

    previewResizeObserver.observe(previewGridRef.value)
    previewGridWidth.value = previewGridRef.value.clientWidth || 0
  }

  onMounted(() => {
    previewResizeObserver = new ResizeObserver((entries) => {
      const [entry] = entries
      const width = Number(entry?.contentRect?.width || 0)
      if (width > 0) {
        previewGridWidth.value = width
      }
    })

    syncPreviewGridObserver()
  })

  onBeforeUnmount(() => {
    previewResizeObserver?.disconnect()
    previewResizeObserver = null
  })

  watch(photoList, async (photos) => {
    const requestId = ++previewRatioRequestId
    previewAspectRatios.value = {}
    const ratioPatch = await resolveMissingAspectRatios(
      photos,
      {},
      (photo) => resolvePhotoUrl(photo),
    )
    if (requestId !== previewRatioRequestId) {
      return
    }

    previewAspectRatios.value = ratioPatch
    syncPreviewGridObserver()
  }, { immediate: true })

  watch(previewGridRef, () => {
    syncPreviewGridObserver()
  }, { immediate: true })

  return {
    previewGridWidth,
    previewAspectRatios,
    previewGridRef,
    previewRows,
  }
}
