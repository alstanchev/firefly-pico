<template>
  <van-cell-group inset class="no-margin overflow-hidden">
    <div class="p-3 display-flex flex-column gap-2">
      <div v-if="receipts.length > 0" class="display-flex flex-wrap gap-2">
        <div v-for="receipt in receipts" :key="receipt.id" class="ramble-receipt-thumb cursor-pointer" :title="$t('transaction.assistant_receipt_recrop')" @click="onRecrop(receipt)">
          <img :src="receipt.dataUrl" :alt="$t('transaction.assistant_ramble_receipt')" />
          <div class="ramble-receipt-crop flex-center">
            <app-icon :icon="TablerIconConstants.crop" :size="12" />
          </div>
          <van-button round size="mini" type="danger" class="cursor-pointer ramble-receipt-remove" :disabled="isDisabled" :title="$t('delete')" @click.stop="removeReceipt(receipt)">
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

const emit = defineEmits(['add', 'scan', 'recrop'])
const receipts = defineModel({ type: Array, default: () => [] })

const onRecrop = (receipt) => {
  if (!props.isDisabled) {
    emit('recrop', receipt)
  }
}

const removeReceipt = (receipt) => {
  receipts.value = receipts.value.filter((item) => item.id !== receipt.id)
}
</script>
