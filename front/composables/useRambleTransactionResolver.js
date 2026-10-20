import { computed } from 'vue'
import { uniqBy } from 'lodash-es'
import Tag from '~/models/Tag'
import Category from '~/models/Category.js'
import Account from '~/models/Account.js'
import Budget from '~/models/Budget.js'
import Currency from '~/models/Currency.js'
import TransactionTemplate from '~/models/TransactionTemplate.js'
import Transaction from '~/models/Transaction.js'
import LanguageUtils from '~/utils/LanguageUtils.js'

export const useRambleTransactionResolver = () => {
  const profileStore = useProfileStore()
  const tagStore = useTagStore()
  const categoryStore = useCategoryStore()
  const templateStore = useTemplateStore()
  const budgetStore = useBudgetStore()
  const accountStore = useAccountStore()
  const currencyStore = useCurrencyStore()

  const normalizeName = (value) => LanguageUtils.removeAccentsAndLowerCase(value).trim()

  // Normalizing names (accent stripping + lowercasing) is the hot part of resolving, so each
  // store list is indexed once and only re-indexed when the list itself changes.
  const buildNormalizedIndex = (list, getNames) =>
    list.map((item) => {
      const names = getNames(item).filter(Boolean)
      return {
        item,
        names,
        normalizedNames: names.map(normalizeName).filter(Boolean),
      }
    })

  const getTagNames = (tag) => [Tag.getDisplayName(tag)]
  const getCategoryNames = (category) => [Category.getDisplayName(category)]
  const getTemplateNames = (template) => TransactionTemplate.getAllNames(template)
  const getBudgetNames = (budget) => [Budget.getDisplayName(budget)]
  const getAccountNames = (account) => [Account.getDisplayName(account)]
  const getCurrencyNames = (currency) => [Currency.getCode(currency), Currency.getName(currency), Currency.getSymbol(currency)]

  const tagIndex = computed(() => buildNormalizedIndex(tagStore.tagList, getTagNames))
  const categoryIndex = computed(() => buildNormalizedIndex(categoryStore.categoryList, getCategoryNames))
  const templateIndex = computed(() => buildNormalizedIndex(templateStore.transactionTemplateList, getTemplateNames))
  const budgetIndex = computed(() => buildNormalizedIndex(budgetStore.budgetList, getBudgetNames))
  const accountIndex = computed(() => buildNormalizedIndex(accountStore.accountList, getAccountNames))
  const currencyIndex = computed(() => buildNormalizedIndex(currencyStore.currenciesList, getCurrencyNames))

  const resolveByName = (index, name, { uniquePartialMatch = false } = {}) => {
    const normalizedName = normalizeName(name)
    if (!normalizedName) {
      return null
    }

    const exactMatch = index.find((entry) => entry.normalizedNames.some((itemName) => itemName === normalizedName))
    if (exactMatch) {
      return exactMatch.item
    }

    const partialMatches = index.filter(
      (entry) => normalizedName.length >= 3 && entry.normalizedNames.some((itemName) => itemName.length >= 3 && (itemName.includes(normalizedName) || normalizedName.includes(itemName))),
    )
    if (uniquePartialMatch && partialMatches.length > 1) {
      return null
    }
    return partialMatches[0]?.item ?? null
  }

  const resolveTags = (tagNames = []) => {
    const resolved = tagNames.map((tagName) => ({ name: tagName, tag: resolveByName(tagIndex.value, tagName) }))
    const tags = uniqBy(resolved.map(({ tag }) => tag).filter(Boolean), 'id')
    const unmatchedNames = uniqBy(
      resolved
        .filter(({ tag }) => !tag)
        .map(({ name }) => name?.trim())
        .filter(Boolean),
      normalizeName,
    )
    return { tags, unmatchedNames }
  }

  const resolveCategory = (categoryName) => {
    return resolveByName(categoryIndex.value, categoryName)
  }

  const resolveTemplate = (templateName) => {
    return resolveByName(templateIndex.value, templateName)
  }

  const resolveBudget = (budgetName) => {
    return resolveByName(budgetIndex.value, budgetName)
  }

  const resolveCurrency = (currencyCode) => {
    return resolveByName(currencyIndex.value, currencyCode)
  }

  const resolveDate = (date) => {
    if (!date) {
      return null
    }

    const result = new Date(date)
    return Number.isNaN(result.getTime()) ? null : result
  }

  const resolveTransactionType = (type) => {
    return Transaction.typesList.find((transactionType) => transactionType.code === type) ?? null
  }

  const contextNames = (index) => {
    return index
      .map((entry) => entry.names)
      .flat()
      .slice(0, 200)
  }

  const rambleContext = computed(() => ({
    tags: contextNames(tagIndex.value),
    categories: contextNames(categoryIndex.value),
    templates: contextNames(templateIndex.value),
    budgets: contextNames(budgetIndex.value),
    accounts: contextNames(accountIndex.value),
    currencies: contextNames(currencyIndex.value),
  }))

  const getRambleContext = () => rambleContext.value

  // Only accounts the slot can hold count as a match, and a partial match has to be unique: a wrong account is a silent wrong booking.
  // An unmatched name becomes a new account of the type the slot can create; Firefly creates it when the draft is saved.
  const resolveAssistantAccount = (accountName, allowedTypes) => {
    if (!accountName?.trim()) {
      return undefined
    }
    const allowedCodes = allowedTypes.map((type) => type.fireflyCode)
    const match = resolveByName(
      accountIndex.value.filter((entry) => allowedCodes.includes(Account.getType(entry.item)?.fireflyCode)),
      accountName,
      { uniquePartialMatch: true },
    )
    if (match) {
      return match
    }
    const newType = Account.getCreatableType(allowedTypes)
    return newType ? Account.getNew(accountName, newType) : undefined
  }

  const resolveRambleTransaction = (rawTransaction, index) => {
    const template = resolveTemplate(rawTransaction.templateName)
    const { tags, unmatchedNames } = resolveTags(rawTransaction.tagNames)
    const category = resolveCategory(rawTransaction.categoryName)
    const budget = resolveBudget(rawTransaction.budgetName)
    const type = resolveTransactionType(rawTransaction.type)
    const fixedType = type ?? Transaction.types.expense
    const fixedAccounts = Transaction.attemptAccountFixOnTypeChange(
      fixedType,
      resolveAssistantAccount(rawTransaction.sourceAccountName, Account.getAccountTypesForTransactionTypeSource(fixedType)) ?? profileStore.defaultAccountSource,
      resolveAssistantAccount(rawTransaction.destinationAccountName, Account.getAccountTypesForTransactionTypeDestination(fixedType)) ?? profileStore.defaultAccountDestination,
    )
    const assistantCurrency = resolveCurrency(rawTransaction.currencyCode)
    // A receipt description that only repeats the store says nothing next to the destination account, so the category or first tag stands in for it
    const describesStore =
      rawTransaction.receiptIndexes?.length > 0 &&
      !!rawTransaction.description &&
      !!rawTransaction.destinationAccountName &&
      normalizeName(rawTransaction.description) === normalizeName(rawTransaction.destinationAccountName)
    const rawDescription =
      (describesStore ? rawTransaction.categoryName || rawTransaction.tagNames?.[0] : null) ||
      rawTransaction.description ||
      rawTransaction.templateName ||
      rawTransaction.categoryName ||
      rawTransaction.tagNames?.[0] ||
      'Transaction'

    return {
      id: `${Date.now()}-${index}`,
      raw: rawTransaction,
      transactionTemplate: template,
      tags,
      category,
      budget,
      accountSource: fixedAccounts.source,
      accountDestination: fixedAccounts.destination,
      type,
      amount: rawTransaction.amount === null || rawTransaction.amount === undefined ? null : rawTransaction.amount.toString(),
      assistantCurrency,
      currencyCode: rawTransaction.currencyCode,
      description: rawDescription,
      notes: rawTransaction.notes,
      date: resolveDate(rawTransaction.occurredAt),
      categorySuggestion: !category && rawTransaction.categoryName?.trim() ? rawTransaction.categoryName.trim() : null,
      tagSuggestions: unmatchedNames,
    }
  }

  return {
    getRambleContext,
    resolveRambleTransaction,
  }
}
