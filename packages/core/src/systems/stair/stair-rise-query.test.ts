import { expect, test } from 'bun:test'
import { type AnyNode, LevelNode, StairNode, StairSegmentNode } from '../../schema'
import { syncStairRises } from './stair-rise-query'

test('a single flight restores the exact target rise after floor-normalized height and repeated level writes', () => {
  const level = LevelNode.parse({ height: 2.5 })
  const stair = StairNode.parse({ parentId: level.id })
  const segment = StairSegmentNode.parse({ parentId: stair.id, height: 2.45 })
  level.children = [stair.id]
  stair.children = [segment.id]
  let nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, stair, segment].map((node) => [node.id, node]),
  )
  for (const height of [2.5, 4, 2.5, 4, 2.5]) {
    nodes = { ...nodes, [level.id]: { ...level, height } }
    const updates = syncStairRises(nodes)
    expect(updates).toEqual([{ id: segment.id, data: { height } }])
    nodes = {
      ...nodes,
      [segment.id]: {
        ...segment,
        ...(updates[0]!.data as Partial<StairSegmentNode>),
      } as StairSegmentNode,
    }
    expect(syncStairRises(nodes)).toEqual([])
  }
})
