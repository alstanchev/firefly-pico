<template>
  <div class="ramble-transaction-item" :class="statusClass">
    <div v-if="isCreating || transaction.error" class="flex-center-vertical gap-2 px-3 pt-2">
      <van-loading v-if="isCreating" size="14" />
      <div v-if="transaction.error" class="text-size-12 text-danger word-break-word flex-1-w">{{ transaction.error }}</div>
    </div>

    <div v-if="categorySuggestion || tagSuggestions.length" class="text-size-12 text-muted px-3 pt-2">
      <div v-if="categorySuggestion">{{ $t('transaction.assistant_ramble_unmatched_category', { name: categorySuggestion }) }}</div>
      <div v-if="tagSuggestions.length">{{ $t('transaction.assistant_ramble_unmatched_tags', { names: tagSuggestions.join(', ') }) }}</div>
    </div>

    <div v-if="itemsProblem" class="text-size-12 text-danger px-3 pt-2">{{ $t(`transaction.assistant_ramble_items_${itemsProblem}`) }}</div>
    <div v-if="transaction.splitFallbackReason" class="text-size-12 text-muted px-3 pt-2">{{ $t(`transaction.assistant_ramble_split_fallback_${transaction.splitFallbackReason}`) }}</div>

    <transaction-list-item :value="previewItem" :is-detailed-mode="true" @on-edit="onEdit" @on-delete="onDelete" />
  </div>
</template>

<script setup>
import { get } from 'lodash-es'
import TransactionListItem from '~/components/list-items/transaction-list-item.vue'
import { expandReceiptItems, getReceiptItemsProblem } from '~/utils/ReceiptItemUtils.js'
import { getDraftDecimals } from '~/composables/useTransactionAssistantDraft.js'

const emit = defineEmits(['delete', 'edit'])
const transaction = defineModel({
  type: Object,
  required: true,
})

const categorySuggestion = computed(() => get(transaction.value, 'item.attributes.transactions.0.categorySuggestion'))
const tagSuggestions = computed(() => get(transaction.value, 'item.attributes.transactions.0.tagSuggestions') ?? [])

const firstSplit = computed(() => get(transaction.value, 'item.attributes.transactions.0'))
const items = computed(() => transaction.value.items ?? [])
const decimals = computed(() => getDraftDecimals(firstSplit.value))
// Problems are computed where they are shown, never stored on the draft, so an edit to the amount or the items updates the preview.
const itemsProblem = computed(() => (items.value.length > 0 ? getReceiptItemsProblem(items.value, get(firstSplit.value, 'amount'), decimals.value) : null))
// A draft whose items do not add up is previewed as it would be created if the user merged it: one transaction with the receipt total.
const previewItem = computed(() => (items.value.length > 0 && !itemsProblem.value ? expandReceiptItems(transaction.value.item, items.value, decimals.value) : transaction.value.item))

const isCreating = computed(() => transaction.value.status === 'creating')
const isCreated = computed(() => transaction.value.status === 'success')
const isFailed = computed(() => transaction.value.status === 'error')

const statusClass = computed(() => {
  if (isCreated.value) {
    return 'ramble-transaction-item-success'
  }

  if (isFailed.value) {
    return 'ramble-transaction-item-error'
  }

  return null
})

const onDelete = () => {
  if (isCreating.value) {
    return
  }

  emit('delete', transaction.value)
}

const onEdit = () => {
  emit('edit', transaction.value)
}
</script>
