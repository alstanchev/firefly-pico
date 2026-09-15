import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cropToPixels, fullCrop, isSameCrop, moveCrop, resizeCrop } from '../utils/CropUtils.js'

const rect = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 }

test('fullCrop covers the whole image', () => {
  assert.deepEqual(fullCrop(), { x: 0, y: 0, width: 1, height: 1 })
})

test('moveCrop translates the frame and keeps its size', () => {
  assert.deepEqual(moveCrop(rect, 0.2, 0.1), { x: 0.3, y: 0.3, width: 0.5, height: 0.4 })
})

test('moveCrop keeps the frame inside the image', () => {
  assert.deepEqual(moveCrop(rect, -0.5, -0.5), { x: 0, y: 0, width: 0.5, height: 0.4 })
  assert.deepEqual(moveCrop(rect, 0.9, 0.9), { x: 0.5, y: 0.6, width: 0.5, height: 0.4 })
})

test('resizeCrop moves one corner and keeps the opposite corner fixed', () => {
  assert.deepEqual(resizeCrop(rect, 'se', 0.1, 0.1), { x: 0.1, y: 0.2, width: 0.6, height: 0.5 })
  assert.deepEqual(resizeCrop(rect, 'nw', 0.1, 0.1), { x: 0.2, y: 0.3, width: 0.4, height: 0.3 })
  assert.deepEqual(resizeCrop(rect, 'ne', 0.1, 0.1), { x: 0.1, y: 0.3, width: 0.6, height: 0.3 })
  assert.deepEqual(resizeCrop(rect, 'sw', 0.1, 0.1), { x: 0.2, y: 0.2, width: 0.4, height: 0.5 })
})

test('resizeCrop stops at the image edges', () => {
  assert.deepEqual(resizeCrop(rect, 'se', 1, 1), { x: 0.1, y: 0.2, width: 0.9, height: 0.8 })
  assert.deepEqual(resizeCrop(rect, 'nw', -1, -1), { x: 0, y: 0, width: 0.6, height: 0.6 })
})

test('resizeCrop never shrinks the frame below the minimum size', () => {
  // Dragging the south-east corner past the north-west one keeps a 5% frame anchored at the fixed corner.
  assert.deepEqual(resizeCrop(rect, 'se', -1, -1), { x: 0.1, y: 0.2, width: 0.05, height: 0.05 })
  // Dragging the north-west corner past the south-east one keeps the south-east corner where it was.
  assert.deepEqual(resizeCrop(rect, 'nw', 1, 1), { x: 0.55, y: 0.55, width: 0.05, height: 0.05 })
  assert.deepEqual(resizeCrop(rect, 'se', -1, -1, 0.2), { x: 0.1, y: 0.2, width: 0.2, height: 0.2 })
})

test('cropToPixels maps fractions to a whole-pixel region inside the image', () => {
  assert.deepEqual(cropToPixels(fullCrop(), 4032, 3024), { x: 0, y: 0, width: 4032, height: 3024 })
  assert.deepEqual(cropToPixels({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, 400, 200), { x: 100, y: 100, width: 200, height: 50 })
  // Rounding must not push the region past the right or bottom edge.
  assert.deepEqual(cropToPixels({ x: 0.999, y: 0.999, width: 0.001, height: 0.001 }, 100, 100), { x: 99, y: 99, width: 1, height: 1 })
})

test('isSameCrop ignores floating point noise', () => {
  assert.equal(isSameCrop(rect, { ...rect, x: 0.1 + 1e-9 }), true)
  assert.equal(isSameCrop(rect, { ...rect, x: 0.11 }), false)
  assert.equal(isSameCrop(rect, null), false)
})
