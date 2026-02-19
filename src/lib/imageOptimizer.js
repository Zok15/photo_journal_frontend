const TARGET_MIME = 'image/jpeg'

function replaceExtension(fileName, extension) {
  const idx = fileName.lastIndexOf('.')
  if (idx === -1) {
    return `${fileName}.${extension}`
  }

  return `${fileName.slice(0, idx)}.${extension}`
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to decode image'))
    }

    image.src = objectUrl
  })
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode image'))
        return
      }

      resolve(blob)
    }, mime, quality)
  })
}

async function compressCanvas(canvas, maxBytes, initialQuality, minQuality) {
  let quality = initialQuality
  let blob = await canvasToBlob(canvas, TARGET_MIME, quality)

  while (blob.size > maxBytes && quality > minQuality) {
    quality = Math.max(minQuality, quality - 0.08)
    blob = await canvasToBlob(canvas, TARGET_MIME, quality)
  }

  return blob
}

/**
 * @param {File[]} files
 * @param {{ maxBytes?: number, maxDimension?: number, minDimension?: number }} options
 * @returns {Promise<{ files: File[], warnings: Array<{ original_name: string, message: string }> }>} 
 */
export async function optimizeImagesForUpload(files, options = {}) {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024
  const maxDimension = options.maxDimension ?? 2560
  const minDimension = options.minDimension ?? 900
  const fallbackToOriginal = options.fallbackToOriginal ?? true
  const warnings = []
  const optimized = []

  for (const file of files) {
    try {
      const image = await readImage(file)

      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
      let width = Math.max(1, Math.round(image.naturalWidth * scale))
      let height = Math.max(1, Math.round(image.naturalHeight * scale))

      let canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        throw new Error('Canvas context is not available')
      }

      ctx.drawImage(image, 0, 0, width, height)

      let blob = await compressCanvas(canvas, maxBytes, 0.9, 0.45)

      while (blob.size > maxBytes && Math.max(width, height) > minDimension) {
        width = Math.max(minDimension, Math.round(width * 0.85))
        height = Math.max(minDimension, Math.round(height * 0.85))

        const downscaled = document.createElement('canvas')
        downscaled.width = width
        downscaled.height = height

        const downscaledCtx = downscaled.getContext('2d')
        if (!downscaledCtx) {
          throw new Error('Canvas context is not available')
        }

        downscaledCtx.drawImage(canvas, 0, 0, width, height)
        canvas = downscaled

        blob = await compressCanvas(canvas, maxBytes, 0.86, 0.45)
      }

      if (blob.size > maxBytes) {
        if (fallbackToOriginal) {
          warnings.push({
            original_name: file.name,
            message: 'Optimization limit reached. Original file kept.',
          })
          optimized.push(file)
          continue
        }

        warnings.push({
          original_name: file.name,
          message: 'Could not optimize enough. File skipped.',
        })
        continue
      }

      const nextFile = new File([blob], replaceExtension(file.name, 'jpg'), {
        type: TARGET_MIME,
        lastModified: Date.now(),
      })

      optimized.push(nextFile)
    } catch (_) {
      if (fallbackToOriginal) {
        warnings.push({
          original_name: file.name,
          message: 'Image optimization failed. Original file kept.',
        })
        optimized.push(file)
      } else {
        warnings.push({
          original_name: file.name,
          message: 'Image optimization failed. File skipped.',
        })
      }
    }
  }

  return {
    files: optimized,
    warnings,
  }
}
