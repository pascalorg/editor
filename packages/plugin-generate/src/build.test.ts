import { describe, expect, test } from 'bun:test'
import { buildHouse, type NodeOp } from './build'
import { normalizeDocument } from './document'
import { outlineRing, ringArea } from './geometry'
import { rollDocument } from './roll'
import { styleFor } from './styles'
import { POPPY } from './templates/poppy'

type N = Record<string, any>
const ofType = (ops: NodeOp[], type: string): N[] =>
  ops.filter((op) => op.node.type === type).map((op) => op.node)

describe('Poppy builds into Pascal nodes', () => {
  const result = buildHouse(POPPY)
  const ops = result.ops
  const walls = ofType(ops, 'wall')
  const doors = ofType(ops, 'door')
  const windows = ofType(ops, 'window')
  const zones = ofType(ops, 'zone')

  test('builds clean, parent-first, one building and one level', () => {
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(ops[0]?.node.type).toBe('building')
    expect(ops[1]?.node.type).toBe('level')
    const seen = new Set<string>()
    for (const op of ops) {
      const parent = op.node.parentId as string | null
      if (parent) expect(seen.has(parent)).toBe(true)
      seen.add(op.node.id as string)
    }
  })

  test('the exterior outline closes at 24 × 33 and the walls carry assemblies', () => {
    const ring = outlineRing(normalizeDocument(POPPY).rooms, 6)
    expect(ring).not.toBeNull()
    expect(ringArea(ring as [number, number][])).toBe(24 * 12 * 33 * 12)
    const exterior = walls.filter((w) => w.metadata.wallType === 'ext2x6')
    expect(exterior.length).toBe(4)
    for (const w of exterior) {
      expect(w.assembly.preset).toBe('exterior-2x6-siding')
      expect([w.frontSide, w.backSide].sort()).toEqual(['exterior', 'interior'])
    }
    const interior = walls.filter((w) => w.metadata.wallType === 'int2x4')
    expect(interior.length).toBeGreaterThan(0)
    for (const w of interior) expect(w.assembly.preset).toBe('interior-2x4-drywall')
    // The open plan has NO partition between living, dining and kitchen.
    expect(
      interior.some((w) => /LIVING \+ DINING|DINING \+ KITCHEN|LIVING \+ KITCHEN/.test(w.name)),
    ).toBe(false)
  })

  test('one door per door attachment plus the front door, seated inside their walls', () => {
    const exterior = doors.filter((d) => d.metadata.attach === 'exterior')
    expect(exterior.length).toBe(2) // the front door and the rear entrance
    const front = exterior.filter((d) => d.name === 'Front door')
    expect(front.length).toBe(1)
    expect(front[0]?.width).toBeCloseTo(0.9144, 4)
    expect(doors.filter((d) => d.metadata.attach === 'door').length).toBe(4)
    const wallById = new Map(walls.map((w) => [w.id, w]))
    for (const door of doors) {
      const wall = wallById.get(door.parentId) as N
      const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
      // 6" from a corner for a room door, 3" for a closet door or a cased opening.
      expect(door.position[0] - door.width / 2).toBeGreaterThanOrEqual(0.0762 - 1e-9)
      expect(door.position[0] + door.width / 2).toBeLessThanOrEqual(length - 0.0762 + 1e-9)
      expect(door.position[1]).toBeCloseTo(door.height / 2, 6)
    }
  })

  test('every bedroom gets a 4 × 5 egress window on an exterior wall; the bath a small slider', () => {
    const byName = (n: string) => windows.filter((w) => w.name === n)
    for (const bed of ['BEDROOM 1 window', 'BEDROOM 2 window']) {
      const w = byName(bed)
      expect(w.length).toBe(1)
      expect(w[0]?.width).toBeCloseTo(1.2192, 4)
      expect(w[0]?.height).toBeCloseTo(1.524, 4)
      expect(w[0]?.windowType).toBe('double-hung')
      const wall = walls.find((x) => x.id === w[0]?.parentId) as N
      expect(wall.metadata.wallType).toBe('ext2x6')
    }
    expect(byName('BATH window')[0]?.windowType).toBe('sliding')
    expect(byName('LIVING window').length).toBe(2)
    // Openings on one wall never overlap.
    const byWall = new Map<string, N[]>()
    for (const o of [...doors, ...windows])
      byWall.set(o.parentId, [...(byWall.get(o.parentId) ?? []), o])
    for (const list of byWall.values()) {
      const spans = list
        .map((o) => [o.position[0] - o.width / 2, o.position[0] + o.width / 2])
        .sort((a, b) => a[0]! - b[0]!)
      for (let i = 1; i < spans.length; i++)
        expect(spans[i]![0]).toBeGreaterThanOrEqual(spans[i - 1]![1]! - 1e-9)
    }
  })

  test('zones come from the walls: the open plan is one room, the others their own', () => {
    const names = zones.map((z) => z.name).sort()
    expect(names).toContain('LIVING / DINING / KITCHEN')
    expect(names).toContain('BATH')
    expect(names).toContain('BEDROOM 1')
    expect(names).toContain('BEDROOM 2')
    expect(names).toContain('LAUNDRY')
    expect(zones.every((z) => z.spaceRole === 'room' && z.boundaryWallIds.length >= 3)).toBe(true)
    expect(zones.find((z) => z.name === 'BATH')?.floorFinish).toBe('TILE')
    expect(result.stats.livingSqFt).toBe(792)
  })

  test('slab under the outline, a 9:12 front-to-back gable, a 9 ft level', () => {
    const slab = ofType(ops, 'slab')[0] as N
    expect(slab.polygon.length).toBe(4)
    const seg = ofType(ops, 'roof-segment')[0] as N
    expect(seg.roofType).toBe('gable')
    expect(seg.pitch).toBeCloseTo((Math.atan(9 / 12) * 180) / Math.PI, 2)
    expect(Math.abs(Math.sin(seg.rotation))).toBeCloseTo(1, 6) // ridge along the depth: gables front and back
    expect(seg.width).toBeGreaterThan(seg.depth)
    expect(seg.wallHeight).toBe(0) // seated on the plate
    const level0 = ofType(ops, 'level')[0] as N
    expect(seg.position[1]).toBeCloseTo(level0.height, 6)
    // every exterior wall knows what it carries
    const roles = ofType(ops, 'wall')
      .filter((w) => w.metadata.wallType === 'ext2x6')
      .map((w) => w.metadata.roof?.role)
    expect(roles.every((r) => r === 'eave' || r === 'gable-end')).toBe(true)
    expect(roles.filter((r) => r === 'gable-end').length).toBe(2)
    const level = ofType(ops, 'level')[0] as N
    expect(level.height).toBeCloseTo(2.7432, 4)
  })

  test('regenerating keeps the building and level ids it is handed', () => {
    const again = buildHouse(POPPY, {
      reuse: { buildingId: 'building_keep', levelId: 'level_keep' },
      siteId: 'site_x',
    })
    expect(again.ok).toBe(true)
    expect(again.buildingId).toBe('building_keep')
    expect(again.levelId).toBe('level_keep')
    expect(ofType(again.ops, 'building')[0]?.parentId).toBe('site_x')
    expect(ofType(again.ops, 'level')[0]?.parentId).toBe('building_keep')
    expect(ofType(again.ops, 'wall').every((w) => w.parentId === 'level_keep')).toBe(true)
  })

  test('the entrance: a porch centred on the front door, its steps to grade, the building 8 in above grade', () => {
    const built = buildHouse(POPPY)
    expect(built.ok).toBe(true)
    const building = ofType(built.ops, 'building')[0] as N
    expect(building.position[1]).toBeCloseTo(8 * 0.0254, 9)
    const door = ofType(built.ops, 'door').find((d) => (d as N).name === 'Front door') as N
    expect(door).toBeDefined()
    const porch = ofType(built.ops, 'slab').find((s) => (s as N).name === 'Porch') as N
    expect(porch).toBeDefined()
    expect(porch.elevation).toBeCloseTo(0.05 - 4 * 0.0254, 9)
    const posts = ofType(built.ops, 'column')
    expect(posts.length).toBeGreaterThanOrEqual(2)
    for (const p of posts) expect((p as N).supportSlabId).toBe(porch.id)
    const stair = ofType(built.ops, 'stair')[0] as N
    expect(stair.deckSlabId).toBe(porch.id)
    expect(stair.stepCount).toBe(1) // 6 in from grade to the porch top
    const segs = ofType(built.ops, 'roof-segment') as N[]
    expect(segs.some((s) => /Porch/.test(String(s.name)))).toBe(true)
    expect(built.porch?.policy).toBe(styleFor(POPPY.style ?? 'cottage').porch)
    // the porch sits on the front door's wall, outside its exterior face
    const wall = ofType(built.ops, 'wall').find((w) => (w as N).id === door.parentId) as N
    const wz = (wall.start as number[])[1] as number
    const poly = porch.polygon as [number, number][]
    for (const p of poly) expect(Math.abs(p[1] - wz)).toBeGreaterThan(0.08)
  })

  test('a wide farmhouse is raised: the floor is a platform, the garage slab sits at grade and its walls stand on it', () => {
    const rolled = rollDocument(1499472249, { style: 'farmhouse', beds: 3, baths: 2, garage: true })
    const built = buildHouse(rolled.document)
    expect(built.ok).toBe(true)
    expect(built.foundation?.type).toBe('raised')
    expect(built.foundation?.ffAboveGradeIn).toBe(18)
    const building = ofType(built.ops, 'building')[0] as N
    expect(building.position[1]).toBeCloseTo(18 * 0.0254, 9)
    expect(building.metadata.foundation).toEqual({
      type: 'raised',
      ffAboveGradeIn: 18,
      source: built.foundation?.source,
    })
    const slabs = ofType(built.ops, 'slab') as N[]
    const platform = slabs.find((s) => s.name === 'Floor platform')!
    expect(platform.thickness).toBeCloseTo(0.019, 9)
    const garage = slabs.find((s) => s.name === 'Garage slab')!
    expect(garage).toBeDefined()
    expect(garage.elevation).toBeCloseTo(0.05 - 18 * 0.0254, 6)
    // the garage footprint is not part of the house platform
    const platformArea = Math.abs(ringArea(platform.polygon as [number, number][]))
    const garageArea = Math.abs(ringArea(garage.polygon as [number, number][]))
    expect(garageArea).toBeGreaterThan(30)
    // together they cover exactly the rooms (the roll's footprint is the house rectangle plus the garage bump)
    const roomsM2 = rolled.document.rooms.reduce((s, r) => s + r.w * r.d, 0) * 0.09290304
    expect(platformArea + garageArea).toBeCloseTo(roomsM2, 0)
    const onGarage = (ofType(built.ops, 'wall') as N[]).filter((w) => w.supportSlabId === garage.id)
    expect(onGarage.length).toBeGreaterThanOrEqual(2)
    for (const w of onGarage) expect(w.name).toBe('Exterior wall')
  })

  test('a rear slider opens onto the yard and gets its own entrance: a deck on the raised farmhouse, a patio on the slab Poppy', () => {
    const farm = buildHouse(
      rollDocument(1499472249, { style: 'farmhouse', beds: 3, baths: 2, garage: true }).document,
    )
    const slider = ofType(farm.ops, 'door').find((d) => /slider|Rear door/.test((d as N).name)) as N
    expect(slider).toBeDefined()
    if (/slider/.test(slider.name)) {
      expect(slider.doorType).toBe('sliding')
      expect(slider.width).toBeCloseTo(72 * 0.0254, 9)
    } else {
      expect(slider.doorType).toBe('hinged')
    }
    expect(farm.rear?.policy).toBe('deck')
    expect(farm.rear?.landing).toBe('wood')
    expect(farm.porch?.landing).toBe('wood')
    expect((ofType(farm.ops, 'slab') as N[]).map((s) => s.name)).toContain('Rear deck')
    // the Poppy is a modern (porch 'none') on a slab: a bare concrete landing at the rear door
    const poppy = buildHouse(POPPY)
    expect(poppy.rear?.policy).toBe('landing')
    expect(poppy.rear?.landing).toBe('concrete')
  })

  test('the Poppy (24 ft wide) is a slab house at 8 in, one slab, no garage slab', () => {
    const built = buildHouse(POPPY)
    expect(built.foundation?.type).toBe('slab')
    expect(built.foundation?.ffAboveGradeIn).toBe(8)
    expect((ofType(built.ops, 'slab') as N[]).map((s) => s.name)).toEqual([
      'Slab on grade',
      'Porch',
      'Rear landing',
    ])
  })

  test('placed on a parcel: square to the street, at the front setback, attached to the site', () => {
    // A 60 × 100 ft lot whose street edge runs along +x at z = 0; envelope inset 25/7/20.
    const envelope: [number, number][] = [
      [2.1336, 7.62],
      [18.288 - 2.1336, 7.62],
      [18.288 - 2.1336, 30.48 - 6.096],
      [2.1336, 30.48 - 6.096],
    ]
    const placed = buildHouse(POPPY, { placement: { siteId: 'site_x', envelope, frontEdge: 0 } })
    expect(placed.ok).toBe(true)
    const building = ofType(placed.ops, 'building')[0] as N
    expect(building.parentId).toBe('site_x')
    // Front face (local −z) toward −z world: yaw 0; the house centre sits its half-depth behind the setback line.
    expect(Math.abs(building.rotation[1])).toBeLessThan(1e-6)
    expect(building.position[2]).toBeCloseTo(7.62 + (33 * 0.3048) / 2 + 0.0913, 1)
    expect(building.position[0]).toBeCloseTo(18.288 / 2, 3)
  })
})

describe('on a hill (the site carries a USGS heightfield → gradeAt)', () => {
  const doc = rollDocument(1499472249, {
    style: 'farmhouse',
    beds: 3,
    baths: 2,
    garage: true,
  }).document
  const IN = 0.0254
  const buildingOf = (r: ReturnType<typeof buildHouse>) => ofType(r.ops, 'building')[0] as N
  const garageSlabOf = (r: ReturnType<typeof buildHouse>) =>
    (ofType(r.ops, 'slab') as N[]).find((s) => s.name === 'Garage slab') as N

  test('flat ground read from a heightfield matches no heightfield at all', () => {
    const flat = buildHouse(doc, { gradeAt: () => 0 })
    const none = buildHouse(doc)
    expect(flat.foundation?.type).toBe(none.foundation?.type)
    expect(flat.foundation?.ffAboveGradeIn).toBe(none.foundation?.ffAboveGradeIn)
    expect(flat.foundation?.terrain?.reliefIn).toBe(0)
    expect(buildingOf(flat).position[1]).toBeCloseTo(buildingOf(none).position[1], 9)
    expect(garageSlabOf(flat).elevation).toBeCloseTo(garageSlabOf(none).elevation, 9)
  })

  test('a gentle slope raises the house on a stem sized to the fall, standing on the high side', () => {
    // 2 % up towards +x: the garage wing (to the right, +x) is uphill
    const r = buildHouse(doc, { gradeAt: (x) => 0.02 * x })
    const f = r.foundation!
    expect(f.type).toBe('raised')
    expect(f.terrain).toBeDefined()
    expect(f.terrain!.reliefIn).toBeGreaterThanOrEqual(12)
    expect(f.ffAboveGradeIn).toBeGreaterThanOrEqual(24)
    expect(f.ffAboveGradeIn).toBeLessThanOrEqual(36)
    expect(f.source).toContain('hillside')
    // the finish floor stands ff above the HIGHEST grade under the footprint
    expect(buildingOf(r).position[1]).toBeCloseTo(f.terrain!.highestM + f.ffAboveGradeIn * IN, 3)
    // the garage pad sits at its own grade: the datum is the HIGHEST point of the
    // whole footprint, so the drop is never less than the stem — and an uphill
    // garage (this slope) drops far less than a downhill one
    const g = garageSlabOf(r)
    expect(g.metadata.dropIn).toBeGreaterThanOrEqual(f.ffAboveGradeIn)
    expect(g.metadata.dropIn).toBeLessThan(f.ffAboveGradeIn + 6)
    const downhill = garageSlabOf(buildHouse(doc, { gradeAt: (x) => -0.02 * x }))
    expect(downhill.metadata.dropIn).toBeGreaterThan(g.metadata.dropIn + 6)
    expect(g.elevation).toBeCloseTo(0.05 - g.metadata.dropIn * IN, 2)
    expect(r.warnings.some((w) => /hillside/.test(w))).toBe(true)
  })

  test('a slope falling towards the garage drops the pad further, never past 48 in', () => {
    const r = buildHouse(doc, { gradeAt: (x) => -0.02 * x })
    const g = garageSlabOf(r)
    expect(g.metadata.dropIn).toBeGreaterThan(r.foundation!.ffAboveGradeIn)
    expect(g.metadata.dropIn).toBeLessThanOrEqual(48)
    const steep = buildHouse(doc, { gradeAt: (x) => -0.1 * x })
    expect(garageSlabOf(steep).metadata.dropIn).toBe(48)
  })

  test('over 30 in of fall is basement territory: a 36 in stem, said honestly, and longer flights at the entrances', () => {
    const r = buildHouse(doc, { gradeAt: (_x, z) => 0.06 * z })
    const f = r.foundation!
    expect(f.ffAboveGradeIn).toBe(36)
    expect(f.source).toContain('basement')
    // the front (−z) is downhill of the house datum: the porch flight rises the full stem and the fall to the landing
    expect(r.porch?.risers ?? 0).toBeGreaterThan(Math.ceil(36 / 7.75))
  })
})
