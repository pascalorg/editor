import { describe, expect, test } from 'bun:test'
import { ColumnNode, SlabNode, StairNode, WallNode } from './schema'
import { SURFACE_SLOT_KINDS, surfaceSlotsFor, surfaceSlotsForKind } from './surface-slots'

describe('surfaceSlotsFor', () => {
  test('a wall paints through interior and exterior', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0] })
    const ids = surfaceSlotsFor(wall).map((slot) => slot.slotId)

    expect(ids).toContain('interior')
    expect(ids).toContain('exterior')
  })

  test('a slab paints through its top and its sides', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
      ],
    })

    expect(surfaceSlotsFor(slab).map((slot) => slot.slotId)).toEqual(['surface', 'side'])
  })

  test('a kind with no paintable surfaces answers with nothing rather than throwing', () => {
    expect(surfaceSlotsFor({ type: 'site' } as never)).toEqual([])
  })

  // Styling switches parts off, and a part that is not built has nothing to
  // paint — the editor's picker hides those rows.
  test('hides a slot the node is not currently built with', () => {
    const plain = ColumnNode.parse({ baseStyle: 'none', capitalStyle: 'none' })
    const ids = surfaceSlotsFor(plain).map((slot) => slot.slotId)

    expect(ids).toContain('shaft')
    expect(ids).not.toContain('base')
    expect(ids).not.toContain('capital')
  })
})

describe('surfaceSlotsForKind', () => {
  // Callers with only a type name (the MCP schema index) want everything the
  // kind can expose: a slot written now applies as soon as the styling turns
  // that part back on.
  test('lists slots the current styling would hide', () => {
    const byKind = surfaceSlotsForKind('column').map((slot) => slot.slotId)

    expect(byKind).toEqual(['shaft', 'base', 'capital', 'frame'])
    expect(surfaceSlotsForKind('stair').map((slot) => slot.slotId)).toContain('railing')
  })

  test('is a superset of what any one node of that kind exposes', () => {
    const stair = StairNode.parse({ railingMode: 'none' })
    const perNode = surfaceSlotsFor(stair).map((slot) => slot.slotId)
    const perKind = surfaceSlotsForKind('stair').map((slot) => slot.slotId)

    expect(perNode.every((id) => perKind.includes(id))).toBe(true)
    expect(perKind.length).toBeGreaterThan(perNode.length)
  })

  test('every kind on the published list actually declares slots', () => {
    for (const kind of SURFACE_SLOT_KINDS) {
      expect(surfaceSlotsForKind(kind).length).toBeGreaterThan(0)
    }
  })

  test('an unknown kind answers with nothing', () => {
    expect(surfaceSlotsForKind('not-a-kind')).toEqual([])
  })
})
