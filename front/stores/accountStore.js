import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { get, keyBy, head } from 'lodash-es'
import { useLocalStorage } from '@vueuse/core'
import AccountRepository from '~/repository/AccountRepository'
import AccountTransformer from '~/transformers/AccountTransformer'
import Account from '~/models/Account'
import ResponseUtils from '~/utils/ResponseUtils'
import { useCurrencyStore } from '~/stores/currencyStore'
import DateUtils from '~/utils/DateUtils.js'
import { startOfTomorrow } from 'date-fns/startOfTomorrow'

export const useAccountStore = defineStore('account', () => {
  const accountList = useLocalStorage('accountList', [])
  const isLoadingAccounts = ref(false)

  const accountDictionary = computed(() => {
    return keyBy(accountList.value, 'id')
  })

  async function fetchAccounts() {
    isLoadingAccounts.value = true
    let filters = [{ field: 'date', value: DateUtils.dateToString(startOfTomorrow()) }]
    let list = await new AccountRepository().getAllWithMerge({ filters })
    const allowedTypes = [Account.types.asset, Account.types.expense, Account.types.revenue, Account.types.liability].map((item) => item.fireflyCode)
    list = list.filter((item) => allowedTypes.includes(item?.attributes?.type) && Account.getIsActive(item))
    accountList.value = AccountTransformer.transformFromApiList(list)
    isLoadingAccounts.value = false
  }

  async function createAccount(name, type) {
    const item = Account.getNew(name, type)
    item.attributes.currency = useCurrencyStore().defaultCurrency
    const response = await new AccountRepository().insert(AccountTransformer.transformToApi(item))
    if (!ResponseUtils.isSuccess(response)) return null
    const newItem = AccountTransformer.transformFromApi(get(response, 'data.data'))
    if (!newItem) return null
    accountList.value = [newItem, ...accountList.value]
    return newItem
  }

  return {
    accountList,
    isLoadingAccounts,
    accountDictionary,
    fetchAccounts,
    createAccount,
  }
})
