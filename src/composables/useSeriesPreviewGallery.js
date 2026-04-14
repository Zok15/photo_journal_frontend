import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resolveMissingAspectRatios } from '../lib/imageAspectRatio'
import { buildPreviewRowsWithHeroPattern } from '../lib/previewRows'

export function useSeriesPreviewGallery(options) {
  const {
    series,
    previewMap,
    mobileBreakpoint = 1100,
    mobileMaxTiles = 12,
    desktopMaxTiles = 12,
  } = options

  const previewGridWidths = ref({})
  const previewAspectRatios = ref({})
  const isMobilePreviewViewport = ref(
    typeof window !== 'undefined' ? window.innerWidth <= mobileBreakpoint : false,
  )

  const previewGridElements = new Map()
  let previewResizeObserver = null

  function setPreviewGridRef(seriesId, element) {
    const previous = previewGridElements.get(seriesId)
    if (previous && previous !== element && previewResizeObserver) {
      previewResizeObserver.unobserve(previous)
    }

    if (!element) {
      previewGridElements.delete(seriesId)
      const nextWidths = { ...previewGridWidths.value }
      delete nextWidths[seriesId]
      previewGridWidths.value = nextWidths
      return
    }

    previewGridElements.set(seriesId, element)
    const nextWidth = element.clientWidth || 0
    if (previewGridWidths.value[seriesId] !== nextWidth) {
      previewGridWidths.value = {
        ...previewGridWidths.value,
        [seriesId]: nextWidth,
      }
    }

    if (previewResizeObserver) {
      previewResizeObserver.observe(element)
    }
  }

  function syncPreviewViewportMode() {
    if (typeof window === 'undefined') {
      return
    }

    isMobilePreviewViewport.value = window.innerWidth <= mobileBreakpoint
  }

  function previewTiles(seriesId) {
    const tiles = previewMap.value[seriesId] || []
    const limit = isMobilePreviewViewport.value ? mobileMaxTiles : desktopMaxTiles
    return tiles.slice(0, limit)
  }

  const previewRowsBySeries = computed(() => {
    const map = {}

    series.value.forEach((item) => {
      const seriesId = Number(item?.id || 0)
      if (!seriesId) {
        return
      }

      const photos = previewTiles(seriesId)
      if (!photos.length) {
        return
      }

      const width = previewGridWidths.value[seriesId] || 920
      const minPerRow = 3
      const maxPerRow = isMobilePreviewViewport.value ? 4 : 5
      const minGap = isMobilePreviewViewport.value ? 4 : 6
      const maxGap = isMobilePreviewViewport.value ? 7 : 10
      const targetGap = isMobilePreviewViewport.value ? 6 : 8
      const minRowHeight = isMobilePreviewViewport.value ? 92 : 86
      const maxRowHeight = isMobilePreviewViewport.value ? 242 : 320
      const targetTotalHeight = isMobilePreviewViewport.value
        ? Math.max(210, Math.min(420, width * 0.7))
        : Math.max(320, Math.min(580, width * 0.58))

      map[seriesId] = buildPreviewRowsWithHeroPattern(
        photos,
        width,
        previewAspectRatios.value,
        {
          minCount: photos.length,
          maxCount: photos.length,
          minPerRow,
          maxPerRow,
          maxRows: 3,
          targetTotalHeight,
          minGap,
          maxGap,
          minRowHeight,
          maxRowHeight,
          targetGap,
          rowHeightUniformityWeight: 0.12,
          ratioFallback: 1,
          fallbackGap: targetGap,
          fallbackMaxTiles: photos.length,
        },
      )
    })

    return map
  })

  function previewGridGap(seriesId) {
    return Number(previewRowsBySeries.value?.[seriesId]?.rows?.[0]?.gap ?? 8)
  }

  onMounted(() => {
    previewResizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const matched = Array.from(previewGridElements.entries()).find(([, element]) => element === entry.target)
        if (!matched) {
          return
        }

        const [seriesId] = matched
        const nextWidth = entry.contentRect.width
        if (previewGridWidths.value[seriesId] !== nextWidth) {
          previewGridWidths.value = {
            ...previewGridWidths.value,
            [seriesId]: nextWidth,
          }
        }
      })
    })

    window.addEventListener('resize', syncPreviewViewportMode)
    syncPreviewViewportMode()
  })

  onBeforeUnmount(() => {
    if (previewResizeObserver) {
      previewResizeObserver.disconnect()
      previewResizeObserver = null
    }

    window.removeEventListener('resize', syncPreviewViewportMode)
    previewGridElements.clear()
  })

  watch(
    previewMap,
    async (map) => {
      const photos = Object.values(map || {}).flat()
      const ratioPatch = await resolveMissingAspectRatios(
        photos,
        previewAspectRatios.value,
        (photo) => photo?.src,
      )

      if (Object.keys(ratioPatch).length) {
        previewAspectRatios.value = {
          ...previewAspectRatios.value,
          ...ratioPatch,
        }
      }
    },
    { immediate: true },
  )

  return {
    isMobilePreviewViewport,
    previewTiles,
    previewRowsBySeries,
    previewGridGap,
    setPreviewGridRef,
  }
}
