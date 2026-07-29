import { describe, expect, test } from 'bun:test'
import { BuildingNode, CeilingNode, LevelNode, SlabNode, WallNode, ZoneNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { resolveCeilingHeight } from '../services/level-height'
import { getCeilingClampBound } from '../services/storey'
import {
  notifySceneCommit,
  type SceneCommitOrigin,
  type SceneSnapshot,
} from '../store/history-control'
import {
  detectSpacesForLevel,
  initSpaceDetectionSync,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  planAutoZonesForLevel,
  resolveAutoZonePolygon,
  wallClosesRoom,
} from './space-detection'

const square: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

function roomPolygon() {
  return square.map(([x, y]) => ({ x, y }))
}

function squareWalls(height = 2.5) {
  return [
    WallNode.parse({ start: [0, 0], end: [4, 0], height }),
    WallNode.parse({ start: [4, 0], end: [4, 3], height }),
    WallNode.parse({ start: [4, 3], end: [0, 3], height }),
    WallNode.parse({ start: [0, 3], end: [0, 0], height }),
  ]
}

function wallsForTest(nodes: AnyNode[]) {
  return nodes.filter((node): node is WallNode => node.type === 'wall')
}

function slab(elevation: number) {
  return SlabNode.parse({
    polygon: square,
    elevation,
    autoFromWalls: true,
  })
}

describe('planAutoCeilingsForLevel', () => {
  test('creates auto ceilings height-less so they follow the level top', () => {
    const created = planAutoCeilingsForLevel([roomPolygon()], [], {
      storeyHeight: 2.7,
    }).create[0]

    expect(created).toBeDefined()
    // Follows-mode: no stored height — the effective height derives from
    // the clamp bound at read time via resolveCeilingHeight.
    expect('height' in created!).toBe(false)
    expect(created?.autoFromWalls).toBe(true)
  })

  test('never writes a height onto a matched auto ceiling', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      autoFromWalls: true,
    })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [ceiling], {
      storeyHeight: 3,
    })

    // Same polygon, follows-mode height — nothing to update.
    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
  })

  test('a leftover explicit height on a matched auto ceiling is not rewritten', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      height: 2.55,
      autoFromWalls: true,
    })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [ceiling], {
      storeyHeight: 3,
    })

    // The sync no longer re-derives auto heights; a user-set explicit
    // height survives (still under the bound, so no clamp either).
    expect(plan.update).toHaveLength(0)
  })

  test('does not replace a manual ceiling with an auto ceiling', () => {
    const manualCeiling = CeilingNode.parse({
      polygon: square,
      height: 2.5,
      autoFromWalls: false,
    })

    // Storey plane above the stored 2.5 so the stage 3-B manual re-clamp
    // stays out of this test's scope (suppression only).
    const plan = planAutoCeilingsForLevel([roomPolygon()], [manualCeiling], {
      storeyHeight: 2.7,
    })

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
  })

  test('demotes an orphaned auto ceiling to manual with its polygon untouched', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      height: 2.55,
      autoFromWalls: true,
    })

    const plan = planAutoCeilingsForLevel([], [ceiling])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.id).toBe(ceiling.id)
    // Ceilings render the stored polygon in both modes, so no polygon bake.
    expect(plan.update[0]?.data).toEqual({ autoFromWalls: false })
  })

  test('deletes an unmatched auto ceiling absorbed by a room merge', () => {
    const leftCeiling = CeilingNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: true,
    })
    const rightCeiling = CeilingNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      autoFromWalls: true,
    })
    const mergedRoom = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 0, y: 3 },
    ]

    const plan = planAutoCeilingsForLevel([mergedRoom], [leftCeiling, rightCeiling])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(1)
    const survivorId = plan.update[0]?.id
    expect([leftCeiling.id, rightCeiling.id]).toContain(plan.delete[0]!)
    expect(plan.delete[0]).not.toBe(survivorId)
  })

  test('preserves conflicting merged ceilings as separate manual surfaces', () => {
    const leftCeiling = CeilingNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      height: 2.4,
      slots: { surface: 'library:red' },
      autoFromWalls: true,
    })
    const rightCeiling = CeilingNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      slots: { surface: 'library:blue' },
      autoFromWalls: true,
    })
    const mergedRoom = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 0, y: 3 },
    ]

    const plan = planAutoCeilingsForLevel([mergedRoom], [leftCeiling, rightCeiling])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toEqual(
      expect.arrayContaining([
        { id: leftCeiling.id, data: { autoFromWalls: false } },
        { id: rightCeiling.id, data: { autoFromWalls: false } },
      ]),
    )
  })

  test('unions openings when compatible ceilings merge', () => {
    const leftHole: Array<[number, number]> = [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
    ]
    const rightHole: Array<[number, number]> = [
      [6, 1],
      [7, 1],
      [7, 2],
      [6, 2],
    ]
    const leftCeiling = CeilingNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [leftHole],
      holeMetadata: [{ source: 'manual' }],
      autoFromWalls: true,
    })
    const rightCeiling = CeilingNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      holes: [rightHole],
      holeMetadata: [{ source: 'stair', stairId: 'stair_right' }],
      autoFromWalls: true,
    })
    const mergedRoom = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 0, y: 3 },
    ]

    const plan = planAutoCeilingsForLevel([mergedRoom], [leftCeiling, rightCeiling])
    const survivor = [leftCeiling, rightCeiling].find(
      (ceiling) => ceiling.id === plan.update[0]?.id,
    )
    const merged = CeilingNode.parse({ ...survivor, ...plan.update[0]?.data })

    expect(plan.delete).toHaveLength(1)
    expect(merged.holes).toEqual(expect.arrayContaining([leftHole, rightHole]))
    expect(merged.holeMetadata).toEqual(
      expect.arrayContaining([{ source: 'manual' }, { source: 'stair', stairId: 'stair_right' }]),
    )
  })

  test('a demoted ceiling suppresses re-creating an auto ceiling when the room re-forms', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      height: 2.55,
      autoFromWalls: true,
    })

    const demotion = planAutoCeilingsForLevel([], [ceiling]).update[0]
    const demoted = CeilingNode.parse({ ...ceiling, ...demotion?.data })
    expect(demoted.autoFromWalls).toBe(false)

    // Storey plane above the stored 2.55 so the stage 3-B manual re-clamp
    // stays out of this test's scope (suppression only).
    const plan = planAutoCeilingsForLevel([roomPolygon()], [demoted], {
      storeyHeight: 2.7,
    })

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
  })

  test('a split ceiling inherits customization and keeps each opening with its room', () => {
    const leftHole: Array<[number, number]> = [
      [0.5, 0.5],
      [1, 0.5],
      [1, 1],
      [0.5, 1],
    ]
    const rightHole: Array<[number, number]> = [
      [3, 0.5],
      [3.5, 0.5],
      [3.5, 1],
      [3, 1],
    ]
    const ceiling = CeilingNode.parse({
      polygon: square,
      height: 2.2,
      materialPreset: 'custom-ceiling',
      slots: { surface: 'library:blue' },
      holes: [leftHole, rightHole],
      holeMetadata: [{ source: 'manual' }, { source: 'stair', stairId: 'stair_right' }],
      autoFromWalls: true,
    })
    const rooms = [
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 3 },
        { x: 0, y: 3 },
      ],
      [
        { x: 2, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
        { x: 2, y: 3 },
      ],
    ]

    const plan = planAutoCeilingsForLevel(rooms, [ceiling], { storeyHeight: 2.5 })
    const updated = CeilingNode.parse({ ...ceiling, ...plan.update[0]?.data })
    const surfaces = [updated, ...plan.create]
    const left = surfaces.find((surface) => surface.polygon.some(([x]) => x === 0))
    const right = surfaces.find((surface) => surface.polygon.some(([x]) => x === 4))

    expect(plan.create).toHaveLength(1)
    expect(plan.update).toHaveLength(1)
    expect(surfaces.every((surface) => surface.height === 2.2)).toBe(true)
    expect(surfaces.every((surface) => surface.materialPreset === 'custom-ceiling')).toBe(true)
    expect(surfaces.every((surface) => surface.slots?.surface === 'library:blue')).toBe(true)
    expect(left?.holes).toEqual([leftHole])
    expect(left?.holeMetadata).toEqual([{ source: 'manual' }])
    expect(right?.holes).toEqual([rightHole])
    expect(right?.holeMetadata).toEqual([{ source: 'stair', stairId: 'stair_right' }])
  })

  test('a stair opening crossing a divider is clipped into both split ceilings', () => {
    const crossingHole: Array<[number, number]> = [
      [1.5, 1],
      [2.5, 1],
      [2.5, 2],
      [1.5, 2],
    ]
    const ceiling = CeilingNode.parse({
      polygon: square,
      holes: [crossingHole],
      holeMetadata: [{ source: 'stair', stairId: 'stair_crossing' }],
      autoFromWalls: true,
    })
    const rooms = [
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 3 },
        { x: 0, y: 3 },
      ],
      [
        { x: 2, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
        { x: 2, y: 3 },
      ],
    ]

    const plan = planAutoCeilingsForLevel(rooms, [ceiling])
    const surfaces = [CeilingNode.parse({ ...ceiling, ...plan.update[0]?.data }), ...plan.create]
    const holes = surfaces.flatMap((surface) => surface.holes)

    expect(holes).toHaveLength(2)
    expect(holes).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          [1.5, 1],
          [2, 1],
          [2, 2],
          [1.5, 2],
        ]),
        expect.arrayContaining([
          [2, 1],
          [2.5, 1],
          [2.5, 2],
          [2, 2],
        ]),
      ]),
    )
    expect(
      surfaces.every(
        (surface) =>
          surface.holeMetadata.length === 1 &&
          surface.holeMetadata[0]?.source === 'stair' &&
          surface.holeMetadata[0]?.stairId === 'stair_crossing',
      ),
    ).toBe(true)
  })
})

// Two stacked levels; the deck slab (occupying [-0.3, 0] over the upper
// level's plane) covers the queried level below, so the clamp bound is
// 2.5 - 0.3 - 0.01 = 2.19 (scenario gate 11's flush deck).
function stackedDeckNodes(): Record<AnyNodeId, AnyNode> {
  const deck = SlabNode.parse({
    id: 'slab_deck',
    parentId: 'level_1',
    polygon: square,
    elevation: 0,
    thickness: 0.3,
  })
  const list: AnyNode[] = [
    BuildingNode.parse({ id: 'building_a', children: ['level_0', 'level_1'] }),
    LevelNode.parse({ id: 'level_0', level: 0, height: 2.5, parentId: 'building_a' }),
    LevelNode.parse({
      id: 'level_1',
      level: 1,
      height: 2.5,
      parentId: 'building_a',
      children: ['slab_deck'],
    }),
    deck,
  ]
  return Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

describe('stage 3-B ceiling clamp bound', () => {
  test('height-less auto ceilings resolve under the covering-slab bound at read time', () => {
    const nodes = stackedDeckNodes()
    const created = planAutoCeilingsForLevel([roomPolygon()], [], {
      storeyHeight: 2.5,
      ceilingClampBound: (polygon) => getCeilingClampBound('level_0', nodes, polygon),
    }).create[0]

    expect(created).toBeDefined()
    expect('height' in created!).toBe(false)
    // Follows-mode: the effective height is the deck-limited bound.
    expect(resolveCeilingHeight({ ...created!, parentId: 'level_0' }, nodes)).toBeCloseTo(2.19)
  })

  test('clamps a manual ceiling above the bound down to it (plane-only degradation)', () => {
    const manual = CeilingNode.parse({ polygon: square, height: 2.6, autoFromWalls: false })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [manual], { storeyHeight: 2.5 })

    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.id).toBe(manual.id)
    expect(plan.update[0]?.data.polygon).toBeUndefined()
    expect(plan.update[0]?.data.height).toBeCloseTo(2.49)
  })

  test('never raises a manual ceiling sitting below the bound', () => {
    const manual = CeilingNode.parse({ polygon: square, height: 2.0, autoFromWalls: false })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [manual], { storeyHeight: 2.5 })

    expect(plan.update).toHaveLength(0)
  })

  test('skips follows-mode manual ceilings (never converts them to explicit)', () => {
    const nodes = stackedDeckNodes()
    const manual = CeilingNode.parse({ polygon: square, autoFromWalls: false })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [manual], {
      storeyHeight: 2.5,
      ceilingClampBound: (polygon) => getCeilingClampBound('level_0', nodes, polygon),
    })

    expect(plan.update).toHaveLength(0)
  })

  test('a flush deck above clamps a manual ceiling at the plane margin to its underside', () => {
    // Scenario gate 11: manual ceiling at storeyHeight - 0.01 (the no-deck
    // bound) → deck occupying [-0.3, 0] above → clamps to 2.5 - 0.3 - 0.01.
    const nodes = stackedDeckNodes()
    const manual = CeilingNode.parse({ polygon: square, height: 2.49, autoFromWalls: false })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [manual], {
      storeyHeight: 2.5,
      ceilingClampBound: (polygon) => getCeilingClampBound('level_0', nodes, polygon),
    })

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.id).toBe(manual.id)
    expect(plan.update[0]?.data.height).toBeCloseTo(2.19)
  })
})

// Minimal store stand-ins for initSpaceDetectionSync: a zustand-shaped
// scene store (getState/subscribe/temporal) whose write methods mutate the
// nodes record and re-notify, and an editor store carrying `spaces`.
function createSceneStoreStub(initialNodes: Record<string, AnyNode>) {
  const listeners = new Set<(state: unknown) => void>()
  const state: Record<string, unknown> & { nodes: Record<string, AnyNode> } = {
    nodes: initialNodes,
  }
  const notify = () => {
    for (const listener of [...listeners]) listener(state)
  }
  state.updateNodes = (updates: Array<{ id: string; data: Record<string, unknown> }>) => {
    const next: Record<string, AnyNode> = { ...state.nodes }
    for (const { id, data } of updates) {
      const existing = next[id]
      if (existing) next[id] = { ...existing, ...data } as AnyNode
    }
    state.nodes = next
    notify()
  }
  state.deleteNodes = (ids: string[]) => {
    const next: Record<string, AnyNode> = { ...state.nodes }
    for (const id of ids) delete next[id]
    state.nodes = next
    notify()
  }
  state.createNodes = (entries: Array<{ node: AnyNode; parentId: string }>) => {
    const next: Record<string, AnyNode> = { ...state.nodes }
    for (const { node, parentId } of entries) {
      next[node.id] = { ...node, parentId } as AnyNode
      const parent = next[parentId] as (AnyNode & { children?: string[] }) | undefined
      if (parent) {
        next[parentId] = { ...parent, children: [...(parent.children ?? []), node.id] } as AnyNode
      }
    }
    state.nodes = next
    notify()
  }
  return {
    getState: () => state,
    subscribe: (listener: (state: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    temporal: { getState: () => ({ pause() {}, resume() {} }) },
    setNodes(
      next: Record<string, AnyNode>,
      origin: SceneCommitOrigin = 'local',
      changedNodeIds?: ReadonlySet<AnyNodeId>,
    ) {
      const before = state.nodes
      state.nodes = next
      notify()
      const snapshot = (nodes: Record<string, AnyNode>): SceneSnapshot => ({
        nodes: nodes as Record<AnyNodeId, AnyNode>,
        rootNodeIds: [],
        collections: {},
        materials: {},
        installedPlugins: [],
      })
      notifySceneCommit({
        origin,
        before: snapshot(before),
        current: snapshot(next),
        changedNodeIds,
      })
    },
  }
}

function createEditorStoreStub() {
  const state = {
    spaces: {} as Record<string, unknown>,
    setSpaces(next: Record<string, unknown>) {
      state.spaces = next
    },
  }
  return { getState: () => state }
}

function roomWithGeneratedSurfaces() {
  const walls = [
    WallNode.parse({ id: 'wall_1', start: [0, 0], end: [4, 0], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_2', start: [4, 0], end: [4, 3], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_3', start: [4, 3], end: [0, 3], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_4', start: [0, 3], end: [0, 0], parentId: 'level_0' }),
  ]
  const generatedSlab = SlabNode.parse({
    id: 'slab_main',
    parentId: 'level_0',
    polygon: square,
    autoFromWalls: true,
  })
  const generatedCeiling = CeilingNode.parse({
    id: 'ceiling_main',
    parentId: 'level_0',
    polygon: square,
    autoFromWalls: true,
  })
  const nodes = [
    BuildingNode.parse({ id: 'building_a', children: ['level_0'] }),
    LevelNode.parse({
      id: 'level_0',
      parentId: 'building_a',
      children: [...walls.map((wall) => wall.id), generatedSlab.id, generatedCeiling.id],
    }),
    ...walls,
    generatedSlab,
    generatedCeiling,
  ]

  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, AnyNode>
}

function twoSeparatedRoomsWithGeneratedSurfaces() {
  const leftWalls = [
    WallNode.parse({ id: 'wall_left_bottom', start: [0, 0], end: [4, 0], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_left_right', start: [4, 0], end: [4, 3], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_left_top', start: [4, 3], end: [0, 3], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_left_left', start: [0, 3], end: [0, 0], parentId: 'level_0' }),
  ]
  const rightWalls = [
    WallNode.parse({ id: 'wall_right_bottom', start: [10, 0], end: [14, 0], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_right_right', start: [14, 0], end: [14, 3], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_right_top', start: [14, 3], end: [10, 3], parentId: 'level_0' }),
    WallNode.parse({ id: 'wall_right_left', start: [10, 3], end: [10, 0], parentId: 'level_0' }),
  ]
  const leftSlab = SlabNode.parse({
    id: 'slab_left',
    parentId: 'level_0',
    polygon: square,
    autoFromWalls: true,
  })
  const rightSlab = SlabNode.parse({
    id: 'slab_right',
    parentId: 'level_0',
    polygon: [
      [10, 0],
      [14, 0],
      [14, 3],
      [10, 3],
    ],
    autoFromWalls: true,
  })
  const leftCeiling = CeilingNode.parse({
    id: 'ceiling_left',
    parentId: 'level_0',
    polygon: leftSlab.polygon,
    autoFromWalls: true,
  })
  const rightCeiling = CeilingNode.parse({
    id: 'ceiling_right',
    parentId: 'level_0',
    polygon: rightSlab.polygon,
    autoFromWalls: true,
  })
  const children = [...leftWalls, ...rightWalls, leftSlab, rightSlab, leftCeiling, rightCeiling]
  const nodes = [
    BuildingNode.parse({ id: 'building_a', children: ['level_0'] }),
    LevelNode.parse({
      id: 'level_0',
      parentId: 'building_a',
      children: children.map((node) => node.id),
    }),
    ...children,
  ]

  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, AnyNode>
}

function splitRoomWithGeneratedSurfaces() {
  const nodes = roomWithGeneratedSurfaces()
  const divider = WallNode.parse({
    id: 'wall_divider',
    start: [2, 0],
    end: [2, 3],
    parentId: 'level_0',
  })
  const leftSlab = SlabNode.parse({
    id: 'slab_left',
    parentId: 'level_0',
    polygon: [
      [0, 0],
      [2, 0],
      [2, 3],
      [0, 3],
    ],
    autoFromWalls: true,
  })
  const rightSlab = SlabNode.parse({
    id: 'slab_right',
    parentId: 'level_0',
    polygon: [
      [2, 0],
      [4, 0],
      [4, 3],
      [2, 3],
    ],
    autoFromWalls: true,
  })
  const leftCeiling = CeilingNode.parse({
    id: 'ceiling_left',
    parentId: 'level_0',
    polygon: leftSlab.polygon,
    autoFromWalls: true,
  })
  const rightCeiling = CeilingNode.parse({
    id: 'ceiling_right',
    parentId: 'level_0',
    polygon: rightSlab.polygon,
    autoFromWalls: true,
  })
  delete nodes.slab_main
  delete nodes.ceiling_main
  nodes[divider.id] = divider
  nodes[leftSlab.id] = leftSlab
  nodes[rightSlab.id] = rightSlab
  nodes[leftCeiling.id] = leftCeiling
  nodes[rightCeiling.id] = rightCeiling
  const level = nodes.level_0
  if (level?.type === 'level') {
    nodes.level_0 = {
      ...level,
      children: [
        ...level.children.filter((id) => id !== 'slab_main' && id !== 'ceiling_main'),
        divider.id,
        leftSlab.id,
        rightSlab.id,
        leftCeiling.id,
        rightCeiling.id,
      ],
    }
  }
  return nodes
}

function fourRoomGridWithSplitA() {
  const walls = [
    WallNode.parse({
      id: 'wall_bottom_left',
      start: [0, 0],
      end: [4, 0],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_bottom_right',
      start: [4, 0],
      end: [8, 0],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_right_bottom',
      start: [8, 0],
      end: [8, 3],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_right_top',
      start: [8, 3],
      end: [8, 6],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_top_right',
      start: [8, 6],
      end: [4, 6],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_top_a2',
      start: [4, 6],
      end: [2, 6],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_top_a1',
      start: [2, 6],
      end: [0, 6],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_left_top',
      start: [0, 6],
      end: [0, 3],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_left_bottom',
      start: [0, 3],
      end: [0, 0],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_horizontal_a1',
      start: [0, 3],
      end: [2, 3],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_horizontal_a2',
      start: [2, 3],
      end: [4, 3],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_horizontal_right',
      start: [4, 3],
      end: [8, 3],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_vertical_bottom',
      start: [4, 0],
      end: [4, 3],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_vertical_top',
      start: [4, 3],
      end: [4, 6],
      parentId: 'level_0',
    }),
    WallNode.parse({
      id: 'wall_a_split',
      start: [2, 3],
      end: [2, 6],
      parentId: 'level_0',
    }),
  ]
  const distantSlab = SlabNode.parse({
    id: 'slab_d',
    parentId: 'level_0',
    polygon: [
      [4, 0],
      [8, 0],
      [8, 3],
      [4, 3],
    ],
    autoFromWalls: true,
  })
  const distantCeiling = CeilingNode.parse({
    id: 'ceiling_d',
    parentId: 'level_0',
    polygon: distantSlab.polygon,
    autoFromWalls: true,
  })
  const level = LevelNode.parse({
    id: 'level_0',
    parentId: 'building_a',
    children: [...walls.map((wall) => wall.id), distantSlab.id, distantCeiling.id],
  })
  return Object.fromEntries(
    [
      BuildingNode.parse({ id: 'building_a', children: [level.id] }),
      level,
      ...walls,
      distantSlab,
      distantCeiling,
    ].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
}

describe('generated surface deletion through the detection sync', () => {
  test('a deleted generated slab stays deleted', () => {
    const sceneStore = createSceneStoreStub(roomWithGeneratedSurfaces())
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const { slab_main: _deleted, ...withoutSlab } = sceneStore.getState().nodes
      sceneStore.setNodes(withoutSlab)

      expect(
        Object.values(sceneStore.getState().nodes).filter((node) => node.type === 'slab'),
      ).toHaveLength(0)
      expect(sceneStore.getState().nodes.level_0?.metadata).not.toHaveProperty(
        'autoSurfaceSuppressions',
      )
    } finally {
      unsubscribe()
    }
  })

  test('a deleted generated ceiling stays deleted after the next wall edit', () => {
    const sceneStore = createSceneStoreStub(roomWithGeneratedSurfaces())
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const { ceiling_main: _deleted, ...withoutCeiling } = sceneStore.getState().nodes
      sceneStore.setNodes(withoutCeiling)
      const levelAfterDelete = sceneStore.getState().nodes.level_0
      expect(levelAfterDelete?.metadata).not.toHaveProperty('autoSurfaceSuppressions')

      const wall = sceneStore.getState().nodes.wall_1 as WallNode
      sceneStore.setNodes({
        ...sceneStore.getState().nodes,
        wall_1: { ...wall, height: 2.6 },
      })

      expect(
        Object.values(sceneStore.getState().nodes).filter((node) => node.type === 'ceiling'),
      ).toHaveLength(0)
    } finally {
      unsubscribe()
    }
  })

  test('a reshaped room keeps its missing surfaces after the sync is reinitialized', () => {
    const sceneStore = createSceneStoreStub(roomWithGeneratedSurfaces())
    let unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    const {
      slab_main: _slab,
      ceiling_main: _ceiling,
      ...withoutSurfaces
    } = sceneStore.getState().nodes
    sceneStore.setNodes(withoutSurfaces)
    unsubscribe()

    unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())
    try {
      const current = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...current,
        wall_1: { ...(current.wall_1 as WallNode), end: [5, 0] },
        wall_2: { ...(current.wall_2 as WallNode), start: [5, 0], end: [5, 3] },
        wall_3: { ...(current.wall_3 as WallNode), start: [5, 3] },
      })

      const surfaces = Object.values(sceneStore.getState().nodes).filter(
        (node) => node.type === 'slab' || node.type === 'ceiling',
      )
      expect(surfaces).toHaveLength(0)
      expect(sceneStore.getState().nodes.level_0?.metadata).not.toHaveProperty(
        'autoSurfaceSuppressions',
      )
    } finally {
      unsubscribe()
    }
  })

  test('slab and ceiling deletion are preserved independently during a reshape', () => {
    const initial = roomWithGeneratedSurfaces()
    delete initial.slab_main
    const sceneStore = createSceneStoreStub(initial)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const current = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...current,
        wall_1: { ...(current.wall_1 as WallNode), end: [5, 0] },
        wall_2: { ...(current.wall_2 as WallNode), start: [5, 0], end: [5, 3] },
        wall_3: { ...(current.wall_3 as WallNode), start: [5, 3] },
      })

      const slabs = Object.values(sceneStore.getState().nodes).filter(
        (node) => node.type === 'slab',
      )
      const ceilings = Object.values(sceneStore.getState().nodes)
        .filter((node) => node.type === 'ceiling')
        .map((node) => CeilingNode.parse(node))
      expect(slabs).toHaveLength(0)
      expect(ceilings).toHaveLength(1)
      expect(ceilings[0]?.polygon).toContainEqual([5, 0])
      expect(ceilings[0]?.polygon).toContainEqual([5, 3])
    } finally {
      unsubscribe()
    }
  })

  test('a distant wall edit does not recreate missing surfaces in an unchanged room', () => {
    const initialNodes = twoSeparatedRoomsWithGeneratedSurfaces()
    const {
      slab_left: _deletedSlab,
      ceiling_left: _deletedCeiling,
      ...withoutLeftSurfaces
    } = initialNodes
    const sceneStore = createSceneStoreStub(withoutLeftSurfaces)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const current = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...current,
        wall_right_bottom: {
          ...(current.wall_right_bottom as WallNode),
          end: [15, 0],
        },
        wall_right_right: {
          ...(current.wall_right_right as WallNode),
          start: [15, 0],
          end: [15, 3],
        },
        wall_right_top: {
          ...(current.wall_right_top as WallNode),
          start: [15, 3],
        },
      })

      const slabs = Object.values(sceneStore.getState().nodes)
        .filter((node) => node.type === 'slab')
        .map((node) => SlabNode.parse(node))
      const ceilings = Object.values(sceneStore.getState().nodes)
        .filter((node) => node.type === 'ceiling')
        .map((node) => CeilingNode.parse(node))
      expect(slabs).toHaveLength(1)
      expect(ceilings).toHaveLength(1)
      expect(slabs[0]?.id).toBe('slab_right')
      expect(ceilings[0]?.id).toBe('ceiling_right')
      expect(slabs[0]?.polygon).toContainEqual([15, 0])
      expect(slabs[0]?.polygon).toContainEqual([15, 3])
      expect(ceilings[0]?.polygon).toContainEqual([15, 0])
      expect(ceilings[0]?.polygon).toContainEqual([15, 3])
    } finally {
      unsubscribe()
    }
  })

  test('loading an older project does not generate its missing surfaces', () => {
    const sceneStore = createSceneStoreStub({})
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())
    const loaded = roomWithGeneratedSurfaces()
    delete loaded.slab_main
    delete loaded.ceiling_main

    try {
      sceneStore.setNodes(loaded, 'load')

      const surfaces = Object.values(sceneStore.getState().nodes).filter(
        (node) => node.type === 'slab' || node.type === 'ceiling',
      )
      expect(surfaces).toHaveLength(0)
      expect(sceneStore.getState().nodes.level_0?.metadata).not.toHaveProperty(
        'autoSurfaceSuppressions',
      )
    } finally {
      unsubscribe()
    }
  })
})

describe('topology-delta room surface reconciliation', () => {
  test('indexes only room A while its divider is deleted, recreated, and moved', () => {
    const sceneStore = createSceneStoreStub(fourRoomGridWithSplitA())
    const editorStore = createEditorStoreStub()
    const events: Array<{
      strategy: string
      examinedWallIds: string[]
      affectedBeforeRoomCount: number
      affectedCurrentRoomCount: number
    }> = []
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore, {
      onTopologyReconcile: (event) => events.push(event),
    })
    const distantSlabBefore = sceneStore.getState().nodes.slab_d
    const distantCeilingBefore = sceneStore.getState().nodes.ceiling_d

    try {
      expect(Object.keys(editorStore.getState().spaces)).toHaveLength(5)

      const current = sceneStore.getState().nodes
      const splitWall = current.wall_a_split as WallNode
      const level = current.level_0 as LevelNode
      const { wall_a_split: _deleted, ...withoutSplit } = current
      sceneStore.setNodes(
        {
          ...withoutSplit,
          level_0: {
            ...level,
            children: level.children.filter((id) => id !== splitWall.id),
          },
        },
        'local',
        new Set([splitWall.id as AnyNodeId]),
      )

      expect(Object.keys(editorStore.getState().spaces)).toHaveLength(4)
      expect(events.at(-1)?.strategy).toBe('indexed')
      expect(events.at(-1)?.examinedWallIds).not.toEqual(
        expect.arrayContaining([
          'wall_bottom_right',
          'wall_right_bottom',
          'wall_horizontal_right',
          'wall_vertical_bottom',
        ]),
      )
      expect(sceneStore.getState().nodes.slab_d).toEqual(distantSlabBefore)
      expect(sceneStore.getState().nodes.ceiling_d).toEqual(distantCeilingBefore)

      const afterDelete = sceneStore.getState().nodes
      const levelAfterDelete = afterDelete.level_0 as LevelNode
      sceneStore.setNodes(
        {
          ...afterDelete,
          [splitWall.id]: splitWall,
          level_0: {
            ...levelAfterDelete,
            children: [...levelAfterDelete.children, splitWall.id],
          },
        },
        'local',
        new Set([splitWall.id as AnyNodeId]),
      )

      expect(Object.keys(editorStore.getState().spaces)).toHaveLength(5)
      expect(events.at(-1)?.examinedWallIds).not.toContain('wall_bottom_right')

      const afterCreate = sceneStore.getState().nodes
      sceneStore.setNodes(
        {
          ...afterCreate,
          [splitWall.id]: {
            ...(afterCreate[splitWall.id] as WallNode),
            start: [2.5, 3],
            end: [2.5, 6],
          },
        },
        'local',
        new Set([splitWall.id as AnyNodeId]),
      )

      expect(Object.keys(editorStore.getState().spaces)).toHaveLength(5)
      expect(events.at(-1)?.examinedWallIds).not.toContain('wall_bottom_right')
      expect(sceneStore.getState().nodes.slab_d).toEqual(distantSlabBefore)
      expect(sceneStore.getState().nodes.ceiling_d).toEqual(distantCeilingBefore)
    } finally {
      unsubscribe()
    }
  })

  test('closing a genuinely new room creates its initial slab and ceiling', () => {
    const initial = roomWithGeneratedSurfaces()
    delete initial.wall_4
    delete initial.slab_main
    delete initial.ceiling_main
    const level = initial.level_0
    if (level?.type === 'level') {
      initial.level_0 = {
        ...level,
        children: level.children.filter(
          (id) => id !== 'wall_4' && id !== 'slab_main' && id !== 'ceiling_main',
        ),
      }
    }
    const sceneStore = createSceneStoreStub(initial)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const current = sceneStore.getState().nodes
      const closingWall = WallNode.parse({
        id: 'wall_4',
        start: [0, 3],
        end: [0, 0],
        parentId: 'level_0',
      })
      const currentLevel = current.level_0
      sceneStore.setNodes({
        ...current,
        wall_4: closingWall,
        ...(currentLevel?.type === 'level'
          ? {
              level_0: {
                ...currentLevel,
                children: [...currentLevel.children, closingWall.id],
              },
            }
          : {}),
      })

      const nodes = Object.values(sceneStore.getState().nodes)
      expect(nodes.filter((node) => node.type === 'slab')).toHaveLength(1)
      expect(nodes.filter((node) => node.type === 'ceiling')).toHaveLength(1)
    } finally {
      unsubscribe()
    }
  })

  test('a new bay against an existing room gets surfaces even when the older room has none', () => {
    const initial = roomWithGeneratedSurfaces()
    delete initial.slab_main
    delete initial.ceiling_main
    const sceneStore = createSceneStoreStub(initial)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const current = sceneStore.getState().nodes
      const bayWalls = [
        WallNode.parse({
          id: 'wall_bay_left',
          start: [1, 0],
          end: [1, -2],
          parentId: 'level_0',
        }),
        WallNode.parse({
          id: 'wall_bay_bottom',
          start: [1, -2],
          end: [3, -2],
          parentId: 'level_0',
        }),
        WallNode.parse({
          id: 'wall_bay_right',
          start: [3, -2],
          end: [3, 0],
          parentId: 'level_0',
        }),
      ]
      sceneStore.setNodes({
        ...current,
        ...Object.fromEntries(bayWalls.map((wall) => [wall.id, wall])),
      })

      const nodes = Object.values(sceneStore.getState().nodes)
      const slabs = nodes.filter((node) => node.type === 'slab').map((node) => SlabNode.parse(node))
      const ceilings = nodes
        .filter((node) => node.type === 'ceiling')
        .map((node) => CeilingNode.parse(node))
      expect(detectSpacesForLevel('level_0', wallsForTest(nodes)).roomPolygons).toHaveLength(2)
      expect(slabs).toHaveLength(1)
      expect(ceilings).toHaveLength(1)
      expect(slabs[0]?.polygon.some(([, z]) => z < 0)).toBe(true)
      expect(ceilings[0]?.polygon.some(([, z]) => z < 0)).toBe(true)
    } finally {
      unsubscribe()
    }
  })

  test('splitting a room without generated surfaces preserves their absence', () => {
    const initial = roomWithGeneratedSurfaces()
    delete initial.slab_main
    delete initial.ceiling_main
    const sceneStore = createSceneStoreStub(initial)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const current = sceneStore.getState().nodes
      const divider = WallNode.parse({
        id: 'wall_divider',
        start: [2, 0],
        end: [2, 3],
        parentId: 'level_0',
      })
      const currentLevel = current.level_0
      sceneStore.setNodes({
        ...current,
        wall_divider: divider,
        ...(currentLevel?.type === 'level'
          ? {
              level_0: {
                ...currentLevel,
                children: [...currentLevel.children, divider.id],
              },
            }
          : {}),
      })

      const nodes = Object.values(sceneStore.getState().nodes)
      expect(detectSpacesForLevel('level_0', wallsForTest(nodes)).roomPolygons).toHaveLength(2)
      expect(nodes.filter((node) => node.type === 'slab')).toHaveLength(0)
      expect(nodes.filter((node) => node.type === 'ceiling')).toHaveLength(0)
    } finally {
      unsubscribe()
    }
  })

  test('deleting a divider merges compatible generated surfaces', () => {
    const initial = splitRoomWithGeneratedSurfaces()
    const sceneStore = createSceneStoreStub(initial)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const { wall_divider: _deleted, ...withoutDivider } = sceneStore.getState().nodes
      sceneStore.setNodes(withoutDivider)

      const nodes = Object.values(sceneStore.getState().nodes)
      const slabs = nodes.filter((node) => node.type === 'slab').map((node) => SlabNode.parse(node))
      const ceilings = nodes
        .filter((node) => node.type === 'ceiling')
        .map((node) => CeilingNode.parse(node))
      expect(slabs).toHaveLength(1)
      expect(ceilings).toHaveLength(1)
      expect(slabs[0]?.polygon).toEqual(expect.arrayContaining(square))
      expect(ceilings[0]?.polygon).toEqual(expect.arrayContaining(square))
    } finally {
      unsubscribe()
    }
  })

  test('merging rooms does not fill an area whose slab was already missing', () => {
    const initial = splitRoomWithGeneratedSurfaces()
    delete initial.slab_left
    const sceneStore = createSceneStoreStub(initial)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const { wall_divider: _deleted, ...withoutDivider } = sceneStore.getState().nodes
      sceneStore.setNodes(withoutDivider)

      const slabs = Object.values(sceneStore.getState().nodes)
        .filter((node) => node.type === 'slab')
        .map((node) => SlabNode.parse(node))
      expect(slabs).toHaveLength(1)
      expect(slabs[0]?.autoFromWalls).toBe(false)
      expect(slabs[0]?.polygon).toEqual([
        [2, 0],
        [4, 0],
        [4, 3],
        [2, 3],
      ])
    } finally {
      unsubscribe()
    }
  })

  test('editing one room does not shrink a legacy surface shared with an unaffected room', () => {
    const initial = twoSeparatedRoomsWithGeneratedSurfaces()
    delete initial.slab_left
    delete initial.slab_right
    delete initial.ceiling_left
    delete initial.ceiling_right
    const sharedPolygon: Array<[number, number]> = [
      [0, 0],
      [14, 0],
      [14, 3],
      [0, 3],
    ]
    const sharedSlab = SlabNode.parse({
      id: 'slab_shared',
      parentId: 'level_0',
      polygon: sharedPolygon,
      autoFromWalls: true,
    })
    const sharedCeiling = CeilingNode.parse({
      id: 'ceiling_shared',
      parentId: 'level_0',
      polygon: sharedPolygon,
      autoFromWalls: true,
    })
    initial[sharedSlab.id] = sharedSlab
    initial[sharedCeiling.id] = sharedCeiling
    const level = initial.level_0
    if (level?.type === 'level') {
      initial.level_0 = {
        ...level,
        children: [
          ...level.children.filter(
            (id) =>
              id !== 'slab_left' &&
              id !== 'slab_right' &&
              id !== 'ceiling_left' &&
              id !== 'ceiling_right',
          ),
          sharedSlab.id,
          sharedCeiling.id,
        ],
      }
    }
    const sceneStore = createSceneStoreStub(initial)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const current = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...current,
        wall_right_bottom: {
          ...(current.wall_right_bottom as WallNode),
          end: [15, 0],
        },
        wall_right_right: {
          ...(current.wall_right_right as WallNode),
          start: [15, 0],
          end: [15, 3],
        },
        wall_right_top: {
          ...(current.wall_right_top as WallNode),
          start: [15, 3],
        },
      })

      expect((sceneStore.getState().nodes.slab_shared as SlabNode).polygon).toEqual(sharedPolygon)
      expect((sceneStore.getState().nodes.ceiling_shared as CeilingNode).polygon).toEqual(
        sharedPolygon,
      )
    } finally {
      unsubscribe()
    }
  })

  test('moving a divider keeps the existing side automatic without filling the missing side', () => {
    const initial = splitRoomWithGeneratedSurfaces()
    delete initial.slab_left
    delete initial.ceiling_left
    const sceneStore = createSceneStoreStub(initial)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const current = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...current,
        wall_divider: {
          ...(current.wall_divider as WallNode),
          start: [2.5, 0],
          end: [2.5, 3],
        },
      })

      const slabs = Object.values(sceneStore.getState().nodes)
        .filter((node) => node.type === 'slab')
        .map((node) => SlabNode.parse(node))
      const ceilings = Object.values(sceneStore.getState().nodes)
        .filter((node) => node.type === 'ceiling')
        .map((node) => CeilingNode.parse(node))
      expect(slabs).toHaveLength(1)
      expect(ceilings).toHaveLength(1)
      expect(slabs[0]?.autoFromWalls).toBe(true)
      expect(ceilings[0]?.autoFromWalls).toBe(true)
      expect(slabs[0]?.polygon).toContainEqual([2.5, 0])
      expect(slabs[0]?.polygon).toContainEqual([2.5, 3])
      expect(ceilings[0]?.polygon).toContainEqual([2.5, 0])
      expect(ceilings[0]?.polygon).toContainEqual([2.5, 3])
    } finally {
      unsubscribe()
    }
  })

  test('separately closed rooms receive unique generated surface names', () => {
    const initial = twoSeparatedRoomsWithGeneratedSurfaces()
    const closingWall = initial.wall_right_left as WallNode
    delete initial.wall_right_left
    delete initial.slab_right
    delete initial.ceiling_right
    initial.slab_left = SlabNode.parse({ ...initial.slab_left, name: 'Room 1 Slab' })
    initial.ceiling_left = CeilingNode.parse({
      ...initial.ceiling_left,
      name: 'Room 1 Ceiling',
    })
    const level = initial.level_0
    if (level?.type === 'level') {
      initial.level_0 = {
        ...level,
        children: level.children.filter(
          (id) => id !== closingWall.id && id !== 'slab_right' && id !== 'ceiling_right',
        ),
      }
    }
    const sceneStore = createSceneStoreStub(initial)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const current = sceneStore.getState().nodes
      const currentLevel = current.level_0
      sceneStore.setNodes({
        ...current,
        [closingWall.id]: closingWall,
        ...(currentLevel?.type === 'level'
          ? {
              level_0: {
                ...currentLevel,
                children: [...currentLevel.children, closingWall.id],
              },
            }
          : {}),
      })

      const slabNames = Object.values(sceneStore.getState().nodes)
        .filter((node) => node.type === 'slab')
        .map((node) => node.name)
      const ceilingNames = Object.values(sceneStore.getState().nodes)
        .filter((node) => node.type === 'ceiling')
        .map((node) => node.name)
      expect(new Set(slabNames).size).toBe(2)
      expect(new Set(ceilingNames).size).toBe(2)
      expect(slabNames).toContain('Room 2 Slab')
      expect(ceilingNames).toContain('Room 2 Ceiling')
    } finally {
      unsubscribe()
    }
  })

  test('deleting an exterior wall leaves generated slabs and ceilings unchanged', () => {
    const sceneStore = createSceneStoreStub(roomWithGeneratedSurfaces())
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())
    const slabBefore = sceneStore.getState().nodes.slab_main
    const ceilingBefore = sceneStore.getState().nodes.ceiling_main

    try {
      const { wall_1: _deleted, ...withoutBoundaryWall } = sceneStore.getState().nodes
      sceneStore.setNodes(withoutBoundaryWall)

      const nodes = Object.values(sceneStore.getState().nodes)
      expect(detectSpacesForLevel('level_0', wallsForTest(nodes)).roomPolygons).toHaveLength(0)
      expect(sceneStore.getState().nodes.slab_main).toEqual(slabBefore)
      expect(sceneStore.getState().nodes.ceiling_main).toEqual(ceilingBefore)
    } finally {
      unsubscribe()
    }
  })
})

describe('reactive ceiling re-clamp through the detection sync', () => {
  test('a flush deck created on the level above clamps the existing manual ceiling below', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0], parentId: 'level_0' }),
      WallNode.parse({ start: [4, 0], end: [4, 3], parentId: 'level_0' }),
      WallNode.parse({ start: [4, 3], end: [0, 3], parentId: 'level_0' }),
      WallNode.parse({ start: [0, 3], end: [0, 0], parentId: 'level_0' }),
    ]
    const manualCeiling = CeilingNode.parse({
      id: 'ceiling_main',
      parentId: 'level_0',
      polygon: square,
      height: 2.49,
      autoFromWalls: false,
    })
    const initialNodes = Object.fromEntries(
      [
        BuildingNode.parse({ id: 'building_a', children: ['level_0', 'level_1'] }),
        LevelNode.parse({
          id: 'level_0',
          level: 0,
          height: 2.5,
          parentId: 'building_a',
          children: [...walls.map((wall) => wall.id), 'ceiling_main'],
        }),
        LevelNode.parse({ id: 'level_1', level: 1, height: 2.5, parentId: 'building_a' }),
        ...walls,
        manualCeiling,
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

    try {
      // Scenario gate 11's reactive half: the deck lands on the level
      // ABOVE, so only the covering-underside part of level_0's structure
      // snapshot changes — the sync must still re-run and clamp down.
      const deck = SlabNode.parse({
        id: 'slab_deck',
        parentId: 'level_1',
        polygon: square,
        elevation: 0,
        thickness: 0.3,
      })
      const current = sceneStore.getState().nodes
      const levelAbove = current.level_1 as AnyNode
      sceneStore.setNodes({
        ...current,
        slab_deck: deck,
        level_1: { ...levelAbove, children: ['slab_deck'] } as AnyNode,
      })

      const ceiling = sceneStore.getState().nodes.ceiling_main as CeilingNode
      expect(ceiling.height).toBeCloseTo(2.5 - 0.3 - 0.01)
    } finally {
      unsubscribe()
    }
  })

  test('an auto slab expanded by an upper-room reshape clamps a newly covered ceiling', () => {
    const upperWalls = [
      WallNode.parse({ id: 'wall_upper_1', start: [0, 0], end: [1, 0], parentId: 'level_1' }),
      WallNode.parse({ id: 'wall_upper_2', start: [1, 0], end: [1, 3], parentId: 'level_1' }),
      WallNode.parse({ id: 'wall_upper_3', start: [1, 3], end: [0, 3], parentId: 'level_1' }),
      WallNode.parse({ id: 'wall_upper_4', start: [0, 3], end: [0, 0], parentId: 'level_1' }),
    ]
    const upperSlab = SlabNode.parse({
      id: 'slab_upper',
      parentId: 'level_1',
      polygon: [
        [0, 0],
        [1, 0],
        [1, 3],
        [0, 3],
      ],
      elevation: 0,
      thickness: 0.3,
      autoFromWalls: true,
    })
    const lowerCeilingPolygon: Array<[number, number]> = [
      [2, 0],
      [4, 0],
      [4, 3],
      [2, 3],
    ]
    const manualCeiling = CeilingNode.parse({
      id: 'ceiling_main',
      parentId: 'level_0',
      polygon: lowerCeilingPolygon,
      height: 2.49,
      autoFromWalls: false,
    })
    const initialNodes = Object.fromEntries(
      [
        BuildingNode.parse({ id: 'building_a', children: ['level_0', 'level_1'] }),
        LevelNode.parse({
          id: 'level_0',
          level: 0,
          height: 2.5,
          parentId: 'building_a',
          children: [manualCeiling.id],
        }),
        LevelNode.parse({
          id: 'level_1',
          level: 1,
          height: 2.5,
          parentId: 'building_a',
          children: [...upperWalls.map((wall) => wall.id), upperSlab.id],
        }),
        ...upperWalls,
        upperSlab,
        manualCeiling,
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const current = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...current,
        wall_upper_1: { ...(current.wall_upper_1 as WallNode), end: [4, 0] },
        wall_upper_2: {
          ...(current.wall_upper_2 as WallNode),
          start: [4, 0],
          end: [4, 3],
        },
        wall_upper_3: { ...(current.wall_upper_3 as WallNode), start: [4, 3] },
      })

      const expandedUpperSlab = sceneStore.getState().nodes.slab_upper as SlabNode
      const ceiling = sceneStore.getState().nodes.ceiling_main as CeilingNode
      expect(expandedUpperSlab.polygon).toContainEqual([4, 0])
      expect(expandedUpperSlab.polygon).toContainEqual([4, 3])
      expect(ceiling.height).toBeCloseTo(2.5 - 0.3 - 0.01)
    } finally {
      unsubscribe()
    }
  })
})

describe('procedural zone sync isolation', () => {
  test('creating a matching zone adopts room walls without reconciling surfaces', () => {
    const initial = roomWithGeneratedSurfaces()
    delete initial.slab_main
    delete initial.ceiling_main
    const sceneStore = createSceneStoreStub(initial)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const current = sceneStore.getState().nodes
      const zone = ZoneNode.parse({
        id: 'zone_room',
        parentId: 'level_0',
        name: 'Kitchen',
        polygon: square,
      })
      sceneStore.setNodes({ ...current, [zone.id]: zone })

      const updated = sceneStore.getState().nodes[zone.id]
      expect(updated?.type).toBe('zone')
      if (updated?.type !== 'zone') return
      expect(updated.autoFromWalls).toBe(true)
      expect(new Set(updated.boundaryWallIds)).toEqual(
        new Set(['wall_1', 'wall_2', 'wall_3', 'wall_4']),
      )
      expect(
        Object.values(sceneStore.getState().nodes).filter(
          (node) => node.type === 'slab' || node.type === 'ceiling',
        ),
      ).toHaveLength(0)
    } finally {
      unsubscribe()
    }
  })
})

describe('detectSpacesForLevel', () => {
  const areaOf = (polygon: Array<{ x: number; y: number }>) => {
    let area = 0
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i]!
      const b = polygon[(i + 1) % polygon.length]!
      area += a.x * b.y - b.x * a.y
    }
    return Math.abs(area / 2)
  }

  test('detects an isolated four-wall room', () => {
    const walls = squareWalls()
    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', walls)
    expect(roomPolygons).toHaveLength(1)
    expect(new Set(spaces[0]?.wallIds)).toEqual(new Set(walls.map((wall) => wall.id)))
    expect(spaces[0]?.boundaryFaces).toHaveLength(4)
    expect(
      spaces[0]?.boundaryFaces.map((boundary) => `${boundary.wallId}:${boundary.face}`).sort(),
    ).toEqual(walls.map((wall) => `${wall.id}:front`).sort())
  })

  test('detects a valid room below 0.5 square metres and plans its surfaces', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [0.6, 0] }),
      WallNode.parse({ start: [0.6, 0], end: [0.6, 0.6] }),
      WallNode.parse({ start: [0.6, 0.6], end: [0, 0.6] }),
      WallNode.parse({ start: [0, 0.6], end: [0, 0] }),
    ]

    const { roomPolygons } = detectSpacesForLevel('level-small', walls)

    expect(roomPolygons).toHaveLength(1)
    expect(areaOf(roomPolygons[0]!)).toBeCloseTo(0.36)
    expect(planAutoSlabsForLevel(roomPolygons, []).create).toHaveLength(1)
    expect(planAutoCeilingsForLevel(roomPolygons, []).create).toHaveLength(1)
  })

  test('detects a valid room above 10,000 square metres and plans its surfaces', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [101, 0] }),
      WallNode.parse({ start: [101, 0], end: [101, 101] }),
      WallNode.parse({ start: [101, 101], end: [0, 101] }),
      WallNode.parse({ start: [0, 101], end: [0, 0] }),
    ]

    const { roomPolygons } = detectSpacesForLevel('level-large', walls)

    expect(roomPolygons).toHaveLength(1)
    expect(areaOf(roomPolygons[0]!)).toBeCloseTo(10_201)
    expect(planAutoSlabsForLevel(roomPolygons, []).create).toHaveLength(1)
    expect(planAutoCeilingsForLevel(roomPolygons, []).create).toHaveLength(1)
  })

  test('excludes dangling wall branches from a room boundary', () => {
    const roomWalls = squareWalls()
    const branch = WallNode.parse({ start: [0, 0], end: [1, 1] })

    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', [...roomWalls, branch])

    expect(roomPolygons).toHaveLength(1)
    expect(roomPolygons[0]).toHaveLength(4)
    expect(areaOf(roomPolygons[0]!)).toBeCloseTo(12)
    expect(spaces[0]?.wallIds.sort()).toEqual(roomWalls.map((wall) => wall.id).sort())
    expect(spaces[0]?.boundaryFaces).toHaveLength(4)
  })

  test('detects a room closed against the middle of an existing wall (T-junction)', () => {
    // Big 6×5 room; a smaller room hangs below, its two verticals landing on the
    // interior of the big room's bottom wall (x=1 and x=3, not endpoints). Before
    // planarization those touch points were dangling nodes and the small room
    // was never detected.
    const walls = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 0], end: [6, 5] }),
      WallNode.parse({ start: [6, 5], end: [0, 5] }),
      WallNode.parse({ start: [0, 5], end: [0, 0] }),
      WallNode.parse({ start: [1, 0], end: [1, -2] }),
      WallNode.parse({ start: [1, -2], end: [3, -2] }),
      WallNode.parse({ start: [3, -2], end: [3, 0] }),
    ]

    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', walls)
    const areas = roomPolygons.map((poly) => areaOf(poly)).sort((a, b) => a - b)
    const smallRoom = spaces.find((space) => areaOf(space.polygon.map(([x, y]) => ({ x, y }))) < 5)

    expect(roomPolygons).toHaveLength(2)
    expect(areas[0]).toBeCloseTo(4, 1) // small room: 2×2
    expect(areas[1]).toBeCloseTo(30, 1) // big room: 6×5
    expect(new Set(smallRoom?.wallIds)).toEqual(
      new Set([walls[0]!.id, walls[4]!.id, walls[5]!.id, walls[6]!.id]),
    )

    const longWallId = walls[0]!.id
    const longWallBoundaries = spaces.flatMap((space) =>
      space.boundaryFaces.filter((boundary) => boundary.wallId === longWallId),
    )
    expect(longWallBoundaries).toHaveLength(4)
    expect(longWallBoundaries.filter((boundary) => boundary.face === 'back')).toHaveLength(1)
    expect(longWallBoundaries.filter((boundary) => boundary.face === 'front')).toHaveLength(3)
    expect(longWallBoundaries.map((boundary) => boundary.points)).toContainEqual([
      [1, 0],
      [3, 0],
    ])
  })
})

describe('procedural zones', () => {
  test('adopts an exact room footprint and records its enclosing walls', () => {
    const walls = squareWalls()
    const { spaces } = detectSpacesForLevel('level-1', walls)
    const zone = ZoneNode.parse({ name: 'Kitchen', polygon: square })

    const plan = planAutoZonesForLevel(spaces, [zone])

    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.data.autoFromWalls).toBe(true)
    expect(new Set(plan.update[0]?.data.boundaryWallIds)).toEqual(
      new Set(walls.map((wall) => wall.id)),
    )
  })

  test('derives the live polygon from effective wall endpoints', () => {
    const walls = squareWalls()
    const zone = ZoneNode.parse({
      name: 'Kitchen',
      polygon: square,
      autoFromWalls: true,
      boundaryWallIds: walls.map((wall) => wall.id),
    })
    const movedWalls = [
      { ...walls[0]!, end: [5, 0] as [number, number] },
      { ...walls[1]!, start: [5, 0] as [number, number], end: [5, 3] as [number, number] },
      { ...walls[2]!, start: [5, 3] as [number, number] },
      walls[3]!,
    ]
    const byId = new Map(movedWalls.map((wall) => [wall.id, wall]))

    const polygon = resolveAutoZonePolygon(zone, (id) =>
      byId.get(id as (typeof walls)[number]['id']),
    )
    const plan = planAutoZonesForLevel(detectSpacesForLevel('level-1', movedWalls).spaces, [zone])

    expect(polygon).toContainEqual([5, 0])
    expect(polygon).toContainEqual([5, 3])
    expect(polygon).not.toContainEqual([4, 0])
    expect(plan.update[0]?.data.polygon).toContainEqual([5, 0])
  })

  test('leaves an unrelated site zone manual', () => {
    const { spaces } = detectSpacesForLevel('level-1', squareWalls())
    const zone = ZoneNode.parse({
      name: 'Lawn',
      polygon: [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
      ],
    })

    expect(planAutoZonesForLevel(spaces, [zone]).update).toHaveLength(0)
  })
})

describe('wallClosesRoom', () => {
  test('is false while a chain is still open, true once it encloses a room', () => {
    const open = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
    ]
    const closing = WallNode.parse({ start: [0, 3], end: [0, 0] })

    expect(wallClosesRoom(open, closing)).toBe(false)
    expect(wallClosesRoom([...open, closing], closing)).toBe(true)
  })

  test('fires when a bay is sealed against the middle of an existing wall', () => {
    const bigRoom = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 0], end: [6, 5] }),
      WallNode.parse({ start: [6, 5], end: [0, 5] }),
      WallNode.parse({ start: [0, 5], end: [0, 0] }),
    ]
    const bayLeft = WallNode.parse({ start: [1, 0], end: [1, -2] })
    const bayBottom = WallNode.parse({ start: [1, -2], end: [3, -2] })
    const bayRight = WallNode.parse({ start: [3, -2], end: [3, 0] })

    // Two sides down and across: not enclosed yet.
    expect(wallClosesRoom([...bigRoom, bayLeft, bayBottom], bayBottom)).toBe(false)
    // The final side lands on the interior of the big room's bottom wall.
    expect(wallClosesRoom([...bigRoom, bayLeft, bayBottom, bayRight], bayRight)).toBe(true)
  })
})

describe('planAutoSlabsForLevel', () => {
  test('matches two identical rooms to their own existing auto-slabs without churn', () => {
    // Two rooms with identical polygon signatures previously collided in a
    // signature-keyed Map, so one detected room never matched an existing slab
    // and churned (delete + recreate) on every pass.
    const slabA = slab(0.05)
    const slabB = slab(0.05)

    const plan = planAutoSlabsForLevel([roomPolygon(), roomPolygon()], [slabA, slabB])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
  })

  test('deletes an extra auto-slab when only one identical room is detected', () => {
    const plan = planAutoSlabsForLevel([roomPolygon()], [slab(0.05), slab(0.05)])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(1)
  })

  test('demotes an orphaned auto slab to manual when its room disappears', () => {
    const painted = SlabNode.parse({
      polygon: square,
      elevation: 0.4,
      autoFromWalls: true,
    })

    const plan = planAutoSlabsForLevel([], [painted])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toHaveLength(1)

    const update = plan.update[0]
    expect(update?.id).toBe(painted.id)
    // Demotion flips only the flag — the stored polygon stays untouched
    // (render offsets derive from level context at geometry build time).
    expect(update?.data).toEqual({ autoFromWalls: false })
  })

  test('deletes an unmatched auto slab whose area was absorbed by a room merge', () => {
    const leftSlab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: true,
    })
    const rightSlab = SlabNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      autoFromWalls: true,
    })
    const mergedRoom = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 0, y: 3 },
    ]

    const plan = planAutoSlabsForLevel([mergedRoom], [leftSlab, rightSlab])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(1)
    expect(plan.update).toHaveLength(1)
    const survivorId = plan.update[0]?.id
    expect([leftSlab.id, rightSlab.id]).toContain(plan.delete[0]!)
    expect(plan.delete[0]).not.toBe(survivorId)
    // The survivor stays auto — updated to the merged polygon, not demoted.
    expect(plan.update[0]?.data.autoFromWalls).toBeUndefined()
  })

  test('preserves conflicting merged slabs as separate manual surfaces', () => {
    const leftSlab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      elevation: 0.15,
      thickness: 0.15,
      slots: { surface: 'library:red' },
      autoFromWalls: true,
    })
    const rightSlab = SlabNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      elevation: -0.15,
      thickness: 0.1,
      slots: { surface: 'library:blue' },
      autoFromWalls: true,
    })
    const mergedRoom = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 0, y: 3 },
    ]

    const plan = planAutoSlabsForLevel([mergedRoom], [leftSlab, rightSlab])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toEqual(
      expect.arrayContaining([
        { id: leftSlab.id, data: { autoFromWalls: false } },
        { id: rightSlab.id, data: { autoFromWalls: false } },
      ]),
    )
  })

  test('unions openings when compatible slabs merge', () => {
    const leftHole: Array<[number, number]> = [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
    ]
    const rightHole: Array<[number, number]> = [
      [6, 1],
      [7, 1],
      [7, 2],
      [6, 2],
    ]
    const leftSlab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [leftHole],
      holeMetadata: [{ source: 'manual' }],
      autoFromWalls: true,
    })
    const rightSlab = SlabNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      holes: [rightHole],
      holeMetadata: [{ source: 'elevator', elevatorId: 'elevator_right' }],
      autoFromWalls: true,
    })
    const mergedRoom = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 0, y: 3 },
    ]

    const plan = planAutoSlabsForLevel([mergedRoom], [leftSlab, rightSlab])
    const survivor = [leftSlab, rightSlab].find((slab) => slab.id === plan.update[0]?.id)
    const merged = SlabNode.parse({ ...survivor, ...plan.update[0]?.data })

    expect(plan.delete).toHaveLength(1)
    expect(merged.holes).toEqual(expect.arrayContaining([leftHole, rightHole]))
    expect(merged.holeMetadata).toEqual(
      expect.arrayContaining([
        { source: 'manual' },
        { source: 'elevator', elevatorId: 'elevator_right' },
      ]),
    )
  })

  test('a demoted slab suppresses re-creating an auto slab when the room re-forms', () => {
    const auto = slab(0.05)

    const demotion = planAutoSlabsForLevel([], [auto]).update[0]
    const demoted = SlabNode.parse({ ...auto, ...demotion?.data })
    expect(demoted.autoFromWalls).toBe(false)

    const plan = planAutoSlabsForLevel([roomPolygon()], [demoted])

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
  })

  test('manual slabs that split one room suppress a replacement full-room slab', () => {
    const left = SlabNode.parse({
      polygon: [
        [0, 0],
        [2, 0],
        [2, 3],
        [0, 3],
      ],
      autoFromWalls: false,
    })
    const right = SlabNode.parse({
      polygon: [
        [2, 0],
        [4, 0],
        [4, 3],
        [2, 3],
      ],
      autoFromWalls: false,
    })

    const plan = planAutoSlabsForLevel([roomPolygon()], [left, right])

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
  })

  test('a split slab inherits customization and keeps each opening with its room', () => {
    const leftHole: Array<[number, number]> = [
      [0.5, 0.5],
      [1, 0.5],
      [1, 1],
      [0.5, 1],
    ]
    const rightHole: Array<[number, number]> = [
      [3, 0.5],
      [3.5, 0.5],
      [3.5, 1],
      [3, 1],
    ]
    const customized = SlabNode.parse({
      polygon: square,
      elevation: 0.2,
      thickness: 0.1,
      materialPreset: 'custom-floor',
      slots: { surface: 'library:oak' },
      holes: [leftHole, rightHole],
      holeMetadata: [{ source: 'manual' }, { source: 'stair', stairId: 'stair_right' }],
      autoFromWalls: true,
    })
    const rooms = [
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 3 },
        { x: 0, y: 3 },
      ],
      [
        { x: 2, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
        { x: 2, y: 3 },
      ],
    ]

    const plan = planAutoSlabsForLevel(rooms, [customized])
    const updated = SlabNode.parse({ ...customized, ...plan.update[0]?.data })
    const surfaces = [updated, ...plan.create]
    const left = surfaces.find((surface) => surface.polygon.some(([x]) => x === 0))
    const right = surfaces.find((surface) => surface.polygon.some(([x]) => x === 4))

    expect(plan.create).toHaveLength(1)
    expect(plan.update).toHaveLength(1)
    expect(surfaces.every((surface) => surface.elevation === 0.2)).toBe(true)
    expect(surfaces.every((surface) => surface.thickness === 0.1)).toBe(true)
    expect(surfaces.every((surface) => surface.materialPreset === 'custom-floor')).toBe(true)
    expect(surfaces.every((surface) => surface.slots?.surface === 'library:oak')).toBe(true)
    expect(left?.holes).toEqual([leftHole])
    expect(left?.holeMetadata).toEqual([{ source: 'manual' }])
    expect(right?.holes).toEqual([rightHole])
    expect(right?.holeMetadata).toEqual([{ source: 'stair', stairId: 'stair_right' }])
  })

  test('an elevator opening crossing a divider is clipped into both split slabs', () => {
    const crossingHole: Array<[number, number]> = [
      [1.5, 1],
      [2.5, 1],
      [2.5, 2],
      [1.5, 2],
    ]
    const auto = SlabNode.parse({
      polygon: square,
      holes: [crossingHole],
      holeMetadata: [{ source: 'elevator', elevatorId: 'elevator_crossing' }],
      autoFromWalls: true,
    })
    const rooms = [
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 3 },
        { x: 0, y: 3 },
      ],
      [
        { x: 2, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
        { x: 2, y: 3 },
      ],
    ]

    const plan = planAutoSlabsForLevel(rooms, [auto])
    const surfaces = [SlabNode.parse({ ...auto, ...plan.update[0]?.data }), ...plan.create]
    const holes = surfaces.flatMap((surface) => surface.holes)

    expect(holes).toHaveLength(2)
    expect(holes).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          [1.5, 1],
          [2, 1],
          [2, 2],
          [1.5, 2],
        ]),
        expect.arrayContaining([
          [2, 1],
          [2.5, 1],
          [2.5, 2],
          [2, 2],
        ]),
      ]),
    )
    expect(
      surfaces.every(
        (surface) =>
          surface.holeMetadata.length === 1 &&
          surface.holeMetadata[0]?.source === 'elevator' &&
          surface.holeMetadata[0]?.elevatorId === 'elevator_crossing',
      ),
    ).toBe(true)
  })
})
