import router from '../router'
import { clearSession } from './session'
import { clearApiCache } from './requestCache'

let logoutInProgress = false

export async function logout({ reason = 'manual' } = {}) {
  if (logoutInProgress) {
    return
  }

  logoutInProgress = true

  try {
    clearSession()
    clearApiCache()

    const query = reason && reason !== 'manual' ? { reason } : {}

    if (router.currentRoute.value?.name !== 'login') {
      await router.push({ path: '/login', query })
    }
  } finally {
    logoutInProgress = false
  }
}
