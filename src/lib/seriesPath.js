export function seriesSlugOrId(series) {
  const slug = String(series?.slug || '').trim()
  if (slug) {
    return slug
  }

  const id = Number(series?.id || 0)
  return id > 0 ? String(id) : ''
}

export function seriesPath(series) {
  const value = seriesSlugOrId(series)
  return value ? `/series/${value}` : '/series'
}
