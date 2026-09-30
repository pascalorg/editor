import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type AnyNode,
  area,
  type CeilingNode,
  containsPoint,
  type DoorNode,
  intersection,
  type Polygon,
  type SlabNode,
  type WallNode,
  type WindowNode,
  type ZoneNode,
} from '@pascal-app/core'
import { convertIfcToPascal, type PascalSceneGraph } from '../src'
import { loadScene } from './load-scene'

// Converts the reference IFC files and loads them the way the editor and the
// scene authority do (normalize-authority-scene.ts / useScene.setScene), then
// checks the room-first structure the loader ends up with.

const fixtures = fileURLToPath(
  new URL('../../../apps/ifc-converter/public/test-ifc-files/', import.meta.url),
)
const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`
const quietLog = console.log

type Nodes = Record<string, AnyNode>

async function convert(name: string, transform?: (source: string) => string) {
  const source = await readFile(`${fixtures}${name}`)
  const data = transform
    ? new TextEncoder().encode(transform(new TextDecoder().decode(source)))
    : source
  return convertIfcToPascal(data, undefined, { wasmPath })
}

const meta = (node: AnyNode) => (node.metadata ?? {}) as Record<string, unknown>
const ofType = <T extends AnyNode>(nodes: Nodes, type: T['type']) =>
  Object.values(nodes).filter((node): node is T => node.type === type)
const footprint = (node: {
  polygon: [number, number][]
  holes?: [number, number][][]
}): Polygon => ({
  outer: node.polygon,
  holes: node.holes ?? [],
})
const levelNamed = (nodes: Nodes, name: string) =>
  ofType<Extract<AnyNode, { type: 'level' }>>(nodes, 'level').find((level) => level.name === name)!
const isSpace = (zone: ZoneNode) => meta(zone).ifcType === 'IFCSPACE'

function adoption(nodes: Nodes) {
  const spaces = ofType<ZoneNode>(nodes, 'zone').filter(isSpace)
  return { adopted: spaces.filter((zone) => zone.autoFromWalls).length, total: spaces.length }
}

/** Rooms the IFC has no space for that cover > 30 % of a space (of the smaller one). */
function overlappingRooms(nodes: Nodes) {
  const zones = ofType<ZoneNode>(nodes, 'zone')
  const spaces = zones.filter(isSpace)
  const others = zones.filter((zone) => !isSpace(zone) && zone.polygon.length >= 3)
  return others.flatMap((room) =>
    spaces.flatMap((space) => {
      if (space.parentId !== room.parentId) return []
      const overlap = area(intersection(footprint(room), footprint(space)))
      const smaller = Math.min(area([footprint(room)]), area([footprint(space)]))
      return overlap > 0.3 * smaller ? [`${room.name}~${space.name}`] : []
    }),
  )
}

/** Share of joined wall ends (another wall within 0.6 m) lying on a neighbour's reference line. */
function wallJoinShare(nodes: Nodes) {
  const walls = ofType<WallNode>(nodes, 'wall')
  let joins = 0
  let exact = 0
  for (const wall of walls)
    for (const [x, z] of [wall.start, wall.end]) {
      let best = Number.POSITIVE_INFINITY
      for (const other of walls) {
        if (other === wall || other.parentId !== wall.parentId) continue
        const [ax, az] = other.start
        const dx = other.end[0] - ax
        const dz = other.end[1] - az
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
        best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz))
      }
      if (best > 0.6) continue
      joins++
      if (best <= 0.015) exact++
    }
  return exact / joins
}

function plateOn(nodes: Nodes, levelName: string) {
  const level = levelNamed(nodes, levelName)
  return ofType<SlabNode>(nodes, 'slab').filter(
    (slab) => slab.parentId === level.id && slab.plateRole === 'base',
  )
}

/** Hand-drawn slabs lying on a room floor at the same height (z-fighting finish layers). */
function stackedOnPlates(nodes: Nodes) {
  const slabs = ofType<SlabNode>(nodes, 'slab')
  const plates = slabs.filter((slab) => slab.plateRole)
  return slabs.filter(
    (slab) =>
      !slab.plateRole &&
      plates.some(
        (plate) =>
          plate.parentId === slab.parentId &&
          Math.abs(plate.elevation - slab.elevation) <= 0.005 &&
          area(intersection(footprint(plate), footprint(slab))) > 0.5,
      ),
  )
}

function linkedCeilings(nodes: Nodes) {
  return ofType<CeilingNode>(nodes, 'ceiling').filter(
    (ceiling) =>
      ceiling.boundary === 'auto' &&
      ceiling.zoneId &&
      nodes[ceiling.zoneId]?.type === 'zone' &&
      isSpace(nodes[ceiling.zoneId] as ZoneNode) &&
      meta(ceiling).ifcType === 'IFCCOVERING',
  )
}

function openingWorldPoint(opening: DoorNode | WindowNode, nodes: Nodes): [number, number] {
  const wall = nodes[opening.parentId!] as WallNode
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const along = opening.position[0] / length
  return [
    wall.start[0] + (wall.end[0] - wall.start[0]) * along,
    wall.start[1] + (wall.end[1] - wall.start[1]) * along,
  ]
}

const scenes = new Map<string, { raw: PascalSceneGraph; loaded: Nodes }>()
const FILES = [
  '01-duplex.ifc',
  '04-ifc-open-house.ifc',
  '05-paris-ground-floor.ifc',
  '10-sample-house.ifc',
]

beforeAll(async () => {
  console.log = () => {}
  for (const file of FILES) {
    const raw = await convert(file)
    scenes.set(file, { raw, loaded: loadScene(structuredClone(raw.nodes)) })
  }
}, 180_000)
afterAll(() => {
  console.log = quietLog
})

const scene = (file: string) => scenes.get(file)!

describe('IFC import loads as room-first structure', () => {
  test('IFC spaces are adopted as the rooms of their wall loops', () => {
    expect(adoption(scene('01-duplex.ifc').loaded)).toEqual({ adopted: 21, total: 21 })
    // ENTREE LOGEMENTS stays joined to FILIERE VENDANGES: the wall between them
    // is a 250 mm stretch (holding the door) overlapping a 50 mm partition.
    expect(adoption(scene('05-paris-ground-floor.ifc').loaded)).toEqual({ adopted: 28, total: 29 })
    // The attic "Roof" space sits on a storey without walls.
    expect(adoption(scene('10-sample-house.ifc').loaded)).toEqual({ adopted: 3, total: 4 })
  })

  test('no room the IFC has no space for overlaps a space', () => {
    for (const file of FILES)
      expect({ file, overlaps: overlappingRooms(scene(file).loaded) }).toEqual({
        file,
        overlaps: [],
      })
  })

  test('IFC spaces keep a seed point inside their outline', () => {
    for (const file of FILES)
      for (const zone of ofType<ZoneNode>(scene(file).raw.nodes, 'zone').filter(isSpace)) {
        expect(zone.seed).toBeDefined()
        expect(containsPoint([footprint(zone)], zone.seed!)).toBe(true)
      }
  })

  test('wall ends meet their neighbour centreline', () => {
    for (const file of FILES) expect(wallJoinShare(scene(file).loaded)).toBeGreaterThanOrEqual(0.9)
  })

  test('floors that fit their rooms are room floors with the IFC build-up', () => {
    const house = plateOn(scene('10-sample-house.ifc').loaded, 'Ground Floor')
    expect(house).toHaveLength(1)
    expect(house[0]!.thickness).toBeCloseTo(0.47, 3)
    expect(house[0]!.elevation).toBeCloseTo(0, 3)

    // 127 mm slab on grade / 305 mm joists, each under a 19 mm wood finish.
    const duplex = scene('01-duplex.ifc').loaded
    for (const [level, structure] of [
      ['Level 1', 0.127],
      ['Level 2', 0.305],
    ] as const) {
      const plates = plateOn(duplex, level)
      expect(plates.length).toBeGreaterThan(0)
      for (const plate of plates) {
        expect(plate.elevation).toBeCloseTo(0.019, 3)
        expect(plate.thickness).toBeCloseTo(structure + 0.019, 3)
        expect(plate.elevation - plate.thickness).toBeCloseTo(-structure, 3)
      }
    }

    // 300 mm structure under 50 mm marble.
    const paris = plateOn(scene('05-paris-ground-floor.ifc').loaded, 'Ground Floor')
    expect(paris).toHaveLength(1)
    expect(paris[0]!.elevation).toBeCloseTo(0.05, 3)
    expect(paris[0]!.thickness).toBeCloseTo(0.35, 3)
  })

  test('floors that do not fit stay hand-drawn slabs at their IFC top and thickness', () => {
    const duplex = ofType<SlabNode>(scene('01-duplex.ifc').loaded, 'slab').filter(
      (slab) => !slab.plateRole,
    )
    expect(duplex.map((slab) => slab.name.replace(/:\d+$/, ''))).toEqual([
      'Sol:150mm Exterior Slab on Grade',
      'Sol:150mm Exterior Slab on Grade',
    ])
    for (const slab of duplex) {
      expect(slab.elevation).toBeCloseTo(0.013, 3)
      expect(slab.thickness).toBeCloseTo(0.15, 3)
    }
    const paris = ofType<SlabNode>(scene('05-paris-ground-floor.ifc').loaded, 'slab')
    const footpath = paris.find((slab) => slab.name === 'Sol:FootPath:421113')!
    expect(footpath.plateRole).toBeUndefined()
    expect(footpath.elevation).toBeCloseTo(-0.15, 3)
    expect(footpath.thickness).toBeCloseTo(0.3, 3)
    // The plinth around the sample house is the slab's part outside the rooms.
    const plinth = ofType<SlabNode>(scene('10-sample-house.ifc').loaded, 'slab').find(
      (slab) => meta(slab).ifcSplit === 'outside-rooms',
    )!
    expect(plinth.plateRole).toBeUndefined()
    expect(plinth.thickness).toBeCloseTo(0.47, 3)
    expect(plinth.holes).toHaveLength(1)
  })

  test('slab holes become floor openings', () => {
    const openings = ofType<AnyNode>(scene('05-paris-ground-floor.ifc').loaded, 'floor-opening')
    expect(openings).toHaveLength(7)
  })

  test('finish floors become room finishes, not stacked slabs', () => {
    for (const file of FILES)
      expect(stackedOnPlates(scene(file).loaded).map((slab) => slab.name)).toEqual([])
    const zones = ofType<ZoneNode>(scene('01-duplex.ifc').loaded, 'zone')
    const finishOf = (name: string) => zones.find((zone) => zone.name === name)?.floor?.finish
    expect(finishOf('Living Room')).toBe('library:wood-woodplank48')
    expect(finishOf('Kitchen')).toBe('library:flooring-lightceramic24')
    expect(finishOf('Bathroom 1')).toBe('library:flooring-lightceramic24')
  })

  test('IFC ceiling coverings become the ceilings of their rooms', () => {
    const duplex = scene('01-duplex.ifc')
    const linked = linkedCeilings(duplex.loaded)
    expect(linked.length).toBeGreaterThanOrEqual(18)
    for (const ceiling of linked) expect(ceiling.height).toBeCloseTo(2.6, 2)
    expect(linkedCeilings(scene('10-sample-house.ifc').loaded)).toHaveLength(3)
    // Paris's one ceiling covers ENTREE LOGEMENTS, which is no room of its own
    // (see above): it stays a hand-drawn ceiling at the covering's underside.
    const paris = ofType<CeilingNode>(scene('05-paris-ground-floor.ifc').loaded, 'ceiling').filter(
      (ceiling) => meta(ceiling).ifcType === 'IFCCOVERING',
    )
    expect(paris).toHaveLength(1)
    expect(paris[0]!.height).toBeCloseTo(2.26, 2)
    // Every room the importer gave a covering keeps a ceiling through the load.
    for (const file of FILES) {
      const { raw, loaded } = scene(file)
      for (const ceiling of ofType<CeilingNode>(raw.nodes, 'ceiling')) {
        if (ceiling.boundary !== 'auto' || !ceiling.zoneId) continue
        expect(
          ofType<CeilingNode>(loaded, 'ceiling').some(
            (candidate) =>
              candidate.zoneId === ceiling.zoneId && candidate.height === ceiling.height,
          ),
        ).toBe(true)
      }
    }
    for (const file of FILES) {
      const meshes = ofType<AnyNode>(scene(file).raw.nodes, 'imported-mesh')
      expect(
        meshes.filter(
          (mesh) => meta(mesh).ifcType === 'IFCCOVERING' && meta(mesh).predefinedType === 'CEILING',
        ),
      ).toEqual([])
    }
    // A room the file models no ceiling for has none.
    const stair = ofType<ZoneNode>(duplex.loaded, 'zone').find((zone) => zone.name === 'Stair')!
    expect(stair.hasCeiling).toBe(false)
  })

  test('openings are stamped for the current threshold model and keep their place', async () => {
    const duplex = scene('01-duplex.ifc').raw
    const openings = Object.values(duplex.nodes).filter(
      (node): node is DoorNode | WindowNode => node.type === 'door' || node.type === 'window',
    )
    for (const opening of openings) {
      expect(opening.floorThresholdVersion).toBe(1)
      expect(opening.wallId).toBe(opening.parentId!)
    }
    // Joining corners moves wall starts; openings keep their plan position.
    const unjoined = await convertIfcToPascal(
      await readFile(`${fixtures}01-duplex.ifc`),
      undefined,
      {
        wasmPath,
        simplify: false,
      },
    )
    for (const opening of openings) {
      const before = Object.values(unjoined.nodes).find(
        (node) => meta(node).expressID === meta(opening).expressID,
      ) as DoorNode | WindowNode
      const [x0, z0] = openingWorldPoint(before, unjoined.nodes)
      const [x1, z1] = openingWorldPoint(opening, duplex.nodes)
      expect(Math.hypot(x1 - x0, z1 - z0)).toBeLessThan(0.01)
    }
  }, 60_000)

  test('the site covers the imported model', () => {
    for (const file of FILES) {
      const nodes = scene(file).raw.nodes
      const [site] = ofType<Extract<AnyNode, { type: 'site' }>>(nodes, 'site')
      const outline: Polygon = { outer: site!.polygon!.points, holes: [] }
      for (const wall of ofType<WallNode>(nodes, 'wall'))
        for (const point of [wall.start, wall.end])
          expect(containsPoint([outline], point)).toBe(true)
    }
  })

  // Room detection breaks near-ties by node id, so ids must not be random.
  test('the same file always imports to the same scene', async () => {
    const again = await convert('01-duplex.ifc')
    expect(JSON.stringify(again)).toBe(JSON.stringify(scene('01-duplex.ifc').raw))
  })
})

describe('IFC wall reference lines', () => {
  test('a layer set on a wall face becomes Pascal justification', async () => {
    // The sample house partitions are centred (NEGATIVE, offset 47.5 of 95 mm);
    // an offset of 0 puts the IFC reference line on one face instead.
    const centred = await convert('10-sample-house.ifc')
    const faced = await convert('10-sample-house.ifc', (source) =>
      source.replaceAll('.AXIS2.,.NEGATIVE.,47.5,', '.AXIS2.,.NEGATIVE.,0.,'),
    )
    const partitions = (graph: PascalSceneGraph) =>
      ofType<WallNode>(graph.nodes, 'wall').filter((wall) => (wall.thickness ?? 0) < 0.1)
    expect(partitions(centred).every((wall) => wall.justification === undefined)).toBe(true)
    const justified = partitions(faced)
    expect(justified.length).toBeGreaterThan(0)
    for (const wall of justified) {
      expect(wall.justification === 'a' || wall.justification === 'b').toBe(true)
      const original = partitions(centred).find(
        (candidate) => meta(candidate).expressID === meta(wall).expressID,
      )!
      // The reference line is the IFC axis; the body moved half its thickness
      // off it, onto the side the layers run.
      const dx = original.end[0] - original.start[0]
      const dz = original.end[1] - original.start[1]
      const length = Math.hypot(dx, dz)
      const offset =
        ((wall.start[0] - original.start[0]) * -dz + (wall.start[1] - original.start[1]) * dx) /
        length
      expect(Math.abs(offset)).toBeLessThan(0.002)
    }
  }, 60_000)
})
