import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandReceiptItems, formatReceiptItemsAsNotes, getReceiptItemsProblem, parseAmount, roundAmount, sumReceiptItems } from '../utils/ReceiptItemUtils.js'

const items = [
  { id: 'a', description: 'Milk', amount: 1.1 },
  { id: 'b', description: 'Bread', amount: '2,2' },
]

const draftItem = () => ({
  attributes: {
    transactions: [
      {
        amount: '3.30',
        description: 'Lidl',
        notes: 'Paid by card',
        tags: [{ id: 1 }],
        accountSource: { id: 9 },
      },
    ],
  },
})

test('parseAmount accepts numbers, dot and comma decimals, and rejects junk', () => {
  assert.equal(parseAmount(1.5), 1.5)
  assert.equal(parseAmount('2.25'), 2.25)
  assert.equal(parseAmount(' 2,25 '), 2.25)
  assert.equal(Number.isNaN(parseAmount('')), true)
  assert.equal(Number.isNaN(parseAmount('x')), true)
  assert.equal(Number.isNaN(parseAmount(null)), true)
})

test('roundAmount rounds to the given decimals', () => {
  assert.equal(roundAmount(1.006, 2), 1.01)
  assert.equal(roundAmount('3.3000000000000003', 2), 3.3)
  assert.equal(roundAmount(1234.5, 0), 1235)
  assert.equal(Number.isNaN(roundAmount('x', 2)), true)
})

test('sumReceiptItems rounds each amount before adding, and ignores junk', () => {
  assert.equal(sumReceiptItems(items, 2), 3.3)
  assert.equal(sumReceiptItems([{ amount: 'x' }, { amount: 2 }], 2), 2)
  assert.equal(sumReceiptItems([], 2), 0)
  // The posted amounts are 0.33 + 0.33 + 0.33, so the sum must be 0.99, not the rounded raw sum 1.00.
  assert.equal(sumReceiptItems([{ amount: 0.333 }, { amount: 0.333 }, { amount: 0.333 }], 2), 0.99)
})

const named = (list) => list.map((entry, index) => ({ description: `Item ${index}`, ...entry }))

test('getReceiptItemsProblem is exact at the currency precision', () => {
  assert.equal(getReceiptItemsProblem(items, '3.30', 2), null)
  assert.equal(getReceiptItemsProblem(items, 3.3, 2), null)
  assert.equal(getReceiptItemsProblem(items, 3.31, 2), 'mismatch')
  assert.equal(getReceiptItemsProblem(items, '3,3', 2), null)
  assert.equal(getReceiptItemsProblem(items, '', 2), 'mismatch')
  assert.equal(getReceiptItemsProblem(items, null, 2), 'mismatch')
  assert.equal(getReceiptItemsProblem(named([{ amount: 1000 }, { amount: 235 }]), 1235, 0), null)
  assert.equal(getReceiptItemsProblem(named([{ amount: 0.333 }, { amount: 0.333 }, { amount: 0.333 }]), 1, 2), 'mismatch')
})

test('getReceiptItemsProblem reports amounts that are missing, non-positive or round to zero', () => {
  assert.equal(getReceiptItemsProblem(named([{ amount: 0 }, { amount: 3.3 }]), 3.3, 2), 'invalid_amount')
  assert.equal(getReceiptItemsProblem(named([{ amount: -1 }, { amount: 4.3 }]), 3.3, 2), 'invalid_amount')
  assert.equal(getReceiptItemsProblem(named([{ amount: '' }, { amount: 3.3 }]), 3.3, 2), 'invalid_amount')
  // 0.004 would post as 0.00, which Firefly rejects.
  assert.equal(getReceiptItemsProblem(named([{ amount: 0.004 }, { amount: 3.3 }]), 3.3, 2), 'invalid_amount')
  assert.equal(getReceiptItemsProblem(named([{ amount: 0.4 }, { amount: 3 }]), 3, 0), 'invalid_amount')
})

test('getReceiptItemsProblem reports an empty description first', () => {
  assert.equal(
    getReceiptItemsProblem(
      [
        { description: '', amount: 1 },
        { description: 'Bread', amount: 2.3 },
      ],
      3.3,
      2,
    ),
    'missing_description',
  )
  assert.equal(getReceiptItemsProblem([{ description: '   ', amount: 0 }], 3.3, 2), 'missing_description')
  assert.equal(getReceiptItemsProblem([{ amount: 1 }], 1, 2), 'missing_description')
})

test('formatReceiptItemsAsNotes renders one line per item with fixed decimals', () => {
  assert.equal(formatReceiptItemsAsNotes(items, 2), 'Milk - 1.10\nBread - 2.20')
  assert.equal(formatReceiptItemsAsNotes([{ description: 'Gum', amount: 'x' }], 2), 'Gum - x')
})

test('expandReceiptItems returns the item untouched below two items', () => {
  const item = draftItem()
  assert.equal(expandReceiptItems(item, [], 2), item)
  assert.equal(expandReceiptItems(item, [items[0]], 2), item)
})

test('expandReceiptItems clones the first split per item and sets the group title', () => {
  const item = draftItem()
  const expanded = expandReceiptItems(item, items, 2)

  assert.equal(expanded.attributes.group_title, 'Lidl')
  assert.equal(expanded.attributes.transactions.length, 2)
  assert.deepEqual(
    expanded.attributes.transactions.map((split) => [split.description, split.amount]),
    [
      ['Milk', '1.10'],
      ['Bread', '2.20'],
    ],
  )
  assert.equal(expanded.attributes.transactions[1].accountSource.id, 9)
  // Receipt-level notes belong to the group once, not to every journal.
  assert.equal(expanded.attributes.transactions[0].notes, 'Paid by card')
  assert.equal(expanded.attributes.transactions[1].notes, '')
  assert.notEqual(expanded.attributes.transactions[0].tags, item.attributes.transactions[0].tags)
  assert.equal(item.attributes.transactions.length, 1)
  assert.equal(item.attributes.group_title, undefined)
})

test('expandReceiptItems rounds and formats with the given decimals', () => {
  const expanded = expandReceiptItems(
    draftItem(),
    [
      { description: 'A', amount: 1000 },
      { description: 'B', amount: 235 },
    ],
    0,
  )
  assert.deepEqual(
    expanded.attributes.transactions.map((split) => split.amount),
    ['1000', '235'],
  )
  const rounded = expandReceiptItems(
    draftItem(),
    [
      { description: 'A', amount: '1,006' },
      { description: 'B', amount: 2.294 },
    ],
    2,
  )
  assert.deepEqual(
    rounded.attributes.transactions.map((split) => split.amount),
    ['1.01', '2.29'],
  )
})
