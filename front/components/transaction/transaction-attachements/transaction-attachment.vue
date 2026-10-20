<template>
  <div class="flex-center flex-column p-2 transaction-attachment" v-bind="tapBinding">
    <icon-photo :size="30" :stroke="1.4" />
    <div class="text-size-12">{{ displayName }}</div>
  </div>

  <app-popup v-if="appStore.isDesktopLayout" v-model:show="isViewerVisible" closeable :popup-style="{ width: '94vw', height: '92vh', maxHeight: '92vh', padding: 0 }" @closed="onViewerClosed">
    <div class="attachment-viewer">
      <img :src="viewerUrl" :alt="displayName" :class="{ zoomed: isZoomed }" @click="isZoomed = !isZoomed" />
    </div>
  </app-popup>
</template>

<script setup>
import { IconPhoto } from '@tabler/icons-vue'

import { get } from 'lodash-es'
import { trimString } from '~/utils/StringUtils.js'
import { downloadFileFromUrl, getAttachmentObjectUrl, showImageFromUrl } from '~/utils/AttachmentUtils.js'
import { useTap, useTapEvent } from '~/composables/useTap.js'
import { useActionSheet } from '~/composables/useActionSheet.js'
import AttachmentRepository from '~/repository/AttachmentRepository.js'

const props = defineProps({
  value: {
    type: Object,
    default: () => ({}),
  },
  readOnly: {
    type: Boolean,
    default: false,
  },
})

const emits = defineEmits(['result', 'isLoading'])

const displayName = computed(() => trimString(title.value ?? filename.value).toLowerCase())
const title = computed(() => get(props.value, 'attributes.title'))
const filename = computed(() => get(props.value, 'attributes.filename'))
const downloadUrl = computed(() => get(props.value, 'attributes.download_url'))
const isImage = computed(() => (get(props.value, 'attributes.mime') ?? '').startsWith('image/'))

const { t } = useI18n()
const appStore = useAppStore()

// Vant's image preview is touch only (no zoom or pan with a mouse) and shows a tall receipt at full viewport width,
// so on desktop the photo opens in a popup instead: fitted to the window, a click toggles full size and scrolling.
const viewerUrl = ref(null)
const isViewerVisible = ref(false)
const isZoomed = ref(false)

const showImage = async () => {
  if (!appStore.isDesktopLayout) {
    await showImageFromUrl(downloadUrl.value)
    return
  }
  viewerUrl.value = await getAttachmentObjectUrl(downloadUrl.value)
  isViewerVisible.value = !!viewerUrl.value
}

const onViewerClosed = () => {
  URL.revokeObjectURL(viewerUrl.value)
  viewerUrl.value = null
  isZoomed.value = false
}

const tapBinding = useTap(async (event) => {
  switch (event) {
    case useTapEvent.single:
      emits('isLoading', true)
      try {
        if (isImage.value) {
          await showImage()
        } else {
          await downloadFileFromUrl(downloadUrl.value, filename.value)
        }
      } catch {
        // Existing attachment downloads fail silently; always clear the loading state below.
      }
      emits('isLoading', false)
      break
    case useTapEvent.double:
    case useTapEvent.long:
      if (props.readOnly) {
        return
      }
      useActionSheet().show([
        {
          name: t('delete'),
          callback: async () => {
            await new AttachmentRepository().delete(props.value?.id)
            emits('result')
          },
        },
      ])
      break
  }
})
</script>
