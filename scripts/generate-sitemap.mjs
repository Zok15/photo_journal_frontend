import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)))
const ROOT = resolve(SCRIPT_DIR, '..')
const outputPath = resolve(ROOT, 'public/sitemap.xml')
const fallbackOrigin = 'https://photolog.org'
const configuredOrigin = String(process.env.VITE_SITE_URL || '').trim().replace(/\/+$/, '')
const rawOrigin = configuredOrigin || fallbackOrigin
const configuredApiBase = String(process.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
const apiBaseUrl = configuredApiBase || `${rawOrigin}/api/v1`
const requestTimeoutMs = Number(process.env.SITEMAP_API_TIMEOUT_MS || 8000)

if (!configuredOrigin) {
  console.warn(`[sitemap] VITE_SITE_URL is not set, fallback is used: ${fallbackOrigin}`)
}

if (!configuredApiBase) {
  console.warn(`[sitemap] VITE_API_BASE_URL is not set, fallback is used: ${apiBaseUrl}`)
}

const now = new Date().toISOString()
const urls = new Map()

function toIsoDate(value) {
  const parsed = new Date(String(value || '').trim())
  if (Number.isNaN(parsed.getTime())) {
    return now
  }

  return parsed.toISOString()
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function addUrl(path, options = {}) {
  const normalizedPath = String(path || '').trim()
  if (!normalizedPath.startsWith('/')) {
    return
  }

  const previous = urls.get(normalizedPath)
  const next = {
    path: normalizedPath,
    lastmod: toIsoDate(options.lastmod || now),
    changefreq: String(options.changefreq || 'daily'),
    priority: String(options.priority || '0.5'),
  }

  if (!previous) {
    urls.set(normalizedPath, next)
    return
  }

  urls.set(normalizedPath, {
    ...previous,
    ...next,
    lastmod: next.lastmod > previous.lastmod ? next.lastmod : previous.lastmod,
  })
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs)

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function resolveSeriesPath(series) {
  const slug = String(series?.slug || '').trim()
  if (slug) {
    return `/series/${encodeURIComponent(slug)}`
  }

  const id = Number(series?.id || 0)
  if (id > 0) {
    return `/series/${id}`
  }

  return ''
}

async function appendPublicSeriesUrls() {
  const perPage = 100
  let page = 1
  let lastPage = 1

  while (page <= lastPage) {
    const requestUrl = `${apiBaseUrl}/public/series?per_page=${perPage}&page=${page}&sort=new`
    const payload = await fetchJson(requestUrl)
    const items = Array.isArray(payload?.data) ? payload.data : []

    items.forEach((series) => {
      const path = resolveSeriesPath(series)
      if (!path) {
        return
      }

      addUrl(path, {
        lastmod: series?.updated_at || series?.created_at || now,
        changefreq: 'weekly',
        priority: '0.7',
      })
    })

    const fromPayload = Number(payload?.last_page || 0)
    lastPage = Number.isFinite(fromPayload) && fromPayload > 0 ? fromPayload : page
    page += 1
  }
}

addUrl('/', { changefreq: 'daily', priority: '1.0' })
addUrl('/public/series', { changefreq: 'daily', priority: '0.8' })
addUrl('/privacy-policy', { changefreq: 'monthly', priority: '0.4' })

try {
  await appendPublicSeriesUrls()
} catch (error) {
  console.warn(`[sitemap] public series sync failed: ${error instanceof Error ? error.message : String(error)}`)
}

const body = Array.from(urls.values())
  .sort((a, b) => a.path.localeCompare(b.path))
  .map((entry) => {
    const absoluteUrl = `${rawOrigin}${entry.path}`

    return [
      '  <url>',
      `    <loc>${escapeXml(absoluteUrl)}</loc>`,
      `    <lastmod>${entry.lastmod}</lastmod>`,
      `    <changefreq>${entry.changefreq}</changefreq>`,
      `    <priority>${entry.priority}</priority>`,
      '  </url>',
    ].join('\n')
  })
  .join('\n')

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  body,
  '</urlset>',
  '',
].join('\n')

writeFileSync(outputPath, xml, 'utf8')
console.log(`[sitemap] generated: ${outputPath}`)
