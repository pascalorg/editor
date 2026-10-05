import { beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  CeilingNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SlabNode,
  sceneRegistry,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { BoxGeometry, Group, Mesh } from 'three'
import { z } from 'zod'
import {
  classifyParticipant,
  collectParticipants,
  computeGroupPlanBox,
  groupPlanBounds,
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

describe('group plan bounds', () => {
  const withNodes = (nodes: AnyNode[], run: () => void) => {
    const saved = useScene.getState().nodes
    useScene.setState({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) as typeof saved })
    try {
      run()
    } finally {
      useScene.setState({ nodes: saved })
    }
  }

  test('a placed object measures its built mesh in the level frame, or falls back to its anchor', () => {
    const level = new Group()
    level.position.set(10, 0, -4)
    level.rotation.y = Math.PI / 5
    const item = new Mesh(new BoxGeometry(1, 1, 1))
    item.position.set(2, 0.5, 0)
    level.add(item)
    level.updateWorldMatrix(true, true)
    const registry = sceneRegistry.nodes as unknown as Map<string, unknown>
    registry.set('item_plan_bounds_test', item)
    const start = {
      id: 'item_plan_bounds_test' as AnyNodeId,
      kind: 'vec3' as const,
      position: [2, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
    }
    try {
      const frameInv = level.matrixWorld.clone().invert()
      const built = groupPlanBounds([start], frameInv)
      expect(built?.minX).toBeCloseTo(1.5)
      expect(built?.maxX).toBeCloseTo(2.5)
      expect(built?.minZ).toBeCloseTo(-0.5)
      expect(built?.maxZ).toBeCloseTo(0.5)
      // Unbuilt while the 3D scene is paused: the placeholder must not count.
      item.geometry.userData.placeholder = true
      expect(groupPlanBounds([start], frameInv)).toEqual({ minX: 2, minZ: 0, maxX: 2, maxZ: 0 })
    } finally {
      registry.delete('item_plan_bounds_test')
    }
  })

  test('hugs the selected wall outlines; a connected wall stays outside', () => {
    const level = LevelNode.parse({ children: [] })
    const bottom = WallNode.parse({
      parentId: level.id,
      start: [0, 0],
      end: [2.4, 0],
      thickness: 0.2,
    })
    const side = WallNode.parse({
      parentId: level.id,
      start: [2.4, 0],
      end: [2.4, 5.3],
      thickness: 0.2,
    })
    const neighbour = WallNode.parse({
      parentId: level.id,
      start: [2.4, 5.3],
      end: [8, 5.3],
      thickness: 0.2,
    })
    withNodes([level, bottom, side, neighbour], () => {
      const plan = computeGroupPlanBox([bottom.id, side.id], level.id)
      expect(plan?.minX).toBeCloseTo(0)
      expect(plan?.maxX).toBeCloseTo(2.5)
      expect(plan?.minZ).toBeCloseTo(-0.1)
      expect(plan?.maxZ).toBeLessThan(5.5)
      expect(plan?.maxX).toBeLessThan(8)
    })
  })

  test('two walls with the room floor and ceiling: the box is the drawn outlines, never the meshes', () => {
    // A user's selection whose box came out 13 m wide in 2D-only view.
    const level = LevelNode.parse({ id: 'level_vvkg048zziz9ktiy', children: [] })
    const room: [number, number][] = [
      [-3.6221682640435353, -9.037533979512114],
      [-6.21504662384804, -8.29671159099654],
      [-5.712152486161543, -6.5365821090938],
      [-5.712152486161543, -5],
      [-8.223564365687542, -5],
      [-8.223564365687542, -6.5365821090938],
      [-10.712152486161543, -6.5365821090938],
      [-11.712152486161543, -8.5365821090938],
      [-4.119274126357038, -10.777404497609373],
    ]
    const wall15 = WallNode.parse({
      parentId: level.id,
      start: [-10.712152486161543, -6.5365821090938],
      end: [-11.712152486161543, -8.5365821090938],
    })
    const wall12 = WallNode.parse({
      parentId: level.id,
      start: [-11.712152486161543, -8.5365821090938],
      end: [-6.712152486161543, -10.0365821090938],
    })
    const slab = SlabNode.parse({ parentId: level.id, polygon: room, elevation: 0.05 })
    const ceiling = CeilingNode.parse({ parentId: level.id, polygon: room, height: 2.49 })
    withNodes([level, wall15, wall12, slab, ceiling], () => {
      const plan = computeGroupPlanBox([wall15.id, ceiling.id, slab.id, wall12.id], level.id)!
      expect(plan.minX).toBeLessThan(-11.71)
      expect(plan.minX).toBeGreaterThan(-11.95)
      expect(plan.maxX).toBeCloseTo(-3.62, 1)
      expect(plan.minZ).toBeCloseTo(-10.78, 1)
      expect(plan.maxZ).toBeCloseTo(-5, 1)
      expect(plan.maxX - plan.minX).toBeLessThan(8.4)
    })
  })
})
