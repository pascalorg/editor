import { describe, expect, spyOn, test } from 'bun:test'
import {
  AnyNode,
  BuildingNode,
  type GeometryContext,
  getRenderableSlabPolygon,
  LevelNode,
  prepareSlabPolygonContext,
  SlabNode,
  scopeSlabPolygonContext,
  slabPolygonContextForLevel,
  slabPolygonContextFromGeometry,
  WallNode,
} from '@pascal-app/core'
import maxi from '../../../core/src/store/fixtures/maxi-8x-endpoint.json'
import { createSlabDependencyTracker } from './dependency-tracker'

const polygon: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
function fixture() {
  const building = BuildingNode.parse({ id: 'building_tracker', children: ['level_tracker'] })
  const level = LevelNode.parse({
    id: 'level_tracker',
    parentId: building.id,
    children: ['slab_near', 'slab_remote', 'wall_tracker'],
  })
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
    const { nodes, level, slab, wall } = fixture()
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
    const withSibling = {
      ...nodes,
      [level.id]: { ...level, children: [...level.children, sibling.id] },
    }
    expect(changed({ ...withSibling, [sibling.id]: sibling })).toEqual([sibling.id])
    const grounded = { ...sibling, thickness: 0.2 }
    const joined = { ...withSibling, [sibling.id]: grounded }
    expect(changed(joined).sort()).toEqual([slab.id, sibling.id].sort())
    expect(changed({ ...joined, [sibling.id]: { ...grounded, elevation: 0.05 } }).sort()).toEqual(
      [slab.id, sibling.id].sort(),
    )
    expect(changed(nodes)).toEqual([slab.id])
    expect(wall.thickness).toBe(0.2)
  })

  test('recessed floating siblings become seam partners', () => {
    const { nodes, level, slab } = fixture()
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
    const next = {
      ...nodes,
      [sibling.id]: sibling,
      [level.id]: { ...level, children: [...level.children, sibling.id] },
    }
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

test('adopts the first tied wall in level.children order and invalidates reordered membership', () => {
  const { nodes, level, wall, slab } = fixture()
  const second = WallNode.parse({ ...wall, id: 'wall_second', thickness: 0.4 })
  const initial = {
    ...nodes,
    [second.id]: second,
    [level.id]: { ...level, children: [second.id, ...level.children] },
  }
  const changed = createSlabDependencyTracker(initial)
  const next = { ...initial, [second.id]: { ...second, thickness: 0.6 } }
  expect(changed(next)).toEqual([slab.id])
  expect(
    changed({ ...next, [level.id]: { ...level, children: [...level.children, second.id] } }),
  ).toEqual([slab.id])
  expect(
    changed({
      ...next,
      [level.id]: { ...level, children: level.children.filter((id) => id !== wall.id) },
    }),
  ).toEqual([slab.id])
})

test('Maxi tracker context matches the renderer membership, order and polygons', () => {
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    maxi.nodes.map((raw) => {
      const node = AnyNode.parse(raw)
      return [node.id, node]
    }),
  )
  const level = nodes[maxi.levelId] as LevelNode
  const context = slabPolygonContextForLevel(level, (id) => nodes[id])
  expect(context.walls).toHaveLength(312)
  expect(context.siblingSlabs).toHaveLength(72)
  const prepared = prepareSlabPolygonContext(context)
  for (const slab of context.siblingSlabs) {
    const renderer = slabPolygonContextFromGeometry({
      parent: level,
      resolve: (id) => nodes[id],
      siblings: level.children
        .map((id) => nodes[id])
        .filter((node) => node?.type === 'slab' && node.id !== slab.id),
    } as GeometryContext)
    const tracker = {
      walls: context.walls,
      siblingSlabs: context.siblingSlabs.filter((node) => node.id !== slab.id),
    }
    expect(getRenderableSlabPolygon(slab, scopeSlabPolygonContext(slab, prepared))).toEqual(
      getRenderableSlabPolygon(slab, renderer),
    )
    expect(tracker).toEqual(renderer)
    expect(getRenderableSlabPolygon(slab, tracker)).toEqual(
      getRenderableSlabPolygon(slab, renderer),
    )
  }
})

test('unchanged input references skip serialization and equal-value replacements stay clean', () => {
  const { nodes, wall, slab } = fixture()
  const changed = createSlabDependencyTracker(nodes)
  const stringify = spyOn(JSON, 'stringify')
  try {
    const dirty = changed({
      ...nodes,
      unrelated: { ...nodes[slab.id], id: 'ceiling_unrelated', type: 'ceiling' } as AnyNode,
    })
    expect(stringify).not.toHaveBeenCalled()
    expect(dirty).toEqual([])
  } finally {
    stringify.mockRestore()
  }
  const replaced = Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [id, structuredClone(node)]),
  )
  expect(changed(replaced)).toEqual([])
  expect(changed({ ...replaced, [wall.id]: { ...wall, thickness: 0.4 } })).toEqual([slab.id])
})

test('new adoption, deletion and reparenting match the unfiltered renderer', () => {
  const { nodes, level, slab, wall } = fixture()
  const otherLevel = LevelNode.parse({ id: 'level_other', children: [] })
  let previous = { ...nodes, [otherLevel.id]: otherLevel }
  const changed = createSlabDependencyTracker(previous)
  const rendered = (snapshot: Record<string, AnyNode>, slab: SlabNode) => {
    const siblings = Object.values(snapshot).filter(
      (node): node is SlabNode => node.type === 'slab' && node.parentId === slab.parentId,
    )
    const context = slabPolygonContextForLevel(
      snapshot[slab.parentId!] ?? null,
      (id) => snapshot[id],
      siblings,
    )
    return getRenderableSlabPolygon(slab, {
      ...context,
      siblingSlabs: context.siblingSlabs.filter((node) => node.id !== slab.id),
    })
  }
  const verify = (next: Record<string, AnyNode>) => {
    const expected = Object.values(next)
      .filter((node): node is SlabNode => node.type === 'slab')
      .filter((node) => {
        const before = previous[node.id]
        return (
          before?.type !== 'slab' ||
          JSON.stringify(rendered(previous, before)) !== JSON.stringify(rendered(next, node))
        )
      })
      .map((node) => node.id)
      .sort()
    expect(changed(next).sort()).toEqual(expected)
    previous = next
  }
  verify({ ...previous, [wall.id]: { ...wall, start: [0, 20], end: [4, 20] } })
  verify({ ...previous, [wall.id]: { ...wall, thickness: 0.7, curveOffset: 0.2 } })
  const { [wall.id]: _deleted, ...withoutWall } = previous
  verify(withoutWall)
  verify({ ...previous, [wall.id]: wall })
  verify({
    ...previous,
    [slab.id]: { ...slab, parentId: otherLevel.id },
    [level.id]: { ...level, children: level.children.filter((id) => id !== slab.id) },
    [otherLevel.id]: { ...otherLevel, children: [slab.id] },
  })
})
