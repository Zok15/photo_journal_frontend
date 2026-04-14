import { ref } from 'vue'
import { downloadSeriesPhotoOriginal, listSeriesPhotos } from '../services/seriesService'

const SERIES_PHOTOS_PAGE_SIZE = 100
const DOWNLOAD_DELAY_MS = 180

function parseDownloadFileName(contentDisposition, fallbackName) {
  if (!contentDisposition) {
    return fallbackName
  }

  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1].replace(/["']/g, ''))
    } catch (_) {
      return utfMatch[1].replace(/["']/g, '')
    }
  }

  const asciiMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
  return asciiMatch?.[1] || fallbackName
}

function triggerBrowserDownload(blob, fileName) {
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = blobUrl
  link.download = fileName
  link.rel = 'noopener'

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  window.setTimeout(() => {
    URL.revokeObjectURL(blobUrl)
  }, 1000)
}

function wait(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}

function normalizeErrorMessage(error, fallbackMessage) {
  const responseMessage = error?.response?.data?.message
  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return responseMessage
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message
  }

  return fallbackMessage
}

export function useSeriesDownload(options = {}) {
  const t = typeof options?.t === 'function' ? options.t : (value) => value
  const downloadingSeriesKeys = ref({})
  const downloadingPhotoKeys = ref({})
  const downloadProgressBySeriesKey = ref({})

  function setSeriesDownloading(seriesKey, active) {
    downloadingSeriesKeys.value = {
      ...downloadingSeriesKeys.value,
      [seriesKey]: active,
    }
  }

  function setPhotoDownloading(seriesKey, photoId, active) {
    const key = `${seriesKey}:${photoId}`
    downloadingPhotoKeys.value = {
      ...downloadingPhotoKeys.value,
      [key]: active,
    }
  }

  function setSeriesProgress(seriesKey, progress) {
    downloadProgressBySeriesKey.value = {
      ...downloadProgressBySeriesKey.value,
      [seriesKey]: progress,
    }
  }

  function clearSeriesProgress(seriesKey) {
    const next = { ...downloadProgressBySeriesKey.value }
    delete next[seriesKey]
    downloadProgressBySeriesKey.value = next
  }

  function isSeriesDownloading(seriesKey) {
    return Boolean(downloadingSeriesKeys.value[String(seriesKey || '').trim()])
  }

  function isPhotoDownloading(seriesKey, photoId) {
    const key = `${String(seriesKey || '').trim()}:${String(photoId || '').trim()}`
    return Boolean(downloadingPhotoKeys.value[key])
  }

  function downloadProgressText(seriesKey) {
    return downloadProgressBySeriesKey.value[String(seriesKey || '').trim()] || ''
  }

  async function downloadPhotoOriginal(seriesKey, photo, fallbackMessage = t('Не удалось скачать оригинал фото.')) {
    const normalizedSeriesKey = String(seriesKey || '').trim()
    const photoId = Number(photo?.id || 0)

    if (!normalizedSeriesKey || photoId <= 0) {
      return
    }

    const fallbackName = photo?.original_name || `photo-${photoId}.jpg`
    setPhotoDownloading(normalizedSeriesKey, photoId, true)

    try {
      const response = await downloadSeriesPhotoOriginal(normalizedSeriesKey, photoId)
      const fileName = parseDownloadFileName(response.headers?.['content-disposition'], fallbackName)
      triggerBrowserDownload(response.data, fileName)
    } catch (error) {
      throw new Error(normalizeErrorMessage(error, fallbackMessage))
    } finally {
      setPhotoDownloading(normalizedSeriesKey, photoId, false)
    }
  }

  async function loadAllSeriesPhotos(seriesKey) {
    const normalizedSeriesKey = String(seriesKey || '').trim()
    const photos = []
    let page = 1
    let lastPage = 1

    do {
      const { data } = await listSeriesPhotos(normalizedSeriesKey, {
        page,
        per_page: SERIES_PHOTOS_PAGE_SIZE,
        sort_by: 'id',
        sort_dir: 'asc',
      })

      const pageItems = Array.isArray(data?.data) ? data.data : []
      photos.push(...pageItems)

      lastPage = Math.max(1, Number(data?.last_page || 1))
      page += 1
    } while (page <= lastPage)

    return photos
  }

  async function downloadSeries(options = {}) {
    const seriesKey = String(options?.seriesKey || '').trim()
    const fallbackMessage = options?.fallbackMessage || t('Не удалось скачать серию.')

    if (!seriesKey) {
      return
    }

    if (isSeriesDownloading(seriesKey)) {
      return
    }

    setSeriesDownloading(seriesKey, true)
    clearSeriesProgress(seriesKey)

    try {
      const resolvedPhotos = Array.isArray(options?.photos) && options.photos.length
        ? options.photos
        : await loadAllSeriesPhotos(seriesKey)

      if (!resolvedPhotos.length) {
        throw new Error(t('В этой серии пока нет фото.'))
      }

      for (let index = 0; index < resolvedPhotos.length; index += 1) {
        const photo = resolvedPhotos[index]
        setSeriesProgress(seriesKey, t('Скачиваем {current} из {total}...', {
          current: index + 1,
          total: resolvedPhotos.length,
        }))

        await downloadPhotoOriginal(
          seriesKey,
          photo,
          t('Не удалось скачать один из файлов серии.'),
        )

        if (index < resolvedPhotos.length - 1) {
          await wait(DOWNLOAD_DELAY_MS)
        }
      }
    } catch (error) {
      throw new Error(normalizeErrorMessage(error, fallbackMessage))
    } finally {
      setSeriesDownloading(seriesKey, false)
      clearSeriesProgress(seriesKey)
    }
  }

  return {
    downloadPhotoOriginal,
    downloadProgressText,
    downloadSeries,
    isPhotoDownloading,
    isSeriesDownloading,
  }
}
