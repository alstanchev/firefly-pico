<template>
  <app-select
    v-model="modelValue"
    v-model:show-dropdown="showDropdown"
    v-model:search="search"
    :label="label ?? $t('tags')"
    class=""
    :popup-title="$t('tags_select')"
    :list="filteredList"
    :is-multi-select="props.isMultiSelect"
    :get-display-value="getDisplayValue"
    :create-name="createName"
    :is-creating="isCreating"
    v-bind="dynamicAttrs"
    @create="onCreate"
  >
    <template #left-icon>
      <app-icon :icon="TablerIconConstants.tag" :size="20" />
    </template>

    <template #top-right>
      <van-button size="small" class="" @click="onRefresh">
        <app-icon :icon="TablerIconConstants.refresh" :stroke="1.7" size="14" />
      </van-button>

      <van-button size="small" class="" @click="onToggleDisplayMode">
        <app-icon :icon="showGridIcon" :size="14" />
      </van-button>
    </template>

    <template #inputItemContent="{ item }">
      <div class="flex-center gap-1">
        <app-icon :icon="Tag.getIcon(item) ?? TablerIconConstants.tag" :size="18" />
        <span class="font-weight-400 text-size-12">{{ getDisplayValue(item) }}</span>
      </div>
    </template>

    <template #popup>
      <van-grid v-if="showTagSelectAsGrid" :column-num="3">
        <template v-for="(item, index) in filteredList" :key="index">
          <van-grid-item style="cursor: pointer" :class="getOptionClass(item)" @click="onSelectCell(item)">
            <app-select-option :text="Tag.getDisplayNameEllipsized(item)" :icon="Tag.getIcon(item) ?? TablerIconConstants.tag" />
          </van-grid-item>
        </template>
      </van-grid>
      <div v-else>
        <div v-for="(item, index) in filteredList" :key="item.id" @click="onSelectCell(item)">
          <tag-list-item :value="item" :class="getOptionClass(item)" :is-swipeable="false" />
        </div>
      </div>
    </template>
  </app-select>
</template>

<script setup>
import { useTagStore } from '~/stores/tagStore'
import { useFormAttributes } from '~/composables/useFormAttributes'
import Tag from '~/models/Tag'

import { isEqual } from 'lodash-es/lang'
import TablerIconConstants from '~/constants/TablerIconConstants'
import { uniqBy } from 'lodash-es/array.js'
import LanguageUtils from '~/utils/LanguageUtils.js'

const tagStore = useTagStore()
const profileStore = useProfileStore()
const attrs = useAttrs()
const { dynamicAttrs } = useFormAttributes(attrs)

const { showTagSelectAsGrid } = storeToRefs(profileStore)

const props = defineProps({
  label: {
    type: String,
  },
  isMultiSelect: {
    default: true,
  },
  autoSelectParents: {
    default: true,
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

const isLoading = ref(false)

const filteredList = computed(() => {
  const list = tagStore.tagListHierarchy
  if (search.value.length === 0) {
    return list
  }
  return list.filter((item) => {
    return Tag.getDisplayNameEllipsized(item).toUpperCase().indexOf(search.value.toUpperCase()) !== -1
  })
})

const createName = computed(() => {
  if (!props.canCreate) return null
  let name = search.value.trim()
  if (!name) return null
  if (profileStore.lowerCaseTagName) name = name.toLowerCase()
  if (profileStore.stripAccents) name = LanguageUtils.removeAccents(name)
  const key = LanguageUtils.removeAccentsAndLowerCase(name)
  const exists = !!tagStore.tagDictionaryByName[key]
  return exists ? null : name
})

watch(
  () => [showDropdown.value, suggestedSearch.value],
  ([isOpen, suggestion]) => {
    if (isOpen && suggestion) search.value = suggestion
  },
)

// ------ Methods ------

const onSelectCell = (item) => {
  suggestedSearch.value = null
  if (props.isMultiSelect) {
    const targetTags = props.autoSelectParents ? Tag.getTagWithParents(item) : [item]

    let newValue = modelValue.value ?? []
    const isSelected = newValue.some((value) => {
      const result = item.id === value.id
      return result
    })
    if (isSelected) {
      newValue = newValue.filter((value) => item.id !== value.id)
      // newValue = newValue.filter(value => !isEqual(item, value))
    } else {
      newValue = uniqBy([...newValue, ...targetTags], 'id')
    }
    modelValue.value = newValue
  } else {
    modelValue.value = item
    showDropdown.value = false
  }
}

const getDisplayValue = (value) => {
  return Tag.getDisplayNameEllipsized(value)
}

const onRefresh = async () => {
  isLoading.value = true
  await tagStore.fetchTags()
  isLoading.value = false
}

const isCreating = ref(false)
const onCreate = async (name) => {
  if (isCreating.value) return
  isCreating.value = true
  const typed = search.value.trim()
  const newItem = await tagStore.createTag(name)
  isCreating.value = false
  if (!newItem) return
  if (search.value.trim() === typed) search.value = ''
  onSelectCell(newItem)
  suggestedSearch.value = null
}

const isItemSelected = (option) => {
  if (!modelValue.value) {
    return false
  }
  if (props.isMultiSelect) {
    return modelValue.value.some((item) => item.id == option.id)
  }
  return isEqual(modelValue.value, option)
}

const getOptionClass = (option) => {
  return {
    active: isItemSelected(option),
  }
}

const onToggleDisplayMode = () => {
  showTagSelectAsGrid.value = !showTagSelectAsGrid.value
}

const showGridIcon = computed(() => {
  return showTagSelectAsGrid.value ? 'IconList' : 'IconGridDots'
})
</script>
