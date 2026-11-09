import { describe, expect, test } from 'bun:test'
import { followUpSuggestionsFor, suggestionsFor } from './suggestions'

// Chosen locally from the kind and the element's state, with no model call, so they are there on
// the first frame (spec 2.4). Three chips each, sentence case.

describe('suggestionsFor', () => {
  test('a room: furnish when it is empty, rearrange when it is not', () => {
    const empty = suggestionsFor('room', { empty: true })
    const furnished = suggestionsFor('room', { empty: false })

    expect(empty[0]).not.toBe(furnished[0])
    expect(suggestionsFor('room', {})[0]).toBe(furnished[0])
  })

  test('a wall: a window at the clicked station, unless one is there', () => {
    const bare = suggestionsFor('wall', {})
    const windowed = suggestionsFor('wall', { hasWindowAtStation: true })

    expect(windowed[0]).not.toBe(bare[0])
    expect(windowed.slice(1)).toEqual(bare.slice(1))
  })

  test('every kind gives three, in sentence case, with no duplicates', () => {
    for (const kind of [
      'room',
      'wall',
      'window',
      'door',
      'item',
      'roof',
      'stair',
      'several',
      'area',
      'other',
    ] as const) {
      const chips = suggestionsFor(kind, {})

      expect(chips).toHaveLength(3)
      expect(new Set(chips).size).toBe(3)
      for (const chip of chips) expect(chip[0]).toBe(chip[0]?.toUpperCase())
    }
  })
})

describe('followUpSuggestionsFor', () => {
  const kinds = [
    'room',
    'wall',
    'window',
    'door',
    'item',
    'roof',
    'stair',
    'several',
    'area',
    'other',
  ] as const

  for (const kind of kinds) {
    test(`${kind}: three fresh chips, none of them what was just asked`, () => {
      const first = suggestionsFor(kind, {})
      const chips = followUpSuggestionsFor(kind, first[0] as string)

      expect(chips).toHaveLength(3)
      expect(new Set(chips).size).toBe(3)
      expect(chips.map((c) => c.toLowerCase())).not.toContain((first[0] as string).toLowerCase())
      // "Change more" is not the first bubble again: at most one chip is one it already offered.
      expect(chips.filter((chip) => first.includes(chip)).length).toBeLessThanOrEqual(1)
    })
  }

  test('skips the words just sent, whatever the case or the full stop', () => {
    const [firstOffered] = followUpSuggestionsFor('window', '')
    const chips = followUpSuggestionsFor('window', ` ${(firstOffered as string).toUpperCase()}. `)

    expect(chips).toHaveLength(3)
    expect(chips).not.toContain(firstOffered)
  })
})
