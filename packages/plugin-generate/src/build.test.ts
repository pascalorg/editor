import { describe, expect, test } from 'bun:test'
import { buildHouse, type NodeOp } from './build'
import { outlineRing, ringArea } from './geometry'
import { normalizeDocument } from './document'
import { POPPY } from './templates/poppy'

type N = Record<string, any>
const ofType = (ops: NodeOp[], type: string): N[] => ops.filter((op) => op.node.type === type).map((op) => op.node)

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
    expect(interior.some((w) => /LIVING \+ DINING|DINING \+ KITCHEN|LIVING \+ KITCHEN/.test(w.name))).toBe(false)
  })

  test('one door per door attachment plus the front door, seated inside their walls', () => {
    const front = doors.filter((d) => d.metadata.attach === 'exterior')
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
    for (const o of [...doors, ...windows]) byWall.set(o.parentId, [...(byWall.get(o.parentId) ?? []), o])
    for (const list of byWall.values()) {
      const spans = list.map((o) => [o.position[0] - o.width / 2, o.position[0] + o.width / 2]).sort((a, b) => a[0]! - b[0]!)
      for (let i = 1; i < spans.length; i++) expect(spans[i]![0]).toBeGreaterThanOrEqual(spans[i - 1]![1]! - 1e-9)
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
    expect(seg.rotation).toBeCloseTo(-Math.PI / 2, 6) // ridge along the depth: gables front and back
    expect(seg.width).toBeGreaterThan(seg.depth)
    const level = ofType(ops, 'level')[0] as N
    expect(level.height).toBeCloseTo(2.7432, 4)
  })

  test('regenerating keeps the building and level ids it is handed', () => {
    const again = buildHouse(POPPY, { reuse: { buildingId: 'building_keep', levelId: 'level_keep' }, siteId: 'site_x' })
    expect(again.ok).toBe(true)
    expect(again.buildingId).toBe('building_keep')
    expect(again.levelId).toBe('level_keep')
    expect(ofType(again.ops, 'building')[0]?.parentId).toBe('site_x')
    expect(ofType(again.ops, 'level')[0]?.parentId).toBe('building_keep')
    expect(ofType(again.ops, 'wall').every((w) => w.parentId === 'level_keep')).toBe(true)
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
