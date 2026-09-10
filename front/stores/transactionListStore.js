import { defineStore } from 'pinia'
import { ref } from 'vue'

// Remembers the order of the transactions currently loaded in the list page, so the transaction page can step to the
// previous / next one (swipe on mobile, arrows on desktop). Only ids are kept => the page still fetches each transaction.
export const useTransactionListStore = defineStore('transactionList', () => {
  const ids = ref([])

  const setIds = (newIds) => {
    ids.value = newIds
  }

  const getNeighbourId = (id, offset) => {
    const index = ids.value.findIndex((item) => String(item) === String(id))
    if (index === -1) {
      return null
    }
    return ids.value[index + offset] ?? null
  }

  const getPreviousId = (id) => getNeighbourId(id, -1)
  const getNextId = (id) => getNeighbourId(id, 1)

  return {
    ids,
    setIds,
    getPreviousId,
    getNextId,
  }
})
