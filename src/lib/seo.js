const SITE_NAME = 'PhotoLog'

const DEFAULT_DESCRIPTION = {
  ru: 'PhotoLog - веб-архив серий фотографий с быстрым поиском по названию, описанию, тегам, дате и автору.',
  en: 'PhotoLog is a web photo-series archive with fast search by title, description, tags, date, and author.',
}

function normalizeSiteOrigin(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '')
  if (!normalized) {
    return ''
  }

  return normalized
}

function getSiteOrigin() {
  const configured = normalizeSiteOrigin(import.meta.env.VITE_SITE_URL)
  if (configured) {
    return configured
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return normalizeSiteOrigin(window.location.origin)
  }

  return ''
}

function ensureMetaByName(name) {
  let node = document.head.querySelector(`meta[name="${name}"]`)
  if (!node) {
    node = document.createElement('meta')
    node.setAttribute('name', name)
    document.head.appendChild(node)
  }

  return node
}

function ensureMetaByProperty(property) {
  let node = document.head.querySelector(`meta[property="${property}"]`)
  if (!node) {
    node = document.createElement('meta')
    node.setAttribute('property', property)
    document.head.appendChild(node)
  }

  return node
}

function ensureCanonicalLink() {
  let node = document.head.querySelector('link[rel="canonical"]')
  if (!node) {
    node = document.createElement('link')
    node.setAttribute('rel', 'canonical')
    document.head.appendChild(node)
  }

  return node
}

function normalizeLocaleForOg(locale) {
  return locale === 'en' ? 'en_US' : 'ru_RU'
}

function resolveDescription(seoDescription, locale) {
  const value = String(seoDescription || '').trim()
  if (value) {
    return value
  }

  return DEFAULT_DESCRIPTION[locale] || DEFAULT_DESCRIPTION.ru
}

export function applySeoForRoute(route, { locale = 'ru', t } = {}) {
  const routeMeta = route?.meta || {}
  const seoMeta = routeMeta?.seo || {}

  const pageTitleSource = String(seoMeta.title || '').trim() || SITE_NAME
  const pageTitle = t ? t(pageTitleSource) : pageTitleSource
  const fullTitle = pageTitle === SITE_NAME ? SITE_NAME : `${pageTitle} | ${SITE_NAME}`

  const descriptionSource = String(seoMeta.description || '').trim()
  const description = resolveDescription(t ? t(descriptionSource) : descriptionSource, locale)

  const shouldIndex = seoMeta.index !== false
  const robots = shouldIndex ? 'index,follow' : 'noindex,nofollow'
  const path = String(route?.path || '/').trim() || '/'
  const origin = getSiteOrigin()
  const canonical = origin ? `${origin}${path}` : path
  const ogLocale = normalizeLocaleForOg(locale)
  const ogImage = origin ? `${origin}/logo.png` : '/logo.png'

  document.title = fullTitle
  document.documentElement.setAttribute('lang', locale)

  ensureMetaByName('description').setAttribute('content', description)
  ensureMetaByName('robots').setAttribute('content', robots)

  ensureMetaByProperty('og:type').setAttribute('content', 'website')
  ensureMetaByProperty('og:site_name').setAttribute('content', SITE_NAME)
  ensureMetaByProperty('og:title').setAttribute('content', fullTitle)
  ensureMetaByProperty('og:description').setAttribute('content', description)
  ensureMetaByProperty('og:url').setAttribute('content', canonical)
  ensureMetaByProperty('og:locale').setAttribute('content', ogLocale)
  ensureMetaByProperty('og:image').setAttribute('content', ogImage)

  ensureMetaByName('twitter:card').setAttribute('content', 'summary_large_image')
  ensureMetaByName('twitter:title').setAttribute('content', fullTitle)
  ensureMetaByName('twitter:description').setAttribute('content', description)
  ensureMetaByName('twitter:image').setAttribute('content', ogImage)

  ensureCanonicalLink().setAttribute('href', canonical)
}
