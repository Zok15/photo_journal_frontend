export function resolveImageAspectRatio(src) {
  const imageSrc = String(src || '').trim()
  if (!imageSrc) {
    return Promise.resolve(1)
  }

  return new Promise((resolve) => {
    const image = new Image()

    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        resolve(1)
        return
      }

      resolve(image.naturalWidth / image.naturalHeight)
    }

    image.onerror = () => resolve(1)
    image.src = imageSrc
  })
}

export async function resolveMissingAspectRatios(
  items,
  currentRatios = {},
  resolveSrc = (item) => item?.src,
) {
  const source = Array.isArray(items) ? items : []
  const pending = source.filter((item) => {
    const id = Number(item?.id || 0)
    const src = String(resolveSrc(item) || '').trim()
    if (!id || !src) {
      return false
    }

    return !Number.isFinite(Number(currentRatios?.[id])) || Number(currentRatios?.[id]) <= 0
  })

  if (!pending.length) {
    return {}
  }

  const entries = await Promise.all(
    pending.map(async (item) => {
      const id = Number(item?.id || 0)
      const src = String(resolveSrc(item) || '').trim()
      const ratio = await resolveImageAspectRatio(src)
      return [id, Number.isFinite(ratio) && ratio > 0 ? ratio : 1]
    }),
  )

  return Object.fromEntries(entries)
}
