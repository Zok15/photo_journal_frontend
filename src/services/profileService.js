import { api } from '../lib/api'

export function getProfile() {
  return api.get('/profile')
}
