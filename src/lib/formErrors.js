export function formatValidationErrorMessage(error, fallback = 'Request failed.') {
  const fallbackMessage = error?.message || error?.response?.data?.message || fallback
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
