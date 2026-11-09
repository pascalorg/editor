import { expect, test } from 'bun:test'
import {
  CabinetModuleNode,
  CabinetNode,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SlabNode,
  WallNode,
} from '@pascal-app/core'
import { checkKitchenClearance } from '../../agent-operations'
import { itemDefinition } from '../../item/definition'
import { cabinetDefinition, cabinetModuleDefinition } from '../definition'
import {
  cabinetOpeningConflicts,
  cabinetOpeningFootprints,
  openingFootprintsOverlap,
} from '../opening-clearance'

test('drawer clearance follows cabinet rotation and excludes upper objects', () => {
  const node = CabinetModuleNode.parse({
    depth: 0.6,
    showPlinth: false,
    stack: [{ id: 'drawer', type: 'drawer', height: 0.72 }],
  })
  const [front] = cabinetOpeningFootprints(node, [2, 0, 3], Math.PI / 2)
  expect(front!.position[0]).toBeGreaterThan(2.3)
  expect(front!.position[2]).toBeCloseTo(3)
  expect(
    openingFootprintsOverlap(front!, { ...front!, position: [front!.position[0], 1.5, 3] }),
  ).toBe(false)
  expect(openingFootprintsOverlap(front!, { ...front! })).toBe(true)
})

test('open shelves and fillers do not request opening space', () => {
  expect(
    cabinetOpeningFootprints(
      CabinetModuleNode.parse({ stack: [{ id: 'shelf', type: 'shelf', height: 0.72 }] }),
      [0, 0, 0],
      0,
    ),
  ).toEqual([])
  expect(
    cabinetOpeningFootprints(CabinetModuleNode.parse({ moduleKind: 'wall-filler' }), [0, 0, 0], 0),
  ).toEqual([])
})

test('diagonal clearance rectangles use oriented edges instead of bounding boxes', () => {
  const a = {
    position: [0, 0, 0] as [number, number, number],
    dimensions: [2, 1, 0.1] as [number, number, number],
    rotation: [0, Math.PI / 4, 0] as [number, number, number],
  }
  expect(openingFootprintsOverlap(a, { ...a, position: [0.3, 0, 0.3] })).toBe(false)
  expect(openingFootprintsOverlap(a, { ...a, position: [0.01, 0, 0.01] })).toBe(true)
})

test('opening warnings detect a front wall and ignore hidden walls and other levels', () => {
  const module = CabinetModuleNode.parse({
    width: 0.6,
    depth: 0.6,
    showPlinth: false,
    stack: [{ id: 'door', type: 'door', height: 0.72 }],
  })
  const level = LevelNode.parse({})
  const wall = WallNode.parse({
    parentId: level.id,
    start: [-1, 0.55],
    end: [1, 0.55],
    thickness: 0.1,
  })
  const nodes = { [level.id]: level, [wall.id]: wall }
  expect(cabinetOpeningConflicts(module, [0, 0, 0], 0, level.id, nodes)).toEqual([wall.id])
  expect(
    cabinetOpeningConflicts(module, [0, 1.5, 0], 0, level.id, {
      ...nodes,
      [wall.id]: { ...wall, height: 1 },
    }),
  ).toEqual([])
  expect(
    cabinetOpeningConflicts(module, [0, 0, 0], 0, level.id, {
      ...nodes,
      [wall.id]: { ...wall, visible: false },
    }),
  ).toEqual([])
  expect(cabinetOpeningConflicts(module, [0, 0, 0], 0, 'level_elsewhere', nodes)).toEqual([])
})

test('opening warnings include catalog furniture with node-local footprint positions', () => {
  const restore = nodeRegistry._snapshot()
  try {
    nodeRegistry._reset()
    registerNode(itemDefinition)
    const level = LevelNode.parse({})
    const module = CabinetModuleNode.parse({ showPlinth: false, width: 0.6, depth: 0.6 })
    const chair = ItemNode.parse({
      parentId: level.id,
      position: [0, 0, 0.6],
      asset: {
        id: 'chair',
        name: 'Chair',
        category: 'furniture',
        thumbnail: '',
        src: '/chair.glb',
        dimensions: [0.3, 0.8, 0.3],
      },
    })
    expect(
      cabinetOpeningConflicts(module, [0, 0, 0], 0, level.id, {
        [level.id]: level,
        [chair.id]: chair,
      }),
    ).toEqual([chair.id])
  } finally {
    restore()
  }
})

for (const yaw of [0, Math.PI / 2]) {
  test(`hosted furniture clearance composes translation, yaw ${yaw}, and height`, () => {
    const restore = nodeRegistry._snapshot()
    try {
      registerNode(itemDefinition)
      const level = LevelNode.parse({})
      const asset = {
        id: 'fixture',
        name: 'Fixture',
        category: 'furniture',
        thumbnail: '',
        src: '/fixture.glb',
        dimensions: [0.3, 0.8, 0.3],
      }
      const host = ItemNode.parse({
        parentId: level.id,
        position: [10, 2, 4],
        rotation: [0, yaw, 0],
        asset,
      })
      const child = ItemNode.parse({ parentId: host.id, position: [0, 0, 0.6], asset })
      const module = CabinetModuleNode.parse({ showPlinth: false, width: 0.6, depth: 0.6 })
      const nodes = { [level.id]: level, [host.id]: host, [child.id]: child }
      expect(cabinetOpeningConflicts(module, [10, 2, 4], yaw, level.id, nodes)).toContain(child.id)
      expect(cabinetOpeningConflicts(module, [0, 0, 0], 0, level.id, nodes)).not.toContain(child.id)
      expect(cabinetOpeningConflicts(module, [10, 0, 4], yaw, level.id, nodes)).not.toContain(
        child.id,
      )
    } finally {
      restore()
    }
  })
}

test('registry notices and agent checks share clearance at rest, during moves, and on raised slabs', () => {
  const restore = nodeRegistry._snapshot()
  try {
    registerNode(itemDefinition)
    registerNode(cabinetDefinition)
    registerNode(cabinetModuleDefinition)
    const level = LevelNode.parse({})
    const slab = SlabNode.parse({
      parentId: level.id,
      polygon: [
        [8, 2],
        [12, 2],
        [12, 6],
        [8, 6],
      ],
      elevation: 2,
    })
    const run = CabinetNode.parse({ parentId: level.id, position: [10, 0, 4], showPlinth: false })
    const module = CabinetModuleNode.parse({
      parentId: run.id,
      position: [0, 0, 0],
      showPlinth: false,
      width: 0.6,
      depth: 0.6,
    })
    run.children = [module.id]
    const chair = ItemNode.parse({
      parentId: level.id,
      position: [10, 0, 4.6],
      asset: {
        id: 'chair',
        name: 'Chair',
        category: 'furniture',
        thumbnail: '',
        src: '/chair.glb',
        dimensions: [0.3, 0.8, 0.3],
      },
    })
    const nodes = Object.fromEntries(
      [level, slab, run, module, chair].map((node) => [node.id, node]),
    )
    const notice = cabinetDefinition.placementNotice!(run, { nodes })
    expect(notice?.line).toContain('Opening clearance')
    expect(
      checkKitchenClearance(nodes, { nodeId: run.id }, { activeLevelId: null }).result.warning,
    ).toBe(notice?.line)
    expect(
      cabinetDefinition.placementNotice!(run, {
        nodes,
        live: { position: [0, 0, 0], rotation: 0 },
      }),
    ).toBeNull()
    expect(
      cabinetModuleDefinition.placementNotice!(module, {
        nodes,
        live: { position: [3, 0, 0], rotation: 0 },
      }),
    ).toBeNull()
    const high = {
      ...nodes,
      [chair.id]: { ...chair, position: [10, 2, 4.6] as [number, number, number] },
    }
    expect(cabinetDefinition.placementNotice!(run, { nodes: high })).toBeNull()
  } finally {
    restore()
  }
})

test('headless clearance refuses missing capabilities instead of claiming the scene is clear', () => {
  const restore = nodeRegistry._snapshot()
  try {
    nodeRegistry._reset()
    const level = LevelNode.parse({})
    const run = CabinetNode.parse({ parentId: level.id })
    expect(() =>
      checkKitchenClearance(
        { [level.id]: level, [run.id]: run },
        { nodeId: run.id },
        { activeLevelId: null },
      ),
    ).toThrow('plugin definitions')
  } finally {
    restore()
  }
})
