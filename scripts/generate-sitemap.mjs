import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const outputPath = resolve(ROOT, 'public/sitemap.xml')
const rawOrigin = String(process.env.VITE_SITE_URL || '').trim().replace(/\/+$/, '')

if (!rawOrigin) {
  if (existsSync(outputPath)) {
    rmSync(outputPath)
  }

  console.warn('[sitemap] VITE_SITE_URL is not set, sitemap.xml is skipped')
  process.exit(0)
}

const now = new Date().toISOString()
const urls = ['/', '/public/series']

const body = urls
  .map((path) => {
    return [
      '  <url>',
      `    <loc>${rawOrigin}${path}</loc>`,
      `    <lastmod>${now}</lastmod>`,
      '    <changefreq>daily</changefreq>',
      path === '/' ? '    <priority>1.0</priority>' : '    <priority>0.8</priority>',
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
