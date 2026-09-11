# Receipt scanning popup and receipt items as split transactions

Date: 2026-09-11
Branch: `feature/receipt-split-items` (from `dev`)

## Problem

Scanning a receipt in the Dictate popup produces one transaction whose amount
is the receipt total and whose notes list every purchased item with its price.
Firefly III can store the same purchase as a transaction group with one split
per item, each with its own amount, adding up to the total. Pico can display
such groups but cannot create them, and the assistant never asks for per-item
data.

The receipt flow also lives inside the Dictate popup: the camera button only
opens a file picker, the photos land as thumbnails next to the dictation text
area, and the user still has to press Interpret. Dictation controls, saved
rambles and the "type or dictate" copy are noise around a receipt.

## Goal

1. Receipt scanning gets its own popup that interprets photos as soon as they
   are picked. The Dictate popup no longer accepts photos.
2. A scanned receipt becomes one Firefly transaction group whose splits are the
   purchased items. The user can review and edit the items in the preview
   before creating. The old single-transaction behaviour stays available and is
   used automatically whenever splitting would be unsafe.

## Decisions

- The interpretation, draft, create and attachment logic that both popups
  share moves into one composable and one shell component. The Dictate popup
  and the new receipt popup are thin wrappers around them.
- Combining dictated text with receipt photos in one request is dropped. The
  receipt popup has no text field; corrections are made per draft in the edit
  popup.
- Splitting is controlled by an assistant setting, default on.
- Every split inherits the receipt-level classification: accounts, category,
  budget, tags, date and type. The assistant does not classify items.
- When item prices do not add up to the receipt total, or the receipt is booked
  with a foreign amount, the draft falls back to a single transaction with the
  items in notes and the preview says why.
- Items are edited in the existing ramble edit popup through a compact item
  list under the transaction form. The main transaction page is untouched.
- No backend change. The Laravel proxy forwards the request body verbatim.

## Phase 1: shared draft logic and the receipt popup

### `front/composables/useRambleDrafts.js`

Everything in `ramble.vue` that is not about the text input or saved rambles
moves here, unchanged in behaviour. The composable knows nothing about where
its input came from.

```
export const draftStatus = { pending, creating, success, error }

export const useRambleDrafts = () => ({
  drafts,                    // ref([]) of { id, assistant, item, status, error, response }
  isInterpreting, isCreating, hasInterpreted, error, currentCreateIndex,
  createdCount, failedCount, createButtonCount, hasCreateProgress,
  createProgressPercentage, createProgressLabel, createButtonLabel,
  interpret({ text = '', savedRambles = [], receipts = [] }),   // receipts: [{ id, file, dataUrl }]
  create({ receipts = [] }),  // -> Promise<{ successCount, failedCount }>
  removeDraft(draft),
  applyEditedDraft(editedDraft),
  reset(),
})
```

- `interpret` returns immediately when text, saved rambles and receipts are all
  empty. Otherwise it calls `assistantRepository.interpretTransactions`, resolves
  every returned transaction, builds a form item for each and replaces `drafts`.
  Errors land in `error`; the session counter guards against a popup that was
  closed mid-request, exactly as today.
- `create` runs the existing sequential loop, uploads the matching receipts to
  the first journal of each created group, shows the "N transactions created"
  toast, and returns the counts. It does not close anything or navigate.
- `reset` bumps the session counter and clears all state.

### `front/components/transaction/ramble/ramble-drafts-popup.vue`

The popup shell both flows render. It owns one `useRambleDrafts()` instance.

- Props: `icon` (Tabler icon name), `title`, `subtitle`, `emptyHint`,
  `receipts` (Array, default `[]`, forwarded to `create` for attachments).
- Model: `show` (`v-model:show`).
- Default slot with slot prop `isInterpreting`; the input card or the receipt
  strip goes here, above the drafts.
- Renders: the `app-popup` with the current desktop/mobile `popupStyle`, the
  header (icon, title, subtitle, close button), the scrollable body (slot,
  error line, preview label with count pill and `ramble-transaction-item` list,
  or the empty state showing `emptyHint` before the first interpretation and
  "No transactions found" after), the footer (progress + create button), and
  the `ramble-transaction-edit-popup`.
- Swipe to dismiss is wired as today.
- Exposes `interpret(payload)` and `reset()`.
- Emits `created` after a create run with zero failures.
- Closing the popup (any way) calls `reset()`.

### `front/components/transaction/ramble.vue` (Dictate)

Keeps: trigger button with the saved-rambles badge, `assistantText` prop,
saved-rambles loading and deletion, and `ramble-input-card` inside the shell's
slot. Interpret calls `popupRef.interpret({ text, savedRambles })`. On
`created`: delete loaded saved rambles (a failure shows a toast instead of the
inline error), close, navigate to the transaction list. Closing resets the text
and saved-rambles state; the shell resets the drafts.

Removed from the Dictate flow: the camera trigger, the hidden file input, the
receipt preparation code, `rambleReceipts`, `maxReceipts`, and in
`ramble-input-card.vue` the camera button, the thumbnail strip, the `receipts`
model, the `addReceipt` event and the `isPreparingReceipts` / `maxReceipts`
props. `canInterpret` becomes text or saved rambles.

### `front/components/transaction/receipt-scan.vue`

- Trigger: the camera button (`ramble-trigger-button` style) shown only when
  the LLM is configured, with a hidden `<input type="file" accept="image/*" multiple>`.
- Photo preparation moves here from `ramble.vue` unchanged: at most three
  photos, JPEG compression, data URL for the model, toast on failure or over
  the limit.
- Picking photos appends them to `receipts`, opens the shell, and calls
  `interpret({ receipts })` immediately. Picking more photos while the popup is
  open re-interprets all of them.
- Slot content: `ramble-receipt-strip.vue`.
- On `created`: close and navigate to the transaction list. Closing clears
  `receipts`.
- Mounted in `transaction-assistant.vue` right after `<ramble>`.

### `front/components/transaction/ramble/ramble-receipt-strip.vue`

- Model: `receipts`. Props: `maxReceipts`, `isPreparing`, `isDisabled`.
- Thumbnails with a remove button (moved from the input card, same
  `ramble-receipt-thumb` classes), an "Add photo" button while under the limit,
  and a "Scan again" button that emits `scan` (for use after removing a photo).
- Emits `add` and `scan`.

### i18n (phase 1)

New keys under `transaction` in all eleven locale files:

- `assistant_receipt_title`: "Scan receipts"
- `assistant_receipt_hint`: "Photos are read and turned into transactions"
- `assistant_receipt_empty`: "Add a receipt photo to start"
- `assistant_receipt_add`: "Add photo"
- `assistant_receipt_scan`: "Scan again"

Existing receipt keys (`assistant_ramble_scan_receipt`, `assistant_ramble_receipt`,
`assistant_ramble_receipt_failed`, `assistant_ramble_receipt_limit`) stay and
are reused by the new components.

## Phase 2: receipt items as splits

### Setting

`profileStore.assistantSplitReceipts`, a `useLocalStorage` boolean, default
`true`. Profile persistence picks it up automatically because the whole store
state is serialised. Exposed as an `app-boolean` toggle in the General group of
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
passes it to the prompt builder. `useRambleDrafts.interpret` passes
`profileStore.assistantSplitReceipts`.

### Resolver

`resolveRambleTransaction` in `useRambleTransactionResolver.js` already keeps
the raw response under `raw`; `items` is available as `raw.items`. No change.

### Helpers: `front/utils/ReceiptItemUtils.js`

Pure functions with no store or Nuxt alias imports, so they run under Node's
built-in test runner:

- `sumReceiptItems(items)` returns the numeric sum of `parseFloat(item.amount)`,
  treating non-numeric amounts as 0.
- `reconcileReceiptItems(items, total)` returns `true` when
  `|sumReceiptItems(items) - parseFloat(total)| <= 0.01 * items.length`. A
  non-finite total returns `false`.
- `formatReceiptItemsAsNotes(items)` returns the lines
  `"<description> - <amount>"` joined by newlines, matching what the prompt
  used to ask for in notes.
- `expandReceiptItems(item, items)` returns `item` unchanged when `items` has
  fewer than two entries. Otherwise it returns a deep clone of `item` whose
  `attributes.transactions` is one clone of the first split per item, with
  `description` and `amount` replaced, and whose `attributes.group_title` is
  the first split's description. `amount` is written as a string with
  `Number(amount).toFixed(decimals)`, where `decimals` is the first split's
  `currency.attributes.decimal_places` or 2 (the draft split may have no
  currency object, so `Transaction.formatAmountForCurrency` is not used).

Tests live in `front/tests/ReceiptItemUtils.test.js` and run with
`node --test tests/` from `front/`.

### Draft shape

A ramble draft keeps its single-split `item` (amount = receipt total) and
gains:

- `items`: the item array used to expand at preview and create time, or `[]`.
- `splitFallbackReason`: `null`, `'mismatch'` or `'foreign_currency'`.

`buildReceiptDraft(item, rawItems, splitReceipts)` in
`useTransactionAssistantDraft.js` returns `{ item, items, splitFallbackReason }`:

1. `items = splitReceipts ? rawItems ?? [] : []`.
2. If `items.length >= 2` and the built item's first split has `amountForeign`
   set, reason is `'foreign_currency'`. (`currencyForeign` alone is not a
   signal: the empty transaction pre-fills it from the default foreign
   currency.)
3. Else if `items.length >= 2` and `reconcileReceiptItems(items, amount)` is
   false, reason is `'mismatch'`.
4. If a reason is set, or `items.length < 2`: when `items` is non-empty and
   the split's notes are empty, notes become `formatReceiptItemsAsNotes(items)`;
   the returned `items` is `[]`. Single-item receipts therefore keep the old
   behaviour without a reason.

`useRambleDrafts.interpret` calls it for every draft and stores `items` and
`splitFallbackReason` on the draft.

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
  for the amount, and a delete icon button.
- A footer row showing the live total (`$t('total')`) and a plain button
  `transaction.assistant_ramble_merge_items`.
- Any change to an item amount, or a deletion, writes the new sum, formatted
  with `toFixed(2)`, into the `amount` model.
- When a deletion leaves fewer than two items, the component syncs the amount
  and then emits `merge` with the remaining items.
- Merge button: emits `merge`.

The popup handles `merge`: sets the split's notes to
`formatReceiptItemsAsNotes(items)` when notes are empty, then clears
`transaction.items`. The amount is left as it is.

On save in the popup, after the form validates: if `transaction.items.length > 0`
and `reconcileReceiptItems(items, amount)` is false, show the toast
`transaction.assistant_ramble_items_mismatch` and stay open.

`applyEditedDraft` in `useRambleDrafts` copies `items` alongside `item` and
sets `splitFallbackReason` to `null`.

### Create

In `useRambleDrafts.create`, the request body becomes
`TransactionTransformer.transformToApi(expandReceiptItems(cloneDeep(draft.item), draft.items ?? []))`.

`TransactionTransformer.transformToApi` adds
`group_title: get(item, 'attributes.group_title')` to the returned object when
`transactions.length > 1`. Firefly III rejects a multi-split group without a
group title, so this is required for the write to succeed. Single-split writes
are unchanged: the key is omitted.

Receipt attachment is unchanged; it uses the first journal of the created
group.

### i18n (phase 2)

New keys in all eleven locale files (`en`, `ro`, `zh-CN`, `it`, `pt-BR`,
`de-DE`, `fr`, `pl`, `ru-RU`, `es-MX`, `ko`):

- `settings.assistant.split_receipts`: "Split receipts into one transaction per item"
- `transaction.assistant_ramble_merge_items`: "Merge into one transaction"
- `transaction.assistant_ramble_items_mismatch`: "The items must add up to the amount"
- `transaction.assistant_ramble_split_fallback_mismatch`: "Items did not add up to the total, so the receipt was kept as one transaction with the items in notes"
- `transaction.assistant_ramble_split_fallback_foreign_currency`: "Receipts booked with a foreign amount are kept as one transaction with the items in notes"

Existing root keys `items`, `total`, `description`, `amount` and `delete` are
reused.

## Docs and release

- `readme.md` receipt feature bullet: the camera button has its own popup and
  items become splits.
- `CHANGELOG.md` gains a `0.2.4-dev6` section covering both phases.
- `config.yaml` version becomes `0.2.4-dev6`.

## Out of scope

- Per-item category, budget or tags.
- Splitting receipts booked with a foreign amount.
- Creating or editing splits on the main transaction page.
- Combining dictated text and receipt photos in one interpretation.
- Backend validation of splits.

## Verification

The only automated tests are the Node tests for `ReceiptItemUtils.js`.
Everything else is verified by:

- `npm run lint` and `npm run build` from `front/`.
- `node --test tests/` from `front/`.
- Every changed locale file parses as JSON.
- Manual, Dictate popup regression: type a transaction, Interpret, edit, create;
  load and delete saved rambles; no camera button or thumbnails remain.
- Manual, receipt popup: tap the camera, pick two photos; the popup opens and
  starts interpreting without a further tap; remove a photo and Scan again;
  add a photo and see it re-interpret; create and confirm the photo is
  attached in Firefly.
- Manual, setting on: scan a multi-item receipt; the preview shows the split
  badge and item count; open the draft, change an amount and see the total
  follow; delete an item; merge and confirm notes are filled; re-scan and
  create; in Firefly the group has one journal per item, the merchant as group
  title, the receipt total as sum and the photo attached to the first journal.
- Manual, mismatch: edit an item amount so the sum differs and confirm the save
  is blocked with the toast.
- Manual, setting off: the same receipt produces one transaction with the items
  in notes, identical to today.
- Manual, dark theme: the receipt strip, item editor and popup header look
  right with the dark theme toggled.
