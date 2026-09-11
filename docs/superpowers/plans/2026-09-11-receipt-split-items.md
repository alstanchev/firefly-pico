# Receipt Scanning Popup and Split Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give receipt scanning its own popup that interprets photos on pick, and turn a scanned receipt into one Firefly transaction group with one split per purchased item.

**Architecture:** Phase 1 extracts the interpret/create/attach machinery from `ramble.vue` into `useRambleDrafts.js` and a shell component `ramble-drafts-popup.vue`, then adds `receipt-scan.vue` on top of the shell and removes photos from the Dictate popup. Phase 2 adds an assistant setting, an `items` array in the assistant prompt and response, pure helpers that expand items into Firefly splits, a preview that shows the split badge, an item editor in the edit popup, and `group_title` on multi-split writes.

**Tech Stack:** Nuxt 3 (SSR off), Vue 3 `<script setup>`, Pinia composition stores, Vant 4, lodash-es, Node 18+ built-in test runner for pure helpers. Plain `.js` and `.vue`; no TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-11-receipt-split-items-design.md`

## Global Constraints

- Work on branch `feature/receipt-split-items` (already cut from `dev`). Never merge; keep linear history.
- Prettier is the source of truth: single quotes, no semicolons, trailing commas, 2-space indent, `printWidth: 200`. Write code that already matches; do not run `npm run lint:fix` on unrelated files.
- Only `.js` and `.vue`. Vue components use `<script setup>`, `defineModel()`, and Nuxt auto-imports (`ref`, `computed`, `useI18n`, `useProfileStore`, `useAppStore`, `navigateTo` need no import; explicit imports of `ref`/`computed` from `vue` are also accepted and common in this repo).
- UI-kit and page components use kebab-case filenames. Composables use `useXxx.js`.
- Every new user-visible string gets a key in all eleven locale files under `front/i18n/locales/`: `en.json`, `ro.json`, `zh-CN.json`, `it.json`, `pt-BR.json`, `de-DE.json`, `fr.json`, `pl.json`, `ru-RU.json`, `es-MX.json`, `ko.json`. Translate to the target language; when unsure, an English value is acceptable, but the key must exist.
- Any new class with hardcoded light colours needs a `.van-theme-dark` override in `front/assets/styles/theme-dark.css`. Prefer CSS variables and existing helper classes so no override is needed.
- Verification commands run from `front/`: `npm run lint`, `npm run build`, `node --test tests/`. There is no other test runner; do not add one.
- Commit after every task with a short imperative subject line and this trailer:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- Every merge to `main` needs a `config.yaml` version bump and a `CHANGELOG.md` entry; this branch targets `dev`, so the bump is `0.2.4-dev6` (Task 12).

---

## File map

Phase 1 (receipt popup):

- Create `front/composables/useRambleDrafts.js` — drafts state, interpret, create, attach, edit, remove, reset.
- Create `front/components/transaction/ramble/ramble-drafts-popup.vue` — popup shell: header, slot, drafts list, footer, edit popup.
- Modify `front/components/transaction/ramble.vue` — thin Dictate wrapper.
- Modify `front/components/transaction/ramble/ramble-input-card.vue` — remove receipts.
- Create `front/components/transaction/ramble/ramble-receipt-strip.vue` — thumbnails, add, scan again.
- Create `front/components/transaction/receipt-scan.vue` — camera trigger, file input, preparation, auto-interpret.
- Modify `front/components/transaction/transaction-assistant.vue` — mount `receipt-scan`.
- Modify all eleven locale files — five `assistant_receipt_*` keys.

Phase 2 (splits):

- Modify `front/stores/profileStore.js` and `front/pages/settings/assistant.vue` — setting.
- Modify `front/repository/AssistantRepository.js` — prompt, normaliser, `splitReceipts`.
- Create `front/utils/ReceiptItemUtils.js` and `front/tests/ReceiptItemUtils.test.js`.
- Modify `front/composables/useTransactionAssistantDraft.js` — `buildReceiptDraft`.
- Modify `front/composables/useRambleDrafts.js` — items on drafts, expand on create.
- Modify `front/transformers/TransactionTransformer.js` — `group_title`.
- Modify `front/components/transaction/ramble/ramble-transaction-item.vue` — expanded preview, fallback line.
- Create `front/components/transaction/ramble/ramble-receipt-items.vue` — item editor.
- Modify `front/components/transaction/ramble/ramble-transaction-edit-popup.vue` — editor, merge, mismatch guard.
- Modify all eleven locale files — six phase-2 keys.
- Modify `readme.md`, `CHANGELOG.md`, `config.yaml`.

---

### Task 1: Extract `useRambleDrafts` from `ramble.vue`

**Files:**
- Create: `front/composables/useRambleDrafts.js`
- Modify: `front/components/transaction/ramble.vue` (script: lines 106-608)

**Interfaces:**
- Consumes: `AssistantRepository.interpretTransactions(data)`, `TransactionRepository.insert(requestData)`, `AttachmentRepository.uploadForTransaction(journalId, file)`, `TransactionTransformer.transformToApi(item)`, `useRambleTransactionResolver()`, `useTransactionAssistantDraft()`.
- Produces: `draftStatus` and `useRambleDrafts()` exactly as below. Task 2 renders from it; Task 7 extends `interpret`, `create` and `applyEditedDraft`.

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

  const interpret = async ({ text = '', savedRambles = [], receipts = [] }) => {
    if (!text.trim() && savedRambles.length === 0 && receipts.length === 0) {
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
    const matched = (draft.assistant?.raw?.receiptIndexes ?? []).map((index) => receipts[index]).filter(Boolean)
    if (matched.length > 0) {
      return matched
    }
    // Without usable indexes, the fallback covers only the unambiguous single-draft case, where every photo belongs to it.
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

Run `npm run dev` from `front/`, open the transaction page, and in the Dictate popup: type "coffee 12", Interpret, open the draft, change the description, Save, Create. Expected: one transaction is created, the popup closes, the list page opens. Also confirm the success toast and progress bar still appear.

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

**Interfaces:**
- Consumes: `useRambleDrafts()` from Task 1, `ramble-transaction-item.vue`, `ramble-transaction-edit-popup.vue`, `useSwipeToDismiss`.
- Produces: component `RambleDraftsPopup` with props `icon`, `title`, `subtitle`, `emptyHint`, `receipts`; model `show`; default slot with slot prop `isInterpreting`; exposed `interpret(payload)` and `reset()`; emit `created`. Tasks 3 and 4 render it.

- [ ] **Step 1: Create the shell**

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
})
</script>
```

- [ ] **Step 2: Reduce `ramble.vue` to a wrapper around the shell**

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

Then in the script: remove the `useRambleDrafts` destructuring, `useSwipeToDismiss` call, `ramblePopupStyle`, `isRambleFormDisabled`, `popupRef`, `popupContentRef`, `showRambleTransactionPopup`, `editingRambleTransaction`, `openRambleTransaction`, `onRambleTransactionEdited`, `createRambleTransactions`, and the imports of `RambleTransactionItem`, `RambleTransactionEditPopup`, `useRambleDrafts`, `draftStatus`, `useSwipeToDismiss` (keep `computed`: `hasLoadedSavedRambles` still uses it). Add `import RambleDraftsPopup from '~/components/transaction/ramble/ramble-drafts-popup.vue'` and `const draftsPopupRef = ref(null)`. Replace `interpretRambleText`, `resetRamble` and the create handler with:

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

`hasLoadedSavedRambles` still needs `computed`; keep `import { computed, onMounted, ref, watch } from 'vue'`.

- [ ] **Step 3: Lint and build**

Run from `front/`:

```bash
npm run lint && npm run build
```

Expected: success. Fix any unused-variable report by deleting the variable.

- [ ] **Step 4: Manual check**

Dictate flow as in Task 1 Step 4, plus: open the popup with no text and confirm the empty state shows "No transactions yet"; interpret nonsense text and confirm "No transactions found"; swipe down on mobile width closes the popup; closing and reopening shows a clean state.

- [ ] **Step 5: Commit**

```bash
git add front/components/transaction/ramble/ramble-drafts-popup.vue front/components/transaction/ramble.vue
git commit -m "extract the assistant drafts popup shell

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Receipt popup, receipt strip, and i18n

**Files:**
- Create: `front/components/transaction/ramble/ramble-receipt-strip.vue`
- Create: `front/components/transaction/receipt-scan.vue`
- Modify: `front/components/transaction/transaction-assistant.vue:24` and `:58`
- Modify: all eleven files in `front/i18n/locales/`

**Interfaces:**
- Consumes: `RambleDraftsPopup` from Task 2; `compressImageToJpeg`, `blobToDataUrl` from `~/utils/ImageUtils.js`; `getGUID` from `~/utils/Utils.js`.
- Produces: `receipt-scan.vue` mounted next to `<ramble>`; nothing later depends on its internals.

- [ ] **Step 1: Add the phase-1 i18n keys**

In every locale file, inside the `"transaction": { ... }` object, add these five keys directly after `"assistant_ramble_receipt_limit"`. English values (translate for the other locales; keep the key names identical):

```json
    "assistant_receipt_title": "Scan receipts",
    "assistant_receipt_hint": "Photos are read and turned into transactions",
    "assistant_receipt_empty": "Add a receipt photo to start",
    "assistant_receipt_add": "Add photo",
    "assistant_receipt_scan": "Scan again",
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

Then verify every file parses:

```bash
for f in front/i18n/locales/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BROKEN $f"; done
```

Expected: no `BROKEN` lines.

- [ ] **Step 2: Create the receipt strip**

Write `front/components/transaction/ramble/ramble-receipt-strip.vue`:

```vue
<template>
  <van-cell-group inset class="no-margin overflow-hidden">
    <div class="p-3 display-flex flex-column gap-2">
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

defineProps({
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

const emit = defineEmits(['add', 'scan'])
const receipts = defineModel({ type: Array, default: () => [] })

const removeReceipt = (receipt) => {
  receipts.value = receipts.value.filter((item) => item.id !== receipt.id)
}
</script>
```

- [ ] **Step 3: Create the receipt popup component**

Write `front/components/transaction/receipt-scan.vue`:

```vue
<template>
  <van-button v-if="appStore.llmIsConfigured" size="small" class="cursor-pointer ramble-trigger-button" :loading="isPreparing" :title="$t('transaction.assistant_ramble_scan_receipt')" @click="inputRef?.click()">
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
      <ramble-receipt-strip v-model="receipts" :max-receipts="maxReceipts" :is-preparing="isPreparing" :is-disabled="isInterpreting" @add="inputRef?.click()" @scan="scan" />
    </template>
  </ramble-drafts-popup>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import RouteConstants from '~/constants/RouteConstants'
import TablerIconConstants from '~/constants/TablerIconConstants.js'
import RambleDraftsPopup from '~/components/transaction/ramble/ramble-drafts-popup.vue'
import RambleReceiptStrip from '~/components/transaction/ramble/ramble-receipt-strip.vue'
import UIUtils from '~/utils/UIUtils.js'
import { compressImageToJpeg, blobToDataUrl } from '~/utils/ImageUtils.js'
import { getGUID } from '~/utils/Utils.js'

const { t } = useI18n()
const appStore = useAppStore()

// Three photos keep the base64 request well under PHP's 8M post limit and the 60 s LLM timeout.
const maxReceipts = 3
const inputRef = ref(null)
const popupRef = ref(null)
const show = ref(false)
const receipts = ref([])
const isPreparing = ref(false)

const scan = () => {
  return popupRef.value?.interpret({ receipts: receipts.value })
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

  // Photos are interpreted as soon as they are picked; the popup must be mounted before the exposed method exists.
  show.value = true
  await nextTick()
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

With the LLM configured: two buttons next to the assistant field (dictate, camera). Tap the camera, pick a receipt photo. Expected: the receipt popup opens with the thumbnail and starts interpreting without another tap; a draft appears; Create attaches the photo (check the transaction's attachments in Firefly). Remove the photo, confirm the Scan again button is disabled; add a photo, confirm it interprets again. Open the Dictate popup and confirm no camera button or thumbnails remain, and that text interpretation still works. Check dark theme.

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
- Produces: `profileStore.assistantSplitReceipts` (boolean, default `true`). Read by Task 7.

- [ ] **Step 1: Store field**

In `front/stores/profileStore.js`, after `const assistantLlmModel = useLocalStorage('assistantLlmModel', '')` add:

```js
  const assistantSplitReceipts = useLocalStorage('assistantSplitReceipts', true)
```

and in the returned object, after `assistantLlmModel,` add `assistantSplitReceipts,`. Profile persistence serialises the whole state, so nothing else is needed.

- [ ] **Step 2: Settings toggle**

In `front/pages/settings/assistant.vue`, after the `auto_focus` `app-boolean` line add:

```vue
        <app-boolean v-model="assistantSplitReceipts" :label="$t('settings.assistant.split_receipts')" />
```

After `const autoFocusAssistant = ref(false)` add `const assistantSplitReceipts = ref(true)`. In `syncedSettings` add:

```js
  { store: profileStore, path: 'assistantSplitReceipts', ref: assistantSplitReceipts },
```

- [ ] **Step 3: i18n**

In every locale file, inside `"settings": { "assistant": { ... } }`, add after `"auto_focus"`:

```json
      "split_receipts": "Split receipts into one transaction per item",
```

Suggested translations: ro "Împarte bonurile într-o tranzacție per articol"; de-DE "Belege in eine Buchung pro Artikel aufteilen"; fr "Diviser les reçus en une transaction par article"; it "Dividi gli scontrini in una transazione per articolo"; es-MX "Dividir recibos en una transacción por artículo"; pt-BR "Dividir recibos em uma transação por item"; pl "Dziel paragony na jedną transakcję na pozycję"; ru-RU "Разбивать чеки на транзакцию для каждой позиции"; zh-CN "将小票按商品拆分为多笔交易"; ko "영수증을 항목별 거래로 분할".

Re-run the JSON parse loop from Task 3 Step 1.

- [ ] **Step 4: Lint, build, manual**

```bash
npm run lint && npm run build
```

Manual: Settings > Assistant shows the toggle on by default; toggling and saving persists across a reload.

- [ ] **Step 5: Commit**

```bash
git add front/stores/profileStore.js front/pages/settings/assistant.vue front/i18n/locales/
git commit -m "add the split receipts assistant setting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Prompt and response shape for receipt items

**Files:**
- Modify: `front/repository/AssistantRepository.js:5-35` (prompt), `:60-100` (normaliser), `:168-190` (`interpretTransactions`)

**Interfaces:**
- Produces: `interpretTransactions(data)` accepts `data.splitReceipts` (boolean); every normalised transaction has `items: [{ description: string, amount: number }]`. Task 7 passes `splitReceipts` and reads `raw.items`.

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
            ? 'The user message may also contain one or more receipt photos. Read each photo and extract its purchase as one transaction: description is the merchant name as printed, amount is the final total actually paid (after discounts, including taxes; never a subtotal, a line item, or the cash tendered), currencyCode from the printed currency or the merchant country, occurredAt from the printed date and time, type expense. Put every purchased item in items, one entry per printed line: description is the item name as printed and amount is the line total after that line\'s own discount; a line with a quantity and a unit price is one item whose amount is quantity times unit price. Fold receipt-wide discounts into the items they apply to so that the item amounts add up exactly to amount. Do not repeat the items in notes; leave notes null unless the receipt shows other useful information. Transactions that come only from the text have an empty items array. Set receiptIndexes to the 0-based positions of every photo the transaction came from; use an empty array for transactions that come from the text.'
            : 'The user message may also contain one or more receipt photos. Read each photo and extract its purchase as one transaction: description is the merchant name as printed, amount is the final total actually paid (after discounts, including taxes; never a subtotal, a line item, or the cash tendered), currencyCode from the printed currency or the merchant country, occurredAt from the printed date and time, type expense. Put every purchased item in notes, one per line, always with its price as printed: "item - price", or "item - quantity x unit price = line total" when the document prints a quantity and a unit price. Never list an item without a price. Set receiptIndexes to the 0-based positions of every photo the transaction came from; use an empty array for transactions that come from the text.',
```

The two remaining receipt strings (several photos per purchase; text overrides photo) stay unchanged.

- [ ] **Step 3: Normaliser**

In `normalizeTransactions`, before the `return {` inside the map add:

```js
      const items = (Array.isArray(transaction.items) ? transaction.items : [])
        .map((item) => ({ description: typeof item?.description === 'string' ? item.description.trim() : '', amount: Number(item?.amount) }))
        .filter((item) => item.description && Number.isFinite(item.amount))
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

**Interfaces:**
- Produces: `sumReceiptItems(items) -> number`, `reconcileReceiptItems(items, total) -> boolean`, `formatReceiptItemsAsNotes(items) -> string`, `expandReceiptItems(item, items) -> item`. Used by Tasks 7, 8, 9.

- [ ] **Step 1: Write the failing tests**

Write `front/tests/ReceiptItemUtils.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandReceiptItems, formatReceiptItemsAsNotes, reconcileReceiptItems, sumReceiptItems } from '../utils/ReceiptItemUtils.js'

const items = [
  { description: 'Milk', amount: 1.5 },
  { description: 'Bread', amount: '2.25' },
]

const draftItem = () => ({
  attributes: {
    transactions: [
      {
        amount: '3.75',
        description: 'Lidl',
        notes: '',
        tags: [{ id: 1 }],
        accountSource: { id: 9 },
        currency: { attributes: { decimal_places: 2 } },
      },
    ],
  },
})

test('sumReceiptItems adds numeric and string amounts and ignores junk', () => {
  assert.equal(sumReceiptItems(items), 3.75)
  assert.equal(sumReceiptItems([{ amount: 'x' }, { amount: 2 }]), 2)
  assert.equal(sumReceiptItems([]), 0)
})

test('reconcileReceiptItems accepts one cent per item of drift', () => {
  assert.equal(reconcileReceiptItems(items, '3.75'), true)
  assert.equal(reconcileReceiptItems(items, 3.77), true)
  assert.equal(reconcileReceiptItems(items, 3.78), false)
  assert.equal(reconcileReceiptItems(items, ''), false)
  assert.equal(reconcileReceiptItems(items, null), false)
})

test('formatReceiptItemsAsNotes renders one line per item', () => {
  assert.equal(formatReceiptItemsAsNotes(items), 'Milk - 1.5\nBread - 2.25')
})

test('expandReceiptItems returns the item untouched below two items', () => {
  const item = draftItem()
  assert.equal(expandReceiptItems(item, []), item)
  assert.equal(expandReceiptItems(item, [items[0]]), item)
})

test('expandReceiptItems clones the first split per item and sets the group title', () => {
  const item = draftItem()
  const expanded = expandReceiptItems(item, items)

  assert.equal(expanded.attributes.group_title, 'Lidl')
  assert.equal(expanded.attributes.transactions.length, 2)
  assert.deepEqual(
    expanded.attributes.transactions.map((split) => [split.description, split.amount]),
    [
      ['Milk', '1.50'],
      ['Bread', '2.25'],
    ],
  )
  assert.equal(expanded.attributes.transactions[1].accountSource.id, 9)
  assert.notEqual(expanded.attributes.transactions[0].tags, item.attributes.transactions[0].tags)
  assert.equal(item.attributes.transactions.length, 1)
  assert.equal(item.attributes.group_title, undefined)
})

test('expandReceiptItems falls back to two decimals without a currency', () => {
  const item = draftItem()
  delete item.attributes.transactions[0].currency
  const expanded = expandReceiptItems(item, [{ description: 'A', amount: 1 }, { description: 'B', amount: 2.5 }])
  assert.deepEqual(
    expanded.attributes.transactions.map((split) => split.amount),
    ['1.00', '2.50'],
  )
})
```

- [ ] **Step 2: Run the tests to see them fail**

From `front/`:

```bash
node --test tests/
```

Expected: failure with `Cannot find module '.../front/utils/ReceiptItemUtils.js'`.

- [ ] **Step 3: Implement the helpers**

Write `front/utils/ReceiptItemUtils.js`:

```js
import { cloneDeep, get } from 'lodash-es'

// Pure helpers for receipt line items. No store or Nuxt alias imports so they run under `node --test`.

export const sumReceiptItems = (items) => {
  return items.reduce((result, item) => result + (parseFloat(item.amount) || 0), 0)
}

// One cent of rounding per printed line is tolerated; anything larger means a discount or a line the model missed.
export const reconcileReceiptItems = (items, total) => {
  const parsedTotal = parseFloat(total)
  if (!Number.isFinite(parsedTotal)) {
    return false
  }
  return Math.abs(sumReceiptItems(items) - parsedTotal) <= 0.01 * items.length
}

export const formatReceiptItemsAsNotes = (items) => {
  return items.map((item) => `${item.description} - ${item.amount}`).join('\n')
}

// Turns a single-split draft into a Firefly group with one split per item. Every split inherits the first split's fields.
export const expandReceiptItems = (item, items) => {
  if (!items || items.length < 2) {
    return item
  }

  const expanded = cloneDeep(item)
  const firstSplit = expanded.attributes.transactions[0]
  const decimals = get(firstSplit, 'currency.attributes.decimal_places') ?? 2

  expanded.attributes.group_title = firstSplit.description
  expanded.attributes.transactions = items.map((receiptItem) => ({
    ...cloneDeep(firstSplit),
    description: receiptItem.description,
    amount: Number(receiptItem.amount).toFixed(decimals),
  }))

  return expanded
}
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
node --test tests/
```

Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 5: Lint**

```bash
npm run lint
```

Expected: success. If Prettier reformats the test file's nested arrays, accept its formatting for that file only.

- [ ] **Step 6: Commit**

```bash
git add front/utils/ReceiptItemUtils.js front/tests/ReceiptItemUtils.test.js
git commit -m "add receipt item helpers with node tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Build split drafts and write groups

**Files:**
- Modify: `front/composables/useTransactionAssistantDraft.js`
- Modify: `front/composables/useRambleDrafts.js` (`interpret`, `applyEditedDraft`, `create`)
- Modify: `front/transformers/TransactionTransformer.js:112-118`

**Interfaces:**
- Consumes: `profileStore.assistantSplitReceipts` (Task 4), `raw.items` (Task 5), helpers (Task 6).
- Produces: draft shape `{ id, assistant, item, items, splitFallbackReason, status, error, response }`; `buildReceiptDraft(item, rawItems, splitReceipts) -> { item, items, splitFallbackReason }`; `transformToApi` emits `group_title` for multi-split items. Tasks 8 and 9 read `items` and `splitFallbackReason`.

- [ ] **Step 1: `buildReceiptDraft`**

In `front/composables/useTransactionAssistantDraft.js`, add the import and the exported function:

```js
import { formatReceiptItemsAsNotes, reconcileReceiptItems } from '~/utils/ReceiptItemUtils.js'

// Decides whether a receipt draft becomes a split group. Falls back to items-in-notes whenever a split would be wrong.
export const buildReceiptDraft = (item, rawItems, splitReceipts) => {
  const items = splitReceipts ? (rawItems ?? []) : []
  const split = item.attributes.transactions[0]

  let splitFallbackReason = null
  if (items.length >= 2 && split.amountForeign) {
    // Per-split foreign amounts would need their own conversion and rounding; keep such receipts whole.
    splitFallbackReason = 'foreign_currency'
  } else if (items.length >= 2 && !reconcileReceiptItems(items, split.amount)) {
    splitFallbackReason = 'mismatch'
  }

  if (splitFallbackReason || items.length < 2) {
    if (items.length > 0 && !split.notes) {
      split.notes = formatReceiptItemsAsNotes(items)
    }
    return { item, items: [], splitFallbackReason }
  }

  return { item, items, splitFallbackReason: null }
}
```

- [ ] **Step 2: Use it in `interpret`**

In `front/composables/useRambleDrafts.js`:

- Change the import to `import { buildReceiptDraft, useTransactionAssistantDraft } from '~/composables/useTransactionAssistantDraft.js'`.
- Add `import { expandReceiptItems } from '~/utils/ReceiptItemUtils.js'`.
- In `interpret`, pass the setting to the request by adding `splitReceipts: profileStore.assistantSplitReceipts,` after `receiptImages`.
- Replace the `newDrafts.push({ ... })` block with:

```js
        const built = await buildTransactionItemFromAssistant(transaction)
        const { item, items, splitFallbackReason } = buildReceiptDraft(built, transaction.raw?.items, profileStore.assistantSplitReceipts)
        newDrafts.push({
          id: transaction.id,
          assistant: transaction,
          item,
          items,
          splitFallbackReason,
          status: draftStatus.pending,
          error: null,
          response: null,
        })
```

- [ ] **Step 3: Keep items through edits and expand on create**

In `applyEditedDraft`, add to the replaced object:

```js
      items: cloneDeep(editedDraft.items ?? []),
      splitFallbackReason: null,
```

In `create`, change the request line to:

```js
          const requestData = TransactionTransformer.transformToApi(expandReceiptItems(cloneDeep(drafts.value[index].item), drafts.value[index].items ?? []))
```

- [ ] **Step 4: `group_title` in the transformer**

In `front/transformers/TransactionTransformer.js`, replace the final `return { id, apply_rules: true, fire_webhooks: true, transactions }` of `transformToApi` with:

```js
    const result = {
      id,
      apply_rules: true,
      fire_webhooks: true,
      transactions,
    }

    // Firefly III rejects a multi-split group without a title; single splits keep the old body untouched.
    if (transactions.length > 1) {
      result.group_title = get(item, 'attributes.group_title')
    }

    return result
```

- [ ] **Step 5: Lint, build, tests**

```bash
npm run lint && npm run build && node --test tests/
```

Expected: all succeed.

- [ ] **Step 6: Manual check**

Setting on: scan a receipt with several items. Open the browser devtools network tab and press Create. Expected: the POST body to `api/transactions` has `group_title` equal to the merchant, and one entry per item under `transactions`, each with the item's description and amount; Firefly shows a split transaction with the receipt total. Scan a one-item receipt: a single transaction with the item in notes. Setting off: a single transaction with items in notes, and the POST body has no `group_title`.

- [ ] **Step 7: Commit**

```bash
git add front/composables/useTransactionAssistantDraft.js front/composables/useRambleDrafts.js front/transformers/TransactionTransformer.js
git commit -m "create receipt drafts as split transaction groups

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Preview shows the split and the fallback reason

**Files:**
- Modify: `front/components/transaction/ramble/ramble-transaction-item.vue`
- Modify: all eleven locale files (two fallback keys)

**Interfaces:**
- Consumes: `draft.items`, `draft.splitFallbackReason` (Task 7), `expandReceiptItems` (Task 6).

- [ ] **Step 1: i18n**

In every locale file, inside `"transaction"`, add after `"assistant_receipt_scan"`:

```json
    "assistant_ramble_split_fallback_mismatch": "Items did not add up to the total, so the receipt was kept as one transaction with the items in notes",
    "assistant_ramble_split_fallback_foreign_currency": "Receipts booked with a foreign amount are kept as one transaction with the items in notes",
```

Suggested translations: ro "Articolele nu s-au adunat la total, așa că bonul a rămas o singură tranzacție cu articolele în note" / "Bonurile cu sumă în valută rămân o singură tranzacție cu articolele în note"; de-DE "Die Artikel ergaben nicht die Gesamtsumme, daher bleibt der Beleg eine Buchung mit den Artikeln in den Notizen" / "Belege mit Fremdwährungsbetrag bleiben eine Buchung mit den Artikeln in den Notizen"; fr "Les articles ne correspondaient pas au total, le reçu reste une seule transaction avec les articles en notes" / "Les reçus en montant étranger restent une seule transaction avec les articles en notes"; it "Gli articoli non corrispondevano al totale, lo scontrino resta una sola transazione con gli articoli nelle note" / "Gli scontrini con importo in valuta estera restano una sola transazione con gli articoli nelle note"; es-MX "Los artículos no sumaban el total, así que el recibo quedó como una sola transacción con los artículos en notas" / "Los recibos con monto en moneda extranjera quedan como una sola transacción con los artículos en notas"; pt-BR "Os itens não somavam o total, então o recibo ficou como uma única transação com os itens nas notas" / "Recibos com valor em moeda estrangeira ficam como uma única transação com os itens nas notas"; pl "Pozycje nie sumowały się do kwoty, więc paragon pozostał jedną transakcją z pozycjami w notatkach" / "Paragony z kwotą w obcej walucie pozostają jedną transakcją z pozycjami w notatkach"; ru-RU "Позиции не сходятся с итогом, поэтому чек сохранён одной транзакцией с позициями в заметках" / "Чеки с суммой в иностранной валюте сохраняются одной транзакцией с позициями в заметках"; zh-CN "商品金额与总额不符，小票已保留为一笔交易，商品写入备注" / "外币金额的小票保留为一笔交易，商品写入备注"; ko "항목 합계가 총액과 맞지 않아 영수증을 하나의 거래로 유지하고 항목은 메모에 넣었습니다" / "외화 금액 영수증은 하나의 거래로 유지되며 항목은 메모에 들어갑니다".

Re-run the JSON parse loop.

- [ ] **Step 2: Render the expanded item and the reason**

In `front/components/transaction/ramble/ramble-transaction-item.vue`:

Template: change `<transaction-list-item :value="transaction.item" ...>` to `<transaction-list-item :value="expandedItem" ...>`, and add after the unmatched-category block:

```vue
    <div v-if="transaction.splitFallbackReason" class="text-size-12 text-muted px-3 pt-2">{{ $t(`transaction.assistant_ramble_split_fallback_${transaction.splitFallbackReason}`) }}</div>
```

Script: add `import { expandReceiptItems } from '~/utils/ReceiptItemUtils.js'` and

```js
const expandedItem = computed(() => expandReceiptItems(transaction.value.item, transaction.value.items ?? []))
```

- [ ] **Step 3: Lint, build, manual**

```bash
npm run lint && npm run build
```

Manual: a multi-item receipt draft shows the "Split" badge and the summed amount in the preview; a one-item receipt shows no badge; a receipt whose items the model could not reconcile shows the mismatch line (force it by scanning a receipt with a hand-written discount line if you have one, or temporarily edit an item amount in the devtools console).

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
- Modify: all eleven locale files (two keys)
- Modify: `front/assets/styles/theme-white.css` (one class)

**Interfaces:**
- Consumes: `sumReceiptItems`, `reconcileReceiptItems`, `formatReceiptItemsAsNotes` (Task 6); draft `items` (Task 7).
- Produces: `RambleReceiptItems` with model `items`, model `amount`, emit `merge`.

- [ ] **Step 1: i18n**

In every locale file, inside `"transaction"`, add after `"assistant_ramble_split_fallback_foreign_currency"`:

```json
    "assistant_ramble_merge_items": "Merge into one transaction",
    "assistant_ramble_items_mismatch": "The items must add up to the amount",
```

Suggested translations: ro "Unește într-o singură tranzacție" / "Articolele trebuie să se adune la sumă"; de-DE "Zu einer Buchung zusammenführen" / "Die Artikel müssen die Summe ergeben"; fr "Fusionner en une seule transaction" / "Les articles doivent correspondre au montant"; it "Unisci in una sola transazione" / "Gli articoli devono corrispondere all'importo"; es-MX "Combinar en una sola transacción" / "Los artículos deben sumar el monto"; pt-BR "Mesclar em uma única transação" / "Os itens devem somar o valor"; pl "Scal w jedną transakcję" / "Pozycje muszą sumować się do kwoty"; ru-RU "Объединить в одну транзакцию" / "Позиции должны сходиться с суммой"; zh-CN "合并为一笔交易" / "商品金额必须等于总额"; ko "하나의 거래로 병합" / "항목 합계가 금액과 같아야 합니다".

Re-run the JSON parse loop.

- [ ] **Step 2: Create the editor**

Write `front/components/transaction/ramble/ramble-receipt-items.vue`:

```vue
<template>
  <van-cell-group inset class="ramble-receipt-items">
    <div class="van-cell-group-title">{{ $t('items') }}</div>

    <div v-for="(item, index) in items" :key="index" class="flex-center-vertical gap-2 px-3 py-1">
      <app-field v-model="item.description" class="flex-1 van-cell-no-padding compact" label="" :placeholder="$t('description')" />
      <app-field v-model="item.amount" class="ramble-receipt-item-amount van-cell-no-padding compact" label="" inputmode="decimal" :placeholder="$t('amount')" @update:model-value="syncAmount" />
      <van-button round size="small" plain type="danger" class="cursor-pointer ramble-icon-button" :title="$t('delete')" @click="removeItem(index)">
        <van-icon name="delete-o" size="15" />
      </van-button>
    </div>

    <div class="flex-center-vertical gap-2 p-3">
      <div class="text-size-13 font-600 flex-1">{{ $t('total') }}: {{ total }}</div>
      <van-button round size="small" plain class="cursor-pointer" @click="emit('merge')">{{ $t('transaction.assistant_ramble_merge_items') }}</van-button>
    </div>
  </van-cell-group>
</template>

<script setup>
import { computed } from 'vue'
import { sumReceiptItems } from '~/utils/ReceiptItemUtils.js'

const emit = defineEmits(['merge'])
const items = defineModel({ type: Array, default: () => [] })
const amount = defineModel('amount', { type: [String, Number], default: '' })

const total = computed(() => sumReceiptItems(items.value).toFixed(2))

// The item list is the source of truth for the amount while items exist.
const syncAmount = () => {
  amount.value = total.value
}

const removeItem = (index) => {
  items.value = items.value.filter((_, itemIndex) => itemIndex !== index)
  syncAmount()
  if (items.value.length < 2) {
    emit('merge')
  }
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

No dark override is needed: the rule sets no colours.

- [ ] **Step 3: Wire the editor into the edit popup**

In `front/components/transaction/ramble/ramble-transaction-edit-popup.vue`:

Template: after `<transaction-form ... />` add:

```vue
        <ramble-receipt-items
          v-if="transaction?.items?.length > 0"
          v-model="transaction.items"
          v-model:amount="transaction.item.attributes.transactions[0].amount"
          @merge="onMergeItems"
        />
```

Script: add the imports and handlers:

```js
import RambleReceiptItems from '~/components/transaction/ramble/ramble-receipt-items.vue'
import { formatReceiptItemsAsNotes, reconcileReceiptItems } from '~/utils/ReceiptItemUtils.js'

const { t } = useI18n()

const onMergeItems = () => {
  const split = transaction.value.item.attributes.transactions[0]
  if (!split.notes && transaction.value.items.length > 0) {
    split.notes = formatReceiptItemsAsNotes(transaction.value.items)
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
  if (items.length > 0 && !reconcileReceiptItems(items, transaction.value.item.attributes.transactions[0].amount)) {
    UIUtils.showToastError(t('transaction.assistant_ramble_items_mismatch'))
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

Manual, setting on, multi-item receipt: open the draft. Expected: the Items card lists the items under the form; changing an item amount updates the Total line and the form's Amount field; deleting an item updates both; deleting down to one item removes the card and fills notes; the Merge button removes the card, fills notes, and leaves the amount; with items present, typing a different Amount in the form and saving shows the mismatch toast; saving with matching amounts closes the popup and the preview still shows the split badge with the new count. Create and confirm in Firefly. Check the card on desktop and mobile widths and in the dark theme.

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
- ✅ Snap a photo of a receipt with the camera button and let the assistant read it: the merchant, total and date are filled in, every purchased item becomes its own split with its price (or a line in the notes if you turn splitting off in Settings > Assistant), and the photo is attached to the transaction (uses the same OpenAI LLM configuration)
```

- [ ] **Step 2: Changelog**

At the top of `CHANGELOG.md`, after `# Changelog` and a blank line, insert:

```markdown
## 0.2.4-dev6

- Receipt scanning has its own popup: pick the photos and they are
  interpreted right away, with no Interpret step. The Dictate popup no
  longer accepts photos.
- A scanned receipt becomes one Firefly split transaction with one split
  per purchased item, each with its own price, adding up to the receipt
  total. Items can be edited, removed or merged back into one transaction
  in the draft popup before creating.
- New assistant setting "Split receipts into one transaction per item",
  on by default. Receipts whose items do not add up to the total, or that
  are booked with a foreign amount, are kept as one transaction with the
  items in notes.

```

- [ ] **Step 3: Version**

In `config.yaml` change `version: "0.2.4-dev5"` to `version: "0.2.4-dev6"`.

- [ ] **Step 4: Final verification**

From `front/`:

```bash
npm run lint && npm run build && node --test tests/
```

From the repo root:

```bash
for f in front/i18n/locales/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BROKEN $f"; done
git status --short
```

Expected: lint, build and tests pass; no `BROKEN` lines; only the intended files are modified. Then run through the spec's Verification list once end to end.

- [ ] **Step 5: Commit**

```bash
git add readme.md CHANGELOG.md config.yaml
git commit -m "bump version to 0.2.4-dev6 (0.2.4-dev6)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: shared composable (T1), shell (T2), receipt popup and strip and Dictate cleanup and phase-1 i18n (T3), setting (T4), prompt and normaliser (T5), helpers with tests (T6), draft building, edits, create, `group_title` (T7), preview and fallback text (T8), editor, merge, mismatch guard (T9), docs and release (T10). Nothing in the spec is left without a task.
- Naming used consistently across tasks: `useRambleDrafts`, `draftStatus`, `interpret`, `create`, `removeDraft`, `applyEditedDraft`, `reset`; `buildReceiptDraft`; `sumReceiptItems`, `reconcileReceiptItems`, `formatReceiptItemsAsNotes`, `expandReceiptItems`; draft fields `items`, `splitFallbackReason`; i18n keys as listed in the spec.
- Task 1 intentionally leaves `ramble.vue`'s template untouched and Task 2 rewrites it; an executor doing Task 1 alone still ships a working Dictate popup.
