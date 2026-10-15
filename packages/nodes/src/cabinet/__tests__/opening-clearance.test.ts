import { expect, test } from 'bun:test'
import {
  CabinetModuleNode,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  WallNode,
} from '@pascal-app/core'
import { itemDefinition } from '../../item/definition'
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
