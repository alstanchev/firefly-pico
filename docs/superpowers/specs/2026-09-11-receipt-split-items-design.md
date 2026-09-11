# Receipt scanning popup and receipt items as split transactions

Date: 2026-09-11 (revised after review)
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

1. Receipt scanning gets its own popup. Tapping the camera opens it; the user
   decides there whether the items become splits, then adds the photos, which
   are interpreted as soon as they are picked. The Dictate popup no longer
   accepts photos.
2. With splitting on, a scanned receipt becomes one Firefly transaction group
   whose splits are the purchased items. The item amounts must add up exactly
   to the receipt total. When they do not, or an item has no usable amount,
   the user fixes the items in the draft editor before creating. With
   splitting off, the receipt stays one transaction with the items in notes,
   exactly as today.

## Decisions

- The interpretation, draft, create and attachment logic that both popups
  share moves into one composable and one shell component. The Dictate popup
  and the new receipt popup are thin wrappers around them.
- Combining dictated text with receipt photos in one request is dropped. The
  receipt popup has no text field; corrections are made per draft in the edit
  popup.
- Splitting is chosen per scan with a "Split into items" chip in the receipt
  popup, set before the photos are added. An assistant setting provides the
  chip's initial state and is off by default.
- Reconciliation is exact. At the currency's precision the item amounts must
  equal the transaction amount; there is no tolerance and nothing ever adjusts
  an amount silently. A difference is a problem the user resolves in the
  editor by correcting, adding or deleting items, by correcting the amount,
  or by merging the items into notes. Drafts with unresolved problems are not
  created.
- Every item amount must be above zero, because Firefly III rejects any other
  split amount. The prompt folds discounts into the items they apply to; an
  item that still arrives with a zero or negative amount is shown to the user
  as a problem, never dropped or posted.
- Every split inherits the receipt-level classification: accounts, category,
  budget, tags, date and type. The assistant does not classify items.
- The only automatic fallback to a single transaction is a receipt booked
  with a foreign amount, because per-split foreign amounts would need their
  own conversion. The preview says why. A one-item receipt is a plain single
  transaction with the item in notes and no message.
- Items are edited in the existing ramble edit popup through a compact item
  list under the transaction form. The main transaction page is untouched,
  but see the `group_title` note under Create.
- Receipt photos are matched to drafts by receipt id, not by position, so
  removing a photo cannot attach the wrong one.
- No backend change. The Laravel proxy forwards the request body verbatim
  (`BaseControllerFirefly::store` sends `$request->all()`).

## Phase 1: shared draft logic and the receipt popup

### `front/composables/useRambleDrafts.js`

Everything in `ramble.vue` that is not about the text input or saved rambles
moves here, unchanged in behaviour. The composable knows nothing about where
its input came from.

```
export const draftStatus = { pending, creating, success, error }

export const useRambleDrafts = () => ({
  drafts,                    // ref([]) of { id, assistant, item, receiptIds, status, error, response }
  isInterpreting, isCreating, hasInterpreted, error, currentCreateIndex,
  createdCount, failedCount, createButtonCount, hasCreateProgress,
  createProgressPercentage, createProgressLabel, createButtonLabel,
  interpret({ text = '', savedRambles = [], receipts = [], splitReceipts = false }),
  create({ receipts = [] }),  // -> Promise<{ successCount, failedCount }>
  removeDraft(draft),
  applyEditedDraft(editedDraft),
  reset(),
})
```

- `interpret` returns immediately when text, saved rambles and receipts are all
  empty. Otherwise it calls `assistantRepository.interpretTransactions` (passing
  `splitReceipts` through), resolves every returned transaction, builds a form
  item for each and replaces `drafts`. Each draft records `receiptIds`: the
  ids of the receipts at the positions the assistant returned in
  `receiptIndexes`. Errors land in `error`; the session counter guards against
  a popup that was closed mid-request, exactly as today.
- `create` runs the existing sequential loop, uploads the receipts whose ids a
  created draft lists to the first journal of its group (the single-draft
  fallback stays: with one draft and no ids, every photo belongs to it), shows
  the "N transactions created" toast, and returns the counts. It does not close
  anything or navigate.
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
  error line, then one of: the preview label with count pill and the
  `ramble-transaction-item` list; an interpreting state with a `van-loading`
  and `transaction.assistant_ramble_interpreting` while `isInterpreting`; or
  the empty state showing `emptyHint` before the first interpretation and
  "No transactions found" after), the footer (progress + create button), and
  the `ramble-transaction-edit-popup`.
- Swipe to dismiss is wired as today.
- Exposes `interpret(payload)`, `reset()` and `hasDrafts` (boolean computed,
  used by the receipt popup to confirm before a re-scan).
- Emits `created` after a create run with at least one success and zero
  failures.
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
  the LLM is configured. Tapping it opens the popup; it does not open the
  file picker. The hidden `<input type="file" accept="image/*" multiple>` is
  triggered by the strip's Add photo button.
- `splitItems` is a ref set from `profileStore.assistantSplitReceipts` every
  time the popup opens, so the chip always starts from the setting.
- Photo preparation moves here from `ramble.vue` unchanged: at most three
  photos, JPEG compression, data URL for the model, toast on failure or over
  the limit.
- Picking photos appends them to `receipts` and calls
  `interpret({ receipts, splitReceipts: splitItems })` immediately.
- Any action that would re-interpret while drafts exist (adding a photo,
  Scan again, toggling the chip with photos present) first asks for
  confirmation with `assistant_receipt_rescan_title` /
  `assistant_receipt_rescan_message`, because a re-scan replaces the drafts
  and any edits made to them. Declining leaves everything as it is (a declined
  photo pick is discarded; a declined chip toggle is reverted).
- Removing a photo keeps the drafts. Their `receiptIds` no longer match the
  removed photo, so nothing wrong gets attached; the user can Scan again.
- Slot content: `ramble-receipt-strip.vue`.
- On `created`: close and navigate to the transaction list. Closing clears
  `receipts`.
- Mounted in `transaction-assistant.vue` right after `<ramble>`.

### `front/components/transaction/ramble/ramble-receipt-strip.vue`

- Model: `receipts`. Props: `splitItems` (Boolean), `maxReceipts`,
  `isPreparing`, `isDisabled`. The chip is a prop plus a `toggleSplit` event
  rather than a model so the parent can refuse a toggle when the user
  declines the re-scan confirmation.
- First row: the "Split into items" chip, a round `van-tag` with the
  `TablerIconConstants.list` icon that is filled (`type="primary"`) when on and
  `plain` when off, and a muted hint `assistant_receipt_split_hint` next to it.
- Thumbnails with a remove button (moved from the input card, same
  `ramble-receipt-thumb` classes), an "Add photo" button while under the limit,
  and a "Scan again" button that emits `scan`, disabled without photos.
- Emits `add`, `scan` and `toggleSplit`.

### i18n (phase 1)

New keys under `transaction` in all eleven locale files:

- `assistant_receipt_title`: "Scan receipts"
- `assistant_receipt_hint`: "Photos are read and turned into transactions"
- `assistant_receipt_empty`: "Add a receipt photo to start"
- `assistant_receipt_add`: "Add photo"
- `assistant_receipt_scan`: "Scan again"
- `assistant_receipt_split`: "Split into items"
- `assistant_receipt_split_hint`: "Choose before adding photos"
- `assistant_receipt_rescan_title`: "Scan again?"
- `assistant_receipt_rescan_message`: "The current drafts and any edits to them will be replaced."
- `assistant_ramble_interpreting`: "Interpreting…"

Existing receipt keys (`assistant_ramble_scan_receipt`, `assistant_ramble_receipt`,
`assistant_ramble_receipt_failed`, `assistant_ramble_receipt_limit`) stay and
are reused by the new components.

## Phase 2: receipt items as splits

### Setting

`profileStore.assistantSplitReceipts`, a `useLocalStorage` boolean, default
`false`. Profile persistence picks it up automatically because the whole store
state is serialised. Exposed as an `app-boolean` toggle in the General group of
`front/pages/settings/assistant.vue`, labelled by the new i18n key
`settings.assistant.split_receipts` ("Split receipts into items by default").
It only seeds the chip; the chip decides per scan.

### Prompt and response shape

`getInterpretationPrompt` in `front/repository/AssistantRepository.js` takes
`{ hasReceipts, splitReceipts }`. When both are true, the receipt transaction
shape gains:

```
"items": [{"description": string, "amount": number}]
```

and the receipt instructions change to:

- Put every printed line the customer paid for in `items`, one entry per
  line, including tax, VAT, service charge, tip, bag, deposit and rounding
  lines when the receipt prints them as separate amounts. `description` is the
  line text as printed; `amount` is the line total after that line's own
  discount. A quantity line is one item whose amount is quantity times unit
  price.
- Every item amount must be greater than zero. Never emit a discount, refund
  or return as its own negative item: subtract it from the item it applies to,
  and spread a receipt-wide discount over the items it covers.
- The item amounts must add up exactly to `amount`.
- `notes` must not repeat the items; use it only for other useful information
  or leave it null.
- Transactions that come only from the text have an empty `items` array.

When `splitReceipts` is false the prompt is exactly the current one.

`normalizeTransactions` adds `items`: an array of `{ description, amount }`
where `description` is a non-empty trimmed string (entries without one are
dropped) and `amount` is `Number(item.amount)` when that is finite, otherwise
`0` (kept, so the user sees the line and fills the amount in). Missing `items`
becomes `[]`.

`interpretTransactions` receives `splitReceipts` in its data argument and
passes it to the prompt builder.

### Resolver

`resolveRambleTransaction` in `useRambleTransactionResolver.js` already keeps
the raw response under `raw`; `items` is available as `raw.items`. No change.

### Helpers: `front/utils/ReceiptItemUtils.js`

Pure functions with no store or Nuxt alias imports, so they run under Node's
built-in test runner. Every function that touches money takes `decimals`, the
currency's decimal places; callers derive it once from the draft.

- `roundAmount(value, decimals)` returns `Number(Number(value).toFixed(decimals))`
  (`NaN` for a non-numeric value).
- `sumReceiptItems(items, decimals)` returns the rounded sum of the item
  amounts; a non-numeric amount counts as 0.
- `getReceiptItemsProblem(items, total, decimals)` returns `'invalid_amount'`
  when any item amount is not a finite number greater than zero, `'mismatch'`
  when the rounded sum differs from the rounded total (a non-numeric total is
  a mismatch), and `null` otherwise.
- `formatReceiptItemsAsNotes(items, decimals)` returns the lines
  `"<description> - <amount.toFixed(decimals)>"` joined by newlines.
- `expandReceiptItems(item, items, decimals)` returns `item` unchanged when
  `items` has fewer than two entries. Otherwise it returns a deep clone of
  `item` whose `attributes.transactions` is one clone of the first split per
  item, with `description` and `amount` (`Number(amount).toFixed(decimals)`)
  replaced, and whose `attributes.group_title` is the first split's
  description. Callers only expand items with no problem.

`getDraftDecimals(split)` in `useTransactionAssistantDraft.js` returns
`Account.getCurrencyDecimalPlaces(split.accountSource) ?? 2`. The draft split
has no `currency` object, so the source account's currency is the reference,
matching how `applyAssistantTransaction` rounds converted amounts.

Tests live in `front/tests/ReceiptItemUtils.test.js` and run with `npm test`
from `front/`, a new script `node --test 'tests/**/*.test.js'`. (A bare
directory argument, `node --test tests/`, fails on Node 21+, which treats it
as a module path.)

### Draft shape

A ramble draft keeps its single-split `item` (amount = receipt total) and
gains:

- `items`: the item array used to expand at preview and create time, or `[]`.
  Each item has an `id` (from `getGUID`) so editor rows have stable keys.
- `splitFallbackReason`: `null` or `'foreign_currency'`.

`buildReceiptDraft(item, rawItems, splitReceipts)` in
`useTransactionAssistantDraft.js` returns `{ item, items, splitFallbackReason }`:

1. `items = splitReceipts ? (rawItems ?? []).map(addId) : []`.
2. If `items.length >= 2` and the built item's first split has `amountForeign`
   set, reason is `'foreign_currency'`, the split's notes become
   `formatReceiptItemsAsNotes(items, decimals)` when empty, and the returned
   `items` is `[]`. (`currencyForeign` alone is not a signal: the empty
   transaction pre-fills it from the default foreign currency.)
3. Else if `items.length < 2`: when `items` has one entry and the split's
   notes are empty, notes become that line; the returned `items` is `[]` and
   the reason stays `null`.
4. Otherwise the items are kept as they are, mismatched or not. Problems are
   computed where they are shown, never stored.

`useRambleDrafts.interpret` calls it for every draft and stores `items` and
`splitFallbackReason` on the draft.

### Preview

`ramble-transaction-item.vue` computes `decimals = getDraftDecimals(split)` and
`itemsProblem = items.length > 0 ? getReceiptItemsProblem(items, amount, decimals) : null`.

- With items and no problem it renders
  `<transaction-list-item :value="expandReceiptItems(item, items, decimals)">`,
  so the existing split badge, split count and summed amount appear for free.
- With a problem it renders the single `item` and a `text-danger` line with
  `transaction.assistant_ramble_items_<problem>`. Tapping the row opens the
  editor as usual.
- When `splitFallbackReason` is set, a muted line shows
  `transaction.assistant_ramble_split_fallback_<reason>`.

### Editing

`ramble-transaction-edit-popup.vue` keeps `<transaction-form v-model="transaction.item">`
for the shared fields. Below it, when `transaction.items.length > 0`, it renders
the new `front/components/transaction/ramble/ramble-receipt-items.vue` with
`v-model="transaction.items"`, `:amount="transaction.item.attributes.transactions[0].amount"`
and `:decimals`.

`ramble-receipt-items.vue`:

- A `van-cell-group inset` titled `transaction.assistant_ramble_items`, one
  row per item keyed by `item.id`, with an `app-field` for the description, an
  `app-field` with `inputmode="decimal"` for the amount, and a delete icon
  button.
- A footer showing `assistant_ramble_items_total` with the rounded sum and,
  while it differs from `amount`, a `text-danger` line with
  `assistant_ramble_items_difference` and the signed difference. Then an
  "Add item" button (`assistant_ramble_add_item`, appends an empty item with a
  new id) and a "Merge into one transaction" button.
- The component never writes the amount. The receipt total and the items are
  both the user's to correct; the difference line tells them which.
- Deleting never merges automatically. If the user deletes every item, the
  editor disappears and the draft is a plain single transaction.
- Merge button: emits `merge`.

The popup handles `merge`: sets the split's notes to
`formatReceiptItemsAsNotes(items, decimals)` when notes are empty, then clears
`transaction.items`. The amount is left as it is.

On save in the popup, after the form validates: if `transaction.items.length > 0`
and `getReceiptItemsProblem(items, amount, decimals)` is not `null`, show the
toast `transaction.assistant_ramble_items_<problem>` and stay open.

`applyEditedDraft` in `useRambleDrafts` copies `items` alongside `item` and
sets `splitFallbackReason` to `null`.

### Create

In `useRambleDrafts.create`, a draft with items is first checked with
`getReceiptItemsProblem`. With a problem the draft is marked `error` with the
translated problem message and no request is sent; the loop continues with
the next draft and the existing retry flow lets the user fix and retry it.
Without a problem the request body becomes
`TransactionTransformer.transformToApi(expandReceiptItems(cloneDeep(draft.item), draft.items, decimals))`.

`TransactionTransformer.transformToApi` adds
`group_title: get(item, 'attributes.group_title')` to the returned object when
`transactions.length > 1`. Firefly III rejects a multi-split group without a
group title (`GroupValidation::validateGroupDescription`), so this is required
for the write to succeed. Single-split writes are unchanged: the key is
omitted. Side effect worth knowing: `transformFromApi` keeps
`attributes.group_title` from Firefly, so editing an existing split group on
the main transaction page now also sends its title back, which preserves it
instead of dropping it. The verification list covers that case.

Receipt attachment uses the first journal of the created group and matches
receipts by id, see Phase 1.

### i18n (phase 2)

New keys in all eleven locale files (`en`, `ro`, `zh-CN`, `it`, `pt-BR`,
`de-DE`, `fr`, `pl`, `ru-RU`, `es-MX`, `ko`):

- `settings.assistant.split_receipts`: "Split receipts into items by default"
- `transaction.assistant_ramble_items`: "Items"
- `transaction.assistant_ramble_items_total`: "Items total"
- `transaction.assistant_ramble_items_difference`: "Difference"
- `transaction.assistant_ramble_add_item`: "Add item"
- `transaction.assistant_ramble_merge_items`: "Merge into one transaction"
- `transaction.assistant_ramble_items_mismatch`: "The items do not add up to the amount"
- `transaction.assistant_ramble_items_invalid_amount`: "Every item needs an amount above zero"
- `transaction.assistant_ramble_split_fallback_foreign_currency`: "Receipts booked with a foreign amount are kept as one transaction with the items in notes"

Existing root keys `description`, `amount` and `delete` are reused. The root
`items` key is not used: its English value is lowercase.

## Docs and release

- `readme.md` receipt feature bullet: the camera button has its own popup and
  items can become splits.
- `CHANGELOG.md` gains a `0.2.4-dev6` section covering both phases.
- `config.yaml` version becomes `0.2.4-dev6`.
- `front/package.json` gains the `test` script.

## Out of scope

- Per-item category, budget or tags.
- Splitting receipts booked with a foreign amount.
- Creating or editing splits on the main transaction page.
- Combining dictated text and receipt photos in one interpretation.
- Backend validation of splits.

## Verification

The only automated tests are the Node tests for `ReceiptItemUtils.js`.
Everything else is verified by:

- `npm run lint`, `npm run build` and `npm test` from `front/`.
- Every changed locale file parses as JSON.
- Manual, Dictate popup regression: type a transaction, Interpret, edit, create;
  load and delete saved rambles; no camera button or thumbnails remain; the
  body shows the interpreting state while the request runs.
- Manual, receipt popup: tap the camera; the popup opens empty with the chip
  and Add photo. Add two photos; interpreting starts without a further tap and
  the body shows the interpreting state. Remove a photo, Scan again; add a
  photo with drafts present and confirm the re-scan prompt appears; decline
  and confirm nothing changed; accept and confirm it re-interprets. Create and
  confirm the right photo is attached in Firefly.
- Manual, chip on: scan a multi-item receipt whose items add up; the preview
  shows the split badge and item count; open the draft, change an item amount
  and see the difference line appear; add an item, delete an item; try to
  save with a difference and confirm the toast; fix it and save; merge and
  confirm notes are filled; re-scan and create; in Firefly the group has one
  journal per item, the merchant as group title, the receipt total as sum and
  the photo attached to the first journal.
- Manual, mismatch from the model: scan a receipt with a hand-written or
  unusual discount line (or edit an item in devtools); the preview shows the
  red mismatch line and no split badge; Create marks that draft as failed with
  the mismatch message and creates the others; fix it in the editor and retry.
- Manual, invalid amount: set an item amount to 0 in the editor; the save is
  blocked with the "above zero" toast.
- Manual, chip off: the same receipt produces one transaction with the items
  in notes, identical to today, and the POST body has no `group_title`.
- Manual, setting: Settings > Assistant toggle on; the chip starts on for the
  next scan; off again, the chip starts off.
- Manual, main page: open an existing split transaction from the list, save
  it without changes; Firefly keeps its group title.
- Manual, dark theme: the receipt strip, chip, item editor and popup header
  look right with the dark theme toggled.
