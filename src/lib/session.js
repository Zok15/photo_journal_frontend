import { computed, ref } from 'vue'
import { setAuthToken } from './api'
import { syncLocaleFromUser } from './i18n'
import { clearApiCache } from './requestCache'

const TOKEN_KEY = 'pj_token'

const token = ref(localStorage.getItem(TOKEN_KEY) || '')
const user = ref(null)

if (token.value) {
  setAuthToken(token.value)
}

export const isAuthenticated = computed(() => Boolean(token.value))

export function getToken() {
  return token.value
}

export function getUser() {
  return user.value
}

export function setSession(nextToken, nextUser = null) {
  clearApiCache()

  token.value = nextToken
  user.value = nextUser

  localStorage.setItem(TOKEN_KEY, nextToken)
  setAuthToken(nextToken)
  syncLocaleFromUser(nextUser)
}

export function clearSession() {
  clearApiCache()

  token.value = ''
  user.value = null

  localStorage.removeItem(TOKEN_KEY)
  setAuthToken('')
}

export function setCurrentUser(nextUser) {
  user.value = nextUser
  syncLocaleFromUser(nextUser)
}

export const session = {
  clear: clearSession,
}
