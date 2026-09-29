import { expect, test } from 'bun:test'
import { duplicateZone } from '../commands/structure/duplicate-zone'
import { cutFloorOpening, removeFloorOpening } from '../commands/structure/floor-opening'
import { applyToScratch, structureChangeBatch } from '../commands/structure/shared'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  SeparatorNode,
  SlabNode,
  StairNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { cloneLevelSubtree } from '../utils/clone-scene-graph'
import { migrateFloorOpeningNodes } from '../utils/floor-opening-migration'
import { reconcileStructureOnLoad } from '../utils/reconcile-structure-on-load'
import { area, union } from './polygon-boolean'
import { reconcileSceneStructure } from './structure-reconcile'

const outline: [number, number][] = [
  [0, 0],
  [6, 0],
  [6, 5],
  [0, 5],
]
const aperture: [number, number][] = [
  [2, 2],
  [3, 2],
  [3, 3],
  [2, 3],
]
const mintId = (() => {
  let n = 0
  return (kind: string) => `${kind}_test_${n++}`
})()

function house() {
  const building = BuildingNode.parse({ id: 'building_openings' })
  const levels = [0, 1].map((number) => {
    const id = `level_openings_${number}`
    const walls = outline.map((start, index) =>
      WallNode.parse({
        id: `wall_openings_${number}_${index}`,
        parentId: id,
        start,
        end: outline[(index + 1) % 4],
      }),
    )
    const level = LevelNode.parse({
      id,
      parentId: building.id,
      level: number,
      children: walls.map((wall) => wall.id),
    })
    return [level, ...walls]
  })
  const nodes = Object.fromEntries([building, ...levels.flat()].map((node) => [node.id, node]))
  return reconcileSceneStructure({ nodes, mintId }).nodes
}

function surface(nodes: Record<string, AnyNode>, levelId: string, kind: 'slab' | 'ceiling') {
  return Object.values(nodes).find((node) => node.type === kind && node.parentId === levelId) as
    | Extract<AnyNode, { type: typeof kind }>
    | undefined
}

test('one floor opening cuts the upper plate and the lower ceiling, then restores both', () => {
  const before = house()
  const plan = cutFloorOpening(before, { levelId: 'level_openings_1', polygon: aperture, mintId })
  const next = reconcileSceneStructure({
    nodes: applyToScratch(before, structureChangeBatch(plan.changes)),
    mintId,
  }).nodes
  const upper = surface(next, 'level_openings_1', 'slab')!
  const lower = surface(next, 'level_openings_0', 'ceiling')!
  const ownCeiling = surface(next, 'level_openings_1', 'ceiling')!
  expect(upper.holeMetadata.some((entry) => entry.openingId === plan.openingIds[0])).toBe(true)
  expect(lower.holeMetadata.some((entry) => entry.openingId === plan.openingIds[0])).toBe(true)
  expect(ownCeiling.holeMetadata.some((entry) => entry.openingId === plan.openingIds[0])).toBe(
    false,
  )
  expect(reconcileSceneStructure({ nodes: next, mintId }).patches).toEqual([])
  const removed = removeFloorOpening(next, plan.openingIds[0]!)
  const restored = reconcileSceneStructure({
    nodes: applyToScratch(next, structureChangeBatch(removed.changes)),
    mintId,
  }).nodes
  expect(
    surface(restored, 'level_openings_1', 'slab')?.holeMetadata.some(
      (entry) => entry.source === 'floor-opening',
    ),
  ).toBe(false)
  expect(
    surface(restored, 'level_openings_0', 'ceiling')?.holeMetadata.some(
      (entry) => entry.source === 'floor-opening',
    ),
  ).toBe(false)
  expect(reconcileSceneStructure({ nodes: restored, mintId }).patches).toEqual([])
})

test('ceiling-only top storey leaves the floor unchanged', () => {
  const before = house()
  const plan = cutFloorOpening(before, {
    levelId: 'level_openings_1',
    polygon: aperture,
    drawnOn: 'ceiling',
    mintId,
  })
  const next = reconcileSceneStructure({
    nodes: applyToScratch(before, structureChangeBatch(plan.changes)),
    mintId,
  }).nodes
  expect(plan.openingIds).toHaveLength(1)
  expect(
    surface(next, 'level_openings_1', 'ceiling')?.holeMetadata.some(
      (entry) => entry.source === 'floor-opening',
    ),
  ).toBe(true)
  expect(
    surface(next, 'level_openings_1', 'slab')?.holeMetadata.some(
      (entry) => entry.source === 'floor-opening',
    ),
  ).toBe(false)
})

test('ceiling-drawn opening cuts that ceiling and the floor above', () => {
  const before = house()
  const plan = cutFloorOpening(before, {
    levelId: 'level_openings_0',
    polygon: aperture,
    drawnOn: 'ceiling',
    mintId,
  })
  const next = reconcileSceneStructure({
    nodes: applyToScratch(before, structureChangeBatch(plan.changes)),
    mintId,
  }).nodes
  const id = plan.openingIds[0]
  expect(
    surface(next, 'level_openings_0', 'ceiling')?.holeMetadata.some(
      (entry) => entry.openingId === id,
    ),
  ).toBe(true)
  expect(
    surface(next, 'level_openings_1', 'slab')?.holeMetadata.some((entry) => entry.openingId === id),
  ).toBe(true)
  expect(
    surface(next, 'level_openings_0', 'slab')?.holeMetadata.some((entry) => entry.openingId === id),
  ).toBe(false)
})

test('manual ceiling below is left whole and reported as a hint', () => {
  const before = house()
  const ceiling = surface(before, 'level_openings_0', 'ceiling')!
  const manual = { ...ceiling, boundary: undefined, autoFromWalls: false }
  const nodes = { ...before, [ceiling.id]: manual } as Record<string, AnyNode>
  const plan = cutFloorOpening(nodes, { levelId: 'level_openings_1', polygon: aperture, mintId })
  expect(plan.hints).toEqual([
    expect.objectContaining({ code: 'manual-ceiling', surfaceIds: [ceiling.id] }),
  ])
  const next = reconcileSceneStructure({
    nodes: applyToScratch(nodes, structureChangeBatch(plan.changes)),
    mintId,
  }).nodes
  expect((next[ceiling.id] as Extract<AnyNode, { type: 'ceiling' }>).holes).toEqual(ceiling.holes)
  expect(
    surface(next, 'level_openings_1', 'slab')?.holeMetadata.some(
      (entry) => entry.source === 'floor-opening',
    ),
  ).toBe(true)
})

test('mezzanine hatch cuts only its hosted plate', () => {
  const before = house()
  const host = Object.values(before).find(
    (node) => node.type === 'zone' && node.parentId === 'level_openings_0',
  )!
  if (host.type !== 'zone') throw Error('missing host')
  const mezz = ZoneNode.parse({
    id: 'zone_openings_mezzanine',
    parentId: host.parentId,
    hostZoneId: host.id,
    name: 'Mezzanine',
    spaceRole: 'room',
    polygon: [
      [1, 1],
      [4, 1],
      [4, 4],
      [1, 4],
    ],
    floor: { support: 'open', elevation: 1.4, thickness: 0.2 },
  })
  const level = before[host.parentId!] as Extract<AnyNode, { type: 'level' }>
  const withMezz = reconcileSceneStructure({
    nodes: {
      ...before,
      [mezz.id]: mezz,
      [level.id]: { ...level, children: [...level.children, mezz.id] },
    },
    mintId,
  }).nodes
  const unhosted = cutFloorOpening(withMezz, {
    levelId: level.id,
    polygon: aperture,
    mintId,
  })
  const throughBase = reconcileSceneStructure({
    nodes: applyToScratch(withMezz, structureChangeBatch(unhosted.changes)),
    mintId,
  }).nodes
  expect(
    Object.values(throughBase)
      .filter((node) => node.type === 'slab' && node.support === 'open')
      .some((node) =>
        node.holeMetadata.some((entry) => entry.openingId === unhosted.openingIds[0]),
      ),
  ).toBe(false)
  const plan = cutFloorOpening(withMezz, { zoneId: mezz.id, polygon: aperture, mintId })
  const next = reconcileSceneStructure({
    nodes: applyToScratch(withMezz, structureChangeBatch(plan.changes)),
    mintId,
  }).nodes
  expect(
    (next[plan.openingIds[0]!] as Extract<AnyNode, { type: 'floor-opening' }>).hostZoneId,
  ).toBe(mezz.id)
  expect(
    Object.values(next)
      .filter((node) => node.type === 'slab' && node.support === 'open')
      .some((node) => node.holeMetadata.some((entry) => entry.openingId === plan.openingIds[0])),
  ).toBe(true)
  expect(
    Object.values(next)
      .filter((node) => node.type === 'slab' && node.plateRole === 'base')
      .some((node) => node.holeMetadata.some((entry) => entry.openingId === plan.openingIds[0])),
  ).toBe(false)
  expect(
    surface(next, 'level_openings_0', 'ceiling')?.holeMetadata.some(
      (entry) => entry.openingId === plan.openingIds[0],
    ),
  ).toBe(false)
  const cloned = cloneLevelSubtree(next as Record<never, AnyNode>, level.id)
  const copy = cloned.clonedNodes.find((node) => node.type === 'floor-opening')
  expect(copy).toMatchObject({ hostZoneId: cloned.idMap.get(mezz.id) })
  expect(
    cloned.clonedNodes
      .filter((node) => node.type === 'slab')
      .some((node) => node.holeMetadata.some((entry) => entry.openingId === copy?.id)),
  ).toBe(true)
})

test('room divide preserves an opening identity and its cut', () => {
  const before = house()
  const plan = cutFloorOpening(before, { levelId: 'level_openings_1', polygon: aperture, mintId })
  const opened = reconcileSceneStructure({
    nodes: applyToScratch(before, structureChangeBatch(plan.changes)),
    mintId,
  }).nodes
  const separator = SeparatorNode.parse({
    id: 'separator_openings_divide',
    parentId: 'level_openings_1',
    start: [4, 0],
    end: [4, 5],
  })
  const level = opened['level_openings_1'] as Extract<AnyNode, { type: 'level' }>
  const divided = reconcileSceneStructure({
    nodes: {
      ...opened,
      [separator.id]: separator,
      [level.id]: { ...level, children: [...level.children, separator.id] },
    },
    mintId,
  }).nodes
  expect(divided[plan.openingIds[0]!] as AnyNode).toEqual(opened[plan.openingIds[0]!])
  expect(
    Object.values(divided)
      .filter((node) => node.type === 'slab' && node.parentId === level.id)
      .some((node) => node.holeMetadata.some((entry) => entry.openingId === plan.openingIds[0])),
  ).toBe(true)
})

test('legacy manual plate holes adopt deterministic nodes and load idempotently', () => {
  const before = house()
  const plate = surface(before, 'level_openings_1', 'slab') as SlabNode
  const source = {
    ...before,
    [plate.id]: {
      ...plate,
      holes: [...plate.holes, aperture],
      holeMetadata: [...plate.holeMetadata, { source: 'manual' as const }],
    },
  }
  const lowerCeiling = surface(source, 'level_openings_0', 'ceiling')!
  const first = migrateFloorOpeningNodes(source)
  expect(first.created).toBe(1)
  expect(migrateFloorOpeningNodes(first.nodes).changed).toBe(false)
  const loaded = reconcileStructureOnLoad(source).nodes
  const adopted = Object.values(loaded).filter((node) => node.type === 'floor-opening')
  expect(adopted).toHaveLength(1)
  expect(adopted[0]).toMatchObject({
    cutsAdjacent: false,
    legacyPlateCuts: { [plate.id]: [aperture] },
  })
  expect(surface(loaded, 'level_openings_0', 'ceiling')).toEqual(lowerCeiling)
  expect(area(union(surface(loaded, 'level_openings_1', 'slab')!.holes))).toBeCloseTo(1)
  const removed = removeFloorOpening(loaded, adopted[0]!.id)
  const restored = reconcileSceneStructure({
    nodes: applyToScratch(loaded, structureChangeBatch(removed.changes)),
    mintId,
  }).nodes
  expect(area(union(surface(restored, 'level_openings_1', 'slab')!.holes))).toBe(0)
  expect(reconcileStructureOnLoad(loaded).nodes).toEqual(loaded)
  expect(reconcileSceneStructure({ nodes: loaded, mintId }).patches).toEqual([])
  expect(area([{ outer: aperture, holes: [] }])).toBe(1)
})

test('legacy cuts retain their original plate layer and ignore tiny fragments', () => {
  const before = house()
  const base = surface(before, 'level_openings_1', 'slab') as SlabNode
  const platform = SlabNode.parse({
    ...base,
    id: 'slab_legacy_platform_only',
    plateRole: 'platform',
    elevation: 0.45,
    holes: [
      aperture,
      [
        [0, 0],
        [0.001, 0],
        [0, 0.001],
      ],
    ],
    holeMetadata: [{ source: 'manual' }, { source: 'manual' }],
  })
  const migrated = migrateFloorOpeningNodes({ ...before, [platform.id]: platform })
  const adopted = Object.values(migrated.nodes).filter(
    (node): node is Extract<AnyNode, { type: 'floor-opening' }> =>
      (node as AnyNode).type === 'floor-opening',
  )
  expect(adopted).toHaveLength(1)
  expect(adopted[0]!.legacyPlateCuts).toEqual({ [platform.id]: [aperture] })
  expect(adopted[0]!.legacyPlateCuts?.[base.id]).toBeUndefined()
})

test('legacy floor and matching lower ceiling hole adopt one linked void', () => {
  const before = house()
  const plate = surface(before, 'level_openings_1', 'slab') as SlabNode
  const ceiling = surface(before, 'level_openings_0', 'ceiling')!
  const source = {
    ...before,
    [plate.id]: {
      ...plate,
      holes: [...plate.holes, aperture],
      holeMetadata: [...plate.holeMetadata, { source: 'manual' as const }],
    },
    [ceiling.id]: {
      ...ceiling,
      holes: [...ceiling.holes, aperture],
      holeMetadata: [...ceiling.holeMetadata, { source: 'manual' as const }],
    },
  }
  const loaded = reconcileStructureOnLoad(source).nodes
  const opening = Object.values(loaded).find((node) => node.type === 'floor-opening')!
  expect(opening.type).toBe('floor-opening')
  if (opening.type !== 'floor-opening') return
  expect(opening.cutsAdjacent).toBe(true)
  const lower = surface(loaded, 'level_openings_0', 'ceiling')!
  expect(lower.holes).toHaveLength(1)
  expect(lower.holeMetadata).toContainEqual(
    expect.objectContaining({ source: 'floor-opening', openingId: opening.id }),
  )
  expect(reconcileSceneStructure({ nodes: loaded, mintId }).patches).toEqual([])
})

test('a strip produces separate valid ceiling components and an edge notch keeps its opening link', () => {
  const before = house()
  const strip = cutFloorOpening(before, {
    levelId: 'level_openings_1',
    polygon: [
      [2.5, -1],
      [3.5, -1],
      [3.5, 6],
      [2.5, 6],
    ],
    mintId,
  })
  const split = reconcileSceneStructure({
    nodes: applyToScratch(before, structureChangeBatch(strip.changes)),
    mintId,
  }).nodes
  const ceilings = Object.values(split).filter(
    (node) => node.type === 'ceiling' && node.parentId === 'level_openings_0',
  )
  expect(ceilings).toHaveLength(2)
  expect(ceilings.every((ceiling) => ceiling.holes.length === 0)).toBe(true)
  expect(ceilings.every((ceiling) => ceiling.openingIds?.includes(strip.openingIds[0]!))).toBe(true)
  expect(reconcileSceneStructure({ nodes: split, mintId }).patches).toEqual([])

  const notch = cutFloorOpening(before, {
    levelId: 'level_openings_1',
    polygon: [
      [0, 2],
      [1.5, 2],
      [1.5, 3],
      [0, 3],
    ],
    mintId,
  })
  const notched = reconcileSceneStructure({
    nodes: applyToScratch(before, structureChangeBatch(notch.changes)),
    mintId,
  }).nodes
  expect(surface(notched, 'level_openings_0', 'ceiling')?.openingIds).toContain(notch.openingIds[0])
})

test('deleting a stair retires its owned opening and restores the surfaces', () => {
  const before = house()
  const stair = StairNode.parse({
    id: 'stair_owned_opening',
    parentId: 'level_openings_0',
    fromLevelId: 'level_openings_0',
    toLevelId: 'level_openings_1',
  })
  const first = { ...before, [stair.id]: stair }
  const plan = cutFloorOpening(first, {
    levelId: 'level_openings_1',
    polygon: aperture,
    source: 'stair',
    ownerId: stair.id,
    mintId,
  })
  const withStair = reconcileSceneStructure({
    nodes: applyToScratch(first, structureChangeBatch(plan.changes)),
    mintId,
  }).nodes
  expect(withStair[plan.openingIds[0]!]?.type).toBe('floor-opening')
  const withoutStair = { ...withStair }
  delete withoutStair[stair.id]
  const restored = reconcileSceneStructure({ nodes: withoutStair, mintId }).nodes
  expect(restored[plan.openingIds[0]!]).toBeUndefined()
  expect(surface(restored, 'level_openings_1', 'slab')?.holeMetadata).not.toContainEqual(
    expect.objectContaining({ openingId: plan.openingIds[0] }),
  )
  expect(reconcileSceneStructure({ nodes: restored, mintId }).patches).toEqual([])
})

test('duplicating a room clears an uncopied pool owner reference', () => {
  const before = house()
  const plan = cutFloorOpening(before, {
    levelId: 'level_openings_1',
    polygon: aperture,
    source: 'plugin:pool',
    ownerId: 'pool_original',
    mintId,
  })
  const opened = reconcileSceneStructure({
    nodes: applyToScratch(before, structureChangeBatch(plan.changes)),
    mintId,
  }).nodes
  const zone = Object.values(opened).find(
    (node) => node.type === 'zone' && node.parentId === 'level_openings_1',
  )!
  const copied = duplicateZone(opened, { zoneId: zone.id, translate: [10, 0], mintId })
  const cloned = copied.changes.find(
    (change) => change.op === 'create' && change.node.type === 'floor-opening',
  )
  expect(cloned?.op).toBe('create')
  if (cloned?.op === 'create' && cloned.node.type === 'floor-opening') {
    expect(cloned.node.source).toBe('manual')
    expect(cloned.node.ownerId).toBeUndefined()
  }
})

test('legacy pool ownership migrates onto its opening node', () => {
  const before = house()
  const plate = surface(before, 'level_openings_0', 'slab') as SlabNode
  const source = {
    ...before,
    [plate.id]: {
      ...plate,
      holes: [...plate.holes, aperture],
      holeMetadata: [...plate.holeMetadata, { source: 'manual' as const }],
      metadata: {
        ...plate.metadata,
        poolManagedOpenings: [
          { poolId: 'pool_legacy', polygon: aperture, holeIndex: plate.holes.length },
        ],
      },
    },
  }
  const migrated = migrateFloorOpeningNodes(source)
  const opening = Object.values(migrated.nodes).find(
    (node) => (node as AnyNode).type === 'floor-opening',
  ) as Extract<AnyNode, { type: 'floor-opening' }>
  expect(opening).toMatchObject({ source: 'plugin:pool', ownerId: 'pool_legacy' })
  expect(migrateFloorOpeningNodes(migrated.nodes).changed).toBe(false)
})
