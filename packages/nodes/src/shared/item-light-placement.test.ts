import { expect, test } from 'bun:test'
import { canRegisterItemLight } from './item-light-placement'

test('fresh placement drafts wait for commit before registering lights', () => {
  expect(canRegisterItemLight({ isNew: true })).toBe(false)
  expect(canRegisterItemLight({ isNew: true, isTransient: true })).toBe(false)
  expect(canRegisterItemLight({})).toBe(true)
  expect(canRegisterItemLight(undefined)).toBe(true)
})
