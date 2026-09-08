<template>
  <div class="app-form">
    <app-top-toolbar />

    <van-form class="" @submit="onSave">
      <van-cell-group inset>
        <div class="van-cell-group-title">{{ $t('settings.general') }}:</div>

        <app-boolean v-model="autoFocusAssistant" :label="$t('settings.assistant.auto_focus')" />
        <app-field v-model="assistantTodoTagMatcher" :icon="TablerIconConstants.fieldText2" :label="$t('settings.assistant.substring_todo_tag')" :rules="[rule.required()]" required />
        <currency-select v-model="assistantCurrency" :info="$t('settings.assistant.currency')" />
      </van-cell-group>

      <van-cell-group inset>
        <div class="p-3 display-flex flex-column gap-3">
          <div class="flex-center-vertical gap-2">
            <div class="ramble-header-icon flex-center">
              <app-icon :icon="TablerIconConstants.ramble" :size="20" :stroke="1.6" />
            </div>
            <div class="flex-1-w">
              <div class="font-600 text-size-14 line-height-normal">{{ $t('settings.assistant.llm_status') }}</div>
              <div class="text-size-12 text-muted">{{ $t('settings.assistant.llm_status_subtitle') }}</div>
            </div>
          </div>
          <div class="display-flex">
            <div class="llm-status-pill" :class="appStore.llmIsConfigured ? 'llm-status-pill-on' : 'llm-status-pill-off'">
              <span class="llm-status-dot" />
              {{ appStore.llmIsConfigured ? $t('settings.assistant.llm_configured') : $t('settings.assistant.llm_not_configured') }}
            </div>
          </div>
          <div v-if="appStore.llmIsConfigured" class="llm-detail-panel">
            <div class="llm-detail-row">
              <app-icon :icon="TablerIconConstants.external" :size="16" />
              <span class="llm-detail-label text-muted">{{ $t('settings.assistant.ramble_endpoint') }}</span>
              <span class="llm-detail-value cursor-pointer" :title="appStore.llmEndpoint" @click="showFullDetailValue(appStore.llmEndpoint)">{{ appStore.llmEndpoint }}</span>
            </div>
            <div class="llm-detail-row">
              <app-icon :icon="TablerIconConstants.magic" :size="16" />
              <span class="llm-detail-label text-muted">{{ $t('settings.assistant.ramble_model') }}</span>
              <span class="llm-detail-value cursor-pointer" :title="effectiveLlmModel" @click="showFullDetailValue(effectiveLlmModel)">{{ effectiveLlmModel }}</span>
            </div>
          </div>

          <app-select
            v-if="llmModels.length > 0"
            v-model="assistantLlmModel"
            v-model:show-dropdown="isDropdownLlmModelVisible"
            v-model:search="llmModelSearch"
            :label="$t('settings.assistant.llm_model_select')"
            :popup-title="$t('settings.assistant.llm_model_select_title')"
            :placeholder="$t('settings.assistant.llm_model_server_default', { model: appStore.llmModel })"
            :list="filteredLlmModels"
            :columns="1"
            :has-search="true"
          />

          <app-text-area
            v-model="assistantLlmContext"
            class="assistant-llm-context"
            :label="$t('settings.assistant.llm_context')"
            :placeholder="$t('settings.assistant.llm_context_placeholder')"
            :visible-lines="2"
          />

          <div v-if="appStore.llmIsConfigured" class="display-flex flex-column gap-2">
            <div class="flex-center">
              <van-button round size="small" plain :loading="isTestingLlm" @click="testLlm">
                <app-icon :icon="TablerIconConstants.magic" :size="16" />
                {{ $t('settings.assistant.llm_test') }}
              </van-button>
            </div>
            <div v-if="llmTestResult" class="llm-test-result word-break-word" :class="llmTestResult.success ? 'llm-test-result-ok' : 'llm-test-result-error'">{{ llmTestResult.message }}</div>
          </div>

          <template v-else>
            <div class="text-size-13 text-muted">{{ $t('settings.assistant.llm_not_configured_info') }}</div>
            <div class="display-flex flex-wrap gap-1">
              <div class="llm-env-chip">ASSISTANT_LLM_ENDPOINT</div>
              <div class="llm-env-chip">ASSISTANT_LLM_MODEL</div>
              <div class="llm-env-chip">ASSISTANT_LLM_API_KEY</div>
              <div class="llm-env-chip">ASSISTANT_LLM_CONTEXT</div>
            </div>
          </template>
        </div>
      </van-cell-group>

      <van-cell-group inset>
        <div class="p-3 display-flex flex-column gap-3">
          <div class="flex-center-vertical gap-2">
            <div class="ramble-header-icon flex-center">
              <app-icon :icon="TablerIconConstants.microphone" :size="20" :stroke="1.6" />
            </div>
            <div class="flex-1-w">
              <div class="font-600 text-size-14 line-height-normal">{{ $t('settings.assistant.transcription_status') }}</div>
              <div class="text-size-12 text-muted">{{ $t('settings.assistant.transcription_status_subtitle') }}</div>
            </div>
          </div>
          <div class="display-flex">
            <div class="llm-status-pill" :class="appStore.transcriptionIsConfigured ? 'llm-status-pill-on' : 'llm-status-pill-off'">
              <span class="llm-status-dot" />
              {{ appStore.transcriptionIsConfigured ? $t('settings.assistant.llm_configured') : $t('settings.assistant.llm_not_configured') }}
            </div>
          </div>
          <div v-if="appStore.transcriptionIsConfigured" class="llm-detail-panel">
            <div class="llm-detail-row">
              <app-icon :icon="TablerIconConstants.external" :size="16" />
              <span class="llm-detail-label text-muted">{{ $t('settings.assistant.transcription_endpoint') }}</span>
              <span class="llm-detail-value cursor-pointer" :title="appStore.transcriptionEndpoint" @click="showFullDetailValue(appStore.transcriptionEndpoint)">{{
                appStore.transcriptionEndpoint
              }}</span>
            </div>
            <div class="llm-detail-row">
              <app-icon :icon="TablerIconConstants.magic" :size="16" />
              <span class="llm-detail-label text-muted">{{ $t('settings.assistant.transcription_model') }}</span>
              <span class="llm-detail-value cursor-pointer" :title="appStore.transcriptionModel" @click="showFullDetailValue(appStore.transcriptionModel)">{{ appStore.transcriptionModel }}</span>
            </div>
            <div class="llm-detail-row">
              <app-icon :icon="TablerIconConstants.language" :size="16" />
              <span class="llm-detail-label text-muted">{{ $t('settings.assistant.transcription_language') }}</span>
              <span class="llm-detail-value">{{ appStore.transcriptionLanguage || $t('settings.assistant.transcription_language_auto') }}</span>
            </div>
          </div>

          <div v-if="appStore.transcriptionIsConfigured && !appStore.transcriptionLanguage" class="text-size-12 text-muted">{{ $t('settings.assistant.transcription_language_info') }}</div>

          <div v-if="appStore.transcriptionIsConfigured" class="display-flex flex-column gap-2">
            <div class="flex-center">
              <van-button round size="small" plain :loading="isTestingTranscription" @click="testTranscription">
                <app-icon :icon="TablerIconConstants.microphone" :size="16" />
                {{ $t('settings.assistant.transcription_test') }}
              </van-button>
            </div>
            <div v-if="transcriptionTestResult" class="llm-test-result word-break-word" :class="transcriptionTestResult.success ? 'llm-test-result-ok' : 'llm-test-result-error'">
              {{ transcriptionTestResult.message }}
            </div>
          </div>

          <template v-else>
            <div class="text-size-13 text-muted">{{ $t('settings.assistant.llm_not_configured_info') }}</div>
            <div class="display-flex flex-wrap gap-1">
              <div class="llm-env-chip">ASSISTANT_TRANSCRIPTION_ENDPOINT</div>
              <div class="llm-env-chip">ASSISTANT_TRANSCRIPTION_MODEL</div>
              <div class="llm-env-chip">ASSISTANT_TRANSCRIPTION_API_KEY</div>
              <div class="llm-env-chip">ASSISTANT_TRANSCRIPTION_LANGUAGE</div>
            </div>
          </template>
        </div>
      </van-cell-group>

      <app-button-form-save />
    </van-form>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useProfileStore } from '~/stores/profileStore'
import UIUtils from '~/utils/UIUtils'
import { useToolbar } from '~/composables/useToolbar'
import RouteConstants from '~/constants/RouteConstants'
import TablerIconConstants from '~/constants/TablerIconConstants.js'
import { saveSettingsToStore, watchSettingsStore } from '~/utils/SettingUtils.js'
import { rule } from '~/utils/ValidationUtils.js'
import AssistantRepository from '~/repository/AssistantRepository.js'

const { t } = useI18n()
const profileStore = useProfileStore()
const appStore = useAppStore()

const assistantTodoTagMatcher = ref('')
const assistantCurrency = ref(null)
const autoFocusAssistant = ref(false)
const assistantLlmContext = ref('')
const isTestingLlm = ref(false)
const isTestingTranscription = ref(false)
const assistantLlmModel = ref('')
const llmModels = ref([])
const llmModelSearch = ref('')
const isDropdownLlmModelVisible = ref(false)
const llmTestResult = ref(null)
const transcriptionTestResult = ref(null)

// Ids the provider lists but which cannot answer a chat request. The list itself is never hardcoded.
const hiddenModelPattern = /whisper|tts|transcribe|embedding|dall-e|moderation|realtime|image/i

const effectiveLlmModel = computed(() => assistantLlmModel.value || appStore.llmModel)

const filteredLlmModels = computed(() => {
  const search = llmModelSearch.value.trim().toUpperCase()
  return search ? llmModels.value.filter((id) => id.toUpperCase().includes(search)) : llmModels.value
})

const syncedSettings = [
  { store: profileStore, path: 'autoFocusAssistant', ref: autoFocusAssistant },
  { store: profileStore, path: 'assistantTodoTagMatcher', ref: assistantTodoTagMatcher },
  { store: profileStore, path: 'assistantCurrency', ref: assistantCurrency },
  { store: profileStore, path: 'assistantLlmContext', ref: assistantLlmContext },
  { store: profileStore, path: 'assistantLlmModel', ref: assistantLlmModel },
]

watchSettingsStore(syncedSettings)

const onSave = async () => {
  saveSettingsToStore(syncedSettings)
  const response = await profileStore.writeProfile()
  if (ResponseUtils.isSuccess(response)) {
    UIUtils.showToastSuccess(t('settings.settings_saved'))
  }
}

// Desktop gets the native title tooltip on hover; on mobile a tap shows the full value.
const showFullDetailValue = (value) => {
  if (!value) {
    return
  }

  UIUtils.showToast(value, 'primary', 3000)
}

const loadLlmModels = async () => {
  if (!appStore.llmIsConfigured) {
    return
  }

  const response = await new AssistantRepository().getModels()
  if (ResponseUtils.isSuccess(response)) {
    llmModels.value = (response.data?.data ?? []).filter((id) => !hiddenModelPattern.test(id))
    return
  }

  llmModels.value = []
  llmTestResult.value = { success: false, message: `${t('settings.assistant.llm_models_load_failed')}: ${response?.data?.message ?? ''}`.trim() }
}

// The LLM config arrives asynchronously with the app info, so load the list once it is known.
watch(
  () => appStore.llmIsConfigured,
  (isConfigured) => {
    if (isConfigured && llmModels.value.length === 0) {
      loadLlmModels()
    }
  },
  { immediate: true },
)

const testLlm = async () => {
  isTestingLlm.value = true
  llmTestResult.value = null
  const response = await new AssistantRepository().testLlm(assistantLlmModel.value)
  isTestingLlm.value = false

  const success = ResponseUtils.isSuccess(response)
  const message = success ? t('settings.assistant.llm_test_success') : (response?.data?.message ?? t('settings.assistant.llm_test_failed'))
  llmTestResult.value = { success, message }
  if (success) {
    UIUtils.showToastSuccess(message)
  } else {
    UIUtils.showToastError(message)
  }
}

const testTranscription = async () => {
  isTestingTranscription.value = true
  transcriptionTestResult.value = null
  const response = await new AssistantRepository().testTranscription()
  isTestingTranscription.value = false

  const success = ResponseUtils.isSuccess(response)
  const message = success ? t('settings.assistant.transcription_test_success') : (response?.data?.message ?? t('settings.assistant.transcription_test_failed'))
  transcriptionTestResult.value = { success, message }
  if (success) {
    UIUtils.showToastSuccess(message)
  } else {
    UIUtils.showToastError(message)
  }
}

const toolbar = useToolbar()
toolbar.init({
  title: t('settings.assistant.title'),
  backRoute: RouteConstants.ROUTE_SETTINGS,
  backRouteDesktop: RouteConstants.ROUTE_SETTINGS,
})

onMounted(() => {
  animateSettings()
})
</script>
