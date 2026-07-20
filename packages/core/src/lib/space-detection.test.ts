import { describe, expect, test } from 'bun:test'
import { BuildingNode, CeilingNode, LevelNode, SlabNode, WallNode, ZoneNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { resolveCeilingHeight } from '../services/level-height'
import { getCeilingClampBound } from '../services/storey'
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
