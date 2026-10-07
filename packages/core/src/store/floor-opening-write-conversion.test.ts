import { expect, test } from 'bun:test'
import { type AnyNode, FloorOpeningNode, SlabNode } from '../schema'
import { convertDerivedPlateHoleWrites, filterDerivedNodeWrites } from './derived-node-guard'

const square: [number, number][] = [
  [1, 1],
  [2, 1],
  [2, 2],
  [1, 2],
]
const moved: [number, number][] = [
  [2, 1],
  [3, 1],
  [3, 2],
  [2, 2],
]
const plate = SlabNode.parse({
  id: 'slab_write_base',
  parentId: 'level_write',
  boundary: 'auto',
  autoFromWalls: true,
  plateRole: 'base',
  polygon: [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ],
})

function writes(nodes: Record<string, AnyNode>, slab = plate) {
  return convertDerivedPlateHoleWrites(nodes, {
    update: [
      {
        id: slab.id,
        data: {
          holes: [square],
          holeMetadata: [{ source: 'manual' as const }],
        },
      },
    ],
  })
}

test('plate hole edits reuse and remove the opening node', () => {
  const opening = FloorOpeningNode.parse({
    id: 'floor-opening_write',
    parentId: plate.parentId,
    polygon: square,
    metadata: { plateHoleAuthoring: plate.id },
    cutsAdjacent: false,
  })
  const nodes = { [plate.id]: plate, [opening.id]: opening }
  const edited = convertDerivedPlateHoleWrites(nodes, {
    update: [{ id: plate.id, data: { holes: [moved], holeMetadata: [{ source: 'manual' }] } }],
  })
  expect(edited.create).toEqual([])
  expect(edited.update?.some((entry) => entry.id === opening.id && 'polygon' in entry.data)).toBe(
    true,
  )
  const removed = convertDerivedPlateHoleWrites(nodes, {
    update: [{ id: plate.id, data: { holes: [], holeMetadata: [] } }],
  })
  expect(removed.delete).toContain(opening.id)
})

test('pool spillover dedupes by owner and keeps stair holes on the same plate', () => {
  const sibling = SlabNode.parse({ ...plate, id: 'slab_write_platform', plateRole: 'platform' })
  const metadata = { poolManagedOpenings: [{ poolId: 'pool_write', polygon: square }] }
  const converted = convertDerivedPlateHoleWrites(
    { [plate.id]: plate, [sibling.id]: sibling },
    {
      update: [plate, sibling].map((slab) => ({
        id: slab.id,
        data: {
          holes: [square, moved],
          holeMetadata: [
            { source: 'manual' as const },
            { source: 'stair' as const, stairId: 'stair_write' },
          ],
          metadata,
        },
      })),
    },
  )
  expect(converted.create).toHaveLength(1)
  expect(converted.create?.[0]?.node).toMatchObject({
    source: 'plugin:pool',
    ownerId: 'pool_write',
    cutsAdjacent: false,
  })
  expect(converted.update?.[0]?.data.holeMetadata).toEqual([
    { source: 'stair', stairId: 'stair_write' },
  ])
  const existing = converted.create![0]!.node
  const duplicated = FloorOpeningNode.parse({
    ...existing,
    id: 'floor-opening_duplicate_pool',
  })
  const again = convertDerivedPlateHoleWrites(
    {
      [plate.id]: plate,
      [sibling.id]: sibling,
      [existing.id]: existing,
      [duplicated.id]: duplicated,
    },
    {
      update: [
        { id: plate.id, data: { holes: [square], holeMetadata: [{ source: 'manual' }], metadata } },
      ],
    },
  )
  expect(again.create).toEqual([])
  expect(again.delete).toHaveLength(1)
})

test('new stair and elevator holes pass through an existing floor opening', () => {
  const opening = FloorOpeningNode.parse({
    id: 'floor-opening_existing',
    parentId: plate.parentId,
    polygon: square,
  })
  const current = SlabNode.parse({
    ...plate,
    holes: [square],
    holeMetadata: [{ source: 'floor-opening', openingId: opening.id }],
  })
  for (const managed of [
    { source: 'stair' as const, stairId: 'stair_write' },
    { source: 'elevator' as const, elevatorId: 'elevator_write' },
  ]) {
    const changed = convertDerivedPlateHoleWrites(
      { [current.id]: current, [opening.id]: opening },
      {
        update: [
          {
            id: current.id,
            data: {
              holes: [square, moved],
              holeMetadata: [{ source: 'floor-opening', openingId: opening.id }, managed],
            },
          },
        ],
      },
    )
    expect(changed.update?.[0]?.data.holeMetadata).toHaveLength(2)
    expect(changed.delete).toBeUndefined()
  }
})

test('managed slab writes preserve an opening cut missing from their snapshot', () => {
  const opening = FloorOpeningNode.parse({
    id: 'floor-opening_preserved',
    parentId: plate.parentId,
    polygon: square,
  })
  const current = SlabNode.parse({
    ...plate,
    holes: [square],
    holeMetadata: [{ source: 'floor-opening', openingId: opening.id }],
  })
  const nodes = { [current.id]: current, [opening.id]: opening }
  for (const data of [
    { holes: [moved], holeMetadata: [{ source: 'stair' as const, stairId: 'stair_write' }] },
    {
      holes: [] as (typeof square)[],
      holeMetadata: [] as typeof current.holeMetadata,
      metadata: { poolManagedOpenings: [{ poolId: 'pool_write', polygon: moved }] },
    },
  ]) {
    const converted = convertDerivedPlateHoleWrites(nodes, {
      update: [{ id: current.id, data }],
    })
    expect(converted.delete ?? []).not.toContain(opening.id)
    expect(converted.update?.[0]?.data.holeMetadata).toContainEqual({
      source: 'floor-opening',
      openingId: opening.id,
    })
  }
})

test('pool metadata relabelling is a no-op for core-owned holes', () => {
  const opening = FloorOpeningNode.parse({
    id: 'floor-opening_pool_relabel',
    parentId: plate.parentId,
    polygon: square,
  })
  const current = SlabNode.parse({
    ...plate,
    holes: [square, moved],
    holeMetadata: [{ source: 'floor-opening', openingId: opening.id }, { source: 'room' }],
  })
  const nodes = { [current.id]: current, [opening.id]: opening }
  const converted = convertDerivedPlateHoleWrites(nodes, {
    update: [
      {
        id: current.id,
        data: {
          holes: [square, moved],
          holeMetadata: [{ source: 'manual' as const }, { source: 'manual' as const }],
          metadata: current.metadata,
        },
      },
    ],
  })
  expect(converted.create).toEqual([])
  expect(converted.delete ?? []).not.toContain(opening.id)
  expect(converted.update?.[0]?.data.holes).toBeUndefined()
  expect(converted.update?.[0]?.data.holeMetadata).toBeUndefined()
  expect(filterDerivedNodeWrites(nodes, converted).update).toEqual([])
})

test('pool geometry edits retain original opening, room, stair, and elevator tags', () => {
  const opening = FloorOpeningNode.parse({
    id: 'floor-opening_pool_geometry',
    parentId: plate.parentId,
    polygon: square,
  })
  const stair: [number, number][] = [
    [0, 2],
    [1, 2],
    [1, 3],
    [0, 3],
  ]
  const elevator: [number, number][] = [
    [2, 2],
    [3, 2],
    [3, 3],
    [2, 3],
  ]
  const pool: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  const holeMetadata = [
    { source: 'floor-opening' as const, openingId: opening.id },
    { source: 'room' as const },
    { source: 'stair' as const, stairId: 'stair_write' },
    { source: 'elevator' as const, elevatorId: 'elevator_write' },
  ]
  const current = SlabNode.parse({
    ...plate,
    holes: [square, moved, stair, elevator],
    holeMetadata,
  })
  const converted = convertDerivedPlateHoleWrites(
    { [current.id]: current, [opening.id]: opening },
    {
      update: [
        {
          id: current.id,
          data: {
            holes: [...current.holes, pool],
            holeMetadata: [
              ...current.holes.map(() => ({ source: 'manual' as const })),
              { source: 'manual' as const },
            ],
            metadata: { poolManagedOpenings: [{ poolId: 'pool_write', polygon: pool }] },
          },
        },
      ],
    },
  )
  expect(converted.create?.[0]?.node).toMatchObject({ source: 'plugin:pool' })
  expect(converted.delete ?? []).not.toContain(opening.id)
  expect(converted.update?.[0]?.data.holeMetadata).toEqual(holeMetadata)
})

test('legacy mezzanine plate hole authors a hosted, floor-only opening', () => {
  const mezzanine = SlabNode.parse({
    ...plate,
    id: 'slab_write_mezzanine',
    support: 'open',
    plateRole: undefined,
    zoneIds: ['zone_write_mezzanine'],
  })
  const converted = writes({ [mezzanine.id]: mezzanine }, mezzanine)
  expect(converted.create?.[0]?.node).toMatchObject({
    hostZoneId: 'zone_write_mezzanine',
    cutsAdjacent: false,
  })
})
