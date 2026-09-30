import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type AnyNode,
  area,
  type CeilingNode,
  type DoorNode,
  type Polygon,
  type SlabNode,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { migrateRoomZones } from '@pascal-app/core/scene-migrations'
import { convertIfcToPascal } from '../src'
import { boxWalls, IfcBuilder, rectangle } from './ifc-builder'
import { loadScene } from './load-scene'

// Small synthetic IFC files for importer bugs found in review. IFC plan
// (x, y) becomes Pascal plan (x, -y).

const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`
const quietLog = console.log
beforeAll(() => {
  console.log = () => {}
})
afterAll(() => {
  console.log = quietLog
})

type Nodes = Record<string, AnyNode>
const convert = async (builder: IfcBuilder) =>
  (await convertIfcToPascal(new TextEncoder().encode(builder.toString()), undefined, { wasmPath }))
    .nodes as Nodes
const ofType = <T extends AnyNode>(nodes: Nodes, type: T['type']) =>
  Object.values(nodes).filter((node): node is T => node.type === type)
const meta = (node: AnyNode) => (node.metadata ?? {}) as Record<string, unknown>
const footprint = (node: {
  polygon: [number, number][]
  holes?: [number, number][][]
}): Polygon => ({
  outer: node.polygon,
  holes: node.holes ?? [],
})
const ringArea = (ring: [number, number][]) => area([{ outer: ring, holes: [] }])
const close = (a: [number, number], b: [number, number], tolerance = 1e-6) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance

function doorWorldPoint(door: DoorNode, nodes: Nodes): [number, number] {
  const wall = nodes[door.parentId!] as WallNode
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const dir = [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length]
  const [along, , across] = door.position
  return [
    wall.start[0] + dir[0]! * along - dir[1]! * across,
    wall.start[1] + dir[1]! * along + dir[0]! * across,
  ]
}

/** A 5 × 4 m room (wall centrelines) with its space filling the clear floor. */
function room(builder: IfcBuilder) {
  const walls = boxWalls(builder, 5, 4)
  builder.space('Room', rectangle(0.1, 0.1, 4.9, 3.9))
  return walls
}

describe('IFC importer regressions', () => {
  test('face-referenced walls keep their corners joined on the reference lines', async () => {
    // Axes on the outer faces of a 5 × 4 m box, 200 mm bodies inward (left).
    const builder = new IfcBuilder()
    const corners: [number, number][] = [
      [0, 0],
      [5, 0],
      [5, 4],
      [0, 4],
    ]
    const walls = corners.map((start, index) =>
      builder.wall({ start, end: corners[(index + 1) % 4]!, low: 0, high: 0.2, layerUsage: true }),
    )
    builder.door(walls[0]!, 2.5)
    builder.space('Room', rectangle(0.2, 0.2, 4.8, 3.8))
    const nodes = await convert(builder)

    const imported = ofType<WallNode>(nodes, 'wall')
    expect(imported).toHaveLength(4)
    for (const wall of imported) expect(wall.justification).toBeDefined()
    // Every reference corner is shared by two walls, at the IFC outer corners.
    for (const [x, y] of corners) {
      const point: [number, number] = [x, -y]
      const ends = imported
        .flatMap((wall) => [wall.start, wall.end])
        .filter((end) => close(end, point))
      expect(ends).toHaveLength(2)
    }
    const rooms = Object.values(migrateRoomZones(nodes).nodes as Nodes).filter(
      (node): node is ZoneNode => node.type === 'zone' && node.autoFromWalls,
    )
    expect(rooms).toHaveLength(1)
    expect(meta(rooms[0]!).ifcType).toBe('IFCSPACE')

    const [door] = ofType<DoorNode>(nodes, 'door')
    const [x, z] = doorWorldPoint(door!, nodes)
    expect(x).toBeCloseTo(2.5, 3)
    expect(Math.abs(z)).toBeLessThan(0.11)
  }, 30_000)

  test('a slab under part of a room stays hand-drawn', async () => {
    const builder = new IfcBuilder()
    room(builder)
    const slab = builder.slab('Part floor', rectangle(0, 0, 3, 4), 0, 0.2)
    const nodes = await convert(builder)
    const imported = ofType<SlabNode>(nodes, 'slab').find((node) => meta(node).expressID === slab)!
    expect(imported.plateRole).toBeUndefined()
    const space = ofType<ZoneNode>(nodes, 'zone').find((zone) => meta(zone).ifcType === 'IFCSPACE')!
    expect(space.floor?.sourceSlabId).toBe(imported.id)

    const loaded = loadScene(structuredClone(nodes))
    for (const plate of ofType<SlabNode>(loaded, 'slab').filter((node) => node.plateRole))
      expect(area([footprint(plate)])).toBeLessThanOrEqual(12.01)
  }, 30_000)

  test('a room floored in two finishes keeps both', async () => {
    const builder = new IfcBuilder()
    room(builder)
    builder.slab('Structure', rectangle(-0.1, -0.1, 5.1, 4.1), 0, 0.2)
    builder.slab('Finish Floor - Wood', rectangle(0.1, 0.1, 3, 3.9), 0.02, 0.02)
    builder.slab('Finish Floor - Ceramic Tile', rectangle(3, 0.1, 4.9, 3.9), 0.02, 0.02)
    const nodes = await convert(builder)

    const space = ofType<ZoneNode>(nodes, 'zone').find((zone) => meta(zone).ifcType === 'IFCSPACE')!
    expect(space.floor?.finish).toBe('library:wood-woodplank48')
    const regions = space.floor?.regions ?? []
    expect(regions.map((region) => region.finish)).toEqual(['library:flooring-lightceramic24'])
    expect(ringArea(regions[0]!.polygon)).toBeCloseTo(1.9 * 3.8, 2)
    // Both finishes are wholly represented by the room: no slabs remain for them.
    expect(ofType<SlabNode>(nodes, 'slab').map((slab) => slab.name)).toEqual(['Structure'])
  }, 30_000)

  test('a wall turned onto an in-line neighbour keeps its door in place', async () => {
    const builder = new IfcBuilder()
    const thin = builder.wall({ start: [0, 0], end: [5, 0], low: -0.025, high: 0.025 })
    builder.wall({ start: [5, 0.09], end: [9, 0.09], low: -0.1, high: 0.1 })
    builder.door(thin, 4)
    const nodes = await convert(builder)

    const turned = ofType<WallNode>(nodes, 'wall').find((wall) => close(wall.start, [0, 0]))!
    expect(close(turned.end, [5, -0.09])).toBe(true)
    const [door] = ofType<DoorNode>(nodes, 'door')
    const [x, z] = doorWorldPoint(door!, nodes)
    expect(x).toBeCloseTo(4, 3)
    expect(z).toBeCloseTo(0, 3)
  }, 30_000)

  test('ceiling covering holes survive import and room linking', async () => {
    const builder = new IfcBuilder()
    room(builder)
    builder.slab('Structure', rectangle(-0.1, -0.1, 5.1, 4.1), 0, 0.2)
    const ceiling = builder.covering('CEILING', rectangle(0.1, 0.1, 4.9, 3.9), 2.5, 0.02, {
      holes: [rectangle(0.5, 0.5, 1.5, 1.5)],
    })
    builder.voidThrough(ceiling, rectangle(3, 2, 4, 3), 2.4, 0.3)
    const nodes = await convert(builder)

    const [imported] = ofType<CeilingNode>(nodes, 'ceiling')
    expect(imported!.zoneId).toBeDefined()
    expect(imported!.holes.map((hole) => Math.round(ringArea(hole) * 100) / 100)).toEqual([1, 1])
    expect(imported!.holeMetadata.every((entry) => entry.source === 'manual')).toBe(true)

    const loaded = loadScene(structuredClone(nodes))
    const linked = ofType<CeilingNode>(loaded, 'ceiling').filter(
      (node) => node.zoneId === imported!.zoneId,
    )
    expect(linked).toHaveLength(1)
    const cut = linked[0]!.holes.filter(
      (_, index) => linked[0]!.holeMetadata[index]?.source === 'manual',
    )
    expect(cut.map((hole) => Math.round(ringArea(hole) * 100) / 100)).toEqual([1, 1])
    expect(linked[0]!.height).toBeCloseTo(2.5, 3)
  }, 30_000)

  test('a sloped covering stays an imported mesh', async () => {
    const builder = new IfcBuilder()
    room(builder)
    const covering = builder.covering('CEILING', rectangle(0.1, 0.1, 4.9, 3.9), 2.2, 0.02, {
      tiltDegrees: 20,
    })
    const nodes = await convert(builder)
    expect(ofType<CeilingNode>(nodes, 'ceiling')).toHaveLength(0)
    const mesh = ofType<AnyNode>(nodes, 'imported-mesh').find(
      (node) => meta(node).expressID === covering,
    )
    expect(mesh).toBeDefined()
  }, 30_000)

  test('imported meshes keep the ids a Pascal export gave them', async () => {
    const builder = new IfcBuilder()
    const kept = builder.furnishing([1, 1])
    const duplicate = builder.furnishing([2, 1])
    const otherType = builder.furnishing([3, 1])
    builder.pascalIdentity(kept, 'imesh_kept', 'imported-mesh')
    builder.pascalIdentity(duplicate, 'imesh_kept', 'imported-mesh')
    builder.pascalIdentity(otherType, 'item_chair', 'item')
    const nodes = await convert(builder)
    const meshes = ofType<AnyNode>(nodes, 'imported-mesh')
    const byExpress = (id: number) => meshes.find((mesh) => meta(mesh).expressID === id)!
    expect(byExpress(kept).id).toBe('imesh_kept')
    expect(byExpress(duplicate).id).not.toBe('imesh_kept')
    expect(byExpress(duplicate).id.startsWith('imesh_')).toBe(true)
    expect(byExpress(otherType).id.startsWith('imesh_')).toBe(true)
  }, 30_000)
})
