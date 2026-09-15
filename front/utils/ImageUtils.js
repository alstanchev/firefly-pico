import { cropToPixels } from '~/utils/CropUtils.js'

// Receipt photos come straight from the phone camera at several MB each.
// The backend runs PHP defaults (8M post limit) and the LLM proxy times out at 60 s,
// so photos are downscaled and re-encoded here before they are sent anywhere.

const loadBitmap = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      // from-image applies the EXIF rotation so portrait receipts are not sent sideways.
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Fall through to the <img> decoder: HEIC and some JPEG variants reject here.
    }
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Image could not be decoded'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

// crop is a fraction rectangle from CropUtils. It is cut from the full photo before downscaling, so a receipt that
// fills only part of the frame keeps its print legible instead of being shrunk along with the background.
export const compressImageToJpeg = async (file, { maxSide = 1600, quality = 0.8, crop = null } = {}) => {
  const bitmap = await loadBitmap(file)
  const region = crop ? cropToPixels(crop, bitmap.width, bitmap.height) : { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
  const scale = Math.min(1, maxSide / Math.max(region.width, region.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(region.width * scale)
  canvas.height = Math.round(region.height * scale)
  canvas.getContext('2d').drawImage(bitmap, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) {
    throw new Error('Image could not be encoded')
  }

  return blob
}

export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
