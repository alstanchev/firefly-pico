<template>
  <div ref="swipeRef" class="app-form">
    <app-top-toolbar>
      <template #right>
        <div class="flex-center-vertical gap-1">
          <template v-if="hasNeighbourNavigation && appStore.isDesktopLayout">
            <van-button size="small" class="cursor-pointer" :disabled="!previousId" @click="onPrevious">
              <icon-chevron-left :size="16" :stroke="1.9" />
            </van-button>
            <van-button size="small" class="cursor-pointer" :disabled="!nextId" @click="onNext">
              <icon-chevron-right :size="16" :stroke="1.9" />
            </van-button>
          </template>

          <app-button-list-add v-if="itemId" @click="onNew" />
        </div>
      </template>
    </app-top-toolbar>

    <div class="mb-10" />

    <transaction-assistant v-if="!itemId && !isCloning" v-model="assistantText" @change="onAssistant" @keyup.enter="saveItem" />

    <div ref="swipeContentRef">
      <transaction-form ref="transactionFormRef" v-model="item" :form-name="formName" :disabled="isViewMode" @submit="saveItem" @failed="onValidationError">
        <template #actions>
          <div style="margin: 16px; position: relative">
            <app-button-form-delete v-if="itemId && !isSplitTransaction" class="mt-10" @click="onDelete" />

            <div class="display-flex gap-1">
              <van-button v-if="itemId && !isSplitTransaction" block type="default" class="mt-2 flex-1 cursor-pointer" @click="onCreateClone">
                <app-icon :icon="TablerIconConstants.clone" />
                {{ $t('clone') }}
              </van-button>

              <van-button v-if="itemId && !isSplitTransaction" block type="default" class="mt-2 flex-1 cursor-pointer" @click="onCreateTransactionTemplate">
                <app-icon :icon="TablerIconConstants.transactionTemplate" />
                {{ $t('transaction.make_template') }}
              </van-button>
            </div>
          </div>

          <app-button-form-save v-if="isViewMode && !isSplitTransaction" :label="$t('edit')" native-type="button" @click="isEditing = true" />
          <app-button-form-save v-else-if="!isSplitTransaction" />
        </template>
      </transaction-form>
    </div>

    <app-card-info v-if="!isSplitTransaction" style="order: 99">
      <app-field-link :label="$t('transaction.configure_fields')" :icon="TablerIconConstants.settings" @click="navigateTo(RouteConstants.ROUTE_SETTINGS_TRANSACTION_FORM_FIELDS)" />
    </app-card-info>
  </div>
</template>

<script setup>
import RouteConstants from '~/constants/RouteConstants'

import { get } from 'lodash-es'
import { ref } from 'vue'
import { useForm, useFormEvent } from '~/composables/useForm'
import Transaction from '~/models/Transaction'
import { useToolbar } from '~/composables/useToolbar'
import TablerIconConstants from '~/constants/TablerIconConstants'
import { animateTransactionForm } from '~/utils/AnimationUtils.js'
import TransactionRepository from '~/repository/TransactionRepository.js'
import TransactionTransformer from '~/transformers/TransactionTransformer.js'
import { useI18n } from '#imports'
import TransactionForm from '~/components/transaction/TransactionForm.vue'
import { useTransactionListStore } from '~/stores/transactionListStore.js'
import { useSwipeNavigation } from '~/composables/useSwipeNavigation.js'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-vue'

const route = useRoute()
const appStore = useAppStore()
const transactionListStore = useTransactionListStore()

const assistantText = ref('')
const transactionFormRef = ref(null)
const isEditing = ref(false)

const { itemId, item, saveItem, onDelete, onNew, onValidationError, formName } = useForm({
  routeList: RouteConstants.ROUTE_TRANSACTION_LIST,
  routeForm: RouteConstants.ROUTE_TRANSACTION_ID,
  model: new Transaction(),
  resetFields: () => {
    assistantText.value = ''
  },
  onEvent: (event) => {
    if (event === useFormEvent.postSave) {
      isEditing.value = false
    }
  },
})

const onAssistant = async (assistantTransaction) => {
  await transactionFormRef.value?.applyAssistantTransaction(assistantTransaction)
}

const onCreateTransactionTemplate = async () => {
  await navigateTo(`${RouteConstants.ROUTE_TRANSACTION_TEMPLATE_ID}?transaction_id=${itemId.value}`)
}
const onCreateClone = async () => {
  await navigateTo(`${RouteConstants.ROUTE_TRANSACTION_ID}?transaction_id=${itemId.value}`)
}

const isCloning = computed(() => !!get(route.query, 'transaction_id'))
const isSplitTransaction = computed(() => Transaction.isSplitPayment(item.value))
// route.params.id is available before the fetch resolves, so an existing transaction never flashes as an enabled "add" form
const hasItemId = computed(() => !!itemId.value || !!route.params.id)
const isViewMode = computed(() => hasItemId.value && !isCloning.value && !isEditing.value)

// ----- Previous / next transaction (view mode only), following the order of the transaction list -----

const swipeRef = ref(null)
const swipeContentRef = ref(null)
const previousId = computed(() => (isViewMode.value ? transactionListStore.getPreviousId(route.params.id) : null))
const nextId = computed(() => (isViewMode.value ? transactionListStore.getNextId(route.params.id) : null))
const hasNeighbourNavigation = computed(() => !!previousId.value || !!nextId.value)

const navigateToTransaction = async (id) => {
  if (!id) {
    return
  }
  // Replace instead of push, so the back button still returns to the transaction list
  await navigateTo(`${RouteConstants.ROUTE_TRANSACTION_ID}/${id}`, { replace: true })
}
const onPrevious = () => navigateToTransaction(previousId.value)
const onNext = () => navigateToTransaction(nextId.value)

const { animateEnter } = useSwipeNavigation({
  swipeRef,
  contentRef: swipeContentRef,
  isEnabled: isViewMode,
  hasPrevious: computed(() => !!previousId.value),
  hasNext: computed(() => !!nextId.value),
  onPrevious,
  onNext,
})

const { t } = useI18n()
const title = computed(() => {
  if (isCloning.value) {
    return t('transaction.title_clone_transaction')
  }
  if (isSplitTransaction.value) {
    return t('transaction.title_split_details')
  }
  if (!hasItemId.value) {
    return t('transaction.title_add_transaction')
  }
  return isEditing.value ? t('transaction.title_edit_transaction') : t('transaction.title_view_transaction')
})

const toolbar = useToolbar()
toolbar.init({
  title: title,
  backRoute: RouteConstants.ROUTE_TRANSACTION_LIST,
})

onMounted(async () => {
  cloneTransactions()
  if (!(await animateEnter())) {
    animateTransactionForm()
  }
})

const cloneTransactions = async () => {
  const cloneId = get(route.query, 'transaction_id')
  if (!cloneId) {
    return
  }

  let cloneItem = await new TransactionRepository().getOne(cloneId)
  cloneItem = TransactionTransformer.transformFromApi(cloneItem.data)

  delete cloneItem.id
  item.value = cloneItem
}
</script>
