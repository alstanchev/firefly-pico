<template>
  <app-popup v-model:show="show" :popup-style="popupStyle">
    <div ref="popupRef" class="display-flex flex-direction-column h-100 m-h-0 position-relative" :aria-busy="isInterpreting">
      <div class="display-flex flex-direction-column h-100 m-h-0" :class="{ 'pointer-events-none': isInterpreting }" :inert="isInterpreting">
        <div class="ramble-header flex-center-vertical gap-2">
          <div class="ramble-header-icon flex-center">
            <app-icon :icon="icon" :size="22" :stroke="1.6" />
          </div>
          <div class="flex-1-w">
            <div class="font-700 text-size-16 line-height-normal">{{ title }}</div>
            <div class="text-size-12 text-muted mt-1">{{ subtitle }}</div>
          </div>
          <van-button round size="small" class="cursor-pointer ramble-icon-button" @click="show = false">
            <app-icon :icon="TablerIconConstants.close" :size="18" />
          </van-button>
        </div>

        <div ref="popupContentRef" class="flex-1 m-h-0 overflow-auto display-flex flex-direction-column gap-3 p-3 ramble-body">
          <slot :is-interpreting="isInterpreting" />

          <div v-if="error" class="ramble-error text-size-12">{{ error }}</div>

          <template v-if="drafts.length > 0">
            <div class="flex-center-vertical gap-2 px-1">
              <div class="ramble-section-label">{{ $t('transaction.assistant_ramble_preview') }}</div>
              <div class="ramble-count-pill">{{ drafts.length }}</div>
            </div>
            <van-cell-group inset class="no-margin overflow-hidden">
              <ramble-transaction-item v-for="(draft, index) in drafts" :key="draft.id" v-model="drafts[index]" @delete="removeDraft" @edit="openDraft" />
            </van-cell-group>
          </template>

          <div v-else-if="isInterpreting" class="ramble-empty flex-1 flex-center flex-direction-column gap-2 text-center">
            <van-loading size="24" />
            <div class="text-size-13 text-muted">{{ $t('transaction.assistant_ramble_interpreting') }}</div>
          </div>

          <div v-else class="ramble-empty flex-1 flex-center flex-direction-column gap-2 text-center">
            <div class="ramble-empty-icon flex-center">
              <app-icon :icon="icon" :size="26" :stroke="1.4" />
            </div>
            <div class="text-size-13 text-muted">{{ hasInterpreted ? $t('transaction.assistant_ramble_no_results') : emptyHint }}</div>
          </div>
        </div>

        <div v-if="hasCreateProgress || drafts.length > 0" class="p-3 ramble-footer">
          <div v-if="hasCreateProgress" class="mb-3">
            <div class="flex-center-vertical gap-2 text-size-12 text-muted mb-2">
              <van-loading v-if="isCreating" size="16" />
              <div>{{ createProgressLabel }}</div>
            </div>
            <van-progress :percentage="createProgressPercentage" />
          </div>

          <van-button block round type="primary" class="cursor-pointer" :loading="isCreating" :disabled="createButtonCount === 0" @click="onCreate">
            {{ createButtonLabel }}
          </van-button>
        </div>
      </div>
    </div>
  </app-popup>

  <ramble-transaction-edit-popup v-model:show="showEditPopup" v-model="editingDraft" @save="onDraftEdited" />
</template>

<script setup>
import { cloneDeep } from 'lodash-es'
import { computed, ref, watch } from 'vue'
import TablerIconConstants from '~/constants/TablerIconConstants.js'
import RambleTransactionItem from '~/components/transaction/ramble/ramble-transaction-item.vue'
import RambleTransactionEditPopup from '~/components/transaction/ramble/ramble-transaction-edit-popup.vue'
import { useRambleDrafts, draftStatus } from '~/composables/useRambleDrafts.js'
import { useSwipeToDismiss } from '~/composables/useSwipeToDismiss'

const props = defineProps({
  icon: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  subtitle: {
    type: String,
    default: '',
  },
  emptyHint: {
    type: String,
    default: '',
  },
  receipts: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['created'])
const show = defineModel('show', { type: Boolean, default: false })

const appStore = useAppStore()
const {
  drafts,
  isInterpreting,
  isCreating,
  hasInterpreted,
  hasEditedDrafts,
  error,
  createButtonCount,
  hasCreateProgress,
  createProgressPercentage,
  createProgressLabel,
  createButtonLabel,
  interpret,
  create,
  removeDraft,
  applyEditedDraft,
  reset,
} = useRambleDrafts()

const popupRef = ref(null)
const popupContentRef = ref(null)
const showEditPopup = ref(false)
const editingDraft = ref(null)

useSwipeToDismiss({
  onSwipe: () => (show.value = false),
  swipeRef: popupRef,
  scrollRef: popupContentRef,
  showDropdown: show,
})

const popupStyle = computed(() => {
  if (appStore.isDesktopLayout) {
    // Full-bleed content: the header / footer dividers should reach the popup edges.
    return { width: 'min(680px, 94vw)', height: '82vh', maxHeight: '82vh', padding: '0' }
  }

  return { height: '90%' }
})

const openDraft = (draft) => {
  if (draft.status === draftStatus.creating) {
    return
  }

  editingDraft.value = cloneDeep(draft)
  showEditPopup.value = true
}

const onDraftEdited = (editedDraft) => {
  applyEditedDraft(editedDraft)
  editingDraft.value = null
}

const onCreate = async () => {
  const { successCount, failedCount } = await create({ receipts: props.receipts })
  if (successCount > 0 && failedCount === 0) {
    emit('created')
  }
}

watch(show, (newValue) => {
  if (!newValue) {
    showEditPopup.value = false
    editingDraft.value = null
    reset()
  }
})

defineExpose({
  interpret,
  reset,
  hasEditedDrafts,
})
</script>
