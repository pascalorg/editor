import { describe, expect, test } from 'bun:test'
import { LevelNode, WallNode } from '@pascal-app/core/schema'
import { buildFloorplanContext } from './floorplan-readonly'

const viewState = {
  selected: false,
  unit: 'metric' as const,
  highlighted: false,
  hovered: false,
  moving: false,
  palette: undefined,
}

describe('read-only floorplan context', () => {
  test('does not invent siblings for parentless nodes', () => {
    const first = LevelNode.parse({ id: 'level_first', type: 'level' })
    const second = LevelNode.parse({ id: 'level_second', type: 'level' })
    const nodes = { [first.id]: first, [second.id]: second }

    expect(buildFloorplanContext(first, nodes, viewState).siblings).toEqual([])
  })

  test('resolves same-kind siblings from the parent child order', () => {
    const first = WallNode.parse({
      id: 'wall_first',
      type: 'wall',
      parentId: 'level_ground',
      start: [0, 0],
      end: [1, 0],
    })
    const second = WallNode.parse({
      id: 'wall_second',
      type: 'wall',
      parentId: 'level_ground',
      start: [1, 0],
      end: [2, 0],
    })
    const level = LevelNode.parse({
      id: 'level_ground',
      type: 'level',
      children: [first.id, second.id],
    })
    const nodes = { [level.id]: level, [first.id]: first, [second.id]: second }

    expect(buildFloorplanContext(first, nodes, viewState).siblings).toEqual([second])
  })
})
