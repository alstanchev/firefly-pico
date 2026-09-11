import { cloneDeep } from 'lodash-es'

// Pure helpers for receipt line items. No store or Nuxt alias imports so they run under `node --test`.
// Every money function takes the currency's decimal places; callers derive them once from the draft.

// Users type amounts with either decimal separator; the assistant returns numbers.
export const parseAmount = (value) => {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return NaN
  }
  return Number(value.trim().replace(',', '.'))
}

export const roundAmount = (value, decimals = 2) => {
  const parsed = parseAmount(value)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(decimals)) : NaN
}

// Each amount is rounded before it is added: the posted splits are the rounded amounts, so the check must add
// exactly those (0.333 x 3 posts as 0.99, not 1.00).
export const sumReceiptItems = (items, decimals = 2) => {
  const sum = items.reduce((result, item) => {
    const amount = roundAmount(item.amount, decimals)
    return result + (Number.isFinite(amount) ? amount : 0)
  }, 0)
  return roundAmount(sum, decimals)
}

// Exact reconciliation on the rounded amounts, in the order the user should fix things: a blank row, a bad amount,
// then the total. Nothing is ever adjusted silently.
export const getReceiptItemsProblem = (items, total, decimals = 2) => {
  if (items.some((item) => !String(item.description ?? '').trim())) {
    return 'missing_description'
  }
  if (items.some((item) => !(roundAmount(item.amount, decimals) > 0))) {
    return 'invalid_amount'
  }
  const roundedTotal = roundAmount(total, decimals)
  if (!Number.isFinite(roundedTotal) || sumReceiptItems(items, decimals) !== roundedTotal) {
    return 'mismatch'
  }
  return null
}

export const formatReceiptItemsAsNotes = (items, decimals = 2) => {
  return items
    .map((item) => {
      const amount = roundAmount(item.amount, decimals)
      return `${item.description} - ${Number.isFinite(amount) ? amount.toFixed(decimals) : item.amount}`
    })
    .join('\n')
}

// Turns a single-split draft into a Firefly group with one split per item. Every split inherits the first split's fields,
// except notes, which stay on the first split so a receipt-level note is not repeated on every journal.
// Callers only expand items that have no problem.
export const expandReceiptItems = (item, items, decimals = 2) => {
  if (!items || items.length < 2) {
    return item
  }

  const expanded = cloneDeep(item)
  const firstSplit = expanded.attributes.transactions[0]

  expanded.attributes.group_title = firstSplit.description
  expanded.attributes.transactions = items.map((receiptItem, index) => ({
    ...cloneDeep(firstSplit),
    description: receiptItem.description,
    amount: roundAmount(receiptItem.amount, decimals).toFixed(decimals),
    notes: index === 0 ? firstSplit.notes : '',
  }))

  return expanded
}
