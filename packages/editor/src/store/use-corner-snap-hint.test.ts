import { describe, expect, test } from 'bun:test'
import { CORNER_BLOCK_NOTES, cornerHintRows } from './use-corner-snap-hint'

// The HUD near a wall end: what a click does where a window can join, and why not where it cannot,
// in one wording for the placement HUD and the move HUD.
describe('cornerHintRows', () => {
  test('says nothing away from a wall end', () => {
    expect(cornerHintRows(null)).toEqual([])
  })

  test('says what a click does where the window can join, and how to skip it with Alt', () => {
    for (const hint of ['join', 'new'] as const)
      expect(cornerHintRows(hint).map((row) => row.keys)).toEqual([['Left click'], ['Alt']])
    expect(cornerHintRows('join')[0]?.label).not.toBe(cornerHintRows('new')[0]?.label)
  })

  test('gives each reason its own sentence where the end is no corner, and offers no click', () => {
    const reasons = Object.keys(CORNER_BLOCK_NOTES) as (keyof typeof CORNER_BLOCK_NOTES)[]
    const rows = reasons.map((reason) => cornerHintRows(reason))

    expect(new Set(rows.map((row) => row[0]?.label)).size).toBe(reasons.length)
    expect(rows.flat().every((row) => !row.keys.includes('Left click'))).toBe(true)
  })
})
