import { expect, test } from 'bun:test'
import { type AnyNode, CeilingNode, LevelNode, SlabNode } from '@pascal-app/core'
import { sameOutlineSurfaceCounterparts } from './surface-counterparts'

const level = LevelNode.parse({ children: [] })
const otherLevel = LevelNode.parse({ children: [] })
const room: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]
const slab = SlabNode.parse({ parentId: level.id, polygon: room, elevation: 0.05 })
const ceiling = CeilingNode.parse({ parentId: level.id, polygon: room, height: 2.49 })
const upstairsCeiling = CeilingNode.parse({ parentId: otherLevel.id, polygon: room, height: 2.49 })
const hallCeiling = CeilingNode.parse({
  parentId: level.id,
  polygon: [
    [4, 0],
    [8, 0],
    [8, 3],
    [4, 3],
  ],
  height: 2.49,
})
const nodes = Object.fromEntries(
  [level, otherLevel, slab, ceiling, upstairsCeiling, hallCeiling].map((n) => [n.id, n]),
) as Record<string, AnyNode>

test('a slab and a ceiling with the same outline on the same level are counterparts', () => {
  expect(sameOutlineSurfaceCounterparts({ node: slab, nodes })).toEqual([ceiling.id])
  expect(sameOutlineSurfaceCounterparts({ node: ceiling, nodes })).toEqual([slab.id])
  expect(sameOutlineSurfaceCounterparts({ node: hallCeiling, nodes })).toEqual([])
  expect(sameOutlineSurfaceCounterparts({ node: level, nodes })).toEqual([])
})
