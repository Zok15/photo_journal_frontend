const TAG_LABELS = {
  travel: { ru: 'Путешествия', en: 'Travel' },
  street: { ru: 'Улица', en: 'Street' },
  portrait: { ru: 'Портрет', en: 'Portrait' },
  nature: { ru: 'Природа', en: 'Nature' },
  landscape: { ru: 'Пейзаж', en: 'Landscape' },
  city: { ru: 'Город', en: 'City' },
  bird: { ru: 'Птицы', en: 'Birds' },
  flower: { ru: 'Цветы', en: 'Flowers' },
  animal: { ru: 'Животные', en: 'Animals' },
  food: { ru: 'Еда', en: 'Food' },
  people: { ru: 'Люди', en: 'People' },
  architecture: { ru: 'Архитектура', en: 'Architecture' },
}

export function normalizeTagValue(value) {
  return String(value || '').trim().toLowerCase()
}

export function formatLocalizedTagLabel(rawTag, locale) {
  const source = String(rawTag || '').trim()
  const normalized = normalizeTagValue(source)
  const normalizedLocale = locale === 'en' ? 'en' : 'ru'
  const mapped = TAG_LABELS[normalized]?.[normalizedLocale]
  if (mapped) {
    return mapped
  }

  const prepared = source.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!prepared) {
    return source
  }

  return prepared
    .split(' ')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}
