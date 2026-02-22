export function formatValidationErrorMessage(error, fallback = 'Request failed.') {
  const rawMessage = String(error?.message || error?.response?.data?.message || fallback)
  const normalized = rawMessage.toLowerCase()
  const fallbackMessage = normalized.includes('post data is too large')
    ? 'Upload payload is too large for server limits. Try fewer files at once or smaller files.'
    : rawMessage
  const fields = error?.fields || error?.response?.data?.errors

  if (!fields) {
    return fallbackMessage
  }

  const lines = Object.values(fields)
    .flat()
    .filter(Boolean)

  if (!lines.length) {
    return fallbackMessage
  }

  return `${fallbackMessage} ${lines.join(' ')}`
}
