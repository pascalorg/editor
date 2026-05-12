import { describe, expect, test } from 'bun:test'
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
