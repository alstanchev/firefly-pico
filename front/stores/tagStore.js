import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { get, keyBy, cloneDeep } from 'lodash-es'
import { useLocalStorage } from '@vueuse/core'
import TagRepository from '~/repository/TagRepository'
import TagTransformer from '~/transformers/TagTransformer'
import { listToTree, setLevel, sortByPath, treeToList } from '~/utils/DataUtils'
import LanguageUtils from '~/utils/LanguageUtils.js'
import { useProfileStore } from '~/stores/profileStore'
import Tag from '~/models/Tag'
import ResponseUtils from '~/utils/ResponseUtils'

export const useTagStore = defineStore('tag', () => {
  const tagList = useLocalStorage('tagList', [])
  const isLoadingTags = ref(false)

  const tagTodo = computed(() => {
    return tagList.value.find((tag) => tag?.attributes?.is_todo)
  })

  const tagDictionaryByName = computed(() => {
    return keyBy(tagList.value, (item) => LanguageUtils.removeAccentsAndLowerCase(item?.attributes?.tag))
  })

  const tagDictionaryById = computed(() => {
    return keyBy(tagList.value, 'id')
  })

  const tagListHierarchy = computed(() => {
    let sortedList = sortByPath(tagList.value, 'attributes.tag')
    const tree = listToTree(sortedList)
    return treeToList(tree)
  })

  async function fetchTags() {
    const profileStore = useProfileStore()
    if (!profileStore.tagsEnabled) {
      tagList.value = []
      return
    }
    isLoadingTags.value = true
    const list = await new TagRepository().getAllWithMerge()
    tagList.value = TagTransformer.transformFromApiList(list)

    let newTags = cloneDeep(tagList.value)
    setLevel(newTags)
    isLoadingTags.value = false
  }

  async function createTag(name) {
    const item = new Tag().getEmpty()
    item.attributes.tag = name
    const response = await new TagRepository().insert(TagTransformer.transformToApi(item))
    if (!ResponseUtils.isSuccess(response)) return null
    const newItem = TagTransformer.transformFromApi(get(response, 'data.data'))
    tagList.value = [newItem, ...tagList.value]
    return newItem
  }

  return {
    tagList,
    isLoadingTags,
    tagTodo,
    tagDictionaryByName,
    tagDictionaryById,
    tagListHierarchy,
    fetchTags,
    createTag,
  }
})
