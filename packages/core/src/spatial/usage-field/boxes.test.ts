import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  CabinetModuleNode,
  CabinetNode,
  ColumnNode,
  LevelNode,
  ShelfNode,
  SlabNode,
} from '../../schema'
import { boxBodies } from './boxes'
import type { Prism } from './types'
import type { Nodes } from './walls'

function scene(extra: AnyNode[]): Nodes {
  const building = BuildingNode.parse({ id: 'building_1', children: ['level_1'] })
  const level = LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] })
  return Object.fromEntries([building, level, ...extra].map((node) => [node.id, node])) as Nodes
}

const bounds = (prisms: Prism[]) => {
  const points = prisms.flatMap((p) => p.outer)
  const xs = points.map(([x]) => x)
  const zs = points.map(([, z]) => z)
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }
}

const prismsOf = (nodes: Nodes, id: string) =>
  boxBodies(nodes).nodes.find((n) => n.nodeId === id)?.prisms ?? []

describe('footprint boxes', () => {
  test('a column is its box, from the floor to its height', () => {
    const column = ColumnNode.parse({
      id: 'column_1',
      parentId: 'level_1',
      position: [2, 0, 3],
      height: 2.6,
    })
    const prisms = prismsOf(scene([column]), 'column_1')
    expect(prisms).toHaveLength(1)
    expect(prisms[0]!.kind).toBe('column')
    expect([prisms[0]!.z0, prisms[0]!.z1]).toEqual([0, 2.6])
    expect(prisms[0]!.shape).toBe('approx')
    const b = bounds(prisms)
    expect((b.x0 + b.x1) / 2).toBeCloseTo(2, 6)
    expect((b.z0 + b.z1) / 2).toBeCloseTo(3, 6)
  })

  test('it stands on the slab under it', () => {
    const slab = SlabNode.parse({
      id: 'slab_1',
      parentId: 'level_1',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 8],
        [0, 8],
      ],
      elevation: 0.2,
    })
    const column = ColumnNode.parse({
      id: 'column_1',
      parentId: 'level_1',
      position: [2, 0, 3],
      height: 2.6,
    })
    expect(prismsOf(scene([slab, column]), 'column_1')[0]!.z0).toBeCloseTo(0.2, 6)
  })

  test('a cabinet run is one box per module, and a nested run is not counted twice', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_1',
      parentId: 'level_1',
      position: [1, 0, 1],
      children: ['cabinet-module_1', 'cabinet-module_2'],
    })
    const a = CabinetModuleNode.parse({
      id: 'cabinet-module_1',
      parentId: run.id,
      position: [-0.3, 0, 0],
      width: 0.6,
      depth: 0.6,
    })
    const b = CabinetModuleNode.parse({
      id: 'cabinet-module_2',
      parentId: run.id,
      position: [0.3, 0, 0],
      width: 0.6,
      depth: 0.6,
    })
    const nodes = scene([run, a, b])
    expect(prismsOf(nodes, 'cabinet_1')).toHaveLength(2)
    expect(prismsOf(nodes, 'cabinet-module_1')).toHaveLength(0)
    const all = boxBodies(nodes).nodes.flatMap((n) => n.prisms)
    expect(all.every((p) => p.kind === 'cabinet')).toBe(true)
    const b0 = bounds(all)
    expect(b0.x1 - b0.x0).toBeCloseTo(1.2, 6)
    expect(b0.z1 - b0.z0).toBeCloseTo(0.6, 6)
  })

  test('a wall cabinet hangs at the height its run is placed at', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_1',
      parentId: 'level_1',
      position: [1, 1.4, 1],
      runTier: 'wall',
      children: ['cabinet-module_1'],
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_1',
      parentId: run.id,
      position: [0, 0, 0],
      width: 0.85,
      depth: 0.32,
    })
    const [prism] = prismsOf(scene([run, module]), 'cabinet_1')
    expect(prism!.z0).toBeCloseTo(1.4, 6)
    expect(prism!.z1).toBeGreaterThan(prism!.z0 + 0.5)
  })

  test('a shelf is its box', () => {
    const shelf = ShelfNode.parse({
      id: 'shelf_1',
      parentId: 'level_1',
      position: [1, 0, 1],
      width: 1,
      depth: 0.3,
      height: 1.8,
    })
    const [prism] = prismsOf(scene([shelf]), 'shelf_1')
    expect(prism!.kind).toBe('shelf')
    expect(prism!.z1 - prism!.z0).toBeCloseTo(1.8, 6)
  })

  test('a hidden node is left out', () => {
    const column = ColumnNode.parse({ id: 'column_1', parentId: 'level_1', visible: false })
    expect(boxBodies(scene([column])).nodes).toHaveLength(0)
  })
})
