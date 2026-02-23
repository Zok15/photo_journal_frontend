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
