import { beforeAll, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core'
import { z } from 'zod'
import {
  classifyParticipant,
  collectParticipants,
  planBoundsCenter,
  rotateGroupPatches,
  rotateGroupSnapshots,
  rotatePlanBounds,
  translateGroupPatches,
} from './group-transform-shared'

const BUILDING_SCOPED_KIND = 'group-transform-building-scoped-test'

function registerBuildingScopedTestKind() {
  if (nodeRegistry.has(BUILDING_SCOPED_KIND)) return

  registerNode({
    kind: BUILDING_SCOPED_KIND,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(BUILDING_SCOPED_KIND) }) as never,
    category: 'structure',
    defaults: () => ({}),
    capabilities: {},
    floorplanScope: 'building',
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition)
}

function registerElevatorTestKind() {
  if (nodeRegistry.has('elevator')) return

  registerNode({
    kind: 'elevator',
    schemaVersion: 1,
    schema: z.object({ type: z.literal('elevator') }) as never,
    category: 'structure',
    defaults: () => ({}),
    capabilities: { selectable: {} },
    floorplanScope: 'building',
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
  } as AnyNodeDefinition)
}

// A level holding one of each rigid placement shape: an item ([x,y,z] rotation)
// and a column (numeric rotation).
function placedNodes() {
  return {
    building_test: { id: 'building_test', type: 'building', children: ['level_test'] },
    level_test: {
      id: 'level_test',
      type: 'level',
      parentId: 'building_test',
      children: ['item_chair', 'column_post'],
    },
    item_chair: {
      id: 'item_chair',
      type: 'item',
      parentId: 'level_test',
      position: [1, 0, 3],
      rotation: [0, 0.5, 0],
    },
    column_post: {
      id: 'column_post',
      type: 'column',
      parentId: 'level_test',
      position: [4, 0, -1],
      rotation: 1.25,
    },
  } as unknown as Record<string, AnyNode>
}

describe('group transform participants', () => {
  beforeAll(() => {
    registerBuildingScopedTestKind()
    registerElevatorTestKind()
  })

  test('includes building-scoped positioned nodes for the active level building', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test', 'elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: BUILDING_SCOPED_KIND,
        parentId: 'building_test',
        position: [1, 0, 2],
        rotation: 0,
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')

    const participants = collectParticipants(['elevator_test'], nodes, 'level_test')
    expect(participants.starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [1, 0, 2],
        rotation: 0,
      },
    ])
  })

  test('excludes building-scoped positioned nodes from other buildings', () => {
    const nodes = {
      building_active: {
        id: 'building_active',
        type: 'building',
        children: ['level_test'],
      },
      building_other: {
        id: 'building_other',
        type: 'building',
        children: ['elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_active',
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: BUILDING_SCOPED_KIND,
        parentId: 'building_other',
        position: [1, 0, 2],
        rotation: 0,
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBeNull()
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([])
  })

  test('uses current elevator defaults for legacy elevators with no saved rotation', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test', 'elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: 'elevator',
        parentId: 'building_test',
        position: [3, 0, 4],
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [3, 0, 4],
        rotation: 0,
      },
    ])
  })

  test('resolves building-scoped elevators when legacy level parentId is missing', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test', 'elevator_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: null,
        children: [],
      },
      elevator_test: {
        id: 'elevator_test',
        type: 'elevator',
        parentId: 'building_test',
        position: [7, 0, 8],
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [7, 0, 8],
        rotation: 0,
      },
    ])
  })

  test('classifies and transforms polygon kinds (slab / ceiling / zone)', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: ['slab_test', 'zone_test'],
      },
      slab_test: {
        id: 'slab_test',
        type: 'slab',
        parentId: 'level_test',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
        holes: [
          [
            [0.5, 0.5],
            [1, 0.5],
            [1, 1],
          ],
        ],
      },
      zone_test: {
        id: 'zone_test',
        type: 'zone',
        parentId: 'level_test',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      },
      slab_elsewhere: {
        id: 'slab_elsewhere',
        type: 'slab',
        parentId: 'level_other',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.slab_test, 'level_test', nodes)).toBe('polygon')
    expect(classifyParticipant(nodes.zone_test, 'level_test', nodes)).toBe('polygon')
    // Not in the active level frame → excluded.
    expect(classifyParticipant(nodes.slab_elsewhere, 'level_test', nodes)).toBeNull()

    const { starts, links } = collectParticipants(['slab_test', 'zone_test'], nodes, 'level_test')
    expect(links).toEqual([])
    expect(starts).toEqual([
      {
        id: 'slab_test',
        kind: 'polygon',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
        holes: [
          [
            [0.5, 0.5],
            [1, 0.5],
            [1, 1],
          ],
        ],
      },
      {
        id: 'zone_test',
        kind: 'polygon',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        holes: null,
      },
    ])

    // Translate: every vertex (holes included) shifts; the hole-less zone's
    // patch never grows a `holes` field.
    const moved = translateGroupPatches(starts, [], 1, -2)
    expect(moved).toEqual([
      [
        'slab_test',
        {
          polygon: [
            [1, -2],
            [3, -2],
            [3, 0],
            [1, 0],
          ],
          holes: [
            [
              [1.5, -1.5],
              [2, -1.5],
              [2, -1],
            ],
          ],
        },
      ],
      [
        'zone_test',
        {
          polygon: [
            [1, -2],
            [2, -2],
            [2, -1],
          ],
        },
      ],
    ])

    // Rotate 90° in the atan2 x→z sense around the origin: (x, z) → (-z, x).
    const rotated = rotateGroupPatches(
      starts.filter((s) => s.id === 'zone_test'),
      [],
      { x: 0, z: 0 },
      Math.PI / 2,
    )
    expect(rotated).toHaveLength(1)
    const rotatedPolygon = (rotated[0]![1] as { polygon: [number, number][] }).polygon
    const expected = [
      [0, 0],
      [0, 1],
      [-1, 1],
    ]
    rotatedPolygon.forEach((point, i) => {
      expect(point[0]).toBeCloseTo(expected[i]![0]!)
      expect(point[1]).toBeCloseTo(expected[i]![1]!)
    })
  })

  test('polygon hosts carry their attached positioned children (ceiling items)', () => {
    const nodes = {
      building_test: { id: 'building_test', type: 'building', children: ['level_test'] },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: ['ceiling_test'],
      },
      ceiling_test: {
        id: 'ceiling_test',
        type: 'ceiling',
        parentId: 'level_test',
        children: ['item_lamp'],
        polygon: [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
      },
      item_lamp: {
        id: 'item_lamp',
        type: 'item',
        parentId: 'ceiling_test',
        position: [1, 2.4, 1],
        rotation: [0, 0.5, 0],
      },
    } as unknown as Record<string, AnyNode>

    // The lamp itself is not level-parented, so it is not an independent
    // participant — it rides its host ceiling.
    expect(classifyParticipant(nodes.item_lamp, 'level_test', nodes)).toBeNull()

    const { starts } = collectParticipants(['ceiling_test'], nodes, 'level_test')
    expect(starts.map((s) => s.id).sort()).toEqual(['ceiling_test', 'item_lamp'])

    const moved = translateGroupPatches(starts, [], 2, 1)
    const lampPatch = Object.fromEntries(moved).item_lamp as { position: [number, number, number] }
    expect(lampPatch.position).toEqual([3, 2.4, 2])
  })

  test('translate patches carry the snapshot rotation for vec3 and scalar kinds', () => {
    const { starts } = collectParticipants(
      ['item_chair', 'column_post'],
      placedNodes(),
      'level_test',
    )
    const patches = Object.fromEntries(translateGroupPatches(starts, [], 1, 2))

    expect(patches.item_chair).toEqual({ position: [2, 0, 5], rotation: [0, 0.5, 0] })
    expect(patches.column_post).toEqual({ position: [5, 0, 1], rotation: 1.25 })
  })

  test('a mid-drag rotation survives the next translate re-publish', () => {
    const { starts } = collectParticipants(
      ['item_chair', 'column_post'],
      placedNodes(),
      'level_test',
    )
    // What a mid-drag R does: turn the snapshots, then re-apply the live delta.
    const rotated = rotateGroupSnapshots(starts, [], { x: 0, z: 0 }, Math.PI / 2)
    const patches = Object.fromEntries(
      translateGroupPatches(rotated.starts, rotated.links, 1, 2),
    ) as Record<string, { position: number[]; rotation: number[] | number }>

    // Orbited 90° in the atan2 x→z sense ((x, z) → (-z, x)), then slid.
    expect(patches.item_chair!.position[0]).toBeCloseTo(-2)
    expect(patches.item_chair!.position[2]).toBeCloseTo(3)
    expect(patches.column_post!.position[0]).toBeCloseTo(2)
    expect(patches.column_post!.position[2]).toBeCloseTo(6)
    // …and the facings turned with it instead of reverting to the pre-drag yaw.
    expect((patches.item_chair!.rotation as number[])[1]).toBeCloseTo(0.5 - Math.PI / 2)
    expect(patches.column_post!.rotation as number).toBeCloseTo(1.25 - Math.PI / 2)
  })

  test('rotating the plan bounds keeps the footprint centred on the pivot', () => {
    const bounds = { minX: 0, minZ: 0, maxX: 4, maxZ: 2 }
    const [pivotX, pivotZ] = planBoundsCenter(bounds)
    const rotated = rotatePlanBounds(bounds, { x: pivotX, z: pivotZ }, Math.PI / 2)

    expect(rotated.minX).toBeCloseTo(1)
    expect(rotated.maxX).toBeCloseTo(3)
    expect(rotated.minZ).toBeCloseTo(-1)
    expect(rotated.maxZ).toBeCloseTo(3)
    expect(planBoundsCenter(rotated)[0]).toBeCloseTo(pivotX)
    expect(planBoundsCenter(rotated)[1]).toBeCloseTo(pivotZ)
  })

  test('supports legacy level-parented elevators already loaded in the editor', () => {
    const nodes = {
      building_test: {
        id: 'building_test',
        type: 'building',
        children: ['level_test'],
      },
      level_test: {
        id: 'level_test',
        type: 'level',
        parentId: 'building_test',
        children: ['elevator_test'],
      },
      elevator_test: {
        id: 'elevator_test',
        type: 'elevator',
        parentId: 'level_test',
        position: [5, 0, 6],
      },
    } as unknown as Record<string, AnyNode>

    expect(classifyParticipant(nodes.elevator_test, 'level_test', nodes)).toBe('scalar')
    expect(collectParticipants(['elevator_test'], nodes, 'level_test').starts).toEqual([
      {
        id: 'elevator_test',
        kind: 'scalar',
        position: [5, 0, 6],
        rotation: 0,
      },
    ])
  })
})
