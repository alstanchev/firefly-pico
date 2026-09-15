// Pure crop-frame math. A crop is { x, y, width, height } as fractions of the image (0..1), so it survives the
// preview being resized and maps to any pixel size. No store or Nuxt alias imports so it runs under `node --test`.

export const defaultMinCropSize = 0.05

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

// Six decimals is well under a pixel on any phone photo and keeps drag arithmetic from accumulating float noise.
const round = (value) => Math.round(value * 1e6) / 1e6

const normalize = ({ x, y, width, height }) => ({ x: round(x), y: round(y), width: round(width), height: round(height) })

export const fullCrop = () => ({ x: 0, y: 0, width: 1, height: 1 })

export const moveCrop = (rect, dx, dy) => {
  return normalize({
    x: clamp(rect.x + dx, 0, 1 - rect.width),
    y: clamp(rect.y + dy, 0, 1 - rect.height),
    width: rect.width,
    height: rect.height,
  })
}

// corner is 'nw', 'ne', 'sw' or 'se'. The opposite corner stays where it is; the dragged edges stop at the image
// edges and at minSize away from the fixed corner, so the frame can never flip or vanish.
export const resizeCrop = (rect, corner, dx, dy, minSize = defaultMinCropSize) => {
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.width
  let bottom = rect.y + rect.height

  if (corner.includes('w')) {
    left = clamp(left + dx, 0, right - minSize)
  }
  if (corner.includes('e')) {
    right = clamp(right + dx, left + minSize, 1)
  }
  if (corner.includes('n')) {
    top = clamp(top + dy, 0, bottom - minSize)
  }
  if (corner.includes('s')) {
    bottom = clamp(bottom + dy, top + minSize, 1)
  }

  return normalize({ x: left, y: top, width: right - left, height: bottom - top })
}

export const cropToPixels = (rect, imageWidth, imageHeight) => {
  const x = clamp(Math.round(rect.x * imageWidth), 0, imageWidth - 1)
  const y = clamp(Math.round(rect.y * imageHeight), 0, imageHeight - 1)
  const width = clamp(Math.round(rect.width * imageWidth), 1, imageWidth - x)
  const height = clamp(Math.round(rect.height * imageHeight), 1, imageHeight - y)
  return { x, y, width, height }
}

export const isSameCrop = (a, b) => {
  return !!a && !!b && ['x', 'y', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) < 1e-6)
}
