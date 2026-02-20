import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from '../pages/LoginPage.vue'
import RegisterPage from '../pages/RegisterPage.vue'
import ForgotPasswordPage from '../pages/ForgotPasswordPage.vue'
import ResetPasswordPage from '../pages/ResetPasswordPage.vue'
import PrivacyPolicyPage from '../pages/PrivacyPolicyPage.vue'
import ProfilePage from '../pages/ProfilePage.vue'
import SeriesListPage from '../pages/SeriesListPage.vue'
import SeriesViewPage from '../pages/SeriesViewPage.vue'
import HomePage from '../pages/HomePage.vue'
import PublicSeriesListPage from '../pages/PublicSeriesListPage.vue'
import { getToken } from '../lib/session'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: LoginPage,
    meta: {
      guestOnly: true,
      seo: {
        title: 'Вход',
        description: 'Авторизация для работы с вашими сериями и фотографиями.',
        index: false,
      },
    },
  },
  {
    path: '/register',
    name: 'register',
    component: RegisterPage,
    meta: {
      guestOnly: true,
      seo: {
        title: 'Регистрация',
        description: 'Создайте аккаунт для работы с вашими сериями и фотографиями.',
        index: false,
      },
    },
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: ForgotPasswordPage,
    meta: {
      guestOnly: true,
      seo: {
        title: 'Восстановление пароля',
        description: 'Запрос ссылки для восстановления пароля.',
        index: false,
      },
    },
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: ResetPasswordPage,
    meta: {
      guestOnly: true,
      seo: {
        title: 'Новый пароль',
        description: 'Установка нового пароля по ссылке восстановления.',
        index: false,
      },
    },
  },
  {
    path: '/privacy-policy',
    name: 'privacy-policy',
    component: PrivacyPolicyPage,
    meta: {
      seo: {
        title: 'Политика конфиденциальности',
        description: 'Информация об обработке и защите персональных данных в PhotoLog.',
        index: true,
      },
    },
  },
  {
    path: '/',
    name: 'home',
    component: HomePage,
    meta: {
      seo: {
        title: 'Удобный фотоархив серий для веба',
        description: 'PhotoLog помогает хранить серии фотографий в аккуратной структуре и быстро находить нужное по названию, описанию, тегам, дате и автору.',
        index: true,
      },
    },
  },
  {
    path: '/public/series',
    name: 'series.public',
    component: PublicSeriesListPage,
    meta: {
      seo: {
        title: 'Галерея',
        description: 'Публичная галерея фотосерий PhotoLog с фильтрами по тегам, дате, автору и тексту.',
        index: true,
      },
    },
  },
  {
    path: '/series',
    name: 'series.list',
    component: SeriesListPage,
    meta: {
      requiresAuth: true,
      seo: {
        title: 'Серии',
        description: 'Личный список серий фотографий.',
        index: false,
      },
    },
  },
  {
    path: '/series/:slug',
    name: 'series.view',
    component: SeriesViewPage,
    meta: {
      seo: {
        title: 'Серия',
        description: 'Просмотр серии фотографий в PhotoLog.',
        index: true,
      },
    },
  },
  {
    path: '/profile',
    name: 'profile',
    component: ProfilePage,
    meta: {
      requiresAuth: true,
      seo: {
        title: 'Профиль',
        description: 'Настройки профиля PhotoLog.',
        index: false,
      },
    },
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
