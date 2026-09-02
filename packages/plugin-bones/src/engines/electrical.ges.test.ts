import { describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import type { Member, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { feet } from '../core/units'
import { jurisdictionOptions } from '../jurisdiction/profiles'
import { baselineConfig, baselineScene } from '../framing/baseline-scene'
import { computeLevel } from '../framing/compute'
import { layoutElectrical, routeWiring } from './electrical'
import { MERGE_TOL, endpointsOf, segDist } from './electrical.test-helpers'
import { computeTakeoff } from './takeoff'

/**
 * Checklist E7 — the grounding electrode system (LOD-400 B12, NEC 250).
 * Every service chain carries its GES: two driven rods below grade at the
 * meter 6 ft apart (250.53(A)(2)/(B)), a continuous GEC meter → both rods
 * sized from the service rating (250.66), an intersystem bonding
 * termination at the service (250.94), and the metal-water-pipe bond
 * (250.104) — present when a water entry is visible, LABELED as an
 * assumption when not. Takeoff rows mirror the members 1:1.
 */

// ---------------------------------------------------------------------------
// Harness (the connectivity-suite scene shapes)
// ---------------------------------------------------------------------------

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [4, 0]
  const dx = (end[0] ?? 0) - (start[0] ?? 0)
  const dz = (end[1] ?? 0) - (start[1] ?? 0)
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall_c',
    start,
    end,
    dir: [dx / length, dz / length],
    length,
    thickness: 0.114,
    height: 2.5,
    exterior: true,
    openings: [] as OpeningSlice[],
    curved: false,
    ...overrides,
  }
}

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

const houseWalls = (): WallSlice[] => [
  makeWall({ id: 'w_s', start: [0, 0], end: [8, 0] }),
  makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
  makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
  makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
  makeWall({ id: 'w_div', start: [4, 0], end: [4, 4], exterior: false }),
]
const houseRooms = (): RoomSlice[] => [
  room('kitchen', [[0, 0], [4, 0], [4, 4], [0, 4]]),
  room('bedroom', [[4, 0], [8, 0], [8, 4], [4, 4]], { id: 'room_bed' }),
]

/** A plausible water entry ON a wall centerline (what compute resolves). */
const WATER_ENTRY: readonly [number, number, number] = [2, 0.3, 4]

const gesMembers = (members: Member[]): Member[] =>
  members.filter(
    (m) =>
      m.role === 'ground-rod' || m.sourceId === 'GES-1' || m.sourceId === 'GES-2' || m.sourceId === 'ges-ibt',
  )

const rodsOf = (members: Member[]): Member[] => members.filter((m) => m.role === 'ground-rod')

/** Rod TOP point (rods are vertical, length in dims[1], position = center). */
const rodTop = (rod: Member): Vector3 =>
  new Vector3(rod.position[0], rod.position[1] + rod.dims[1] / 2, rod.position[2])

/**
 * E2-style continuity: union-find over the given wire members' endpoints;
 * true when `from` and `to` land on the same connected component.
 */
function connected(wires: Member[], from: Vector3, to: Vector3): boolean {
  const parent: number[] = wires.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r] as number
    return r
  }
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b)
  }
  const ends = wires.map(endpointsOf)
  for (let i = 0; i < wires.length; i++) {
    for (let j = i + 1; j < wires.length; j++) {
      const [a1, a2] = ends[i] as [Vector3, Vector3]
      const [b1, b2] = ends[j] as [Vector3, Vector3]
      const touch =
        a1.distanceTo(b1) < MERGE_TOL ||
        a1.distanceTo(b2) < MERGE_TOL ||
        a2.distanceTo(b1) < MERGE_TOL ||
        a2.distanceTo(b2) < MERGE_TOL ||
        segDist(a1, b1, b2) < 0.03 ||
        segDist(a2, b1, b2) < 0.03 ||
        segDist(b1, a1, a2) < 0.03 ||
        segDist(b2, a1, a2) < 0.03
      if (touch) union(i, j)
    }
  }
  const touching = (p: Vector3): number | null => {
    for (let i = 0; i < wires.length; i++) {
      const [a, b] = ends[i] as [Vector3, Vector3]
      if (segDist(p, a, b) < 0.03) return i
    }
    return null
  }
  const fi = touching(from)
  const ti = touching(to)
  return fi !== null && ti !== null && find(fi) === find(ti)
}

const route = (waterEntry: readonly [number, number, number] | null = WATER_ENTRY) => {
  const walls = houseWalls()
  const fixtures = layoutElectrical(walls, houseRooms())
  const members = routeWiring(fixtures, walls, { waterEntry })
  return { walls, fixtures, members }
}

// ---------------------------------------------------------------------------
// Census + geometry
// ---------------------------------------------------------------------------

describe('GES census (checklist E7)', () => {
  test('exactly TWO driven rods, 6 ft apart, below grade, at the meter', () => {
    const { fixtures, members } = route()
    const rods = rodsOf(members)
    expect(rods.length).toBe(2)
    const [r1, r2] = rods as [Member, Member]
    // 6 ft plan separation (250.53(A)(2)/(B))
    const spacing = Math.hypot(
      r2.position[0] - r1.position[0],
      r2.position[2] - r1.position[2],
    )
    expect(spacing).toBeCloseTo(feet(6), 5)
    // at the METER: rod 1 within arm's reach of the meter mount
    const meter = fixtures.find((f) => f.kind === 'electric-meter')
    expect(meter).toBeDefined()
    const meterPlanDist = Math.hypot(
      (meter?.position[0] ?? 0) - r1.position[0],
      (meter?.position[2] ?? 0) - r1.position[2],
    )
    expect(meterPlanDist).toBeLessThan(1.0)
    for (const rod of rods) {
      // 8 ft embedment, top strictly below grade (250.52(A)(5), 250.53(G))
      expect(rod.length).toBeCloseTo(feet(8), 5)
      expect(rod.dims[1]).toBeCloseTo(feet(8), 5)
      const top = rod.position[1] + rod.dims[1] / 2
      const bottom = rod.position[1] - rod.dims[1] / 2
      expect(top).toBeLessThan(0)
      expect(bottom).toBeCloseTo(top - feet(8), 5)
    }
  })

  test('GEC is continuous meter → BOTH rods (E2-style union-find) and sized with a code cite', () => {
    const { fixtures, members } = route()
    const gec = members.filter((m) => m.sourceId === 'GES-1')
    expect(gec.length).toBeGreaterThan(0)
    for (const m of gec) {
      expect(m.label).toContain('NEC 250.66')
      expect(m.label).toMatch(/GEC \d+ AWG Cu/)
    }
    const meter = fixtures.find((f) => f.kind === 'electric-meter')
    const meterAt = new Vector3(...(meter?.position ?? [0, 0, 0]))
    for (const rod of rodsOf(members)) {
      expect(connected(gec, meterAt, rodTop(rod))).toBe(true)
    }
  })

  test('intersystem bonding termination mounts at the meter (250.94)', () => {
    const { fixtures, members } = route()
    const ibt = members.filter((m) => m.sourceId === 'ges-ibt')
    expect(ibt.length).toBe(1)
    const meter = fixtures.find((f) => f.kind === 'electric-meter')
    const d = Math.hypot(
      (meter?.position[0] ?? 0) - (ibt[0]?.position[0] ?? 9),
      (meter?.position[2] ?? 0) - (ibt[0]?.position[2] ?? 9),
    )
    expect(d).toBeLessThan(0.1)
    expect(ibt[0]?.label).toContain('NEC 250.94')
  })

  test('water-pipe bond: continuous panel → water entry, E4-legal legs', () => {
    const { walls, fixtures, members } = route()
    const bond = members.filter((m) => m.sourceId === 'GES-2')
    expect(bond.length).toBeGreaterThan(0)
    for (const m of bond) expect(m.label).toContain('NEC 250.104')
    const panel = fixtures.find((f) => f.kind === 'panel')
    expect(
      connected(bond, new Vector3(...(panel?.position ?? [0, 0, 0])), new Vector3(...WATER_ENTRY)),
    ).toBe(true)
    // no bond leg hangs in room air at living height (E4's invariant)
    const ceilingY = Math.max(...walls.map((w) => w.height))
    for (const m of bond) {
      const [a, b] = endpointsOf(m)
      if (Math.abs(a.y - b.y) >= 0.005 || a.distanceTo(b) < 0.05) continue
      const y = (a.y + b.y) / 2
      if (y >= ceilingY - 0.01 || y <= 0.01) continue
      const onWall = walls.some((w) => {
        const near = (x: number, z: number): boolean => {
          const dx = x - w.start[0]
          const dz = z - w.start[1]
          const along = dx * w.dir[0] + dz * w.dir[1]
          const perp = Math.abs(-dx * w.dir[1] + dz * w.dir[0])
          return along > -0.15 && along < w.length + 0.15 && perp < w.thickness / 2 + 0.08
        }
        return near(a.x, a.z) && near(b.x, b.z)
      })
      expect(onWall, `${m.label} @y=${y.toFixed(2)}`).toBe(true)
    }
  })

  test('GEC horizontal legs: at/below the grade line, or strapped ON the wall (E4)', () => {
    const { walls, members } = route()
    for (const m of members.filter((w) => w.sourceId === 'GES-1')) {
      const [a, b] = endpointsOf(m)
      if (Math.abs(a.y - b.y) >= 0.005) continue
      const y = (a.y + b.y) / 2
      if (y <= 0.01) continue // grade-line / buried — legal
      // the meter strap-out rides the wall band (never open room air)
      const onWall = walls.some((w) => {
        const near = (x: number, z: number): boolean => {
          const dx = x - w.start[0]
          const dz = z - w.start[1]
          const along = dx * w.dir[0] + dz * w.dir[1]
          const perp = Math.abs(-dx * w.dir[1] + dz * w.dir[0])
          return along > -0.15 && along < w.length + 0.15 && perp < w.thickness / 2 + 0.08
        }
        return near(a.x, a.z) && near(b.x, b.z)
      })
      expect(onWall, `${m.label} @y=${y.toFixed(2)}`).toBe(true)
    }
    // …and the legs that CARRY the run to the rods really are down at grade
    const gradeLegs = members.filter(
      (w) => w.sourceId === 'GES-1' && (w.label?.includes('grade run') || w.label?.includes('rod 1 → rod 2')),
    )
    expect(gradeLegs.length).toBeGreaterThanOrEqual(2)
    for (const m of gradeLegs) expect(m.position[1]).toBeLessThanOrEqual(0.01)
  })

  test('NO water entry: bond absent, assumption LABELED on the termination — never silent', () => {
    const { members } = route(null)
    expect(members.filter((m) => m.sourceId === 'GES-2').length).toBe(0)
    const ibt = members.find((m) => m.sourceId === 'ges-ibt')
    expect(ibt?.label).toContain('water-pipe bond not modeled')
    expect(ibt?.label).toContain('250.104')
    // rods + GEC still land — the GES itself never depends on plumbing
    expect(rodsOf(members).length).toBe(2)
  })

  test('no meter (the AC-disconnect routing subset): zero GES members', () => {
    const walls = houseWalls()
    const fixtures = layoutElectrical(walls, houseRooms()).filter(
      (f) => f.kind !== 'electric-meter',
    )
    const members = routeWiring(fixtures, walls, { waterEntry: WATER_ENTRY })
    expect(gesMembers(members).length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Takeoff parity: rows == member counts / lengths
// ---------------------------------------------------------------------------

describe('GES takeoff rows mirror the members (S4 parity)', () => {
  const round1 = (n: number): number => Math.round(n * 10) / 10
  const toFeetSum = (ms: Member[]): number =>
    round1(ms.reduce((sum, m) => sum + m.length / 0.3048, 0))

  test('rods pcs / clamps pcs / GEC lf / bonding jumper lf / termination pcs', () => {
    const { fixtures, members } = route()
    const rows = computeTakeoff(members, fixtures)
    const row = (item: string) => rows.find((r) => r.item.startsWith(item))
    expect(row('Ground rods')?.quantity).toBe(rodsOf(members).length)
    expect(row('Ground rods')?.quantity).toBe(2)
    // 2 acorn clamps + the water-pipe clamp
    expect(row('Ground clamps')?.quantity).toBe(3)
    expect(row('GEC')?.quantity).toBeCloseTo(
      toFeetSum(members.filter((m) => m.sourceId === 'GES-1')),
      5,
    )
    expect(row('GEC')?.unit).toBe('lf')
    expect(row('Bonding jumper')?.quantity).toBeCloseTo(
      toFeetSum(members.filter((m) => m.sourceId === 'GES-2')),
      5,
    )
    expect(row('Intersystem bonding termination')?.quantity).toBe(1)
    // gauge on the row matches the member labels (single source of truth)
    const awg = members
      .find((m) => m.sourceId === 'GES-1')
      ?.label?.match(/GEC (\d+) AWG/)?.[1]
    expect(row('GEC')?.item).toBe(`GEC ${awg} AWG bare Cu`)
  })

  test('bond-less scene: clamps drop to 2, no jumper row', () => {
    const { fixtures, members } = route(null)
    const rows = computeTakeoff(members, fixtures)
    expect(rows.find((r) => r.item.startsWith('Ground clamps'))?.quantity).toBe(2)
    expect(rows.find((r) => r.item.startsWith('Bonding jumper'))).toBeUndefined()
  })

  test('GEC/bond lf never leaks into the NM-B tallies', () => {
    const { fixtures, members } = route()
    const withGes = computeTakeoff(members, fixtures)
    const withoutGes = computeTakeoff(
      members.filter((m) => m.sourceId !== 'GES-1' && m.sourceId !== 'GES-2'),
      fixtures,
    )
    const nm = (rows: typeof withGes) =>
      rows.filter((r) => r.item.startsWith('NM-B')).map((r) => `${r.item}|${r.quantity}`)
    expect(nm(withGes)).toEqual(nm(withoutGes))
  })
})

// ---------------------------------------------------------------------------
// Jurisdiction sweep — the GES is universal NEC
// ---------------------------------------------------------------------------

describe('GES on every jurisdiction (universal NEC)', () => {
  /** The baseline scene with a REAL placed toilet — plumbing takes the
   * placed path and models its water-meter fixture (the bond target). */
  const placedScene = (): Record<string, Record<string, unknown>> => {
    const scene = baselineScene()
    scene.toilet_1 = { ...scene.toilet_1, asset: { id: 'toilet' } }
    return scene
  }

  test('all states: 2 rods + GEC + termination + water bond on the placed scene', () => {
    for (const { code } of jurisdictionOptions()) {
      const result = computeLevel(placedScene(), baselineConfig(code))
      const rods = rodsOf(result.members)
      expect(rods.length, code).toBe(2)
      expect(result.members.some((m) => m.sourceId === 'GES-1'), code).toBe(true)
      expect(result.members.some((m) => m.sourceId === 'ges-ibt'), code).toBe(true)
      // plumbing models its water meter → the bond lands, no assumption
      expect(result.members.some((m) => m.sourceId === 'GES-2'), code).toBe(true)
      expect(
        result.warnings.some((w) => w.includes('water-pipe bond')),
        code,
      ).toBe(false)
    }
  })

  test('cross-trade parity: the bond terminates AT the plumbing water meter', () => {
    const result = computeLevel(placedScene(), baselineConfig('INTL'))
    const waterMeter = result.fixtures.find((f) => f.kind === 'water-meter')
    expect(waterMeter).toBeDefined()
    const target = new Vector3(...(waterMeter?.position ?? [0, 0, 0]))
    const bond = result.members.filter((m) => m.sourceId === 'GES-2')
    expect(bond.length).toBeGreaterThan(0)
    const nearest = Math.min(
      ...bond.flatMap((m) => endpointsOf(m).map((p) => p.distanceTo(target))),
    )
    expect(nearest).toBeLessThan(0.03)
  })

  test('fallback-path plumbing (no placed fixtures): no meter is modeled — warn + label, never silent', () => {
    // the stock baseline toilet has NO sanitary asset id → room-category
    // fallback plumbing, which draws no water-meter fixture at all
    const result = computeLevel(baselineScene(), baselineConfig('INTL'))
    expect(result.fixtures.some((f) => f.kind === 'water-meter')).toBe(false)
    expect(result.members.filter((m) => m.sourceId === 'GES-2').length).toBe(0)
    expect(
      result.warnings.some((w) => w.includes('water-pipe bond (NEC 250.104) not modeled')),
    ).toBe(true)
    const ibt = result.members.find((m) => m.sourceId === 'ges-ibt')
    expect(ibt?.label).toContain('water-pipe bond not modeled')
    // rods + GEC land regardless — the GES never depends on plumbing
    expect(rodsOf(result.members).length).toBe(2)
  })

  test('plumbing OFF + waterEntry service override: bond to the override', () => {
    const scene = baselineScene()
    scene.svc_water = {
      id: 'svc_water',
      type: 'bones:service',
      parentId: 'level_1',
      serviceType: 'water-entry',
      wallId: 'w_n',
      wallT: 0.25,
      heightAff: 0.3,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }
    const config = baselineConfig('INTL')
    const result = computeLevel(scene, { ...config, showPlumbing: false })
    const bond = result.members.filter((m) => m.sourceId === 'GES-2')
    expect(bond.length).toBeGreaterThan(0)
    expect(result.warnings.some((w) => w.includes('water-pipe bond'))).toBe(false)
    // the bond really ends at the override's wall point: w_n runs
    // [12,8]→[0,8], t=0.25 → plan [9, 8] at 0.3 AFF
    const target = new Vector3(9, 0.3, 8)
    const nearest = Math.min(
      ...bond.flatMap((m) => endpointsOf(m).map((p) => p.distanceTo(target))),
    )
    expect(nearest).toBeLessThan(0.03)
  })

  test('plumbing OFF + no override: the level warns and the termination is labeled', () => {
    const config = baselineConfig('INTL')
    const result = computeLevel(baselineScene(), { ...config, showPlumbing: false })
    expect(result.members.filter((m) => m.sourceId === 'GES-2').length).toBe(0)
    expect(result.warnings.some((w) => w.includes('water-pipe bond (NEC 250.104) not modeled'))).toBe(
      true,
    )
    const ibt = result.members.find((m) => m.sourceId === 'ges-ibt')
    expect(ibt?.label).toContain('water-pipe bond not modeled')
  })
})

// ---------------------------------------------------------------------------
// Round-3 skeptic gates: F1 lateral × rod, F2 bond × feed embedment,
// F3 scene-aware rod spots, F4 per-storey honesty
// ---------------------------------------------------------------------------

/** Min 3D distance between two member centerlines (21-sample sweep of one
 * segment against the other via the shared point-to-segment helper). */
function memberDist(a: Member, b: Member): number {
  const [a1, a2] = endpointsOf(a)
  const [b1, b2] = endpointsOf(b)
  let min = Number.POSITIVE_INFINITY
  for (let i = 0; i <= 20; i++) {
    const p = a1.clone().lerp(a2, i / 20)
    min = Math.min(min, segDist(p, b1, b2))
    const q = b1.clone().lerp(b2, i / 20)
    min = Math.min(min, segDist(q, a1, a2))
  }
  return min
}

const dirOf = (m: Member): Vector3 => {
  const [a, b] = endpointsOf(m)
  return b.clone().sub(a).normalize()
}

describe('round-3 F1 — the SE street lateral never bores a ground rod', () => {
  test('DEFAULT baseline scene (the enshrined pair): every rod clears every SE member', () => {
    // The skeptic repro: rod1 used to sit exactly ON the lateral approach
    // line (x = meter x) with the lateral at y=-0.45 passing through the
    // full 16 mm rod section. Rods are rigid — a cable cannot cross one.
    const result = computeLevel(baselineScene(), baselineConfig('INTL'))
    const rods = result.members.filter((m) => m.role === 'ground-rod')
    const se = result.members.filter(
      (m) => m.role === 'wire-run' && m.sourceId === 'service-entrance',
    )
    expect(rods.length).toBe(2)
    expect(se.length).toBeGreaterThan(0)
    const CLEAR = 0.035 / 2 + 0.016 / 2 + 0.001 // half sections, hard floor
    for (const rod of rods) {
      for (const cable of se) {
        expect(
          memberDist(rod, cable),
          `${rod.sourceId} vs ${cable.label}`,
        ).toBeGreaterThanOrEqual(CLEAR)
      }
    }
    // …and the engine-level clearance target (sections + 2 cm skin) holds
    // against the BURIED legs specifically (the boring class)
    for (const rod of rods) {
      for (const cable of se.filter((m) => m.position[1] < 0)) {
        expect(memberDist(rod, cable)).toBeGreaterThanOrEqual(0.035 / 2 + 0.016 / 2 + 0.015)
      }
    }
  })
})

describe('round-3 F2 — GES conductors never run INSIDE the SE cable', () => {
  test('parallel GES legs keep section clearance of every service-entrance member', () => {
    // The skeptic repro: the bond's panel-bay drop shared its exact plan
    // point with the meter→panel feed rise (0.95 m of 14 mm conductor
    // fully inside the 35 mm cable) and the old bond plane sat 12 mm off
    // the feed plane — under the 24.5 mm half-section sum. Perpendicular
    // CROSSINGS stay legal (one cable straps over the other); PARALLEL
    // runs must clear the summed half-sections.
    const { members } = route()
    const ges = members.filter(
      (m) => m.role === 'wire-run' && (m.sourceId === 'GES-1' || m.sourceId === 'GES-2'),
    )
    const se = members.filter(
      (m) => m.role === 'wire-run' && m.sourceId === 'service-entrance',
    )
    expect(ges.length).toBeGreaterThan(0)
    expect(se.length).toBeGreaterThan(0)
    const EMBED = (0.035 + 0.014) / 2 // summed half-sections
    for (const g of ges) {
      for (const cable of se) {
        if (Math.abs(dirOf(g).dot(dirOf(cable))) < 0.9) continue // crossing
        expect(
          memberDist(g, cable),
          `${g.label} vs ${cable.label}`,
        ).toBeGreaterThanOrEqual(EMBED)
      }
    }
  })

  test('the bond still walks panel → water entry after the strap-outs (continuity regression)', () => {
    const { fixtures, members } = route()
    const bond = members.filter((m) => m.sourceId === 'GES-2')
    const panel = fixtures.find((f) => f.kind === 'panel')
    expect(
      connected(bond, new Vector3(...(panel?.position ?? [0, 0, 0])), new Vector3(...WATER_ENTRY)),
    ).toBe(true)
  })
})

describe('round-3 F3 — rod spots are scene-aware (concave L-plan)', () => {
  /** The skeptic repro: main 8×4 + wing x∈[8,10] z∈[-3,4]; the meter lands
   * near the reentrant corner of the south wall and the naive rod 2 fell
   * INSIDE the wing footprint, the buried rod-to-rod leg boring the wing's
   * stemwall. */
  const lWalls = (): WallSlice[] => [
    makeWall({
      id: 'w_s_main',
      start: [0, 0],
      end: [8, 0],
      openings: [
        {
          id: 'door_s',
          kind: 'door',
          u: 3.2,
          width: 0.9,
          roughWidth: 0.95,
          height: 2.1,
          roughHeight: 2.15,
          sillHeight: 0,
        },
      ],
    }),
    makeWall({ id: 'w_wing_w', start: [8, 0], end: [8, -3] }),
    makeWall({ id: 'w_wing_s', start: [8, -3], end: [10, -3] }),
    makeWall({ id: 'w_wing_e', start: [10, -3], end: [10, 4] }),
    makeWall({ id: 'w_n', start: [10, 4], end: [0, 4] }),
    makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
  ]
  const lRooms = (): RoomSlice[] => [
    room('other', [[0, 0], [8, 0], [8, 4], [0, 4]], { id: 'room_main' }),
    room('bedroom', [[8, -3], [10, -3], [10, 4], [8, 4]], { id: 'room_wing' }),
  ]

  test('no rod inside a room footprint; rods + buried leg clear every wall band; nothing flagged', () => {
    const walls = lWalls()
    const rooms = lRooms()
    // Pin the meter at the skeptic's spot (service override — authoritative,
    // A4): u=6.878 on the 8 m south wall, right at the reentrant corner —
    // the NAIVE rod 2 (meter + 6 ft along the wall) lands at x≈8.79 INSIDE
    // the wing footprint. Auto-placement would pick the 10 m north wall
    // and never exercise the class.
    const fixtures = layoutElectrical(walls, rooms, {
      electricMeter: { wallId: 'w_s_main', wallT: 6.878 / 8 },
    })
    const meterFx = fixtures.find((f) => f.kind === 'electric-meter')
    expect(meterFx?.sourceId).toBe('w_s_main')
    expect(meterFx?.position[0] ?? 0).toBeCloseTo(6.878, 3)
    const members = routeWiring(fixtures, walls, { waterEntry: null, rooms })
    const rods = rodsOf(members)
    expect(rods.length).toBe(2)
    const inPoly = (p: readonly [number, number], poly: readonly (readonly [number, number])[]) => {
      let inside = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i] as [number, number]
        const [xj, zj] = poly[j] as [number, number]
        if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi)
          inside = !inside
      }
      return inside
    }
    const ptSeg = (
      p: readonly [number, number],
      a: readonly [number, number],
      b: readonly [number, number],
    ) => {
      const abx = b[0] - a[0]
      const abz = b[1] - a[1]
      const l2 = abx * abx + abz * abz
      const t =
        l2 < 1e-12
          ? 0
          : Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / l2))
      return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + abz * t))
    }
    for (const rod of rods) {
      const p: [number, number] = [rod.position[0], rod.position[2]]
      for (const r of rooms) expect(inPoly(p, r.polygon), `${rod.sourceId} in ${r.id}`).toBe(false)
      for (const w of walls) {
        expect(ptSeg(p, w.start, w.end), `${rod.sourceId} vs ${w.id}`).toBeGreaterThanOrEqual(0.25)
      }
    }
    // the buried rod-to-rod GEC leg clears the wall bands (it bored the
    // wing stemwall pre-fix) — sample it against every wall segment
    const leg = members.find((m) => m.sourceId === 'GES-1' && m.label?.includes('rod 1 → rod 2'))
    expect(leg).toBeDefined()
    const [l1, l2] = endpointsOf(leg as Member)
    for (const w of walls) {
      for (let i = 0; i <= 20; i++) {
        const s = l1.clone().lerp(l2, i / 20)
        expect(ptSeg([s.x, s.z], w.start, w.end), w.id).toBeGreaterThanOrEqual(0.25)
      }
    }
    // the pair slid, not degraded: still 6 ft apart, unflagged, GEC-connected
    for (const rod of rods) expect(rod.flag).toBeUndefined()
    const [r1, r2] = rods as [Member, Member]
    expect(
      Math.hypot(r2.position[0] - r1.position[0], r2.position[2] - r1.position[2]),
    ).toBeCloseTo(feet(6), 5)
    const gec = members.filter((m) => m.sourceId === 'GES-1')
    const meter = fixtures.find((f) => f.kind === 'electric-meter')
    for (const rod of rods) {
      expect(connected(gec, new Vector3(...(meter?.position ?? [0, 0, 0])), rodTop(rod))).toBe(true)
    }
  })

  test('UNPLACEABLE rods keep the default spot and FLAG — never silent', () => {
    // A room footprint blanketing the whole slide range leaves no legal
    // spot: the engine must keep the default pair and flag both rods (the
    // flag surfaces as a takeoff Flags row).
    const walls = houseWalls()
    const fixtures = layoutElectrical(walls, houseRooms())
    const everywhere = room('other', [[-30, -30], [30, -30], [30, 30], [-30, 30]], {
      id: 'room_everywhere',
    })
    const members = routeWiring(fixtures, walls, { waterEntry: null, rooms: [everywhere] })
    const rods = rodsOf(members)
    expect(rods.length).toBe(2)
    for (const rod of rods) {
      expect(rod.flag).toContain('ground rods obstructed')
      expect(rod.flag).toContain('250.53')
    }
    const flagRows = computeTakeoff(members, fixtures).filter(
      (r) => r.section === 'Flags' && r.detail.includes('ground rods obstructed'),
    )
    expect(flagRows.length).toBe(1)
    expect(flagRows[0]?.quantity).toBe(2)
  })
})

describe('round-3 F4 — per-storey GES honesty (the E6 class)', () => {
  const twoStoreyScene = (): Record<string, Record<string, unknown>> => {
    const scene = baselineScene()
    scene.level_2 = { id: 'level_2', type: 'level', level: 1, height: 2.5 }
    scene.w2_s = {
      id: 'w2_s',
      type: 'wall',
      parentId: 'level_2',
      start: [0, 0],
      end: [12, 0],
      thickness: 0.15,
      height: 2.5,
      frontSide: 'exterior',
      children: [],
    }
    scene.z2_bed = {
      id: 'z2_bed',
      type: 'zone',
      parentId: 'level_2',
      name: 'Bedroom up',
      polygon: [
        [0, 0],
        [12, 0],
        [12, 8],
        [0, 8],
      ],
      boundaryWallIds: [],
    }
    return scene
  }

  test('sibling storey with rooms → level warning; single storey → silent', () => {
    const warned = computeLevel(twoStoreyScene(), baselineConfig('INTL'))
    expect(
      warned.warnings.some((w) =>
        w.includes('grounding electrode system modeled per storey'),
      ),
    ).toBe(true)
    const single = computeLevel(baselineScene(), baselineConfig('INTL'))
    expect(
      single.warnings.some((w) => w.includes('grounding electrode system modeled per storey')),
    ).toBe(false)
  })

  test('rod + GEC labels carry the per-storey scope unconditionally (B13 label precedent)', () => {
    const { members } = route()
    for (const rod of rodsOf(members)) {
      expect(rod.label).toContain('per-storey model')
      expect(rod.label).toContain('250.53')
    }
    const gec = members.find((m) => m.sourceId === 'GES-1')
    expect(gec?.label).toContain('per-storey model')
    expect(gec?.label).toContain('250.58')
  })
})

// ---------------------------------------------------------------------------
// Round-4 (r2 skeptic) — the no-wall-path FALLBACK legs join the clearance
// machinery: the round-3 scan/strap-outs only modeled the ROUTED chain
// ---------------------------------------------------------------------------

describe('round-4 (r2 skeptic) — fallback SE legs join the clearance machinery', () => {
  /** Main 8×4 house + a detached wall 3 m south: the meter/panel wall
   * graphs are disconnected, so the meter→panel feed takes the BURIED
   * fallback (NEC 300.5) — legs the round-3 machinery never saw. */
  const islandScene = (): { walls: WallSlice[]; rooms: RoomSlice[] } => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
      makeWall({ id: 'w_isl', start: [2, -3], end: [6, -3] }),
    ]
    const rooms = [room('other', [[0, 0], [8, 0], [8, 4], [0, 4]], { id: 'room_main' })]
    return { walls, rooms }
  }
  /** Meter mid-south (override, A4) + panel on the island near the naive
   * rod-1 x — the r2 exhibit put the buried feed 6 mm from the rod
   * centerline (0.0255 m required) with rodPairClear PASSING. */
  const islandFixtures = (walls: WallSlice[], rooms: RoomSlice[]) =>
    layoutElectrical(walls, rooms, {
      electricMeter: { wallId: 'w_s', wallT: 0.5 },
      panel: { wallId: 'w_isl', wallT: 0.52 },
    })

  test('EXHIBIT 1: the island-panel buried feed cannot bore a rod — the scan sees the fallback', () => {
    const { walls, rooms } = islandScene()
    const fixtures = islandFixtures(walls, rooms)
    expect(fixtures.find((f) => f.kind === 'electric-meter')?.sourceId).toBe('w_s')
    expect(fixtures.find((f) => f.kind === 'panel')?.sourceId).toBe('w_isl')
    const members = routeWiring(fixtures, walls, { waterEntry: null, rooms })
    const se = members.filter(
      (m) => m.role === 'wire-run' && m.sourceId === 'service-entrance',
    )
    // the fallback really fired (non-vacuous)
    expect(se.some((m) => m.label?.includes('buried crossing — no wall path'))).toBe(true)
    const rods = rodsOf(members)
    expect(rods.length).toBe(2)
    for (const rod of rods) {
      expect(rod.flag).toBeUndefined() // the pair SLID clear, not flagged
      for (const cable of se) {
        expect(
          memberDist(rod, cable),
          `${rod.sourceId} vs ${cable.label}`,
        ).toBeGreaterThanOrEqual(0.035 / 2 + 0.016 / 2 + 0.001)
      }
    }
    // still a legal pair: 6 ft apart + GEC-connected to the meter
    const [r1, r2] = rods as [Member, Member]
    expect(
      Math.hypot(r2.position[0] - r1.position[0], r2.position[2] - r1.position[2]),
    ).toBeCloseTo(feet(6), 5)
    const gec = members.filter((m) => m.sourceId === 'GES-1')
    const meterFx = fixtures.find((f) => f.kind === 'electric-meter')
    for (const rod of rods) {
      expect(connected(gec, new Vector3(...(meterFx?.position ?? [0, 0, 0])), rodTop(rod))).toBe(
        true,
      )
    }
  })

  test('EXHIBIT 2: double fallback — the bond never runs INSIDE the SE cable (strapped fallback ends)', () => {
    const { walls, rooms } = islandScene()
    const fixtures = islandFixtures(walls, rooms)
    const WATER: readonly [number, number, number] = [2, 0.3, 0] // mainland south wall
    const members = routeWiring(fixtures, walls, { waterEntry: WATER, rooms })
    const bond = members.filter((m) => m.sourceId === 'GES-2')
    const se = members.filter(
      (m) => m.role === 'wire-run' && m.sourceId === 'service-entrance',
    )
    // BOTH fallbacks fired (non-vacuous): the r2 exhibit had the bond
    // fallback drop byte-identical to the feed fallback rise (d = 0.0000)
    expect(bond.some((m) => m.label?.includes('buried crossing — no wall path'))).toBe(true)
    expect(se.some((m) => m.label?.includes('buried crossing — no wall path'))).toBe(true)
    const EMBED = (0.035 + 0.014) / 2
    for (const g of bond) {
      for (const cable of se) {
        if (Math.abs(dirOf(g).dot(dirOf(cable))) < 0.9) continue // crossing
        expect(
          memberDist(g, cable),
          `${g.label} vs ${cable.label}`,
        ).toBeGreaterThanOrEqual(EMBED)
      }
    }
    // continuity survives the strap-outs: panel → water entry, walkable
    const panelFx = fixtures.find((f) => f.kind === 'panel')
    expect(
      connected(bond, new Vector3(...(panelFx?.position ?? [0, 0, 0])), new Vector3(...WATER)),
    ).toBe(true)
    // and no rod meets the bond's buried legs either (rigid rod, no
    // crossing exemption)
    for (const rod of rodsOf(members)) {
      for (const g of bond) {
        expect(memberDist(rod, g)).toBeGreaterThanOrEqual(0.014 / 2 + 0.016 / 2 + 0.001)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Round-5 (r3 residual) — the fallback MID-legs join the embedment scan:
// round 4 strapped only the endpoint drops/rises and relocated the
// coincidence to the buried mid-leg
// ---------------------------------------------------------------------------

describe('round-5 (r3 residual) — fallback mid-legs never embed in the buried service legs', () => {
  /** Main 8×4 + detached island wall PERPENDICULAR to the approach
   * (along z at x=12): the bond fallback's buried x-leg runs at
   * z = pz + GES_STRAP_OUT — the skeptic's 49 mm window puts it EXACTLY
   * on the feed fallback's x-leg (z = mz, same depth, d ≈ 1.4e-17 over
   * ~7.9 m). Wall thickness 0.114 → mz = −(0.057+0.01905) = −0.07605. */
  const MZ = -(0.114 / 2 + 0.01905)
  const PZ_WINDOW = MZ - 0.08 // pz + strap == mz exactly
  const perpIslandScene = (): { walls: WallSlice[]; rooms: RoomSlice[] } => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [8, 0] }),
      makeWall({ id: 'w_e', start: [8, 0], end: [8, 4] }),
      makeWall({ id: 'w_n', start: [8, 4], end: [0, 4] }),
      makeWall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
      makeWall({ id: 'w_isl', start: [12, -2], end: [12, 2] }),
    ]
    const rooms = [room('other', [[0, 0], [8, 0], [8, 4], [0, 4]], { id: 'room_main' })]
    return { walls, rooms }
  }
  const windowFixtures = (walls: WallSlice[], rooms: RoomSlice[]) =>
    layoutElectrical(walls, rooms, {
      electricMeter: { wallId: 'w_s', wallT: 0.5 },
      panel: { wallId: 'w_isl', wallT: (PZ_WINDOW + 2) / 4 },
    })
  const EMBED = (0.035 + 0.014) / 2
  const buriedBondLegs = (members: Member[]): Member[] =>
    members.filter(
      (m) =>
        m.sourceId === 'GES-2' &&
        Math.abs(m.position[1] - -0.45) < 1e-6 &&
        m.dims[1] < 0.02, // horizontal buried legs only
    )
  const scanEmbedment = (members: Member[]): void => {
    const bond = members.filter((m) => m.sourceId === 'GES-2')
    const se = members.filter(
      (m) => m.role === 'wire-run' && m.sourceId === 'service-entrance',
    )
    expect(bond.some((m) => m.label?.includes('buried crossing — no wall path'))).toBe(true)
    expect(se.length).toBeGreaterThan(0)
    for (const g of bond) {
      for (const cable of se) {
        if (Math.abs(dirOf(g).dot(dirOf(cable))) < 0.9) continue // crossing
        expect(
          memberDist(g, cable),
          `${g.label} vs ${cable.label}`,
        ).toBeGreaterThanOrEqual(EMBED)
      }
    }
  }

  test('perpendicular island at the 49 mm panel window: the buried x-leg dodges the feed leg (deterministic flip-side step)', () => {
    const { walls, rooms } = perpIslandScene()
    const fixtures = windowFixtures(walls, rooms)
    const panelFx = fixtures.find((f) => f.kind === 'panel')
    expect(panelFx?.position[2] ?? 0).toBeCloseTo(PZ_WINDOW, 6) // the window is real
    const members = routeWiring(fixtures, walls, { waterEntry: [2, 0.3, 0], rooms })
    scanEmbedment(members)
    // determinism pin: the long x-leg sits ONE bay-step on the FLIPPED
    // side (the +1 default hits the window; +2 would bore the w_s band)
    const xLeg = buriedBondLegs(members).find((m) => m.dims[0] > 1)
    expect(xLeg).toBeDefined()
    expect(xLeg?.position[2] ?? 0).toBeCloseTo(PZ_WINDOW - 0.08, 9)
    // no confession — the dodge succeeded
    for (const m of members.filter((mm) => mm.sourceId === 'GES-2')) {
      expect(m.label).not.toContain('embeds alongside')
    }
    // continuity survives the dodge: panel → water entry
    expect(
      connected(
        members.filter((m) => m.sourceId === 'GES-2'),
        new Vector3(...(panelFx?.position ?? [0, 0, 0])),
        new Vector3(2, 0.3, 0),
      ),
    ).toBe(true)
  })

  test('symmetric water-end window vs the STREET lateral: the buried z-leg dodges too', () => {
    // water entry at x = mx − strap (3.92): the default z-leg lands at
    // x = 4.0 — colinear with the street lateral's z-run, overlapping it
    // in z once the panel window pushes the corner south of the wall
    const { walls, rooms } = perpIslandScene()
    const fixtures = windowFixtures(walls, rooms)
    const WATER: readonly [number, number, number] = [4 - 0.08, 0.3, 0]
    const members = routeWiring(fixtures, walls, { waterEntry: WATER, rooms })
    scanEmbedment(members)
    // determinism pin: the z-leg sits one bay-step on the flipped side
    // of the entry (wx − 0.08 = 3.84), clear of the lateral at x = 4
    const zLeg = buriedBondLegs(members).find((m) => {
      const [a, b] = endpointsOf(m)
      return Math.abs(a.z - b.z) > 0.05
    })
    expect(zLeg).toBeDefined()
    expect(zLeg?.position[0] ?? 0).toBeCloseTo(4 - 0.08 - 0.08, 9)
    for (const m of members.filter((mm) => mm.sourceId === 'GES-2')) {
      expect(m.label).not.toContain('embeds alongside')
    }
    const panelFx = fixtures.find((f) => f.kind === 'panel')
    expect(
      connected(
        members.filter((m) => m.sourceId === 'GES-2'),
        new Vector3(...(panelFx?.position ?? [0, 0, 0])),
        new Vector3(...WATER),
      ),
    ).toBe(true)
  })
})
