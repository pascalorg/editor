import { describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import type { Fixture, Member, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { computeLevel } from '../framing/compute'
import { FramingNode } from '../framing/schema'
import {
  ALARM_CIRCUIT,
  circuitSchedule,
  layoutElectrical,
  pointInPolygon,
  routeWiring,
  sharedBoundaryLength,
} from './electrical'
import { DEVICE_TOL, endpointsOf, segDist, unreachableDevices } from './electrical.test-helpers'
import { computeTakeoff } from './takeoff'

/**
 * BATCH 13 gates — alarm truth (life-safety electrical).
 *
 * Defect (a): no 'hallway' room used to silently DROP the R314.3(2)
 * outside-sleeping-area alarm; no per-story rule existed; no CO-alarm kind
 * existed at all despite data/electrical-rules.json booking the exact
 * R315.3 trigger (attached garage / fuel appliance + bedrooms).
 * Defect (b): alarms landed on DIFFERENT circuits (LTG-3/LTG-4) with 14/2
 * cable — a hardwired interconnect physically requires ONE circuit + 14/3;
 * the same 14/3 gap applied to 3-way traveler legs.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [4, 0]
  const dx = (end[0] ?? 0) - (start[0] ?? 0)
  const dz = (end[1] ?? 0) - (start[1] ?? 0)
  const length = Math.hypot(dx, dz)
  return {
    id: 'w',
    start,
    end,
    dir: [dx / length, dz / length],
    length,
    thickness: 0.114,
    height: 2.5,
    exterior: true,
    openings: [],
    curved: false,
    ...overrides,
  }
}

const door = (u: number, id = `door_${u}`, roughWidth = 0.95): OpeningSlice => ({
  id,
  kind: 'door',
  u,
  width: roughWidth - 0.05,
  roughWidth,
  height: 2.1,
  roughHeight: 2.15,
  sillHeight: 0,
})

function room(
  category: RoomSlice['category'],
  polygon: [number, number][],
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

/** 8×8 shell + divider at x=4 — two 4×8 rooms with a connected wall graph. */
function shellWalls(): WallSlice[] {
  return [
    makeWall({ id: 'w_s', start: [0, 0], end: [8, 0] }),
    makeWall({ id: 'w_e', start: [8, 0], end: [8, 8] }),
    makeWall({ id: 'w_n', start: [8, 8], end: [0, 8] }),
    makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
    makeWall({ id: 'w_div', start: [4, 0], end: [4, 8], exterior: false, openings: [door(3, 'door_bed')] }),
  ]
}

const ofKind = (fixtures: Fixture[], kind: Fixture['kind']) => fixtures.filter((f) => f.kind === kind)
const alarmsOf = (fixtures: Fixture[]) =>
  fixtures.filter((f) => f.kind === 'smoke-alarm' || f.kind === 'co-alarm')

/** Union-find over a member SUBSET; true when every point touches ONE
 * connected component of it (the E2-style walk, scoped to a cable class). */
function oneComponentTouches(members: Member[], points: [number, number, number][]): boolean {
  if (members.length === 0 || points.length === 0) return false
  const parent = members.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r] as number
    return r
  }
  const ends = members.map(endpointsOf)
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const [a1, a2] = ends[i] as [Vector3, Vector3]
      const [b1, b2] = ends[j] as [Vector3, Vector3]
      const touch =
        a1.distanceTo(b1) < 0.02 ||
        a1.distanceTo(b2) < 0.02 ||
        a2.distanceTo(b1) < 0.02 ||
        a2.distanceTo(b2) < 0.02 ||
        segDist(a1, b1, b2) < 0.03 ||
        segDist(a2, b1, b2) < 0.03 ||
        segDist(b1, a1, a2) < 0.03 ||
        segDist(b2, a1, a2) < 0.03
      if (touch) parent[find(i)] = find(j)
    }
  }
  const compAt = (p: [number, number, number]): number | null => {
    const v = new Vector3(...p)
    for (let i = 0; i < members.length; i++) {
      const [a, b] = ends[i] as [Vector3, Vector3]
      if (v.distanceTo(a) < DEVICE_TOL || v.distanceTo(b) < DEVICE_TOL || segDist(v, a, b) < DEVICE_TOL) {
        return find(i)
      }
    }
    return null
  }
  const comps = points.map(compAt)
  return comps.every((c) => c !== null && c === comps[0])
}

// ---------------------------------------------------------------------------
// (a1) no-hallway scene census — the proxy alarm + the loud failure
// ---------------------------------------------------------------------------

describe('B13a — R314.3(2) outside-sleeping-area alarm without a hallway', () => {
  test('bedroom-adjacent proxy hosts the alarm (census + label), no warning', () => {
    const walls = shellWalls()
    const rooms = [
      room('bedroom', [[0, 0], [4, 0], [4, 8], [0, 8]]),
      room('other', [[4, 0], [8, 0], [8, 8], [4, 8]], { id: 'room_living', name: 'Living' }),
    ]
    const warnings: string[] = []
    const fixtures = layoutElectrical(walls, rooms, undefined, warnings)
    const alarms = ofKind(fixtures, 'smoke-alarm')
    // census: the bedroom alarm + the proxy alarm — the proxy no longer drops
    expect(alarms).toHaveLength(2)
    const proxy = alarms.find((a) => a.sourceId === 'room_living') as Fixture
    expect(proxy).toBeDefined()
    expect(proxy.label).toContain('IRC R314.3(2)')
    expect(proxy.label).toContain('hallway proxy: Living')
    // hosted at the proxy's ceiling, nudged off the room light's centroid
    expect(proxy.position[1]).toBeCloseTo(2.7, 6)
    expect(Math.hypot(proxy.position[0] - 6, proxy.position[2] - 4)).toBeGreaterThan(0.1)
    expect(warnings).toHaveLength(0)
  })

  test('adjacency is real geometry: face-drawn zones (wall-thickness gap) still adjoin', () => {
    // zones drawn to wall FACES leave a ~0.114 m gap — still adjacent
    expect(
      sharedBoundaryLength(
        [[0, 0], [4, 0], [4, 8], [0, 8]],
        [[4.114, 0], [8, 0], [8, 8], [4.114, 8]],
      ),
    ).toBeGreaterThan(7.9)
    // rooms a meter apart are NOT adjacent
    expect(
      sharedBoundaryLength(
        [[0, 0], [4, 0], [4, 8], [0, 8]],
        [[5, 0], [8, 0], [8, 8], [5, 8]],
      ),
    ).toBe(0)
  })

  test('garage/bathroom are proxies of last resort — a habitable neighbor wins', () => {
    const rooms = [
      room('bedroom', [[0, 0], [4, 0], [4, 8], [0, 8]]),
      room('garage', [[4, 0], [8, 0], [8, 4], [4, 4]], { id: 'room_garage' }),
      room('other', [[4, 4], [8, 4], [8, 8], [4, 8]], { id: 'room_den', name: 'Den' }),
    ]
    const fixtures = layoutElectrical([], rooms, undefined, [])
    const proxy = ofKind(fixtures, 'smoke-alarm').find((a) => a.label?.includes('hallway proxy'))
    expect(proxy?.sourceId).toBe('room_den')
  })

  test('proxy impossible (nothing adjoins the bedroom) → LEVEL WARNING, never silent', () => {
    const rooms = [
      room('bedroom', [[0, 0], [4, 0], [4, 4], [0, 4]]),
      room('other', [[20, 20], [24, 20], [24, 24], [20, 24]], { id: 'room_far' }),
    ]
    const warnings: string[] = []
    const fixtures = layoutElectrical([], rooms, undefined, warnings)
    const alarms = ofKind(fixtures, 'smoke-alarm')
    // only the bedroom's own alarm — no phantom outside-area alarm...
    expect(alarms).toHaveLength(1)
    expect(alarms[0]?.sourceId).toBe('room_bedroom')
    // ...and the drop is LOUD
    expect(warnings.some((w) => w.includes('R314.3(2)'))).toBe(true)
  })

  test('a drawn hallway keeps the legacy exact-centroid alarm (pre-B13 parity)', () => {
    const bedroom = room('bedroom', [[0, 0], [4, 0], [4, 4], [0, 4]])
    const hallway = room('hallway', [[4, 0], [6, 0], [6, 4], [4, 4]])
    const warnings: string[] = []
    const alarms = ofKind(layoutElectrical([], [bedroom, hallway], undefined, warnings), 'smoke-alarm')
    expect(alarms).toHaveLength(2)
    const hall = alarms.find((a) => a.sourceId === hallway.id) as Fixture
    expect(hall.position[0]).toBeCloseTo(5, 6)
    expect(hall.label).toBe('Smoke alarm — outside sleeping area (R314)')
    expect(warnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// (a2) per-story alarm — pinned on a real two-storey scene
// ---------------------------------------------------------------------------

describe('B13a — one smoke alarm per story (IRC R314.3(3))', () => {
  const wall = (id: string, level: string, start: [number, number], end: [number, number]) => ({
    id,
    type: 'wall',
    parentId: level,
    start,
    end,
    thickness: 0.114,
    height: 2.5,
    frontSide: 'exterior',
    backSide: 'interior',
    children: [],
  })
  const zone = (id: string, level: string, name: string, polygon: [number, number][]) => ({
    id,
    type: 'zone',
    parentId: level,
    name,
    polygon,
    boundaryWallIds: [],
  })
  const twoStorey = (): Record<string, Record<string, unknown>> => ({
    bldg: { id: 'bldg', type: 'building', children: ['lvl0', 'lvl1'] },
    lvl0: { id: 'lvl0', type: 'level', parentId: 'bldg', level: 0, height: 2.7 },
    lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg', level: 1, height: 2.7 },
    w0a: wall('w0a', 'lvl0', [0, 0], [8, 0]),
    w0b: wall('w0b', 'lvl0', [8, 0], [8, 5]),
    w0c: wall('w0c', 'lvl0', [8, 5], [0, 5]),
    w0d: wall('w0d', 'lvl0', [0, 5], [0, 0]),
    z0bed: zone('z0bed', 'lvl0', 'Bedroom', [[0, 0], [4, 0], [4, 5], [0, 5]]),
    z0hall: zone('z0hall', 'lvl0', 'Hallway', [[4, 0], [8, 0], [8, 5], [4, 5]]),
    w1a: wall('w1a', 'lvl1', [0, 0], [8, 0]),
    w1b: wall('w1b', 'lvl1', [8, 0], [8, 5]),
    w1c: wall('w1c', 'lvl1', [8, 5], [0, 5]),
    w1d: wall('w1d', 'lvl1', [0, 5], [0, 0]),
    z1den: zone('z1den', 'lvl1', 'Den', [[0, 0], [8, 0], [8, 5], [0, 5]]),
  })
  const bones = (levelId: string) =>
    FramingNode.parse({
      id: `bonesframing_${levelId}`,
      parentId: levelId,
      jurisdiction: 'INTL',
      detail: '400',
      showElectrical: true,
    }) as FramingNode

  test('the bedroom storey keeps its R314.3(1)/(2) alarms — no per-story extra', () => {
    const result = computeLevel(twoStorey(), bones('lvl0'))
    const alarms = ofKind(result.fixtures, 'smoke-alarm')
    expect(alarms).toHaveLength(2) // bedroom + hallway
    expect(alarms.some((a) => a.label?.includes('one per story'))).toBe(false)
  })

  test('the bedroom-less upper storey PINS its per-story alarm (used to be zero)', () => {
    const result = computeLevel(twoStorey(), bones('lvl1'))
    const alarms = ofKind(result.fixtures, 'smoke-alarm')
    expect(alarms).toHaveLength(1)
    expect(alarms[0]?.label).toContain('one per story (IRC R314.3(3))')
    expect(alarms[0]?.sourceId).toBe('z1den')
    expect(alarms[0]?.meta?.circuit).toBe(ALARM_CIRCUIT)
  })
})

// ---------------------------------------------------------------------------
// (a3) CO alarm presence/absence matrix (IRC R315.3)
// ---------------------------------------------------------------------------

describe('B13a — CO alarm matrix (IRC R315.3)', () => {
  const bedroomHall = (): RoomSlice[] => [
    room('bedroom', [[0, 0], [4, 0], [4, 8], [0, 8]]),
    room('hallway', [[4, 0], [8, 0], [8, 8], [4, 8]], { id: 'room_hall' }),
  ]

  test('attached garage (the fuel-appliance trigger rides it) + bedrooms → CO alarm', () => {
    const rooms = [
      ...bedroomHall(),
      room('garage', [[8, 0], [12, 0], [12, 8], [8, 8]], { id: 'room_garage' }),
    ]
    const fixtures = layoutElectrical(shellWalls(), rooms, undefined, [])
    const co = ofKind(fixtures, 'co-alarm')
    expect(co).toHaveLength(1)
    expect(co[0]?.label).toContain('IRC R315.3')
    // outside the sleeping area — co-located with the hallway smoke alarm's
    // host, nudged apart from light + smoke
    expect(co[0]?.sourceId).toBe('room_hall')
    const smokeHall = ofKind(fixtures, 'smoke-alarm').find((a) => a.sourceId === 'room_hall')
    expect(smokeHall).toBeDefined()
    expect(
      Math.hypot(
        (co[0]?.position[0] ?? 0) - (smokeHall?.position[0] ?? 0),
        (co[0]?.position[2] ?? 0) - (smokeHall?.position[2] ?? 0),
      ),
    ).toBeGreaterThan(0.1)
  })

  test('no garage, no fuel appliance → NO CO alarm', () => {
    const fixtures = layoutElectrical(shellWalls(), bedroomHall(), undefined, [])
    expect(ofKind(fixtures, 'co-alarm')).toHaveLength(0)
  })

  test('garage but no bedrooms → no sleeping area to serve → no CO alarm', () => {
    const rooms = [
      room('other', [[0, 0], [4, 0], [4, 8], [0, 8]], { id: 'room_liv' }),
      room('garage', [[4, 0], [8, 0], [8, 8], [4, 8]], { id: 'room_garage' }),
    ]
    const fixtures = layoutElectrical(shellWalls(), rooms, undefined, [])
    expect(ofKind(fixtures, 'co-alarm')).toHaveLength(0)
  })

  test('takeoff books the CO alarm on its own row (R315.3 detail)', () => {
    const rooms = [
      ...bedroomHall(),
      room('garage', [[8, 0], [12, 0], [12, 8], [8, 8]], { id: 'room_garage' }),
    ]
    const fixtures = layoutElectrical(shellWalls(), rooms, undefined, [])
    const rows = computeTakeoff([], fixtures)
    const co = rows.find((r) => r.item === 'CO alarms')
    expect(co?.quantity).toBe(1)
    expect(co?.detail).toContain('R315.3')
    expect(rows.find((r) => r.item === 'Smoke alarms')?.quantity).toBe(2) // bedroom + hallway
  })
})

// ---------------------------------------------------------------------------
// (b1) ONE circuit — every smoke/CO alarm on SD-1
// ---------------------------------------------------------------------------

describe('B13b — alarms ride ONE circuit (the interconnect precondition)', () => {
  // Three big bedrooms + hallway + garage: the lighting packer splits these
  // rooms across LTG-1..4 — pre-B13 the alarms scattered with them.
  const rooms: RoomSlice[] = [
    room('bedroom', [[0, 0], [8, 0], [8, 8], [0, 8]], { id: 'room_bed1' }),
    room('bedroom', [[8, 0], [16, 0], [16, 8], [8, 8]], { id: 'room_bed2' }),
    room('bedroom', [[16, 0], [24, 0], [24, 8], [16, 8]], { id: 'room_bed3' }),
    room('hallway', [[0, 8], [24, 8], [24, 10], [0, 10]], { id: 'room_hall' }),
    room('garage', [[0, 10], [8, 10], [8, 16], [0, 16]], { id: 'room_garage' }),
  ]
  const fixtures = layoutElectrical([], rooms, undefined, [])

  test('5 alarms (3 bedrooms + hallway smoke + CO), ONE distinct circuit: SD-1', () => {
    const alarms = alarmsOf(fixtures)
    expect(alarms).toHaveLength(5)
    const circuits = new Set(alarms.map((a) => a.meta?.circuit))
    expect(circuits).toEqual(new Set([ALARM_CIRCUIT]))
    for (const a of alarms) {
      expect(a.meta?.interconnected).toBe(true)
      expect(a.meta?.afci).toBe(true) // NEC 210.12(A)
      expect(a.meta?.gaugeAwg).toBe(14)
    }
    // the lights still split across lighting circuits — the packer is intact
    const lightCircuits = new Set(ofKind(fixtures, 'light').map((l) => l.meta?.circuit))
    expect(lightCircuits.size).toBeGreaterThan(1)
  })

  test('panel schedule: one dedicated SD-1 row, sorted with the dedicated block', () => {
    const schedule = circuitSchedule(fixtures)
    const sd = schedule.find((r) => r.circuit === ALARM_CIRCUIT)
    expect(sd?.devices).toBe(5)
    expect(sd?.afci).toBe(true)
    expect(sd?.breakerA).toBe(15)
    const names = schedule.map((r) => r.circuit)
    expect(names.indexOf(ALARM_CIRCUIT)).toBeLessThan(names.findIndex((n) => n.startsWith('LTG')))
  })
})

// ---------------------------------------------------------------------------
// (b2) 14/3 interconnect continuity — the E2-style walk over the chain
// ---------------------------------------------------------------------------

describe('B13b — 14/3 interconnect chain links every alarm', () => {
  const rooms: RoomSlice[] = [
    room('bedroom', [[0, 0], [4, 0], [4, 8], [0, 8]]),
    room('hallway', [[4, 0], [8, 0], [8, 8], [4, 8]], { id: 'room_hall' }),
    room('garage', [[8, 0], [12, 0], [12, 8], [8, 8]], { id: 'room_garage' }),
  ]
  const walls = [
    ...shellWalls().filter((w) => w.id !== 'w_e'),
    makeWall({ id: 'w_e', start: [8, 0], end: [8, 8], exterior: false, openings: [door(4, 'door_gar')] }),
    makeWall({ id: 'w_ge', start: [12, 0], end: [12, 8] }),
    makeWall({ id: 'w_gs', start: [8, 0], end: [12, 0] }),
    makeWall({ id: 'w_gn', start: [12, 8], end: [8, 8] }),
  ]
  const fixtures = layoutElectrical(walls, rooms, undefined, [])
  const members = routeWiring(fixtures, walls)
  const alarms = alarmsOf(fixtures)

  test('every 14/3 leg carries the STOREY-SCOPED R314.4 cite; the SD feed stays 14/2', () => {
    const sdMembers = members.filter((m) => m.sourceId === ALARM_CIRCUIT)
    expect(sdMembers.length).toBeGreaterThan(0)
    const three = sdMembers.filter((m) => m.label?.includes('14/3'))
    const two = sdMembers.filter((m) => m.label?.includes('14/2'))
    expect(three.length).toBeGreaterThan(0)
    expect(two.length).toBeGreaterThan(0) // the panel feed
    // round 2 (E6 honesty): the engine routes ONE level — the label claims
    // exactly the chain it draws, never the whole dwelling
    for (const m of three) expect(m.label).toContain('alarm interconnect (this storey) — IRC R314.4')
    // no SD leg carries any other cable spec
    expect(sdMembers.every((m) => m.label?.includes('14/3') || m.label?.includes('14/2'))).toBe(true)
  })

  test('E2-style walk: ONE 14/3 component touches ALL alarms (smoke + CO)', () => {
    expect(alarms.length).toBeGreaterThanOrEqual(3)
    const interconnect = members.filter(
      (m) => m.label?.includes('14/3') && m.label?.includes('alarm interconnect'),
    )
    expect(
      oneComponentTouches(
        interconnect,
        alarms.map((a) => [a.position[0], a.position[1], a.position[2]]),
      ),
    ).toBe(true)
  })

  test('E2 stays green: every routed device — alarms included — reaches the panel', () => {
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (b3) 3-way traveler legs
// ---------------------------------------------------------------------------

describe('B13b — threeWay pairs get a 14/3 traveler chain (NEC 210.70/404.2)', () => {
  // Living room with doors in the south wall AND the divider — both switch
  // faces land inside it → a threeWay pair (the existing 3-way grouping).
  const south = makeWall({ id: 'w_south', start: [0, 0], end: [8, 0], openings: [door(1.5, 'door_front')] })
  const divider = makeWall({
    id: 'w_div',
    start: [3.5, 0],
    end: [3.5, 4],
    exterior: false,
    openings: [door(2, 'door_side')],
  })
  const east = makeWall({ id: 'w_east', start: [8, 0], end: [8, 4] })
  const north = makeWall({ id: 'w_north', start: [8, 4], end: [0, 4] })
  const west = makeWall({ id: 'w_west', start: [0, 4], end: [0, 0] })
  const walls = [south, divider, east, north, west]
  const living = room('other', [[0, 0], [3.5, 0], [3.5, 4], [0, 4]], { id: 'room_l', name: 'living' })
  const den = room('other', [[3.5, 0], [8, 0], [8, 4], [3.5, 4]], { id: 'room_d' })
  const fixtures = layoutElectrical(walls, [living, den])
  const members = routeWiring(fixtures, walls)
  const pair = fixtures.filter(
    (f) => f.kind === 'switch' && f.meta?.threeWay === true && f.meta?.threeWayRoom === 'room_l',
  )

  test('traveler members exist, 14/3-labeled with the NEC cite, on the pair circuit', () => {
    expect(pair).toHaveLength(2)
    const travelers = members.filter((m) => m.label?.includes('3-way travelers'))
    expect(travelers.length).toBeGreaterThan(0)
    for (const t of travelers) {
      expect(t.label).toContain('14/3')
      expect(t.label).toContain('NEC 210.70/404.2')
      expect(t.sourceId).toBe(String(pair[0]?.meta?.circuit))
    }
  })

  test('the traveler chain is continuous BOX to BOX (E2-style walk on travelers only)', () => {
    const travelers = members.filter((m) => m.label?.includes('3-way travelers'))
    expect(
      oneComponentTouches(
        travelers,
        pair.map((s) => [s.position[0], s.position[1], s.position[2]]),
      ),
    ).toBe(true)
  })

  test('single-entry rooms emit NO traveler legs', () => {
    const soloWalls = [
      makeWall({ id: 'w_s1', start: [0, 0], end: [6, 0], openings: [door(3, 'door_only')] }),
      makeWall({ id: 'w_e1', start: [6, 0], end: [6, 4] }),
      makeWall({ id: 'w_n1', start: [6, 4], end: [0, 4] }),
      makeWall({ id: 'w_w1', start: [0, 4], end: [0, 0] }),
    ]
    const solo = room('other', [[0, 0], [6, 0], [6, 4], [0, 4]], { id: 'room_solo' })
    const fx = layoutElectrical(soloWalls, [solo])
    const wires = routeWiring(fx, soloWalls)
    expect(wires.some((m) => m.label?.includes('3-way travelers'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (b4) takeoff rows — 14/3 is its own SKU
// ---------------------------------------------------------------------------

describe('B13b — takeoff books 14/3 on its own NM-B row', () => {
  const rooms: RoomSlice[] = [
    room('bedroom', [[0, 0], [4, 0], [4, 8], [0, 8]]),
    room('hallway', [[4, 0], [8, 0], [8, 8], [4, 8]], { id: 'room_hall' }),
  ]
  const walls = shellWalls()
  const fixtures = layoutElectrical(walls, rooms, undefined, [])
  const members = routeWiring(fixtures, walls)
  const rows = computeTakeoff(members, fixtures)

  test('NM-B 14/3 w/G row with the interconnect detail; 14/2 keeps its own row', () => {
    const three = rows.find((r) => r.item === 'NM-B 14/3 w/G')
    const two = rows.find((r) => r.item === 'NM-B 14/2 w/G')
    expect(three?.quantity ?? 0).toBeGreaterThan(0)
    expect(three?.detail).toContain('interconnect')
    expect(three?.detail).toContain('R314.4')
    expect(two?.quantity ?? 0).toBeGreaterThan(0)
    expect(two?.detail).toBe('homeruns + branch chains')
    // conservation: the lf split is exact — no 14/3 inch books under 14/2
    const toFeet = (m: number) => m / 0.3048
    const threeLf = members
      .filter((m) => m.role === 'wire-run' && m.label?.includes('14/3'))
      .reduce((s, m) => s + toFeet(m.length), 0)
    expect(three?.quantity).toBeCloseTo(Math.round(threeLf * 10) / 10, 1)
  })
})

// ---------------------------------------------------------------------------
// Round 2 — E6 cross-storey honesty (skeptic driver)
// ---------------------------------------------------------------------------

describe('B13 r2 — the per-storey interconnect never claims the dwelling', () => {
  // compute is per-LEVEL: every storey mints its OWN panel + its OWN SD-1.
  // The 3-storey exhibit had 6 alarms all claiming `interconnected` with NO
  // cable between storeys and zero caveat — R314.4 requires interconnection
  // across the DWELLING, so multi-storey scenes must SAY the model stops at
  // the storey line, and the member labels must scope their claim.
  const wall = (id: string, level: string, start: [number, number], end: [number, number]) => ({
    id,
    type: 'wall',
    parentId: level,
    start,
    end,
    thickness: 0.114,
    height: 2.5,
    frontSide: 'exterior',
    backSide: 'interior',
    children: [],
  })
  const zone = (id: string, level: string, name: string, polygon: [number, number][]) => ({
    id,
    type: 'zone',
    parentId: level,
    name,
    polygon,
    boundaryWallIds: [],
  })
  const storey = (
    n: number,
    zones: [string, string, [number, number][]][],
  ): Record<string, Record<string, unknown>> => {
    const lvl = `lvl${n}`
    const out: Record<string, Record<string, unknown>> = {
      [lvl]: { id: lvl, type: 'level', parentId: 'bldg', level: n, height: 2.7 },
      [`w${n}a`]: wall(`w${n}a`, lvl, [0, 0], [8, 0]),
      [`w${n}b`]: wall(`w${n}b`, lvl, [8, 0], [8, 5]),
      [`w${n}c`]: wall(`w${n}c`, lvl, [8, 5], [0, 5]),
      [`w${n}d`]: wall(`w${n}d`, lvl, [0, 5], [0, 0]),
    }
    for (const [id, name, polygon] of zones) out[id] = zone(id, lvl, name, polygon)
    return out
  }
  const threeStorey = (): Record<string, Record<string, unknown>> => ({
    bldg: { id: 'bldg', type: 'building', children: ['lvl0', 'lvl1', 'lvl2'] },
    ...storey(0, [
      ['z0bed', 'Bedroom', [[0, 0], [4, 0], [4, 5], [0, 5]]],
      ['z0hall', 'Hallway', [[4, 0], [8, 0], [8, 5], [4, 5]]],
    ]),
    ...storey(1, [
      ['z1bed', 'Bedroom 2', [[0, 0], [4, 0], [4, 5], [0, 5]]],
      ['z1hall', 'Upper hall', [[4, 0], [8, 0], [8, 5], [4, 5]]],
    ]),
    ...storey(2, [['z2study', 'Study', [[0, 0], [8, 0], [8, 5], [0, 5]]]]),
  })
  const bones = (levelId: string) =>
    FramingNode.parse({
      id: `bonesframing_${levelId}`,
      parentId: levelId,
      jurisdiction: 'INTL',
      detail: '400',
      showElectrical: true,
    }) as FramingNode
  const CROSS_STOREY =
    'alarm interconnect modeled per storey — R314.4 requires interconnection across the dwelling; verify the cross-storey chain'

  test('3-storey exhibit: EVERY storey with rooms warns about the cross-storey chain', () => {
    const scene = threeStorey()
    for (const lvl of ['lvl0', 'lvl1', 'lvl2']) {
      const result = computeLevel(scene, bones(lvl))
      // every storey places alarms (bedroom/hallway or the per-story rule)…
      expect(
        result.fixtures.some((f) => f.kind === 'smoke-alarm' || f.kind === 'co-alarm'),
      ).toBe(true)
      // …and every storey says the modeled chain stops at its own line
      expect(result.warnings).toContain(CROSS_STOREY)
    }
  })

  test('3-storey exhibit: the 14/3 labels scope their claim to the storey', () => {
    const result = computeLevel(threeStorey(), bones('lvl0'))
    const sd = result.members.filter(
      (m) => m.sourceId === ALARM_CIRCUIT && m.label?.includes('14/3'),
    )
    expect(sd.length).toBeGreaterThan(0)
    for (const m of sd) {
      expect(m.label).toContain('alarm interconnect (this storey) — IRC R314.4')
    }
  })

  test('single-storey scene stays warning-free (nothing to interconnect across)', () => {
    const scene: Record<string, Record<string, unknown>> = {
      bldg: { id: 'bldg', type: 'building', children: ['lvl0'] },
      ...storey(0, [
        ['z0bed', 'Bedroom', [[0, 0], [4, 0], [4, 5], [0, 5]]],
        ['z0hall', 'Hallway', [[4, 0], [8, 0], [8, 5], [4, 5]]],
      ]),
    }
    const result = computeLevel(scene, bones('lvl0'))
    expect(result.fixtures.some((f) => f.kind === 'smoke-alarm')).toBe(true)
    expect(result.warnings).not.toContain(CROSS_STOREY)
  })

  test('a roof-only sibling level (no rooms) does not trigger the warning', () => {
    const scene: Record<string, Record<string, unknown>> = {
      bldg: { id: 'bldg', type: 'building', children: ['lvl0', 'lvl1'] },
      ...storey(0, [
        ['z0bed', 'Bedroom', [[0, 0], [4, 0], [4, 5], [0, 5]]],
        ['z0hall', 'Hallway', [[4, 0], [8, 0], [8, 5], [4, 5]]],
      ]),
      lvl1: { id: 'lvl1', type: 'level', parentId: 'bldg', level: 1, height: 2.0 },
      w1g: wall('w1g', 'lvl1', [0, 0], [8, 0]), // bare gable wall, no rooms
    }
    const result = computeLevel(scene, bones('lvl0'))
    expect(result.warnings).not.toContain(CROSS_STOREY)
  })
})

// ---------------------------------------------------------------------------
// Round 2 — narrow-host nudge clamp (skeptic advisory)
// ---------------------------------------------------------------------------

describe('B13 r2 — centroid nudges never leave the host polygon', () => {
  // The +12" x-nudge put a 0.5 m corridor host's alarm 5.5 cm INSIDE the
  // far wall band (outside the polygon). nudgeInside clamps: ±d on both
  // axes, centroid as the last resort.
  const corridor: [number, number][] = [[4, 0], [4.5, 0], [4.5, 4], [4, 4]]

  test('0.5 m corridor proxy repro: the R314.3(2) alarm stays INSIDE', () => {
    const rooms = [
      room('bedroom', [[0, 0], [4, 0], [4, 4], [0, 4]]),
      room('other', corridor, { id: 'room_corr', name: 'Corridor' }),
    ]
    const fixtures = layoutElectrical([], rooms, undefined, [])
    const proxy = ofKind(fixtures, 'smoke-alarm').find((a) => a.sourceId === 'room_corr') as Fixture
    expect(proxy).toBeDefined()
    expect(pointInPolygon([proxy.position[0], proxy.position[2]], corridor)).toBe(true)
    // still nudged off the light's centroid (z-fight guard intact)
    expect(Math.hypot(proxy.position[0] - 4.25, proxy.position[2] - 2)).toBeGreaterThan(0.1)
  })

  test('CO alarm in the same corridor host stays inside AND apart from the smoke alarm', () => {
    const rooms = [
      room('bedroom', [[0, 0], [4, 0], [4, 4], [0, 4]]),
      room('other', corridor, { id: 'room_corr', name: 'Corridor' }),
      room('garage', [[4.5, 0], [8.5, 0], [8.5, 4], [4.5, 4]], { id: 'room_garage' }),
    ]
    const fixtures = layoutElectrical([], rooms, undefined, [])
    const smoke = ofKind(fixtures, 'smoke-alarm').find((a) => a.sourceId === 'room_corr') as Fixture
    const co = ofKind(fixtures, 'co-alarm')[0] as Fixture
    expect(co).toBeDefined()
    expect(pointInPolygon([co.position[0], co.position[2]], corridor)).toBe(true)
    expect(
      Math.hypot(co.position[0] - smoke.position[0], co.position[2] - smoke.position[2]),
    ).toBeGreaterThan(0.1)
  })

  test('narrow per-story host: the R314.3(3) alarm stays inside', () => {
    const strip: [number, number][] = [[0, 0], [0.5, 0], [0.5, 6], [0, 6]]
    const fixtures = layoutElectrical([], [room('other', strip, { id: 'room_strip' })], undefined, [])
    const alarm = ofKind(fixtures, 'smoke-alarm')[0] as Fixture
    expect(alarm.label).toContain('one per story')
    expect(pointInPolygon([alarm.position[0], alarm.position[2]], strip)).toBe(true)
  })

  test('wide rooms keep the pre-round-2 +12" x-nudge byte-for-byte', () => {
    const bedroom = room('bedroom', [[0, 0], [4, 0], [4, 4], [0, 4]])
    const alarms = ofKind(layoutElectrical([], [bedroom]), 'smoke-alarm')
    expect(alarms[0]?.position[0]).toBeCloseTo(2 + 12 * 0.0254, 6)
    expect(alarms[0]?.position[2]).toBeCloseTo(2, 6)
  })
})

// ---------------------------------------------------------------------------
// Round 3 — examiner flags 2 + 3
// ---------------------------------------------------------------------------

describe('B13 r3 — ceiling-box census counts CO alarms (examiner flag 2)', () => {
  test('Ceiling boxes == lights + smoke alarms + CO alarms, exactly', () => {
    const rooms = [
      room('bedroom', [[0, 0], [4, 0], [4, 8], [0, 8]]),
      room('hallway', [[4, 0], [8, 0], [8, 8], [4, 8]], { id: 'room_hall' }),
      room('garage', [[8, 0], [12, 0], [12, 8], [8, 8]], { id: 'room_garage' }),
    ]
    const fixtures = layoutElectrical(shellWalls(), rooms, undefined, [])
    const ceilingDevices = fixtures.filter(
      (f) => f.kind === 'light' || f.kind === 'smoke-alarm' || f.kind === 'co-alarm',
    ).length
    expect(ofKind(fixtures, 'co-alarm')).toHaveLength(1) // non-vacuous: a CO box is in play
    const rows = computeTakeoff([], fixtures)
    const boxes = rows.find((r) => r.item === 'Ceiling boxes')
    // pre-fix: the filter omitted 'co-alarm' → 8 boxes booked for 9 devices
    expect(boxes?.quantity).toBe(ceilingDevices)
  })
})

describe('B13 r3 — traveler predicate (examiner flag 3): same circuit, distinct openings', () => {
  // One divider door, big rooms on each side (each > 1200 VA → own LTG
  // circuit), plus a DUPLICATE overlapping zone spanning both. The dup zone
  // contains the door's two opposite-face switches → the 3-way stamping
  // marks them threeWay with threeWayRoom = the dup zone, while their
  // circuits differ (each stands in its own real room). Pre-fix the
  // traveler pass welded them into a cross-circuit 14/3 boring 0.07 m
  // through the wall — no electrician would draw that.
  const exhibitWalls = (): WallSlice[] => [
    makeWall({ id: 'w_s', start: [0, 0], end: [16, 0] }),
    makeWall({ id: 'w_e', start: [16, 0], end: [16, 8] }),
    makeWall({ id: 'w_n', start: [16, 8], end: [0, 8] }),
    makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
    makeWall({ id: 'w_div', start: [8, 0], end: [8, 8], exterior: false, openings: [door(4, 'door_mid')] }),
  ]

  test('duplicate-zone exhibit → ZERO cross-circuit travelers (zero travelers at all)', () => {
    const rooms = [
      room('other', [[0, 0], [8, 0], [8, 8], [0, 8]], { id: 'room_a', name: 'A' }),
      room('other', [[8, 0], [16, 0], [16, 8], [8, 8]], { id: 'room_b', name: 'B' }),
      // the duplicate zone, listed last so circuit tagging resolves the
      // real rooms first (rooms.find order)
      room('other', [[0, 0], [16, 0], [16, 8], [0, 8]], { id: 'room_dup', name: 'Dup' }),
    ]
    const fixtures = layoutElectrical(exhibitWalls(), rooms)
    // the exhibit is real: the dup zone DID stamp the opposite-face pair…
    const stamped = fixtures.filter(
      (f) => f.kind === 'switch' && f.meta?.threeWayRoom === 'room_dup',
    )
    expect(stamped.length).toBeGreaterThanOrEqual(2)
    // …across two circuits
    expect(new Set(stamped.map((s) => s.meta?.circuit)).size).toBeGreaterThan(1)
    const members = routeWiring(fixtures, exhibitWalls())
    const travelers = members.filter((m) => m.label?.includes('3-way travelers'))
    expect(travelers).toHaveLength(0)
  })

  test('face twins on ONE circuit (single spanning zone) → still no traveler through the wall', () => {
    // Only the spanning zone exists → both face switches stand in it and
    // share its circuit — predicate (2) alone would keep the phantom; the
    // distinct-openings rule (3) kills it: -p/-m twins of one door are two
    // rooms' controls, never a pair.
    const rooms = [room('other', [[0, 0], [16, 0], [16, 8], [0, 8]], { id: 'room_span', name: 'Span' })]
    const fixtures = layoutElectrical(exhibitWalls(), rooms)
    const twins = fixtures.filter(
      (f) => f.kind === 'switch' && String(f.meta?.deviceId ?? '').includes('door_mid'),
    )
    expect(twins).toHaveLength(2)
    expect(new Set(twins.map((s) => s.meta?.circuit)).size).toBe(1) // same circuit
    expect(twins.every((s) => s.meta?.threeWay === true)).toBe(true) // stamped
    const members = routeWiring(fixtures, exhibitWalls())
    expect(members.some((m) => m.label?.includes('3-way travelers'))).toBe(false)
  })

  test('a legitimate same-circuit pair (two doors, one room) KEEPS its chain', () => {
    const walls = [
      makeWall({ id: 'w_south', start: [0, 0], end: [8, 0], openings: [door(1.5, 'door_front')] }),
      makeWall({ id: 'w_div', start: [3.5, 0], end: [3.5, 4], exterior: false, openings: [door(2, 'door_side')] }),
      makeWall({ id: 'w_east', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_north', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_west', start: [0, 4], end: [0, 0] }),
    ]
    const rooms = [
      room('other', [[0, 0], [3.5, 0], [3.5, 4], [0, 4]], { id: 'room_l', name: 'living' }),
      room('other', [[3.5, 0], [8, 0], [8, 4], [3.5, 4]], { id: 'room_d' }),
    ]
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    const travelers = members.filter((m) => m.label?.includes('3-way travelers'))
    expect(travelers.length).toBeGreaterThan(0)
    // and they stay single-circuit — the pair's own
    const pair = fixtures.filter(
      (f) => f.kind === 'switch' && f.meta?.threeWay === true && f.meta?.threeWayRoom === 'room_l',
    )
    expect(new Set(pair.map((s) => s.meta?.circuit)).size).toBe(1)
    for (const t of travelers) expect(t.sourceId).toBe(String(pair[0]?.meta?.circuit))
  })
})
