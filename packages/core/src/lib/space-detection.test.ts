import { describe, expect, test } from 'bun:test'
import { BuildingNode, CeilingNode, LevelNode, SlabNode, WallNode, ZoneNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { resolveCeilingHeight } from '../services/level-height'
import { getCeilingClampBound } from '../services/storey'
import { runWithSceneCommitNodeIds } from '../store/history-control'
import {
  detectSpacesForLevel,
  initSpaceDetectionSync,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  planAutoZonesForLevel,
  resolveAutoZonePolygon,
  type SpaceTopologyReconcileEvent,
  wallClosesRoom,
} from './space-detection'
import { encodeTerrainField } from './terrain-codec'
import { applyHeightPatch, createTerrainField, flattenPatch } from './terrain-field'

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

  test('creates and reconciles an auto ceiling at the enclosing wall top', () => {
    const context = {
      heightForRoom: () => 3.09,
    }
    const created = planAutoCeilingsForLevel([roomPolygon()], [], context).create[0]

    expect(created?.height).toBeCloseTo(3.09)

    const existing = CeilingNode.parse({
      polygon: square,
      height: 2.49,
      autoFromWalls: true,
    })
    const update = planAutoCeilingsForLevel([roomPolygon()], [existing], context).update[0]

    expect(update?.id).toBe(existing.id)
    expect(update?.data.height).toBeCloseTo(3.09)
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

  test('preserves incompatible merged ceilings as separate manual surfaces', () => {
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

  test('keeps and reparents hosted children when compatible ceilings merge', () => {
    const leftCeiling = CeilingNode.parse({
      id: 'ceiling_host_left',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      children: ['item_left'],
      autoFromWalls: true,
    })
    const rightCeiling = CeilingNode.parse({
      id: 'ceiling_host_right',
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      children: ['item_right'],
      autoFromWalls: true,
    })
    const mergedRoom = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 0, y: 3 },
    ]

    const plan = planAutoCeilingsForLevel([mergedRoom], [leftCeiling, rightCeiling])
    const deletedId = plan.delete[0]
    const survivor = [leftCeiling, rightCeiling].find((ceiling) => ceiling.id !== deletedId)
    const survivorUpdate = plan.update.find((update) => update.id === survivor?.id)
    const deletedChild = deletedId === leftCeiling.id ? 'item_left' : 'item_right'

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(1)
    expect(survivorUpdate?.data.children).toEqual(
      expect.arrayContaining(['item_left', 'item_right']),
    )
    expect(plan.reparent).toEqual([{ id: deletedChild, parentId: survivor?.id }])
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

  test('a split ceiling inherits customization and assigns each opening to its room', () => {
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

  test('a split ceiling reparents hosted items to the ceiling that contains them', () => {
    const ceiling = CeilingNode.parse({
      id: 'ceiling_with_items',
      polygon: square,
      children: ['item_left', 'item_right', 'item_on_divider'],
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
    const positions: Record<string, [number, number]> = {
      item_left: [1, 1],
      item_right: [3, 1],
      item_on_divider: [2, 1],
    }

    const plan = planAutoCeilingsForLevel(rooms, [ceiling], {
      childPosition: (id) => positions[id],
    })
    const sourceUpdate = plan.update.find((update) => update.id === ceiling.id)
    const created = plan.create[0]

    expect(sourceUpdate?.data.children).toEqual(['item_left', 'item_on_divider'])
    expect(created?.children).toEqual(['item_right'])
    expect(plan.reparent).toEqual([{ id: 'item_right', parentId: created?.id }])
  })

  test('clips a stair opening across both sides of a ceiling split', () => {
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
    setNodes(next: Record<string, AnyNode>) {
      state.nodes = next
      notify()
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

function canonicalRing(points: Array<[number, number]>) {
  if (points.length === 0) return points
  const candidates: Array<Array<[number, number]>> = []
  for (const ring of [points, [...points].reverse()]) {
    for (let index = 0; index < ring.length; index += 1) {
      candidates.push([...ring.slice(index), ...ring.slice(0, index)])
    }
  }
  return candidates.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )[0]!
}

function topologyOutcome(nodes: Record<string, AnyNode>, spaces: Record<string, unknown>) {
  const comparableSpaces = Object.values(spaces)
    .map((space: any) => ({
      id: space.id,
      polygon: canonicalRing(space.polygon),
      wallIds: [...space.wallIds].sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const comparableSurfaces = Object.values(nodes)
    .filter(
      (node): node is SlabNode | CeilingNode => node.type === 'slab' || node.type === 'ceiling',
    )
    .map((surface) => ({
      type: surface.type,
      autoFromWalls: surface.autoFromWalls,
      polygon: canonicalRing(surface.polygon),
      holes: surface.holes
        .map(canonicalRing)
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      holeMetadata: surface.holeMetadata,
      visible: surface.visible,
      slots: surface.slots,
      material: surface.material,
      materialPreset: surface.materialPreset,
      ...(surface.type === 'slab'
        ? {
            elevation: surface.elevation,
            thickness: surface.thickness,
            recessed: surface.recessed,
            recessedRimElevation: surface.recessedRimElevation,
            fillToTerrain: surface.fillToTerrain,
          }
        : { height: surface.height, children: [...surface.children].sort() }),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return { spaces: comparableSpaces, surfaces: comparableSurfaces }
}

describe('live room topology reconciliation', () => {
  test('reconciles only the connected wall component while preserving other rooms', () => {
    const levelId = 'level_component_scope'
    const leftWalls = squareWalls().map((wall, index) =>
      WallNode.parse({
        ...wall,
        id: `wall_component_left_${index}`,
        parentId: levelId,
      }),
    )
    const rightWalls = squareWalls().map((wall, index) =>
      WallNode.parse({
        ...wall,
        id: `wall_component_right_${index}`,
        parentId: levelId,
        start: [wall.start[0] + 20, wall.start[1]],
        end: [wall.end[0] + 20, wall.end[1]],
      }),
    )
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: [...leftWalls, ...rightWalls].map((wall) => wall.id),
    })
    const initialNodes = Object.fromEntries(
      [level, ...leftWalls, ...rightWalls].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const events: Array<{ strategy: string; examinedWallIds: string[] }> = []
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore, {
      onTopologyReconcile: (event) => events.push(event),
    })

    try {
      runWithSceneCommitNodeIds([leftWalls[0]!.id], () => {
        sceneStore.setNodes({
          ...sceneStore.getState().nodes,
          [leftWalls[0]!.id]: { ...leftWalls[0], height: 2.7 } as WallNode,
        })
      })

      expect(Object.values(editorStore.getState().spaces)).toHaveLength(2)
      expect(events).toHaveLength(1)
      expect(events[0]?.strategy).toBe('indexed')
      expect(new Set(events[0]?.examinedWallIds)).toEqual(new Set(leftWalls.map((wall) => wall.id)))
    } finally {
      unsubscribe()
    }
  })

  test('preserves customized surfaces through repeated room split and merge cycles', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_custom_split_${index}`,
      parentId: 'level_custom_split',
    })) as WallNode[]
    const autoSlab = SlabNode.parse({
      id: 'slab_custom_split',
      parentId: 'level_custom_split',
      polygon: square,
      elevation: 0.05,
      autoFromWalls: true,
    })
    const autoCeiling = CeilingNode.parse({
      id: 'ceiling_custom_split',
      parentId: 'level_custom_split',
      polygon: square,
      height: 2.49,
      autoFromWalls: true,
    })
    const level = LevelNode.parse({
      id: 'level_custom_split',
      level: 0,
      height: 2.5,
      children: [...walls.map((wall) => wall.id), autoSlab.id, autoCeiling.id],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, autoSlab, autoCeiling].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore, {
      onTopologyReconcile: (event) => events.push(event),
    })

    try {
      sceneStore.setNodes({
        ...sceneStore.getState().nodes,
        [autoSlab.id]: {
          ...autoSlab,
          elevation: 0.42,
          thickness: 0.18,
          materialPreset: 'custom-floor',
          slots: { surface: 'library:oak' },
          visible: false,
        } as SlabNode,
        [autoCeiling.id]: {
          ...autoCeiling,
          height: 2.1,
          materialPreset: 'custom-ceiling',
          slots: { surface: 'library:blue' },
          visible: false,
        } as CeilingNode,
      })

      expect((sceneStore.getState().nodes[autoSlab.id] as SlabNode).elevation).toBe(0.42)
      expect((sceneStore.getState().nodes[autoCeiling.id] as CeilingNode).height).toBe(2.1)

      const current = sceneStore.getState().nodes
      const divider = WallNode.parse({
        id: 'wall_custom_split_divider',
        parentId: level.id,
        start: [2, 0],
        end: [2, 3],
        height: 2.5,
      })
      runWithSceneCommitNodeIds([divider.id, level.id], () => {
        sceneStore.setNodes({
          ...current,
          [divider.id]: divider,
          [level.id]: {
            ...current[level.id],
            children: [...((current[level.id] as LevelNode).children ?? []), divider.id],
          } as LevelNode,
        })
      })

      const nodes = Object.values(sceneStore.getState().nodes)
      const slabs = nodes.filter(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      const ceilings = nodes.filter(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )

      expect(Object.values(editorStore.getState().spaces)).toHaveLength(2)
      expect(slabs).toHaveLength(2)
      expect(ceilings).toHaveLength(2)
      expect(
        slabs.every(
          (slab) =>
            slab.elevation === 0.42 &&
            slab.thickness === 0.18 &&
            slab.materialPreset === 'custom-floor' &&
            slab.slots?.surface === 'library:oak' &&
            slab.visible === false,
        ),
      ).toBe(true)
      expect(
        ceilings.every(
          (ceiling) =>
            ceiling.height === 2.1 &&
            ceiling.materialPreset === 'custom-ceiling' &&
            ceiling.slots?.surface === 'library:blue' &&
            ceiling.visible === false,
        ),
      ).toBe(true)

      const { [divider.id]: _divider, ...withoutDivider } = sceneStore.getState().nodes
      const splitLevel = withoutDivider[level.id] as LevelNode
      runWithSceneCommitNodeIds([divider.id, level.id], () => {
        sceneStore.setNodes({
          ...withoutDivider,
          [level.id]: {
            ...splitLevel,
            children: splitLevel.children.filter((id) => id !== divider.id),
          } as LevelNode,
        })
      })

      const mergedNodes = Object.values(sceneStore.getState().nodes)
      const mergedSlabs = mergedNodes.filter(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      const mergedCeilings = mergedNodes.filter(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )
      expect(Object.values(editorStore.getState().spaces)).toHaveLength(1)
      expect(mergedSlabs).toHaveLength(1)
      expect(mergedCeilings).toHaveLength(1)
      expect(mergedSlabs[0]).toMatchObject({
        elevation: 0.42,
        thickness: 0.18,
        materialPreset: 'custom-floor',
        slots: { surface: 'library:oak' },
        visible: false,
      })
      expect(mergedCeilings[0]).toMatchObject({
        height: 2.1,
        materialPreset: 'custom-ceiling',
        slots: { surface: 'library:blue' },
        visible: false,
      })

      const mergedLevel = sceneStore.getState().nodes[level.id] as LevelNode
      runWithSceneCommitNodeIds([divider.id, level.id], () => {
        sceneStore.setNodes({
          ...sceneStore.getState().nodes,
          [divider.id]: divider,
          [level.id]: {
            ...mergedLevel,
            children: [...mergedLevel.children, divider.id],
          } as LevelNode,
        })
      })

      const resplitNodes = Object.values(sceneStore.getState().nodes)
      expect(Object.values(editorStore.getState().spaces)).toHaveLength(2)
      expect(
        resplitNodes.filter((node) => node.type === 'slab' && node.autoFromWalls),
      ).toHaveLength(2)
      expect(
        resplitNodes.filter((node) => node.type === 'ceiling' && node.autoFromWalls),
      ).toHaveLength(2)
      expect(events.map((event) => event.strategy)).toEqual(['indexed', 'indexed', 'indexed'])
    } finally {
      unsubscribe()
    }
  })

  test('creates surfaces for a corridor enclosed between two surfaced rooms', () => {
    const levelId = 'level_corridor'
    const wallData = [
      { id: 'wall_a_bottom', start: [0, 0], end: [4, 0] },
      { id: 'wall_a_top', start: [4, 3], end: [0, 3] },
      { id: 'wall_a_left', start: [0, 3], end: [0, 0] },
      { id: 'wall_a_right', start: [4, 0], end: [4, 3] },
      { id: 'wall_b_bottom', start: [6, 0], end: [10, 0] },
      { id: 'wall_b_top', start: [10, 3], end: [6, 3] },
      { id: 'wall_b_left', start: [6, 3], end: [6, 0] },
      { id: 'wall_b_right', start: [10, 0], end: [10, 3] },
      { id: 'wall_corridor_bottom', start: [4, 0], end: [6, 0] },
    ] as const
    const walls = wallData.map((wall) => WallNode.parse({ ...wall, parentId: levelId }))
    const leftPolygon: Array<[number, number]> = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const rightPolygon: Array<[number, number]> = [
      [6, 0],
      [10, 0],
      [10, 3],
      [6, 3],
    ]
    const surfaces = [
      SlabNode.parse({
        id: 'slab_a',
        parentId: levelId,
        polygon: leftPolygon,
        autoFromWalls: true,
      }),
      SlabNode.parse({
        id: 'slab_b',
        parentId: levelId,
        polygon: rightPolygon,
        autoFromWalls: true,
      }),
      CeilingNode.parse({
        id: 'ceiling_a',
        parentId: levelId,
        polygon: leftPolygon,
        autoFromWalls: true,
      }),
      CeilingNode.parse({
        id: 'ceiling_b',
        parentId: levelId,
        polygon: rightPolygon,
        autoFromWalls: true,
      }),
    ]
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: [...walls.map((wall) => wall.id), ...surfaces.map((surface) => surface.id)],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, ...surfaces].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const indexedStore = createSceneStoreStub(initialNodes)
    const indexedEditor = createEditorStoreStub()
    const fullStore = createSceneStoreStub(initialNodes)
    const fullEditor = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribeIndexed = initSpaceDetectionSync(indexedStore, indexedEditor, {
      onTopologyReconcile: (event) => events.push(event),
    })
    const unsubscribeFull = initSpaceDetectionSync(fullStore, fullEditor)

    try {
      const closingWall = WallNode.parse({
        id: 'wall_corridor_top',
        parentId: levelId,
        start: [4, 3],
        end: [6, 3],
      })
      const closeCorridor = (store: ReturnType<typeof createSceneStoreStub>) => {
        store.setNodes({
          ...store.getState().nodes,
          [closingWall.id]: closingWall,
          [level.id]: { ...level, children: [...level.children, closingWall.id] } as LevelNode,
        })
      }
      runWithSceneCommitNodeIds([closingWall.id, level.id], () => {
        closeCorridor(indexedStore)
      })
      closeCorridor(fullStore)

      const nodes = Object.values(indexedStore.getState().nodes)
      expect(Object.values(indexedEditor.getState().spaces)).toHaveLength(3)
      expect(nodes.filter((node) => node.type === 'slab' && node.autoFromWalls)).toHaveLength(3)
      expect(nodes.filter((node) => node.type === 'ceiling' && node.autoFromWalls)).toHaveLength(3)
      expect(
        topologyOutcome(indexedStore.getState().nodes, indexedEditor.getState().spaces),
      ).toEqual(topologyOutcome(fullStore.getState().nodes, fullEditor.getState().spaces))
      expect(events).toHaveLength(1)
      expect(events[0]?.strategy).toBe('indexed')
      expect(events[0]?.examinedWallIds).toHaveLength(10)
    } finally {
      unsubscribeIndexed()
      unsubscribeFull()
    }
  })

  test('reconciles every slab when one compound wall edit creates four rooms', () => {
    const levelId = 'level_compound_rooms'
    const initialWalls = [
      WallNode.parse({
        id: 'wall_compound_north',
        parentId: levelId,
        start: [-4, -3],
        end: [4, -3],
      }),
      WallNode.parse({ id: 'wall_compound_east', parentId: levelId, start: [4, -3], end: [4, 3] }),
      WallNode.parse({ id: 'wall_compound_south', parentId: levelId, start: [4, 3], end: [-4, 3] }),
      WallNode.parse({
        id: 'wall_compound_west',
        parentId: levelId,
        start: [-4, 3],
        end: [-4, -3],
      }),
    ]
    const autoSlab = SlabNode.parse({
      id: 'slab_compound',
      parentId: levelId,
      polygon: [
        [-4, -3],
        [4, -3],
        [4, 3],
        [-4, 3],
      ],
      elevation: 0.2,
      thickness: 0.12,
      slots: { surface: 'library:wood-floorplank1' },
      autoFromWalls: true,
    })
    const autoCeiling = CeilingNode.parse({
      id: 'ceiling_compound',
      parentId: levelId,
      polygon: autoSlab.polygon,
      height: 2.55,
      slots: { surface: 'library:concrete-polished' },
      autoFromWalls: true,
    })
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      height: 2.8,
      children: [...initialWalls.map((wall) => wall.id), autoSlab.id, autoCeiling.id],
    })
    const sceneStore = createSceneStoreStub(
      Object.fromEntries(
        [level, ...initialWalls, autoSlab, autoCeiling].map((node) => [node.id, node]),
      ) as Record<string, AnyNode>,
    )
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

    const finalWalls = [
      initialWalls[1]!,
      initialWalls[3]!,
      WallNode.parse({
        id: 'wall_compound_north_left',
        parentId: levelId,
        start: [-4, -3],
        end: [0, -3],
      }),
      WallNode.parse({
        id: 'wall_compound_north_mid',
        parentId: levelId,
        start: [0, -3],
        end: [1, -3],
      }),
      WallNode.parse({
        id: 'wall_compound_north_right',
        parentId: levelId,
        start: [1, -3],
        end: [4, -3],
      }),
      WallNode.parse({
        id: 'wall_compound_south_right',
        parentId: levelId,
        start: [4, 3],
        end: [1, 3],
      }),
      WallNode.parse({
        id: 'wall_compound_south_mid',
        parentId: levelId,
        start: [1, 3],
        end: [0, 3],
      }),
      WallNode.parse({
        id: 'wall_compound_south_left',
        parentId: levelId,
        start: [0, 3],
        end: [-4, 3],
      }),
      WallNode.parse({
        id: 'wall_compound_diagonal_lower',
        parentId: levelId,
        start: [0, -3],
        end: [1, 0],
      }),
      WallNode.parse({
        id: 'wall_compound_diagonal_upper',
        parentId: levelId,
        start: [1, 0],
        end: [0, 3],
      }),
      WallNode.parse({
        id: 'wall_compound_divider_lower',
        parentId: levelId,
        start: [1, -3],
        end: [1, 0],
      }),
      WallNode.parse({
        id: 'wall_compound_divider_upper',
        parentId: levelId,
        start: [1, 0],
        end: [1, 3],
      }),
    ]

    try {
      const nextLevel = {
        ...level,
        children: [...finalWalls.map((wall) => wall.id), autoSlab.id, autoCeiling.id],
      } as LevelNode
      const nextNodes = Object.fromEntries(
        [nextLevel, ...finalWalls, autoSlab, autoCeiling].map((node) => [node.id, node]),
      ) as Record<string, AnyNode>
      const changedIds = [
        level.id,
        initialWalls[0]!.id,
        initialWalls[2]!.id,
        ...finalWalls.map((wall) => wall.id),
      ]

      runWithSceneCommitNodeIds(changedIds, () => sceneStore.setNodes(nextNodes))

      const reconciled = Object.values(sceneStore.getState().nodes)
      expect(Object.values(editorStore.getState().spaces)).toHaveLength(4)
      expect(reconciled.filter((node) => node.type === 'slab' && node.autoFromWalls)).toHaveLength(
        4,
      )
      expect(
        reconciled.filter((node) => node.type === 'ceiling' && node.autoFromWalls),
      ).toHaveLength(4)
    } finally {
      unsubscribe()
    }
  })

  test('matches the full detector when an existing wall extends to close a second room', () => {
    const levelId = 'level_indexed_extension'
    const walls = [
      WallNode.parse({
        id: 'wall_extension_bottom',
        parentId: levelId,
        start: [0, 0],
        end: [8, 0],
      }),
      WallNode.parse({ id: 'wall_extension_top', parentId: levelId, start: [4, 3], end: [0, 3] }),
      WallNode.parse({ id: 'wall_extension_left', parentId: levelId, start: [0, 3], end: [0, 0] }),
      WallNode.parse({
        id: 'wall_extension_divider',
        parentId: levelId,
        start: [4, 0],
        end: [4, 3],
      }),
      WallNode.parse({ id: 'wall_extension_right', parentId: levelId, start: [8, 0], end: [8, 3] }),
    ]
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: walls.map((wall) => wall.id),
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore, {
      onTopologyReconcile: (event) => events.push(event),
    })

    try {
      const extendedTop = { ...walls[1]!, start: [8, 3] as [number, number] }
      runWithSceneCommitNodeIds([extendedTop.id], () => {
        sceneStore.setNodes({
          ...sceneStore.getState().nodes,
          [extendedTop.id]: extendedTop,
        })
      })

      const liveWalls = Object.values(sceneStore.getState().nodes).filter(
        (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
      )
      const oracle = detectSpacesForLevel(levelId, liveWalls).spaces
      const indexed = Object.values(editorStore.getState().spaces)
      expect(indexed.map((space: any) => space.id).sort()).toEqual(
        oracle.map((space) => space.id).sort(),
      )
      expect(indexed).toHaveLength(2)
      expect(events).toHaveLength(1)
      expect(events[0]?.strategy).toBe('indexed')
    } finally {
      unsubscribe()
    }
  })

  test('matches full reconciliation for spaces and surfaces through split, move, and merge', () => {
    const levelId = 'level_indexed_sequence'
    const leftWalls = squareWalls().map((wall, index) =>
      WallNode.parse({ ...wall, id: `wall_sequence_left_${index}`, parentId: levelId }),
    )
    const rightWalls = squareWalls().map((wall, index) =>
      WallNode.parse({
        ...wall,
        id: `wall_sequence_right_${index}`,
        parentId: levelId,
        start: [wall.start[0] + 20, wall.start[1]],
        end: [wall.end[0] + 20, wall.end[1]],
      }),
    )
    const leftSlab = SlabNode.parse({
      id: 'slab_sequence_left',
      parentId: levelId,
      polygon: square,
      holes: [
        [
          [1.5, 1],
          [2.5, 1],
          [2.5, 2],
          [1.5, 2],
        ],
      ],
      holeMetadata: [{ source: 'stair', stairId: 'stair_sequence' }],
      elevation: 0.42,
      thickness: 0.18,
      slots: { surface: 'library:wood-floorplank1' },
      autoFromWalls: true,
    })
    const leftCeiling = CeilingNode.parse({
      id: 'ceiling_sequence_left',
      parentId: levelId,
      polygon: square,
      height: 2.1,
      slots: { surface: 'library:concrete-polished' },
      autoFromWalls: true,
    })
    const rightPolygon = square.map(([x, y]) => [x + 20, y] as [number, number])
    const rightSlab = SlabNode.parse({
      id: 'slab_sequence_right',
      parentId: levelId,
      polygon: rightPolygon,
      elevation: 0.1,
      autoFromWalls: true,
    })
    const rightCeiling = CeilingNode.parse({
      id: 'ceiling_sequence_right',
      parentId: levelId,
      polygon: rightPolygon,
      height: 2.4,
      autoFromWalls: true,
    })
    const surfaces = [leftSlab, leftCeiling, rightSlab, rightCeiling]
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: [
        ...[...leftWalls, ...rightWalls].map((wall) => wall.id),
        ...surfaces.map((surface) => surface.id),
      ],
    })
    const initialNodes = Object.fromEntries(
      [level, ...leftWalls, ...rightWalls, ...surfaces].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const indexedStore = createSceneStoreStub(initialNodes)
    const indexedEditor = createEditorStoreStub()
    const fullStore = createSceneStoreStub(initialNodes)
    const fullEditor = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribeIndexed = initSpaceDetectionSync(indexedStore, indexedEditor, {
      onTopologyReconcile: (event) => events.push(event),
    })
    const unsubscribeFull = initSpaceDetectionSync(fullStore, fullEditor)
    const assertEquivalent = () => {
      expect(
        topologyOutcome(indexedStore.getState().nodes, indexedEditor.getState().spaces),
      ).toEqual(topologyOutcome(fullStore.getState().nodes, fullEditor.getState().spaces))
    }
    const applyToBoth = (
      changedIds: AnyNodeId[],
      mutation: (store: ReturnType<typeof createSceneStoreStub>) => void,
    ) => {
      runWithSceneCommitNodeIds(changedIds, () => mutation(indexedStore))
      mutation(fullStore)
      assertEquivalent()
    }

    try {
      const divider = WallNode.parse({
        id: 'wall_sequence_divider',
        parentId: levelId,
        start: [2, 0],
        end: [2, 3],
      })
      applyToBoth([divider.id, level.id], (store) => {
        const nodes = store.getState().nodes
        store.setNodes({
          ...nodes,
          [divider.id]: divider,
          [level.id]: {
            ...nodes[level.id],
            children: [...(nodes[level.id] as LevelNode).children, divider.id],
          } as LevelNode,
        })
      })

      applyToBoth([divider.id], (store) => {
        store.setNodes({
          ...store.getState().nodes,
          [divider.id]: { ...divider, start: [3, 0], end: [3, 3] } as WallNode,
        })
      })

      applyToBoth([divider.id, level.id], (store) => {
        const nodes = store.getState().nodes
        const { [divider.id]: _divider, ...withoutDivider } = nodes
        store.setNodes({
          ...withoutDivider,
          [level.id]: {
            ...withoutDivider[level.id],
            children: (withoutDivider[level.id] as LevelNode).children.filter(
              (id) => id !== divider.id,
            ),
          } as LevelNode,
        })
      })

      const rightWallIds = new Set(rightWalls.map((wall) => wall.id))
      expect(events).toHaveLength(3)
      expect(
        events.every((event) => event.examinedWallIds.every((id) => !rightWallIds.has(id))),
      ).toBe(true)
    } finally {
      unsubscribeIndexed()
      unsubscribeFull()
    }
  })

  test('matches full reconciliation when a curved room boundary changes', () => {
    const levelId = 'level_indexed_curve'
    const walls = [
      WallNode.parse({ id: 'wall_curve_bottom', parentId: levelId, start: [0, 0], end: [4, 0] }),
      WallNode.parse({ id: 'wall_curve_right', parentId: levelId, start: [4, 0], end: [4, 3] }),
      WallNode.parse({
        id: 'wall_curve_top',
        parentId: levelId,
        start: [4, 3],
        end: [0, 3],
        curveOffset: 0.5,
      }),
      WallNode.parse({ id: 'wall_curve_left', parentId: levelId, start: [0, 3], end: [0, 0] }),
    ]
    const initialRoom = detectSpacesForLevel(levelId, walls).spaces[0]
    expect(initialRoom).toBeDefined()
    const slab = SlabNode.parse({
      id: 'slab_curve',
      parentId: levelId,
      polygon: initialRoom!.polygon,
      elevation: 0.3,
      autoFromWalls: true,
    })
    const ceiling = CeilingNode.parse({
      id: 'ceiling_curve',
      parentId: levelId,
      polygon: initialRoom!.polygon,
      height: 2.2,
      autoFromWalls: true,
    })
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: [...walls.map((wall) => wall.id), slab.id, ceiling.id],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, slab, ceiling].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const indexedStore = createSceneStoreStub(initialNodes)
    const indexedEditor = createEditorStoreStub()
    const fullStore = createSceneStoreStub(initialNodes)
    const fullEditor = createEditorStoreStub()
    const unsubscribeIndexed = initSpaceDetectionSync(indexedStore, indexedEditor)
    const unsubscribeFull = initSpaceDetectionSync(fullStore, fullEditor)
    const curvedWall = walls[2]!
    const updateCurve = (store: ReturnType<typeof createSceneStoreStub>) => {
      store.setNodes({
        ...store.getState().nodes,
        [curvedWall.id]: { ...curvedWall, curveOffset: 1 } as WallNode,
      })
    }

    try {
      runWithSceneCommitNodeIds([curvedWall.id], () => updateCurve(indexedStore))
      updateCurve(fullStore)

      expect(
        topologyOutcome(indexedStore.getState().nodes, indexedEditor.getState().spaces),
      ).toEqual(topologyOutcome(fullStore.getState().nodes, fullEditor.getState().spaces))
    } finally {
      unsubscribeIndexed()
      unsubscribeFull()
    }
  })

  test('clears indexed rooms when their entire level is cascade-deleted', () => {
    const levelId = 'level_indexed_delete'
    const walls = squareWalls().map((wall, index) =>
      WallNode.parse({ ...wall, id: `wall_indexed_delete_${index}`, parentId: levelId }),
    )
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: walls.map((wall) => wall.id),
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const indexedStore = createSceneStoreStub(initialNodes)
    const indexedEditor = createEditorStoreStub()
    const fullStore = createSceneStoreStub(initialNodes)
    const fullEditor = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribeIndexed = initSpaceDetectionSync(indexedStore, indexedEditor, {
      onTopologyReconcile: (event) => events.push(event),
    })
    const unsubscribeFull = initSpaceDetectionSync(fullStore, fullEditor)
    const changeWallHeight = (store: ReturnType<typeof createSceneStoreStub>) => {
      store.setNodes({
        ...store.getState().nodes,
        [walls[0]!.id]: { ...walls[0], height: 2.7 } as WallNode,
      })
    }

    try {
      runWithSceneCommitNodeIds([walls[0]!.id], () => {
        changeWallHeight(indexedStore)
      })
      changeWallHeight(fullStore)
      expect(Object.values(indexedEditor.getState().spaces)).toHaveLength(1)
      expect(
        topologyOutcome(indexedStore.getState().nodes, indexedEditor.getState().spaces),
      ).toEqual(topologyOutcome(fullStore.getState().nodes, fullEditor.getState().spaces))

      const ids = Object.keys(indexedStore.getState().nodes) as AnyNodeId[]
      runWithSceneCommitNodeIds(ids, () => indexedStore.setNodes({}))
      fullStore.setNodes({})

      expect(Object.values(indexedEditor.getState().spaces)).toHaveLength(0)
      expect(
        topologyOutcome(indexedStore.getState().nodes, indexedEditor.getState().spaces),
      ).toEqual(topologyOutcome(fullStore.getState().nodes, fullEditor.getState().spaces))
      expect(events.at(-1)).toMatchObject({
        strategy: 'indexed',
        affectedBeforeRoomCount: 1,
        affectedCurrentRoomCount: 0,
      })
    } finally {
      unsubscribeIndexed()
      unsubscribeFull()
    }
  })

  test('falls back safely when a local wall edit targets a level absent from the index', () => {
    const levelId = 'level_indexed_fallback'
    const walls = squareWalls().map((wall, index) =>
      WallNode.parse({ ...wall, id: `wall_indexed_fallback_${index}`, parentId: levelId }),
    )
    const level = LevelNode.parse({
      id: levelId,
      level: 0,
      children: walls.map((wall) => wall.id),
    })
    const sceneStore = createSceneStoreStub({})
    const editorStore = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore, {
      onTopologyReconcile: (event) => events.push(event),
    })

    try {
      runWithSceneCommitNodeIds([level.id, ...walls.map((wall) => wall.id)], () => {
        sceneStore.setNodes(
          Object.fromEntries([level, ...walls].map((node) => [node.id, node])) as Record<
            string,
            AnyNode
          >,
        )
      })

      expect(Object.values(editorStore.getState().spaces)).toHaveLength(1)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        strategy: 'fallback',
        affectedBeforeRoomCount: 0,
        affectedCurrentRoomCount: 1,
      })
    } finally {
      unsubscribe()
    }
  })

  test('restoring a deleted generated surface keeps it through the next wall edit', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_restore_${index}`,
      parentId: 'level_restore',
    })) as WallNode[]
    const autoSlab = SlabNode.parse({
      id: 'slab_restore',
      parentId: 'level_restore',
      polygon: square,
      autoFromWalls: true,
    })
    const level = LevelNode.parse({
      id: 'level_restore',
      level: 0,
      children: [...walls.map((wall) => wall.id), autoSlab.id],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, autoSlab].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const { [autoSlab.id]: _deleted, ...withoutSlab } = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...withoutSlab,
        [level.id]: { ...level, children: walls.map((wall) => wall.id) } as LevelNode,
      })
      sceneStore.setNodes(initialNodes)
      sceneStore.setNodes({
        ...sceneStore.getState().nodes,
        [walls[0]!.id]: { ...walls[0], height: 2.7 } as WallNode,
      })

      expect(sceneStore.getState().nodes[autoSlab.id]).toMatchObject({
        type: 'slab',
        autoFromWalls: true,
      })
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
})

describe('raised auto-room surfaces', () => {
  test('inherits the enclosing walls construction plane when the room closes', () => {
    const wallData = [
      { id: 'wall_bottom', start: [0, 0], end: [4, 0] },
      { id: 'wall_right', start: [4, 0], end: [4, 3] },
      { id: 'wall_top', start: [4, 3], end: [0, 3] },
      { id: 'wall_left', start: [0, 3], end: [0, 0] },
    ] as const
    const walls = wallData.map((wall) =>
      WallNode.parse({
        ...wall,
        parentId: 'level_0',
        height: 2.5,
        supportOffset: 0.6,
      }),
    )
    const initialWalls = walls.slice(0, 3)
    const initialNodes = Object.fromEntries(
      [
        BuildingNode.parse({ id: 'building_a', children: ['level_0'] }),
        LevelNode.parse({
          id: 'level_0',
          level: 0,
          height: 2.5,
          parentId: 'building_a',
          children: initialWalls.map((wall) => wall.id),
        }),
        ...initialWalls,
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

    try {
      const current = sceneStore.getState().nodes
      const level = current.level_0 as LevelNode
      const closingWall = walls[3]!
      runWithSceneCommitNodeIds([closingWall.id, level.id], () => {
        sceneStore.setNodes({
          ...current,
          [closingWall.id]: closingWall,
          level_0: {
            ...level,
            children: [...level.children, closingWall.id],
          } as LevelNode,
        })
      })

      const generated = Object.values(sceneStore.getState().nodes)
      const autoSlab = generated.find(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      const autoCeiling = generated.find(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )

      expect(autoSlab?.elevation).toBeCloseTo(0.65)
      expect(autoSlab?.thickness).toBeCloseTo(0.05)
      expect(autoCeiling?.height).toBeCloseTo(3.09)

      const raisedAgain = { ...sceneStore.getState().nodes }
      for (const wall of walls) {
        raisedAgain[wall.id] = { ...raisedAgain[wall.id], supportOffset: 0.8 } as AnyNode
      }
      runWithSceneCommitNodeIds(
        walls.map((wall) => wall.id),
        () => sceneStore.setNodes(raisedAgain),
      )

      const reconciled = Object.values(sceneStore.getState().nodes)
      const reconciledSlab = reconciled.find(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      const reconciledCeiling = reconciled.find(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )
      expect(reconciledSlab?.elevation).toBeCloseTo(0.85)
      expect(reconciledCeiling?.height).toBeCloseTo(3.29)
    } finally {
      unsubscribe()
    }
  })
})

describe('generated surface deletion memory', () => {
  test('does not backfill missing generated surfaces when a closed scene is loaded and reshaped', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_loaded_without_surfaces_${index}`,
      parentId: 'level_loaded_without_surfaces',
    })) as WallNode[]
    const level = LevelNode.parse({
      id: 'level_loaded_without_surfaces',
      level: 0,
      children: walls.map((wall) => wall.id),
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

    try {
      const current = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...current,
        [walls[0]!.id]: { ...current[walls[0]!.id], end: [5, 0] } as WallNode,
        [walls[1]!.id]: {
          ...current[walls[1]!.id],
          start: [5, 0],
          end: [5, 3],
        } as WallNode,
        [walls[2]!.id]: { ...current[walls[2]!.id], start: [5, 3] } as WallNode,
      })

      expect(
        Object.values(sceneStore.getState().nodes).filter(
          (node) => (node.type === 'slab' || node.type === 'ceiling') && node.autoFromWalls,
        ),
      ).toHaveLength(0)
      expect(Object.values(editorStore.getState().spaces)).toHaveLength(1)
    } finally {
      unsubscribe()
    }
  })

  test('a deleted generated slab stays absent while the ceiling follows a later room reshape', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_delete_memory_${index}`,
      parentId: 'level_delete_memory',
    })) as WallNode[]
    const autoSlab = SlabNode.parse({
      id: 'slab_delete_memory',
      parentId: 'level_delete_memory',
      polygon: square,
      autoFromWalls: true,
    })
    const autoCeiling = CeilingNode.parse({
      id: 'ceiling_delete_memory',
      parentId: 'level_delete_memory',
      polygon: square,
      autoFromWalls: true,
    })
    const level = LevelNode.parse({
      id: 'level_delete_memory',
      level: 0,
      children: [...walls.map((wall) => wall.id), autoSlab.id, autoCeiling.id],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, autoSlab, autoCeiling].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const { slab_delete_memory: _deleted, ...withoutSlab } = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...withoutSlab,
        [level.id]: {
          ...withoutSlab[level.id],
          children: level.children.filter((id) => id !== autoSlab.id),
        } as LevelNode,
      })

      const afterDelete = sceneStore.getState().nodes
      expect(
        Object.values(afterDelete).filter((node) => node.type === 'slab' && node.autoFromWalls),
      ).toHaveLength(0)

      sceneStore.setNodes({
        ...afterDelete,
        [walls[0]!.id]: { ...afterDelete[walls[0]!.id], end: [5, 0] } as WallNode,
        [walls[1]!.id]: {
          ...afterDelete[walls[1]!.id],
          start: [5, 0],
          end: [5, 3],
        } as WallNode,
        [walls[2]!.id]: { ...afterDelete[walls[2]!.id], start: [5, 3] } as WallNode,
      })

      const afterReshape = Object.values(sceneStore.getState().nodes)
      expect(
        afterReshape.filter((node) => node.type === 'slab' && node.autoFromWalls),
      ).toHaveLength(0)
      const ceiling = afterReshape.find(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )
      expect(ceiling?.polygon).toContainEqual([5, 0])
      expect(ceiling?.polygon).toContainEqual([5, 3])
    } finally {
      unsubscribe()
    }
  })

  test('a deleted generated ceiling stays absent while the slab follows a later room reshape', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_ceiling_memory_${index}`,
      parentId: 'level_ceiling_memory',
    })) as WallNode[]
    const autoSlab = SlabNode.parse({
      id: 'slab_ceiling_memory',
      parentId: 'level_ceiling_memory',
      polygon: square,
      autoFromWalls: true,
    })
    const autoCeiling = CeilingNode.parse({
      id: 'ceiling_ceiling_memory',
      parentId: 'level_ceiling_memory',
      polygon: square,
      autoFromWalls: true,
    })
    const level = LevelNode.parse({
      id: 'level_ceiling_memory',
      level: 0,
      children: [...walls.map((wall) => wall.id), autoSlab.id, autoCeiling.id],
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls, autoSlab, autoCeiling].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      const { ceiling_ceiling_memory: _deleted, ...withoutCeiling } = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...withoutCeiling,
        [level.id]: {
          ...withoutCeiling[level.id],
          children: level.children.filter((id) => id !== autoCeiling.id),
        } as LevelNode,
      })

      const afterDelete = sceneStore.getState().nodes
      expect(
        Object.values(afterDelete).filter((node) => node.type === 'ceiling' && node.autoFromWalls),
      ).toHaveLength(0)

      sceneStore.setNodes({
        ...afterDelete,
        [walls[0]!.id]: { ...afterDelete[walls[0]!.id], end: [5, 0] } as WallNode,
        [walls[1]!.id]: {
          ...afterDelete[walls[1]!.id],
          start: [5, 0],
          end: [5, 3],
        } as WallNode,
        [walls[2]!.id]: { ...afterDelete[walls[2]!.id], start: [5, 3] } as WallNode,
      })

      const afterReshape = Object.values(sceneStore.getState().nodes)
      expect(
        afterReshape.filter((node) => node.type === 'ceiling' && node.autoFromWalls),
      ).toHaveLength(0)
      const slab = afterReshape.find(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      expect(slab?.polygon).toContainEqual([5, 0])
      expect(slab?.polygon).toContainEqual([5, 3])
    } finally {
      unsubscribe()
    }
  })
})

describe('space lifecycle reconciliation', () => {
  test('removes stale spaces and deleted wall ids when a room is opened', () => {
    const walls = squareWalls().map((wall, index) => ({
      ...wall,
      id: `wall_space_lifecycle_${index}`,
      parentId: 'level_space_lifecycle',
    })) as WallNode[]
    const level = LevelNode.parse({
      id: 'level_space_lifecycle',
      level: 0,
      children: walls.map((wall) => wall.id),
    })
    const initialNodes = Object.fromEntries(
      [level, ...walls].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const events: SpaceTopologyReconcileEvent[] = []
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore, {
      onTopologyReconcile: (event) => events.push(event),
    })

    try {
      runWithSceneCommitNodeIds([walls[0]!.id], () => {
        sceneStore.setNodes({
          ...sceneStore.getState().nodes,
          [walls[0]!.id]: { ...walls[0], height: 2.7 } as WallNode,
        })
      })
      expect(Object.values(editorStore.getState().spaces)).toHaveLength(1)

      const current = sceneStore.getState().nodes
      const deletedWall = walls[3]!
      const { [deletedWall.id]: _deleted, ...withoutWall } = current
      runWithSceneCommitNodeIds([deletedWall.id, level.id], () => {
        sceneStore.setNodes({
          ...withoutWall,
          [level.id]: {
            ...withoutWall[level.id],
            children: level.children.filter((id) => id !== deletedWall.id),
          } as LevelNode,
        })
      })

      expect(Object.values(editorStore.getState().spaces)).toHaveLength(0)
      expect(
        Object.values(editorStore.getState().spaces).some((space) =>
          (space as { wallIds?: string[] }).wallIds?.includes(deletedWall.id),
        ),
      ).toBe(false)
      expect(events.map((event) => event.strategy)).toEqual(['indexed', 'indexed'])
    } finally {
      unsubscribe()
    }
  })
})

// A 1 m ramp across the room's x span: ground 0 at x ≤ 0 rising to 1 at
// x ≥ 4, flat in z. Written column by column so the field is exactly
// monotonic across the walls, rather than depending on brush falloff.
function rampedSite(): AnyNode {
  const base = createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
  let field = base
  for (let col = 0; col <= 16; col += 1) {
    const x = -8 + col
    const height = Math.max(0, Math.min(1, x / 4))
    const patch = flattenPatch(field, { minX: x, minZ: -8, maxX: x + 0.001, maxZ: 8 }, height)
    if (patch) field = applyHeightPatch(field, patch)
  }
  return {
    id: 'site_test',
    type: 'site',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['building_a'],
    terrain: encodeTerrainField(field),
  } as unknown as AnyNode
}

/** The 4×3 `square` room on `level_0` of a building on `site_test`. */
function slopedRoomScene(site: AnyNode | null) {
  const wallData = [
    { id: 'wall_bottom', start: [0, 0], end: [4, 0] },
    { id: 'wall_right', start: [4, 0], end: [4, 3] },
    { id: 'wall_top', start: [4, 3], end: [0, 3] },
    { id: 'wall_left', start: [0, 3], end: [0, 0] },
  ] as const
  const walls = wallData.map((wall) =>
    WallNode.parse({ ...wall, parentId: 'level_0', height: 2.5 }),
  )
  const initialWalls = walls.slice(0, 3)
  const nodes = Object.fromEntries(
    [
      ...(site ? [site] : []),
      BuildingNode.parse({ id: 'building_a', parentId: site?.id ?? null, children: ['level_0'] }),
      LevelNode.parse({
        id: 'level_0',
        level: 0,
        height: 2.5,
        parentId: 'building_a',
        children: initialWalls.map((wall) => wall.id),
      }),
      ...initialWalls,
    ].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
  return { nodes, closingWall: walls[3]! }
}

function closeRoom(sceneStore: ReturnType<typeof createSceneStoreStub>, closingWall: AnyNode) {
  const current = sceneStore.getState().nodes
  const level = current.level_0 as LevelNode
  sceneStore.setNodes({
    ...current,
    [closingWall.id]: closingWall,
    level_0: { ...level, children: [...level.children, closingWall.id] } as LevelNode,
  })
}

function autoSurfacesOf(sceneStore: ReturnType<typeof createSceneStoreStub>) {
  const all = Object.values(sceneStore.getState().nodes)
  return {
    slab: all.find((node): node is SlabNode => node.type === 'slab' && node.autoFromWalls),
    ceiling: all.find((node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls),
  }
}

describe('auto-room surfaces over terrain', () => {
  test('a room on a slope takes its floor from the HIGHEST wall base', () => {
    // Walls on bare terrain: no `supportSlabId`, no `supportOffset` — exactly
    // what a stamped room preset or a 3D draw over untouched ground produces.
    // Bases run 0 → 1 across the ramp, so a floor at the lowest base would
    // leave daylight under the walls at the high end.
    const { nodes, closingWall } = slopedRoomScene(rampedSite())
    const sceneStore = createSceneStoreStub(nodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      closeRoom(sceneStore, closingWall)
      const { slab, ceiling } = autoSurfacesOf(sceneStore)

      // Highest wall base = the ramp at x = 4 (the right wall's start), +the
      // 5 cm auto-slab lift.
      expect(slab?.elevation).toBeCloseTo(1.05)
      // Lowest wall top = the LOWEST base + 2.5 (explicit-height walls ride
      // their own base), −the 1 cm clamp margin. Bottom/left walls start at
      // x = 0, i.e. ground 0.
      expect(ceiling?.height).toBeCloseTo(2.49)
    } finally {
      unsubscribe()
    }
  })

  test('flat ground is unchanged — the same room with no terrain', () => {
    const { nodes, closingWall } = slopedRoomScene(null)
    const sceneStore = createSceneStoreStub(nodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      closeRoom(sceneStore, closingWall)
      const { slab, ceiling } = autoSurfacesOf(sceneStore)
      expect(slab?.elevation).toBeCloseTo(0.05)
      expect(ceiling?.height).toBeCloseTo(2.49)
    } finally {
      unsubscribe()
    }
  })

  test('sculpting under an existing room re-derives its floor and ceiling', () => {
    // The trigger half of the bug: a sculpt writes only `site.terrain`, so
    // without a terrain term in the structure signature every level hashes
    // identically and the sync early-exits.
    const { nodes, closingWall } = slopedRoomScene(rampedSite())
    const sceneStore = createSceneStoreStub(nodes)
    const unsubscribe = initSpaceDetectionSync(sceneStore, createEditorStoreStub())

    try {
      closeRoom(sceneStore, closingWall)
      expect(autoSurfacesOf(sceneStore).slab?.elevation).toBeCloseTo(1.05)

      // Level the whole lot to 2 m — the ground under every wall moves, and
      // nothing else in the scene changes.
      const flat = createTerrainField({ cols: 17, rows: 17, spacing: 1, origin: [-8, -8] })
      const levelled = applyHeightPatch(
        flat,
        flattenPatch(flat, { minX: -8, minZ: -8, maxX: 8, maxZ: 8 }, 2) as never,
      )
      const current = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...current,
        site_test: {
          ...(current.site_test as Record<string, unknown>),
          terrain: encodeTerrainField(levelled),
        } as AnyNode,
      })

      const { slab, ceiling } = autoSurfacesOf(sceneStore)
      expect(slab?.elevation).toBeCloseTo(2.05)
      expect(ceiling?.height).toBeCloseTo(4.49)
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

  test('detects a newly enclosed corridor between two existing rooms', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0] }),
      WallNode.parse({ start: [2, 0], end: [2, 3] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [6, 0], end: [6, 3] }),
    ]

    const { roomPolygons } = detectSpacesForLevel('level-1', walls)

    expect(roomPolygons).toHaveLength(3)
    expect(roomPolygons.map(areaOf).sort((a, b) => a - b)).toEqual([6, 6, 6])
  })

  test('detects a new enclosure outside an extended existing room wall', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [8, 0] }),
      WallNode.parse({ start: [8, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [8, 0], end: [8, 3] }),
    ]

    const { roomPolygons } = detectSpacesForLevel('level-1', walls)

    expect(roomPolygons).toHaveLength(2)
    expect(roomPolygons.map(areaOf).sort((a, b) => a - b)).toEqual([12, 12])
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
  test('creates and reconciles an auto slab on the enclosing wall plane', () => {
    const context = {
      elevationForRoom: () => 0.65,
    }
    const created = planAutoSlabsForLevel([roomPolygon()], [], context).create[0]

    expect(created?.elevation).toBeCloseTo(0.65)

    const existing = slab(0.05)
    const update = planAutoSlabsForLevel([roomPolygon()], [existing], context).update[0]

    expect(update?.id).toBe(existing.id)
    expect(update?.data.elevation).toBeCloseTo(0.65)
  })

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

  test('preserves incompatible merged slabs as separate manual surfaces', () => {
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

  test('a split slab inherits customization and assigns each opening to its room', () => {
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
      fillToTerrain: true,
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
    expect(surfaces.every((surface) => surface.fillToTerrain === true)).toBe(true)
    expect(surfaces.every((surface) => surface.materialPreset === 'custom-floor')).toBe(true)
    expect(surfaces.every((surface) => surface.slots?.surface === 'library:oak')).toBe(true)
    expect(left?.holes).toEqual([leftHole])
    expect(left?.holeMetadata).toEqual([{ source: 'manual' }])
    expect(right?.holes).toEqual([rightHole])
    expect(right?.holeMetadata).toEqual([{ source: 'stair', stairId: 'stair_right' }])
  })

  test('a split recessed slab preserves its rim elevation', () => {
    const recessed = SlabNode.parse({
      polygon: square,
      elevation: -0.2,
      thickness: 0.25,
      recessed: true,
      recessedRimElevation: 0.15,
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

    const plan = planAutoSlabsForLevel(rooms, [recessed])
    const surfaces = [SlabNode.parse({ ...recessed, ...plan.update[0]?.data }), ...plan.create]

    expect(surfaces).toHaveLength(2)
    expect(
      surfaces.every(
        (surface) =>
          surface.elevation === -0.2 &&
          surface.thickness === 0.25 &&
          surface.recessed === true &&
          surface.recessedRimElevation === 0.15,
      ),
    ).toBe(true)
  })

  test('preserves slabs with conflicting terrain-fill settings instead of merging them', () => {
    const leftSlab = SlabNode.parse({
      id: 'slab_fill_left',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      fillToTerrain: true,
      autoFromWalls: true,
    })
    const rightSlab = SlabNode.parse({
      id: 'slab_fill_right',
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
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toEqual(
      expect.arrayContaining([
        { id: leftSlab.id, data: { autoFromWalls: false } },
        { id: rightSlab.id, data: { autoFromWalls: false } },
      ]),
    )
  })

  test('clips an elevator opening across both sides of a slab split', () => {
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
})
