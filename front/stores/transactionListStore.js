import { defineStore } from 'pinia'
import { ref } from 'vue'

// Remembers the transactions currently loaded in the list page, in order, so the transaction page can step to the
// previous / next one (swipe on mobile, arrows on desktop) and show a transaction instantly while it refreshes it from
// the backend. Holds a reference to the list page's own array, nothing is copied or persisted.
export const useTransactionListStore = defineStore('transactionList', () => {
  const items = ref([])

  const setItems = (newItems) => {
    items.value = newItems
  }

  const findIndex = (id) => items.value.findIndex((item) => String(item.id) === String(id))

  const getItem = (id) => items.value[findIndex(id)] ?? null

  const getNeighbourId = (id, offset) => {
    const index = findIndex(id)
    if (index === -1) {
      return null
    }
    return items.value[index + offset]?.id ?? null
  }

  const getPreviousId = (id) => getNeighbourId(id, -1)
  const getNextId = (id) => getNeighbourId(id, 1)

  return {
    items,
    setItems,
    getItem,
    getPreviousId,
    getNextId,
  }
})
