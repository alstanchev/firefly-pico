<template>
  <van-button v-if="appStore.llmIsConfigured" size="small" class="cursor-pointer ramble-trigger-button" :title="$t('transaction.assistant_ramble_scan_receipt')" @click="openPopup">
    <app-icon :icon="TablerIconConstants.camera" :size="16" />
  </van-button>
  <input ref="inputRef" type="file" accept="image/*" multiple hidden @change="onSelected" />

  <ramble-drafts-popup
    ref="popupRef"
    v-model:show="show"
    :icon="TablerIconConstants.camera"
    :title="$t('transaction.assistant_receipt_title')"
    :subtitle="$t('transaction.assistant_receipt_hint')"
    :empty-hint="$t('transaction.assistant_receipt_empty')"
    :receipts="receipts"
    @created="onCreated"
  >
    <template #default="{ isInterpreting }">
      <ramble-receipt-strip
        v-model="receipts"
        :split-items="splitItems"
        :max-receipts="maxReceipts"
        :is-preparing="isPreparing"
        :is-disabled="isInterpreting"
        @add="inputRef?.click()"
        @scan="onScanAgain"
        @toggle-split="onToggleSplit"
      />
    </template>
  </ramble-drafts-popup>
</template>

<script setup>
import { ref, watch } from 'vue'
import RouteConstants from '~/constants/RouteConstants'
import TablerIconConstants from '~/constants/TablerIconConstants.js'
import RambleDraftsPopup from '~/components/transaction/ramble/ramble-drafts-popup.vue'
import RambleReceiptStrip from '~/components/transaction/ramble/ramble-receipt-strip.vue'
import UIUtils from '~/utils/UIUtils.js'
import { compressImageToJpeg, blobToDataUrl } from '~/utils/ImageUtils.js'
import { getGUID } from '~/utils/Utils.js'

const { t } = useI18n()
const appStore = useAppStore()
const profileStore = useProfileStore()

// Three photos keep the base64 request well under PHP's 8M post limit and the 60 s LLM timeout.
const maxReceipts = 3
const inputRef = ref(null)
const popupRef = ref(null)
const show = ref(false)
const receipts = ref([])
const isPreparing = ref(false)
const splitItems = ref(false)

const openPopup = () => {
  // The setting only seeds the chip; the chip decides per scan.
  splitItems.value = !!profileStore.assistantSplitReceipts
  show.value = true
}

const scan = () => {
  return popupRef.value?.interpret({ receipts: receipts.value, splitReceipts: splitItems.value })
}

// A re-scan replaces the drafts. It is confirmed only when that loses work (a draft edited, removed or created),
// so a receipt spread over several photos can be added one photo at a time without a prompt each time.
const confirmRescan = async () => {
  if (!popupRef.value?.hasEditedDrafts) {
    return true
  }
  return UIUtils.showDeleteConfirmation(t('transaction.assistant_receipt_rescan_title'), t('transaction.assistant_receipt_rescan_message'))
}

const onScanAgain = async () => {
  if (await confirmRescan()) {
    await scan()
  }
}

const onToggleSplit = async () => {
  if (receipts.value.length > 0 && !(await confirmRescan())) {
    return
  }
  splitItems.value = !splitItems.value
  if (receipts.value.length > 0) {
    await scan()
  }
}

const onSelected = async (event) => {
  const selected = Array.from(event.target.files ?? [])
  event.target.value = ''

  const files = selected.slice(0, Math.max(0, maxReceipts - receipts.value.length))
  if (selected.length > files.length) {
    UIUtils.showToastError(t('transaction.assistant_ramble_receipt_limit', { count: maxReceipts }))
  }
  if (files.length === 0) {
    return
  }
  if (!(await confirmRescan())) {
    return
  }

  isPreparing.value = true
  try {
    const prepared = []
    for (const file of files) {
      const blob = await compressImageToJpeg(file)
      const jpeg = new File([blob], `receipt-${Date.now()}-${prepared.length}.jpg`, { type: 'image/jpeg' })
      prepared.push({ id: getGUID(), file: jpeg, dataUrl: await blobToDataUrl(jpeg) })
    }
    receipts.value = [...receipts.value, ...prepared]
  } catch {
    UIUtils.showToastError(t('transaction.assistant_ramble_receipt_failed'))
    return
  } finally {
    isPreparing.value = false
  }

  // Photos are interpreted as soon as they are picked.
  await scan()
}

const onCreated = async () => {
  show.value = false
  await navigateTo(RouteConstants.ROUTE_TRANSACTION_LIST)
}

watch(show, (newValue) => {
  if (!newValue) {
    receipts.value = []
  }
})
</script>
