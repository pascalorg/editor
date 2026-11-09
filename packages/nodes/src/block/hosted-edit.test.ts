import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BlockNode,
  type BlockTopology,
  getBlockFaceFrame,
  type ItemNode,
} from '@pascal-app/core'
import { planBlockTopologyEdit } from './hosted-edit'

const block = BlockNode.parse({ id: 'block_h', parentId: 'level_a', children: ['item_w'] })
const wallItem = {
  id: 'item_w',
  type: 'item',
  parentId: 'block_h',
  blockFaceId: 'f-front',
  position: [0.5, 0.2, 0],
  rotation: [0, 0, 0],
  asset: { attachTo: 'wall', dimensions: [0.4, 0.4, 0.05] },
} as unknown as ItemNode

function worldOf(topology: BlockTopology, item: ItemNode) {
  const frame = getBlockFaceFrame(topology, item.blockFaceId!)!
  return [0, 1, 2].map(
    (axis) =>
      frame.origin[axis]! +
      frame.xAxis[axis]! * item.position[0] +
      frame.yAxis[axis]! * item.position[1] +
      frame.normal[axis]! * item.position[2],
  )
}

function plan(next: BlockTopology) {
  const nodes: Record<string, AnyNode> = { block_h: block, item_w: wallItem as AnyNode }
  const updates = planBlockTopologyEdit(
    { get: <T>(id: AnyNodeId) => nodes[id] as T | undefined } as never,
    'block_h' as AnyNodeId,
    next,
  )
  expect(updates).not.toBeNull()
  const patch = updates?.find(([id]) => id === 'item_w')?.[1] as Partial<ItemNode> | undefined
  return { ...wallItem, ...patch } as ItemNode
}

function moved(test: (position: number[]) => boolean, delta: [number, number, number]) {
  const next = structuredClone(block.topology)
  for (const vertex of next.vertices) {
    if (!test(vertex.position)) continue
    vertex.position = vertex.position.map((value, axis) => value + delta[axis]!) as [
      number,
      number,
      number,
    ]
  }
  return next
}

describe('planBlockTopologyEdit with wall-mounted face items', () => {
  test('stretching the host face keeps the item where it was', () => {
    const next = moved((position) => position[0] > 0, [2, 0, 0])
    const after = plan(next)
    const before = worldOf(block.topology, wallItem)
    worldOf(next, after).forEach((value, axis) => {
      expect(value).toBeCloseTo(before[axis]!, 6)
    })
  })

  test('moving the host face as a whole carries the item with it', () => {
    const next = moved((position) => position[2] < 0, [0, 0, -0.5])
    const after = plan(next)
    const before = worldOf(block.topology, wallItem)
    expect(worldOf(next, after)).toEqual([before[0]!, before[1]!, before[2]! - 0.5])
  })
})
