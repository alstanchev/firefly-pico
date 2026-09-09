<template>
  <app-select
    v-model="modelValue"
    v-model:show-dropdown="showDropdown"
    v-model:search="search"
    :label="label ?? $t('category')"
    class=""
    :popup-title="$t('category_select')"
    :list="filteredList"
    :columns="appStore.gridColumns"
    :get-display-value="getDisplayValue"
    :create-name="createName"
    :is-creating="isCreating"
    v-bind="dynamicAttrs"
    @create="onCreate"
  >
    <template #left-icon>
      <app-icon :icon="TablerIconConstants.category" :size="20" />
    </template>

    <template #top-right>
      <van-button size="small" class="" @click="onRefresh">
        <app-icon :icon="TablerIconConstants.refresh" :stroke="1.7" size="14" />
      </van-button>
    </template>

    <template #item="{ item }">
      <app-select-option :text="Category.getDisplayName(item)" :icon="Category.getIcon(item) ?? TablerIconConstants.category" />
    </template>

    <template #inputItemContent="{ item }">
      <div class="flex-center gap-1">
        <app-icon :icon="Category.getIcon(item) ?? TablerIconConstants.category" :size="18" />
        <span class="font-weight-400 text-size-12">{{ getDisplayValue(item) }}</span>
      </div>
    </template>
  </app-select>
</template>

<script setup>
import { useCategoryStore } from '~/stores/categoryStore'
import { useFormAttributes } from '~/composables/useFormAttributes'
import { IconRefresh } from '@tabler/icons-vue'
import Category from '~/models/Category'

import TablerIconConstants from '~/constants/TablerIconConstants'
import Tag from '~/models/Tag.js'
import LanguageUtils from '~/utils/LanguageUtils.js'

const categoryStore = useCategoryStore()
const profileStore = useProfileStore()
const appStore = useAppStore()
const attrs = useAttrs()
const { dynamicAttrs } = useFormAttributes(attrs)

const { t } = useI18n()

const props = defineProps({
  label: {
    type: String,
  },
  canCreate: {
    type: Boolean,
    default: false,
  },
})

const modelValue = defineModel()
const showDropdown = ref(false)
const search = ref('')
const suggestedSearch = defineModel('suggestedSearch', { type: String, default: null })

const list = computed(() => categoryStore.categoryList)

const filteredList = computed(() => {
  if (search.value.length === 0) {
    return list.value
  }
  return list.value.filter((item) => {
    return Category.getDisplayName(item).toUpperCase().indexOf(search.value.toUpperCase()) !== -1
  })
})

const createName = computed(() => {
  if (!props.canCreate) return null
  let name = search.value.trim()
  if (!name) return null
  if (profileStore.lowerCaseCategoryName) name = name.toLowerCase()
  if (profileStore.stripAccents) name = LanguageUtils.removeAccents(name)
  const key = LanguageUtils.removeAccentsAndLowerCase(name)
  const exists = categoryStore.categoryList.some((item) => LanguageUtils.removeAccentsAndLowerCase(Category.getDisplayName(item)) === key)
  return exists ? null : name
})

watch(
  () => [showDropdown.value, suggestedSearch.value],
  ([isOpen, suggestion]) => {
    if (isOpen && suggestion) search.value = suggestion
  },
)

// ------ Methods ------

const onSelectCell = (value) => {
  modelValue.value = value
  showDropdown.value = false
  suggestedSearch.value = null
}

const getDisplayValue = (value) => {
  return Category.getDisplayName(value)
}

const isLoading = ref(false)
const onRefresh = async () => {
  isLoading.value = true
  await categoryStore.fetchCategories()
  isLoading.value = false
}

const isCreating = ref(false)
const onCreate = async (name) => {
  if (isCreating.value) return
  isCreating.value = true
  const typed = search.value.trim()
  const newItem = await categoryStore.createCategory(name)
  isCreating.value = false
  if (!newItem) return
  if (search.value.trim() === typed) search.value = ''
  onSelectCell(newItem)
  suggestedSearch.value = null
}
</script>
