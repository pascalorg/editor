import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { LevelNode } from '../../schema/nodes/level'
import { RoofNode } from '../../schema/nodes/roof'
import { RoofSegmentNode } from '../../schema/nodes/roof-segment'
import { WallNode } from '../../schema/nodes/wall'
import { WindowNode } from '../../schema/nodes/window'
import type { AnyNode, AnyNodeId } from '../../schema/types'
import useScene from '../use-scene'
import { planNodeDeletion } from './node-actions'

let savedScene: ReturnType<typeof useScene.getState>
let savedRaf: typeof requestAnimationFrame
beforeEach(() => {
  savedScene = useScene.getState()
  savedRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = () => 0
  useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set(), readOnly: false })
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useScene.setState(savedScene)
  useScene.temporal.getState().clear()
  globalThis.requestAnimationFrame = savedRaf
})

function seed(nodes: AnyNode[]) {
  const level = LevelNode.parse({ children: nodes.filter((n) => !n.parentId).map((n) => n.id) })
  const record: Record<string, AnyNode> = { [level.id]: level }
  for (const node of nodes) record[node.id] = { ...node, parentId: node.parentId ?? level.id }
  useScene.setState({ nodes: record as Record<AnyNodeId, AnyNode>, rootNodeIds: [level.id] })
}

describe('planNodeDeletion', () => {
  test('is exactly what the delete action commits, including merged-away walls', () => {
    const a = WallNode.parse({ id: 'wall_a', start: [0, 0], end: [2, 0] })
    const b = WallNode.parse({ id: 'wall_b', start: [2, 0], end: [4, 0] })
    const spur = WallNode.parse({ id: 'wall_spur', start: [2, 0], end: [2, 2] })
    seed([a, b, spur])

    const before = useScene.getState()
    const plan = planNodeDeletion(before, [spur.id])
    expect([...plan.deletedIds].sort()).toEqual([b.id, spur.id])
    // Pure: the store is untouched until the action runs.
    expect(useScene.getState().nodes).toBe(before.nodes)

    useScene.getState().deleteNodes([spur.id])
    expect(useScene.getState().nodes).toEqual(plan.nodes)
    const merged = plan.nodes[a.id as AnyNodeId]
    expect(merged?.type === 'wall' && merged.end).toEqual([4, 0])
  })

  test('follows the children arrays the store walks', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [4, 0] })
    const window = WindowNode.parse({ wallId: wall.id, position: [1, 1, 0], parentId: wall.id })
    seed([{ ...wall, children: [window.id] }, window])

    const plan = planNodeDeletion(useScene.getState(), [wall.id])
    expect([...plan.deletedIds].sort()).toEqual([wall.id, window.id].sort())
    expect(plan.nodes[window.id as AnyNodeId]).toBeUndefined()
  })
  test('a preview is deterministic and matches the commit outside the refreshed defaults', () => {
    const level = LevelNode.parse({})
    useScene.setState({
      nodes: { [level.id]: level } as Record<AnyNodeId, AnyNode>,
      rootNodeIds: [level.id],
    })
    const roof = RoofNode.parse({})
    const segment = (x: number) =>
      RoofSegmentNode.parse({
        position: [x, 0, 0],
        width: 4,
        depth: 4,
        roofType: 'hip',
        metadata: { autoGutter: true },
      })
    const [a, b] = [segment(0), segment(4)]
    useScene.getState().createNodes([
      { node: roof, parentId: level.id },
      { node: a, parentId: roof.id },
      { node: b, parentId: roof.id },
    ])

    const before = useScene.getState()
    const first = planNodeDeletion(before, [b.id], { mintDefaults: false })
    const second = planNodeDeletion(before, [b.id], { mintDefaults: false })
    expect(second).toEqual(first)
    expect(Object.keys(first.nodes).filter((id) => !(id in before.nodes))).toEqual([])
    // The surviving segment's default gutters and their downspouts are unsettled.
    expect(first.unsettledIds.size).toBeGreaterThan(0)
    for (const id of first.unsettledIds) {
      expect(['gutter', 'downspout']).toContain(before.nodes[id]!.type)
    }

    useScene.getState().deleteNodes([b.id])
    const committed = useScene.getState().nodes
    const settled = (id: string) => id in before.nodes && !first.unsettledIds.has(id as AnyNodeId)
    const withoutChildren = (node: AnyNode | undefined) => {
      const { children, ...rest } = (node ?? {}) as AnyNode & { children?: string[] }
      return { rest, children: (children ?? []).filter(settled) }
    }
    for (const id of Object.keys(before.nodes).filter(settled)) {
      expect(id in committed).toBe(id in first.nodes)
      if (!(id in committed)) continue
      expect(withoutChildren(first.nodes[id as AnyNodeId])).toEqual(
        withoutChildren(committed[id as AnyNodeId]),
      )
    }
  })
})
