import { expect, test } from 'bun:test'
import { hasFittingClearance } from './fitting-clearance'

test('overlapping collars cannot pass by their unsigned distance', () => {
  expect(hasFittingClearance([0.4, 0, 0], [0.2, 0, 0], [1, 0, 0], 0.05)).toBe(false)
  expect(hasFittingClearance([0.2, 0, 0], [0.4, 0, 0], [1, 0, 0], 0.05)).toBe(true)
})
test('clearance supports vertical DWV runs and both minimum lengths', () => {
  expect(hasFittingClearance([0, 3, 0], [0, 2.94, 0], [0, -2, 0], 0.05)).toBe(true)
  expect(hasFittingClearance([0, 3, 0], [0, 2.94, 0], [0, -2, 0], 0.08)).toBe(false)
  expect(hasFittingClearance([0, 3, 0], [0, 3.2, 0], [0, -2, 0], 0.05)).toBe(false)
})
