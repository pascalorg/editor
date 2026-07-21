import { describe, expect, it } from 'bun:test'
import { LevelNode, SlabNode, StairNode } from '@pascal-app/core'
import { getStairDestinationUpdates } from './destination'

function makeStair(overrides: Record<string, unknown> = {}) {
  return StairNode.parse({
    id: 'stair_1',
    type: 'stair',
    position: [0, 0, 0],
    slabOpeningMode: 'destination',
    ...overrides,
  })
}

const deck = SlabNode.parse({
  id: 'slab_deck',
  type: 'slab',
  polygon: [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ],
  elevation: 1.25,
  thickness: 0.05,
})

const level = LevelNode.parse({
  id: 'level_2',
  type: 'level',
  level: 1,
  children: [],
})

describe('getStairDestinationUpdates', () => {
  it('attaching to a deck disables the auto cutout and clears the custom rise', () => {
    const stair = makeStair({ totalRise: 2.0 })
    const updates = getStairDestinationUpdates(stair, deck, deck.id)
    expect(updates.deckSlabId).toBe(deck.id)
    expect(updates.slabOpeningMode).toBe('none')
    // The key must be PRESENT with an undefined value so the store merge
    // clears the field.
    expect('totalRise' in updates && updates.totalRise === undefined).toBe(true)
  })

  it('detaching back to a level restores the placement-default cutout and follows mode', () => {
    const stair = makeStair({ deckSlabId: deck.id, slabOpeningMode: 'none' })
    const updates = getStairDestinationUpdates(stair, level, level.id)
    expect(updates.toLevelId).toBe(level.id)
    expect(updates.slabOpeningMode).toBe('destination')
    expect('deckSlabId' in updates && updates.deckSlabId === undefined).toBe(true)
    expect('totalRise' in updates && updates.totalRise === undefined).toBe(true)
  })

  it('a plain level-to-level switch leaves rise and opening mode alone', () => {
    const stair = makeStair({ totalRise: 2.0 })
    const updates = getStairDestinationUpdates(stair, level, level.id)
    expect(updates.toLevelId).toBe(level.id)
    expect('deckSlabId' in updates && updates.deckSlabId === undefined).toBe(true)
    expect('totalRise' in updates).toBe(false)
    expect('slabOpeningMode' in updates).toBe(false)
  })

  it('detaching a stale deck reference still resets to follows mode', () => {
    const stair = makeStair({ deckSlabId: 'slab_gone', totalRise: 1.4 })
    const updates = getStairDestinationUpdates(stair, level, level.id)
    expect(updates.slabOpeningMode).toBe('destination')
    expect('totalRise' in updates && updates.totalRise === undefined).toBe(true)
  })
})
