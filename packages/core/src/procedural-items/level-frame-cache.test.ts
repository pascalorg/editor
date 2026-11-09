import { expect, test } from 'bun:test'
import { LevelNode } from '../schema/nodes/level'
import { WallNode } from '../schema/nodes/wall'
import { WindowNode } from '../schema/nodes/window'
import type { AnyNode } from '../schema/types'
import { nodeLevelFrame } from './query'
import type { Frame } from './spatial'

test('nodeLevelFrame resolves each host once per shared cache', () => {
  const level = LevelNode.parse({ id: 'level_cache' })
  const wall = WallNode.parse({ id: 'wall_cache', parentId: level.id, start: [0, 0], end: [4, 0] })
  const windows = [1, 2, 3].map((x) =>
    WindowNode.parse({ parentId: wall.id, wallId: wall.id, position: [x, 1, 0] }),
  )
  const nodes: Record<string, AnyNode> = { [level.id]: level, [wall.id]: wall }
  for (const window of windows) nodes[window.id] = window

  const cache = new Map<string, Frame>()
  const first = nodeLevelFrame(windows[0]!.id, nodes, undefined, { cache })
  expect(cache.has(wall.id)).toBe(true)
  // A cached host frame is reused as is: shift it and the next window follows.
  const shifted = { ...cache.get(wall.id)!, position: [10, 0, 0] as [number, number, number] }
  cache.set(wall.id, shifted)
  const second = nodeLevelFrame(windows[1]!.id, nodes, undefined, { cache })
  expect(second.position[0]).toBeCloseTo(12)
  expect(first.position[0]).toBeCloseTo(1)
  // Without a cache every call resolves afresh.
  expect(nodeLevelFrame(windows[1]!.id, nodes).position[0]).toBeCloseTo(2)
})

test('a plan-only frame skips heights but keeps plan placement', () => {
  const level = LevelNode.parse({ id: 'level_plan' })
  const wall = WallNode.parse({ id: 'wall_plan', parentId: level.id, start: [2, 1], end: [2, 5] })
  const window = WindowNode.parse({ parentId: wall.id, wallId: wall.id, position: [1, 1.2, 0] })
  const nodes: Record<string, AnyNode> = { [level.id]: level, [wall.id]: wall, [window.id]: window }
  const full = nodeLevelFrame(window.id, nodes)
  const plan = nodeLevelFrame(window.id, nodes, undefined, { planOnly: true })
  expect(plan.position[0]).toBeCloseTo(full.position[0])
  expect(plan.position[2]).toBeCloseTo(full.position[2])
  expect(plan.position[2]).toBeCloseTo(2)
})
