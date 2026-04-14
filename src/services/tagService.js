import { api } from '../lib/api'

export function suggestTags(params = {}) {
  return api.get('/tags/suggest', { params })
}
