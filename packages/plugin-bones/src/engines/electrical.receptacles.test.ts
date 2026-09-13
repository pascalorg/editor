import { describe, expect, test } from 'bun:test'
import type { Fixture, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import type { PlacedFixtureSlice } from '../core/wall-model'
import { computeLevel } from '../framing/compute'
import { FramingNode } from '../framing/schema'
import { feet, inches } from '../core/units'
import {
  applyDeviceOverrides,
  layoutElectrical,
  openingSpans,
  pointInPolygon,
  streetEdgePoint,
} from './electrical'
import { deriveWallDevices } from '../device/derive'
import { reconcileDeviceNodes } from '../device/place'
import { unreachableDevices } from './electrical.test-helpers'
import { routeWiring } from './electrical'
import { computeTakeoff } from './takeoff'

/**
 * LOD-400 BATCH 14 gates — receptacle COVERAGE (outdoor / sink-GFCI /
 * counter / basin). Before B14 the engine had ZERO outdoor receptacles ever
 * (interiorFaces() returns interior faces only) while rules.json booked
 * `outdoorFrontAndBack`, every kitchen/bath box sat at 15" AFF, and the
 * 210.8(A)(7) sink-radius test hid behind a stale "once sink positions are
 * extracted" comment although compute extracts placedFixtures today.
 */

const RO_PAD = inches(1.5)

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  overrides: Partial<WallSlice> = {},
): WallSlice {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id,
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.15,
    height: 2.5,
    exterior: true,
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

/** 8×6 rect shell: south w_s / east w_e / north w_n / west w_w, one living
 * room filling it. The panel lands on the longest exterior wall (south),
 * the meter beside it → the street edge is SOUTH (z = minZ − margin). */
function rectScene(southDoorU?: number): { walls: WallSlice[]; rooms: RoomSlice[] } {
  const walls = [
    wall('w_s', [0, 0], [8, 0], southDoorU === undefined ? {} : { openings: [door(southDoorU)] }),
    wall('w_e', [8, 0], [8, 6]),
    wall('w_n', [8, 6], [0, 6]),
    wall('w_w', [0, 6], [0, 0]),
  ]
  const rooms = [
    room('other', [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ], { name: 'living' }),
  ]
  return { walls, rooms }
}

const outdoor = (fixtures: Fixture[]): Fixture[] =>
  fixtures.filter((f) => f.kind === 'receptacle-wr-gfci')

describe('B14a outdoor receptacles — NEC 210.52(E) front + back, WR GFCI, in-use covers', () => {
  test('a plain shell places >= 2 outdoor WR GFCI receptacles, front on the street-nearest wall, back opposite', () => {
    const { walls, rooms } = rectScene()
    const fixtures = layoutElectrical(walls, rooms)
    const out = outdoor(fixtures)
    expect(out.length).toBeGreaterThanOrEqual(2)

    // the meter anchors the street pick — assert the shared definition agrees
    const meter = fixtures.find((f) => f.kind === 'electric-meter')
    expect(meter).toBeDefined()
    const street = streetEdgePoint(walls, [
      (meter as { position: readonly number[] }).position[0] as number,
      (meter as { position: readonly number[] }).position[2] as number,
    ])
    expect(street[1]).toBeLessThan(0) // south edge

    const front = out.find((f) => f.meta?.outdoor === 'front')
    const back = out.find((f) => f.meta?.outdoor === 'back')
    expect(front).toBeDefined()
    expect(back).toBeDefined()
    expect(front?.sourceId).toBe('w_s') // street-nearest exterior wall
    expect(back?.sourceId).toBe('w_n') // opposite-facing, farthest from street
  })

  test('outdoor boxes carry the WR / GFCI / in-use-cover marks in kind, meta AND label', () => {
    const { walls, rooms } = rectScene()
    const out = outdoor(layoutElectrical(walls, rooms))
    for (const f of out) {
      expect(f.kind).toBe('receptacle-wr-gfci')
      expect(f.meta?.wr).toBe(true)
      expect(f.meta?.inUseCover).toBe(true)
      expect(f.label).toContain('210.52(E)')
      expect(f.label).toContain('406.9(B)')
      expect(f.label).toContain('WR GFCI')
      expect(String(f.meta?.deviceId)).toMatch(/^recep-w_[a-z]+-out-(front|back)$/)
    }
  })

  test('outdoor boxes mount on the EXTERIOR face — outside every room polygon', () => {
    const { walls, rooms } = rectScene()
    const out = outdoor(layoutElectrical(walls, rooms))
    for (const f of out) {
      const plan: [number, number] = [f.position[0], f.position[2]]
      expect(rooms.some((r) => pointInPolygon(plan, r.polygon))).toBe(false)
    }
  })

  test('RO clearance: a front door at the wall midpoint pushes the front box clear (box-edge aware)', () => {
    const doorU = 4 // exactly the naive midpoint of the 8 m south wall
    const { walls, rooms } = rectScene(doorU)
    const front = outdoor(layoutElectrical(walls, rooms)).find((f) => f.meta?.outdoor === 'front')
    expect(front).toBeDefined()
    const w = walls[0] as WallSlice
    const u =
      (Number(front?.position[0]) - w.start[0]) * w.dir[0] +
      (Number(front?.position[2]) - w.start[1]) * w.dir[1]
    const aff = Number(front?.position[1])
    const spans = openingSpans(w, aff - inches(2.25), aff + inches(2.25))
    expect(spans.length).toBeGreaterThan(0)
    const boxHalf = inches(1.5)
    for (const s of spans) {
      expect(u + boxHalf <= s.lo || u - boxHalf >= s.hi).toBe(true)
    }
    // bite-proof: the naive midpoint DOES sit inside the RO
    const hit = spans.some((s) => doorU > s.lo && doorU < s.hi)
    expect(hit).toBe(true)
  })

  test('outdoor receptacles ride their own 20 A GFCI exterior circuit (EXT-1) — never AFCI', () => {
    const { walls, rooms } = rectScene()
    const out = outdoor(layoutElectrical(walls, rooms))
    for (const f of out) {
      expect(f.meta?.circuit).toBe('EXT-1')
      expect(f.meta?.breakerA).toBe(20)
      expect(f.meta?.gaugeAwg).toBe(12)
      expect(f.meta?.gfci).toBe(true)
      expect(f.meta?.afci).toBeUndefined()
    }
  })

  test('E2: the outdoor boxes are panel-reachable as continuous cable', () => {
    const { walls, rooms } = rectScene()
    const fixtures = layoutElectrical(walls, rooms)
    const members = routeWiring(fixtures, walls)
    const stranded = unreachableDevices(members, fixtures)
    expect(stranded).toEqual([])
    // the EXT-1 homerun exists as real cable
    expect(members.some((m) => m.sourceId === 'EXT-1')).toBe(true)
  })

  test('takeoff distinguishes WR from interior GFCI and books the in-use covers 1:1', () => {
    const { walls, rooms } = rectScene()
    // add a kitchen so INTERIOR GFCI exists alongside the WR boxes
    const kitchen = room('kitchen', [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    const fixtures = layoutElectrical(walls, [kitchen, ...rooms])
    const roomsAll = [kitchen, ...rooms]
    void roomsAll
    const rows = computeTakeoff([], fixtures)
    const wrRow = rows.find((r) => r.item === 'WR GFCI receptacles (outdoor)')
    const gfciRow = rows.find((r) => r.item === 'GFCI receptacles')
    const coverRow = rows.find((r) => r.item === 'In-use covers (extra-duty)')
    const wrCount = outdoor(fixtures).length
    expect(wrRow?.quantity).toBe(wrCount)
    expect(coverRow?.quantity).toBe(wrCount)
    expect(coverRow?.detail).toContain('406.9(B)')
    // interior GFCI row excludes the WR boxes
    expect(gfciRow?.quantity).toBe(fixtures.filter((f) => f.kind === 'receptacle-gfci').length)
    expect(gfciRow?.quantity).toBeGreaterThan(0)
  })

  test('single-exterior-wall scene: both required outlets land on it, apart, and the level WARNS', () => {
    const walls = [
      wall('w_only', [0, 0], [8, 0]),
      wall('w_int', [0, 2], [8, 2], { exterior: false, thickness: 0.114 }),
    ]
    const warnings: string[] = []
    const out = outdoor(layoutElectrical(walls, [], undefined, warnings))
    expect(out.length).toBe(2)
    expect(new Set(out.map((f) => f.sourceId))).toEqual(new Set(['w_only']))
    const us = out.map(
      (f) => (f.position[0] - 0) * 1 + (f.position[2] - 0) * 0,
    )
    expect(Math.abs((us[0] as number) - (us[1] as number))).toBeGreaterThan(1)
    expect(warnings.some((w) => w.includes('single exterior wall') && w.includes('210.52(E)'))).toBe(
      true,
    )
  })

  test('no exterior wall at all: zero outdoor boxes, explicit warning — never silent', () => {
    const walls = [
      wall('w_a', [0, 0], [6, 0], { exterior: false }),
      wall('w_b', [0, 2], [6, 2], { exterior: false }),
    ]
    const warnings: string[] = []
    const out = outdoor(layoutElectrical(walls, [], undefined, warnings))
    expect(out.length).toBe(0)
    expect(warnings.some((w) => w.includes('210.52(E)'))).toBe(true)
  })

  test('outdoor mount height stays under the 6\'6" grade cap (210.52(E)(1))', () => {
    const { walls, rooms } = rectScene()
    for (const f of outdoor(layoutElectrical(walls, rooms))) {
      expect(f.position[1]).toBeLessThanOrEqual(feet(6.5))
      expect(f.position[1]).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// B14b — the 6-ft sink GFCI radius consumes placedFixtures NOW
// ---------------------------------------------------------------------------

function placedItem(
  id: string,
  kind: PlacedFixtureSlice['kind'],
  plan: [number, number],
): PlacedFixtureSlice {
  const profiles: Record<string, { hot: boolean; dfu: number; drainIn: number }> = {
    'kitchen-sink': { hot: true, dfu: 2, drainIn: 1.5 },
    lavatory: { hot: true, dfu: 1, drainIn: 1.25 },
    bathtub: { hot: true, dfu: 2, drainIn: 1.5 },
    shower: { hot: true, dfu: 2, drainIn: 2 },
    toilet: { hot: false, dfu: 3, drainIn: 3 },
  }
  return { id, kind, plan, yaw: 0, ...(profiles[kind] as { hot: boolean; dfu: number; drainIn: number }) }
}

/** u-coordinate of a fixture along the 8 m south wall (w_s runs +X). */
const southU = (f: Fixture): number => f.position[0]

describe('B14b sink-radius GFCI — NEC 210.8(A)(7)/(9) from placed fixtures (stale comment closed)', () => {
  test('a receptacle within 6 ft of a placed kitchen sink flips to GFCI in a DRY room; its siblings outside the radius do not', () => {
    const { walls, rooms } = rectScene()
    // south wall (8 m, no openings) walks 3 receptacles at u = 1.33 / 4 / 6.67
    const sink = placedItem('sink_1', 'kitchen-sink', [4, 1])
    const fixtures = layoutElectrical(walls, rooms, undefined, undefined, [sink])
    const south = fixtures.filter(
      (f) =>
        (f.kind === 'receptacle' || f.kind === 'receptacle-gfci') && f.sourceId === 'w_s',
    )
    expect(south.length).toBe(3)
    const mid = south.find((f) => Math.abs(southU(f) - 4) < 0.1)
    const left = south.find((f) => southU(f) < 2)
    const right = south.find((f) => southU(f) > 6)
    expect(mid?.kind).toBe('receptacle-gfci') // ~0.9 m from the sink
    expect(left?.kind).toBe('receptacle') // ~2.8 m away — outside 6 ft
    expect(right?.kind).toBe('receptacle')
  })

  test('bite direction: the SAME scene with the sink 3 m off the wall flips nothing', () => {
    const { walls, rooms } = rectScene()
    const farSink = placedItem('sink_1', 'kitchen-sink', [4, 3])
    const fixtures = layoutElectrical(walls, rooms, undefined, undefined, [farSink])
    const south = fixtures.filter(
      (f) =>
        (f.kind === 'receptacle' || f.kind === 'receptacle-gfci') && f.sourceId === 'w_s',
    )
    expect(south.every((f) => f.kind === 'receptacle')).toBe(true)
  })

  test('tubs and showers trigger the radius too (210.8(A)(9)); toilets never do', () => {
    const { walls, rooms } = rectScene()
    const tub = placedItem('tub_1', 'bathtub', [4, 1])
    const withTub = layoutElectrical(walls, rooms, undefined, undefined, [tub])
    const midTub = withTub.find(
      (f) => f.sourceId === 'w_s' && Math.abs(southU(f) - 4) < 0.1 && f.kind !== 'switch',
    )
    expect(midTub?.kind).toBe('receptacle-gfci')

    const toilet = placedItem('wc_1', 'toilet', [4, 1])
    const withWc = layoutElectrical(walls, rooms, undefined, undefined, [toilet])
    const midWc = withWc.find(
      (f) => f.sourceId === 'w_s' && Math.abs(southU(f) - 4) < 0.1 && f.kind !== 'switch',
    )
    expect(midWc?.kind).toBe('receptacle')
  })

  test('the flip changes the KIND only — deviceId stays byte-stable across the sink edit (E5 reconcile-safe)', () => {
    const { walls, rooms } = rectScene()
    const sink = placedItem('sink_1', 'kitchen-sink', [4, 1])
    const dry = layoutElectrical(walls, rooms)
    const wet = layoutElectrical(walls, rooms, undefined, undefined, [sink])
    const idOf = (fx: Fixture[]) =>
      fx.find((f) => f.sourceId === 'w_s' && Math.abs(southU(f) - 4) < 0.1 && f.kind !== 'switch')
    expect(idOf(dry)?.kind).toBe('receptacle')
    expect(idOf(wet)?.kind).toBe('receptacle-gfci')
    expect(String(idOf(wet)?.meta?.deviceId)).toBe(String(idOf(dry)?.meta?.deviceId))
  })

  test('computeLevel passes placed fixtures through — a placed kitchen item flips the nearby box end to end', () => {
    const nodes = (withSink: boolean): Record<string, Record<string, unknown>> => ({
      level_1: { id: 'level_1', type: 'level', level: 0, height: 2.5 },
      w_s: {
        id: 'w_s',
        type: 'wall',
        parentId: 'level_1',
        start: [0, 0],
        end: [8, 0],
        thickness: 0.15,
        height: 2.5,
        frontSide: 'exterior',
        children: [],
      },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_1', start: [8, 0], end: [8, 6], thickness: 0.15, height: 2.5, frontSide: 'exterior', children: [] },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_1', start: [8, 6], end: [0, 6], thickness: 0.15, height: 2.5, frontSide: 'exterior', children: [] },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_1', start: [0, 6], end: [0, 0], thickness: 0.15, height: 2.5, frontSide: 'exterior', children: [] },
      ...(withSink
        ? {
            sink_item: {
              id: 'sink_item',
              type: 'item',
              parentId: 'level_1',
              asset: { id: 'kitchen' },
              position: [4, 0, 1],
              rotation: [0, 0, 0],
            },
          }
        : {}),
      bones: {
        id: 'bonesframing_recept',
        type: 'bones:framing',
        parentId: 'level_1',
        jurisdiction: 'INTL',
        detail: '200',
        showElectrical: true,
      },
    })
    const dry = computeLevel(nodes(false), FramingNode.parse(nodes(false).bones))
    const wet = computeLevel(nodes(true), FramingNode.parse(nodes(true).bones))
    const near = (fx: Fixture[]) =>
      fx.filter(
        (f) =>
          (f.kind === 'receptacle' || f.kind === 'receptacle-gfci') &&
          Math.hypot(f.position[0] - 4, f.position[2] - 1) <= feet(6),
      )
    expect(near(dry.fixtures).length).toBeGreaterThan(0)
    expect(near(dry.fixtures).every((f) => f.kind === 'receptacle')).toBe(true)
    expect(near(wet.fixtures).length).toBeGreaterThan(0)
    expect(near(wet.fixtures).every((f) => f.kind === 'receptacle-gfci')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// B14c — the kitchen counter run at 44" AFF (NEC 210.52(C))
// ---------------------------------------------------------------------------

const COUNTER_AFF = inches(44)
const counterBoxes = (fixtures: Fixture[]): Fixture[] =>
  fixtures.filter((f) => f.meta?.counter === true)

/** rectScene + a kitchen zone on the west end of the south wall. */
function kitchenScene(kitchenMaxX = 4): {
  walls: WallSlice[]
  rooms: RoomSlice[]
  kitchen: RoomSlice
} {
  const { walls, rooms } = rectScene()
  const kitchen = room(
    'kitchen',
    [
      [0, 0],
      [kitchenMaxX, 0],
      [kitchenMaxX, 3],
      [0, 3],
    ],
    { name: 'Kitchen' },
  )
  return { walls, rooms: [kitchen, ...rooms], kitchen }
}

describe('B14c counter run — hybrid: placed sink pins the walk, sink-less kitchens warn', () => {
  test('a placed sink pins its counter wall: >= 2 counter GFCI boxes at 44" AFF on the kitchen face', () => {
    const { walls, rooms, kitchen } = kitchenScene()
    const sink = placedItem('sink_1', 'kitchen-sink', [2, 0.5])
    const fixtures = layoutElectrical(walls, rooms, undefined, undefined, [sink])
    const ctr = counterBoxes(fixtures)
    expect(ctr.length).toBeGreaterThanOrEqual(2)
    for (const f of ctr) {
      expect(f.kind).toBe('receptacle-gfci')
      expect(f.position[1]).toBeCloseTo(COUNTER_AFF, 5)
      expect(f.sourceId).toBe('w_s')
      expect(f.label).toContain('210.52(C)')
      expect(pointInPolygon([f.position[0], f.position[2]], kitchen.polygon)).toBe(true)
      expect(String(f.meta?.deviceId)).toMatch(/^recep-w_s-ctr-\d+-(p|m)$/)
    }
  })

  test('counter spacing: every gap <= 48", run ends served within ~24" (layoutAlgorithmHints)', () => {
    const { walls, rooms } = kitchenScene()
    const sink = placedItem('sink_1', 'kitchen-sink', [2, 0.5])
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, undefined, [sink]))
    const us = ctr.map((f) => f.position[0]).sort((a, b) => a - b)
    expect(us.length).toBeGreaterThanOrEqual(2)
    for (let i = 0; i + 1 < us.length; i++) {
      expect((us[i + 1] as number) - (us[i] as number)).toBeLessThanOrEqual(inches(48) + 0.16)
    }
    // kitchen span is x in [0, 4] (march resolution + faucet nudge slack)
    expect(us[0] as number).toBeLessThanOrEqual(inches(24) + 0.16)
    expect(us[us.length - 1] as number).toBeGreaterThanOrEqual(4 - inches(24) - 0.16)
  })

  test('zone clipping: the counter walk never leaves the kitchen polygon (wall continues 4 m past it)', () => {
    const { walls, rooms } = kitchenScene()
    const sink = placedItem('sink_1', 'kitchen-sink', [2, 0.5])
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, undefined, [sink]))
    for (const f of ctr) {
      expect(f.position[0]).toBeLessThanOrEqual(4 + 0.01)
    }
  })

  test('no box lands in the faucet zone directly behind the bowl', () => {
    const { walls, rooms } = kitchenScene(2.4)
    const sink = placedItem('sink_1', 'kitchen-sink', [0.6, 0.5])
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, undefined, [sink]))
    expect(ctr.length).toBeGreaterThanOrEqual(1)
    for (const f of ctr) {
      expect(Math.abs(f.position[0] - 0.6)).toBeGreaterThanOrEqual(0.3 - 1e-9)
    }
  })

  test('a door RO ends the counter run — no counter box on the far side of the door', () => {
    const { walls, rooms } = kitchenScene()
    ;(walls[0] as WallSlice).openings.push(door(1, 0.9, 'door_kitchen'))
    const sink = placedItem('sink_1', 'kitchen-sink', [3, 0.5])
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, undefined, [sink]))
    expect(ctr.length).toBeGreaterThanOrEqual(1)
    const doorHi = 1 + (0.9 + RO_PAD) / 2
    for (const f of ctr) {
      expect(f.position[0]).toBeGreaterThanOrEqual(doorHi - 1e-9)
    }
  })

  test('sink-less kitchen: NO counter boxes, an explicit per-kitchen 210.52(C) warning names it', () => {
    const { walls, rooms } = kitchenScene()
    const warnings: string[] = []
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, warnings))
    expect(ctr.length).toBe(0)
    expect(
      warnings.some((w) => w.includes('Kitchen') && w.includes('210.52(C)') && w.includes('not modeled')),
    ).toBe(true)
  })

  test('island sink (far from every wall): no counter walk, the 2023 island rule is labeled', () => {
    const { walls, rooms } = kitchenScene()
    const warnings: string[] = []
    const sink = placedItem('sink_1', 'kitchen-sink', [2, 1.5])
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, warnings, [sink]))
    expect(ctr.length).toBe(0)
    expect(warnings.some((w) => w.includes('island sink') && w.includes('210.52(C)(2)'))).toBe(true)
  })

  test('counter boxes ride the small-appliance circuits (SA-n, 20 A) and stay E2-continuous', () => {
    const { walls, rooms } = kitchenScene()
    const sink = placedItem('sink_1', 'kitchen-sink', [2, 0.5])
    const fixtures = layoutElectrical(walls, rooms, undefined, undefined, [sink])
    for (const f of counterBoxes(fixtures)) {
      expect(String(f.meta?.circuit)).toMatch(/^SA-[12]$/)
      expect(f.meta?.breakerA).toBe(20)
    }
    const members = routeWiring(fixtures, walls)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })

  test('counter-height census: the kitchen keeps its 15" wall-line walk AND gains the 44" counter tier', () => {
    const { walls, rooms, kitchen } = kitchenScene()
    const sink = placedItem('sink_1', 'kitchen-sink', [2, 0.5])
    const fixtures = layoutElectrical(walls, rooms, undefined, undefined, [sink])
    const inKitchen = fixtures.filter(
      (f) =>
        (f.kind === 'receptacle' || f.kind === 'receptacle-gfci') &&
        pointInPolygon([f.position[0], f.position[2]], kitchen.polygon),
    )
    const low = inKitchen.filter((f) => Math.abs(f.position[1] - inches(15)) < 1e-6)
    const counter = inKitchen.filter((f) => Math.abs(f.position[1] - COUNTER_AFF) < 1e-6)
    expect(low.length).toBeGreaterThan(0)
    expect(counter.length).toBeGreaterThanOrEqual(2)
    expect(low.length + counter.length).toBe(inKitchen.length)
  })
})

// ---------------------------------------------------------------------------
// B14d — basin receptacle within 3 ft of placed lavatories (NEC 210.52(D))
// ---------------------------------------------------------------------------

const BASIN_AFF = inches(40)
const THREE_FT = feet(3)
const basinBoxes = (fixtures: Fixture[]): Fixture[] =>
  fixtures.filter((f) => f.meta?.basin === true)

/** rectScene + a bathroom zone in the north-east corner. */
function bathScene(): { walls: WallSlice[]; rooms: RoomSlice[]; bath: RoomSlice } {
  const { walls, rooms } = rectScene()
  const bath = room(
    'bathroom',
    [
      [5, 4],
      [8, 4],
      [8, 6],
      [5, 6],
    ],
    { name: 'Bath' },
  )
  return { walls, rooms: [bath, ...rooms], bath }
}

describe('B14d basin receptacles — NEC 210.52(D) from placed lavs', () => {
  test('a placed lav pins a GFCI basin box within 3 ft, at 40" AFF, on the basin side', () => {
    const { walls, rooms } = bathScene()
    const lav = placedItem('lav_1', 'lavatory', [6.5, 5.6]) // 0.4 m off w_n
    const fixtures = layoutElectrical(walls, rooms, undefined, undefined, [lav])
    const basins = basinBoxes(fixtures)
    expect(basins.length).toBe(1)
    const f = basins[0] as Fixture
    expect(f.kind).toBe('receptacle-gfci')
    expect(f.position[1]).toBeCloseTo(BASIN_AFF, 5)
    expect(f.sourceId).toBe('w_n')
    expect(f.label).toContain('210.52(D)')
    expect(Math.hypot(f.position[0] - 6.5, f.position[2] - 5.6)).toBeLessThanOrEqual(THREE_FT)
    expect(String(f.meta?.deviceId)).toBe(`recep-w_n-basin-lav_1-${f.meta?.deviceId?.toString().endsWith('p') ? 'p' : 'm'}`)
    // basin side: the box sits INSIDE the room (interior face of the shell wall)
    expect(f.position[2]).toBeLessThan(6)
  })

  test('one box may serve two basins: twin lavs 0.6 m apart share a single 210.52(D) box', () => {
    const { walls, rooms } = bathScene()
    const lavs = [
      placedItem('lav_1', 'lavatory', [6.2, 5.6]),
      placedItem('lav_2', 'lavatory', [6.8, 5.6]),
    ]
    const basins = basinBoxes(layoutElectrical(walls, rooms, undefined, undefined, lavs))
    expect(basins.length).toBe(1)
    const f = basins[0] as Fixture
    for (const lav of lavs) {
      expect(Math.hypot(f.position[0] - lav.plan[0], f.position[2] - lav.plan[1])).toBeLessThanOrEqual(
        THREE_FT,
      )
    }
  })

  test('distant lavs each get their own box', () => {
    const { walls, rooms } = bathScene()
    const lavs = [
      placedItem('lav_1', 'lavatory', [1, 5.6]), // west end of w_n
      placedItem('lav_2', 'lavatory', [7, 5.6]), // east end of w_n
    ]
    const basins = basinBoxes(layoutElectrical(walls, rooms, undefined, undefined, lavs))
    expect(basins.length).toBe(2)
  })

  test('freestanding basin (no wall within 3 ft): NO box, explicit 210.52(D) warning', () => {
    const { walls, rooms } = bathScene()
    const warnings: string[] = []
    const lav = placedItem('lav_1', 'lavatory', [4, 3]) // 3 m from every wall
    const basins = basinBoxes(layoutElectrical(walls, rooms, undefined, warnings, [lav]))
    expect(basins.length).toBe(0)
    expect(warnings.some((w) => w.includes('lav_1') && w.includes('210.52(D)'))).toBe(true)
  })

  test('an RO snap past 3 ft keeps the box AND warns — never silent', () => {
    const { walls, rooms } = bathScene()
    // low fixed glazing filling w_n's u in [4.5, 7.5] crosses the 40" band
    const w = walls[2] as WallSlice // w_n runs [8,6] -> [0,6]
    w.openings.push({
      id: 'win_big',
      kind: 'window',
      u: 2, // w_n u measured from [8,6]: u=2 is x=6
      width: 3,
      height: 1.8,
      sillHeight: 0.3,
      roughWidth: 3 + RO_PAD,
      roughHeight: 1.8 + RO_PAD,
    })
    const warnings: string[] = []
    const lav = placedItem('lav_1', 'lavatory', [6, 5.6])
    const basins = basinBoxes(layoutElectrical(walls, rooms, undefined, warnings, [lav]))
    expect(basins.length).toBe(1)
    const f = basins[0] as Fixture
    expect(Math.hypot(f.position[0] - 6, f.position[2] - 5.6)).toBeGreaterThan(THREE_FT)
    expect(warnings.some((wn) => wn.includes('lav_1') && wn.includes("210.52(D)'s 3 ft"))).toBe(true)
  })

  test('basin box rides the bathroom 20 A circuit (BA-1) and stays E2-continuous', () => {
    const { walls, rooms } = bathScene()
    const lav = placedItem('lav_1', 'lavatory', [6.5, 5.6])
    const fixtures = layoutElectrical(walls, rooms, undefined, undefined, [lav])
    const f = basinBoxes(fixtures)[0] as Fixture
    expect(f.meta?.circuit).toBe('BA-1')
    expect(f.meta?.breakerA).toBe(20)
    expect(f.meta?.gfci).toBe(true)
    const members = routeWiring(fixtures, walls)
    expect(unreachableDevices(members, fixtures)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// B14 round 2 — F1/F2: counter-walk honesty under rough openings
// ---------------------------------------------------------------------------

describe('B14 round-2 F1 — a window over the counter must never gut the walk silently', () => {
  /** kitchenScene + a window on w_s whose RO crosses the 44" band and spans
   * u in [0.4, 3.6] — the canonical window-over-sink kitchen. */
  function windowedKitchen(): { walls: WallSlice[]; rooms: RoomSlice[] } {
    const { walls, rooms } = kitchenScene()
    ;(walls[0] as WallSlice).openings.push({
      id: 'win_counter',
      kind: 'window',
      u: 2,
      width: 3.2 - RO_PAD,
      height: 1.4 - RO_PAD,
      sillHeight: 1.016, // 40" sill — RO crosses the counter band
      roughWidth: 3.2,
      roughHeight: 1.4,
    })
    return { walls, rooms }
  }

  test('boxes collapse to the RO edges AND the level warns the 24"/48" walk is broken', () => {
    const { walls, rooms } = windowedKitchen()
    const warnings: string[] = []
    const sink = placedItem('sink_1', 'kitchen-sink', [2, 0.5])
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, warnings, [sink]))
    expect(ctr.length).toBeGreaterThanOrEqual(1) // the walk still places what it can
    // the RO really did break the pitch (bite-proof: gap > 48" + faucet cut)
    const us = ctr.map((f) => f.position[0]).sort((a, b) => a - b)
    let maxGap = 0
    for (let i = 0; i + 1 < us.length; i++) {
      maxGap = Math.max(maxGap, (us[i + 1] as number) - (us[i] as number))
    }
    expect(maxGap).toBeGreaterThan(inches(48) + 0.7)
    expect(
      warnings.some(
        (w) => w.includes('Kitchen') && w.includes('210.52(C)') && w.includes('rough-opening snap'),
      ),
    ).toBe(true)
  })

  test('bite direction: the unobstructed kitchen walk NEVER fires the coverage warning', () => {
    const { walls, rooms } = kitchenScene()
    const warnings: string[] = []
    const sink = placedItem('sink_1', 'kitchen-sink', [2, 0.5])
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, warnings, [sink]))
    expect(ctr.length).toBeGreaterThanOrEqual(2)
    expect(warnings.some((w) => w.includes('rough-opening snap'))).toBe(false)
  })

  test('the faucet-zone nudge alone never trips the coverage audit (behind-sink space is exempt)', () => {
    const { walls, rooms } = kitchenScene(2.4)
    const warnings: string[] = []
    const sink = placedItem('sink_1', 'kitchen-sink', [0.6, 0.5])
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, warnings, [sink]))
    expect(ctr.length).toBeGreaterThanOrEqual(1)
    expect(warnings.some((w) => w.includes('rough-opening snap'))).toBe(false)
  })
})

describe('B14 round-2 F2 — a sinked kitchen with zero counter boxes is NEVER wordless', () => {
  test('sink projecting into a door RO span: zero boxes + explicit 210.52(C) warning', () => {
    const { walls, rooms } = kitchenScene()
    ;(walls[0] as WallSlice).openings.push(door(2, 1.8, 'door_wide'))
    const warnings: string[] = []
    const sink = placedItem('sink_1', 'kitchen-sink', [2, 0.6])
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, warnings, [sink]))
    expect(ctr.length).toBe(0)
    expect(
      warnings.some(
        (w) => w.includes('Kitchen') && w.includes('doorway span') && w.includes('210.52(C)'),
      ),
    ).toBe(true)
  })

  test('counter wall not facing its kitchen (degenerate zone): zero boxes + explicit warning', () => {
    const { walls } = rectScene()
    const kitchen = room(
      'kitchen',
      [
        [1, 0.2],
        [3, 0.2],
        [3, 1.2],
        [1, 1.2],
      ],
      { name: 'Kitchenette' },
    )
    const warnings: string[] = []
    const sink = placedItem('sink_1', 'kitchen-sink', [2, 0.9])
    const ctr = counterBoxes(layoutElectrical(walls, [kitchen], undefined, warnings, [sink]))
    expect(ctr.length).toBe(0)
    expect(
      warnings.some((w) => w.includes('Kitchenette') && w.includes('does not face its kitchen')),
    ).toBe(true)
  })

  test('sub-12" counter strip: zero boxes + the 210.52(C)(1) exemption is labeled', () => {
    const { walls } = rectScene()
    const kitchen = room(
      'kitchen',
      [
        [1.9, 0],
        [2.1, 0],
        [2.1, 0.5],
        [1.9, 0.5],
      ],
      { name: 'Galley' },
    )
    const warnings: string[] = []
    const sink = placedItem('sink_1', 'kitchen-sink', [2, 0.25])
    const ctr = counterBoxes(layoutElectrical(walls, [kitchen], undefined, warnings, [sink]))
    expect(ctr.length).toBe(0)
    expect(warnings.some((w) => w.includes('Galley') && w.includes('210.52(C)(1)'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// B14 round 2 — F3 (stated conservative reach), F4 (obstructed WR flag),
// F5 (counter/basin census exclusion)
// ---------------------------------------------------------------------------

describe('B14 round-2 F3 — the sink radius is straight-line BY DECISION, labeled on dry-room flips', () => {
  test('a dry-room flip carries the conservative-reach assumption on its label', () => {
    const { walls, rooms } = rectScene()
    const sink = placedItem('sink_1', 'kitchen-sink', [4, 1])
    const fixtures = layoutElectrical(walls, rooms, undefined, undefined, [sink])
    const flipped = fixtures.find(
      (f) => f.kind === 'receptacle-gfci' && f.sourceId === 'w_s' && Math.abs(southU(f) - 4) < 0.1,
    )
    expect(flipped).toBeDefined()
    expect(flipped?.label).toContain('210.8(A)(7)/(9)')
    expect(flipped?.label).toContain('straight-line reach, conservative')
  })

  test('PINNED INTENT: the radius pierces walls — a box behind a partition still flips (over-protects, never under)', () => {
    // partition between the lav and the south wall's boxes
    const walls = [
      wall('w_s', [0, 0], [8, 0]),
      wall('w_e', [8, 0], [8, 6]),
      wall('w_n', [8, 6], [0, 6]),
      wall('w_w', [0, 6], [0, 0]),
      wall('w_div', [0, 0.6], [8, 0.6], { exterior: false, thickness: 0.114 }),
    ]
    const rooms = [
      room('other', [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ]),
    ]
    const lav = placedItem('lav_1', 'lavatory', [4, 1]) // other side of w_div from w_s's boxes
    const fixtures = layoutElectrical(walls, rooms, undefined, undefined, [lav])
    const southMid = fixtures.find(
      (f) =>
        (f.kind === 'receptacle' || f.kind === 'receptacle-gfci') &&
        f.sourceId === 'w_s' &&
        Math.abs(southU(f) - 4) < 0.35,
    )
    expect(southMid).toBeDefined()
    expect(southMid?.kind).toBe('receptacle-gfci') // pierced the partition — intended
    expect(southMid?.label).toContain('conservative')
  })
})

describe('B14 round-2 F4 — a WR box that cannot clear the glazing is ⚠-flagged, never silent', () => {
  test('near-full-width glazing: the box overlaps the RO edge → flag + meta + level warning', () => {
    const walls = [
      wall('w_s', [0, 0], [8, 0], {
        openings: [
          {
            id: 'win_wall',
            kind: 'window',
            u: 4,
            width: 7.8 - RO_PAD,
            height: 1.4,
            sillHeight: 0.2,
            roughWidth: 7.8,
            roughHeight: 1.4 + RO_PAD,
          },
        ],
      }),
      wall('w_e', [8, 0], [8, 6]),
      wall('w_n', [8, 6], [0, 6]),
      wall('w_w', [0, 6], [0, 0]),
    ]
    const rooms = [
      room('other', [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ]),
    ]
    const warnings: string[] = []
    const out = outdoor(layoutElectrical(walls, rooms, undefined, warnings))
    const front = out.find((f) => f.meta?.outdoor === 'front')
    expect(front?.sourceId).toBe('w_s')
    expect(front?.meta?.obstructed).toBe(true)
    expect(front?.label).toContain('⚠')
    expect(front?.label).toContain('obstructed by glazing')
    expect(
      warnings.some((w) => w.includes('outdoor receptacle (front)') && w.includes('obstructed')),
    ).toBe(true)
  })

  test('bite direction: clear walls carry NO obstruction flag', () => {
    const { walls, rooms } = rectScene()
    const warnings: string[] = []
    for (const f of outdoor(layoutElectrical(walls, rooms, undefined, warnings))) {
      expect(f.meta?.obstructed).toBeUndefined()
      expect(f.label).not.toContain('⚠')
    }
    expect(warnings.some((w) => w.includes('obstructed'))).toBe(false)
  })
})

describe('B14 round-2 F5 — counter boxes never satisfy the 210.52(A) floor-line census', () => {
  test('interior counter wall: moving a floor box away fires the spacing warning DESPITE counter boxes in the gap', () => {
    const walls = [
      wall('w_s', [0, 0], [8, 0]),
      wall('w_mid', [0, 3], [8, 3], { exterior: false, thickness: 0.114 }),
      wall('w_far', [0, 6], [8, 6], { exterior: false, thickness: 0.114 }),
    ]
    const kitchen = room(
      'kitchen',
      [
        [0, 3],
        [8, 3],
        [8, 5],
        [0, 5],
      ],
      { name: 'Kitchen' },
    )
    const sink = placedItem('sink_1', 'kitchen-sink', [4, 3.4])
    const fixtures = layoutElectrical(walls, [kitchen], undefined, undefined, [sink])
    // the counter walk covered w_mid's kitchen face end to end
    const ctr = counterBoxes(fixtures).filter((f) => f.sourceId === 'w_mid')
    expect(ctr.length).toBeGreaterThanOrEqual(4)
    // move w_mid's middle kitchen-face floor box to another wall
    const moved = fixtures.find(
      (f) => f.meta?.deviceId === 'recep-w_mid-1-p' && Math.abs(f.position[1] - inches(15)) < 1e-6,
    )
    expect(moved).toBeDefined()
    const overrides = new Map([['recep-w_mid-1-p', { wallId: 'w_far', wallT: 0.5 }]])
    const applied = applyDeviceOverrides(fixtures, walls, [kitchen], [], overrides)
    // the floor-line gap on w_mid is real (>6 ft to the nearest FLOOR box)
    // even though 44" counter GFCI boxes sit inside it — they never count
    expect(
      applied.warnings.some(
        (w: string) => w.includes('w_mid') && w.includes('receptacle spacing exceeds NEC 210.52'),
      ),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// B14 round 3 — the walked-dedupe was a FOURTH silent bail; WR ⚠ follows moves
// ---------------------------------------------------------------------------

describe('B14 round-3 — a second counter run on the SAME wall face walks its own span', () => {
  /** 16 m shell: kitchens A (x in [0,4]) and B (x in [8,12]) both face w_s. */
  function twoKitchenScene(): { walls: WallSlice[]; rooms: RoomSlice[] } {
    const walls = [
      wall('w_s', [0, 0], [16, 0]),
      wall('w_e', [16, 0], [16, 6]),
      wall('w_n', [16, 6], [0, 6]),
      wall('w_w', [0, 6], [0, 0]),
    ]
    const kA = room(
      'kitchen',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      { id: 'room_kA', name: 'Kitchen A' },
    )
    const kB = room(
      'kitchen',
      [
        [8, 0],
        [12, 0],
        [12, 3],
        [8, 3],
      ],
      { id: 'room_kB', name: 'Kitchen B' },
    )
    return { walls, rooms: [kA, kB] }
  }

  test('scenario A: two kitchen zones down one wall — BOTH get counter boxes, ids unique', () => {
    const { walls, rooms } = twoKitchenScene()
    const warnings: string[] = []
    const sinks = [
      placedItem('sink_a', 'kitchen-sink', [2, 0.5]),
      placedItem('sink_b', 'kitchen-sink', [10, 0.5]),
    ]
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, warnings, sinks))
    const inA = ctr.filter((f) => f.position[0] < 4.1)
    const inB = ctr.filter((f) => f.position[0] > 7.9 && f.position[0] < 12.1)
    expect(inA.length).toBeGreaterThanOrEqual(2)
    expect(inB.length).toBeGreaterThanOrEqual(2) // the old global key gave B ZERO, wordless
    const ids = ctr.map((f) => String(f.meta?.deviceId))
    expect(new Set(ids).size).toBe(ids.length)
    expect(warnings.some((w) => w.includes('rough-opening snap'))).toBe(false)
  })

  test('scenario B: same kitchen, two sinks split by a door RO — the far run walks too', () => {
    const { walls, rooms } = kitchenScene(8) // kitchen spans the full 8 m wall
    ;(walls[0] as WallSlice).openings.push(door(4, 0.9, 'door_split'))
    const sinks = [
      placedItem('sink_1', 'kitchen-sink', [2, 0.5]),
      placedItem('sink_2', 'kitchen-sink', [6, 0.5]),
    ]
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, undefined, sinks))
    const doorLo = 4 - (0.9 + RO_PAD) / 2
    const doorHi = 4 + (0.9 + RO_PAD) / 2
    const left = ctr.filter((f) => f.position[0] < doorLo)
    const right = ctr.filter((f) => f.position[0] > doorHi)
    expect(left.length).toBeGreaterThanOrEqual(2)
    expect(right.length).toBeGreaterThanOrEqual(2) // the old key left this run EMPTY
    const ids = ctr.map((f) => String(f.meta?.deviceId))
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('honest silence: a second sink INSIDE an already-walked span adds no boxes and no words', () => {
    const { walls, rooms } = kitchenScene()
    const one = counterBoxes(
      layoutElectrical(walls, rooms, undefined, undefined, [
        placedItem('sink_1', 'kitchen-sink', [2, 0.5]),
      ]),
    )
    const warnings: string[] = []
    const two = counterBoxes(
      layoutElectrical(walls, rooms, undefined, warnings, [
        placedItem('sink_1', 'kitchen-sink', [2, 0.5]),
        placedItem('sink_2', 'kitchen-sink', [3, 0.5]),
      ]),
    )
    expect(two.length).toBe(one.length)
    expect(warnings.some((w) => w.includes('210.52(C)'))).toBe(false)
  })
})

describe('B14 round-3 — the WR glazing ⚠ follows user moves (recomputed, never stale)', () => {
  /** 8 m glazed front (w_s, near-full window) + clear back (w_n). */
  function glazedScene(): { walls: WallSlice[]; rooms: RoomSlice[] } {
    const walls = [
      wall('w_s', [0, 0], [8, 0], {
        openings: [
          {
            id: 'win_wall',
            kind: 'window',
            u: 4,
            width: 7.8 - RO_PAD,
            height: 1.4,
            sillHeight: 0.2,
            roughWidth: 7.8,
            roughHeight: 1.4 + RO_PAD,
          },
        ],
      }),
      wall('w_e', [8, 0], [8, 6]),
      wall('w_n', [8, 6], [0, 6]),
      wall('w_w', [0, 6], [0, 0]),
    ]
    const rooms = [
      room('other', [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ]),
    ]
    return { walls, rooms }
  }

  test('dragging the obstructed front box to a CLEAR wall sheds the flag and the label note', () => {
    const { walls, rooms } = glazedScene()
    const fixtures = layoutElectrical(walls, rooms)
    const front = fixtures.find((f) => f.meta?.outdoor === 'front')
    expect(front?.meta?.obstructed).toBe(true) // starts flagged (F4)
    const overrides = new Map([[String(front?.meta?.deviceId), { wallId: 'w_e', wallT: 0.5 }]])
    const applied = applyDeviceOverrides(fixtures, walls, rooms, [], overrides)
    const moved = applied.fixtures.find((f) => f.meta?.outdoor === 'front')
    expect(moved?.meta?.obstructed).toBeUndefined()
    expect(moved?.label).not.toContain('⚠')
    expect(moved?.label).toContain('WR GFCI') // the base label survives the shed
  })

  test('dragging the clear back box INTO the glazing gains the flag (bite both directions)', () => {
    const { walls, rooms } = glazedScene()
    const fixtures = layoutElectrical(walls, rooms)
    const back = fixtures.find((f) => f.meta?.outdoor === 'back')
    expect(back?.meta?.obstructed).toBeUndefined() // w_n is clear
    const overrides = new Map([[String(back?.meta?.deviceId), { wallId: 'w_s', wallT: 0.5 }]])
    const applied = applyDeviceOverrides(fixtures, walls, rooms, [], overrides)
    const moved = applied.fixtures.find((f) => f.meta?.outdoor === 'back')
    expect(moved?.meta?.obstructed).toBe(true)
    expect(moved?.label).toContain('⚠')
  })
})

// ---------------------------------------------------------------------------
// B14 night-10 — WALK-REMOVAL ORDINAL STABILITY (E5): deleting a sink must
// never re-base the surviving walk's deviceIds (ctr-4..7 → ctr-0..3 orphaned
// the user's bones:device overrides — the r3 skeptic's advisory). The
// per-face offset now keys on the kitchen ZONE (rank × 100 id block,
// sink-independent), not on how many boxes sibling walks placed first.
// ---------------------------------------------------------------------------

describe('B14 night-10 — counter walk ids survive sibling-sink removal (E5 ordinal stability)', () => {
  /** 16 m shell, kitchens A (x in [0,4]) and B (x in [8,12]) on one face —
   * the round-3 scenario A shape, id-sorted room_kA < room_kB. */
  function twoKitchenScene(): { walls: WallSlice[]; rooms: RoomSlice[] } {
    const walls = [
      wall('w_s', [0, 0], [16, 0]),
      wall('w_e', [16, 0], [16, 6]),
      wall('w_n', [16, 6], [0, 6]),
      wall('w_w', [0, 6], [0, 0]),
    ]
    const kA = room(
      'kitchen',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      { id: 'room_kA', name: 'Kitchen A' },
    )
    const kB = room(
      'kitchen',
      [
        [8, 0],
        [12, 0],
        [12, 3],
        [8, 3],
      ],
      { id: 'room_kB', name: 'Kitchen B' },
    )
    return { walls, rooms: [kA, kB] }
  }
  const sinkA = placedItem('sink_a', 'kitchen-sink', [2, 0.5])
  const sinkB = placedItem('sink_b', 'kitchen-sink', [10, 0.5])
  const idsOf = (fx: Fixture[]): string[] =>
    counterBoxes(fx)
      .map((f) => String(f.meta?.deviceId))
      .sort()

  test('zone blocks: kitchen A walks plain ctr-0.., kitchen B its own 100-block — both stable, unique', () => {
    const { walls, rooms } = twoKitchenScene()
    const ctr = counterBoxes(layoutElectrical(walls, rooms, undefined, undefined, [sinkA, sinkB]))
    const inA = ctr.filter((f) => f.position[0] < 4.1)
    const inB = ctr.filter((f) => f.position[0] > 7.9)
    expect(inA.length).toBeGreaterThanOrEqual(2)
    expect(inB.length).toBeGreaterThanOrEqual(2)
    for (const f of inA) expect(String(f.meta?.deviceId)).toMatch(/^recep-w_s-ctr-[0-9]-(p|m)$/)
    for (const f of inB) expect(String(f.meta?.deviceId)).toMatch(/^recep-w_s-ctr-1\d\d-(p|m)$/)
    const ids = ctr.map((f) => String(f.meta?.deviceId))
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('delete sink B → walk A ids unchanged; delete sink A → walk B ids unchanged (the shuffling case); re-add round-trips', () => {
    const { walls, rooms } = twoKitchenScene()
    const both = layoutElectrical(walls, rooms, undefined, undefined, [sinkA, sinkB])
    const bothIds = idsOf(both)
    const idsA = idsOf(both).filter((id) => {
      const f = counterBoxes(both).find((x) => String(x.meta?.deviceId) === id) as Fixture
      return f.position[0] < 4.1
    })
    const idsB = bothIds.filter((id) => !idsA.includes(id))

    // delete sink B: kitchen A's walk keeps every id
    expect(idsOf(layoutElectrical(walls, rooms, undefined, undefined, [sinkA]))).toEqual(idsA)
    // delete sink A: kitchen B's walk keeps every id — the OLD running
    // offset re-based these to ctr-0..3 and orphaned user overrides
    expect(idsOf(layoutElectrical(walls, rooms, undefined, undefined, [sinkB]))).toEqual(idsB)
    // re-add: byte round-trip (ids AND positions)
    const again = layoutElectrical(walls, rooms, undefined, undefined, [sinkA, sinkB])
    const tuple = (fx: Fixture[]) =>
      counterBoxes(fx)
        .map((f) => `${String(f.meta?.deviceId)}@${f.position.join(',')}`)
        .sort()
    expect(tuple(again)).toEqual(tuple(both))
  })

  test('single-kitchen faces stay byte-identical: plain consecutive ctr-0..n-1 (master parity — the migration guard)', () => {
    const { walls, rooms } = kitchenScene()
    const ctr = counterBoxes(
      layoutElectrical(walls, rooms, undefined, undefined, [
        placedItem('sink_1', 'kitchen-sink', [2, 0.5]),
      ]),
    )
    const ords = ctr
      .map((f) => Number(String(f.meta?.deviceId).match(/-ctr-(\d+)-/)?.[1]))
      .sort((a, b) => a - b)
    expect(ords).toEqual([...ctr.keys()]) // 0..n-1, no block offset
  })

  test('same-zone sibling walks (two sinks split by a door RO) keep the legacy running ordinal inside ONE block', () => {
    // the round-3 scenario B shape — DOCUMENTED residual: deleting the
    // first same-zone sink still re-bases the second walk (solo-scene id
    // parity makes sibling-independent ids impossible in a pure engine);
    // the block scheme must NOT split one zone's walks across blocks.
    const { walls, rooms } = kitchenScene(8)
    ;(walls[0] as WallSlice).openings.push(door(4, 0.9, 'door_split'))
    const ctr = counterBoxes(
      layoutElectrical(walls, rooms, undefined, undefined, [
        placedItem('sink_1', 'kitchen-sink', [2, 0.5]),
        placedItem('sink_2', 'kitchen-sink', [6, 0.5]),
      ]),
    )
    const ords = ctr
      .map((f) => Number(String(f.meta?.deviceId).match(/-ctr-(\d+)-/)?.[1]))
      .sort((a, b) => a - b)
    expect(ords.length).toBeGreaterThanOrEqual(4)
    expect(Math.max(...ords)).toBeLessThan(100) // one zone = one block
    expect(ords).toEqual([...ctr.keys()]) // continuing 0..n-1, master parity
  })

  test('the reconciler never re-mints: a MOVED kitchen-B node survives sink-A deletion untouched (compute.devices machinery)', () => {
    const { walls, rooms } = twoKitchenScene()
    const both = layoutElectrical(walls, rooms, undefined, undefined, [sinkA, sinkB])
    const derived1 = deriveWallDevices(both, walls)

    // seed the level's bones:device nodes exactly as the reconcile effect would
    const nodes: Record<string, Record<string, unknown>> = {}
    for (const n of reconcileDeviceNodes({}, 'level_1', derived1).create) {
      nodes[n.id] = { ...n, parentId: 'level_1' }
    }
    // the user drags one of kitchen B's counter boxes (anchor ≠ seed)
    const movedNode = Object.values(nodes).find((n) => {
      const id = String(n.deviceId)
      return /-ctr-1\d\d-/.test(id)
    }) as Record<string, unknown>
    expect(movedNode).toBeDefined()
    movedNode.wallT = Math.min(1, Number(movedNode.wallT) + 0.05)

    // sink A deleted → kitchen B's ids still derive → the moved node is
    // neither removed nor re-created, and its anchor is never touched
    const after = layoutElectrical(walls, rooms, undefined, undefined, [sinkB])
    const derived2 = deriveWallDevices(after, walls)
    const plan = reconcileDeviceNodes(nodes, 'level_1', derived2)
    expect(plan.create).toEqual([]) // nothing re-mints
    expect(plan.remove.includes(String(movedNode.id))).toBe(false)
    const touch = plan.update.find((u) => u.id === movedNode.id)
    expect(touch?.data.wallT).toBeUndefined()
    expect(touch?.data.wallId).toBeUndefined()
    // only kitchen A's orphans leave — every removed node was an A-walk id
    for (const rid of plan.remove) {
      const gone = nodes[rid] as Record<string, unknown>
      expect(String(gone.deviceId)).toMatch(/-ctr-[0-9]-(p|m)$/)
    }
  })
})
