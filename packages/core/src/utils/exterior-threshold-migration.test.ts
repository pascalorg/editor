import { describe, expect, test } from 'bun:test'
import {
  computePlateSurfacePartition,
  plateLevelContext,
  plateOpeningLandings,
} from '../lib/plate-surface'
import { area, containsPoint, intersection, union } from '../lib/polygon-boolean'
import { roomFloorPlate } from '../lib/room-floor-plate'
import { type AnyNode, DoorNode, type SlabNode, type ZoneNode } from '../schema'
import useScene from '../store/use-scene'
import { doorwayStepsFixture } from '../systems/slab/__fixtures__/doorway-steps'
import { migrateExteriorThresholds } from './exterior-threshold-migration'
import { normalizeLegacyStructure } from './normalize-legacy-structure'
import { reconcileStructureWithStableIds } from './structure-id'

const WOOD = 'library:wood-woodplank48'
const TILE = 'library:flooring-tiles3'
const RED = 'library:paint-red'

function fixture(
  kind: 'door' | 'opening' = 'door',
  elevations: [number, number, number] = [0.05, 0.05, 0.05],
) {
  const nodes = doorwayStepsFixture(elevations)
  const wall = nodes.wall_row_0!
  const door = DoorNode.parse({
    parentId: wall.id,
    openingKind: kind,
    width: 1,
    height: 2,
    position: [2, 1, 0],
  })
  nodes[wall.id] = { ...wall, children: [door.id] } as AnyNode
  nodes[door.id] = door
  nodes.zone_a = {
    ...nodes.zone_a,
    floor: { ...(nodes.zone_a as ZoneNode).floor, finish: TILE },
  } as ZoneNode
  const plate = roomFloorPlate(
    Object.values(nodes).filter((n): n is SlabNode => n.type === 'slab'),
    'zone_a',
  )!
  nodes[plate.id] = { ...plate, slots: { surface: WOOD } }
  return { nodes, door, plate }
}
function context(nodes: Record<string, AnyNode>) {
  return plateLevelContext(nodes.level_row!, (id) => nodes[id])
}
function cellAt(nodes: Record<string, AnyNode>, point: [number, number]) {
  return context(nodes)
    .slabs.flatMap((plate) => computePlateSurfacePartition(plate, context(nodes))?.cells ?? [])
    .find((cell) => containsPoint(cell.polygons, point))!
}
function legacy(nodes: Record<string, AnyNode>) {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => {
      if (node.type !== 'door' && node.type !== 'window') return [id, node]
      const { floorThresholdVersion: _version, ...old } = node
      return [id, old]
    }),
  )
}

describe('exterior threshold ownership and load parity', () => {
  test('client parsing retains legacy provenance and reload preserves the migrated paint', () => {
    const { nodes, door } = fixture()
    const saved = legacy(nodes)
    const normalized = normalizeLegacyStructure(saved)
    expect(DoorNode.parse(normalized[door.id]).floorThresholdVersion).toBe(0)
    const previous = useScene.getState()
    try {
      useScene.getState().setScene(saved as Record<string, AnyNode>, ['level_row'])
      const loaded = useScene.getState().nodes
      expect(cellAt(loaded, [2, -0.05]).finish).toBe(WOOD)
      expect(cellAt(loaded, [2, -0.05]).role).toStartWith('room:zone_a/threshold:')
      useScene.getState().setScene(JSON.parse(JSON.stringify(loaded)), ['level_row'])
      expect((useScene.getState().nodes.zone_a as ZoneNode).floor).toEqual(
        (loaded.zone_a as ZoneNode).floor,
      )
    } finally {
      useScene.setState(previous)
      useScene.temporal.getState().clear()
    }
  })
  test('raw pre-plate scenes preserve the original slab finish, not a merged plate fallback', () => {
    const { nodes, plate } = fixture()
    const saved = legacy(nodes)
    const { plateRole: _role, ...oldSlab } = plate
    saved[plate.id] = { ...oldSlab, slots: { surface: RED } }
    const migrated = migrateExteriorThresholds(nodes, saved)
    expect(cellAt(migrated, [2, -0.05]).finish).toBe(RED)
    expect(cellAt(migrated, [2, 1]).finish).toBe(TILE)
  })
  test.each([
    'door',
    'opening',
  ] as const)('%s belongs to the sole room across the full wall thickness', (kind) => {
    const { nodes } = fixture(kind)
    for (const z of [-0.09, 0, 0.09]) {
      expect(cellAt(nodes, [2, z]).role).toBe('room:zone_a')
      expect(cellAt(nodes, [2, z]).finish).toBe(TILE)
    }
    expect(cellAt(nodes, [3, 0]).role).toBe('surface')
  })
  test('painted regions extend through the strip and later regions win', () => {
    const { nodes } = fixture()
    const zone = nodes.zone_a as ZoneNode
    nodes.zone_a = {
      ...zone,
      floor: {
        ...zone.floor,
        regions: [
          {
            id: 'paint',
            finish: RED,
            polygon: [
              [1.5, -0.1],
              [2, -0.1],
              [2, 1],
              [1.5, 1],
            ],
          },
        ],
      },
    }
    expect(cellAt(nodes, [1.75, -0.05]).role).toBe('room:zone_a/paint')
    expect(cellAt(nodes, [1.75, -0.05]).finish).toBe(RED)
    expect(cellAt(nodes, [2.25, -0.05]).finish).toBe(TILE)
  })
  test('interior equal-height ownership and higher-room step ownership are unchanged', () => {
    for (const elevations of [
      [0.05, 0.05, 0.05],
      [0.05, 0.3, 0.05],
      [0.05, -0.3, 0.05],
      [0.3, 0.05, 0.05],
      [-0.3, 0.05, 0.05],
    ] as [number, number, number][]) {
      const before = doorwayStepsFixture(elevations)
      const { nodes, door } = fixture('door', elevations)
      const interior = (ns: Record<string, AnyNode>) =>
        plateOpeningLandings(context(ns)).filter((l) => l.openingId !== door.id)
      expect(interior(nodes)).toEqual(interior(before))
      const reconciled = reconcileStructureWithStableIds({ nodes }).nodes
      for (const plate of Object.values(nodes).filter((n): n is SlabNode => n.type === 'slab')) {
        const after = reconciled[plate.id] as SlabNode
        expect(after.polygon).toEqual(plate.polygon)
        expect(after.elevation).toBe(plate.elevation)
      }
    }
  })
  test('legacy finish becomes an exact room region, survives reload and is repaintable', () => {
    const { nodes, door } = fixture()
    const saved = JSON.stringify(nodes)
    const migrated = migrateExteriorThresholds(nodes, legacy(nodes))
    expect(JSON.stringify(nodes)).toBe(saved)
    const cell = cellAt(migrated, [2, -0.05])
    expect(cell.role).toStartWith('room:zone_a/threshold:')
    expect(cell.finish).toBe(WOOD)
    expect(cellAt(migrated, [2, 1]).finish).toBe(TILE)
    const zone = migrated.zone_a as ZoneNode
    const landing = plateOpeningLandings(context(nodes)).find((l) => l.openingId === door.id)!
    expect(area(union(zone.floor!.regions!.map((r) => r.polygon)))).toBeCloseTo(
      area(landing.polygons),
      6,
    )
    expect(migrateExteriorThresholds(migrated)).toBe(migrated)
    const repainted = {
      ...migrated,
      zone_a: {
        ...zone,
        floor: { ...zone.floor, regions: zone.floor!.regions!.map((r) => ({ ...r, finish: RED })) },
      },
    }
    expect(cellAt(migrateExteriorThresholds(repainted), [2, -0.05]).finish).toBe(RED)
    const cleared = { ...migrated, zone_a: { ...zone, floor: { finish: TILE } } }
    expect(cellAt(migrateExteriorThresholds(cleared), [2, -0.05]).finish).toBe(TILE)
  })
  test('new openings never acquire legacy regions, including on first reload', () => {
    const { nodes } = fixture()
    expect(migrateExteriorThresholds(nodes)).toBe(nodes)
    expect(cellAt(nodes, [2, -0.05]).finish).toBe(TILE)
  })
  test('matching finishes need no region and plate holes remain unpainted', () => {
    const { nodes, plate } = fixture()
    nodes[plate.id] = { ...plate, slots: { surface: TILE } }
    expect(
      (migrateExteriorThresholds(nodes, legacy(nodes)).zone_a as ZoneNode).floor?.regions,
    ).toBeUndefined()
    const hole: [number, number][] = [
      [1.8, -0.05],
      [2.2, -0.05],
      [2.2, 0.05],
      [1.8, 0.05],
    ]
    nodes[plate.id] = { ...plate, slots: { surface: WOOD }, holes: [hole] }
    const migrated = migrateExteriorThresholds(nodes, legacy(nodes))
    const regions = (migrated.zone_a as ZoneNode).floor!.regions!
    expect(area(intersection(union(regions.map((r) => r.polygon)), hole))).toBe(0)
    expect(area(union(regions.map((r) => r.polygon)))).toBeCloseTo(0.16, 5)
  })
  test('wall-anchored raised openings do not claim a floor strip', () => {
    const { nodes, door } = fixture()
    nodes[door.id] = { ...door, verticalAnchor: 'wall', position: [2, 2, 0] }
    expect(cellAt(nodes, [2, 0]).role).toBe('surface')
  })
})
