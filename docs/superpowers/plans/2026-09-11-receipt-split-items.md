# Receipt Scanning Popup and Split Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give receipt scanning its own popup, opened by the camera button, where the user chooses per scan whether items become splits before adding photos; photos are interpreted on pick. With splitting on, a receipt becomes one Firefly transaction group with one split per item whose amounts add up exactly to the total, and the user fixes any difference in the draft editor before creating.

**Architecture:** Phase 1 extracts the interpret/create/attach machinery from `ramble.vue` into `useRambleDrafts.js` and a shell component `ramble-drafts-popup.vue`, then adds `receipt-scan.vue` on top of the shell and removes photos from the Dictate popup. Phase 2 adds an assistant setting that seeds the per-scan chip, an `items` array in the assistant prompt and response, pure helpers with exact reconciliation, a preview that shows the split badge or the problem, an item editor with add/delete/merge and a difference line, a create guard, and `group_title` on multi-split writes.

**Tech Stack:** Nuxt 3 (SSR off), Vue 3 `<script setup>`, Pinia composition stores, Vant 4, lodash-es, Node built-in test runner for pure helpers (Node 23 installed). Plain `.js` and `.vue`; no TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-11-receipt-split-items-design.md`

## Global Constraints

- Work on branch `feature/receipt-split-items` (already cut from `dev`). Never merge; keep linear history.
- Prettier is the source of truth: single quotes, no semicolons, trailing commas, 2-space indent, `printWidth: 200`. Write code that already matches; do not run `npm run lint:fix` on unrelated files.
- Only `.js` and `.vue`. Vue components use `<script setup>`, `defineModel()`, and Nuxt auto-imports (`ref`, `computed`, `useI18n`, `useProfileStore`, `useAppStore`, `navigateTo` need no import; explicit imports of `ref`/`computed` from `vue` are also accepted and common in this repo).
- UI-kit and page components use kebab-case filenames. Composables use `useXxx.js`.
- Every new user-visible string gets a key in all eleven locale files under `front/i18n/locales/`: `en.json`, `ro.json`, `zh-CN.json`, `it.json`, `pt-BR.json`, `de-DE.json`, `fr.json`, `pl.json`, `ru-RU.json`, `es-MX.json`, `ko.json`. Translate to the target language; when unsure, an English value is acceptable, but the key must exist.
- Any new class with hardcoded light colours needs a `.van-theme-dark` override in `front/assets/styles/theme-dark.css`. Prefer CSS variables and existing helper classes so no override is needed.
- Verification commands run from `front/`: `npm run lint`, `npm run build`, `npm test` (added in Task 6; it runs `node --test 'tests/**/*.test.js'`; a bare `node --test tests/` fails on Node 21+ because the directory is treated as a module path). There is no other test runner; do not add one.
- JSON parse check, run from the repo root after every locale change:
  `for f in front/i18n/locales/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BROKEN $f"; done`
  Expected: no `BROKEN` lines.
- Commit after every task with a short imperative subject line and this trailer:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- Every merge to `main` needs a `config.yaml` version bump and a `CHANGELOG.md` entry; this branch targets `dev`, so the bump is `0.2.4-dev6` (Task 10).

---

## File map

Phase 1 (receipt popup):

- Create `front/composables/useRambleDrafts.js` — drafts state, interpret, create, attach by receipt id, edit, remove, reset.
- Create `front/components/transaction/ramble/ramble-drafts-popup.vue` — popup shell: header, slot, interpreting state, drafts list, footer, edit popup.
- Modify `front/components/transaction/ramble.vue` — thin Dictate wrapper.
- Modify `front/components/transaction/ramble/ramble-input-card.vue` — remove receipts.
- Create `front/components/transaction/ramble/ramble-receipt-strip.vue` — split chip, thumbnails, add, scan again.
- Create `front/components/transaction/receipt-scan.vue` — camera trigger opens the popup, file input, preparation, auto-interpret, re-scan confirmation.
- Modify `front/components/transaction/transaction-assistant.vue` — mount `receipt-scan`.
- Modify all eleven locale files — ten phase-1 keys.

Phase 2 (splits):

- Modify `front/stores/profileStore.js` and `front/pages/settings/assistant.vue` — setting (default off).
- Modify `front/repository/AssistantRepository.js` — prompt, normaliser, `splitReceipts`.
- Create `front/utils/ReceiptItemUtils.js` and `front/tests/ReceiptItemUtils.test.js`; add the `test` script to `front/package.json`.
- Modify `front/composables/useTransactionAssistantDraft.js` — `getDraftDecimals`, `buildReceiptDraft`.
- Modify `front/composables/useRambleDrafts.js` — items on drafts, problem guard and expand on create.
- Modify `front/transformers/TransactionTransformer.js` — `group_title`.
- Modify `front/components/transaction/ramble/ramble-transaction-item.vue` — expanded preview or problem line, fallback line.
- Create `front/components/transaction/ramble/ramble-receipt-items.vue` — item editor.
- Modify `front/components/transaction/ramble/ramble-transaction-edit-popup.vue` — editor, merge, save guard.
- Modify all eleven locale files — nine phase-2 keys.
- Modify `readme.md`, `CHANGELOG.md`, `config.yaml`.

---

### Task 1: Extract `useRambleDrafts` from `ramble.vue`

**Files:**
- Create: `front/composables/useRambleDrafts.js`
- Modify: `front/components/transaction/ramble.vue` (script: lines 106-608)

**Interfaces:**
- Consumes: `AssistantRepository.interpretTransactions(data)`, `TransactionRepository.insert(requestData)`, `AttachmentRepository.uploadForTransaction(journalId, file)`, `TransactionTransformer.transformToApi(item)`, `useRambleTransactionResolver()`, `useTransactionAssistantDraft()`.
- Produces: `draftStatus` and `useRambleDrafts()` exactly as below. Task 2 renders from it; Task 7 extends `interpret`, `create` and `applyEditedDraft`.
- Behaviour differences from today, both intentional: `interpret` accepts `splitReceipts` and forwards it in the request data (ignored by the repository until Task 5), and every draft records `receiptIds` so attachments are matched by receipt id instead of array position.

- [ ] **Step 1: Create the composable**

Write `front/composables/useRambleDrafts.js`:

```js
import { cloneDeep, get } from 'lodash-es'
import { computed, ref } from 'vue'
import AssistantRepository from '~/repository/AssistantRepository.js'
import AttachmentRepository from '~/repository/AttachmentRepository.js'
import TransactionRepository from '~/repository/TransactionRepository.js'
import TransactionTransformer from '~/transformers/TransactionTransformer.js'
import { useRambleTransactionResolver } from '~/composables/useRambleTransactionResolver.js'
import { useTransactionAssistantDraft } from '~/composables/useTransactionAssistantDraft.js'
import UIUtils from '~/utils/UIUtils.js'

export const draftStatus = {
  pending: 'pending',
  creating: 'creating',
  success: 'success',
  error: 'error',
}

const isResponseSuccessful = (response) => response?.status >= 200 && response?.status < 300

const getInterpretErrorMessage = (error) => {
  return error?.response?.data?.error?.message ?? error?.response?.data?.message ?? error?.message ?? 'Assistant LLM request failed.'
}

const getCreateErrorMessage = (error) => {
  return (
    error?.data?.payload?.message ??
    error?.response?.data?.payload?.message ??
    error?.response?.data?.message ??
    error?.response?.data?.error?.message ??
    error?.data?.message ??
    error?.message ??
    'Failed to create transaction.'
  )
}

// The assistant answers with photo positions; ids survive the user removing a photo, positions do not.
const getReceiptIds = (transaction, receipts) => {
  return (transaction.raw?.receiptIndexes ?? []).map((index) => receipts[index]?.id).filter(Boolean)
}

// Interpretation, preview and creation of assistant drafts, independent of where the input came from (dictated text or receipt photos).
export const useRambleDrafts = () => {
  const { t } = useI18n()
  const profileStore = useProfileStore()
  const assistantRepository = new AssistantRepository()
  const transactionRepository = new TransactionRepository()
  const { getRambleContext, resolveRambleTransaction } = useRambleTransactionResolver()
  const { buildTransactionItemFromAssistant } = useTransactionAssistantDraft()

  const drafts = ref([])
  const isInterpreting = ref(false)
  const isCreating = ref(false)
  const hasInterpreted = ref(false)
  const error = ref('')
  const currentCreateIndex = ref(0)
  // Bumped on reset so a request that finishes after the popup closed cannot write stale state.
  const sessionId = ref(0)

  const createdCount = computed(() => drafts.value.filter((draft) => draft.status === draftStatus.success).length)
  const failedCount = computed(() => drafts.value.filter((draft) => draft.status === draftStatus.error).length)
  const processedCount = computed(() => createdCount.value + failedCount.value)
  const createButtonCount = computed(() => drafts.value.filter((draft) => draft.status !== draftStatus.success).length)
  const hasCreateProgress = computed(() => isCreating.value || processedCount.value > 0)
  const createProgressPercentage = computed(() => (drafts.value.length === 0 ? 0 : Math.round((processedCount.value / drafts.value.length) * 100)))

  const createProgressLabel = computed(() => {
    if (isCreating.value) {
      return t('transaction.assistant_ramble_progress_creating', { current: currentCreateIndex.value, total: drafts.value.length })
    }
    if (failedCount.value > 0) {
      return t('transaction.assistant_ramble_progress_failed', { created: createdCount.value, total: drafts.value.length, failed: failedCount.value })
    }
    return t('transaction.assistant_ramble_progress', { created: createdCount.value, total: drafts.value.length })
  })

  const createButtonLabel = computed(() => {
    if (failedCount.value > 0) {
      return t('transaction.assistant_ramble_retry_failed', { count: createButtonCount.value })
    }
    return t('transaction.assistant_ramble_create', { count: createButtonCount.value })
  })

  const reset = () => {
    sessionId.value += 1
    drafts.value = []
    isInterpreting.value = false
    isCreating.value = false
    hasInterpreted.value = false
    error.value = ''
    currentCreateIndex.value = 0
  }

  const interpret = async ({ text = '', savedRambles = [], receipts = [], splitReceipts = false }) => {
    const hasSavedText = savedRambles.some((ramble) => ramble.text?.trim())
    if (!text.trim() && !hasSavedText && receipts.length === 0) {
      return
    }

    const session = sessionId.value
    isInterpreting.value = true
    hasInterpreted.value = false
    error.value = ''

    try {
      const response = await assistantRepository.interpretTransactions({
        text: text.trim(),
        savedRambles: savedRambles.map((ramble) => ({ text: ramble.text, createdAt: ramble.created_at })),
        now: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: profileStore.language,
        externalContext: profileStore.assistantLlmContext,
        model: profileStore.assistantLlmModel,
        context: getRambleContext(),
        receiptImages: receipts.map((receipt) => receipt.dataUrl),
        splitReceipts,
      })
      if (session !== sessionId.value) {
        return
      }

      const newDrafts = []
      for (const transaction of (response.transactions ?? []).map(resolveRambleTransaction)) {
        if (session !== sessionId.value) {
          return
        }
        newDrafts.push({
          id: transaction.id,
          assistant: transaction,
          item: await buildTransactionItemFromAssistant(transaction),
          receiptIds: getReceiptIds(transaction, receipts),
          status: draftStatus.pending,
          error: null,
          response: null,
        })
      }

      drafts.value = newDrafts
      hasInterpreted.value = true
    } catch (requestError) {
      if (session !== sessionId.value) {
        return
      }
      drafts.value = []
      error.value = getInterpretErrorMessage(requestError)
      hasInterpreted.value = true
    } finally {
      if (session === sessionId.value) {
        isInterpreting.value = false
      }
    }
  }

  const removeDraft = (draft) => {
    drafts.value = drafts.value.filter((existing) => existing.id !== draft.id)
  }

  const applyEditedDraft = (editedDraft) => {
    const index = drafts.value.findIndex((draft) => draft.id === editedDraft.id)
    if (index < 0) {
      return
    }
    const existing = drafts.value[index]
    const keepsSuccess = existing.status === draftStatus.success
    drafts.value[index] = {
      ...existing,
      item: cloneDeep(editedDraft.item),
      status: keepsSuccess ? draftStatus.success : draftStatus.pending,
      error: keepsSuccess ? existing.error : null,
    }
  }

  const getReceiptsForDraft = (draft, receipts) => {
    const matched = receipts.filter((receipt) => (draft.receiptIds ?? []).includes(receipt.id))
    if (matched.length > 0) {
      return matched
    }
    // Without usable ids, the fallback covers only the unambiguous single-draft case, where every photo belongs to it.
    return drafts.value.length === 1 ? receipts : []
  }

  const attachReceipts = async (draft, receipts) => {
    const journalId = get(draft.response, 'data.data.attributes.transactions.0.transaction_journal_id')
    if (!journalId) {
      return
    }
    for (const receipt of getReceiptsForDraft(draft, receipts)) {
      try {
        await new AttachmentRepository().uploadForTransaction(journalId, receipt.file)
      } catch {
        // Blob API failure, not an axios error; the transaction exists, the attachment is best effort.
      }
    }
  }

  const create = async ({ receipts = [] } = {}) => {
    const session = sessionId.value
    const toCreate = drafts.value.filter((draft) => draft.status !== draftStatus.success)
    if (toCreate.length === 0) {
      return { successCount: 0, failedCount: failedCount.value }
    }

    isCreating.value = true
    error.value = ''
    let successCount = 0

    try {
      for (const draft of toCreate) {
        if (session !== sessionId.value) {
          return { successCount, failedCount: failedCount.value }
        }
        const index = drafts.value.findIndex((existing) => existing.id === draft.id)
        if (index < 0) {
          continue
        }

        currentCreateIndex.value = index + 1
        drafts.value[index].status = draftStatus.creating
        drafts.value[index].error = null

        try {
          const requestData = TransactionTransformer.transformToApi(cloneDeep(drafts.value[index].item))
          const response = await transactionRepository.insert(requestData)
          if (session !== sessionId.value) {
            return { successCount, failedCount: failedCount.value }
          }

          if (isResponseSuccessful(response)) {
            drafts.value[index].status = draftStatus.success
            drafts.value[index].response = response
            successCount += 1
            await attachReceipts(drafts.value[index], receipts)
            continue
          }

          drafts.value[index].status = draftStatus.error
          drafts.value[index].error = getCreateErrorMessage(response)
        } catch (createError) {
          if (session !== sessionId.value) {
            return { successCount, failedCount: failedCount.value }
          }
          drafts.value[index].status = draftStatus.error
          drafts.value[index].error = getCreateErrorMessage(createError)
        }
      }

      if (successCount > 0) {
        UIUtils.showToastSuccess(t('transaction.assistant_ramble_created_toast', successCount))
      }
      return { successCount, failedCount: failedCount.value }
    } finally {
      if (session === sessionId.value) {
        currentCreateIndex.value = 0
        isCreating.value = false
      }
    }
  }

  return {
    drafts,
    isInterpreting,
    isCreating,
    hasInterpreted,
    error,
    currentCreateIndex,
    createdCount,
    failedCount,
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
  }
}
```

- [ ] **Step 2: Make `ramble.vue` use the composable**

In `front/components/transaction/ramble.vue`, keep the template as is for now and rewrite the script so that the draft state comes from the composable. Replace the whole `<script setup>` block with:

```js
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
```

The template needs no change: it already binds `rambleTransactions`, `isInterpreting`, `isCreatingRambleTransactions`, `hasInterpreted`, `rambleError`, `hasCreateProgress`, `createProgressPercentage`, `createProgressLabel`, `createButtonLabel`, `createButtonCount`, `interpretRambleText`, `removeRambleTransaction`, `openRambleTransaction`, `onRambleTransactionEdited` and `createRambleTransactions`.

- [ ] **Step 3: Lint and build**

Run from `front/`:

```bash
npm run lint && npm run build
```

Expected: both succeed with no errors. If ESLint reports unused imports in `ramble.vue` (for example `get`, `AttachmentRepository`, `TransactionRepository`, `TransactionTransformer`, `useRambleTransactionResolver`, `useTransactionAssistantDraft`), remove them; they moved into the composable.

- [ ] **Step 4: Manual check**

Run `npm run dev` from `front/`, open the transaction page, and in the Dictate popup: type "coffee 12", Interpret, open the draft, change the description, Save, Create. Expected: one transaction is created, the popup closes, the list page opens. Also confirm the success toast and progress bar still appear. Scan two receipts, remove the first photo, Create: the remaining photo is attached to the right transaction (or none is attached if it belonged to the removed one).

- [ ] **Step 5: Commit**

```bash
git add front/composables/useRambleDrafts.js front/components/transaction/ramble.vue
git commit -m "extract assistant draft handling into useRambleDrafts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Extract the popup shell `ramble-drafts-popup.vue`

**Files:**
- Create: `front/components/transaction/ramble/ramble-drafts-popup.vue`
- Modify: `front/components/transaction/ramble.vue`
- Modify: all eleven locale files (one key)

**Interfaces:**
- Consumes: `useRambleDrafts()` from Task 1, `ramble-transaction-item.vue`, `ramble-transaction-edit-popup.vue`, `useSwipeToDismiss`.
- Produces: component `RambleDraftsPopup` with props `icon`, `title`, `subtitle`, `emptyHint`, `receipts`; model `show`; default slot with slot prop `isInterpreting`; exposed `interpret(payload)`, `reset()` and `hasDrafts`; emit `created`. Tasks 3 and 4 render it.

- [ ] **Step 1: i18n for the interpreting state**

In every locale file, inside `"transaction"`, add directly after `"assistant_ramble_receipt_limit"`:

```json
    "assistant_ramble_interpreting": "Interpreting…",
```

Suggested translations: ro "Se interpretează…"; de-DE "Wird ausgewertet…"; fr "Interprétation…"; it "Interpretazione…"; es-MX "Interpretando…"; pt-BR "Interpretando…"; pl "Interpretowanie…"; ru-RU "Распознавание…"; zh-CN "正在识别…"; ko "해석 중…".

Run the JSON parse check from the global constraints.

- [ ] **Step 2: Create the shell**

Write `front/components/transaction/ramble/ramble-drafts-popup.vue`:

```vue
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
const { drafts, isInterpreting, isCreating, hasInterpreted, error, createButtonCount, hasCreateProgress, createProgressPercentage, createProgressLabel, createButtonLabel, interpret, create, removeDraft, applyEditedDraft, reset } =
  useRambleDrafts()

const popupRef = ref(null)
const popupContentRef = ref(null)
const showEditPopup = ref(false)
const editingDraft = ref(null)
const hasDrafts = computed(() => drafts.value.length > 0)

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
  hasDrafts,
})
</script>
```

- [ ] **Step 3: Reduce `ramble.vue` to a wrapper around the shell**

Replace the whole `<template>` of `front/components/transaction/ramble.vue` with:

```vue
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

  <ramble-drafts-popup
    ref="draftsPopupRef"
    v-model:show="showRamblePopup"
    :icon="TablerIconConstants.ramble"
    :title="$t('transaction.assistant_ramble_title')"
    :subtitle="savedRamblesCount > 0 ? $t('transaction.assistant_ramble_saved_count', { count: savedRamblesCount }) : $t('transaction.assistant_ramble_input_hint')"
    :empty-hint="$t('transaction.assistant_ramble_no_transactions_yet')"
    :receipts="rambleReceipts"
    @created="onCreated"
  >
    <template #default="{ isInterpreting }">
      <ramble-input-card
        ref="inputCardRef"
        v-model="rambleText"
        v-model:receipts="rambleReceipts"
        :saved-rambles="savedRambles"
        :saved-rambles-count="savedRamblesCount"
        :is-loading-saved="isLoadingSavedRambles"
        :is-deleting-saved="isDeletingLoadedSavedRambles"
        :is-interpreting="isInterpreting"
        :is-disabled="isInterpreting"
        :is-preparing-receipts="isPreparingReceipts"
        :max-receipts="maxReceipts"
        @interpret="interpretRambleText"
        @add-receipt="receiptInputRef?.click()"
        @load-saved="fetchSavedRambles"
        @delete-saved="deleteLoadedSavedRambles"
        @delete-ramble="deleteSavedRamble"
      />
    </template>
  </ramble-drafts-popup>
</template>
```

Then in the script: remove the `useRambleDrafts` destructuring, `useSwipeToDismiss` call, `ramblePopupStyle`, `isRambleFormDisabled`, `popupRef`, `popupContentRef`, `showRambleTransactionPopup`, `editingRambleTransaction`, `openRambleTransaction`, `onRambleTransactionEdited`, `createRambleTransactions`, and the imports of `cloneDeep`, `RambleTransactionItem`, `RambleTransactionEditPopup`, `useRambleDrafts`, `draftStatus`, `useSwipeToDismiss` (keep `computed`: `hasLoadedSavedRambles` still uses it). Add `import RambleDraftsPopup from '~/components/transaction/ramble/ramble-drafts-popup.vue'` and `const draftsPopupRef = ref(null)`. Replace `interpretRambleText`, `resetRamble` and the create handler with:

```js
const interpretRambleText = () => {
  return draftsPopupRef.value?.interpret({ text: rambleText.value, savedRambles: savedRambles.value, receipts: rambleReceipts.value })
}

const resetRamble = () => {
  rambleSessionId.value += 1
  rambleText.value = ''
  rambleReceipts.value = []
  savedRambles.value = []
  loadedSavedRambleIds.value = []
  isLoadingSavedRambles.value = false
  isDeletingLoadedSavedRambles.value = false
}

const onCreated = async () => {
  const sessionId = rambleSessionId.value
  const savedRamblesDeleted = !hasLoadedSavedRambles.value || (await deleteLoadedSavedRambles({ confirm: false }))
  if (sessionId !== rambleSessionId.value) {
    return
  }
  if (!savedRamblesDeleted) {
    UIUtils.showToastError('Transactions were created, but saved rambles could not be deleted.')
    return
  }

  closeRamblePopup()
  await navigateTo(RouteConstants.ROUTE_TRANSACTION_LIST)
}
```

Keep `import { computed, onMounted, ref, watch } from 'vue'`.

- [ ] **Step 4: Lint and build**

Run from `front/`:

```bash
npm run lint && npm run build
```

Expected: success. Fix any unused-variable report by deleting the variable.

- [ ] **Step 5: Manual check**

Dictate flow as in Task 1 Step 4, plus: open the popup with no text and confirm the empty state shows "No transactions yet"; press Interpret and confirm the body shows the spinner with "Interpreting…" until the drafts appear; interpret nonsense text and confirm "No transactions found"; swipe down on mobile width closes the popup; closing and reopening shows a clean state.

- [ ] **Step 6: Commit**

```bash
git add front/components/transaction/ramble/ramble-drafts-popup.vue front/components/transaction/ramble.vue front/i18n/locales/
git commit -m "extract the assistant drafts popup shell

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Receipt popup, receipt strip, and i18n

**Files:**
- Create: `front/components/transaction/ramble/ramble-receipt-strip.vue`
- Create: `front/components/transaction/receipt-scan.vue`
- Modify: `front/components/transaction/transaction-assistant.vue:24` and `:58`
- Modify: `front/components/transaction/ramble.vue`, `front/components/transaction/ramble/ramble-input-card.vue`
- Modify: all eleven files in `front/i18n/locales/`

**Interfaces:**
- Consumes: `RambleDraftsPopup` from Task 2 (including exposed `hasDrafts`); `compressImageToJpeg`, `blobToDataUrl` from `~/utils/ImageUtils.js`; `getGUID` from `~/utils/Utils.js`; `profileStore.assistantSplitReceipts` (undefined until Task 4, coerced to `false`).
- Produces: `receipt-scan.vue` mounted next to `<ramble>`; nothing later depends on its internals.

- [ ] **Step 1: Add the phase-1 i18n keys**

In every locale file, inside the `"transaction": { ... }` object, add these nine keys directly after `"assistant_ramble_interpreting"`. English values (translate for the other locales; keep the key names identical):

```json
    "assistant_receipt_title": "Scan receipts",
    "assistant_receipt_hint": "Photos are read and turned into transactions",
    "assistant_receipt_empty": "Add a receipt photo to start",
    "assistant_receipt_add": "Add photo",
    "assistant_receipt_scan": "Scan again",
    "assistant_receipt_split": "Split into items",
    "assistant_receipt_split_hint": "Choose before adding photos",
    "assistant_receipt_rescan_title": "Scan again?",
    "assistant_receipt_rescan_message": "The current drafts and any edits to them will be replaced.",
```

Suggested translations:

| Locale | title | hint | empty | add | scan |
|---|---|---|---|---|---|
| ro | Scanează bonuri | Fotografiile sunt citite și transformate în tranzacții | Adaugă o poză cu bonul pentru a începe | Adaugă poză | Scanează din nou |
| de-DE | Belege scannen | Fotos werden gelesen und in Buchungen umgewandelt | Füge ein Belegfoto hinzu, um zu starten | Foto hinzufügen | Erneut scannen |
| fr | Scanner des reçus | Les photos sont lues et transformées en transactions | Ajoutez une photo de reçu pour commencer | Ajouter une photo | Scanner à nouveau |
| it | Scansiona scontrini | Le foto vengono lette e trasformate in transazioni | Aggiungi una foto dello scontrino per iniziare | Aggiungi foto | Scansiona di nuovo |
| es-MX | Escanear recibos | Las fotos se leen y se convierten en transacciones | Agrega una foto del recibo para empezar | Agregar foto | Escanear de nuevo |
| pt-BR | Escanear recibos | As fotos são lidas e transformadas em transações | Adicione uma foto do recibo para começar | Adicionar foto | Escanear novamente |
| pl | Skanuj paragony | Zdjęcia są odczytywane i zamieniane na transakcje | Dodaj zdjęcie paragonu, aby zacząć | Dodaj zdjęcie | Skanuj ponownie |
| ru-RU | Сканировать чеки | Фотографии распознаются и превращаются в транзакции | Добавьте фото чека, чтобы начать | Добавить фото | Сканировать снова |
| zh-CN | 扫描小票 | 照片会被识别并转换为交易 | 添加一张小票照片开始 | 添加照片 | 重新扫描 |
| ko | 영수증 스캔 | 사진을 읽어 거래로 변환합니다 | 영수증 사진을 추가해 시작하세요 | 사진 추가 | 다시 스캔 |

| Locale | split | split_hint | rescan_title | rescan_message |
|---|---|---|---|---|
| ro | Împarte pe articole | Alege înainte de a adăuga poze | Scanezi din nou? | Ciornele curente și modificările lor vor fi înlocuite. |
| de-DE | In Artikel aufteilen | Vor dem Hinzufügen der Fotos wählen | Erneut scannen? | Die aktuellen Entwürfe und ihre Änderungen werden ersetzt. |
| fr | Diviser en articles | À choisir avant d'ajouter les photos | Scanner à nouveau ? | Les brouillons actuels et leurs modifications seront remplacés. |
| it | Dividi in articoli | Scegli prima di aggiungere le foto | Scansionare di nuovo? | Le bozze attuali e le loro modifiche verranno sostituite. |
| es-MX | Dividir en artículos | Elige antes de agregar fotos | ¿Escanear de nuevo? | Los borradores actuales y sus cambios se reemplazarán. |
| pt-BR | Dividir em itens | Escolha antes de adicionar fotos | Escanear novamente? | Os rascunhos atuais e suas edições serão substituídos. |
| pl | Podziel na pozycje | Wybierz przed dodaniem zdjęć | Skanować ponownie? | Bieżące szkice i ich zmiany zostaną zastąpione. |
| ru-RU | Разбить на позиции | Выберите до добавления фото | Сканировать снова? | Текущие черновики и их правки будут заменены. |
| zh-CN | 拆分为商品 | 请在添加照片前选择 | 重新扫描？ | 当前草稿及其修改将被替换。 |
| ko | 항목별로 분할 | 사진을 추가하기 전에 선택하세요 | 다시 스캔할까요? | 현재 초안과 수정 내용이 교체됩니다. |

Run the JSON parse check.

- [ ] **Step 2: Create the receipt strip**

Write `front/components/transaction/ramble/ramble-receipt-strip.vue`:

```vue
<template>
  <van-cell-group inset class="no-margin overflow-hidden">
    <div class="p-3 display-flex flex-column gap-2">
      <div class="flex-center-vertical flex-wrap gap-2">
        <van-tag round size="medium" :type="splitItems ? 'primary' : 'default'" :plain="!splitItems" class="cursor-pointer assistant-tag" @click="onToggleSplit">
          <app-icon :icon="TablerIconConstants.list" :size="14" />
          <span>{{ $t('transaction.assistant_receipt_split') }}</span>
        </van-tag>
        <div class="text-size-12 text-muted">{{ $t('transaction.assistant_receipt_split_hint') }}</div>
      </div>

      <div v-if="receipts.length > 0" class="display-flex flex-wrap gap-2">
        <div v-for="receipt in receipts" :key="receipt.id" class="ramble-receipt-thumb">
          <img :src="receipt.dataUrl" :alt="$t('transaction.assistant_ramble_receipt')" />
          <van-button round size="mini" type="danger" class="cursor-pointer ramble-receipt-remove" :disabled="isDisabled" :title="$t('delete')" @click="removeReceipt(receipt)">
            <app-icon :icon="TablerIconConstants.close" :size="12" />
          </van-button>
        </div>
      </div>

      <div class="flex-center-vertical flex-wrap gap-2">
        <van-button v-if="receipts.length < maxReceipts" round size="small" plain class="cursor-pointer" :loading="isPreparing" :disabled="isDisabled" @click="emit('add')">
          <app-icon :icon="TablerIconConstants.camera" :size="16" />
          {{ $t('transaction.assistant_receipt_add') }}
        </van-button>

        <div class="flex-1" />

        <van-button round size="small" class="cursor-pointer ramble-interpret-button" :disabled="isDisabled || receipts.length === 0" @click="emit('scan')">
          <app-icon :icon="TablerIconConstants.magic" :size="16" />
          {{ $t('transaction.assistant_receipt_scan') }}
        </van-button>
      </div>
    </div>
  </van-cell-group>
</template>

<script setup>
import TablerIconConstants from '~/constants/TablerIconConstants.js'

const props = defineProps({
  splitItems: {
    type: Boolean,
    default: false,
  },
  maxReceipts: {
    type: Number,
    default: 0,
  },
  isPreparing: {
    type: Boolean,
    default: false,
  },
  isDisabled: {
    type: Boolean,
    default: false,
  },
})

// The chip is a plain prop plus an event so the parent can refuse a toggle (declined re-scan confirmation) without a revert dance.
const emit = defineEmits(['add', 'scan', 'toggleSplit'])
const receipts = defineModel({ type: Array, default: () => [] })

const onToggleSplit = () => {
  if (!props.isDisabled) {
    emit('toggleSplit')
  }
}

const removeReceipt = (receipt) => {
  receipts.value = receipts.value.filter((item) => item.id !== receipt.id)
}
</script>
```

- [ ] **Step 3: Create the receipt popup component**

Write `front/components/transaction/receipt-scan.vue`:

```vue
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

// A re-scan replaces the drafts and any edits made to them, so it is confirmed whenever drafts exist.
const confirmRescan = async () => {
  if (!popupRef.value?.hasDrafts) {
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
```

- [ ] **Step 4: Mount it and remove receipts from the Dictate flow**

In `front/components/transaction/transaction-assistant.vue`, after `<ramble :assistant-text="assistantText" />` add `<receipt-scan />`, and after the `Ramble` import add `import ReceiptScan from '~/components/transaction/receipt-scan.vue'`.

In `front/components/transaction/ramble.vue`: delete the camera `van-button` and the hidden `<input>` from the template; delete the `:receipts`, `v-model:receipts`, `:is-preparing-receipts`, `:max-receipts` and `@add-receipt` bindings; delete `rambleReceipts`, `maxReceipts`, `receiptInputRef`, `isPreparingReceipts`, `onReceiptsSelected`, the `rambleReceipts.value = []` line in `resetRamble`, and the imports of `compressImageToJpeg`, `blobToDataUrl`, `getGUID`. `interpretRambleText` becomes:

```js
const interpretRambleText = () => {
  return draftsPopupRef.value?.interpret({ text: rambleText.value, savedRambles: savedRambles.value })
}
```

In `front/components/transaction/ramble/ramble-input-card.vue`: delete the camera `van-button` (the one with `emit('addReceipt')`), the thumbnail `div` (`v-if="receipts.length > 0"`), the `isPreparingReceipts` and `maxReceipts` props, `'addReceipt'` from `defineEmits`, the `receipts` model, and `removeReceipt`. Change `canInterpret` to:

```js
const canInterpret = computed(() => !!rambleText.value.trim() || props.savedRambles.length > 0)
```

- [ ] **Step 5: Lint and build**

```bash
npm run lint && npm run build
```

Expected: success.

- [ ] **Step 6: Manual check**

With the LLM configured: two buttons next to the assistant field (dictate, camera). Tap the camera. Expected: the receipt popup opens empty with the chip (off), the hint, Add photo and a disabled Scan again. Add a receipt photo: the thumbnail appears and interpreting starts without another tap, the body shows "Interpreting…", then a draft appears. Tap the chip with drafts present: the confirmation appears; decline and the chip stays as it was; accept and it re-interprets. Add a second photo: the confirmation appears again. Create attaches the right photo (check the transaction's attachments in Firefly). Remove the photo, confirm Scan again is disabled. Open the Dictate popup and confirm no camera button or thumbnails remain, and that text interpretation still works. Check dark theme, including the chip in both states.

- [ ] **Step 7: Commit**

```bash
git add front/components/transaction/receipt-scan.vue front/components/transaction/ramble/ramble-receipt-strip.vue front/components/transaction/ramble.vue front/components/transaction/ramble/ramble-input-card.vue front/components/transaction/transaction-assistant.vue front/i18n/locales/
git commit -m "move receipt scanning into its own popup that interprets on pick

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Assistant setting `assistantSplitReceipts`

**Files:**
- Modify: `front/stores/profileStore.js:26-30` and the returned object around line 182
- Modify: `front/pages/settings/assistant.vue:9`, `:173`, `:196`
- Modify: all eleven locale files, `settings.assistant` object

**Interfaces:**
- Produces: `profileStore.assistantSplitReceipts` (boolean, default `false`). Read by `receipt-scan.vue` (Task 3) to seed the chip.

- [ ] **Step 1: Store field**

In `front/stores/profileStore.js`, after `const assistantLlmModel = useLocalStorage('assistantLlmModel', '')` add:

```js
  const assistantSplitReceipts = useLocalStorage('assistantSplitReceipts', false)
```

and in the returned object, after `assistantLlmModel,` add `assistantSplitReceipts,`. Profile persistence serialises the whole state, so nothing else is needed.

- [ ] **Step 2: Settings toggle**

In `front/pages/settings/assistant.vue`, after the `auto_focus` `app-boolean` line add:

```vue
        <app-boolean v-model="assistantSplitReceipts" :label="$t('settings.assistant.split_receipts')" />
```

After `const autoFocusAssistant = ref(false)` add `const assistantSplitReceipts = ref(false)`. In `syncedSettings` add:

```js
  { store: profileStore, path: 'assistantSplitReceipts', ref: assistantSplitReceipts },
```

- [ ] **Step 3: i18n**

In every locale file, inside `"settings": { "assistant": { ... } }`, add after `"auto_focus"`:

```json
      "split_receipts": "Split receipts into items by default",
```

Suggested translations: ro "Împarte bonurile pe articole în mod implicit"; de-DE "Belege standardmäßig in Artikel aufteilen"; fr "Diviser les reçus en articles par défaut"; it "Dividi gli scontrini in articoli per impostazione predefinita"; es-MX "Dividir recibos en artículos de forma predeterminada"; pt-BR "Dividir recibos em itens por padrão"; pl "Domyślnie dziel paragony na pozycje"; ru-RU "Разбивать чеки на позиции по умолчанию"; zh-CN "默认将小票拆分为商品"; ko "기본적으로 영수증을 항목별로 분할".

Run the JSON parse check.

- [ ] **Step 4: Lint, build, manual**

```bash
npm run lint && npm run build
```

Manual: Settings > Assistant shows the toggle off by default; turn it on and save; open the receipt popup and the chip starts on; turn it off and the chip starts off. The chip can still be toggled per scan either way.

- [ ] **Step 5: Commit**

```bash
git add front/stores/profileStore.js front/pages/settings/assistant.vue front/i18n/locales/
git commit -m "add the split receipts assistant setting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Prompt and response shape for receipt items

**Files:**
- Modify: `front/repository/AssistantRepository.js:5-35` (prompt), `:60-100` (normaliser), `:154-190` (`interpretTransactions`)

**Interfaces:**
- Produces: `interpretTransactions(data)` accepts `data.splitReceipts` (boolean); every normalised transaction has `items: [{ description: string, amount: number }]`. Task 7 reads `raw.items`.

- [ ] **Step 1: Prompt builder signature and shape**

Change the signature to `const getInterpretationPrompt = ({ hasReceipts, splitReceipts }) =>` and replace the shape line so there are three variants:

```js
    hasReceipts && splitReceipts
      ? '{"amount": number|null, "currencyCode": string|null, "description": string, "tagNames": string[], "categoryName": string|null, "templateName": string|null, "budgetName": string|null, "sourceAccountName": string|null, "destinationAccountName": string|null, "type": "expense|income|transfer|null", "occurredAt": string|null, "notes": string|null, "receiptIndexes": number[], "items": [{"description": string, "amount": number}]}'
      : hasReceipts
        ? '{"amount": number|null, "currencyCode": string|null, "description": string, "tagNames": string[], "categoryName": string|null, "templateName": string|null, "budgetName": string|null, "sourceAccountName": string|null, "destinationAccountName": string|null, "type": "expense|income|transfer|null", "occurredAt": string|null, "notes": string|null, "receiptIndexes": number[]}'
        : '{"amount": number|null, "currencyCode": string|null, "description": string, "tagNames": string[], "categoryName": string|null, "templateName": string|null, "budgetName": string|null, "sourceAccountName": string|null, "destinationAccountName": string|null, "type": "expense|income|transfer|null", "occurredAt": string|null, "notes": string|null}',
```

- [ ] **Step 2: Receipt instructions**

Replace the first string of the `hasReceipts` block (the one starting `'The user message may also contain one or more receipt photos.`) with a conditional pair. Keep the current string for the non-split case, and use this for `splitReceipts`:

```js
          splitReceipts
            ? 'The user message may also contain one or more receipt photos. Read each photo and extract its purchase as one transaction: description is the merchant name as printed, amount is the final total actually paid (after discounts, including taxes; never a subtotal, a line item, or the cash tendered), currencyCode from the printed currency or the merchant country, occurredAt from the printed date and time, type expense. Put every printed line the customer paid for in items, one entry per line, including tax, VAT, service charge, tip, bag, deposit and rounding lines when the receipt prints them as separate amounts: description is the line text as printed and amount is the line total after that line\'s own discount; a line with a quantity and a unit price is one item whose amount is quantity times unit price. Every item amount must be greater than zero. Never emit a discount, refund or return as its own negative item: subtract it from the item it applies to, and spread a receipt-wide discount over the items it covers. The item amounts must add up exactly to amount. Do not repeat the items in notes; leave notes null unless the receipt shows other useful information. Transactions that come only from the text have an empty items array. Set receiptIndexes to the 0-based positions of every photo the transaction came from; use an empty array for transactions that come from the text.'
            : 'The user message may also contain one or more receipt photos. Read each photo and extract its purchase as one transaction: description is the merchant name as printed, amount is the final total actually paid (after discounts, including taxes; never a subtotal, a line item, or the cash tendered), currencyCode from the printed currency or the merchant country, occurredAt from the printed date and time, type expense. Put every purchased item in notes, one per line, always with its price as printed: "item - price", or "item - quantity x unit price = line total" when the document prints a quantity and a unit price. Never list an item without a price. Set receiptIndexes to the 0-based positions of every photo the transaction came from; use an empty array for transactions that come from the text.',
```

The two remaining receipt strings (several photos per purchase; text overrides photo) stay unchanged.

- [ ] **Step 3: Normaliser**

In `normalizeTransactions`, before the `return {` inside the map add:

```js
      // A line without a usable amount is kept at 0 so the user sees it and fills it in; the editor refuses to save it as is.
      const items = (Array.isArray(transaction.items) ? transaction.items : [])
        .map((item) => ({ description: typeof item?.description === 'string' ? item.description.trim() : '', amount: Number.isFinite(Number(item?.amount)) ? Number(item.amount) : 0 }))
        .filter((item) => item.description)
```

and add `items,` to the returned object after `receiptIndexes`.

- [ ] **Step 4: Pass the flag**

In `interpretTransactions`, change the system message content to:

```js
            content: getInterpretationPrompt({ hasReceipts: (data.receiptImages ?? []).length > 0, splitReceipts: !!data.splitReceipts }),
```

- [ ] **Step 5: Lint and build**

```bash
npm run lint && npm run build
```

Expected: success. The Dictate popup is unaffected: with no receipts the prompt is unchanged.

- [ ] **Step 6: Commit**

```bash
git add front/repository/AssistantRepository.js
git commit -m "ask the assistant for receipt items when splitting is enabled

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `ReceiptItemUtils` with Node tests

**Files:**
- Create: `front/utils/ReceiptItemUtils.js`
- Create: `front/tests/ReceiptItemUtils.test.js`
- Modify: `front/package.json` (scripts)

**Interfaces:**
- Produces: `parseAmount(value) -> number`, `roundAmount(value, decimals) -> number`, `sumReceiptItems(items, decimals) -> number`, `getReceiptItemsProblem(items, total, decimals) -> null | 'invalid_amount' | 'mismatch'`, `formatReceiptItemsAsNotes(items, decimals) -> string`, `expandReceiptItems(item, items, decimals) -> item`. Used by Tasks 7, 8, 9.

- [ ] **Step 1: Add the test script**

In `front/package.json`, after the `"lint:prettier:fix"` script line add:

```json
    "test": "node --test 'tests/**/*.test.js'"
```

(Mind the comma on the previous line.)

- [ ] **Step 2: Write the failing tests**

Write `front/tests/ReceiptItemUtils.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandReceiptItems, formatReceiptItemsAsNotes, getReceiptItemsProblem, parseAmount, roundAmount, sumReceiptItems } from '../utils/ReceiptItemUtils.js'

const items = [
  { id: 'a', description: 'Milk', amount: 1.1 },
  { id: 'b', description: 'Bread', amount: '2,2' },
]

const draftItem = () => ({
  attributes: {
    transactions: [
      {
        amount: '3.30',
        description: 'Lidl',
        notes: '',
        tags: [{ id: 1 }],
        accountSource: { id: 9 },
      },
    ],
  },
})

test('parseAmount accepts numbers, dot and comma decimals, and rejects junk', () => {
  assert.equal(parseAmount(1.5), 1.5)
  assert.equal(parseAmount('2.25'), 2.25)
  assert.equal(parseAmount(' 2,25 '), 2.25)
  assert.equal(Number.isNaN(parseAmount('')), true)
  assert.equal(Number.isNaN(parseAmount('x')), true)
  assert.equal(Number.isNaN(parseAmount(null)), true)
})

test('roundAmount rounds to the given decimals', () => {
  assert.equal(roundAmount(1.006, 2), 1.01)
  assert.equal(roundAmount('3.3000000000000003', 2), 3.3)
  assert.equal(roundAmount(1234.5, 0), 1235)
  assert.equal(Number.isNaN(roundAmount('x', 2)), true)
})

test('sumReceiptItems adds numeric and string amounts without float noise and ignores junk', () => {
  assert.equal(sumReceiptItems(items, 2), 3.3)
  assert.equal(sumReceiptItems([{ amount: 'x' }, { amount: 2 }], 2), 2)
  assert.equal(sumReceiptItems([], 2), 0)
})

test('getReceiptItemsProblem is exact at the currency precision', () => {
  assert.equal(getReceiptItemsProblem(items, '3.30', 2), null)
  assert.equal(getReceiptItemsProblem(items, 3.3, 2), null)
  assert.equal(getReceiptItemsProblem(items, 3.31, 2), 'mismatch')
  assert.equal(getReceiptItemsProblem(items, '3,3', 2), null)
  assert.equal(getReceiptItemsProblem(items, '', 2), 'mismatch')
  assert.equal(getReceiptItemsProblem(items, null, 2), 'mismatch')
  assert.equal(getReceiptItemsProblem([{ amount: 1000 }, { amount: 235 }], 1235, 0), null)
})

test('getReceiptItemsProblem reports non-positive or missing amounts before a mismatch', () => {
  assert.equal(getReceiptItemsProblem([{ amount: 0 }, { amount: 3.3 }], 3.3, 2), 'invalid_amount')
  assert.equal(getReceiptItemsProblem([{ amount: -1 }, { amount: 4.3 }], 3.3, 2), 'invalid_amount')
  assert.equal(getReceiptItemsProblem([{ amount: '' }, { amount: 3.3 }], 3.3, 2), 'invalid_amount')
})

test('formatReceiptItemsAsNotes renders one line per item with fixed decimals', () => {
  assert.equal(formatReceiptItemsAsNotes(items, 2), 'Milk - 1.10\nBread - 2.20')
  assert.equal(formatReceiptItemsAsNotes([{ description: 'Gum', amount: 'x' }], 2), 'Gum - x')
})

test('expandReceiptItems returns the item untouched below two items', () => {
  const item = draftItem()
  assert.equal(expandReceiptItems(item, [], 2), item)
  assert.equal(expandReceiptItems(item, [items[0]], 2), item)
})

test('expandReceiptItems clones the first split per item and sets the group title', () => {
  const item = draftItem()
  const expanded = expandReceiptItems(item, items, 2)

  assert.equal(expanded.attributes.group_title, 'Lidl')
  assert.equal(expanded.attributes.transactions.length, 2)
  assert.deepEqual(
    expanded.attributes.transactions.map((split) => [split.description, split.amount]),
    [
      ['Milk', '1.10'],
      ['Bread', '2.20'],
    ],
  )
  assert.equal(expanded.attributes.transactions[1].accountSource.id, 9)
  assert.notEqual(expanded.attributes.transactions[0].tags, item.attributes.transactions[0].tags)
  assert.equal(item.attributes.transactions.length, 1)
  assert.equal(item.attributes.group_title, undefined)
})

test('expandReceiptItems formats with the given decimals', () => {
  const expanded = expandReceiptItems(draftItem(), [{ description: 'A', amount: 1000 }, { description: 'B', amount: 235 }], 0)
  assert.deepEqual(
    expanded.attributes.transactions.map((split) => split.amount),
    ['1000', '235'],
  )
})
```

- [ ] **Step 3: Run the tests to see them fail**

From `front/`:

```bash
npm test
```

Expected: failure with `Cannot find module '.../front/utils/ReceiptItemUtils.js'`.

- [ ] **Step 4: Implement the helpers**

Write `front/utils/ReceiptItemUtils.js`:

```js
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

export const sumReceiptItems = (items, decimals = 2) => {
  const sum = items.reduce((result, item) => {
    const amount = parseAmount(item.amount)
    return result + (Number.isFinite(amount) ? amount : 0)
  }, 0)
  return roundAmount(sum, decimals)
}

// Exact reconciliation: the rounded sum must equal the rounded total. Nothing is ever adjusted silently.
export const getReceiptItemsProblem = (items, total, decimals = 2) => {
  if (items.some((item) => !(parseAmount(item.amount) > 0))) {
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
      const amount = parseAmount(item.amount)
      return `${item.description} - ${Number.isFinite(amount) ? amount.toFixed(decimals) : item.amount}`
    })
    .join('\n')
}

// Turns a single-split draft into a Firefly group with one split per item. Every split inherits the first split's fields.
// Callers only expand items that have no problem.
export const expandReceiptItems = (item, items, decimals = 2) => {
  if (!items || items.length < 2) {
    return item
  }

  const expanded = cloneDeep(item)
  const firstSplit = expanded.attributes.transactions[0]

  expanded.attributes.group_title = firstSplit.description
  expanded.attributes.transactions = items.map((receiptItem) => ({
    ...cloneDeep(firstSplit),
    description: receiptItem.description,
    amount: parseAmount(receiptItem.amount).toFixed(decimals),
  }))

  return expanded
}
```

- [ ] **Step 5: Run the tests to see them pass**

```bash
npm test
```

Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 6: Lint**

```bash
npm run lint
```

Expected: success. If Prettier reformats the test file's nested arrays, accept its formatting for that file only.

- [ ] **Step 7: Commit**

```bash
git add front/package.json front/utils/ReceiptItemUtils.js front/tests/ReceiptItemUtils.test.js
git commit -m "add receipt item helpers with node tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Build split drafts, guard and write groups

**Files:**
- Modify: `front/composables/useTransactionAssistantDraft.js`
- Modify: `front/composables/useRambleDrafts.js` (`interpret`, `applyEditedDraft`, `create`)
- Modify: `front/transformers/TransactionTransformer.js:112-118`
- Modify: all eleven locale files (two problem keys)

**Interfaces:**
- Consumes: `raw.items` (Task 5), helpers (Task 6), `Account.getCurrencyDecimalPlaces`.
- Produces: draft shape `{ id, assistant, item, items, splitFallbackReason, receiptIds, status, error, response }` where each item is `{ id, description, amount }`; `getDraftDecimals(split) -> number`; `buildReceiptDraft(item, rawItems, splitReceipts) -> { item, items, splitFallbackReason }`; `transformToApi` emits `group_title` for multi-split items. Tasks 8 and 9 read `items` and `splitFallbackReason`.

- [ ] **Step 1: i18n for the problem messages**

In every locale file, inside `"transaction"`, add after `"assistant_receipt_rescan_message"`:

```json
    "assistant_ramble_items_mismatch": "The items do not add up to the amount",
    "assistant_ramble_items_invalid_amount": "Every item needs an amount above zero",
```

Suggested translations: ro "Articolele nu se adună la sumă" / "Fiecare articol are nevoie de o sumă mai mare decât zero"; de-DE "Die Artikel ergeben nicht den Betrag" / "Jeder Artikel braucht einen Betrag über null"; fr "Les articles ne correspondent pas au montant" / "Chaque article doit avoir un montant supérieur à zéro"; it "Gli articoli non corrispondono all'importo" / "Ogni articolo deve avere un importo maggiore di zero"; es-MX "Los artículos no suman el monto" / "Cada artículo necesita un monto mayor que cero"; pt-BR "Os itens não somam o valor" / "Cada item precisa de um valor acima de zero"; pl "Pozycje nie sumują się do kwoty" / "Każda pozycja musi mieć kwotę większą od zera"; ru-RU "Позиции не сходятся с суммой" / "У каждой позиции должна быть сумма больше нуля"; zh-CN "商品金额与总额不符" / "每个商品的金额必须大于零"; ko "항목 합계가 금액과 맞지 않습니다" / "모든 항목의 금액은 0보다 커야 합니다".

Run the JSON parse check.

- [ ] **Step 2: `getDraftDecimals` and `buildReceiptDraft`**

In `front/composables/useTransactionAssistantDraft.js`, add the imports and the two exported functions (Nuxt auto-imports named exports from `composables/`, but the plan imports them explicitly for clarity):

```js
import { cloneDeep, get } from 'lodash-es'
import Account from '~/models/Account.js'
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
```

Replace the existing `import { cloneDeep } from 'lodash-es'` with the first line above.

- [ ] **Step 3: Use it in `interpret`**

In `front/composables/useRambleDrafts.js`:

- Change the import to `import { buildReceiptDraft, getDraftDecimals, useTransactionAssistantDraft } from '~/composables/useTransactionAssistantDraft.js'`.
- Add `import { expandReceiptItems, getReceiptItemsProblem } from '~/utils/ReceiptItemUtils.js'`.
- Replace the `newDrafts.push({ ... })` block with:

```js
        const built = await buildTransactionItemFromAssistant(transaction)
        const { item, items, splitFallbackReason } = buildReceiptDraft(built, transaction.raw?.items, splitReceipts)
        newDrafts.push({
          id: transaction.id,
          assistant: transaction,
          item,
          items,
          splitFallbackReason,
          receiptIds: getReceiptIds(transaction, receipts),
          status: draftStatus.pending,
          error: null,
          response: null,
        })
```

- [ ] **Step 4: Keep items through edits, guard and expand on create**

In `applyEditedDraft`, add to the replaced object:

```js
      items: cloneDeep(editedDraft.items ?? []),
      splitFallbackReason: null,
```

In `create`, replace the line `const requestData = TransactionTransformer.transformToApi(cloneDeep(drafts.value[index].item))` with:

```js
          const split = drafts.value[index].item.attributes.transactions[0]
          const items = drafts.value[index].items ?? []
          const decimals = getDraftDecimals(split)
          const problem = items.length > 0 ? getReceiptItemsProblem(items, split.amount, decimals) : null
          if (problem) {
            // Never post a group that Firefly would reject or that books a different total than the receipt; the retry flow picks it up after the user fixes it.
            drafts.value[index].status = draftStatus.error
            drafts.value[index].error = t(`transaction.assistant_ramble_items_${problem}`)
            continue
          }
          const requestData = TransactionTransformer.transformToApi(expandReceiptItems(cloneDeep(drafts.value[index].item), items, decimals))
```

- [ ] **Step 5: `group_title` in the transformer**

In `front/transformers/TransactionTransformer.js`, replace the final `return { id, apply_rules: true, fire_webhooks: true, transactions }` of `transformToApi` with:

```js
    const result = {
      id,
      apply_rules: true,
      fire_webhooks: true,
      transactions,
    }

    // Firefly III rejects a multi-split group without a title (GroupValidation::validateGroupDescription); single splits keep the old body untouched.
    // Existing split groups edited on the main page also carry their title back now, which preserves it.
    if (transactions.length > 1) {
      result.group_title = get(item, 'attributes.group_title')
    }

    return result
```

- [ ] **Step 6: Lint, build, tests**

```bash
npm run lint && npm run build && npm test
```

Expected: all succeed.

- [ ] **Step 7: Manual check**

Chip on: scan a receipt with several items that add up. Open the browser devtools network tab and press Create. Expected: the POST body to `api/transactions` has `group_title` equal to the merchant, and one entry per item under `transactions`, each with the item's description and amount; Firefly shows a split transaction with the receipt total. Scan a one-item receipt: a single transaction with the item in notes. Chip off: a single transaction with items in notes, and the POST body has no `group_title`. Force a mismatch (edit an item amount in the devtools console, or scan a receipt with an unusual discount line) and press Create: that draft turns red with "The items do not add up to the amount" and no request is sent for it; other drafts are created. Main page: open an existing split transaction from the list and save it without changes; Firefly keeps its group title and the PUT body contains `group_title`.

- [ ] **Step 8: Commit**

```bash
git add front/composables/useTransactionAssistantDraft.js front/composables/useRambleDrafts.js front/transformers/TransactionTransformer.js front/i18n/locales/
git commit -m "create receipt drafts as split transaction groups

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Preview shows the split, the problem, or the fallback reason

**Files:**
- Modify: `front/components/transaction/ramble/ramble-transaction-item.vue`
- Modify: all eleven locale files (one fallback key)

**Interfaces:**
- Consumes: `draft.items`, `draft.splitFallbackReason` (Task 7), `expandReceiptItems`, `getReceiptItemsProblem` (Task 6), `getDraftDecimals` (Task 7), problem keys (Task 7).

- [ ] **Step 1: i18n**

In every locale file, inside `"transaction"`, add after `"assistant_ramble_items_invalid_amount"`:

```json
    "assistant_ramble_split_fallback_foreign_currency": "Receipts booked with a foreign amount are kept as one transaction with the items in notes",
```

Suggested translations: ro "Bonurile cu sumă în valută rămân o singură tranzacție cu articolele în note"; de-DE "Belege mit Fremdwährungsbetrag bleiben eine Buchung mit den Artikeln in den Notizen"; fr "Les reçus en montant étranger restent une seule transaction avec les articles en notes"; it "Gli scontrini con importo in valuta estera restano una sola transazione con gli articoli nelle note"; es-MX "Los recibos con monto en moneda extranjera quedan como una sola transacción con los artículos en notas"; pt-BR "Recibos com valor em moeda estrangeira ficam como uma única transação com os itens nas notas"; pl "Paragony z kwotą w obcej walucie pozostają jedną transakcją z pozycjami w notatkach"; ru-RU "Чеки с суммой в иностранной валюте сохраняются одной транзакцией с позициями в заметках"; zh-CN "外币金额的小票保留为一笔交易，商品写入备注"; ko "외화 금액 영수증은 하나의 거래로 유지되며 항목은 메모에 들어갑니다".

Run the JSON parse check.

- [ ] **Step 2: Render the expanded item, the problem, or the reason**

In `front/components/transaction/ramble/ramble-transaction-item.vue`:

Template: change `<transaction-list-item :value="transaction.item" ...>` to `<transaction-list-item :value="previewItem" ...>`, and add after the unmatched-category block:

```vue
    <div v-if="itemsProblem" class="text-size-12 text-danger px-3 pt-2">{{ $t(`transaction.assistant_ramble_items_${itemsProblem}`) }}</div>
    <div v-if="transaction.splitFallbackReason" class="text-size-12 text-muted px-3 pt-2">{{ $t(`transaction.assistant_ramble_split_fallback_${transaction.splitFallbackReason}`) }}</div>
```

Script: add the imports

```js
import { expandReceiptItems, getReceiptItemsProblem } from '~/utils/ReceiptItemUtils.js'
import { getDraftDecimals } from '~/composables/useTransactionAssistantDraft.js'
```

and, after `tagSuggestions`:

```js
const firstSplit = computed(() => get(transaction.value, 'item.attributes.transactions.0'))
const items = computed(() => transaction.value.items ?? [])
const decimals = computed(() => getDraftDecimals(firstSplit.value))
// Problems are computed where they are shown, never stored on the draft, so an edit to the amount or the items updates the preview.
const itemsProblem = computed(() => (items.value.length > 0 ? getReceiptItemsProblem(items.value, get(firstSplit.value, 'amount'), decimals.value) : null))
// A draft whose items do not add up is previewed as it would be created if the user merged it: one transaction with the receipt total.
const previewItem = computed(() => (items.value.length > 0 && !itemsProblem.value ? expandReceiptItems(transaction.value.item, items.value, decimals.value) : transaction.value.item))
```

- [ ] **Step 3: Lint, build, manual**

```bash
npm run lint && npm run build
```

Manual: a multi-item receipt draft whose items add up shows the "Split" badge and the summed amount in the preview; a one-item receipt shows no badge; a draft with a mismatch (force it by editing an item amount in the devtools console) shows no badge, the receipt total, and the red mismatch line; a receipt in a currency other than the source account's shows the muted foreign-currency line and no badge.

- [ ] **Step 4: Commit**

```bash
git add front/components/transaction/ramble/ramble-transaction-item.vue front/i18n/locales/
git commit -m "show receipt drafts as splits in the assistant preview

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Item editor in the edit popup

**Files:**
- Create: `front/components/transaction/ramble/ramble-receipt-items.vue`
- Modify: `front/components/transaction/ramble/ramble-transaction-edit-popup.vue`
- Modify: all eleven locale files (five keys)
- Modify: `front/assets/styles/theme-white.css` (one class)

**Interfaces:**
- Consumes: `sumReceiptItems`, `roundAmount`, `getReceiptItemsProblem`, `formatReceiptItemsAsNotes` (Task 6); `getDraftDecimals` (Task 7); draft `items` (Task 7); `getGUID`.
- Produces: `RambleReceiptItems` with model `items`, props `amount` and `decimals`, emit `merge`.

- [ ] **Step 1: i18n**

In every locale file, inside `"transaction"`, add after `"assistant_ramble_split_fallback_foreign_currency"`:

```json
    "assistant_ramble_items": "Items",
    "assistant_ramble_items_total": "Items total",
    "assistant_ramble_items_difference": "Difference",
    "assistant_ramble_add_item": "Add item",
    "assistant_ramble_merge_items": "Merge into one transaction",
```

Suggested translations (items / items_total / items_difference / add_item / merge_items): ro "Articole" / "Total articole" / "Diferență" / "Adaugă articol" / "Unește într-o singură tranzacție"; de-DE "Artikel" / "Summe der Artikel" / "Differenz" / "Artikel hinzufügen" / "Zu einer Buchung zusammenführen"; fr "Articles" / "Total des articles" / "Différence" / "Ajouter un article" / "Fusionner en une seule transaction"; it "Articoli" / "Totale articoli" / "Differenza" / "Aggiungi articolo" / "Unisci in una sola transazione"; es-MX "Artículos" / "Total de artículos" / "Diferencia" / "Agregar artículo" / "Combinar en una sola transacción"; pt-BR "Itens" / "Total dos itens" / "Diferença" / "Adicionar item" / "Mesclar em uma única transação"; pl "Pozycje" / "Suma pozycji" / "Różnica" / "Dodaj pozycję" / "Scal w jedną transakcję"; ru-RU "Позиции" / "Сумма позиций" / "Разница" / "Добавить позицию" / "Объединить в одну транзакцию"; zh-CN "商品" / "商品合计" / "差额" / "添加商品" / "合并为一笔交易"; ko "항목" / "항목 합계" / "차이" / "항목 추가" / "하나의 거래로 병합".

Run the JSON parse check.

- [ ] **Step 2: Create the editor**

Write `front/components/transaction/ramble/ramble-receipt-items.vue`:

```vue
<template>
  <van-cell-group inset class="ramble-receipt-items">
    <div class="van-cell-group-title">{{ $t('transaction.assistant_ramble_items') }}</div>

    <div v-for="item in items" :key="item.id" class="flex-center-vertical gap-2 px-3 py-1">
      <app-field v-model="item.description" class="flex-1 van-cell-no-padding compact" label="" :placeholder="$t('description')" />
      <app-field v-model="item.amount" class="ramble-receipt-item-amount van-cell-no-padding compact" label="" inputmode="decimal" :placeholder="$t('amount')" />
      <van-button round size="small" plain type="danger" class="cursor-pointer ramble-icon-button" :title="$t('delete')" @click="removeItem(item)">
        <van-icon name="delete-o" size="15" />
      </van-button>
    </div>

    <div class="px-3 pt-2 text-size-13">
      <div class="font-600">{{ $t('transaction.assistant_ramble_items_total') }}: {{ totalFormatted }}</div>
      <div v-if="hasDifference" class="text-danger">{{ $t('transaction.assistant_ramble_items_difference') }}: {{ differenceFormatted }}</div>
    </div>

    <div class="flex-center-vertical flex-wrap gap-2 p-3">
      <van-button round size="small" plain class="cursor-pointer" @click="addItem">
        <app-icon :icon="TablerIconConstants.add" :size="14" />
        {{ $t('transaction.assistant_ramble_add_item') }}
      </van-button>

      <div class="flex-1" />

      <van-button round size="small" plain class="cursor-pointer" @click="emit('merge')">{{ $t('transaction.assistant_ramble_merge_items') }}</van-button>
    </div>
  </van-cell-group>
</template>

<script setup>
import { computed } from 'vue'
import TablerIconConstants from '~/constants/TablerIconConstants.js'
import { roundAmount, sumReceiptItems } from '~/utils/ReceiptItemUtils.js'
import { getGUID } from '~/utils/Utils.js'

const props = defineProps({
  amount: {
    type: [String, Number],
    default: '',
  },
  decimals: {
    type: Number,
    default: 2,
  },
})

const emit = defineEmits(['merge'])
const items = defineModel({ type: Array, default: () => [] })

// The editor never writes the amount: the receipt total and the items are both the user's to correct, and the difference line says which.
const total = computed(() => sumReceiptItems(items.value, props.decimals))
const difference = computed(() => {
  const amount = roundAmount(props.amount, props.decimals)
  return Number.isFinite(amount) ? roundAmount(total.value - amount, props.decimals) : NaN
})
const hasDifference = computed(() => difference.value !== 0)
const totalFormatted = computed(() => total.value.toFixed(props.decimals))
const differenceFormatted = computed(() => (Number.isFinite(difference.value) ? `${difference.value > 0 ? '+' : ''}${difference.value.toFixed(props.decimals)}` : '-'))

const addItem = () => {
  items.value = [...items.value, { id: getGUID(), description: '', amount: '' }]
}

const removeItem = (item) => {
  items.value = items.value.filter((existing) => existing.id !== item.id)
}
</script>
```

In `front/assets/styles/theme-white.css`, after the `.ramble-receipt-thumb img` rule add:

```css
.ramble-receipt-item-amount {
    width: 96px;
    flex: 0 0 auto;
}
```

No dark override is needed: the rule sets no colours. `text-danger` comes from the bundled Bootstrap CSS and is already used by `ramble-transaction-item.vue`.

- [ ] **Step 3: Wire the editor into the edit popup**

In `front/components/transaction/ramble/ramble-transaction-edit-popup.vue`:

Template: after `<transaction-form ... />` add:

```vue
        <ramble-receipt-items
          v-if="transaction?.items?.length > 0"
          v-model="transaction.items"
          :amount="transaction.item.attributes.transactions[0].amount"
          :decimals="decimals"
          @merge="onMergeItems"
        />
```

Script: add the imports and handlers:

```js
import RambleReceiptItems from '~/components/transaction/ramble/ramble-receipt-items.vue'
import { formatReceiptItemsAsNotes, getReceiptItemsProblem } from '~/utils/ReceiptItemUtils.js'
import { getDraftDecimals } from '~/composables/useTransactionAssistantDraft.js'

const { t } = useI18n()

const firstSplit = computed(() => transaction.value?.item?.attributes?.transactions?.[0])
const decimals = computed(() => getDraftDecimals(firstSplit.value))

const onMergeItems = () => {
  const split = firstSplit.value
  if (!split.notes && transaction.value.items.length > 0) {
    split.notes = formatReceiptItemsAsNotes(transaction.value.items, decimals.value)
  }
  transaction.value.items = []
}
```

and change `onSave` to:

```js
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
```

- [ ] **Step 4: Lint, build, manual**

```bash
npm run lint && npm run build
```

Manual, chip on, multi-item receipt: open the draft. Expected: the Items card lists the items under the form with the items total and no difference line; change an item amount and the red difference line appears with the signed difference; change the form's Amount instead and the difference follows it; try to save with a difference and see the mismatch toast; set an item to 0 and see the "above zero" toast; Add item appends an empty row that blocks saving until filled; delete an item; fix the amounts so the difference disappears and save; the preview shows the split badge with the new count. Merge removes the card, fills notes with one line per item using the currency's decimals, and leaves the amount. Delete every item: the card disappears and the draft is a plain single transaction. Create and confirm in Firefly. Check the card on desktop and mobile widths and in the dark theme.

- [ ] **Step 5: Commit**

```bash
git add front/components/transaction/ramble/ramble-receipt-items.vue front/components/transaction/ramble/ramble-transaction-edit-popup.vue front/assets/styles/theme-white.css front/i18n/locales/
git commit -m "edit receipt items in the assistant draft popup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Docs, changelog, version bump

**Files:**
- Modify: `readme.md:64`
- Modify: `CHANGELOG.md:1-3`
- Modify: `config.yaml:5`

- [ ] **Step 1: Readme**

Replace the receipt bullet in `readme.md` with:

```markdown
- ✅ Snap a photo of a receipt with the camera button and let the assistant read it: the merchant, total and date are filled in, the photo is attached to the transaction, and with "Split into items" on every purchased item becomes its own split with its price, checked against the total before creating (uses the same OpenAI LLM configuration)
```

- [ ] **Step 2: Changelog**

At the top of `CHANGELOG.md`, after `# Changelog` and a blank line, insert:

```markdown
## 0.2.4-dev6

- Receipt scanning has its own popup: tap the camera, choose whether to
  split into items, add the photos and they are interpreted right away,
  with no Interpret step. The Dictate popup no longer accepts photos.
- With "Split into items" on, a scanned receipt becomes one Firefly split
  transaction with one split per purchased item. The items must add up
  exactly to the receipt total; any difference is shown on the draft and
  fixed in its editor (edit, add, delete or merge the items) before
  creating. Receipts booked with a foreign amount stay one transaction
  with the items in notes.
- New assistant setting "Split receipts into items by default", off by
  default; it only sets the chip's starting state for each scan.

```

- [ ] **Step 3: Version**

In `config.yaml` change `version: "0.2.4-dev5"` to `version: "0.2.4-dev6"`.

- [ ] **Step 4: Final verification**

From `front/`:

```bash
npm run lint && npm run build && npm test
```

From the repo root: the JSON parse check from the global constraints, then `git status --short`.

Expected: lint, build and tests pass; no `BROKEN` lines; only the intended files are modified. Then run through the spec's Verification list once end to end.

- [ ] **Step 5: Commit**

```bash
git add readme.md CHANGELOG.md config.yaml
git commit -m "bump version to 0.2.4-dev6 (0.2.4-dev6)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: shared composable with receipt ids (T1), shell with interpreting state and `hasDrafts` (T2), popup-first receipt flow with chip, re-scan confirmation, strip and Dictate cleanup and phase-1 i18n (T3), setting default off (T4), prompt with tax/discount policy and normaliser (T5), exact helpers with tests and the `npm test` script (T6), draft building that keeps mismatched items, create guard, `group_title` and problem i18n (T7), preview with split, problem or fallback line (T8), editor with add/delete/merge, difference line and save guard (T9), docs and release (T10). Nothing in the spec is left without a task.
- Review findings addressed: broken `node --test tests/` (T6, constraints); non-positive amounts (T5 normaliser keeps them visible, T6 `invalid_amount`, T7 create guard, T9 save guard); no drift (T6 exact reconciliation, T9 never rewrites the amount); stale receipt indexes (T1 ids); interpreting state (T2); add item (T9); mismatch keeps items (T7); tax lines (T5 prompt); `group_title` on main-page edits (T7 comment and manual check); re-scan discards edits (T3 confirmation); lowercase `items` key (T9 new key); notes decimals (T6); editor decimals (T7 `getDraftDecimals`, T9 prop); row keys by id (T7 ids, T9); `cloneDeep` import (T2); `nextTick` comment gone (T3); saved-rambles guard matches today's behaviour (T1).
- Naming used consistently across tasks: `useRambleDrafts`, `draftStatus`, `interpret`, `create`, `removeDraft`, `applyEditedDraft`, `reset`, `hasDrafts`; `getDraftDecimals`, `buildReceiptDraft`; `parseAmount`, `roundAmount`, `sumReceiptItems`, `getReceiptItemsProblem`, `formatReceiptItemsAsNotes`, `expandReceiptItems`; draft fields `items`, `splitFallbackReason`, `receiptIds`; strip prop `splitItems` with event `toggleSplit`; i18n keys as listed in the spec.
- Task 1 intentionally leaves `ramble.vue`'s template untouched and Task 2 rewrites it; an executor doing Task 1 alone still ships a working Dictate popup. Task 2 references an i18n key it adds itself, Task 7 adds the problem keys it uses, so no task renders a missing key.
