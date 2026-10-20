import axios from 'axios'
import { get } from 'lodash-es'
import BaseRepository from '~/repository/BaseRepository'

const getInterpretationPrompt = (hasReceipts) =>
  [
    hasReceipts ? 'You extract financial transactions from receipt photos.' : 'You extract financial transactions from natural language.',
    'Return only one JSON object, with no markdown and no commentary.',
    'The JSON object must have a transactions array.',
    'Each transaction must use this shape:',
    hasReceipts
      ? '{"amount": number|null, "currencyCode": string|null, "description": string (one or two words for what was bought, for example "groceries"; never the store name), "tagNames": string[] (names from context.tags that fit what was bought), "categoryName": string|null (one name from context.categories), "templateName": null, "budgetName": string|null, "sourceAccountName": string|null, "destinationAccountName": string (the store), "type": "expense", "occurredAt": string|null, "notes": string|null, "receiptIndexes": number[]}'
      : '{"amount": number|null, "currencyCode": string|null, "description": string, "tagNames": string[], "categoryName": string|null, "templateName": string|null, "budgetName": string|null, "sourceAccountName": string|null, "destinationAccountName": string|null, "type": "expense|income|transfer|null", "occurredAt": string|null, "notes": string|null}',
    // The receipt popup never sends text, so the text rules stay out of receipt mode: they defined description as the merchant and told the model to leave tags empty.
    ...(hasReceipts
      ? []
      : [
          'description is required for every transaction and must never be null or empty. It must be a short noun phrase (1-4 words) naming the merchant, place, item, or service, kept in the user\'s language. Strip verbs, actions, and filler words: "Am cumparat de la farmacie de 22 lei" gives description "farmacie", "bought some groceries at Lidl" gives "Lidl". Never include amounts or currencies. When the user does not state a subject, derive the description from the category, tag, or template that best summarizes the transaction.',
          'Split one utterance into multiple transactions when the user says "another", "and one", "plus", or otherwise describes more than one payment.',
        ]),
    'Use the provided now and timezone to resolve relative dates and times such as yesterday, today, 30 minutes ago, or last Friday.',
    ...(hasReceipts ? [] : ['Saved rambles include their original createdAt timestamp. Resolve their implicit dates relative to createdAt, not now.']),
    'Use ISO-8601 for occurredAt when a date or relative time is stated. If only a date is stated, keep the current local time from now.',
    'amount is the numeric value stated for the transaction. Always set amount when the input states a number, even when the currency word is colloquial, misspelled, in another language, or missing from the context currencies list. Never set amount to null because the currency is unrecognized.',
    'Use ISO 4217 codes for currencyCode, for example EUR, USD, RON. Recognize colloquial, misspelled, or translated currency words and map them to their ISO code: dollars, dolar, dolari, bucks give USD; lei, leu give RON; euro, euros give EUR; pounds, quid give GBP. currencyCode is not limited to the context currencies list. Leave currencyCode null only when the user did not state a currency.',
    ...(hasReceipts
      ? []
      : [
          'Match meaningful input words against the supplied context lists (tags, categories, templates, budgets, accounts). Lexical matching is forgiving: ignore case, diacritics, word order, singular/plural, and other inflections, and accept close partial matches ("comand" matches "comandate"). Fill each field that has a clear lexical match: a matching tag goes in tagNames, a matching category in categoryName, a matching template in templateName, and so on. The same explicit word may match several lists at once; set all of those matching fields.',
          'When the text names the store, merchant, or payer, put that name in destinationAccountName for an expense or in sourceAccountName for an income: use the context account name exactly as listed when one clearly refers to the same merchant, otherwise the name as the user said it, in normal capitalisation. A generic place such as "the pharmacy" or "the market" is not a merchant name; leave the account fields null for it.',
          'For terse inputs like "<word> <amount>", treat the word as the transaction subject: use it as the description and match it against the context lists to fill tagNames, categoryName, or templateName.',
          'Be conservative with semantic guesses. When there is no lexical match, set a supplied tag or category only when it is the single obvious real-world classification of the stated item or service. Prefer a direct, specific classification over broad labels such as necessities, shopping, or food. For example, an air conditioner clearly fits a supplied home tag better than necessities or food. If more than one candidate is plausible, the relationship is indirect, or confidence is not high, leave tagNames empty and categoryName null. Do not add both a child tag and its parent; the application adds tag ancestors automatically.',
        ]),
    'Do not invent tag, category, template, or budget names that are missing from the supplied context. If the user explicitly says "tag food", put food in tagNames even without a context match. Store, merchant, and payer names are different: they go into destinationAccountName or sourceAccountName even when they are not in the context accounts, because the application creates the account.',
    'Prefer type expense unless the user clearly describes income or a transfer.',
    ...(hasReceipts
      ? [
          "The user message contains one or more receipt photos and no transaction text. Read each photo and return its purchase as one transaction. The context object in the message lists the user's existing tags, categories and accounts.",
          'destinationAccountName is the store\'s consumer brand as shown on the logo or storefront ("Lidl", "Mega Image"), in normal capitalisation. Drop legal forms (S.R.L., SRL, S.A., GmbH, Ltd), the operating company when it differs from the brand, store numbers, addresses, tax ids and receipt numbers. When a context account clearly refers to that merchant, use that account name exactly as listed.',
          'description is one or two words saying what kind of things were bought, in the language given by the language field (not the language of the receipt): for example "groceries", "medicine", "health supplements", "construction materials", "fuel", "restaurant", "clothes". Derive it from the purchased items, never from the store. A Lidl receipt with milk, bread and apples gives description "groceries", not "Lidl"; a pharmacy receipt with vitamins gives "health supplements". description must never equal destinationAccountName and must never contain an amount.',
          'categoryName is the one context category that best fits what was bought, judged from the items and the kind of store, or null when none fits. tagNames are the context tags that fit what was bought, judged the same way, or an empty array when none fits. Choose only names that appear in the context lists, prefer specific tags over broad ones, and do not add both a child tag and its parent; the application adds tag ancestors automatically.',
          'sourceAccountName is null unless the receipt states which account or card paid and a context account clearly matches it. templateName is null.',
          'amount is the final total actually paid (after discounts, including taxes; never a subtotal, a line item, or the cash tendered). currencyCode comes from the printed currency or the merchant country. occurredAt comes from the printed date and time. type is expense.',
          'notes lists every purchased item, one per line, always with its price as printed: "item - price", or "item - quantity x unit price = line total" when the document prints a quantity and a unit price. Never list an item without a price.',
          'receiptIndexes holds the 0-based positions of every photo the transaction came from. Several photos can belong to one purchase, for example a long receipt split across photos, or a fiscal receipt together with the invoice it pays. Return a single transaction for them: take the total from the receipt, the item lines from the most detailed photo, and put all of their positions in receiptIndexes.',
          'If a photo is not a receipt or is unreadable, do not invent a transaction for it.',
        ]
      : []),
  ].join('\n')

const tryParseJson = (content) => {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

const decodeJsonContent = (content) => {
  if (!content || typeof content !== 'string') {
    return null
  }

  content = content.trim()
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')

  const decoded = tryParseJson(content)
  if (decoded !== null) {
    return decoded
  }

  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  return jsonMatch ? tryParseJson(jsonMatch[1]) : null
}

const normalizeTransactions = (json) => {
  if (!json || typeof json !== 'object') {
    return []
  }

  const transactions = Array.isArray(json) ? json : Array.isArray(json.transactions) ? json.transactions : [json]

  return transactions
    .filter((transaction) => transaction && typeof transaction === 'object' && !Array.isArray(transaction))
    .map((transaction) => {
      let date = transaction.occurredAt ?? transaction.occurred_at ?? null
      if (!date && transaction.date) {
        date = `${transaction.date}T${transaction.time ?? '00:00'}`.trim()
      }

      let tags = transaction.tagNames ?? transaction.tag_names ?? transaction.tags ?? []
      if (typeof tags === 'string') {
        tags = [tags]
      }

      let receiptIndexes = transaction.receiptIndexes ?? transaction.receipt_indexes ?? transaction.receiptIndex ?? transaction.receipt_index ?? []
      if (!Array.isArray(receiptIndexes)) {
        receiptIndexes = [receiptIndexes]
      }

      return {
        amount: transaction.amount ?? null,
        currencyCode: transaction.currencyCode ?? transaction.currency_code ?? transaction.currency ?? null,
        description: transaction.description ?? null,
        tagNames: Array.isArray(tags) ? tags.filter(Boolean) : [],
        categoryName: transaction.categoryName ?? transaction.category_name ?? transaction.category ?? null,
        templateName: transaction.templateName ?? transaction.template_name ?? transaction.template ?? null,
        budgetName: transaction.budgetName ?? transaction.budget_name ?? transaction.budget ?? null,
        sourceAccountName: transaction.sourceAccountName ?? transaction.source_account_name ?? transaction.source_account ?? null,
        destinationAccountName: transaction.destinationAccountName ?? transaction.destination_account_name ?? transaction.destination_account ?? null,
        type: transaction.type ?? null,
        occurredAt: date,
        notes: transaction.notes ?? null,
        receiptIndexes: receiptIndexes.map((index) => (index === null || index === '' ? NaN : Number(index))).filter(Number.isInteger),
      }
    })
}

const buildUserContent = (data) => {
  const text = JSON.stringify({
    text: data.text,
    savedRambles: data.savedRambles ?? [],
    now: data.now,
    timezone: data.timezone,
    language: data.language,
    context: data.context ?? {},
  })

  const receiptImages = data.receiptImages ?? []
  if (receiptImages.length === 0) {
    return text
  }

  // Small receipt print is only legible to the model at high detail.
  return [{ type: 'text', text }, ...receiptImages.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } }))]
}

export default class AssistantRepository extends BaseRepository {
  constructor() {
    super('api/assistant')
  }

  async getSavedRambleCount({ showLoading = false } = {}) {
    const response = await axios.get(`${this.getUrl()}/rambles/count`, { showLoading })
    return get(response, 'data', {})
  }

  async getSavedRambles() {
    const response = await axios.get(`${this.getUrl()}/rambles`)
    return get(response, 'data', {})
  }

  async getSavedRambleVoice(id) {
    const response = await axios.get(`${this.getUrl()}/rambles/${id}/voice`, { responseType: 'blob' })
    return get(response, 'data', null)
  }

  async deleteSavedRambles(ids) {
    return axios.delete(`${this.getUrl()}/rambles`, {
      data: {
        ids,
      },
    })
  }

  async deleteSavedRamble(id) {
    return axios.delete(`${this.getUrl()}/rambles/${id}`)
  }

  async interpretTransactions(data) {
    const requestData = {
      context: data.externalContext,
      model: data.model,
      payload: {
        temperature: 0,
        stream: false,
        messages: [
          {
            role: 'system',
            content: getInterpretationPrompt((data.receiptImages ?? []).length > 0),
          },
          {
            role: 'user',
            content: buildUserContent(data),
          },
        ],
      },
    }

    const response = await axios.post(`${this.getUrl()}/interpret-transactions`, requestData, {
      timeout: 60000,
    })

    if (!response || response.status >= 400) {
      throw new Error(get(response, 'data.message') ?? 'Assistant LLM request failed.')
    }

    const json = decodeJsonContent(get(response, 'data.choices.0.message.content') ?? get(response, 'data.content'))
    if (json === null) {
      throw new Error('Assistant LLM did not return valid JSON.')
    }

    return {
      transactions: normalizeTransactions(json),
    }
  }

  async getModels() {
    return axios.get(`${this.getUrl()}/models`, { showErrorToast: false, showLoading: false, timeout: 30000 })
  }

  async testLlm(model) {
    return axios.post(`${this.getUrl()}/test-llm`, { model }, { timeout: 60000, showErrorToast: false })
  }

  async testTranscription() {
    return axios.post(`${this.getUrl()}/test-transcription`, {}, { timeout: 120000, showErrorToast: false })
  }
}
