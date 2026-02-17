export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_RAW_IMAGE_SIZE_BYTES = 25 * 1024 * 1024

export function findInvalidUploadFile(files) {
  return files.find((file) => {
    return file.size > MAX_RAW_IMAGE_SIZE_BYTES || !ALLOWED_IMAGE_TYPES.includes(file.type)
  }) || null
}
