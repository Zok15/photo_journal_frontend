import { describe, expect, it } from 'vitest'
import { normalizeApiError } from './errors'

describe('normalizeApiError', () => {
  it('normalizes 422 as validation error and keeps raw payload', () => {
    const raw = {
      message: 'Request failed with status code 422',
      response: {
        status: 422,
        data: {
          message: 'Validation failed.',
          errors: {
            title: ['The title field is required.'],
          },
        },
      },
    }

    const normalized = normalizeApiError(raw)

    expect(normalized.type).toBe('validation')
    expect(normalized.message).toBe('Validation failed.')
    expect(normalized.fields).toEqual({
      title: ['The title field is required.'],
    })
    expect(normalized.raw).toBe(raw)
    expect(normalized.response).toBe(raw.response)
  })

  it('normalizes request without response as network error', () => {
    const raw = {
      message: 'Network Error',
      request: {},
    }

    const normalized = normalizeApiError(raw)

    expect(normalized.type).toBe('network')
    expect(normalized.status).toBe(0)
    expect(normalized.message).toBe('Network Error')
    expect(normalized.raw).toBe(raw)
  })

  it('normalizes 5xx as server error', () => {
    const raw = {
      response: {
        status: 503,
        data: {
          message: 'Service unavailable.',
        },
      },
    }

    const normalized = normalizeApiError(raw)

    expect(normalized.type).toBe('server')
    expect(normalized.status).toBe(503)
    expect(normalized.message).toBe('Service unavailable.')
    expect(normalized.raw).toBe(raw)
  })
})
