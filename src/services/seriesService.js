import { api } from '../lib/api'

export function getSeries(seriesKey, params = {}) {
  return api.get(`/series/${seriesKey}`, { params })
}

export function getPublicSeries(seriesKey, params = {}) {
  return api.get(`/public/series/${seriesKey}`, { params })
}

export function listSeriesPhotos(seriesKey, params = {}) {
  return api.get(`/series/${seriesKey}/photos`, { params })
}

export function updateSeries(seriesKey, payload) {
  return api.patch(`/series/${seriesKey}`, payload)
}

export function reorderSeriesPhotos(seriesKey, photoIds) {
  return api.patch(`/series/${seriesKey}/photos/reorder`, {
    photo_ids: photoIds,
  })
}

export function deleteSeries(seriesKey) {
  return api.delete(`/series/${seriesKey}`)
}

export function uploadSeriesPhotos(seriesKey, formData) {
  return api.post(`/series/${seriesKey}/photos`, formData)
}

export function deleteSeriesPhoto(seriesKey, photoId) {
  return api.delete(`/series/${seriesKey}/photos/${photoId}`)
}

export function renameSeriesPhoto(seriesKey, photoId, originalName) {
  return api.patch(`/series/${seriesKey}/photos/${photoId}`, {
    original_name: originalName,
  })
}

export function downloadSeriesPhotoOriginal(seriesKey, photoId) {
  return api.get(`/series/${seriesKey}/photos/${photoId}/download`, {
    responseType: 'blob',
  })
}

export function refreshSeriesAutoTags(seriesKey) {
  return api.post(`/series/${seriesKey}/photos/retag`)
}

export function publishSeriesAsAdmin(seriesKey) {
  return api.post(`/admin/series/${seriesKey}/publish`)
}

export function addSeriesTags(seriesKey, tags) {
  return api.post(`/series/${seriesKey}/tags`, { tags })
}

export function removeSeriesTag(seriesKey, tagId) {
  return api.delete(`/series/${seriesKey}/tags/${tagId}`)
}
