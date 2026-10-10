import { describe, expect, test } from 'bun:test'
import { kindForTargets, kindOf, placeholderFor, suggestionsFor } from './suggestions'
import type { PointTarget } from './types'

// Chosen locally from the kind and the element's state, with no model call, so they are there on
// the first frame (spec 2.4). Three chips each, sentence case.

const target = (more: Partial<PointTarget> = {}): PointTarget => ({
  id: 'zone_1',
  type: 'zone',
  kind: 'room',
  name: 'Kitchen',
  size: '14.2 m²',
  ...more,
})

describe('suggestionsFor', () => {
  test('a room: furnish when it is empty, rearrange when it is not', () => {
    expect(suggestionsFor('room', { empty: true })).toEqual([
      'Furnish this room',
      'Make it 1 m longer',
      'Change the floor finish',
    ])
    expect(suggestionsFor('room', { empty: false })[0]).toBe('Rearrange the furniture')
    expect(suggestionsFor('room', {})[0]).toBe('Rearrange the furniture')
  })

  test('a wall: a window at the clicked station, unless one is there', () => {
    expect(suggestionsFor('wall', {})).toEqual([
      'Add a window here',
      'Change the finish on this side',
      'Move it 50 cm',
    ])
    expect(suggestionsFor('wall', { hasWindowAtStation: true })[0]).toBe(
      'Move the window along the wall',
    )
  })

  test('the other kinds', () => {
    expect(suggestionsFor('window', {})).toEqual([
      'Make it wider',
      'Add a matching window',
      'Change the frame colour',
    ])
    expect(suggestionsFor('door', {})).toEqual([
      'Flip the swing',
      'Make it a sliding door',
      'Widen it to 90 cm',
    ])
    expect(suggestionsFor('item', {})).toEqual([
      'Swap for something similar',
      'Put it against the wall',
      'Remove it',
    ])
    expect(suggestionsFor('roof', {})).toEqual([
      'Change the pitch',
      'Make it a hip roof',
      'Change the roofing',
    ])
    expect(suggestionsFor('stair', {})).toEqual(['Turn it 90°', 'Add a handrail', 'Make it wider'])
    expect(suggestionsFor('several', {})).toEqual([
      'Make these match',
      'Line them up',
      'Space them evenly',
    ])
    expect(suggestionsFor('area', {})).toEqual([
      'What’s wrong here?',
      'Make this match the reference',
      'Tidy this up',
    ])
  })

  test('anything else still gets three useful chips', () => {
    expect(suggestionsFor('other', {})).toHaveLength(3)
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

describe('placeholderFor', () => {
  test('names a room, and says "this" for the rest', () => {
    expect(placeholderFor([target()])).toBe('Ask about Kitchen…')
    expect(placeholderFor([target({ type: 'window', kind: 'window', name: 'Window 2' })])).toBe(
      'Ask about this window…',
    )
    expect(placeholderFor([target({ type: 'wall', kind: 'wall' })])).toBe('Ask about this wall…')
    expect(placeholderFor([target({ type: 'door', kind: 'door' })])).toBe('Ask about this door…')
    expect(placeholderFor([target({ type: 'item', kind: 'item' })])).toBe('Ask about this item…')
  })

  test('several, and an area with nothing pointed at', () => {
    expect(placeholderFor([target(), target({ id: 'wall_1', kind: 'wall' })])).toBe(
      'Ask about these…',
    )
    expect(placeholderFor([])).toBe('Ask about this area…')
  })
})

describe('kindOf', () => {
  test('maps node types to what the chips are chosen by', () => {
    expect(kindOf('zone')).toBe('room')
    expect(kindOf('wall')).toBe('wall')
    expect(kindOf('window')).toBe('window')
    expect(kindOf('door')).toBe('door')
    for (const type of ['item', 'procedural-item', 'imported-mesh', 'column'])
      expect(kindOf(type)).toBe('item')
    for (const type of ['roof', 'roof-segment']) expect(kindOf(type)).toBe('roof')
    for (const type of ['stair', 'stair-segment']) expect(kindOf(type)).toBe('stair')
    for (const type of ['slab', 'ceiling', 'level', 'building', 'fence'])
      expect(kindOf(type)).toBe('other')
  })

  test('a region is an area whatever it holds', () => {
    expect(kindOf('wall', true)).toBe('area')
  })
})

describe('kindForTargets', () => {
  test('one target gives its own kind, several give several, none an area', () => {
    expect(kindForTargets([target()])).toBe('room')
    expect(kindForTargets([target(), target({ id: 'b' })])).toBe('several')
    expect(kindForTargets([])).toBe('area')
    expect(kindForTargets([target()], true)).toBe('area')
  })
})
