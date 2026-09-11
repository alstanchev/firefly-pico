<template>
  <van-badge v-if="appStore.llmIsConfigured" :content="savedRamblesCount" :show-zero="false" max="99" class="ramble-modern-badge">
    <van-button size="small" class="cursor-pointer ramble-trigger-button" @click="openRamblePopup">
      <app-icon :icon="TablerIconConstants.ramble" :size="16" />
    </van-button>
  </van-badge>

  <van-button
    v-if="appStore.llmIsConfigured"
    size="small"
    class="cursor-pointer ramble-trigger-button"
    :loading="isPreparingReceipts"
    :title="$t('transaction.assistant_ramble_scan_receipt')"
    @click="receiptInputRef?.click()"
  >
    <app-icon :icon="TablerIconConstants.camera" :size="16" />
  </van-button>
  <input ref="receiptInputRef" type="file" accept="image/*" multiple hidden @change="onReceiptsSelected" />

  <app-popup v-model:show="showRamblePopup" :popup-style="ramblePopupStyle">
    <div ref="popupRef" class="display-flex flex-direction-column h-100 m-h-0 position-relative" :aria-busy="isInterpreting">
      <div class="display-flex flex-direction-column h-100 m-h-0" :class="{ 'pointer-events-none': isRambleFormDisabled }" :inert="isRambleFormDisabled">
        <div class="ramble-header flex-center-vertical gap-2">
          <div class="ramble-header-icon flex-center">
            <app-icon :icon="TablerIconConstants.ramble" :size="22" :stroke="1.6" />
          </div>
          <div class="flex-1-w">
            <div class="font-700 text-size-16 line-height-normal">{{ $t('transaction.assistant_ramble_title') }}</div>
            <div class="text-size-12 text-muted mt-1">
              {{ savedRamblesCount > 0 ? $t('transaction.assistant_ramble_saved_count', { count: savedRamblesCount }) : $t('transaction.assistant_ramble_input_hint') }}
            </div>
          </div>
          <van-button round size="small" class="cursor-pointer ramble-icon-button" @click="closeRamblePopup">
            <app-icon :icon="TablerIconConstants.close" :size="18" />
          </van-button>
        </div>

        <div ref="popupContentRef" class="flex-1 m-h-0 overflow-auto display-flex flex-direction-column gap-3 p-3 ramble-body">
          <ramble-input-card
            ref="inputCardRef"
            v-model="rambleText"
            v-model:receipts="rambleReceipts"
            :saved-rambles="savedRambles"
            :saved-rambles-count="savedRamblesCount"
            :is-loading-saved="isLoadingSavedRambles"
            :is-deleting-saved="isDeletingLoadedSavedRambles"
            :is-interpreting="isInterpreting"
            :is-disabled="isRambleFormDisabled"
            :is-preparing-receipts="isPreparingReceipts"
            :max-receipts="maxReceipts"
            @interpret="interpretRambleText"
            @add-receipt="receiptInputRef?.click()"
            @load-saved="fetchSavedRambles"
            @delete-saved="deleteLoadedSavedRambles"
            @delete-ramble="deleteSavedRamble"
          />

          <div v-if="rambleError" class="ramble-error text-size-12">{{ rambleError }}</div>

          <template v-if="rambleTransactions.length > 0">
            <div class="flex-center-vertical gap-2 px-1">
              <div class="ramble-section-label">{{ $t('transaction.assistant_ramble_preview') }}</div>
              <div class="ramble-count-pill">{{ rambleTransactions.length }}</div>
            </div>
            <van-cell-group inset class="no-margin overflow-hidden">
              <ramble-transaction-item
                v-for="(transaction, index) in rambleTransactions"
                :key="transaction.id"
                v-model="rambleTransactions[index]"
                @delete="removeRambleTransaction"
                @edit="openRambleTransaction"
              />
            </van-cell-group>
          </template>

          <div v-else class="ramble-empty flex-1 flex-center flex-direction-column gap-2 text-center">
            <div class="ramble-empty-icon flex-center">
              <app-icon :icon="TablerIconConstants.ramble" :size="26" :stroke="1.4" />
            </div>
            <div class="text-size-13 text-muted">
              {{ hasInterpreted ? $t('transaction.assistant_ramble_no_results') : $t('transaction.assistant_ramble_no_transactions_yet') }}
            </div>
          </div>
        </div>

        <div v-if="hasCreateProgress || rambleTransactions.length > 0" class="p-3 ramble-footer">
          <div v-if="hasCreateProgress" class="mb-3">
            <div class="flex-center-vertical gap-2 text-size-12 text-muted mb-2">
              <van-loading v-if="isCreatingRambleTransactions" size="16" />
              <div>{{ createProgressLabel }}</div>
            </div>
            <van-progress :percentage="createProgressPercentage" />
          </div>

          <van-button block round type="primary" class="cursor-pointer" :loading="isCreatingRambleTransactions" :disabled="createButtonCount === 0" @click="createRambleTransactions">
            {{ createButtonLabel }}
          </van-button>
        </div>
      </div>
    </div>
  </app-popup>

  <ramble-transaction-edit-popup v-model:show="showRambleTransactionPopup" v-model="editingRambleTransaction" @save="onRambleTransactionEdited" />
</template>

<script setup>
import { cloneDeep } from 'lodash-es'
import { computed, onMounted, ref, watch } from 'vue'
import RouteConstants from '~/constants/RouteConstants'
import TablerIconConstants from '~/constants/TablerIconConstants.js'
import AssistantRepository from '~/repository/AssistantRepository.js'
import RambleInputCard from '~/components/transaction/ramble/ramble-input-card.vue'
import RambleTransactionItem from '~/components/transaction/ramble/ramble-transaction-item.vue'
import RambleTransactionEditPopup from '~/components/transaction/ramble/ramble-transaction-edit-popup.vue'
import { useRambleDrafts, draftStatus } from '~/composables/useRambleDrafts.js'
import { useSwipeToDismiss } from '~/composables/useSwipeToDismiss'
import UIUtils from '~/utils/UIUtils.js'
import { compressImageToJpeg, blobToDataUrl } from '~/utils/ImageUtils.js'
import { getGUID } from '~/utils/Utils.js'

const props = defineProps({
  assistantText: {
    type: String,
    default: '',
  },
})

const { t } = useI18n()
const appStore = useAppStore()
const assistantRepository = new AssistantRepository()
const {
  drafts: rambleTransactions,
  isInterpreting,
  isCreating: isCreatingRambleTransactions,
  hasInterpreted,
  error: rambleError,
  hasCreateProgress,
  createProgressPercentage,
  createProgressLabel,
  createButtonLabel,
  createButtonCount,
  interpret,
  create,
  removeDraft: removeRambleTransaction,
  applyEditedDraft,
  reset: resetDrafts,
} = useRambleDrafts()

const showRamblePopup = ref(false)
const showRambleTransactionPopup = ref(false)
const rambleText = ref('')
const rambleReceipts = ref([])
const savedRambles = ref([])
const loadedSavedRambleIds = ref([])
const savedRamblesCount = ref(0)
const isLoadingSavedRambles = ref(false)
const isDeletingLoadedSavedRambles = ref(false)
const editingRambleTransaction = ref(null)
const inputCardRef = ref(null)
const popupRef = ref(null)
const popupContentRef = ref(null)
const rambleSessionId = ref(0)

useSwipeToDismiss({
  onSwipe: () => closeRamblePopup(),
  swipeRef: popupRef,
  scrollRef: popupContentRef,
  showDropdown: showRamblePopup,
})

const ramblePopupStyle = computed(() => {
  if (appStore.isDesktopLayout) {
    // Full-bleed content: the header / footer dividers should reach the popup edges.
    return { width: 'min(680px, 94vw)', height: '82vh', maxHeight: '82vh', padding: '0' }
  }

  return { height: '90%' }
})

const hasLoadedSavedRambles = computed(() => loadedSavedRambleIds.value.length > 0)
const isRambleFormDisabled = computed(() => isInterpreting.value)

const isResponseSuccessful = (response) => {
  return response?.status >= 200 && response?.status < 300
}

const refreshSavedRambleCount = async ({ showLoading = false } = {}) => {
  if (!appStore.llmIsConfigured) {
    return
  }
  const response = await assistantRepository.getSavedRambleCount({ showLoading })
  savedRamblesCount.value = response.count ?? savedRambles.value.length
}

const fetchSavedRambles = async () => {
  const sessionId = rambleSessionId.value
  isLoadingSavedRambles.value = true

  try {
    const response = await assistantRepository.getSavedRambles()
    if (sessionId !== rambleSessionId.value) {
      return
    }

    savedRambles.value = response.data ?? []
    loadedSavedRambleIds.value = savedRambles.value.map((ramble) => ramble.id).filter(Boolean)
    savedRamblesCount.value = savedRambles.value.length
  } finally {
    if (sessionId === rambleSessionId.value) {
      isLoadingSavedRambles.value = false
    }
  }
}

const deleteLoadedSavedRambles = async ({ confirm = true } = {}) => {
  const sessionId = rambleSessionId.value
  const loadedIds = [...loadedSavedRambleIds.value]
  if (loadedIds.length === 0) {
    return true
  }

  if (confirm && !(await UIUtils.showDeleteConfirmation(t('transaction.assistant_ramble_delete_confirm_title'), t('transaction.assistant_ramble_delete_confirm_message')))) {
    return false
  }

  isDeletingLoadedSavedRambles.value = true

  try {
    const response = await assistantRepository.deleteSavedRambles(loadedIds)
    if (sessionId !== rambleSessionId.value) {
      return false
    }

    if (isResponseSuccessful(response)) {
      savedRambles.value = savedRambles.value.filter((savedRamble) => !loadedIds.includes(savedRamble.id))
      loadedSavedRambleIds.value = []
      await refreshSavedRambleCount({ showLoading: false })
      return true
    }
  } finally {
    if (sessionId === rambleSessionId.value) {
      isDeletingLoadedSavedRambles.value = false
    }
  }

  return false
}

const deleteSavedRamble = async (ramble) => {
  if (!(await UIUtils.showDeleteConfirmation(t('transaction.assistant_ramble_delete_confirm_title'), t('transaction.assistant_ramble_delete_one_confirm_message')))) {
    return
  }

  const response = await assistantRepository.deleteSavedRamble(ramble.id)
  if (isResponseSuccessful(response)) {
    savedRambles.value = savedRambles.value.filter((savedRamble) => savedRamble.id !== ramble.id)
    loadedSavedRambleIds.value = loadedSavedRambleIds.value.filter((id) => id !== ramble.id)
    await refreshSavedRambleCount({ showLoading: false })
  }
}

const openRamblePopup = async () => {
  if (!rambleText.value && props.assistantText) {
    rambleText.value = props.assistantText
  }

  showRamblePopup.value = true
  await refreshSavedRambleCount({ showLoading: false })
}

// Three photos keep the base64 request well under PHP's 8M post limit and the 60 s LLM timeout.
const maxReceipts = 3
const receiptInputRef = ref(null)
const isPreparingReceipts = ref(false)

const onReceiptsSelected = async (event) => {
  const selected = Array.from(event.target.files ?? [])
  event.target.value = ''

  const files = selected.slice(0, Math.max(0, maxReceipts - rambleReceipts.value.length))
  if (selected.length > files.length) {
    UIUtils.showToastError(t('transaction.assistant_ramble_receipt_limit', { count: maxReceipts }))
  }
  if (files.length === 0) {
    return
  }

  isPreparingReceipts.value = true
  try {
    const prepared = []
    for (const file of files) {
      const blob = await compressImageToJpeg(file)
      const jpeg = new File([blob], `receipt-${Date.now()}-${prepared.length}.jpg`, { type: 'image/jpeg' })
      prepared.push({ id: getGUID(), file: jpeg, dataUrl: await blobToDataUrl(jpeg) })
    }
    rambleReceipts.value = [...rambleReceipts.value, ...prepared]
  } catch {
    UIUtils.showToastError(t('transaction.assistant_ramble_receipt_failed'))
    return
  } finally {
    isPreparingReceipts.value = false
  }

  await openRamblePopup()
}

const closeRamblePopup = () => {
  // The showRamblePopup watcher resets the ramble state on any close, overlay taps included.
  showRamblePopup.value = false
}

const resetRamble = () => {
  rambleSessionId.value += 1
  rambleText.value = ''
  rambleReceipts.value = []
  savedRambles.value = []
  loadedSavedRambleIds.value = []
  isLoadingSavedRambles.value = false
  isDeletingLoadedSavedRambles.value = false
  showRambleTransactionPopup.value = false
  editingRambleTransaction.value = null
  resetDrafts()
}

const interpretRambleText = () => {
  return interpret({ text: rambleText.value, savedRambles: savedRambles.value, receipts: rambleReceipts.value })
}

const openRambleTransaction = (transaction) => {
  if (transaction.status === draftStatus.creating) {
    return
  }

  editingRambleTransaction.value = cloneDeep(transaction)
  showRambleTransactionPopup.value = true
}

const onRambleTransactionEdited = (editedTransaction) => {
  applyEditedDraft(editedTransaction)
  editingRambleTransaction.value = null
}

const createRambleTransactions = async () => {
  const sessionId = rambleSessionId.value
  const { successCount, failedCount } = await create({ receipts: [...rambleReceipts.value] })
  if (sessionId !== rambleSessionId.value || successCount === 0 || failedCount > 0) {
    return
  }

  const savedRamblesDeleted = !hasLoadedSavedRambles.value || (await deleteLoadedSavedRambles({ confirm: false }))
  if (!savedRamblesDeleted) {
    UIUtils.showToastError('Transactions were created, but saved rambles could not be deleted.')
    return
  }

  closeRamblePopup()
  await navigateTo(RouteConstants.ROUTE_TRANSACTION_LIST)
}

watch(showRamblePopup, (newValue) => {
  if (!newValue) {
    inputCardRef.value?.stopRecording()
    resetRamble()
  }
})

onMounted(async () => {
  await refreshSavedRambleCount({ showLoading: false })
})
</script>
