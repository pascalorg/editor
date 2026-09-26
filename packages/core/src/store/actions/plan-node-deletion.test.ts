import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { LevelNode } from '../../schema/nodes/level'
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
})
