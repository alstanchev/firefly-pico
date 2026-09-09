import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { get, keyBy } from 'lodash-es'
import { useLocalStorage } from '@vueuse/core'
import CategoryRepository from '~/repository/CategoryRepository'
import CategoryTransformer from '~/transformers/CategoryTransformer'
import { useProfileStore } from '~/stores/profileStore'
import Category from '~/models/Category'
import ResponseUtils from '~/utils/ResponseUtils'

export const useCategoryStore = defineStore('category', () => {
  const categoryList = useLocalStorage('categoryList', [])
  const isLoadingCategories = ref(false)

  const categoryDictionary = computed(() => {
    return keyBy(categoryList.value, 'id')
  })

  async function fetchCategories() {
    const profileStore = useProfileStore()
    if (!profileStore.categoriesEnabled) {
      categoryList.value = []
      return
    }
    isLoadingCategories.value = true
    const list = await new CategoryRepository().getAllWithMerge()
    categoryList.value = CategoryTransformer.transformFromApiList(list)
    isLoadingCategories.value = false
  }

  async function createCategory(name) {
    const item = new Category().getEmpty()
    item.attributes.name = name
    const response = await new CategoryRepository().insert(CategoryTransformer.transformToApi(item))
    if (!ResponseUtils.isSuccess(response)) return null
    const newItem = CategoryTransformer.transformFromApi(get(response, 'data.data'))
    categoryList.value = [newItem, ...categoryList.value]
    return newItem
  }

  return {
    categoryList,
    isLoadingCategories,
    categoryDictionary,
    fetchCategories,
    createCategory,
  }
})
