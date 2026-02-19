import { computed, ref } from 'vue'

const LOCALE_KEY = 'pj_locale'
const SUPPORTED_LOCALES = ['ru', 'en']

const en = {
  'Публичные': 'Public',
  'Серии': 'Series',
  'Профиль': 'Profile',
  'Вход': 'Login',
  'Регистрация': 'Register',
  'Выход': 'Logout',
  'Входим...': 'Signing in...',
  'Войти': 'Sign in',
  'Нет аккаунта?': "Don't have an account?",
  'Зарегистрироваться': 'Sign up',
  'Вход в дневник': 'Sign in',
  'Авторизация для работы с вашими сериями и фотографиями.': 'Sign in to manage your series and photos.',
  'Пароль': 'Password',
  'Пароли не совпадают.': 'Passwords do not match.',
  'Создаем аккаунт...': 'Creating account...',
  'Создайте аккаунт для работы с вашими сериями и фотографиями.': 'Create an account to manage your series and photos.',
  'Повторите пароль': 'Repeat password',
  'Уже есть аккаунт?': 'Already have an account?',
  'Имя': 'Name',
  'Личный кабинет': 'Profile',
  'Настройки имени и названия вашего журнала.': 'Set your name and journal title.',
  'Загрузка...': 'Loading...',
  'Имя обязательно.': 'Name is required.',
  'Профиль обновлён.': 'Profile updated.',
  'Название журнала': 'Journal title',
  'Мой фотодневник': 'My photo journal',
  'Текущее отображаемое название:': 'Current display title:',
  'Фото Дневник': 'Photo Journal',
  'Сохраняем...': 'Saving...',
  'Сохранить': 'Save',
  'Назад': 'Back',
  '← Назад': '← Back',
  'Язык интерфейса': 'Interface language',
  'Русский': 'Russian',
  'Английский': 'English',
  'Публичные серии': 'Public series',
  'Поиск': 'Search',
  'Название или описание': 'Title or description',
  'Найти': 'Search',
  'Автор': 'Author',
  'Начните вводить имя автора...': 'Start typing author name...',
  'Ничего не найдено': 'Nothing found',
  'Все авторы': 'All authors',
  'Теги': 'Tags',
  'Дата': 'Date',
  'От': 'From',
  'До': 'To',
  'Сортировка': 'Sort',
  'Новые': 'Newest',
  'Старые': 'Oldest',
  'Сбросить фильтры': 'Reset filters',
  'Публичные серии не найдены.': 'No public series found.',
  'Открыть': 'Open',
  'фото': 'photos',
  'Описание пока не добавлено.': 'No description yet.',
  'Страница': 'Page',
  'Вперёд': 'Next',
  'Login failed.': 'Login failed.',
  'Registration failed.': 'Registration failed.',
  'Failed to load profile.': 'Failed to load profile.',
  'Request failed.': 'Request failed.',
  'Failed to load public series.': 'Failed to load public series.',
  'Failed to load series.': 'Failed to load series.',
  'Без даты': 'No date',
  'Фото недоступно': 'Photo unavailable',
  'Обновляем теги...': 'Refreshing tags...',
  'Обновить теги': 'Refresh tags',
  'Добавить фото': 'Add photo',
  'Скрыть форму': 'Hide form',
  'Редактировать': 'Edit',
  'Удалить серию': 'Delete series',
  'Публичная': 'Public',
  'Приватная': 'Private',
  'Название обязательно.': 'Title is required.',
  'Не удалось сохранить порядок фото.': 'Failed to save photo order.',
  'Не удалось удалить серию.': 'Failed to delete series.',
  'Не удалось удалить фото.': 'Failed to delete photo.',
  'Не удалось переименовать фото.': 'Failed to rename photo.',
  'Не удалось скачать оригинал фото.': 'Failed to download original photo.',
  'Не удалось обновить теги.': 'Failed to refresh tags.',
  'Введите тег.': 'Enter a tag.',
  'Не удалось удалить тег.': 'Failed to remove tag.',
  'Серия не найдена или не является публичной.': 'Series not found or is not public.',
  'Редактировать': 'Edit',
  'Удалить серию': 'Delete series',
  'Поиск...': 'Searching...',
  'Оптимизация перед отправкой: до 2MB на файл.': 'Upload optimization: up to 2MB per file.',
  'Выбрано: {count} файл(ов)': 'Selected: {count} file(s)',
  'Загрузить фото': 'Upload photos',
  'Редактировать серию': 'Edit series',
  'Название': 'Title',
  'Описание': 'Description',
  'Публичная серия': 'Public series',
  'Отмена': 'Cancel',
  'Скачать оригинал': 'Download original',
  'Переименовать': 'Rename',
  'Удалить': 'Delete',
  'Удалить серию?': 'Delete series?',
  'Серия': 'Series',
  'Без названия': 'Untitled',
  'будет удалена без возможности восстановления.': 'will be permanently deleted.',
  'Удаляем...': 'Deleting...',
  'Удалить навсегда': 'Delete permanently',
  'Удалить фото?': 'Delete photo?',
  'Фото': 'Photo',
  'будет удалено без возможности восстановления.': 'will be permanently deleted.',
  'В этой серии пока нет фото.': 'This series has no photos yet.',
  'Новое название файла (расширение .{ext} менять нельзя)': 'New file name (you cannot change .{ext} extension)',
  'Теги обновлены для {processed} фото, ошибок: {failed}.': 'Tags refreshed for {processed} photos, failed: {failed}.',
  'Теги обновлены для {processed} фото.': 'Tags refreshed for {processed} photos.',
  'Vision-теггер выключен (VISION_TAGGER_ENABLED=false).': 'Vision tagger is disabled (VISION_TAGGER_ENABLED=false).',
  'Vision-теггер недоступен по сети.': 'Vision tagger is not reachable.',
  'Закрыть форму': 'Close form',
  'Новая серия': 'New series',
  'Скрыть фильтры': 'Hide filters',
  'Фильтр': 'Filter',
  'Фильтры': 'Filters',
  'дд.мм.гг': 'dd.mm.yy',
  'Очистить диапазон': 'Clear range',
  'Пн': 'Mo',
  'Вт': 'Tu',
  'Ср': 'We',
  'Чт': 'Th',
  'Пт': 'Fr',
  'Сб': 'Sa',
  'Вс': 'Su',
  'Поиск по тегам': 'Search tags',
  'Найти тег...': 'Find tag...',
  'Нет тегов': 'No tags',
  'Показать ещё': 'Show more',
  'Свернуть': 'Collapse',
  'Фотографии': 'Photos',
  'Создать серию': 'Create series',
  'Искать по названию и описанию...': 'Search by title and description...',
  'Серии не найдены.': 'No series found.',
  'за': 'for',
  'дн.': 'days',
  '{count} фото': '{count} photos',
  'Не удалось загрузить витрину серий.': 'Failed to load featured series.',
  'СЕРИИ ФОТОГРАФИЙ ДЛЯ ВЕБА': 'PHOTO SERIES FOR THE WEB',
  'Храните яркие фотосерии, находите нужное за секунды': 'Store vibrant photo series, find what you need in seconds',
  'PhotoLog сохраняет серии фотографий в формате, удобном для публикации и быстрого просмотра. Умный поиск по названию, описанию, тегам, дате и автору помогает сразу находить нужный момент.': 'PhotoLog stores photo series in a format built for fast publishing and browsing. Smart search by title, description, tags, date, and author helps you find the exact moment right away.',
  'Смотреть публичные серии': 'Browse public series',
  'Открыть мой журнал': 'Open my journal',
  'Начать вести журнал': 'Start journaling',
  'Оптимизация изображений до загрузки': 'Image optimization before upload',
  'Каналов поиска по сериям и фото': 'Search channels for series and photos',
  'Фокус на визуальном качестве': 'Focus on visual quality',
  'Веб-оптимизация без ручной рутины': 'Web optimization without manual routine',
  'Изображения подготавливаются для быстрой загрузки страниц без ощутимой потери качества.': 'Images are prepared for fast page loads with minimal quality loss.',
  'Поиск, который действительно помогает': 'Search that actually helps',
  'Фильтруйте серии по тегам, датам, авторам и тексту, чтобы быстро собрать нужную подборку.': 'Filter series by tags, dates, authors, and text to quickly build the collection you need.',
  'Серии как законченные истории': 'Series as complete stories',
  'Храните фотографии не поштучно, а в связных сериях с описанием, контекстом и настроением.': 'Keep photos not as isolated files, but as coherent series with description, context, and mood.',
  'Быстрый старт поиска:': 'Quick search start:',
  'Путешествия': 'Travel',
  'Улица': 'Street',
  'Портреты': 'Portraits',
  'Перейти в каталог': 'Open catalog',
  'Старые серии': 'Old series',
  'За 30 дней': 'Last 30 days',
  'За 12 месяцев': 'Last 12 months',
  'Удобный фотоархив серий для веба': 'A convenient web-ready photo series archive',
  'PhotoLog помогает хранить серии фотографий в аккуратной структуре и быстро находить нужное по названию, описанию, тегам, дате и автору.': 'PhotoLog helps you keep photo series in a clean structure and quickly find what you need by title, description, tags, date, and author.',
  'Открыть публичные серии': 'Open public series',
  'Перейти в мой журнал': 'Go to my journal',
  'Войти в журнал': 'Sign in to journal',
  'Автооптимизация перед загрузкой': 'Auto optimization before upload',
  'Параметров фильтрации': 'Filter parameters',
  'Подготовка изображений для веба': 'Image preparation for the web',
  'Оптимизация без лишних действий': 'Optimization without extra steps',
  'Сервис готовит изображения для быстрой загрузки страниц с сохранением качества.': 'The service prepares images for fast page loading while preserving quality.',
  'Понятный поиск по архиву': 'Clear archive search',
  'Используйте теги, даты, автора и текст, чтобы быстро найти нужную серию.': 'Use tags, dates, author, and text to quickly find the needed series.',
  'Серии вместо разрозненных файлов': 'Series instead of scattered files',
  'Фотографии удобно хранить и просматривать как цельные истории с описанием и контекстом.': 'Photos are easier to store and browse as complete stories with description and context.',
  'Быстрые фильтры:': 'Quick filters:',
  'Популярные теги:': 'Popular tags:',
}

const messages = { en }

function normalizeLocale(input) {
  const value = String(input || '').trim().toLowerCase()
  if (SUPPORTED_LOCALES.includes(value)) {
    return value
  }

  return 'ru'
}

const locale = ref(normalizeLocale(localStorage.getItem(LOCALE_KEY) || 'ru'))

export function setLocale(nextLocale, { persist = true } = {}) {
  const normalized = normalizeLocale(nextLocale)
  locale.value = normalized

  if (persist) {
    localStorage.setItem(LOCALE_KEY, normalized)
  }
}

export function syncLocaleFromUser(user) {
  const userLocale = String(user?.locale || '').trim()
  if (!userLocale) {
    return
  }

  setLocale(userLocale)
}

function interpolate(text, params = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_, key) => {
    return params[key] == null ? `{${key}}` : String(params[key])
  })
}

export function t(source, params = {}) {
  const text = String(source || '')
  if (!text) {
    return text
  }

  if (locale.value === 'ru') {
    return interpolate(text, params)
  }

  const translated = messages[locale.value]?.[text] || text
  return interpolate(translated, params)
}

export const currentLocale = computed(() => locale.value)
export const availableLocales = SUPPORTED_LOCALES

export function localeLabel(code) {
  const normalized = normalizeLocale(code)
  if (normalized === 'ru') return 'RU'
  if (normalized === 'en') return 'EN'
  return normalized.toUpperCase()
}
