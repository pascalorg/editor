import { describe, expect, test } from 'bun:test'
import { CORNER_BLOCK_NOTES, cornerHintRows } from './use-corner-snap-hint'

// The HUD near a wall end (the owner, 8 October): what a click does where a window can join, and
// why not where it cannot, in one wording for the placement HUD and the move HUD.
describe('cornerHintRows', () => {
  test('says nothing away from a wall end', () => {
    expect(cornerHintRows(null)).toEqual([])
  })

  test('says what a click does where the window can join, and how to skip it', () => {
    expect(cornerHintRows('join')).toEqual([
      { keys: ['Left click'], label: 'Join as a corner window' },
      { keys: ['Alt'], label: 'Place without the corner snap' },
    ])
    expect(cornerHintRows('new')[0]).toEqual({ keys: ['Left click'], label: 'Corner window' })
  })

  test('gives each reason its own sentence where the end is no corner', () => {
    const reasons = Object.keys(CORNER_BLOCK_NOTES) as (keyof typeof CORNER_BLOCK_NOTES)[]
    const labels = reasons.map((reason) => cornerHintRows(reason)[0]?.label)

    expect(labels).toEqual(reasons.map((reason) => CORNER_BLOCK_NOTES[reason]))
    expect(new Set(labels).size).toBe(reasons.length)
    // It offers no click, since a click here places a plain window.
    expect(cornerHintRows('free_end').every((row) => !row.keys.includes('Left click'))).toBe(true)
  })
})
