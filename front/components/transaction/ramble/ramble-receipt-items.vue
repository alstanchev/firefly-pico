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
