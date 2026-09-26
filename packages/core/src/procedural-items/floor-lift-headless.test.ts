import { afterEach, beforeEach, expect, test } from 'bun:test'
import { nodeRegistry } from '../registry/registry'
import { BlockNode } from '../schema/nodes/block'
import { ColumnNode } from '../schema/nodes/column'
import { DuctTerminalNode } from '../schema/nodes/duct-terminal'
import { HvacEquipmentNode } from '../schema/nodes/hvac-equipment'
import { LevelNode } from '../schema/nodes/level'
import { RoofNode } from '../schema/nodes/roof'
import { SlabNode } from '../schema/nodes/slab'
import { SpawnNode } from '../schema/nodes/spawn'
import { StairNode } from '../schema/nodes/stair'
import { StairSegmentNode } from '../schema/nodes/stair-segment'
import type { AnyNode } from '../schema/types'
import { nodeLevelFrame } from './query'

// Headless runtimes (MCP, hosted scene API, bench) never load the built-in
// plugin, so the registry is empty there. The floor lift must not depend on it.
let restoreRegistry: () => void
beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
})
afterEach(() => restoreRegistry())

const level = LevelNode.parse({ id: 'level_deck' })
const deck = SlabNode.parse({
  id: 'slab_deck',
  parentId: level.id,
  elevation: 1,
  polygon: [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ],
})

function liftOf(node: AnyNode, extra: AnyNode[] = []): number {
  const nodes: Record<string, AnyNode> = { [level.id]: level, [deck.id]: deck, [node.id]: node }
  for (const other of extra) nodes[other.id] = other
  return nodeLevelFrame(node.id, nodes).position[1]
}

test('floor-placed kinds stand on the slab under them without a registered plugin', () => {
  const onDeck = { parentId: level.id, position: [1, 0, 1] as [number, number, number] }
  expect(liftOf(BlockNode.parse({ ...onDeck }))).toBeCloseTo(1)
  expect(liftOf(ColumnNode.parse({ ...onDeck }))).toBeCloseTo(1)
  expect(liftOf(SpawnNode.parse({ ...onDeck }))).toBeCloseTo(1)
  expect(liftOf(HvacEquipmentNode.parse({ ...onDeck }))).toBeCloseTo(1)
  expect(liftOf(DuctTerminalNode.parse({ ...onDeck, mount: 'floor' }))).toBeCloseTo(1)

  const segment = StairSegmentNode.parse({ id: 'sseg_deck' })
  const stair = StairNode.parse({ ...onDeck, children: [segment.id] })
  expect(liftOf(stair, [{ ...segment, parentId: stair.id }])).toBeCloseTo(1)
})

test('kinds that are not floor-placed keep their stored height', () => {
  expect(liftOf(RoofNode.parse({ parentId: level.id, position: [1, 0, 1] }))).toBeCloseTo(0)
  expect(
    liftOf(DuctTerminalNode.parse({ parentId: level.id, position: [1, 2.4, 1], mount: 'ceiling' })),
  ).toBeCloseTo(2.4)
})

test('a floor-placed node off the slab stays on the level plane', () => {
  expect(liftOf(ColumnNode.parse({ parentId: level.id, position: [20, 0, 20] }))).toBeCloseTo(0)
})
