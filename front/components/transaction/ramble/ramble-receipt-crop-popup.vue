<template>
  <app-popup v-model:show="show" :popup-style="popupStyle">
    <div class="display-flex flex-direction-column h-100 m-h-0">
      <div class="flex-center-vertical gap-2 px-3 py-2 ramble-divider-bottom">
        <div class="flex-1-w">
          <div class="font-600 text-size-16">{{ $t('transaction.assistant_receipt_crop_title') }}</div>
          <div class="text-size-12 text-muted">{{ $t('transaction.assistant_receipt_crop_hint') }}</div>
        </div>
        <van-button size="small" class="cursor-pointer" @click="cancel">
          <app-icon :icon="TablerIconConstants.close" :size="18" />
        </van-button>
      </div>

      <div class="flex-1 m-h-0 flex-center p-3 ramble-crop-stage">
        <div v-if="imageUrl" class="ramble-crop-frame">
          <img ref="imageRef" :src="imageUrl" :alt="$t('transaction.assistant_ramble_receipt')" draggable="false" />
          <div class="ramble-crop-mask">
            <div class="ramble-crop-shade" :style="rectStyle" />
          </div>
          <div class="ramble-crop-rect" :style="rectStyle" @pointerdown="onPointerDown($event, 'move')" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
            <div
              v-for="corner in corners"
              :key="corner"
              class="ramble-crop-handle"
              :class="`ramble-crop-handle-${corner}`"
              @pointerdown.stop="onPointerDown($event, corner)"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
            />
          </div>
        </div>
      </div>

      <div class="display-flex gap-2 p-3 ramble-divider">
        <van-button block class="cursor-pointer" @click="cancel">{{ $t('cancel') }}</van-button>
        <van-button block type="primary" class="cursor-pointer" @click="confirm">{{ $t('transaction.assistant_receipt_use_photo') }}</van-button>
      </div>
    </div>
  </app-popup>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import TablerIconConstants from '~/constants/TablerIconConstants.js'
import { fullCrop, moveCrop, resizeCrop } from '~/utils/CropUtils.js'

const appStore = useAppStore()

const corners = ['nw', 'ne', 'sw', 'se']
const show = ref(false)
const imageUrl = ref(null)
const imageRef = ref(null)
const rect = ref(fullCrop())

// One drag at a time: the frame at pointer-down plus where the pointer started, so each move is an absolute offset
// from the start rather than an accumulation of small deltas.
let drag = null
// The promise waiting for the user's decision; null while the popup is idle.
let pending = null

const popupStyle = computed(() => {
  if (appStore.isDesktopLayout) {
    return { width: 'min(680px, 94vw)', height: '82vh', maxHeight: '82vh', padding: '0' }
  }

  return { height: '90%' }
})

const rectStyle = computed(() => ({
  left: `${rect.value.x * 100}%`,
  top: `${rect.value.y * 100}%`,
  width: `${rect.value.width * 100}%`,
  height: `${rect.value.height * 100}%`,
}))

const revokeImage = () => {
  if (imageUrl.value) {
    URL.revokeObjectURL(imageUrl.value)
    imageUrl.value = null
  }
}

const settle = (value) => {
  const resolve = pending
  pending = null
  resolve?.(value)
}

// Resolves with the chosen crop fractions, or null when the user cancels or closes the popup.
const crop = (file, initialCrop = fullCrop()) => {
  settle(null)
  revokeImage()
  imageUrl.value = URL.createObjectURL(file)
  rect.value = { ...initialCrop }
  drag = null
  show.value = true
  return new Promise((resolve) => {
    pending = resolve
  })
}

const confirm = () => {
  settle({ ...rect.value })
  show.value = false
}

const cancel = () => {
  show.value = false
}

const onPointerDown = (event, mode) => {
  const bounds = imageRef.value?.getBoundingClientRect()
  if (!bounds || bounds.width === 0 || bounds.height === 0) {
    return
  }
  drag = { mode, bounds, startX: event.clientX, startY: event.clientY, startRect: { ...rect.value } }
  event.currentTarget.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

const onPointerMove = (event) => {
  if (!drag) {
    return
  }
  const dx = (event.clientX - drag.startX) / drag.bounds.width
  const dy = (event.clientY - drag.startY) / drag.bounds.height
  rect.value = drag.mode === 'move' ? moveCrop(drag.startRect, dx, dy) : resizeCrop(drag.startRect, drag.mode, dx, dy)
}

const onPointerUp = (event) => {
  if (!drag) {
    return
  }
  event.currentTarget.releasePointerCapture?.(event.pointerId)
  drag = null
}

watch(show, (newValue) => {
  if (!newValue) {
    // Any close that is not a confirm (cancel, overlay tap) is a cancel.
    settle(null)
    revokeImage()
    drag = null
  }
})

onBeforeUnmount(() => {
  settle(null)
  revokeImage()
})

defineExpose({
  crop,
})
</script>
