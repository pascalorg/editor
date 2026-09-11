import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, LevelNode, SlabNode, WallNode } from '@pascal-app/core'
import { createSlabDependencyTracker } from './dependency-tracker'

const polygon: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
function fixture() {
  const building = BuildingNode.parse({ id: 'building_tracker', children: ['level_tracker'] })
  const level = LevelNode.parse({ id: 'level_tracker', parentId: building.id })
  const slab = SlabNode.parse({ id: 'slab_near', parentId: level.id, polygon })
  const remote = SlabNode.parse({
    id: 'slab_remote',
    parentId: level.id,
    polygon: polygon.map(([x, z]) => [x + 40, z]),
  })
  const wall = WallNode.parse({
    id: 'wall_tracker',
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
    thickness: 0.2,
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, level, slab, remote, wall].map((node) => [node.id, node]),
  )
  return { nodes, building, level, slab, remote, wall }
}

describe('slab dependency tracker', () => {
  test('marks only the adopted slab for wall edits and restoration', () => {
    const { nodes, wall, slab } = fixture()
    const changed = createSlabDependencyTracker(nodes)
    const next = { ...nodes, [wall.id]: { ...wall, thickness: 0.4 } }
    expect(changed(next)).toEqual([slab.id])
    expect(changed(nodes)).toEqual([slab.id])
    expect(changed({ ...nodes })).toEqual([])
  })

  test('ignores wall changes that do not change any rendered polygon', () => {
    const { nodes, wall } = fixture()
    const changed = createSlabDependencyTracker(nodes)
    expect(changed({ ...nodes, [wall.id]: { ...wall, height: 3 } })).toEqual([])
    const remote = WallNode.parse({
      id: 'wall_remote',
      parentId: wall.parentId,
      start: [80, 0],
      end: [84, 0],
    })
    expect(changed({ ...nodes, [remote.id]: remote })).toEqual([])
  })

  test('tracks sibling creation, floating classification, elevation and deletion', () => {
    const { nodes, slab, wall } = fixture()
    const sibling = SlabNode.parse({
      id: 'slab_sibling',
      parentId: slab.parentId,
      polygon: [
        [0, -4],
        [4, -4],
        [4, 0],
        [0, 0],
      ],
      elevation: 0.2,
      thickness: 0.05,
    })
    const changed = createSlabDependencyTracker(nodes)
    expect(changed({ ...nodes, [sibling.id]: sibling })).toEqual([sibling.id])
    const grounded = { ...sibling, thickness: 0.2 }
    const joined = { ...nodes, [sibling.id]: grounded }
    expect(changed(joined).sort()).toEqual([slab.id, sibling.id].sort())
    expect(changed({ ...joined, [sibling.id]: { ...grounded, elevation: 0.05 } }).sort()).toEqual(
      [slab.id, sibling.id].sort(),
    )
    expect(changed(nodes)).toEqual([slab.id])
    expect(wall.thickness).toBe(0.2)
  })

  test('recessed floating siblings become seam partners', () => {
    const { nodes, slab } = fixture()
    const sibling = SlabNode.parse({
      id: 'slab_pool',
      parentId: slab.parentId,
      polygon: [
        [0, -4],
        [4, -4],
        [4, 0],
        [0, 0],
      ],
      elevation: 0.2,
    })
    const next = { ...nodes, [sibling.id]: sibling }
    const changed = createSlabDependencyTracker(next)
    expect(changed({ ...next, [sibling.id]: { ...sibling, recessed: true } }).sort()).toEqual(
      [slab.id, sibling.id].sort(),
    )
  })

  test('curved adopted bands change the local slab only', () => {
    const { nodes, slab, wall } = fixture()
    const changed = createSlabDependencyTracker(nodes)
    expect(changed({ ...nodes, [wall.id]: { ...wall, curveOffset: 0.3 } })).toEqual([slab.id])
  })

  test('building transforms invalidate terrain fills only', () => {
    const { nodes, building, slab } = fixture()
    const initial = { ...nodes, [slab.id]: { ...slab, fillToTerrain: true } }
    const changed = createSlabDependencyTracker(initial)
    expect(
      changed({
        ...initial,
        [building.id]: { ...building, position: [1, 0, 2] as [number, number, number] },
      }),
    ).toEqual([slab.id])
  })
})
