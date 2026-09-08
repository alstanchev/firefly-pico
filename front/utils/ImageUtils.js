// Receipt photos come straight from the phone camera at several MB each.
// The backend runs PHP defaults (8M post limit) and the LLM proxy times out at 60 s,
// so photos are downscaled and re-encoded here before they are sent anywhere.

const loadBitmap = async (file) => {
  if (typeof createImageBitmap === 'function') {
    // from-image applies the EXIF rotation so portrait receipts are not sent sideways.
    return createImageBitmap(file, { imageOrientation: 'from-image' })
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

export const compressImageToJpeg = async (file, { maxSide = 1600, quality = 0.8 } = {}) => {
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
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
