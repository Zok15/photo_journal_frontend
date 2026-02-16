import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from '../pages/LoginPage.vue'
import ProfilePage from '../pages/ProfilePage.vue'
import SeriesListPage from '../pages/SeriesListPage.vue'
import SeriesViewPage from '../pages/SeriesViewPage.vue'
import { getToken } from '../lib/session'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: LoginPage,
    meta: { guestOnly: true },
  },
  {
    path: '/',
    redirect: '/series',
  },
  {
    path: '/series',
    name: 'series.list',
    component: SeriesListPage,
    meta: { requiresAuth: true },
  },
  {
    path: '/series/:id',
    name: 'series.view',
    component: SeriesViewPage,
    meta: { requiresAuth: true },
  },
  {
    path: '/profile',
    name: 'profile',
    component: ProfilePage,
    meta: { requiresAuth: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const token = getToken()

  if (to.meta.requiresAuth && !token) {
    return {
      name: 'login',
      query: { redirect: to.fullPath },
    }
  }

  if (to.meta.guestOnly && token) {
    return { name: 'series.list' }
  }

  return true
})

export default router
