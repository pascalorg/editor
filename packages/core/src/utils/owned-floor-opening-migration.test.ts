import { expect, test } from 'bun:test'
import { CeilingNode, LevelNode, SlabNode, StairNode, StairSegmentNode } from '../schema'
import {
  materializeLegacyAutoOpenings,
  migrateOwnedFloorOpenings,
} from './owned-floor-opening-migration'

const polygon: [number, number][] = [
  [0, 0],
  [5, 0],
  [5, 5],
  [0, 5],
]
const hole: [number, number][] = [
  [1, 1],
  [2, 1],
  [2, 2],
  [1, 2],
]

test('load drops orphaned stair cuts on slabs and ceilings instead of adopting manual openings', () => {
  const level = LevelNode.parse({ id: 'level_legacy', level: 0 })
  const slab = SlabNode.parse({
    id: 'slab_legacy',
    parentId: level.id,
    polygon,
    holes: [hole],
    holeMetadata: [{ source: 'stair', stairId: 'stair_deleted' }],
  })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_legacy',
    parentId: level.id,
    polygon,
    holes: [hole],
    holeMetadata: [{ source: 'stair', stairId: 'stair_deleted' }],
  })
  const source = { [level.id]: level, [slab.id]: slab, [ceiling.id]: ceiling }
  const cleaned = materializeLegacyAutoOpenings(source, true)
  expect((cleaned[slab.id] as typeof slab).holes).toEqual([])
  expect((cleaned[ceiling.id] as typeof ceiling).holes).toEqual([])
  expect(migrateOwnedFloorOpenings(cleaned).changed).toBe(false)
  expect(materializeLegacyAutoOpenings(cleaned, true)).toBe(cleaned)
})

test('load syncs a legacy stair to its saved level rise when its old level links are stale', () => {
  const lower = LevelNode.parse({ id: 'level_lower', level: 0, height: 4.3 })
  const upper = LevelNode.parse({ id: 'level_upper', level: 1, height: 3 })
  const stair = StairNode.parse({
    id: 'stair_legacy',
    parentId: lower.id,
    position: [10, 0, 10],
    fromLevelId: 'level_removed',
    toLevelId: 'level_removed',
  })
  const flight = StairSegmentNode.parse({
    id: 'sseg_legacy',
    parentId: stair.id,
    height: 3.65,
    length: 4,
  })
  const slab = SlabNode.parse({
    id: 'slab_upper',
    parentId: upper.id,
    autoFromWalls: true,
    polygon,
  })
  lower.children = [stair.id]
  upper.children = [slab.id]
  stair.children = [flight.id]
  const source = Object.fromEntries(
    [lower, upper, stair, flight, slab].map((node) => [node.id, node]),
  )
  const loaded = materializeLegacyAutoOpenings(source, true)
  expect((loaded[flight.id] as typeof flight).height).toBeCloseTo(4.3)
  expect(materializeLegacyAutoOpenings(loaded, true)).toBe(loaded)
})
