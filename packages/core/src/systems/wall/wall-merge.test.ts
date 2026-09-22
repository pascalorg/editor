import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  DoorNode,
  LevelNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import useScene from '../../store/use-scene'
import { planWallMerge } from './wall-merge'
import { planWallDivision } from './wall-operations'
import type { WallTopologyChanges } from './wall-topology'

const level = LevelNode.parse({ id: 'level_merge', children: [] })
const map = (nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
const apply = (nodes: Record<AnyNodeId, AnyNode>, changes: WallTopologyChanges) => {
  const next = { ...nodes }
  for (const { node, parentId } of changes.create)
    next[node.id] = (parentId ? { ...node, parentId } : node) as AnyNode
  for (const { id, data } of changes.update) next[id] = { ...next[id]!, ...data } as AnyNode
  for (const id of changes.delete) delete next[id]
  return next
}
const wall = (start: [number, number], end: [number, number], extra: Partial<WallNode> = {}) =>
  WallNode.parse({ parentId: level.id, start, end, ...extra })

describe('explicit wall merge', () => {
  test('undoes a split: one wall again, openings back where they were', () => {
    const original = wall([0, 0], [8, 0])
    const window = WindowNode.parse({
      parentId: original.id,
      wallId: original.id,
      position: [7, 1.5, 0],
      width: 1,
    })
    original.children = [window.id]
    const split = apply(
      map([original, window]),
      planWallDivision(map([original, window]), original.id, 3).changes,
    )
    const ids = Object.values(split)
      .filter((n): n is WallNode => n.type === 'wall')
      .map((w) => w.id)
    expect(ids).toHaveLength(2)

    const plan = planWallMerge(split, ids)
    const merged = apply(split, plan.changes)
    const walls = Object.values(merged).filter((n): n is WallNode => n.type === 'wall')
    expect(walls).toHaveLength(1)
    expect([walls[0]!.start, walls[0]!.end]).toEqual([
      [0, 0],
      [8, 0],
    ])
    expect(plan.wallId).toBe(walls[0]!.id)
    const moved = merged[window.id] as WindowNode
    expect(moved.parentId).toBe(plan.wallId)
    expect(moved.position).toEqual([7, 1.5, 0])
    expect(split[ids[0]!]).toBeDefined()
  })

  test('a straight run of three becomes one wall and rooms keep one reference', () => {
    const a = wall([0, 0], [2, 0])
    const b = wall([2, 0], [5, 0])
    const c = wall([5, 0], [9, 0])
    const zone = ZoneNode.parse({
      name: 'Room',
      parentId: level.id,
      polygon: [
        [0, 0],
        [9, 0],
        [9, 4],
        [0, 4],
      ],
      boundaryWallIds: [a.id, b.id, c.id],
    })
    const nodes = map([a, b, c, zone])
    const plan = planWallMerge(nodes, [c.id, a.id, b.id])
    const merged = apply(nodes, plan.changes)
    const kept = merged[plan.wallId] as WallNode
    expect([kept.start, kept.end].sort()).toEqual([
      [0, 0],
      [9, 0],
    ])
    expect(plan.changes.delete).toHaveLength(2)
    expect((merged[zone.id] as ZoneNode).boundaryWallIds).toEqual([plan.wallId])
  })

  test('walls that look alike merge even when room sides or height mode differ', () => {
    const storeyLevel = { ...level, height: 3 } as AnyNode
    const a = wall([0, 0], [4, 0], { frontSide: 'interior', backSide: 'exterior' })
    const b = wall([4, 0], [8, 0], { height: 3 })
    const nodes = {
      ...map([a, b]),
      [level.id]: storeyLevel,
    } as Record<AnyNodeId, AnyNode>
    expect(() => planWallMerge(nodes, [a.id, b.id])).not.toThrow()
    const taller = wall([4, 0], [8, 0], { height: 3.5 })
    expect(() =>
      planWallMerge(
        { ...map([a, taller]), [level.id]: storeyLevel } as Record<AnyNodeId, AnyNode>,
        [a.id, taller.id],
      ),
    ).toThrow('These walls have a different height.')
  })

  test('refuses anything that would change the layout', () => {
    const a = wall([0, 0], [4, 0])
    const b = wall([4, 0], [8, 0])
    const tee = wall([4, 0], [4, 3])
    expect(() => planWallMerge(map([a, b, tee]), [a.id, b.id])).toThrow('Another wall')
    const corner = wall([4, 0], [4, 4])
    expect(() => planWallMerge(map([a, corner]), [a.id, corner.id])).toThrow('straight line')
    const thick = wall([4, 0], [8, 0], { thickness: 0.3 })
    expect(() => planWallMerge(map([a, thick]), [a.id, thick.id])).toThrow(
      'These walls have a different thickness.',
    )
    const curved = wall([4, 0], [8, 0], { curveOffset: 0.5 })
    expect(() => planWallMerge(map([a, curved]), [a.id, curved.id])).toThrow('straight walls')
    const apart = wall([5, 0], [8, 0])
    expect(() => planWallMerge(map([a, apart]), [a.id, apart.id])).toThrow('end to end')
    expect(() => planWallMerge(map([a]), [a.id])).toThrow('two or more')
  })
})

describe('explicit wall merge through the store', () => {
  let saved: ReturnType<typeof useScene.getState>
  const raf = globalThis.requestAnimationFrame
  beforeEach(() => {
    saved = useScene.getState()
    globalThis.requestAnimationFrame = () => 0
  })
  afterEach(() => {
    useScene.setState(saved)
    globalThis.requestAnimationFrame = raf
  })

  test('the absorbed wall is deleted without taking its moved window along', () => {
    const kept = wall([0, 0], [4, 0])
    const absorbed = wall([4, 0], [8, 0])
    const windows = [
      WindowNode.parse({ parentId: kept.id, wallId: kept.id, position: [1, 1.5, 0], width: 0.8 }),
      WindowNode.parse({ parentId: kept.id, wallId: kept.id, position: [3, 1.5, 0], width: 0.8 }),
      WindowNode.parse({
        parentId: absorbed.id,
        wallId: absorbed.id,
        position: [2, 1.5, 0],
        width: 0.8,
      }),
    ]
    kept.children = [windows[0]!.id, windows[1]!.id]
    absorbed.children = [windows[2]!.id]
    const levelNode = { ...level, children: [kept.id, absorbed.id] }
    useScene.setState({
      nodes: Object.fromEntries(
        [levelNode, kept, absorbed, ...windows].map((n) => [n.id, n]),
      ) as Record<AnyNodeId, AnyNode>,
      rootNodeIds: [level.id],
      readOnly: false,
    })

    const plan = planWallMerge(useScene.getState().nodes, [kept.id, absorbed.id])
    expect(plan.wallId).toBe(kept.id)
    useScene.getState().applyNodeChanges(plan.changes)

    const nodes = useScene.getState().nodes
    expect(nodes[absorbed.id]).toBeUndefined()
    const merged = nodes[kept.id] as WallNode
    expect(merged.end).toEqual([8, 0])
    expect(merged.children).toEqual(windows.map((w) => w.id))
    const moved = nodes[windows[2]!.id] as WindowNode
    expect(moved.parentId).toBe(kept.id)
    expect(moved.position).toEqual([6, 1.5, 0])
    expect((nodes[level.id] as LevelNode).children).toEqual([kept.id])
  })
  test('walls meeting start-to-start or end-to-end keep the kept wall facing; absorbed openings mirror', () => {
    for (const [kept, absorbed, absorbedWindowX, expectedX, expectedRun] of [
      // Kept runs 4→8, absorbed runs 4→0: merged must still run 0→8.
      [wall([4, 0], [8, 0]), wall([4, 0], [0, 0]), 1, 3, [0, 8]],
      // Kept runs 0→4, absorbed runs 8→4.
      [wall([0, 0], [4, 0]), wall([8, 0], [4, 0]), 1, 7, [0, 8]],
    ] as const) {
      const keptWindows = [0.5, 2, 3.5].map((x) =>
        WindowNode.parse({ parentId: kept.id, wallId: kept.id, position: [x, 1.5, 0], width: 0.6 }),
      )
      const absorbedWindow = WindowNode.parse({
        parentId: absorbed.id,
        wallId: absorbed.id,
        position: [absorbedWindowX, 1.5, 0],
        width: 0.6,
        side: 'front',
      })
      const absorbedDoor = DoorNode.parse({
        parentId: absorbed.id,
        wallId: absorbed.id,
        position: [absorbedWindowX + 1.5, 0, 0.05],
        width: 0.9,
        rotation: [0, 0.25, 0],
        hingesSide: 'left',
        handleSide: 'right',
      })
      kept.children = keptWindows.map((w) => w.id)
      absorbed.children = [absorbedWindow.id, absorbedDoor.id]
      const graph = map([kept, absorbed, ...keptWindows, absorbedWindow, absorbedDoor])
      const plan = planWallMerge(graph, [kept.id, absorbed.id])
      expect(plan.wallId).toBe(kept.id)
      const nodes = apply(graph, plan.changes)
      const merged = nodes[kept.id] as WallNode
      expect([merged.start[0], merged.end[0]]).toEqual([...expectedRun])
      const moved = nodes[absorbedWindow.id] as WindowNode
      expect(moved.position[0]).toBeCloseTo(expectedX)
      expect(moved.side).toBe('back')
      // A door on the reversed wall turns with its frame — depth and yaw — while
      // its hinges and handle, hung off that yaw, keep their stored side.
      const door = nodes[absorbedDoor.id] as DoorNode
      expect(door.position[2]).toBeCloseTo(-0.05)
      expect(door.rotation[1]).toBeCloseTo(0.25 - Math.PI)
      expect(door.hingesSide).toBe('left')
      expect(door.handleSide).toBe('right')
      // The kept wall's own openings keep their side and their world place.
      const keptFirst = nodes[keptWindows[0]!.id] as WindowNode
      expect(keptFirst.side).toBeUndefined()
      expect(keptFirst.position[0]).toBeCloseTo(kept.start[0] + 0.5 - merged.start[0])
    }
  })
  test('a child without a position moves to the kept wall too, and stale child ids are dropped', () => {
    const kept = wall([0, 0], [4, 0])
    const absorbed = wall([4, 0], [8, 0])
    // The wall with the most attachments is kept; three windows outnumber the two ids below.
    const windows = [0.5, 2, 3.5].map((x) =>
      WindowNode.parse({ parentId: kept.id, wallId: kept.id, position: [x, 1.5, 0], width: 0.8 }),
    )
    kept.children = windows.map((w) => w.id)
    // Stands in for a hosted kind the planner cannot re-place along the wall.
    const tag = { ...ZoneNode.parse({ name: 'Tag', polygon: [] }), parentId: absorbed.id }
    absorbed.children = [tag.id, 'window_gone']

    const graph = map([kept, absorbed, ...windows, tag])
    const plan = planWallMerge(graph, [kept.id, absorbed.id])
    expect(plan.wallId).toBe(kept.id)
    expect(plan.changes.delete).toEqual([absorbed.id])
    const nodes = apply(graph, plan.changes)
    expect(nodes[tag.id]?.parentId).toBe(kept.id)
    expect((nodes[kept.id] as WallNode).children).toEqual([...windows.map((w) => w.id), tag.id])
  })
})
