<template>
  <app-popup v-model:show="show" :popup-style="popupStyle">
    <div ref="popupRef" class="display-flex flex-direction-column h-100 m-h-0">
      <div class="flex-center-vertical gap-2 px-3 py-2 ramble-divider-bottom">
        <div class="font-600 text-size-16 flex-1">{{ $t('transaction.assistant_ramble_edit_title') }}</div>
        <van-button size="small" class="cursor-pointer" @click="show = false">
          <app-icon :icon="TablerIconConstants.close" :size="18" />
        </van-button>
      </div>

      <div ref="popupContentRef" class="flex-1 m-h-0 overflow-auto">
        <transaction-form v-if="transaction" ref="formRef" v-model="transaction.item" form-name="ramble-transaction-form" />
        <ramble-receipt-items
          v-if="transaction?.items?.length > 0"
          v-model="transaction.items"
          :amount="transaction.item.attributes.transactions[0].amount"
          :decimals="decimals"
          @merge="onMergeItems"
        />
      </div>

      <div class="display-flex gap-2 p-3 ramble-divider">
        <van-button block class="cursor-pointer" @click="show = false">{{ $t('cancel') }}</van-button>
        <van-button block type="primary" class="cursor-pointer" @click="onSave">{{ $t('save') }}</van-button>
      </div>
    </div>
  </app-popup>
</template>

<script setup>
import TablerIconConstants from '~/constants/TablerIconConstants.js'
import TransactionForm from '~/components/transaction/TransactionForm.vue'
import RambleReceiptItems from '~/components/transaction/ramble/ramble-receipt-items.vue'
import { formatReceiptItemsAsNotes, getReceiptItemsProblem } from '~/utils/ReceiptItemUtils.js'
import { getDraftDecimals } from '~/composables/useTransactionAssistantDraft.js'
import UIUtils from '~/utils/UIUtils.js'
import { useSwipeToDismiss } from '~/composables/useSwipeToDismiss'

const emit = defineEmits(['save'])
const show = defineModel('show', { type: Boolean, default: false })
const transaction = defineModel({ type: Object, default: null })

const { t } = useI18n()
const appStore = useAppStore()
const formRef = ref(null)
const popupRef = ref(null)
const popupContentRef = ref(null)

useSwipeToDismiss({
  onSwipe: () => (show.value = false),
  swipeRef: popupRef,
  scrollRef: popupContentRef,
  showDropdown: show,
})

const popupStyle = computed(() => {
  if (appStore.isDesktopLayout) {
    return { width: '94vw', maxHeight: '92vh' }
  }

  return { height: '96%' }
})

const firstSplit = computed(() => transaction.value?.item?.attributes?.transactions?.[0])
const decimals = computed(() => getDraftDecimals(firstSplit.value))

const onMergeItems = () => {
  const split = firstSplit.value
  if (!split.notes && transaction.value.items.length > 0) {
    split.notes = formatReceiptItemsAsNotes(transaction.value.items, decimals.value)
  }
  transaction.value.items = []
}

const onSave = async () => {
  try {
    await formRef.value?.validate()
  } catch {
    UIUtils.showToastError('Form has invalid values. Check the red fields :)')
    return
  }

  const items = transaction.value?.items ?? []
  const problem = items.length > 0 ? getReceiptItemsProblem(items, firstSplit.value.amount, decimals.value) : null
  if (problem) {
    UIUtils.showToastError(t(`transaction.assistant_ramble_items_${problem}`))
    return
  }

  emit('save', transaction.value)
  show.value = false
}
</script>
