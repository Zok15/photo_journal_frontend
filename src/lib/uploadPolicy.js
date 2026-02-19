export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_RAW_IMAGE_SIZE_BYTES = 100 * 1024 * 1024
export const MAX_UPLOAD_FILES = 100
export const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

function hasAllowedExtension(fileName) {
  const value = String(fileName || '').trim().toLowerCase()
  if (!value || !value.includes('.')) {
    return false
  }

  const extension = value.split('.').pop()
  return ALLOWED_IMAGE_EXTENSIONS.includes(extension)
}

function hasAllowedType(file) {
  const type = String(file?.type || '').trim().toLowerCase()
  if (!type) {
    // Some browsers/filesystems can provide an empty MIME type for local files.
    // In this case we fallback to extension-based validation.
    return hasAllowedExtension(file?.name)
  }

  if (ALLOWED_IMAGE_TYPES.includes(type) || type === 'image/jpg') {
    return true
  }

  return hasAllowedExtension(file?.name)
}

export function findInvalidUploadIssue(files) {
  if (files.length > MAX_UPLOAD_FILES) {
    return { reason: 'count', maxFiles: MAX_UPLOAD_FILES }
  }

  for (const file of files) {
    if (Number(file?.size || 0) > MAX_RAW_IMAGE_SIZE_BYTES) {
      return { file, reason: 'size' }
    }

    if (!hasAllowedType(file)) {
      return { file, reason: 'type' }
    }
  }

  return null
}

export function findInvalidUploadFile(files) {
  return findInvalidUploadIssue(files)?.file || null
}

export function buildUploadValidationMessage(issue) {
  if (issue?.reason === 'count') {
    return `Too many files selected. Max ${issue.maxFiles} files per upload.`
  }

  if (!issue?.file) {
    return 'Invalid file.'
  }

  if (issue.reason === 'size') {
    return `File "${issue.file.name}" is too large. Max size is 100MB.`
  }

  return `File "${issue.file.name}" has unsupported format. Use JPG/PNG/WEBP.`
}
