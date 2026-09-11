<template>
  <van-badge v-if="appStore.llmIsConfigured" :content="savedRamblesCount" :show-zero="false" max="99" class="ramble-modern-badge">
    <van-button size="small" class="cursor-pointer ramble-trigger-button" @click="openRamblePopup">
      <app-icon :icon="TablerIconConstants.ramble" :size="16" />
    </van-button>
  </van-badge>

  <ramble-drafts-popup
    ref="draftsPopupRef"
    v-model:show="showRamblePopup"
    :icon="TablerIconConstants.ramble"
    :title="$t('transaction.assistant_ramble_title')"
    :subtitle="savedRamblesCount > 0 ? $t('transaction.assistant_ramble_saved_count', { count: savedRamblesCount }) : $t('transaction.assistant_ramble_input_hint')"
    :empty-hint="$t('transaction.assistant_ramble_no_transactions_yet')"
    @created="onCreated"
  >
    <template #default="{ isInterpreting }">
      <ramble-input-card
        ref="inputCardRef"
        v-model="rambleText"
        :saved-rambles="savedRambles"
        :saved-rambles-count="savedRamblesCount"
        :is-loading-saved="isLoadingSavedRambles"
        :is-deleting-saved="isDeletingLoadedSavedRambles"
        :is-interpreting="isInterpreting"
        :is-disabled="isInterpreting"
        @interpret="interpretRambleText"
        @load-saved="fetchSavedRambles"
        @delete-saved="deleteLoadedSavedRambles"
        @delete-ramble="deleteSavedRamble"
      />
    </template>
  </ramble-drafts-popup>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import RouteConstants from '~/constants/RouteConstants'
import TablerIconConstants from '~/constants/TablerIconConstants.js'
import AssistantRepository from '~/repository/AssistantRepository.js'
import RambleDraftsPopup from '~/components/transaction/ramble/ramble-drafts-popup.vue'
import RambleInputCard from '~/components/transaction/ramble/ramble-input-card.vue'
import UIUtils from '~/utils/UIUtils.js'

const props = defineProps({
  assistantText: {
    type: String,
    default: '',
  },
})

const { t } = useI18n()
const appStore = useAppStore()
const assistantRepository = new AssistantRepository()

const showRamblePopup = ref(false)
const rambleText = ref('')
const savedRambles = ref([])
const loadedSavedRambleIds = ref([])
const savedRamblesCount = ref(0)
const isLoadingSavedRambles = ref(false)
const isDeletingLoadedSavedRambles = ref(false)
const inputCardRef = ref(null)
const draftsPopupRef = ref(null)
const rambleSessionId = ref(0)

const hasLoadedSavedRambles = computed(() => loadedSavedRambleIds.value.length > 0)

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

const closeRamblePopup = () => {
  // The showRamblePopup watcher resets the ramble state on any close, overlay taps included.
  showRamblePopup.value = false
}

const resetRamble = () => {
  rambleSessionId.value += 1
  rambleText.value = ''
  savedRambles.value = []
  loadedSavedRambleIds.value = []
  isLoadingSavedRambles.value = false
  isDeletingLoadedSavedRambles.value = false
}

const interpretRambleText = () => {
  return draftsPopupRef.value?.interpret({ text: rambleText.value, savedRambles: savedRambles.value })
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

watch(showRamblePopup, (newValue) => {
  if (!newValue) {
    inputCardRef.value?.stopRecording()
    resetRamble()
  }
})

onMounted(async () => {
  await refreshSavedRambleCount({ showLoading: false })
})
</script>
