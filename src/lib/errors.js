export function normalizeApiError(rawError) {
  const status = Number(rawError?.response?.status || 0)
  const responseData = rawError?.response?.data || null
  const fallbackMessage = responseData?.message || rawError?.message || 'Request failed.'

  if (status === 422) {
    return {
      type: 'validation',
      message: fallbackMessage,
      fields: responseData?.errors || {},
      raw: rawError,
      response: rawError?.response,
      status,
    }
  }

  if (!rawError?.response) {
    return {
      type: 'network',
      message: fallbackMessage,
      raw: rawError,
      response: rawError?.response,
      status: 0,
    }
  }

  if (status >= 500) {
    return {
      type: 'server',
      message: fallbackMessage,
      raw: rawError,
      response: rawError?.response,
      status,
    }
  }

  return {
    type: 'http',
    message: fallbackMessage,
    raw: rawError,
    response: rawError?.response,
    status,
  }
}
