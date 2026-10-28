import { expect, test } from 'bun:test'
import { buildingFoundationRecordOf } from '../lib/building-foundation'
import { floorPlateAtGroundContact, upperFloorHeightControl } from '../lib/floor-foundation-datum'
import { designedFoundationReport } from '../lib/generic-foundation'
import { FLAT_GROUND_Y } from '../lib/site-ground-height'
import { encodeTerrainField } from '../lib/terrain-codec'
import { createTerrainField } from '../lib/terrain-field'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { levelFloorWorldY } from '../services/storey'
import { buildBuildingFoundationChanges } from './foundation'

const IN = 0.0254
type Nodes = Record<AnyNodeId, AnyNode>

/** The site's ground `height` metres up everywhere around the house. */
function raisedGround(height: number) {
  const field = createTerrainField({ cols: 33, rows: 33, spacing: 1, origin: [-16, -16] })
  return encodeTerrainField({
    ...field,
    heights: new Int16Array(field.heights).fill(Math.round(height * 100)),
  })
}

function house(): Nodes {
  const corners: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_g_${index}`,
      parentId: 'level_g',
      start,
      end: corners[(index + 1) % 4],
      thickness: 0.15,
    }),
  )
  const nodes = [
    SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
    BuildingNode.parse({
      id: 'building_a',
      parentId: 'site_a',
      children: ['level_g'],
      metadata: { foundation: { type: 'raised', ffAboveGradeIn: 18, source: 'add_foundation' } },
    }),
    LevelNode.parse({
      id: 'level_g',
      parentId: 'building_a',
      level: 0,
      children: [...walls.map((w) => w.id), 'slab_g', 'slab_drive'],
    }),
    SlabNode.parse({
      id: 'slab_g',
      parentId: 'level_g',
      plateRole: 'base',
      polygon: corners,
      elevation: 0.05,
      thickness: 0.05,
    }),
    SlabNode.parse({
      id: 'slab_drive',
      parentId: 'level_g',
      polygon: [
        [12, 0],
        [15, 0],
        [15, 6],
        [12, 6],
      ],
      elevation: 0,
      metadata: { flatwork: 'driveway' },
    }),
    ...walls,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Nodes
}

function apply(nodes: Nodes, update: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>): Nodes {
  const next = { ...nodes }
  for (const { id, data } of update) next[id] = { ...next[id], ...data } as AnyNode
  return next
}

test('switching the foundation on seats the floor over the high side of the ground, the record kept for its readers', () => {
  const nodes = house()
  const built = buildBuildingFoundationChanges({
    nodes,
    buildingId: 'building_a',
    patch: { enabled: true },
  })
  if (!built) throw new Error('no change')
  const after = apply(nodes, built.update)
  // The raised floor the generator wrote (18 in) is under the least a stem 8 in over grade allows.
  expect(built.record.ffAboveGradeIn).toBe(22.125)
  expect(built.record.type).toBe('raised')
  expect(built.record.source).toBe('add_foundation')
  expect(levelFloorWorldY(after, 'level_g')! - FLAT_GROUND_Y).toBeCloseTo(22.125 * IN, 6)
  // The driveway stays on the ground.
  const drive = after['slab_drive' as AnyNodeId] as SlabNode
  const building = after['building_a' as AnyNodeId] as BuildingNode
  expect(building.position[1] + drive.elevation).toBeCloseTo(0, 6)
})

test('seated on its foundation, the ground floor still bears on the ground; the storey over it rests on walls', () => {
  const nodes = house()
  const building = nodes['building_a' as AnyNodeId] as BuildingNode
  nodes[building.id] = { ...building, children: ['level_g', 'level_up'] } as BuildingNode
  nodes['level_up' as AnyNodeId] = LevelNode.parse({
    id: 'level_up',
    parentId: 'building_a',
    level: 1,
    children: ['slab_up'],
  })
  nodes['slab_up' as AnyNodeId] = SlabNode.parse({
    id: 'slab_up',
    parentId: 'level_up',
    plateRole: 'base',
    polygon: (nodes['slab_g' as AnyNodeId] as SlabNode).polygon,
    elevation: 0.05,
    thickness: 0.05,
  })
  const ground = nodes['slab_g' as AnyNodeId] as SlabNode
  // The upper plate needs a room under it to rest on.
  nodes['zone_g' as AnyNodeId] = ZoneNode.parse({
    id: 'zone_g',
    parentId: 'level_g',
    name: 'Living',
    spaceRole: 'room',
    polygon: ground.polygon,
  })
  nodes[ground.id] = { ...ground, zoneIds: ['zone_g'] } as SlabNode
  const set = (scene: Nodes, enabled: boolean) =>
    apply(
      scene,
      buildBuildingFoundationChanges({
        nodes: scene,
        buildingId: 'building_a',
        patch: { enabled },
      })!.update,
    )
  const on = set(nodes, true)
  // Switched off, the house stays where the seat put it: still a ground floor.
  for (const after of [on, set(on, false)]) {
    expect(levelFloorWorldY(after, 'level_g')! - FLAT_GROUND_Y).toBeCloseTo(22.125 * IN, 6)
    const plate = after['slab_g' as AnyNodeId] as SlabNode
    expect(floorPlateAtGroundContact(after, plate)).toBe(true)
    expect(upperFloorHeightControl(after, plate)).toBeNull()
    expect(upperFloorHeightControl(after, after['slab_up' as AnyNodeId] as SlabNode)).not.toBeNull()
  }
})

// The plate's own raise stayed under the designed foundation: the seat lowered the house by it, and
// past 0.3 m the ground floor read as a basement and the Foundation section went.
for (const raise of [0.3, 0.5])
  test(`a ground floor raised ${raise} m on its own comes down onto the designed foundation`, () => {
    const nodes = house()
    const plate = nodes['slab_g' as AnyNodeId] as SlabNode
    nodes[plate.id] = {
      ...plate,
      elevation: 0.05 + raise,
      floorHeight: 0.05 + raise,
      foundation: { type: 'solid' },
    } as SlabNode
    const built = buildBuildingFoundationChanges({
      nodes,
      buildingId: 'building_a',
      patch: { enabled: true },
    })!
    const after = apply(nodes, built.update)
    const lowered = after[plate.id] as SlabNode
    // The plate follows the ground again (the store derives its top), its block gone.
    expect(Object.hasOwn(lowered, 'floorHeight') && lowered.floorHeight === undefined).toBe(true)
    expect(lowered.foundation?.type).toBe('none')
    expect(floorPlateAtGroundContact(after, lowered)).toBe(true)
    // Seated as the house that was never raised.
    const fresh = buildBuildingFoundationChanges({
      nodes: house(),
      buildingId: 'building_a',
      patch: { enabled: true },
    })!
    expect(built.moveBy).toBeCloseTo(fresh.moveBy, 6)
    expect(built.moveBy).toBeGreaterThan(0)
  })

test('a ground floor moved down with its house stays one while its top stands on the ground', () => {
  const nodes = house()
  const building = nodes['building_a' as AnyNodeId] as BuildingNode
  nodes[building.id] = { ...building, position: [0, -0.4, 0] } as BuildingNode
  const plate = nodes['slab_g' as AnyNodeId] as SlabNode
  // Raised 0.5 m on its own foundation, its top 0.15 m over the datum: on the ground.
  const raised = { ...plate, elevation: 0.55, floorHeight: 0.55, foundation: { type: 'solid' } }
  expect(
    floorPlateAtGroundContact({ ...nodes, [plate.id]: raised as SlabNode }, raised as SlabNode),
  ).toBe(true)
  // On the plane, its top 0.35 m under the ground: a basement floor.
  expect(floorPlateAtGroundContact(nodes, plate)).toBe(false)
})

test('a slab seats its top 8 in over grade; switching off leaves the building where it stands', () => {
  const nodes = house()
  const slab = buildBuildingFoundationChanges({
    nodes,
    buildingId: 'building_a',
    patch: { enabled: true, type: 'slab' },
  })!
  const seated = apply(nodes, slab.update)
  expect(levelFloorWorldY(seated, 'level_g')! - FLAT_GROUND_Y).toBeCloseTo(8 * IN, 6)
  const off = buildBuildingFoundationChanges({
    nodes: seated,
    buildingId: 'building_a',
    patch: { enabled: false },
  })!
  expect(off.moveBy).toBe(0)
  const after = apply(seated, off.update)
  expect(
    buildingFoundationRecordOf(after['building_a' as AnyNodeId] as BuildingNode)?.enabled,
  ).toBe(false)
  expect(levelFloorWorldY(after, 'level_g')).toBeCloseTo(levelFloorWorldY(seated, 'level_g')!, 9)
})

test('a taller finish floor raises the house, the stem wall growing under it', () => {
  const nodes = house()
  const built = buildBuildingFoundationChanges({
    nodes,
    buildingId: 'building_a',
    patch: { enabled: true, ffAboveGradeIn: 30 },
  })!
  const after = apply(nodes, built.update)
  expect(levelFloorWorldY(after, 'level_g')! - FLAT_GROUND_Y).toBeCloseTo(30 * IN, 6)
})

test('a house the ground stands over is seated on it when the foundation goes on', () => {
  const nodes = house()
  const site = nodes['site_a' as AnyNodeId]!
  nodes[site.id] = { ...site, terrain: raisedGround(1) } as AnyNode
  const built = buildBuildingFoundationChanges({
    nodes,
    buildingId: 'building_a',
    patch: { enabled: true },
  })!
  const after = apply(nodes, built.update)
  expect(levelFloorWorldY(after, 'level_g')! - 1).toBeCloseTo(22.125 * IN, 6)
  expect(designedFoundationReport(after, 'building_a')).not.toBeNull()
})

test('a basement under the ground floor keeps its own walls as the foundation walls; the house is seated with their top 8 in over grade', () => {
  const nodes = house()
  const building = nodes['building_a' as AnyNodeId] as BuildingNode
  const upper = LevelNode.parse({ id: 'level_up', parentId: 'building_a', level: 1 })
  nodes[upper.id] = upper
  nodes['level_g' as AnyNodeId] = { ...nodes['level_g' as AnyNodeId], height: 3 } as LevelNode
  // The ground floor's plane a little over the ground, the basement's floor 2.85 m under it.
  nodes[building.id] = {
    ...building,
    position: [0, -2.9, 0],
    children: ['level_g', upper.id],
  } as BuildingNode
  const built = buildBuildingFoundationChanges({
    nodes,
    buildingId: 'building_a',
    patch: { enabled: true },
  })!
  // The ground floor bears on the basement walls under its plane (it has no plate), by the sill.
  expect(built.moveBy).toBeCloseTo(FLAT_GROUND_Y + 8 * IN - (0.1 - 1.5 * IN), 6)
  const report = designedFoundationReport(apply(nodes, built.update), 'building_a')!
  expect(report.levelId).toBe('level_g')
  expect(report.basement?.ownWalls).toBe(true)
  expect(report.basement!.wallTopY - report.highestGradeY).toBeCloseTo(8 * IN, 6)
})

test('a floor at its least follows the stem top down as well as up; a floor set higher stays', () => {
  let nodes = house()
  const set = (patch: Parameters<typeof buildBuildingFoundationChanges>[0]['patch']) => {
    const built = buildBuildingFoundationChanges({ nodes, buildingId: 'building_a', patch })!
    nodes = apply(nodes, built.update)
    return built.record
  }
  set({ enabled: true })
  expect(set({ topAboveGradeIn: 24 }).ffAboveGradeIn).toBe(38.125)
  expect(set({ topAboveGradeIn: 8 }).ffAboveGradeIn).toBe(22.125)
  expect(levelFloorWorldY(nodes, 'level_g')! - FLAT_GROUND_Y).toBeCloseTo(22.125 * IN, 6)
  // Shallower framing keeps the stem top 8 in over grade.
  expect(set({ floorFramingDepthIn: 9.25 }).ffAboveGradeIn).toBe(17.25)
  // A finish floor set by hand outlives a change of type.
  set({ ffAboveGradeIn: 30 })
  expect(set({ type: 'slab' }).ffAboveGradeIn).toBe(30)
  expect(set({ type: 'raised' }).ffAboveGradeIn).toBe(30)
})
