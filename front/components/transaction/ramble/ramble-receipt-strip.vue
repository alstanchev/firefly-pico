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
