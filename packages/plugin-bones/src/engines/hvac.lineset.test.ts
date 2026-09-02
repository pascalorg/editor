import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Fixture, Member, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { PLUMBING_COLORS, plumbingPipeColor } from '../plans/circuit-colors'
import type { PlacedFixtureSlice } from '../core/wall-model'
import {
  LINESET_LATERAL,
  LINESET_PAIR_OFFSET,
  flagLinesetTradeCrossings,
  layoutHvac,
} from './hvac'
import { layoutPlumbing } from './plumbing'
import { computeTakeoff } from './takeoff'

/**
 * GATES (line-set round — "piped to the exchanger along a sensible path"):
 *  1. CONTINUITY (E2 applied to refrigerant pipe): each unit's suction AND
 *     liquid runs form one endpoint-adjacent chain from the condenser
 *     cabinet to the air handler — no gaps, no floating segments;
 *  2. the pair runs PARALLEL: every horizontal suction leg has a liquid twin
 *     on the same plan centerline, offset 2·LINESET_PAIR_OFFSET below;
 *  3. the wall PENETRATION clears rough openings — a verbatim heat-pump node
 *     fronting a low window slides the through-wall leg out of the RO (the
 *     unit itself stays verbatim, A4);
 *  4. runs over ~15 m carry the oil-return ADVISORY (assumption class — the
 *     manufacturer's line-set chart governs), short runs stay clean;
 *  5. the WHIP is endpoint-adjacent disconnect → unit and the disconnect
 *     stays within sight (NEC 440.14 pin);
 *  6. the render colors mirror the plumbing hot/cold convention: suction
 *     cold-blue / liquid warm-red, distinct from supply cold/hot (E3).
 */

const LOD400 = { ...DEFAULT_SPEC, detail: '400' as const }

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  exterior = false,
  openings: OpeningSlice[] = [],
  thickness = 0.2,
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
    thickness,
    height: 2.7,
    exterior,
    openings,
    curved: false,
  }
}

function room(
  id: string,
  name: string,
  category: RoomSlice['category'],
  polygon: [number, number][],
): RoomSlice {
  return { id, name, category, polygon, boundaryWallIds: [], ceilingHeight: 2.5 }
}

function shell(W: number, D: number, southOpenings: OpeningSlice[] = [], thickness = 0.2) {
  const walls = [
    wall('w_south', [0, 0], [W, 0], true, southOpenings, thickness),
    wall('w_north', [0, D], [W, D], true, [], thickness),
    wall('w_west', [0, 0], [0, D], true, [], thickness),
    wall('w_east', [W, 0], [W, D], true, [], thickness),
  ]
  const rooms = [
    room('r_laundry', 'Laundry', 'laundry', [[0, 0], [3, 0], [3, 3], [0, 3]]),
    room('r_living', 'Living', 'other', [[3, 0], [W, 0], [W, D], [3, D]]),
    room('r_bed', 'Bedroom', 'bedroom', [[0, 3], [3, 3], [3, D], [0, D]]),
  ]
  return { walls, rooms }
}

type Endpoint = { x: number; y: number; z: number }

/** Horizontal leg()/duct() + vertical riser()/ductDrop() member endpoints. */
function endpointsOf(m: Member): [Endpoint, Endpoint] {
  if (m.rotation[1] === 0 && m.dims[1] === m.length) {
    return [
      { x: m.position[0], y: m.position[1] - m.length / 2, z: m.position[2] },
      { x: m.position[0], y: m.position[1] + m.length / 2, z: m.position[2] },
    ]
  }
  const yaw = m.rotation[1]
  const hx = (m.dims[0] / 2) * Math.cos(yaw)
  const hz = -(m.dims[0] / 2) * Math.sin(yaw)
  return [
    { x: m.position[0] - hx, y: m.position[1], z: m.position[2] - hz },
    { x: m.position[0] + hx, y: m.position[1], z: m.position[2] + hz },
  ]
}

const TOL = 0.06

/**
 * E2-style continuity: union-find over member endpoints (3D adjacency
 * within TOL); true when a member endpoint near `from` connects to one near
 * `to` (both matched by PLAN distance — the terminals sit at pipe height).
 */
function chainConnects(
  members: Member[],
  from: readonly [number, number],
  to: readonly [number, number],
): boolean {
  const pts: Endpoint[] = []
  const owner: number[] = [] // endpoint index → member index
  members.forEach((m, i) => {
    for (const e of endpointsOf(m)) {
      pts.push(e)
      owner.push(i)
    }
  })
  const parent = pts.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r] as number
    let c = i
    while (parent[c] !== c) {
      const nxt = parent[c] as number
      parent[c] = r
      c = nxt
    }
    return r
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i] as Endpoint
      const b = pts[j] as Endpoint
      // both endpoints of one member are trivially connected
      if (owner[i] === owner[j]) {
        union(i, j)
        continue
      }
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < TOL) union(i, j)
    }
  }
  const at = (p: readonly [number, number]): number => {
    let best = -1
    let bestD = Number.POSITIVE_INFINITY
    for (let i = 0; i < pts.length; i++) {
      const e = pts[i] as Endpoint
      const d = Math.hypot(e.x - p[0], e.z - p[1])
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return bestD < TOL ? best : -1
  }
  const i0 = at(from)
  const i1 = at(to)
  return i0 >= 0 && i1 >= 0 && find(i0) === find(i1)
}

const condensersOf = (fixtures: Fixture[]): Fixture[] =>
  fixtures.filter((f) => f.kind === 'equipment' && f.meta?.equipment === 'condenser')

const runOf = (members: Member[], sourceId: string): Member[] =>
  members.filter((m) => m.sourceId === sourceId)

// ---------------------------------------------------------------------------
// 1. Continuity — condenser → air handler as one endpoint-adjacent chain
// ---------------------------------------------------------------------------

describe('line-set continuity (E2 for refrigerant pipe)', () => {
  test('plain shell: both pipes of every unit chain condenser → air handler', () => {
    const { walls, rooms } = shell(26, 10)
    const { members, fixtures } = layoutHvac(walls, rooms, LOD400)
    const units = condensersOf(fixtures)
    const handler = fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
    expect(units.length).toBe(2)
    for (let n = 1; n <= units.length; n++) {
      const unit = units[n - 1] as Fixture
      for (const pipe of [`lineset-suction-${n}`, `lineset-liquid-${n}`]) {
        const legs = runOf(members, pipe)
        expect(legs.length).toBeGreaterThan(0)
        expect(
          chainConnects(
            legs,
            [unit.position[0], unit.position[2]],
            [handler.position[0], handler.position[2]],
          ),
        ).toBe(true)
      }
    }
  })

  test('a door RO on the path keeps the chain CONTINUOUS through the detour', () => {
    // The E1 detour (rise / cross over the header / drop) must not open a
    // gap: risers land exactly on the horizontal legs' endpoints.
    const { walls, rooms } = shell(26, 10, [
      {
        id: 'd_mid',
        kind: 'door',
        u: 5,
        width: 0.85,
        height: 2.03,
        sillHeight: 0,
        roughWidth: 0.9,
        roughHeight: 2.1,
      },
    ])
    const out = layoutHvac(walls, rooms, DEFAULT_SPEC, { heatPump: { position: [8, 0, -0.7] } })
    const handler = out.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
    const unit = condensersOf(out.fixtures)[0] as Fixture
    for (const pipe of ['lineset-suction-1', 'lineset-liquid-1']) {
      expect(
        chainConnects(
          runOf(out.members, pipe),
          [unit.position[0], unit.position[2]],
          [handler.position[0], handler.position[2]],
        ),
      ).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Parallel pair — ONE shared route, ±offset on EVERY member (skeptic
// round: per-pipe routing collapsed the pair on detours and let a
// band-splitting sill make the pipes cross)
// ---------------------------------------------------------------------------

/** Axis-aligned AABB of a lineset member (the gate scenes' walls run on
 * plan axes — asserted via the quarter-yaw check before trusting this). */
function aabbOf(m: Member): { min: [number, number, number]; max: [number, number, number] } {
  const [a, b] = endpointsOf(m)
  const vertical = m.rotation[1] === 0 && m.dims[1] === m.length
  if (vertical) {
    return {
      min: [m.position[0] - m.dims[0] / 2, Math.min(a.y, b.y), m.position[2] - m.dims[2] / 2],
      max: [m.position[0] + m.dims[0] / 2, Math.max(a.y, b.y), m.position[2] + m.dims[2] / 2],
    }
  }
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minZ = Math.min(a.z, b.z)
  const maxZ = Math.max(a.z, b.z)
  const alongX = maxX - minX >= maxZ - minZ
  return {
    min: [
      alongX ? minX : m.position[0] - m.dims[2] / 2,
      m.position[1] - m.dims[1] / 2,
      alongX ? m.position[2] - m.dims[2] / 2 : minZ,
    ],
    max: [
      alongX ? maxX : m.position[0] + m.dims[2] / 2,
      m.position[1] + m.dims[1] / 2,
      alongX ? m.position[2] + m.dims[2] / 2 : maxZ,
    ],
  }
}

/** Suction × liquid volume hits deeper than the 2 mm skin (the skeptic's
 * SAT harness distilled to the axis-aligned case). */
function pairHits(suction: Member[], liquid: Member[], skin = 0.002): number {
  let hits = 0
  for (const s of suction) {
    for (const l of liquid) {
      const A = aabbOf(s)
      const B = aabbOf(l)
      let pen = Number.POSITIVE_INFINITY
      for (let k = 0; k < 3; k++) {
        pen = Math.min(
          pen,
          Math.min(A.max[k] as number, B.max[k] as number) -
            Math.max(A.min[k] as number, B.min[k] as number),
        )
      }
      if (pen > skin) hits++
    }
  }
  return hits
}

/** The pair contract: bijective twins — every suction member has a liquid
 * member of the SAME length exactly 2×offset below. Horizontal legs share
 * their plan center; RISERS sit 2×offset apart in plan instead (the pair
 * ROLLS 90° at vertical transitions so the lower pipe's riser never bores
 * through the upper pipe — coaxial risers were the coincident-stack class). */
function expectTwinned(members: Member[], n: number): { suction: Member[]; liquid: Member[] } {
  const suction = runOf(members, `lineset-suction-${n}`)
  const liquid = runOf(members, `lineset-liquid-${n}`)
  expect(suction.length).toBeGreaterThan(0)
  expect(suction.length).toBe(liquid.length)
  for (const m of [...suction, ...liquid]) {
    const quarter = m.rotation[1] / (Math.PI / 2)
    expect(Math.abs(quarter - Math.round(quarter))).toBeLessThan(1e-9)
  }
  for (const s of suction) {
    const sVert = s.rotation[1] === 0 && s.dims[1] === s.length
    const twin = liquid.find((l) => {
      if (Math.abs(l.length - s.length) > 1e-9) return false
      if (Math.abs(s.position[1] - l.position[1] - 2 * LINESET_PAIR_OFFSET) > 1e-9) return false
      const planD = Math.hypot(
        l.position[0] - s.position[0],
        l.position[2] - s.position[2],
      )
      return sVert ? Math.abs(planD - 2 * LINESET_PAIR_OFFSET) < 1e-9 : planD < 1e-9
    })
    expect(twin).toBeDefined()
  }
  return { suction, liquid }
}

describe('line-set pair parallelism — non-vacuous over E1 detours', () => {
  test('door-detour scene: every member twins at 2×offset; zero pair SAT hits', () => {
    // The exact skeptic repro: per-pipe routing left the liquid detour leg
    // fully INSIDE the suction leg over the header (9 SAT hits).
    const { walls, rooms } = shell(26, 10, [
      {
        id: 'd_mid',
        kind: 'door',
        u: 5,
        width: 0.85,
        height: 2.03,
        sillHeight: 0,
        roughWidth: 0.9,
        roughHeight: 2.1,
      },
    ])
    const out = layoutHvac(walls, rooms, DEFAULT_SPEC, { heatPump: { position: [8, 0, -0.7] } })
    const { suction, liquid } = expectTwinned(out.members, 1)
    // the scene genuinely detours — risers exist on BOTH pipes
    const risers = (legs: Member[]) =>
      legs.filter((m) => m.rotation[1] === 0 && m.dims[1] === m.length)
    expect(risers(suction).length).toBeGreaterThanOrEqual(2)
    expect(risers(liquid).length).toBe(risers(suction).length)
    expect(pairHits(suction, liquid)).toBe(0)
  })

  test('an RO sill landing BETWEEN the two bands still yields ONE shared decision', () => {
    // Sill 0.43 / top 2.66: the old per-pipe bands split (suction [0.40,
    // 0.44] detoured under, liquid [0.36,0.40] ran straight) and the
    // suction risers pierced the liquid horizontal. The shared envelope
    // band makes one decision for the pair.
    const splitter: OpeningSlice = {
      id: 'w_split',
      kind: 'window',
      u: 5,
      width: 0.95,
      height: 2.2,
      sillHeight: 0.43,
      roughWidth: 1.0,
      roughHeight: 2.23,
    }
    const { walls, rooms } = shell(26, 10, [splitter])
    const out = layoutHvac(walls, rooms, DEFAULT_SPEC, { heatPump: { position: [8, 0, -0.7] } })
    const { suction, liquid } = expectTwinned(out.members, 1)
    // same decision on both pipes: identical riser counts …
    const risers = (legs: Member[]) =>
      legs.filter((m) => m.rotation[1] === 0 && m.dims[1] === m.length)
    expect(risers(suction).length).toBe(risers(liquid).length)
    // … and the pipes never touch, let alone cross
    expect(pairHits(suction, liquid)).toBe(0)
  })

  test('plain shell: multi-unit runs stay twinned too', () => {
    const { walls, rooms } = shell(26, 10)
    const { members } = layoutHvac(walls, rooms, LOD400)
    for (let n = 1; n <= 2; n++) {
      const { suction, liquid } = expectTwinned(members, n)
      expect(pairHits(suction, liquid)).toBe(0)
    }
  })

  test('corner-hug RO: a riser LEADING a turned wall still rolls ACROSS that wall (stale-axis class)', () => {
    // Skeptic round 2: an RO edge within ~6 cm of a wall junction drops the
    // <1.5 cm approach leg on the turned wall, so the RISER is the first
    // member there — the emission-order axis pointed along the PREVIOUS
    // (orthogonal) wall, the roll ran ALONG the new wall, both risers sat
    // on the centerline and one pierced the other pipe's detour crossing
    // (1 SAT hit, 9.5 mm penetration at 70638b2).
    const door: OpeningSlice = {
      id: 'd_w',
      kind: 'door',
      u: 0.48,
      width: 0.85,
      height: 2.03,
      sillHeight: 0,
      roughWidth: 0.9,
      roughHeight: 2.1,
    }
    const walls = [
      wall('w_south', [0, 0], [26, 0], true),
      wall('w_north', [0, 10], [26, 10], true),
      wall('w_west', [0, 0], [0, 10], true, [door]),
      wall('w_east', [26, 0], [26, 10], true),
    ]
    const rooms = [
      room('r_laundry', 'Laundry', 'laundry', [[0, 3], [2, 3], [2, 6], [0, 6]]),
      room('r_living', 'Living', 'other', [[2, 0], [26, 0], [26, 10], [2, 10]]),
      room('r_bed', 'Bedroom', 'bedroom', [[0, 6], [2, 6], [2, 10], [0, 10]]),
    ]
    const out = layoutHvac(walls, rooms, DEFAULT_SPEC, { heatPump: { position: [8, 0, -0.7] } })
    const { suction, liquid } = expectTwinned(out.members, 1)
    // the route turns the corner and genuinely detours on the WEST wall:
    // its risers live near x = 0 …
    const vertical = (m: Member) => m.rotation[1] === 0 && m.dims[1] === m.length
    const westRisers = [...suction, ...liquid].filter(
      (m) => vertical(m) && Math.abs(m.position[0]) < 0.08,
    )
    expect(westRisers.length).toBeGreaterThanOrEqual(2)
    // … rolled ACROSS the wall around the cross-trade LATERAL plane
    // (x = ±(lateral ± offset)) — never left ON the plumbing centerline
    for (const r of westRisers) {
      const across = Math.abs(r.position[0])
      const onPair = [
        LINESET_LATERAL - LINESET_PAIR_OFFSET,
        LINESET_LATERAL + LINESET_PAIR_OFFSET,
      ].some((v) => Math.abs(across - v) < 1e-9)
      expect(onPair).toBe(true)
      expect(across).toBeGreaterThan(0.005)
    }
    expect(pairHits(suction, liquid)).toBe(0)
  })

  test('DOUBLE corner-hug: doors on BOTH junction walls — corner risers cancel, rolls stay per-wall, no dupes', () => {
    // Attack 3b (round-3 merge gate): with ROs hugging the shared junction
    // on both orthogonal walls, the geometric roll-axis lookup matched the
    // WRONG wall's crossing (both walls' crossings sit at one elevation
    // touching the junction point) and rolled the corner riser ALONG
    // w_west again (2 SAT hits at 40276ab); the descend/re-ascend riser
    // pair at the corner was also emitted twice byte-identically
    // (double-booked lf). A real pipe stays UP around the corner: the
    // identical opposite risers cancel and the two crossings connect
    // directly at the detour plane.
    const doorAt = (id: string): OpeningSlice => ({
      id,
      kind: 'door',
      u: 0.48,
      width: 0.85,
      height: 2.03,
      sillHeight: 0,
      roughWidth: 0.9,
      roughHeight: 2.1,
    })
    const walls = [
      wall('w_south', [0, 0], [26, 0], true, [doorAt('d_s')]),
      wall('w_north', [0, 10], [26, 10], true),
      wall('w_west', [0, 0], [0, 10], true, [doorAt('d_w')]),
      wall('w_east', [26, 0], [26, 10], true),
    ]
    const rooms = [
      room('r_laundry', 'Laundry', 'laundry', [[0, 3], [2, 3], [2, 6], [0, 6]]),
      room('r_living', 'Living', 'other', [[2, 0], [26, 0], [26, 10], [2, 10]]),
      room('r_bed', 'Bedroom', 'bedroom', [[0, 6], [2, 6], [2, 10], [0, 10]]),
    ]
    const out = layoutHvac(walls, rooms, DEFAULT_SPEC, { heatPump: { position: [8, 0, -0.7] } })
    const { suction, liquid } = expectTwinned(out.members, 1)
    const vertical = (m: Member) => m.rotation[1] === 0 && m.dims[1] === m.length
    // per-wall roll axes: a riser on the X-axis wall (w_south, z ≈ 0)
    // rolls in Z; a riser on the Z-axis wall (w_west, x ≈ 0) rolls in X —
    // and the corner pair itself is GONE, so every survivor belongs to
    // exactly one wall and NEVER drops at the junction
    const risers = [...suction, ...liquid].filter(vertical)
    expect(risers.length).toBeGreaterThan(0)
    const acrossBand = LINESET_LATERAL + LINESET_PAIR_OFFSET + 1e-9
    const onPairPlane = (v: number): boolean =>
      [LINESET_LATERAL - LINESET_PAIR_OFFSET, LINESET_LATERAL + LINESET_PAIR_OFFSET].some(
        (o) => Math.abs(Math.abs(v) - o) < 1e-9,
      )
    for (const r of risers) {
      const onWest = Math.abs(r.position[0]) <= acrossBand // wall axis Z
      const onSouth = Math.abs(r.position[2]) <= acrossBand // wall axis X
      // never at the junction itself (that riser pair must have canceled)
      expect(onWest && onSouth).toBe(false)
      if (onWest) expect(onPairPlane(r.position[0])).toBe(true) // Z-wall → X-roll
      if (onSouth) expect(onPairPlane(r.position[2])).toBe(true) // X-wall → Z-roll
    }
    // no byte-identical duplicates within a pipe (unique position|dims)
    for (const legs of [suction, liquid]) {
      const seen = new Set<string>()
      for (const m of legs) {
        const key = `${m.position.join(',')}|${m.dims.join(',')}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
    // the canceled corner stays CONTINUOUS (crossings meet at the junction)
    const handler = out.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
    const unit = condensersOf(out.fixtures)[0] as Fixture
    for (const legs of [suction, liquid]) {
      expect(
        chainConnects(
          legs,
          [unit.position[0], unit.position[2]],
          [handler.position[0], handler.position[2]],
        ),
      ).toBe(true)
    }
    expect(pairHits(suction, liquid)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 3. Penetration clears rough openings (verbatim node fronting a low window)
// ---------------------------------------------------------------------------

describe('wall penetration clears ROs', () => {
  test('a heat-pump node fronting a LOW window slides the through-wall leg clear; the unit stays verbatim', () => {
    // Low glazing crosses the line-set band [0.33, 0.47] — the ROW anchors
    // verbatim (A4) but the PENETRATION may not bore through glass.
    const lowWindow: OpeningSlice = {
      id: 'w_low',
      kind: 'window',
      u: 5,
      width: 0.95,
      height: 1.0,
      sillHeight: 0.2,
      roughWidth: 1.0,
      roughHeight: 1.05,
    }
    const { walls, rooms } = shell(26, 10, [lowWindow])
    const out = layoutHvac(walls, rooms, DEFAULT_SPEC, { heatPump: { position: [5, 0, -0.7] } })
    const unit = condensersOf(out.fixtures)[0] as Fixture
    // unit #1 verbatim on the node
    expect(unit.position[0]).toBeCloseTo(5, 6)
    expect(unit.position[2]).toBeCloseTo(-0.7, 6)
    // the through-wall suction leg (outside → centerline) sits clear of the
    // RO span [4.5, 5.5]
    const suction = runOf(out.members, 'lineset-suction-1')
    const throughLegs = suction.filter((m) => {
      const [a, b] = endpointsOf(m)
      const zs = [a.z, b.z].sort((p, q) => p - q)
      return (zs[0] as number) < -0.15 && Math.abs(zs[1] as number) < 1e-6
    })
    expect(throughLegs.length).toBeGreaterThan(0)
    for (const m of throughLegs) {
      const [a] = endpointsOf(m)
      expect(Math.abs(a.x - 5)).toBeGreaterThan(0.5)
      expect(m.flag).toBeUndefined() // slid clear — nothing to warn about
    }
    // and the chain still closes unit → handler
    const handler = out.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
    expect(
      chainConnects(
        suction,
        [unit.position[0], unit.position[2]],
        [handler.position[0], handler.position[2]],
      ),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. Long-run advisory (~15 m — manufacturer line-set charts govern)
// ---------------------------------------------------------------------------

describe('line-set length advisory', () => {
  test('a run over ~15 m carries the oil-return advisory on every leg', () => {
    const { walls, rooms } = shell(40, 14)
    const out = layoutHvac(walls, rooms, LOD400, { heatPump: { position: [40.7, 0, 7] } })
    const legs = runOf(out.members, 'lineset-suction-1')
    expect(legs.length).toBeGreaterThan(0)
    const total = legs.reduce((s, m) => s + m.length, 0)
    expect(total).toBeGreaterThan(15)
    expect(
      legs.every((m) =>
        m.flag?.includes('verify manufacturer max line-set length / oil return'),
      ),
    ).toBe(true)
  })

  test('a short run stays advisory-free', () => {
    const { walls, rooms } = shell(26, 10)
    const { members } = layoutHvac(walls, rooms, LOD400)
    const legs = members.filter((m) => m.sourceId.startsWith('lineset-'))
    expect(legs.length).toBeGreaterThan(0)
    expect(legs.every((m) => m.flag === undefined)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. Whip adjacency + disconnect within sight (NEC 440.14)
// ---------------------------------------------------------------------------

describe('whip — disconnect → unit, endpoint-adjacent', () => {
  test('each whip chains from its disconnect to its unit; the box stays within sight', () => {
    const { walls, rooms } = shell(26, 10)
    const { members, fixtures } = layoutHvac(walls, rooms, LOD400)
    const units = condensersOf(fixtures)
    for (let n = 1; n <= units.length; n++) {
      const unit = units[n - 1] as Fixture
      const disc = fixtures.find((f) => f.kind === 'disconnect' && f.meta?.unit === n) as Fixture
      expect(disc).toBeDefined()
      const whip = runOf(members, `ac-whip-${n}`)
      expect(whip.length).toBeGreaterThan(0)
      expect(
        chainConnects(
          whip,
          [disc.position[0], disc.position[2]],
          [unit.position[0], unit.position[2]],
        ),
      ).toBe(true)
      // within sight — the NEC 440.14 proximity pin ("within sight" is a
      // visibility rule, <= 50 ft; the pin guards sanity) at the CHECKLIST
      // M2 class bound (amended, verify F2 — row and allowance agree to
      // the digit): 3D box<->unit-center <= 1.73 m unobstructed, basis
      // sqrt((S - t/2 - 0.02)^2 + 0.725^2) with the world-grid-snapped
      // stand-off S < condenserStandoff(t) + 0.5. This scene: 1.5589.
      const dist = Math.hypot(
        disc.position[0] - unit.position[0],
        disc.position[1] - unit.position[1],
        disc.position[2] - unit.position[2],
      )
      expect(dist).toBeLessThanOrEqual(1.73)
    }
  })
})

// ---------------------------------------------------------------------------
// 6. Colors — the plumbing hot/cold convention mirrored (E3)
// ---------------------------------------------------------------------------

describe('line-set colors', () => {
  test('suction maps cold-blue, liquid warm-red — distinct from supply cold/hot', () => {
    expect(plumbingPipeColor('lineset-suction-1')).toBe(PLUMBING_COLORS.linesetSuction)
    expect(plumbingPipeColor('lineset-liquid-2')).toBe(PLUMBING_COLORS.linesetLiquid)
    // never confusable with the plumbing supply colors byte-for-byte
    expect(PLUMBING_COLORS.linesetSuction).not.toBe(PLUMBING_COLORS.cold)
    expect(PLUMBING_COLORS.linesetLiquid).not.toBe(PLUMBING_COLORS.hot)
    // whips and condensate never inherit pipe colors
    expect(plumbingPipeColor('ac-whip-1')).toBeNull()
    expect(plumbingPipeColor('r_laundry')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 7. Cross-trade — the pair never silently shares the plumbing plane
// (post-merge seam round: 24 OBB hits — both pipes through the 3" DWV
// stack + 22 supply-riser hits at the wall centerline)
// ---------------------------------------------------------------------------

type V3 = [number, number, number]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** Local axes (columns of Rx·Ry·Rz — the repo's member euler) in world. */
function memberAxes(m: Member): [V3, V3, V3] {
  const [rx, ry, rz] = m.rotation
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  return [
    [cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz],
    [-cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz],
    [sy, -sx * cy, cx * cy],
  ]
}

/** Full 15-axis OBB SAT with the repo's 2 mm skin — INDEPENDENT of the
 * engine's own sampled detector (a gate must not trust the code it gates). */
function obbHit(a: Member, b: Member, skin = 0.002): boolean {
  const A = memberAxes(a)
  const B = memberAxes(b)
  const ea: V3 = [a.dims[0] / 2, a.dims[1] / 2, a.dims[2] / 2]
  const eb: V3 = [b.dims[0] / 2, b.dims[1] / 2, b.dims[2] / 2]
  const d: V3 = [
    b.position[0] - a.position[0],
    b.position[1] - a.position[1],
    b.position[2] - a.position[2],
  ]
  const axes: V3[] = [...A, ...B]
  for (const ai of A) {
    for (const bj of B) {
      const c = cross(ai, bj)
      const n = Math.hypot(c[0], c[1], c[2])
      if (n > 1e-9) axes.push([c[0] / n, c[1] / n, c[2] / n])
    }
  }
  for (const ax of axes) {
    const ra =
      ea[0] * Math.abs(dot(ax, A[0])) +
      ea[1] * Math.abs(dot(ax, A[1])) +
      ea[2] * Math.abs(dot(ax, A[2]))
    const rb =
      eb[0] * Math.abs(dot(ax, B[0])) +
      eb[1] * Math.abs(dot(ax, B[1])) +
      eb[2] * Math.abs(dot(ax, B[2]))
    if (Math.abs(dot(ax, d)) > ra + rb - skin) return false
  }
  return true
}

const pf = (
  id: string,
  kind: PlacedFixtureSlice['kind'],
  plan: [number, number],
): PlacedFixtureSlice => ({
  id,
  kind,
  plan,
  yaw: 0,
  hot: kind !== 'toilet',
  dfu: kind === 'toilet' ? 3 : kind === 'lavatory' ? 1 : 2,
  drainIn: kind === 'toilet' ? 3 : kind === 'lavatory' ? 1.25 : 2,
})

describe('cross-trade — line-set vs the plumbing plane', () => {
  test('both-systems-hot compose: the lateral clears the supply plane; the stack crossing is FLAGGED, never silent', () => {
    const { walls, rooms } = shell(26, 10)
    // Wet program anchoring the SAME south wall the line-set runs along
    // (the seam-round compose: bathroom + kitchen + laundry placed).
    const placed = [
      pf('wc', 'toilet', [5.2, 0.6]),
      pf('lav', 'lavatory', [6.0, 0.6]),
      pf('sink', 'kitchen-sink', [8.0, 0.6]),
      pf('washer', 'clothes-washer', [1.0, 4.0]),
    ]
    const plumbing = layoutPlumbing(walls, rooms, LOD400, placed)
    const hvac = layoutHvac(
      walls, rooms, LOD400,
      { heatPump: { position: [11.5, 0, -0.75] } },
      { stateCode: 'MN' },
    )
    const combined = [...plumbing.members, ...hvac.members]
    flagLinesetTradeCrossings(combined) // exactly what compute runs
    const lineset = combined.filter(
      (m) => m.system === 'hvac' && m.sourceId.startsWith('lineset-'),
    )
    const pipes = combined.filter(
      (m) => m.system === 'plumbing' && (m.role === 'pipe-run' || m.role === 'vent-stack'),
    )
    expect(lineset.length).toBeGreaterThan(0)
    // pre-condition: the compose is genuinely hot — a DWV stack stands on
    // the run, and supply risers cross the pair's band at the centerline
    expect(pipes.some((m) => m.role === 'vent-stack')).toBe(true)
    let unflaggedHits = 0
    let stackHits = 0
    let supplyHits = 0
    for (const ls of lineset) {
      for (const p of pipes) {
        if (!obbHit(ls, p)) continue
        if (!ls.flag) unflaggedHits++
        if (p.role === 'vent-stack' || p.sourceId.startsWith('dwv-')) stackHits++
        else supplyHits++
      }
    }
    // THE contract: zero silent bores across trades
    expect(unflaggedHits).toBe(0)
    // the lateral genuinely cleared the centerline supply plane (22 hits
    // at the seam round) — cleared, not blanket-flagged away
    expect(supplyHits).toBe(0)
    // the 3" stack is wider than the cavity lets the pair dodge — it IS
    // crossed, and it says so with the coordinate-trades class
    expect(stackHits).toBeGreaterThan(0)
    expect(
      lineset.some((m) => m.flag === '⚠ line-set crosses DWV stack — coordinate trades'),
    ).toBe(true)
    // full-thickness walls never claim the thin-wall clamp
    expect(lineset.some((m) => m.flag?.includes('clamped in a thin wall'))).toBe(false)
    // the pair invariants keep holding on the hot compose
    const { suction, liquid } = expectTwinned(combined, 1)
    expect(pairHits(suction, liquid)).toBe(0)
  })

  test('a 0.114 thin wall CLAMPS the lateral inside the wall body — and says so', () => {
    const thin = shell(26, 10, [], 0.114)
    const out = layoutHvac(thin.walls, thin.rooms, DEFAULT_SPEC, {
      heatPump: { position: [8, 0, -0.7] },
    })
    const lineset = out.members.filter((m) => m.sourceId.startsWith('lineset-'))
    expect(lineset.length).toBeGreaterThan(0)
    // clamp honesty: the run says the trade clearance shrank
    expect(lineset.some((m) => m.flag?.includes('clamped in a thin wall'))).toBe(true)
    // geometry honesty: every in-wall leg (the south run, z near the wall)
    // keeps its FULL section inside the 0.114 body — clamped, not poking
    const inWall = lineset.filter(
      (m) => Math.abs(m.position[2]) < 0.06 && m.dims[0] === m.length,
    )
    expect(inWall.length).toBeGreaterThan(0)
    for (const m of inWall) {
      expect(Math.abs(m.position[2]) + m.dims[2] / 2).toBeLessThanOrEqual(0.114 / 2 + 1e-9)
      // …and the offset is genuinely CLAMPED below the full lateral
      expect(Math.abs(m.position[2])).toBeLessThan(LINESET_LATERAL - 1e-9)
      expect(Math.abs(m.position[2])).toBeGreaterThan(0.005) // still off-plane
    }
    // the pair invariants survive the clamp
    const { suction, liquid } = expectTwinned(out.members, 1)
    expect(pairHits(suction, liquid)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 8. Closing round — F1 flag composition, F2 acute-corner miter
// ---------------------------------------------------------------------------

describe('closing round — flag composition + acute corners', () => {
  test('F1: a LONG run boring the stack carries BOTH the length advisory AND the crossing flag (composed, never masked)', () => {
    // 40×10, stack on the south wall, heat pump at the far end: the run is
    // >15 m so the mfr-length advisory rides EVERY leg — the old pass
    // skipped flagged members, so the stack bore was SILENT on paper.
    const { walls, rooms } = shell(40, 10)
    const placed = [pf('wc', 'toilet', [5.2, 0.6]), pf('lav', 'lavatory', [6.0, 0.6])]
    const plumbing = layoutPlumbing(walls, rooms, LOD400, placed)
    const hvac = layoutHvac(
      walls, rooms, LOD400,
      { heatPump: { position: [39, 0, -0.75] } },
      { stateCode: 'MN' },
    )
    const combined = [...plumbing.members, ...hvac.members]
    flagLinesetTradeCrossings(combined)
    const lineset = combined.filter(
      (m) => m.system === 'hvac' && m.sourceId.startsWith('lineset-'),
    )
    const pipes = combined.filter(
      (m) => m.system === 'plumbing' && (m.role === 'pipe-run' || m.role === 'vent-stack'),
    )
    // pre-conditions: genuinely long + the stack IS bored
    const suctionLen = lineset
      .filter((m) => m.sourceId === 'lineset-suction-1')
      .reduce((s, m) => s + m.length, 0)
    expect(suctionLen).toBeGreaterThan(15)
    const stack = pipes.filter((m) => m.role === 'vent-stack')
    expect(stack.length).toBeGreaterThan(0)
    let stackBores = 0
    let unflaggedHits = 0
    for (const ls of lineset) {
      for (const p of pipes) {
        if (!obbHit(ls, p)) continue
        if (!ls.flag) unflaggedHits++
        if (p.role === 'vent-stack') {
          stackBores++
          // COMPOSED, both classes present, ' | ' join (B1 convention)
          expect(ls.flag).toContain('verify manufacturer max line-set length')
          expect(ls.flag).toContain('⚠ line-set crosses DWV stack — coordinate trades')
          expect(ls.flag).toContain(' | ')
        }
      }
    }
    expect(stackBores).toBeGreaterThan(0)
    expect(unflaggedHits).toBe(0)
  })

  test('F2: a 150° wedge corner miters the lateral closed — chains connect, pair clean, legs stay in their walls', () => {
    // The per-member lateral opens 2·lat·sin(Δyaw/2) at junctions — fine
    // at 90° (< the 6 cm continuity tolerance) but 150° opened 6.8 cm and
    // BROKE chainConnects (a regression vs the centerline route). The
    // miter extends both legs to the shifted lines' intersection: exact
    // closure, the fitting geometry a real pipe pair gets.
    const walls = [
      wall('w_a', [0, 0], [12, 0], true),
      wall('w_b', [12, 0], [-0.12, 7.0], true),
    ]
    const rooms = [
      room('r_laundry', 'Laundry', 'laundry', [[0.2, 5.2], [1.8, 5.2], [1.8, 6.6], [0.2, 6.6]]),
      room('r_wedge', 'Wedge', 'other', [[0, 0], [12, 0], [0.5, 4.5]]),
    ]
    const out = layoutHvac(walls, rooms, DEFAULT_SPEC, { heatPump: { position: [6, 0, -0.7] } })
    const handler = out.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
    const unit = condensersOf(out.fixtures)[0] as Fixture
    // oblique walls: the axis-aligned twin/AABB helpers don't apply here —
    // pair the runs directly and SAT them with the full 15-axis obbHit
    const suction = runOf(out.members, 'lineset-suction-1')
    const liquid = runOf(out.members, 'lineset-liquid-1')
    expect(suction.length).toBeGreaterThan(0)
    expect(suction.length).toBe(liquid.length)
    // BOTH chains close condenser → air handler (master parity restored)
    for (const legs of [suction, liquid]) {
      expect(
        chainConnects(
          legs,
          [unit.position[0], unit.position[2]],
          [handler.position[0], handler.position[2]],
        ),
      ).toBe(true)
    }
    // the junction itself closes EXACTLY (miter, not tolerance luck)
    const inWallLegs = suction.filter((m) => {
      if (!(m.dims[0] === m.length)) return false
      const mid: [number, number] = [m.position[0], m.position[2]]
      return walls.some((w) => {
        const t = (mid[0] - w.start[0]) * w.dir[0] + (mid[1] - w.start[1]) * w.dir[1]
        const q: [number, number] = [w.start[0] + w.dir[0] * t, w.start[1] + w.dir[1] * t]
        return Math.hypot(q[0] - mid[0], q[1] - mid[1]) < 0.06
      })
    })
    expect(inWallLegs.length).toBe(2)
    const ends = (m: Member): [number, number][] => {
      const yaw = m.rotation[1]
      const hx = (m.dims[0] / 2) * Math.cos(yaw)
      const hz = -(m.dims[0] / 2) * Math.sin(yaw)
      return [
        [m.position[0] - hx, m.position[2] - hz],
        [m.position[0] + hx, m.position[2] + hz],
      ]
    }
    let junctionGap = Number.POSITIVE_INFINITY
    for (const a of ends(inWallLegs[0] as Member)) {
      for (const b of ends(inWallLegs[1] as Member)) {
        junctionGap = Math.min(junctionGap, Math.hypot(a[0] - b[0], a[1] - b[1]))
      }
    }
    expect(junctionGap).toBeLessThan(1e-6)
    // the mitered legs (extension included) stay inside their wall bodies:
    // every endpoint ≤ halfT off its nearest wall CENTERLINE LINE
    for (const m of inWallLegs) {
      for (const e of ends(m)) {
        const off = Math.min(
          ...walls.map((w) => {
            const t = (e[0] - w.start[0]) * w.dir[0] + (e[1] - w.start[1]) * w.dir[1]
            const q: [number, number] = [w.start[0] + w.dir[0] * t, w.start[1] + w.dir[1] * t]
            return Math.hypot(q[0] - e[0], q[1] - e[1])
          }),
        )
        expect(off).toBeLessThanOrEqual(0.1 + 1e-9)
      }
    }
    let hits = 0
    for (const sm of suction) {
      for (const lm of liquid) if (obbHit(sm, lm)) hits++
    }
    expect(hits).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 9. Merge-gate round — F1 combined-trim floor, F2 engine-flag composition
// ---------------------------------------------------------------------------

/** Double-turn wedge: w1 (10 m) → mid-wall (midLen) at −turnDeg → w3 (5 m)
 * at another −turnDeg; laundry at w3's far end so the route traverses both
 * junctions. The merge-gate F1 repro shape: per-junction trim caps let the
 * short mid-leg accumulate NEGATIVE length (−6.2 mm at 100°/0.08 m) —
 * subtracting takeoff lf and reading separated on every SAT axis. */
function doubleTurn(turnDeg: number, midLen: number) {
  const rot = (d: [number, number], deg: number): [number, number] => {
    const r = (deg * Math.PI) / 180
    return [d[0] * Math.cos(r) - d[1] * Math.sin(r), d[0] * Math.sin(r) + d[1] * Math.cos(r)]
  }
  const d2 = rot([1, 0], -turnDeg)
  const d3 = rot(d2, -turnDeg)
  const p1: [number, number] = [10, 0]
  const p2: [number, number] = [p1[0] + d2[0] * midLen, p1[1] + d2[1] * midLen]
  const p3: [number, number] = [p2[0] + d3[0] * 5, p2[1] + d3[1] * 5]
  const walls = [
    wall('w1', [0, 0], p1, true),
    wall('w2', p1, p2, true),
    wall('w3', p2, p3, true),
  ]
  const rooms = [
    room('r_laundry', 'Laundry', 'laundry', [
      [p3[0] - 0.8, p3[1] - 0.8],
      [p3[0] + 0.8, p3[1] - 0.8],
      [p3[0] + 0.8, p3[1] + 0.8],
      [p3[0] - 0.8, p3[1] + 0.8],
    ]),
    room('r_v', 'V', 'other', [[0, 0], [10, 0], [5, 3]]),
  ]
  return { walls, rooms }
}

describe('merge-gate round — trim floor + flag composition', () => {
  test('F1: the double-turn repro keeps every member POSITIVE (>2 cm); lf and SAT stay sound', () => {
    const { walls, rooms } = doubleTurn(100, 0.08)
    const out = layoutHvac(walls, rooms, DEFAULT_SPEC, { heatPump: { position: [2, 0, -0.7] } })
    const lineset = out.members.filter((m) => m.sourceId.startsWith('lineset-'))
    expect(lineset.length).toBeGreaterThan(0)
    // (b) SAT gates are only non-vacuous over positive extents — assert
    // BEFORE trusting any SAT verdict
    for (const m of lineset) {
      expect(m.length).toBeGreaterThan(0.02)
      for (const d of m.dims) expect(d).toBeGreaterThan(0)
    }
    // (a) the takeoff books the POSITIVE sum — a negative member used to
    // SUBTRACT soft-copper lf
    const suction = lineset.filter((m) => m.sourceId === 'lineset-suction-1')
    const lf = suction.reduce((sum, m) => sum + m.length, 0) * 3.28084
    expect(lf).toBeGreaterThan(0)
    const row = computeTakeoff(out.members, out.fixtures).find(
      (r) => r.item === 'Line-set suction ¾"',
    )
    expect(row?.quantity).toBeCloseTo(Math.round(lf * 10) / 10, 1)
    // the over-trimmed junction BRIDGED — the chain still closes end-to-end
    const handler = out.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
    const unit = condensersOf(out.fixtures)[0] as Fixture
    for (const id of ['lineset-suction-1', 'lineset-liquid-1']) {
      expect(
        chainConnects(
          runOf(out.members, id),
          [unit.position[0], unit.position[2]],
          [handler.position[0], handler.position[2]],
        ),
      ).toBe(true)
    }
    // pair SAT (full 15-axis — the walls are oblique) stays clean
    const liquid = lineset.filter((m) => m.sourceId === 'lineset-liquid-1')
    let hits = 0
    for (const sm of suction) for (const lm of liquid) if (obbHit(sm, lm)) hits++
    expect(hits).toBe(0)
  })

  test('F1 sweep: 100–120° × 0.08–0.2 m mid-walls — no sliver ever survives', () => {
    for (const turn of [100, 110, 120]) {
      for (const mid of [0.08, 0.12, 0.2]) {
        const { walls, rooms } = doubleTurn(turn, mid)
        const out = layoutHvac(walls, rooms, DEFAULT_SPEC, {
          heatPump: { position: [2, 0, -0.7] },
        })
        const lineset = out.members.filter((m) => m.sourceId.startsWith('lineset-'))
        expect(lineset.length).toBeGreaterThan(0)
        for (const m of lineset) {
          expect(m.length).toBeGreaterThan(0.02)
          for (const d of m.dims) expect(d).toBeGreaterThan(0)
        }
        const handler = out.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
        const unit = condensersOf(out.fixtures)[0] as Fixture
        for (const id of ['lineset-suction-1', 'lineset-liquid-1']) {
          expect(
            chainConnects(
              runOf(out.members, id),
              [unit.position[0], unit.position[2]],
              [handler.position[0], handler.position[2]],
            ),
          ).toBe(true)
        }
      }
    }
  })

  test('F2: a THIN-WALL LONG run boring the stack carries ALL THREE classes composed', () => {
    // 0.114 walls (clamp flag) + >15 m run (advisory) + stack on the path
    // (crossing class): precedence used to keep only the first truth.
    const { walls, rooms } = shell(40, 10, [], 0.114)
    const placed = [pf('wc', 'toilet', [5.2, 0.6]), pf('lav', 'lavatory', [6.0, 0.6])]
    const plumbing = layoutPlumbing(walls, rooms, LOD400, placed)
    const hvac = layoutHvac(
      walls, rooms, LOD400,
      { heatPump: { position: [39, 0, -0.75] } },
      { stateCode: 'MN' },
    )
    const combined = [...plumbing.members, ...hvac.members]
    flagLinesetTradeCrossings(combined)
    const lineset = combined.filter(
      (m) => m.system === 'hvac' && m.sourceId.startsWith('lineset-'),
    )
    const stack = combined.filter(
      (m) => m.system === 'plumbing' && m.role === 'vent-stack',
    )
    expect(stack.length).toBeGreaterThan(0)
    let bores = 0
    for (const ls of lineset) {
      for (const st of stack) {
        if (!obbHit(ls, st)) continue
        bores++
        expect(ls.flag).toContain('clamped in a thin wall')
        expect(ls.flag).toContain('verify manufacturer max line-set length')
        expect(ls.flag).toContain('⚠ line-set crosses DWV stack — coordinate trades')
        // three truths = two joins
        expect((ls.flag?.match(/ \| /g) ?? []).length).toBeGreaterThanOrEqual(2)
      }
    }
    expect(bores).toBeGreaterThan(0)
  })
})
