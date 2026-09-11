import { cloneDeep, get } from 'lodash-es'
import Account from '~/models/Account.js'
import Transaction from '~/models/Transaction'
import { useTransactionForm } from '~/composables/useTransactionForm.js'
import { formatReceiptItemsAsNotes } from '~/utils/ReceiptItemUtils.js'
import { getGUID } from '~/utils/Utils.js'

// The draft split has no currency object; the source account's currency is the reference, as in applyAssistantTransaction.
export const getDraftDecimals = (split) => {
  return Account.getCurrencyDecimalPlaces(get(split, 'accountSource')) ?? 2
}

// Decides what a receipt draft carries. Items are kept even when they do not add up: the user reconciles them in the editor.
export const buildReceiptDraft = (item, rawItems, splitReceipts) => {
  const split = item.attributes.transactions[0]
  const decimals = getDraftDecimals(split)
  const items = splitReceipts ? (rawItems ?? []).map((rawItem) => ({ id: getGUID(), description: rawItem.description, amount: rawItem.amount })) : []

  if (items.length >= 2 && split.amountForeign) {
    // Per-split foreign amounts would need their own conversion and rounding; keep such receipts whole.
    if (!split.notes) {
      split.notes = formatReceiptItemsAsNotes(items, decimals)
    }
    return { item, items: [], splitFallbackReason: 'foreign_currency' }
  }

  if (items.length < 2) {
    if (items.length === 1 && !split.notes) {
      split.notes = formatReceiptItemsAsNotes(items, decimals)
    }
    return { item, items: [], splitFallbackReason: null }
  }

  return { item, items, splitFallbackReason: null }
}

export const useTransactionAssistantDraft = () => {
  const item = ref(new Transaction().getEmpty())
  const itemId = computed(() => null)
  const { applyAssistantTransaction } = useTransactionForm({ item, itemId })

  const buildTransactionItemFromAssistant = async (assistantTransaction) => {
    await applyAssistantTransaction(assistantTransaction)
    await nextTick()
    return cloneDeep(item.value)
  }

  return {
    buildTransactionItemFromAssistant,
  }
}
