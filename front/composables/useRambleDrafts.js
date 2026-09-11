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
  // True once a draft was edited, removed or created since the last interpretation: a re-scan would lose work.
  const hasEditedDrafts = ref(false)
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
    hasEditedDrafts.value = false
    error.value = ''
    currentCreateIndex.value = 0
  }

  const interpret = async ({ text = '', savedRambles = [], receipts = [], splitReceipts = false }) => {
    const hasSavedText = savedRambles.some((ramble) => ramble.text?.trim())
    if (!text.trim() && !hasSavedText && receipts.length === 0) {
      return
    }

    const session = sessionId.value
    // A re-scan replaces the drafts, so the body shows the interpreting state rather than stale drafts and a live Create button.
    drafts.value = []
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
      hasEditedDrafts.value = false
    } catch (requestError) {
      if (session !== sessionId.value) {
        return
      }
      drafts.value = []
      error.value = getInterpretErrorMessage(requestError)
      hasInterpreted.value = true
      hasEditedDrafts.value = false
    } finally {
      if (session === sessionId.value) {
        isInterpreting.value = false
      }
    }
  }

  const removeDraft = (draft) => {
    drafts.value = drafts.value.filter((existing) => existing.id !== draft.id)
    hasEditedDrafts.value = true
  }

  const applyEditedDraft = (editedDraft) => {
    const index = drafts.value.findIndex((draft) => draft.id === editedDraft.id)
    if (index < 0) {
      return
    }
    const existing = drafts.value[index]
    const keepsSuccess = existing.status === draftStatus.success
    hasEditedDrafts.value = true
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
            // A created draft is work a re-scan would throw away (and could duplicate).
            hasEditedDrafts.value = true
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
    hasEditedDrafts,
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
