import { afterEach, describe, expect, test } from 'bun:test'
import { nodeRegistry, registerNode } from '../../registry/registry'
import type { AnyNode } from '../../schema'
import { BuildingNode, CeilingNode, ElevatorNode, LevelNode, SlabNode } from '../../schema'
import { syncAutoElevatorOpenings } from './elevator-opening-sync'

describe('syncAutoElevatorOpenings', () => {
  test('does not add elevator holes when a manual surface hole already covers them', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const elevator = ElevatorNode.parse({
      name: 'Elevator',
      parentId: building.id,
      position: [2, 0, 1.5],
      width: 1.6,
      depth: 1.6,
    })
    const buildingWithChildren = {
      ...building,
      children: [ground.id, upper.id, elevator.id],
    }
    const manualOpening: Array<[number, number]> = [
      [1, 0.5],
      [3, 0.5],
      [3, 2.5],
      [1, 2.5],
    ]
    const sourceCeiling = CeilingNode.parse({
      name: 'Source Ceiling',
      parentId: ground.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [manualOpening],
      holeMetadata: [{ source: 'manual' }],
    })
    const upperSlab = SlabNode.parse({
      name: 'Upper Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [manualOpening],
      holeMetadata: [{ source: 'manual' }],
    })
    const nodes = Object.fromEntries(
      [buildingWithChildren, ground, upper, elevator, sourceCeiling, upperSlab].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<string, AnyNode>

    const updates = syncAutoElevatorOpenings(nodes)

    expect(updates.find((update) => update.id === upperSlab.id)).toBeUndefined()
    expect(updates.find((update) => update.id === sourceCeiling.id)).toBeUndefined()
  })

  test('adds elevator holes when an existing manual hole is too small', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const elevator = ElevatorNode.parse({
      name: 'Elevator',
      parentId: building.id,
      position: [2, 0, 1.5],
      width: 1.6,
      depth: 1.6,
    })
    const buildingWithChildren = {
      ...building,
      children: [ground.id, upper.id, elevator.id],
    }
    const smallManualOpening: Array<[number, number]> = [
      [1.7, 1.2],
      [2.3, 1.2],
      [2.3, 1.8],
      [1.7, 1.8],
    ]
    const upperSlab = SlabNode.parse({
      name: 'Upper Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [smallManualOpening],
      holeMetadata: [{ source: 'manual' }],
    })
    const nodes = Object.fromEntries(
      [buildingWithChildren, ground, upper, elevator, upperSlab].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const updates = syncAutoElevatorOpenings(nodes)
    const slabUpdate = updates.find((update) => update.id === upperSlab.id)

    expect(slabUpdate?.data.holes).toHaveLength(2)
    expect(slabUpdate?.data.holes?.[0]).toEqual(smallManualOpening)
    expect(slabUpdate?.data.holeMetadata).toEqual([
      { source: 'manual' },
      { source: 'elevator', elevatorId: elevator.id },
    ])
  })

  test('removes stale auto elevator holes when a manual hole overlaps the elevator opening', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const elevator = ElevatorNode.parse({
      name: 'Elevator',
      parentId: building.id,
      position: [2, 0, 1.5],
      width: 1.6,
      depth: 1.6,
    })
    const buildingWithChildren = {
      ...building,
      children: [ground.id, upper.id, elevator.id],
    }
    const manualOpening: Array<[number, number]> = [
      [1, 0.5],
      [3, 0.5],
      [3, 2.5],
      [1, 2.5],
    ]
    const staleAutoOpening: Array<[number, number]> = [
      [1.12, 0.62],
      [2.88, 0.62],
      [2.88, 2.38],
      [1.12, 2.38],
    ]
    const upperSlab = SlabNode.parse({
      name: 'Upper Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      holes: [manualOpening, staleAutoOpening],
      holeMetadata: [{ source: 'manual' }, { source: 'elevator', elevatorId: elevator.id }],
    })
    const nodes = Object.fromEntries(
      [buildingWithChildren, ground, upper, elevator, upperSlab].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const updates = syncAutoElevatorOpenings(nodes)
    const slabUpdate = updates.find((update) => update.id === upperSlab.id)

    expect(slabUpdate?.data.holes).toEqual([manualOpening])
    expect(slabUpdate?.data.holeMetadata).toEqual([{ source: 'manual' }])
  })
})

describe('verticalOpening capability', () => {
  /**
   * A kind that declares `verticalOpening` — the plugin case. Registered
   * through the registry, because that is where the sync looks: matching on
   * `type` was exactly the coupling that kept plugin kinds out.
   */
  function registerLiftKind() {
    registerNode({
      kind: 'test:lift',
      schemaVersion: 1,
      schema: {} as never,
      category: 'furnish',
      defaults: () => ({}) as never,
      capabilities: {
        verticalOpening: {
          polygon: (node) => {
            const [x, , z] = (node as { position: number[] }).position
            return [
              [x - 1, z - 1],
              [x + 1, z - 1],
              [x + 1, z + 1],
              [x - 1, z + 1],
            ]
          },
          // Serves every level it is asked about; the surface filter does the rest.
          servesLevel: () => true,
        },
      },
      presentation: { label: 'Lift', icon: { kind: 'iconify', name: 'lucide:square' } },
    } as never)
  }

  function sceneWithLift() {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const slab = SlabNode.parse({
      name: 'Slab',
      parentId: ground.id,
      polygon: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    })
    const lift = { id: 'lift_1', type: 'test:lift', parentId: ground.id, position: [0, 0, 0] }
    const nodes: Record<string, AnyNode> = {
      [building.id]: { ...building, children: [ground.id] } as AnyNode,
      [ground.id]: { ...ground, children: [slab.id, lift.id] } as AnyNode,
      [slab.id]: slab as AnyNode,
      [lift.id]: lift as unknown as AnyNode,
    }
    return { nodes, slabId: slab.id }
  }

  afterEach(() => {
    nodeRegistry._reset()
  })

  test('cuts a hole for a kind that declares the capability', () => {
    registerLiftKind()
    const { nodes, slabId } = sceneWithLift()

    const updates = syncAutoElevatorOpenings(nodes)
    const slabUpdate = updates.find((update) => update.id === slabId)

    expect(slabUpdate).toBeDefined()
    expect(slabUpdate?.data.holes).toHaveLength(1)
    expect(slabUpdate?.data.holeMetadata?.[0]).toMatchObject({
      source: 'verticalOpening',
      ownerId: 'lift_1',
    })
  })

  test('cuts nothing for the same node when the kind does not declare it', () => {
    // Same scene, kind registered without the capability.
    registerNode({
      kind: 'test:lift',
      schemaVersion: 1,
      schema: {} as never,
      category: 'furnish',
      defaults: () => ({}) as never,
      capabilities: {},
      presentation: { label: 'Lift', icon: { kind: 'iconify', name: 'lucide:square' } },
    } as never)
    const { nodes, slabId } = sceneWithLift()

    expect(syncAutoElevatorOpenings(nodes).find((u) => u.id === slabId)).toBeUndefined()
  })

  /**
   * The trap the shared `isAutoHoleSource` exists for: the preservation filter
   * used to be an open-coded `source !== 'elevator'`, which would have carried
   * a stale `verticalOpening` hole through as if the user had drawn it — the
   * hole would never be removed when the lift moved away.
   */
  test('replaces its own stale hole rather than preserving it as manual', () => {
    registerLiftKind()
    const { nodes, slabId } = sceneWithLift()
    const slab = nodes[slabId] as AnyNode & {
      holes: Array<Array<[number, number]>>
      holeMetadata: Array<{ source: string; ownerId?: string }>
    }
    // A hole this owner cut earlier, somewhere the lift no longer is.
    slab.holes = [
      [
        [5, 5],
        [7, 5],
        [7, 7],
        [5, 7],
      ],
    ]
    slab.holeMetadata = [{ source: 'verticalOpening', ownerId: 'lift_1' }]

    const update = syncAutoElevatorOpenings(nodes).find((u) => u.id === slabId)
    expect(update?.data.holes).toHaveLength(1)
    // The surviving hole is the one at the lift's current position, not the old one.
    expect(update?.data.holes?.[0]?.[0]).toEqual([-1, -1])
  })

  test("leaves the user's manual cutouts alone", () => {
    registerLiftKind()
    const { nodes, slabId } = sceneWithLift()
    const slab = nodes[slabId] as AnyNode & {
      holes: Array<Array<[number, number]>>
      holeMetadata: Array<{ source: string }>
    }
    slab.holes = [
      [
        [6, 6],
        [8, 6],
        [8, 8],
        [6, 8],
      ],
    ]
    slab.holeMetadata = [{ source: 'manual' }]

    const update = syncAutoElevatorOpenings(nodes).find((u) => u.id === slabId)
    // The manual hole plus the lift's, in that order.
    expect(update?.data.holes).toHaveLength(2)
    expect(update?.data.holeMetadata?.[0]?.source).toBe('manual')
    expect(update?.data.holeMetadata?.[1]?.source).toBe('verticalOpening')
  })

  /**
   * A level's slab and its ceiling sit at opposite ends of the level, so a
   * shaft crosses different sets of them: floors 1-3 means slabs 2 and 3 but
   * ceilings 1 and 2. Without the surface argument the kind answers one
   * question for both and is wrong at one end — here, sealing the ceiling
   * across the shaft or cutting the ceiling of the top floor.
   */
  test('lets the kind answer per surface', () => {
    registerNode({
      kind: 'test:lift',
      schemaVersion: 1,
      schema: {} as never,
      category: 'furnish',
      defaults: () => ({}) as never,
      capabilities: {
        verticalOpening: {
          polygon: () => [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ],
          servesLevel: (_node, _levelId, _nodes, surface) => surface === 'slab',
        },
      },
      presentation: { label: 'Lift', icon: { kind: 'iconify', name: 'lucide:square' } },
    } as never)

    const { nodes, slabId } = sceneWithLift()
    const ground = Object.values(nodes).find((node) => node.type === 'level')!
    const ceiling = CeilingNode.parse({
      name: 'Ceiling',
      parentId: ground.id,
      polygon: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    })
    nodes[ceiling.id] = ceiling as AnyNode

    const updates = syncAutoElevatorOpenings(nodes)

    expect(updates.find((u) => u.id === slabId)?.data.holes).toHaveLength(1)
    expect(updates.find((u) => u.id === ceiling.id)).toBeUndefined()
  })
})
