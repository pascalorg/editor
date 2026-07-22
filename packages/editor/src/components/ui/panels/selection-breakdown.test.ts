import { describe, expect, test } from 'bun:test'
import { formatSelectionBreakdown } from './selection-breakdown'

describe('formatSelectionBreakdown', () => {
  test('counts per type in first-appearance order, pluralizing with +s', () => {
    expect(formatSelectionBreakdown(['slab', 'stair', 'fence', 'fence'])).toBe(
      '1 slab · 1 stair · 2 fences',
    )
  })

  test('humanizes hyphenated kinds', () => {
    expect(formatSelectionBreakdown(['roof-segment', 'roof-segment', 'wall'])).toBe(
      '2 roof segments · 1 wall',
    )
  })

  test('skips missing nodes', () => {
    expect(formatSelectionBreakdown(['wall', undefined, null])).toBe('1 wall')
  })

  test('empty selection formats to an empty string', () => {
    expect(formatSelectionBreakdown([])).toBe('')
  })
})
