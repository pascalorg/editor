import { describe, expect, test } from 'bun:test'
import { Euler, Vector3 } from 'three'
import type { Fixture, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { feet, inches } from '../core/units'
import {
  layoutElectrical,
  pointInPolygon,
  polygonCentroid,
  receptaclePositions,
  usableSegments,
} from './electrical'

/** Rough-opening pad the extractor applies (wall-model.ts). */
const RO_PAD = inches(1.5)
/** Face offset: half default wall thickness + the 3/4" device-box proud. */
const OFF = 0.1 / 2 + inches(0.75)

const SIX_FT = feet(6)
const TWELVE_FT = feet(12)

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [6, 0]
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall_test',
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.1,
    height: 2.5,
    exterior: false,
    openings: [],
    curved: false,
    ...overrides,
  }
}

function door(u: number, width = 0.9, id = 'door_test'): OpeningSlice {
  return {
    id,
    kind: 'door',
    u,
    width,
    height: 2.1,
    sillHeight: 0,
    roughWidth: width + RO_PAD,
    roughHeight: 2.1 + RO_PAD,
  }
}

function window_(u: number, width = 1.2): OpeningSlice {
  return {
    id: 'window_test',
    kind: 'window',
    u,
    width,
    height: 1.2,
    sillHeight: 0.9,
    roughWidth: width + RO_PAD,
    roughHeight: 1.2 + RO_PAD,
  }
}

function room(
  category: RoomSlice['category'],
  polygon: readonly (readonly [number, number])[],
  overrides: Partial<RoomSlice> = {},
): RoomSlice {
  return {
    id: `room_${category}`,
    name: category,
    category,
    polygon,
    boundaryWallIds: [],
    ceilingHeight: 2.7,
    ...overrides,
  }
}

const ofKind = (fixtures: Fixture[], kind: Fixture['kind']): Fixture[] =>
  fixtures.filter((f) => f.kind === kind)
const receptaclesOf = (fixtures: Fixture[]): Fixture[] =>
  fixtures.filter((f) => f.kind === 'receptacle' || f.kind === 'receptacle-gfci')

/** Direction a device faces after its Y rotation (renderer boxes face local +Z). */
const facing = (rotationY: number): Vector3 =>
  new Vector3(0, 0, 1).applyEuler(new Euler(0, rotationY, 0, 'XYZ'))

/** Assert the NEC 210.52(A) walk over one face: ends <= 6ft, gaps <= 12ft. */
function expectNecSpacing(us: number[], segStart: number, segEnd: number): void {
  const sorted = [...us].sort((a, b) => a - b)
  expect(sorted.length).toBeGreaterThan(0)
  expect((sorted[0] ?? 0) - segStart).toBeLessThanOrEqual(SIX_FT + 1e-9)
  expect(segEnd - (sorted[sorted.length - 1] ?? 0)).toBeLessThanOrEqual(SIX_FT + 1e-9)
  for (let i = 1; i < sorted.length; i++) {
    expect((sorted[i] ?? 0) - (sorted[i - 1] ?? 0)).toBeLessThanOrEqual(TWELVE_FT + 1e-9)
  }
}

describe('geometry helpers', () => {
  test('pointInPolygon ray cast', () => {
    const square = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ] as const
    expect(pointInPolygon([2, 2], square)).toBe(true)
    expect(pointInPolygon([5, 2], square)).toBe(false)
    expect(pointInPolygon([-0.1, 2], square)).toBe(false)
    // concave L-shape: notch is outside
    const ell = [
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [2, 4],
      [0, 4],
    ] as const
    expect(pointInPolygon([1, 3], ell)).toBe(true)
    expect(pointInPolygon([3, 3], ell)).toBe(false)
  })

  test('polygonCentroid of a rectangle is its center', () => {
    const c = polygonCentroid([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    expect(c[0]).toBeCloseTo(2, 6)
    expect(c[1]).toBeCloseTo(1.5, 6)
  })

  test('receptaclePositions: even fill satisfies the 6ft/12ft rule', () => {
    // 6m ≈ 19.7ft → 2 receptacles at quarter points
    expect(receptaclePositions({ a: 0, b: 6 })).toEqual([1.5, 4.5])
    // short segment → single receptacle at midpoint
    expect(receptaclePositions({ a: 1, b: 3 })).toEqual([2])
    // property check across lengths
    for (const L of [0.7, 2, 3.7, 6, 9.99, 15, 30]) {
      expectNecSpacing(receptaclePositions({ a: 0, b: L }), 0, L)
    }
  })
})

describe('usableSegments — doorways break the wall line (210.52(A)(2))', () => {
  test('solid wall is one segment', () => {
    expect(usableSegments(makeWall())).toEqual([{ a: 0, b: 6 }])
  })

  test('a door splits the wall at its rough opening', () => {
    const halfRo = (0.9 + RO_PAD) / 2
    const segs = usableSegments(makeWall({ openings: [door(3)] }))
    expect(segs).toHaveLength(2)
    expect(segs[0]?.a).toBeCloseTo(0, 6)
    expect(segs[0]?.b).toBeCloseTo(3 - halfRo, 6)
    expect(segs[1]?.a).toBeCloseTo(3 + halfRo, 6)
    expect(segs[1]?.b).toBeCloseTo(6, 6)
  })

  test('windows do NOT break the wall line', () => {
    expect(usableSegments(makeWall({ openings: [window_(3)] }))).toEqual([{ a: 0, b: 6 }])
  })

  test('stub segments under 2ft are dropped', () => {
    // door near the start leaves a ~0.13m stub → only the far segment survives
    const segs = usableSegments(makeWall({ openings: [door(0.6)] }))
    expect(segs).toHaveLength(1)
    expect(segs[0]?.a).toBeCloseTo(0.6 + (0.9 + RO_PAD) / 2, 6)
  })
})

describe('receptacles — solid 6m interior wall', () => {
  const wall = makeWall() // (0,0) → (6,0), interior
  const fixtures = layoutElectrical([wall], [])
  const receptacles = receptaclesOf(fixtures)

  test('interior wall gets receptacles on BOTH faces', () => {
    expect(receptacles).toHaveLength(4) // 2 per face
    expect(receptacles.filter((r) => (r.position[2] ?? 0) > 0)).toHaveLength(2)
    expect(receptacles.filter((r) => (r.position[2] ?? 0) < 0)).toHaveLength(2)
  })

  test('spacing <= 12ft and ends <= 6ft on each face', () => {
    for (const sign of [1, -1]) {
      const us = receptacles
        .filter((r) => Math.sign(r.position[2] ?? 0) === sign)
        .map((r) => r.position[0] ?? 0)
      expectNecSpacing(us, 0, 6)
    }
  })

  test('mounted 15in AFF, offset to the wall face, sourced to the wall', () => {
    for (const r of receptacles) {
      expect(r.system).toBe('electrical')
      expect(r.position[1]).toBeCloseTo(inches(15), 6)
      expect(Math.abs(r.position[2] ?? 0)).toBeCloseTo(OFF, 6)
      expect(r.sourceId).toBe('wall_test')
    }
  })

  test('rotationY points each device away from its wall (three.js check)', () => {
    for (const r of receptacles) {
      const dir = facing(r.rotationY)
      // outward normal of the face the device sits on
      expect(dir.z * Math.sign(r.position[2] ?? 0)).toBeCloseTo(1, 6)
      expect(dir.x).toBeCloseTo(0, 6)
    }
  })
})

describe('receptacles — wall with a door (spans measured around the doorway)', () => {
  const wall = makeWall({ openings: [door(3)] })
  const receptacles = receptaclesOf(layoutElectrical([wall], []))
  const halfRo = (0.9 + RO_PAD) / 2

  test('each side of the doorway gets its own walk', () => {
    // both flanking segments ≈ 2.53m (8.3ft) → 1 receptacle each per face
    expect(receptacles).toHaveLength(4)
    const us = [...new Set(receptacles.map((r) => Math.round((r.position[0] ?? 0) * 1e6) / 1e6))]
    expect(us.sort((a, b) => a - b)).toEqual([
      Math.round(((3 - halfRo) / 2) * 1e6) / 1e6,
      Math.round(((3 + halfRo + 6) / 2) * 1e6) / 1e6,
    ])
  })

  test('no receptacle lands inside the doorway', () => {
    for (const r of receptacles) {
      expect(Math.abs((r.position[0] ?? 0) - 3)).toBeGreaterThan(halfRo)
    }
  })

  test('per-segment ends stay within 6ft of the doorway edges', () => {
    const side = receptacles.filter((r) => (r.position[2] ?? 0) > 0).map((r) => r.position[0] ?? 0)
    expectNecSpacing(
      side.filter((u) => u < 3),
      0,
      3 - halfRo,
    )
    expectNecSpacing(
      side.filter((u) => u > 3),
      3 + halfRo,
      6,
    )
  })

  test('a window changes nothing — receptacles go under windows', () => {
    const solid = receptaclesOf(layoutElectrical([makeWall()], []))
    const windowed = receptaclesOf(layoutElectrical([makeWall({ openings: [window_(3)] })], []))
    expect(windowed.map((r) => r.position)).toEqual(solid.map((r) => r.position))
  })
})

describe('receptacles — exterior walls get one face, resolved into the room', () => {
  const livingNorth = room('other', [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ])

  test('face lands on the side whose offset point is inside a room', () => {
    const wall = makeWall({ exterior: true })
    const receptacles = receptaclesOf(layoutElectrical([wall], [livingNorth]))
    expect(receptacles).toHaveLength(2) // one face only
    for (const r of receptacles) {
      expect(r.position[2]).toBeCloseTo(OFF, 6) // room is at z > 0
      expect(facing(r.rotationY).z).toBeCloseTo(1, 6)
    }
  })

  test('room on the other side flips the face', () => {
    const wall = makeWall({ exterior: true })
    const south = room('other', [
      [0, -4],
      [6, -4],
      [6, 0],
      [0, 0],
    ])
    const receptacles = receptaclesOf(layoutElectrical([wall], [south]))
    expect(receptacles).toHaveLength(2)
    for (const r of receptacles) {
      expect(r.position[2]).toBeCloseTo(-OFF, 6)
      expect(facing(r.rotationY).z).toBeCloseTo(-1, 6)
    }
  })

  test('no room data → defaults to the +normal face', () => {
    const receptacles = receptaclesOf(layoutElectrical([makeWall({ exterior: true })], []))
    expect(receptacles).toHaveLength(2)
    for (const r of receptacles) expect(r.position[2]).toBeCloseTo(OFF, 6)
  })

  test('wall along +Z: face offset and rotation follow the wall frame', () => {
    // exterior wall (0,0)→(0,3); room to its -X side
    const wall = makeWall({ start: [0, 0], end: [0, 3], exterior: true })
    const west = room('other', [
      [-4, 0],
      [0, 0],
      [0, 3],
      [-4, 3],
    ])
    const receptacles = receptaclesOf(layoutElectrical([wall], [west]))
    expect(receptacles).toHaveLength(1) // 3m ≈ 9.8ft → single device
    const r = receptacles[0] as Fixture
    expect(r.position[0]).toBeCloseTo(-OFF, 6)
    expect(r.position[2]).toBeCloseTo(1.5, 6) // segment midpoint along the wall
    const dir = facing(r.rotationY)
    expect(dir.x).toBeCloseTo(-1, 6) // faces into the room, away from the wall
    expect(dir.z).toBeCloseTo(0, 6)
  })
})

describe('GFCI — NEC 210.8(A) room zones', () => {
  const kitchen = room('kitchen', [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ])

  test('receptacles whose face point falls in a kitchen become GFCI', () => {
    const wall = makeWall({ exterior: true })
    const receptacles = receptaclesOf(layoutElectrical([wall], [kitchen]))
    expect(receptacles).toHaveLength(2)
    for (const r of receptacles) expect(r.kind).toBe('receptacle-gfci')
  })

  test('ordinary rooms keep plain receptacles', () => {
    const bedroom = room('bedroom', kitchen.polygon)
    const receptacles = receptaclesOf(layoutElectrical([makeWall({ exterior: true })], [bedroom]))
    for (const r of receptacles) expect(r.kind).toBe('receptacle')
  })

  test('an interior kitchen/living partition is GFCI on the kitchen face only', () => {
    // wall (0,0)→(6,0); kitchen above (z>0), living below (z<0)
    const living = room('other', [
      [0, -4],
      [6, -4],
      [6, 0],
      [0, 0],
    ])
    const receptacles = receptaclesOf(layoutElectrical([makeWall()], [kitchen, living]))
    expect(receptacles).toHaveLength(4)
    for (const r of receptacles) {
      expect(r.kind).toBe((r.position[2] ?? 0) > 0 ? 'receptacle-gfci' : 'receptacle')
    }
  })
})

describe('switches — one per door at the latch side, 48in AFF', () => {
  const halfRo = (0.9 + RO_PAD) / 2

  test('interior wall: switch on BOTH faces, 8in past the +u RO edge', () => {
    const fixtures = layoutElectrical([makeWall({ end: [4, 0], openings: [door(2)] })], [])
    const switches = ofKind(fixtures, 'switch')
    expect(switches).toHaveLength(2)
    for (const s of switches) {
      expect(s.position[0]).toBeCloseTo(2 + halfRo + inches(8), 6)
      expect(s.position[1]).toBeCloseTo(inches(48), 6)
      expect(Math.abs(s.position[2] ?? 0)).toBeCloseTo(OFF, 6)
      expect(s.sourceId).toBe('door_test')
    }
  })

  test('door near the wall end flips the switch to the other side of the RO', () => {
    const fixtures = layoutElectrical([makeWall({ end: [4, 0], openings: [door(3.4)] })], [])
    const switches = ofKind(fixtures, 'switch')
    expect(switches).toHaveLength(2)
    for (const s of switches) {
      expect(s.position[0]).toBeCloseTo(3.4 - halfRo - inches(8), 6)
    }
  })

  test('exterior wall gets a single switch on the interior face', () => {
    const kitchen = room('kitchen', [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ])
    const fixtures = layoutElectrical(
      [makeWall({ end: [4, 0], exterior: true, openings: [door(2)] })],
      [kitchen],
    )
    const switches = ofKind(fixtures, 'switch')
    expect(switches).toHaveLength(1)
    expect(switches[0]?.position[2]).toBeCloseTo(OFF, 6)
  })
})

describe('lights and smoke alarms', () => {
  test('every room gets a ceiling light at its centroid', () => {
    const living = room('other', [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    const lights = ofKind(layoutElectrical([], [living]), 'light')
    expect(lights).toHaveLength(1)
    const light = lights[0] as Fixture
    expect(light.position[0]).toBeCloseTo(2, 6)
    expect(light.position[1]).toBeCloseTo(2.7, 6) // ceilingHeight
    expect(light.position[2]).toBeCloseTo(1.5, 6)
    expect(light.sourceId).toBe(living.id)
  })

  test('each bedroom gets a ceiling smoke alarm (IRC R314.3)', () => {
    const bedroom = room('bedroom', [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ])
    const alarms = ofKind(layoutElectrical([], [bedroom]), 'smoke-alarm')
    expect(alarms).toHaveLength(1)
    const alarm = alarms[0] as Fixture
    expect(alarm.position[1]).toBeCloseTo(2.7, 6)
    // nudged 12" off the centroid so it doesn't overlap the room light
    expect(alarm.position[0]).toBeCloseTo(2 + inches(12), 6)
    expect(alarm.sourceId).toBe(bedroom.id)
  })

  test('a hallway adds one alarm outside the sleeping area', () => {
    const bedroom = room('bedroom', [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ])
    const hallway = room('hallway', [
      [4, 0],
      [6, 0],
      [6, 4],
      [4, 4],
    ])
    const alarms = ofKind(layoutElectrical([], [bedroom, hallway]), 'smoke-alarm')
    expect(alarms).toHaveLength(2)
    const hall = alarms.find((a) => a.sourceId === hallway.id) as Fixture
    expect(hall.position[0]).toBeCloseTo(5, 6)
    expect(hall.position[2]).toBeCloseTo(2, 6)
  })

  test('no bedrooms, no hallway → the per-story alarm still lands (IRC R314.3(3))', () => {
    // Pre-B13 this level computed ZERO alarms — R314.3(3) requires one on
    // every story. The largest room hosts it.
    const living = room('other', [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ])
    const alarms = ofKind(layoutElectrical([], [living]), 'smoke-alarm')
    expect(alarms).toHaveLength(1)
    expect(alarms[0]?.label).toContain('one per story (IRC R314.3(3))')
    expect(alarms[0]?.sourceId).toBe(living.id)
  })

  test('no rooms at all → no alarms (nothing to serve)', () => {
    expect(ofKind(layoutElectrical([], []), 'smoke-alarm')).toHaveLength(0)
  })
})

describe('service panel', () => {
  test('prefers the longest garage-bounding wall over a longer exterior wall', () => {
    const garageWall = makeWall({ id: 'wall_garage', start: [0, 0], end: [5, 0] })
    const bigExterior = makeWall({ id: 'wall_ext', start: [10, 0], end: [18, 0], exterior: true })
    const garage = room(
      'garage',
      [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 5],
      ],
      { boundaryWallIds: ['wall_garage'] },
    )
    const panels = ofKind(layoutElectrical([garageWall, bigExterior], [garage]), 'panel')
    expect(panels).toHaveLength(1)
    const panel = panels[0] as Fixture
    expect(panel.sourceId).toBe('wall_garage')
    expect(panel.position[0]).toBeCloseTo(2.5, 6) // wall midpoint
    expect(panel.position[1]).toBeCloseTo(inches(60), 6) // 60in AFF
    expect(panel.position[2]).toBeCloseTo(OFF, 6) // garage side (z > 0)
    expect(facing(panel.rotationY).z).toBeCloseTo(1, 6) // faces into the garage
  })

  test('no garage → longest exterior wall, interior face', () => {
    const short = makeWall({ id: 'wall_short', start: [0, 0], end: [4, 0], exterior: true })
    const long = makeWall({ id: 'wall_long', start: [0, 4], end: [8, 4], exterior: true })
    const panels = ofKind(layoutElectrical([short, long], []), 'panel')
    expect(panels[0]?.sourceId).toBe('wall_long')
    expect(panels[0]?.position[0]).toBeCloseTo(4, 6)
  })

  test('no walls → no panel', () => {
    expect(ofKind(layoutElectrical([], []), 'panel')).toHaveLength(0)
  })
})

describe('count sanity — two-room plan (living + kitchen)', () => {
  // 8m x 4m shell, divider at x=3.5; exterior door in the south kitchen wall,
  // interior door in the divider.
  const south = makeWall({
    id: 'w_south',
    start: [0, 0],
    end: [8, 0],
    exterior: true,
    openings: [door(6, 0.9, 'door_entry')],
  })
  const east = makeWall({ id: 'w_east', start: [8, 0], end: [8, 4], exterior: true })
  const north = makeWall({ id: 'w_north', start: [8, 4], end: [0, 4], exterior: true })
  const west = makeWall({ id: 'w_west', start: [0, 4], end: [0, 0], exterior: true })
  const divider = makeWall({
    id: 'w_div',
    start: [3.5, 0],
    end: [3.5, 4],
    openings: [door(2, 0.9, 'door_kitchen')],
  })
  const living = room('other', [
    [0, 0],
    [3.5, 0],
    [3.5, 4],
    [0, 4],
  ])
  const kitchen = room('kitchen', [
    [3.5, 0],
    [8, 0],
    [8, 4],
    [3.5, 4],
  ])
  const fixtures = layoutElectrical([south, east, north, west, divider], [living, kitchen])

  test('fixture counts per kind', () => {
    // receptacles: south 3 (door splits 8m), east 2, north 3, west 2,
    // divider 2 per face x 2 faces = 4 → 14 total
    expect(receptaclesOf(fixtures)).toHaveLength(14)
    // switches: entry door 1 face + interior door 2 faces
    expect(ofKind(fixtures, 'switch')).toHaveLength(3)
    expect(ofKind(fixtures, 'light')).toHaveLength(2)
    // B13a: the per-story alarm (IRC R314.3(3)) — bedroom-less levels used
    // to compute zero alarms; the larger room (kitchen, 18 m²) hosts it
    expect(ofKind(fixtures, 'smoke-alarm')).toHaveLength(1)
    expect(ofKind(fixtures, 'panel')).toHaveLength(1)
    // street→meter→panel chain: one meter on the exterior face by the panel
    expect(ofKind(fixtures, 'electric-meter')).toHaveLength(1)
    // B14a: front + back outdoor WR GFCI receptacles (NEC 210.52(E))
    expect(ofKind(fixtures, 'receptacle-wr-gfci')).toHaveLength(2)
    expect(fixtures).toHaveLength(24)
  })

  test('exterior walls emit on the interior face only', () => {
    for (const r of receptaclesOf(fixtures)) {
      const [x, , z] = r.position
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(8)
      expect(z).toBeGreaterThan(0)
      expect(z).toBeLessThan(4)
    }
  })

  test('kitchen-side receptacles are GFCI, living-side are plain', () => {
    for (const r of receptaclesOf(fixtures)) {
      const x = r.position[0] ?? 0
      if (x > 3.5 + 0.01) expect(r.kind).toBe('receptacle-gfci')
      if (x < 3.5 - 0.01) expect(r.kind).toBe('receptacle')
    }
    expect(ofKind(fixtures, 'receptacle-gfci')).toHaveLength(8)
    expect(ofKind(fixtures, 'receptacle')).toHaveLength(6)
  })

  test('every fixture is tagged electrical with a valid source', () => {
    const ids = new Set(['w_south', 'w_east', 'w_north', 'w_west', 'w_div'])
    for (const f of fixtures) {
      expect(f.system).toBe('electrical')
      if (f.kind === 'receptacle' || f.kind === 'receptacle-gfci' || f.kind === 'panel') {
        expect(ids.has(f.sourceId)).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Round-1 fabrication features (circuits, panel schedule, 3-way, wiring)
// ---------------------------------------------------------------------------

import { assignCircuits, buildWallGraph, circuitSchedule, polygonArea, routeWiring } from './electrical'

/** The two-room shell again, plus a bathroom strip — enough category variety. */
function circuitPlan() {
  const south = makeWall({
    id: 'w_south',
    start: [0, 0],
    end: [8, 0],
    exterior: true,
    openings: [door(6, 0.9, 'door_entry')],
  })
  const east = makeWall({ id: 'w_east', start: [8, 0], end: [8, 4], exterior: true })
  const north = makeWall({ id: 'w_north', start: [8, 4], end: [0, 4], exterior: true })
  const west = makeWall({ id: 'w_west', start: [0, 4], end: [0, 0], exterior: true })
  const divider = makeWall({
    id: 'w_div',
    start: [3.5, 0],
    end: [3.5, 4],
    openings: [door(2, 0.9, 'door_kitchen')],
  })
  const living = room('other', [
    [0, 0],
    [3.5, 0],
    [3.5, 4],
    [0, 4],
  ], { id: 'room_living' })
  const kitchen = room('kitchen', [
    [3.5, 0],
    [8, 0],
    [8, 4],
    [3.5, 4],
  ], { id: 'room_kitchen' })
  const walls = [south, east, north, west, divider]
  const rooms = [living, kitchen]
  return { walls, rooms, fixtures: layoutElectrical(walls, rooms) }
}

describe('circuiting — NEC 210.11 required circuits in fixture.meta', () => {
  const { fixtures } = circuitPlan()

  test('kitchen receptacles alternate across BOTH small-appliance circuits at 20A/12AWG', () => {
    const kitchenRecs = receptaclesOf(fixtures).filter((r) => (r.position[0] ?? 0) > 3.51)
    expect(kitchenRecs.length).toBeGreaterThanOrEqual(4)
    const circuits = new Set(kitchenRecs.map((r) => r.meta?.circuit))
    expect(circuits).toEqual(new Set(['SA-1', 'SA-2']))
    for (const r of kitchenRecs) {
      expect(r.meta?.breakerA).toBe(20)
      expect(r.meta?.gaugeAwg).toBe(12)
      expect(r.meta?.va).toBe(180)
      expect(r.meta?.gfci).toBe(true)
      expect(r.meta?.afci).toBe(true)
    }
  })

  test('general receptacles fill GEN-1 at 15A/14AWG', () => {
    const livingRecs = receptaclesOf(fixtures).filter((r) => (r.position[0] ?? 0) < 3.49)
    expect(livingRecs.length).toBeGreaterThan(0)
    for (const r of livingRecs) {
      expect(r.meta?.circuit).toBe('GEN-1')
      expect(r.meta?.breakerA).toBe(15)
      expect(r.meta?.gaugeAwg).toBe(14)
      expect(r.meta?.afci).toBe(true)
      expect(r.meta?.gfci).toBeUndefined()
    }
  })

  test('a 9th general receptacle spills into GEN-2', () => {
    const fixtures: Fixture[] = Array.from({ length: 9 }, (_, i) => ({
      system: 'electrical' as const,
      kind: 'receptacle' as const,
      position: [i, 0.38, 0] as [number, number, number],
      rotationY: 0,
      sourceId: `w${i}`,
    }))
    assignCircuits(fixtures, [])
    expect(fixtures[7]?.meta?.circuit).toBe('GEN-1')
    expect(fixtures[8]?.meta?.circuit).toBe('GEN-2')
  })

  test('bathroom receptacles land on the dedicated 20A BA-1 (GFCI, no AFCI)', () => {
    const bath = room('bathroom', [
      [0, 0],
      [3, 0],
      [3, 2.5],
      [0, 2.5],
    ], { id: 'room_bath' })
    const wall = makeWall({ id: 'w_b', start: [0, 0], end: [3, 0], exterior: true })
    const fixtures = layoutElectrical([wall], [bath])
    const recs = receptaclesOf(fixtures)
    expect(recs.length).toBeGreaterThan(0)
    for (const r of recs) {
      expect(r.meta?.circuit).toBe('BA-1')
      expect(r.meta?.breakerA).toBe(20)
      expect(r.meta?.afci).toBeUndefined()
      expect(r.meta?.gfci).toBe(true)
    }
  })

  test('laundry receptacles land on the dedicated 20A LA-1 (AFCI + GFCI, 210.11(C)(2))', () => {
    const laundry = room('laundry', [
      [0, 0],
      [3, 0],
      [3, 2.5],
      [0, 2.5],
    ], { id: 'room_laundry' })
    const wall = makeWall({ id: 'w_l', start: [0, 0], end: [3, 0], exterior: true })
    const recs = receptaclesOf(layoutElectrical([wall], [laundry]))
    expect(recs.length).toBeGreaterThan(0)
    for (const r of recs) {
      expect(r.meta?.circuit).toBe('LA-1')
      expect(r.meta?.breakerA).toBe(20)
      expect(r.meta?.gaugeAwg).toBe(12)
      expect(r.meta?.afci).toBe(true) // 210.12(A) — laundry areas
      expect(r.meta?.gfci).toBe(true) // 210.8(A)(10)
    }
  })

  test('garage receptacles land on the dedicated 20A GA-1 (GFCI, no AFCI, 210.52(G)(1))', () => {
    const garage = room('garage', [
      [0, 0],
      [6, 0],
      [6, 6],
      [0, 6],
    ], { id: 'room_garage' })
    const wall = makeWall({ id: 'w_g', start: [0, 0], end: [6, 0], exterior: true })
    const recs = receptaclesOf(layoutElectrical([wall], [garage]))
    expect(recs.length).toBeGreaterThan(0)
    for (const r of recs) {
      expect(r.meta?.circuit).toBe('GA-1')
      expect(r.meta?.breakerA).toBe(20)
      expect(r.meta?.gaugeAwg).toBe(12)
      expect(r.meta?.afci).toBeUndefined() // garages are not 210.12 areas
      expect(r.meta?.gfci).toBe(true) // 210.8(A)(2)
    }
  })

  test('lights and their switches share the room lighting circuit; VA from 3VA/sqft', () => {
    const { fixtures, rooms } = circuitPlan()
    const light = ofKind(fixtures, 'light').find((l) => l.sourceId === 'room_kitchen')
    expect(light?.meta?.circuit).toMatch(/^LTG-/)
    // kitchen 4.5m × 4m = 18 m² = 193.75 ft² → 581 VA
    expect(light?.meta?.va).toBe(Math.round(polygonArea(rooms[1]?.polygon ?? []) * 10.7639 * 3))
    // the switch standing in the kitchen rides the same circuit
    const kitchenSwitch = ofKind(fixtures, 'switch').find((s) => (s.position[0] ?? 0) > 3.51)
    expect(kitchenSwitch?.meta?.circuit).toBe(light?.meta?.circuit)
  })

  test('big rooms split lighting circuits at ~1200 VA', () => {
    const big1 = room('other', [
      [0, 0],
      [15, 0],
      [15, 8],
      [0, 8],
    ], { id: 'r1' })
    const big2 = room('other', [
      [15, 0],
      [30, 0],
      [30, 8],
      [15, 8],
    ], { id: 'r2' })
    const fixtures = layoutElectrical([], [big1, big2])
    const lights = ofKind(fixtures, 'light')
    expect(lights[0]?.meta?.circuit).toBe('LTG-1')
    expect(lights[1]?.meta?.circuit).toBe('LTG-2')
  })

  test('panel meta counts the distinct circuits', () => {
    const { fixtures } = circuitPlan()
    const panel = ofKind(fixtures, 'panel')[0]
    const distinct = new Set(
      fixtures.filter((f) => f.kind !== 'panel' && f.meta?.circuit).map((f) => f.meta?.circuit),
    )
    expect(panel?.meta?.circuits).toBe(distinct.size)
  })
})

describe('circuitSchedule — panel schedule rows', () => {
  const { fixtures } = circuitPlan()
  const schedule = circuitSchedule(fixtures)

  test('one row per circuit, dedicated circuits sorted first', () => {
    const names = schedule.map((r) => r.circuit)
    expect(names[0]).toBe('SA-1')
    expect(names[1]).toBe('SA-2')
    expect(names).toContain('GEN-1')
    expect(names[names.length - 1]).toMatch(/^LTG-/)
  })

  test('rows aggregate device counts and VA', () => {
    const sa1 = schedule.find((r) => r.circuit === 'SA-1')
    const sa2 = schedule.find((r) => r.circuit === 'SA-2')
    // 8 kitchen receptacles alternate → 4 + 4
    expect((sa1?.devices ?? 0) + (sa2?.devices ?? 0)).toBe(8)
    expect(sa1?.va).toBe((sa1?.devices ?? 0) * 180)
    expect(sa1?.breakerA).toBe(20)
    expect(sa1?.gaugeAwg).toBe(12)
    expect(sa1?.gfci).toBe(true)
    const gen = schedule.find((r) => r.circuit === 'GEN-1')
    expect(gen?.afci).toBe(true)
    expect(gen?.gaugeAwg).toBe(14)
  })
})

describe('3-way switching — rooms with 2+ entries', () => {
  test('a room with two doors gets a 3-way pair; single-door rooms stay 2-way', () => {
    // Living room with doors in the south wall AND the divider: both switch
    // faces land inside it.
    const south = makeWall({
      id: 'w_south',
      start: [0, 0],
      end: [8, 0],
      exterior: true,
      openings: [door(1.5, 0.9, 'door_front')],
    })
    const divider = makeWall({
      id: 'w_div',
      start: [3.5, 0],
      end: [3.5, 4],
      openings: [door(2, 0.9, 'door_side')],
    })
    const north = makeWall({ id: 'w_north', start: [8, 4], end: [0, 4], exterior: true })
    const living = room('other', [
      [0, 0],
      [3.5, 0],
      [3.5, 4],
      [0, 4],
    ], { id: 'room_l', name: 'living' })
    const den = room('other', [
      [3.5, 0],
      [8, 0],
      [8, 4],
      [3.5, 4],
    ], { id: 'room_d' })
    const fixtures = layoutElectrical([south, divider, north], [living, den])
    const inLiving = ofKind(fixtures, 'switch').filter(
      (s) => (s.position[0] ?? 0) < 3.5 && pointInPolygon([s.position[0], s.position[2]], living.polygon),
    )
    expect(inLiving.length).toBeGreaterThanOrEqual(2)
    for (const s of inLiving) {
      expect(s.meta?.threeWay).toBe(true)
      expect(s.label).toContain('3-way')
    }
    // the den has only the divider door's switch → stays 2-way
    const inDen = ofKind(fixtures, 'switch').filter((s) =>
      pointInPolygon([s.position[0], s.position[2]], den.polygon),
    )
    expect(inDen).toHaveLength(1)
    expect(inDen[0]?.meta?.threeWay).toBeUndefined()
  })
})

describe('routeWiring — LOD 400 wall-following homeruns + chains', () => {
  const plan = circuitPlan()
  const { fixtures } = plan
  const wires = routeWiring(fixtures, plan.walls)
  const panel = ofKind(fixtures, 'panel')[0] as Fixture

  /** Distance from a plan point to the nearest wall centerline. */
  function wallDistance(x: number, z: number): number {
    let best = Number.POSITIVE_INFINITY
    for (const w of plan.walls) {
      const [ax, az] = w.start
      const t = Math.max(0, Math.min(w.length, (x - ax) * w.dir[0] + (z - az) * w.dir[1]))
      best = Math.min(best, Math.hypot(ax + w.dir[0] * t - x, az + w.dir[1] * t - z))
    }
    return best
  }

  test('every drill-height leg hugs a wall — zero air-crossing (round-2 blocker)', () => {
    const drillLegs = wires.filter(
      (w) => w.dims[0] > w.dims[1] && Math.abs((w.position[1] as number) - 18 * 0.0254) < 1e-6,
    )
    expect(drillLegs.length).toBeGreaterThan(5)
    for (const leg of drillLegs) {
      // center AND both ends stay inside a wall corridor
      const yaw = leg.rotation[1] as number
      const dx = Math.cos(yaw)
      const dz = -Math.sin(yaw)
      const half = leg.length / 2
      for (const t of [-half, 0, half]) {
        const x = (leg.position[0] as number) + dx * t
        const z = (leg.position[2] as number) + dz * t
        expect(wallDistance(x, z)).toBeLessThan(0.11) // ≤ half thickness + tol
      }
      expect(leg.label).not.toContain('air run')
    }
  })

  test('ceiling devices rise inside a wall and cross the ceiling through joist bays', () => {
    const light = ofKind(fixtures, 'light')[0] as Fixture
    const ceilingLegs = wires.filter(
      (w) =>
        w.dims[0] > w.dims[1] &&
        Math.abs((w.position[1] as number) - light.position[1]) < 1e-6,
    )
    expect(ceilingLegs.length).toBeGreaterThanOrEqual(1)
    // a ceiling leg ends at the light's plan position
    const reaches = ceilingLegs.some((w) => {
      const yaw = w.rotation[1] as number
      const dx = Math.cos(yaw)
      const dz = -Math.sin(yaw)
      const half = w.length / 2
      return [1, -1].some(
        (s) =>
          Math.abs((w.position[0] as number) + s * dx * half - light.position[0]) < 1e-4 &&
          Math.abs((w.position[2] as number) + s * dz * half - light.position[2]) < 1e-4,
      )
    })
    expect(reaches).toBe(true)
  })

  test('every circuit drops a homerun at the panel wall anchor', () => {
    const circuits = new Set(
      fixtures.filter((f) => f.kind !== 'panel' && f.meta?.circuit).map((f) => String(f.meta?.circuit)),
    )
    for (const circuit of circuits) {
      const drop = wires.find(
        (w) =>
          w.sourceId === circuit &&
          w.dims[1] > w.dims[0] && // vertical leg
          Math.hypot(
            (w.position[0] as number) - panel.position[0],
            (w.position[2] as number) - panel.position[2],
          ) < 0.12, // the anchor sits on the wall centerline behind the panel face
      )
      expect(drop).toBeDefined()
    }
  })

  test('gauge follows the circuit: 12/2 to the kitchen, 14/2 to general', () => {
    expect(wires.some((w) => w.sourceId === 'SA-1' && w.label?.includes('12/2'))).toBe(true)
    expect(wires.some((w) => w.sourceId === 'GEN-1' && w.label?.includes('14/2'))).toBe(true)
  })

  test('wall devices get a vertical leg at their stud bay', () => {
    for (const f of fixtures) {
      if (f.kind === 'panel' || typeof f.meta?.circuit !== 'string') continue
      if (f.kind === 'light' || f.kind === 'smoke-alarm') continue
      const leg = wires.find(
        (w) =>
          w.dims[1] > w.dims[0] &&
          Math.hypot(
            (w.position[0] as number) - f.position[0],
            (w.position[2] as number) - f.position[2],
          ) < 0.12,
      )
      expect(leg).toBeDefined()
    }
  })

  test('disconnected islands fall back to labeled CEILING crossings instead of vanishing', () => {
    // E4: the fallback is a rise-cross-drop through the joist space, never
    // a bed-height air run — still labeled so the takeoff/warnings see it.
    const island = makeWall({ id: 'w_island', start: [20, 20], end: [24, 20] })
    const islandFixtures = layoutElectrical([...plan.walls, island], plan.rooms)
    const routed = routeWiring(islandFixtures, [...plan.walls, island])
    expect(routed.some((w) => w.label?.includes('ceiling crossing'))).toBe(true)
    expect(routed.some((w) => w.label?.includes('air run'))).toBe(false)
  })

  test('no panel → no wiring', () => {
    expect(routeWiring(fixtures.filter((f) => f.kind !== 'panel'), plan.walls)).toHaveLength(0)
  })
})

describe('door-less hallways get a switched control (round-3 advisory: untested)', () => {
  test('a corridor without doors gains exactly one switch inside, on the lighting circuit', () => {
    const north = makeWall({ id: 'w_n', start: [0, 2], end: [8, 2] })
    const south = makeWall({ id: 'w_s', start: [0, 0], end: [8, 0], exterior: true })
    const corridor = room('hallway', [
      [0, 0],
      [8, 0],
      [8, 2],
      [0, 2],
    ], { id: 'room_corridor' })
    const fixtures = layoutElectrical([north, south], [corridor])
    const switches = ofKind(fixtures, 'switch').filter((s) =>
      pointInPolygon([s.position[0], s.position[2]], corridor.polygon),
    )
    expect(switches).toHaveLength(1)
    expect(switches[0]?.label).toContain('210.70(A)(2)')
    expect(switches[0]?.position[1]).toBeCloseTo(48 * 0.0254, 6)
    // rides the hallway's lighting circuit like the light it controls
    const light = ofKind(fixtures, 'light').find((l) => l.sourceId === 'room_corridor')
    expect(switches[0]?.meta?.circuit).toBe(light?.meta?.circuit)
  })
})

describe('wire runs detour OVER door openings (round-4 advisory)', () => {
  test('no drill-height leg crosses a door RO; the detour rides above the header', () => {
    const wall = makeWall({
      id: 'w_door',
      start: [0, 0],
      end: [8, 0],
      exterior: true,
      openings: [door(4, 0.9, 'door_mid')],
    })
    const den = room('other', [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ], { id: 'room_den' })
    const fixtures = layoutElectrical([wall], [den])
    const wires = routeWiring(fixtures, [wall])
    const roLo = 4 - (0.9 + RO_PAD) / 2
    const roHi = 4 + (0.9 + RO_PAD) / 2
    const drill = 18 * 0.0254
    for (const w of wires) {
      if (w.dims[1] > w.dims[0]) continue // risers
      if (Math.abs((w.position[1] as number) - drill) > 1e-6) continue
      const half = w.dims[0] / 2
      const lo = (w.position[0] as number) - half
      const hi = (w.position[0] as number) + half
      // a drill-height leg may touch the RO edges but never cross into it
      expect(lo >= roHi - 1e-6 || hi <= roLo + 1e-6).toBe(true)
    }
    // and the over-header crossing exists: a horizontal leg above the door
    const overY = 2.1 + RO_PAD + 4 * 0.0254
    const over = wires.find(
      (w) =>
        w.dims[0] > w.dims[1] &&
        Math.abs((w.position[1] as number) - overY) < 1e-6 &&
        Math.abs((w.position[0] as number) - 4) < 0.01,
    )
    expect(over).toBeDefined()
  })
})

describe('wall-graph junctions snap out of door ROs (round-6 pin)', () => {
  test('a tee landing inside a doorway moves to the adjacent stud bay', () => {
    const through = makeWall({
      id: 'w_through',
      start: [0, 0],
      end: [8, 0],
      openings: [door(4, 0.9, 'door_tee')],
    })
    const tee = makeWall({ id: 'w_tee', start: [4, 0], end: [4, 3] })
    const graph = buildWallGraph([through, tee])
    const roLo = 4 - (0.9 + RO_PAD) / 2
    const roHi = 4 + (0.9 + RO_PAD) / 2
    const junctions = graph.get('w_through') ?? []
    expect(junctions.length).toBeGreaterThan(0)
    for (const j of junctions) {
      expect(j.u <= roLo + 1e-9 || j.u >= roHi - 1e-9).toBe(true)
    }
  })
})
