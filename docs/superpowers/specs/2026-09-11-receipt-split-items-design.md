# Receipt items as split transactions

Date: 2026-09-11
Branch: `feature/receipt-split-items` (from `dev`)

## Problem

Scanning a receipt in the Dictate popup produces one transaction whose amount
is the receipt total and whose notes list every purchased item with its price.
Firefly III can store the same purchase as a transaction group with one split
per item, each with its own amount, adding up to the total. Pico can display
such groups but cannot create them, and the assistant never asks for per-item
data.

## Goal

A scanned receipt becomes one Firefly transaction group whose splits are the
purchased items. The user can review and edit the items in the ramble preview
before creating. The old single-transaction behaviour stays available and is
used automatically whenever splitting would be unsafe.

## Decisions

- Splitting is controlled by an assistant setting, default on.
- Every split inherits the receipt-level classification: accounts, category,
  budget, tags, date and type. The assistant does not classify items.
- When item prices do not add up to the receipt total, or the receipt is in a
  foreign currency, the draft falls back to a single transaction with the
  items in notes and the preview says why.
- Items are edited in the existing ramble edit popup through a compact item
  list under the transaction form. The main transaction page is untouched.
- No backend change. The Laravel proxy forwards the request body verbatim.

## Design

### Setting

`profileStore.assistantSplitReceipts`, a `useLocalStorage` boolean, default
`true`. Exposed as an `app-boolean` toggle in the General group of
`front/pages/settings/assistant.vue`, labelled by the new i18n key
`settings.assistant.split_receipts`.

### Prompt and response shape

`getInterpretationPrompt` in `front/repository/AssistantRepository.js` takes
`{ hasReceipts, splitReceipts }`. When both are true, the receipt transaction
shape gains:

```
"items": [{"description": string, "amount": number}]
```

and the receipt instructions change to:

- Put every purchased item in `items`, one entry per printed line, with the
  line total after that line's own discount. A quantity line is one item whose
  amount is quantity times unit price.
- The item amounts must add up to `amount`. Receipt-wide discounts are folded
  into the items they apply to.
- `notes` must not repeat the items; use it only for other useful information
  or leave it null.
- Transactions that come only from the text have an empty `items` array.

When `splitReceipts` is false the prompt is exactly the current one.

`normalizeTransactions` adds `items`: an array of `{ description, amount }`
where `description` is a non-empty trimmed string and `amount` is a finite
number; anything else is dropped. Missing `items` becomes `[]`.

`interpretTransactions` receives `splitReceipts` in its data argument and
passes it to the prompt builder. `ramble.vue` passes
`profileStore.assistantSplitReceipts`.

### Resolver

`resolveRambleTransaction` in `useRambleTransactionResolver.js` already keeps
the raw response under `raw`; `items` is available as `raw.items`. No change.

### Helpers: `front/utils/ReceiptItemUtils.js`

Three pure functions, no store access:

- `reconcileReceiptItems(items, total)` returns `true` when
  `|sum(items.amount) - total| <= 0.01 * items.length`. Both sides are parsed
  with `parseFloat`; a non-finite total returns `false`.
- `formatReceiptItemsAsNotes(items)` returns the lines
  `"<description> - <amount>"` joined by newlines, matching what the prompt
  used to ask for in notes.
- `expandReceiptItems(item, items)` returns `item` unchanged when `items` has
  fewer than two entries. Otherwise it returns a deep clone of `item` whose
  `attributes.transactions` is one clone of the first split per item, with
  `description` and `amount` replaced, and whose `attributes.group_title` is
  the first split's description. `amount` is written as a string with
  `Number(amount).toFixed(decimals)`, where `decimals` is
  `Currency.getDecimalPlaces(split.currency) ?? 2` (the draft split may have
  no currency object, so `Transaction.formatAmountForCurrency` is not used).

### Draft shape

A ramble draft keeps its single-split `item` (amount = receipt total) and
gains:

- `items`: the item array used to expand at preview and create time, or `[]`.
- `splitFallbackReason`: `null`, `'mismatch'` or `'foreign_currency'`.

In `interpretRambleText` (`ramble.vue`), after `buildTransactionItemFromAssistant`:

1. `items = profileStore.assistantSplitReceipts ? transaction.raw.items : []`.
2. If `items.length >= 2` and the built item has a foreign amount or foreign
   currency set, reason is `'foreign_currency'`.
3. Else if `items.length >= 2` and `reconcileReceiptItems(items, amount)` is
   false, reason is `'mismatch'`.
4. If a reason is set, or `items.length < 2`: when `items` is non-empty and
   the item's notes are empty, notes become `formatReceiptItemsAsNotes(items)`;
   then `items = []`. Single-item receipts therefore keep the old behaviour
   without a reason.

This logic lives in a small function in `useTransactionAssistantDraft.js`,
`buildReceiptDraft(assistantTransaction, item, splitReceipts)`, returning
`{ item, items, splitFallbackReason }`, so `ramble.vue` stays declarative.

### Preview

`ramble-transaction-item.vue` renders
`<transaction-list-item :value="expandedItem">` where `expandedItem` is
`computed(() => expandReceiptItems(transaction.item, transaction.items ?? []))`.
The existing split badge, split count and summed amount then appear for free.
When `splitFallbackReason` is set, a muted line shows
`transaction.assistant_ramble_split_fallback_<reason>`.

### Editing

`ramble-transaction-edit-popup.vue` keeps `<transaction-form v-model="transaction.item">`
for the shared fields. Below it, when `transaction.items.length > 0`, it renders
the new `front/components/transaction/ramble/ramble-receipt-items.vue` with
`v-model="transaction.items"` and `v-model:amount="transaction.item.attributes.transactions[0].amount"`.

`ramble-receipt-items.vue`:

- A `van-cell-group inset` titled with `$t('items')`, one row per item with an
  `app-field` for the description, an `app-field` with `inputmode="decimal"`
  for the amount, and a delete icon button. When a deletion leaves fewer than
  two items, the popup runs the merge described below with the remaining items.
- A footer row showing the live total (`$t('total')`) and a plain button
  `transaction.assistant_ramble_merge_items`.
- Any change to an item amount, or a deletion, writes the new sum, formatted
  with `toFixed(2)`, into the `amount` model.
- Merge: emits `merge`; the popup clears `transaction.items`, sets notes to
  `formatReceiptItemsAsNotes(previousItems)` when notes are empty, and leaves
  the amount as is.

On save in the popup, after the form validates: if `transaction.items.length > 0`
and `reconcileReceiptItems(items, amount)` is false, show the toast
`transaction.assistant_ramble_items_mismatch` and stay open.

`onRambleTransactionEdited` in `ramble.vue` copies `items` and
`splitFallbackReason` (set to `null` after a manual edit) alongside `item`.

### Create

In `createRambleTransactions`, the request body becomes
`TransactionTransformer.transformToApi(expandReceiptItems(draft.item, draft.items))`.

`TransactionTransformer.transformToApi` adds
`group_title: get(item, 'attributes.group_title')` to the returned object when
`transactions.length > 1`. Firefly III rejects a multi-split group without a
group title, so this is required for the write to succeed. Single-split writes
are unchanged: the key is omitted.

Receipt attachment is unchanged; it uses the first journal of the created
group.

### i18n

New keys in all eleven locale files (`en`, `ro`, `zh-CN`, `it`, `pt-BR`,
`de-DE`, `fr`, `pl`, `ru-RU`, `es-MX`, `ko`):

- `settings.assistant.split_receipts`: "Split receipts into one transaction per item"
- `transaction.assistant_ramble_merge_items`: "Merge into one transaction"
- `transaction.assistant_ramble_items_mismatch`: "The items must add up to the amount"
- `transaction.assistant_ramble_split_fallback_mismatch`: "Items did not add up to the total, so the receipt was kept as one transaction with the items in notes"
- `transaction.assistant_ramble_split_fallback_foreign_currency`: "Receipts in a foreign currency are kept as one transaction with the items in notes"

Existing root keys `items`, `total`, `description`, `amount` and `delete` are
reused.

### Docs and release

- `readme.md` receipt feature bullet mentions that items become splits.
- `CHANGELOG.md` gains a `0.2.4-dev6` section.
- `config.yaml` version becomes `0.2.4-dev6`.

## Out of scope

- Per-item category, budget or tags.
- Splitting foreign-currency receipts.
- Creating or editing splits on the main transaction page.
- Backend validation of splits.

## Verification

There is no front-end test runner in the repo. Verification is:

- `npm run lint` and `npm run build` from `front/`.
- Every changed locale file parses as JSON.
- Manual, setting on: scan a multi-item receipt; the preview shows the split
  badge and item count; open the draft, change an amount and see the total
  follow; delete an item; merge and confirm notes are filled; re-scan and create;
  in Firefly the group has one journal per item, the merchant as group title,
  the receipt total as sum and the photo attached to the first journal.
- Manual, mismatch: edit an item amount so the sum differs and confirm the save
  is blocked with the toast.
- Manual, setting off: the same receipt produces one transaction with the items
  in notes, identical to today.
