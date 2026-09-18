import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { isCatalogItemSelected } from './catalog-selection'

test('no selection leaves every tile unhighlighted, including items without model URLs', () => {
  for (const item of [{ id: 'chair' }, { id: 'cabinet' }]) {
    assert.equal(isCatalogItemSelected(item, null), false)
  }
})

test('only the chosen item is highlighted when model URLs are missing or shared', () => {
  for (const src of [undefined, '/shared-model.glb']) {
    const items = [{ id: 'first', src }, { id: 'second', src }]
    assert.deepEqual(items.map(item => isCatalogItemSelected(item, items[1]!)), [false, true])
  }
})

test('selection follows identity across reloaded catalog objects', () => {
  assert.equal(isCatalogItemSelected({ id: 'chair' }, { id: 'chair' }), true)
  assert.equal(isCatalogItemSelected({ id: 'chair' }, { id: 'table' }), false)
})
