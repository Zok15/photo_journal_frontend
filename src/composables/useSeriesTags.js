import { computed, ref } from 'vue'
import { addSeriesTags, removeSeriesTag as removeSeriesTagRequest } from '../services/seriesService'
import { suggestTags } from '../services/tagService'

export function useSeriesTags(options) {
  const {
    canEditSeries,
    item,
    mergeSeriesPayload,
    currentSeriesKey,
    formatValidationError,
    t,
  } = options

  const newTagName = ref('')
  const addingTag = ref(false)
  const removingTagId = ref(null)
  const tagEditError = ref('')
  const showTagInput = ref(false)
  const tagSuggestions = ref([])
  const tagSuggestionsLoading = ref(false)

  const attachedTagLookup = computed(() => {
    const tags = Array.isArray(item.value?.tags) ? item.value.tags : []

    return new Set(
      tags
        .map((tag) => String(tag?.name || '').trim().toLowerCase())
        .filter(Boolean),
    )
  })

  let tagSuggestTimerId = null
  let tagSuggestRequestId = 0

  async function addSeriesTag() {
    if (!canEditSeries.value) return
    const seriesKey = currentSeriesKey()
    if (!seriesKey) return

    const prepared = String(newTagName.value || '').trim()
    if (!prepared) {
      tagEditError.value = t('Введите тег.')
      return
    }

    addingTag.value = true
    tagEditError.value = ''

    try {
      const { data } = await addSeriesTags(seriesKey, [prepared])

      item.value = mergeSeriesPayload(data?.data)
      newTagName.value = ''
      tagSuggestions.value = []
      closeTagInput()
    } catch (e) {
      tagEditError.value = formatValidationError(e)
    } finally {
      addingTag.value = false
    }
  }

  function openTagInput() {
    if (!canEditSeries.value) return
    showTagInput.value = true
    tagEditError.value = ''
    scheduleTagSuggestions()
  }

  function closeTagInput() {
    if (addingTag.value) return
    showTagInput.value = false
    newTagName.value = ''
    tagSuggestions.value = []
    tagSuggestionsLoading.value = false
    if (tagSuggestTimerId !== null) {
      clearTimeout(tagSuggestTimerId)
      tagSuggestTimerId = null
    }
  }

  async function removeSeriesTag(tag) {
    if (!tag?.id || !canEditSeries.value) return
    const seriesKey = currentSeriesKey()
    if (!seriesKey) return

    removingTagId.value = tag.id
    tagEditError.value = ''

    try {
      const { data } = await removeSeriesTagRequest(seriesKey, tag.id)
      item.value = mergeSeriesPayload(data?.data)
    } catch (e) {
      tagEditError.value = e?.response?.data?.message || t('Не удалось удалить тег.')
    } finally {
      removingTagId.value = null
    }
  }

  function pickSuggestedTag(name) {
    newTagName.value = name
    tagSuggestions.value = []
  }

  function scheduleTagSuggestions() {
    if (!showTagInput.value) return

    if (tagSuggestTimerId !== null) {
      clearTimeout(tagSuggestTimerId)
    }

    tagSuggestTimerId = window.setTimeout(() => {
      fetchTagSuggestions()
    }, 180)
  }

  async function fetchTagSuggestions() {
    const query = String(newTagName.value || '').trim()

    const requestId = ++tagSuggestRequestId
    tagSuggestionsLoading.value = true

    try {
      const { data } = await suggestTags({
        q: query || undefined,
        limit: 8,
      })

      if (requestId !== tagSuggestRequestId) {
        return
      }

      const current = query.toLowerCase()
      const existing = attachedTagLookup.value
      tagSuggestions.value = (Array.isArray(data?.data) ? data.data : [])
        .map((tag) => String(tag?.name || '').trim())
        .filter(Boolean)
        .filter((name) => name.toLowerCase() !== current)
        .filter((name) => !existing.has(name.toLowerCase()))
        .slice(0, 8)
    } catch (_) {
      if (requestId === tagSuggestRequestId) {
        tagSuggestions.value = []
      }
    } finally {
      if (requestId === tagSuggestRequestId) {
        tagSuggestionsLoading.value = false
      }
    }
  }

  function cleanup() {
    if (tagSuggestTimerId !== null) {
      clearTimeout(tagSuggestTimerId)
      tagSuggestTimerId = null
    }
  }

  return {
    newTagName,
    addingTag,
    removingTagId,
    tagEditError,
    showTagInput,
    tagSuggestions,
    tagSuggestionsLoading,
    addSeriesTag,
    openTagInput,
    closeTagInput,
    removeSeriesTag,
    pickSuggestedTag,
    scheduleTagSuggestions,
    cleanupSeriesTags: cleanup,
  }
}
