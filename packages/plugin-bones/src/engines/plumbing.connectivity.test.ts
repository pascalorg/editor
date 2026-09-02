import { describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import type { Fixture, Member, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { inches } from '../core/units'
import type { PlacedFixtureSlice } from '../core/wall-model'
import { endpointsOf } from './electrical.test-helpers'
import { layoutPlumbing } from './plumbing'
import {
  ATTACH_TOL,
  byPrefix,
  checkSupply,
  drainFailures,
  levelDrains,
  stackToTreeGap,
  stubs,
  unreachableFrom,
} from './plumbing.test-helpers'

/**
 * Checklist invariant P5 — placed-fixture plumbing is PHYSICAL:
 *  (a) every stub-out is cold-reachable from the service meter as continuous
 *      pipe; hot fixtures are hot-reachable from the water heater;
 *  (b) every fixture's trap drains to the sewer exit;
 *  (c) drain paths only ever FALL toward the exit (walked as a directed
 *      graph — a rise anywhere breaks reachability);
 *  (d) no pipe crosses a rough opening (supply/vents detour like cable —
 *      invariant E1 applied to plumbing);
 *  (e) a fixture too far from any wall gets its trap-arm flag (P3105.1) and
 *      its island air-run flag — never a silent impossible run.
 *
 * endpointsOf resolves pitched drain legs through the full XYZ euler
 * (rotation[2] carries the P3005.3 fall), verified by (b)/(c) walking the
 * sloped tree end-to-end.
 */

// ---- scene builders (electrical.openings.test.ts pattern) ------------------

function makeWall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [4, 0]
  const dx = (end[0] ?? 0) - (start[0] ?? 0)
  const dz = (end[1] ?? 0) - (start[1] ?? 0)
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall',
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

const opening = (
  kind: 'door' | 'window',
  u: number,
  roughWidth: number,
  sillHeight: number,
  roughHeight: number,
): OpeningSlice => ({
  id: `${kind}_${u}`,
  kind,
  u,
  width: roughWidth - 0.05,
  roughWidth,
  height: roughHeight - 0.05,
  roughHeight,
  sillHeight,
})

const room = (
  id: string,
  category: RoomSlice['category'],
  polygon: [number, number][],
  boundaryWallIds: string[] = [],
): RoomSlice => ({ id, name: category, category, polygon, boundaryWallIds, ceilingHeight: 2.5 })

/** Placed-fixture builder with the stage-1 sanitary profiles baked in. */
const PROFILES: Record<
  PlacedFixtureSlice['kind'],
  { hot: boolean; dfu: number; drainIn: number }
> = {
  toilet: { hot: false, dfu: 3, drainIn: 3 },
  lavatory: { hot: true, dfu: 1, drainIn: 1.25 },
  shower: { hot: true, dfu: 2, drainIn: 2 },
  bathtub: { hot: true, dfu: 2, drainIn: 1.5 },
  'clothes-washer': { hot: true, dfu: 2, drainIn: 2 },
  'kitchen-sink': { hot: true, dfu: 2, drainIn: 1.5 },
}
const pf = (
  id: string,
  kind: PlacedFixtureSlice['kind'],
  plan: [number, number],
): PlacedFixtureSlice => ({ id, kind, plan, yaw: 0, ...PROFILES[kind] })

// ---- (a) supply / (b)+(c) drain probes live in plumbing.test-helpers.ts ----
// (shared with the service-override gate — checklist A4)

// ---- (d) no pipe through a rough opening (electrical.openings pattern) -----

type RoBox = { min: [number, number, number]; max: [number, number, number] }
const EPS = 0.02
function roBoxes(walls: WallSlice[]): RoBox[] {
  const out: RoBox[] = []
  for (const w of walls) {
    for (const o of w.openings) {
      const lo = o.u - o.roughWidth / 2 + EPS
      const hi = o.u + o.roughWidth / 2 - EPS
      if (hi <= lo) continue
      const a = [w.start[0] + w.dir[0] * lo, w.start[1] + w.dir[1] * lo] as const
      const b = [w.start[0] + w.dir[0] * hi, w.start[1] + w.dir[1] * hi] as const
      const lat = w.thickness / 2 + 0.005
      const nx = -w.dir[1]
      const nz = w.dir[0]
      out.push({
        min: [
          Math.min(a[0], b[0]) - Math.abs(nx) * lat,
          o.sillHeight + EPS,
          Math.min(a[1], b[1]) - Math.abs(nz) * lat,
        ],
        max: [
          Math.max(a[0], b[0]) + Math.abs(nx) * lat,
          o.sillHeight + o.roughHeight - EPS,
          Math.max(a[1], b[1]) + Math.abs(nz) * lat,
        ],
      })
    }
  }
  return out
}

const inBox = (p: [number, number, number], b: RoBox): boolean =>
  p[0] > b.min[0] &&
  p[0] < b.max[0] &&
  p[1] > b.min[1] &&
  p[1] < b.max[1] &&
  p[2] > b.min[2] &&
  p[2] < b.max[2]

/** Pipe segments sampled every 5 cm against every RO box. */
function pipesThroughOpenings(members: Member[], walls: WallSlice[]): string[] {
  const boxes = roBoxes(walls)
  const bad: string[] = []
  for (const m of members) {
    if (m.system !== 'plumbing') continue
    if (m.role !== 'pipe-run' && m.role !== 'vent-stack') continue
    if (m.flag || m.label?.includes('⚠') || m.label?.includes('air run')) continue
    const [a, b] = endpointsOf(m)
    const steps = Math.max(2, Math.ceil(a.distanceTo(b) / 0.05))
    for (let i = 0; i <= steps; i++) {
      const p: [number, number, number] = [
        a.x + ((b.x - a.x) * i) / steps,
        a.y + ((b.y - a.y) * i) / steps,
        a.z + ((b.z - a.z) * i) / steps,
      ]
      if (boxes.some((box) => inBox(p, box))) {
        bad.push(`${m.label ?? m.role} @ ${p.map((v) => v.toFixed(2)).join(',')}`)
        break
      }
    }
  }
  return bad
}

// ---- scenarios --------------------------------------------------------------

/** 10×8 shell, garage west of x=5 / z<5, door + low window in the pipes' way. */
function housePlan() {
  const walls = [
    makeWall({
      id: 'w_s',
      start: [0, 0],
      end: [10, 0],
      openings: [opening('door', 4, 0.95, 0, 2.15)],
    }),
    makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
    makeWall({
      id: 'w_n',
      start: [10, 8],
      end: [0, 8],
      openings: [opening('window', 9, 1.2, 0.3, 1.6)],
    }),
    makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
    makeWall({ id: 'w_mid', start: [5, 0], end: [5, 8], exterior: false }),
  ]
  const rooms = [
    room('r_garage', 'garage', [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
    ], ['w_w', 'w_mid']),
    room('r_bath', 'bathroom', [
      [5, 0],
      [10, 0],
      [10, 4],
      [5, 4],
    ]),
    room('r_kitchen', 'kitchen', [
      [0, 5],
      [5, 5],
      [5, 8],
      [0, 8],
    ]),
  ]
  return { walls, rooms }
}

describe('P5 gate — bathroom + far kitchen sink (toilet, lav, shower, sink)', () => {
  const { walls, rooms } = housePlan()
  const placed = [
    pf('wc', 'toilet', [6.5, 0.6]),
    pf('lav', 'lavatory', [7.6, 0.6]),
    pf('shw', 'shower', [9.3, 0.7]),
    pf('ks', 'kitchen-sink', [1.5, 7.6]),
  ]
  const { members, fixtures } = layoutPlumbing(walls, rooms, undefined, placed)

  test('(a) every stub cold-reachable from the meter; hot ones from the WH', () => {
    expect(stubs(fixtures)).toHaveLength(4)
    checkSupply(members, fixtures)
  })

  test('toilets stay cold-only (no hot homerun)', () => {
    expect(byPrefix(members, 'hot-wc')).toHaveLength(0)
    expect(byPrefix(members, 'cold-wc').length).toBeGreaterThan(0)
  })

  test('(b)+(c) every trap drains to the sewer exit, strictly downhill', () => {
    expect(drainFailures(members, ['wc', 'lav', 'shw', 'ks'])).toEqual([])
    expect(levelDrains(members)).toEqual([])
  })

  test('(d) no pipe crosses the door or the low window', () => {
    expect(pipesThroughOpenings(members, walls)).toEqual([])
  })

  test('DFU sizing: WC branch ≥ 3", building drain labeled with the total', () => {
    const wcBranch = members.filter((m) => m.sourceId === 'dwv-branch-wc')
    expect(wcBranch.length).toBeGreaterThan(0)
    for (const m of wcBranch) expect(Math.min(m.dims[1], m.dims[2])).toBeCloseTo(inches(3), 6)
    const main = members.find((m) => m.sourceId === 'dwv-main') as Member
    expect(main.label).toContain('8 DFU') // 3+1+2+2
    expect(main.label).toContain('3"')
    expect(main.flag).toBeUndefined()
  })

  test('garage scene mounts a TANK water heater 18" off the floor (M1307.3)', () => {
    const tank = members.find((m) => m.role === 'water-heater') as Member
    expect(tank.label).toContain('tank')
    expect(tank.position[1] - tank.dims[1] / 2).toBeCloseTo(inches(18), 6)
    // inside the garage
    expect(tank.position[0]).toBeLessThan(5)
  })

  test('rough-in stub heights follow fixtureRoughIn.*', () => {
    const byId = new Map(stubs(fixtures).map((f) => [String(f.meta?.fixtureId), f]))
    expect(byId.get('wc')?.position[1]).toBeCloseTo(inches(7), 6)
    expect(byId.get('lav')?.position[1]).toBeCloseTo(inches(21), 6)
    expect(byId.get('shw')?.position[1]).toBeCloseTo(inches(44), 6)
    expect(byId.get('ks')?.position[1]).toBeCloseTo(inches(18), 6)
  })

  test('remote wet walls re-vent back to the stack (P3104.4)', () => {
    expect(members.some((m) => m.sourceId.startsWith('dwv-vent-'))).toBe(true)
  })

  test('one stack through the roof + a SLEEVED base drop + cleanouts at base and sewer exit', () => {
    const stack = members.filter((m) => m.role === 'vent-stack')
    expect(stack).toHaveLength(1)
    // The stack stops AT the floor line — a frost stemwall owns the wall
    // line below grade (S1b), so the buried connection is the separate
    // sleeved drop at the inboard junction.
    expect((stack[0] as Member).dims[1]).toBeCloseTo(2.5 + 0.6, 6) // through roof
    const baseChain = members.filter((m) => m.sourceId === 'dwv-stack-base')
    // the floor-line jog bridges the stack to the drop (R1)…
    expect(baseChain.some((m) => m.label?.includes('floor-line jog'))).toBe(true)
    // …and the drop itself is the labeled slab sleeve
    const drop = baseChain.find((m) => m.label?.includes('sleeved'))
    expect(drop).toBeDefined()
    expect(drop?.label).toContain('P2603.4')
    const cleanouts = fixtures.filter((f) => f.kind === 'cleanout')
    expect(cleanouts).toHaveLength(2)
    expect(cleanouts.some((c) => c.label?.includes('sewer'))).toBe(true)
  })

  test('R1: the through-roof stack physically ties into the drainage tree (P3104)', () => {
    expect(stackToTreeGap(members)).toBeLessThanOrEqual(ATTACH_TOL)
  })
})

describe('P5 gate — island fixture (air-run fallback + trap-arm flag)', () => {
  const walls = [
    makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
    makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
    makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
    makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
  ]
  const rooms = [room('r_kitchen', 'kitchen', [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ])]
  const placed = [pf('island', 'kitchen-sink', [4, 4]), pf('wc', 'toilet', [8, 0.6])]
  const { members, fixtures } = layoutPlumbing(walls, rooms, undefined, placed)

  test('(e) trap arm beyond Table P3105.1 fires its flag', () => {
    const arm = members.find((m) => m.sourceId === 'dwv-arm-island') as Member
    expect(arm.flag).toContain('TRAP ARM')
    expect(arm.flag).toContain('P3105.1')
    // the wall-hugging toilet stays clean
    expect(members.find((m) => m.sourceId === 'dwv-arm-wc')?.flag).toBeUndefined()
  })

  test('(e) supply reaches the island as a FLAGGED air run, still continuous', () => {
    const air = members.filter((m) => m.sourceId === 'cold-island' && m.flag?.includes('ISLAND'))
    expect(air.length).toBeGreaterThan(0)
    checkSupply(members, fixtures)
  })

  test('no garage → tankless WH on an exterior wall', () => {
    const wh = members.find((m) => m.role === 'water-heater') as Member
    expect(wh.label).toContain('Tankless')
    expect(wh.position[1] - wh.dims[1] / 2).toBeCloseTo(1.2, 6)
  })

  test('island drains still reach the exit downhill (buried run)', () => {
    expect(drainFailures(members, ['island', 'wc'])).toEqual([])
  })
})

describe('P5 gate — two bathrooms accumulate DFU downstream', () => {
  const walls = [
    makeWall({ id: 'w_s', start: [0, 0], end: [12, 0] }),
    makeWall({ id: 'w_e', start: [12, 0], end: [12, 8] }),
    makeWall({ id: 'w_n', start: [12, 8], end: [0, 8] }),
    makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
    makeWall({ id: 'w_mid', start: [6, 0], end: [6, 8], exterior: false }),
  ]
  const rooms: RoomSlice[] = []
  const placed = [
    pf('wc_a', 'toilet', [1.0, 0.6]),
    pf('lav_a', 'lavatory', [2.0, 0.6]),
    pf('wc_b', 'toilet', [11.0, 0.6]),
    pf('lav_b', 'lavatory', [10.0, 0.6]),
    pf('tub_b', 'bathtub', [11.4, 2.0]),
  ]
  const { members, fixtures } = layoutPlumbing(walls, rooms, undefined, placed)

  test('(a)+(b)+(c) both bathrooms fully served and drained', () => {
    checkSupply(members, fixtures)
    expect(drainFailures(members, ['wc_a', 'lav_a', 'wc_b', 'lav_b', 'tub_b'])).toEqual([])
    expect(levelDrains(members)).toEqual([])
  })

  test('R1: the stack ties into the tree on the two-bath scene too', () => {
    expect(stackToTreeGap(members)).toBeLessThanOrEqual(ATTACH_TOL)
  })

  test('sizes never decrease downstream: WC branches 3", main carries 10 DFU', () => {
    for (const id of ['wc_a', 'wc_b']) {
      const branch = members.filter((m) => m.sourceId === `dwv-branch-${id}`)
      expect(branch.length).toBeGreaterThan(0)
      for (const m of branch) expect(Math.min(m.dims[1], m.dims[2])).toBeCloseTo(inches(3), 6)
    }
    const main = members.find((m) => m.sourceId === 'dwv-main') as Member
    expect(main.label).toContain('10 DFU')
  })

  test('(d) clean even with both baths on exterior walls', () => {
    expect(pipesThroughOpenings(members, walls)).toEqual([])
  })
})

describe('P5 gate — placed path leaves the fallback intact', () => {
  test('no placed fixtures → the room-category engine still answers', () => {
    const { walls, rooms } = housePlan()
    const { members, fixtures } = layoutPlumbing(walls, rooms)
    // fallback vocabulary: room-sourced stubs, no meter, no supply prefixes
    expect(fixtures.some((f) => f.kind === 'water-meter')).toBe(false)
    expect(members.some((m) => m.sourceId.startsWith('cold-'))).toBe(false)
    expect(fixtures.some((f) => f.kind === 'stub-out')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Verify-round defect gates (skeptic round 1, 2026-08-16)
// ---------------------------------------------------------------------------

describe('P5 gate — cross-trade coexistence (verify round)', () => {
  const { walls, rooms } = housePlan()
  const placed = [
    pf('wc', 'toilet', [6.5, 0.6]),
    pf('lav', 'lavatory', [7.6, 0.6]),
    pf('shw', 'shower', [9.3, 0.7]),
    pf('ks', 'kitchen-sink', [1.5, 7.6]),
  ]
  const { members, fixtures } = layoutPlumbing(walls, rooms, undefined, placed)
  const { layoutElectrical, routeWiring } = require('./electrical') as typeof import('./electrical')
  const elecFixtures = layoutElectrical(walls, rooms)
  const wires = routeWiring(elecFixtures, walls).filter((m) => m.role === 'wire-run')

  test('D1: the water heater never engulfs the electrical panel', () => {
    const wh = members.find((m) => m.role === 'water-heater')
    const panel = elecFixtures.find((f) => f.kind === 'panel')
    expect(wh).toBeDefined()
    expect(panel).toBeDefined()
    const w = wh as Member
    const p = panel as Fixture
    const inside =
      Math.abs(p.position[0] - w.position[0]) < w.dims[0] / 2 + 0.05 &&
      Math.abs(p.position[1] - w.position[1]) < w.dims[1] / 2 + 0.05 &&
      Math.abs(p.position[2] - w.position[2]) < w.dims[2] / 2 + 0.05
    expect(inside).toBe(false)
  })

  test('D2: no supply run shares a plane with a wire run (>=2cm separation on parallel co-linear pairs)', () => {
    const supplies = members.filter(
      (m) => m.role === 'pipe-run' && (m.sourceId.startsWith('hot-') || m.sourceId.startsWith('cold-')),
    )
    let worst = Number.POSITIVE_INFINITY
    for (const pipe of supplies) {
      for (const wire of wires) {
        // parallel horizontal members on the same wall plane: compare when
        // both are horizontal and overlap in plan
        const pH = pipe.dims[0] >= pipe.dims[1]
        const wH = wire.dims[0] >= wire.dims[1]
        if (!pH || !wH) continue
        const dYaw = Math.abs(pipe.rotation[1] - wire.rotation[1]) % Math.PI
        if (dYaw > 0.05 && Math.abs(dYaw - Math.PI) > 0.05) continue
        const planDist = Math.hypot(pipe.position[0] - wire.position[0], pipe.position[2] - wire.position[2])
        if (planDist > (pipe.dims[0] + wire.dims[0]) / 2) continue
        const dy = Math.abs(pipe.position[1] - wire.position[1])
        // only co-planar candidates matter (same stud bay band)
        if (planDist < 0.08) worst = Math.min(worst, dy)
      }
    }
    expect(worst).toBeGreaterThan(0.02)
  })
})

describe('P5 gate — DFU main sizing + RO riser + through-wall clearance (verify round)', () => {
  test('D3: the building drain is never smaller than its largest branch', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [30, 0] }),
      makeWall({ id: 'w_e', start: [30, 0], end: [30, 8] }),
      makeWall({ id: 'w_n', start: [30, 8], end: [0, 8] }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
    ]
    const rooms = [room('r', 'bathroom', [[0, 0], [30, 0], [30, 8], [0, 8]])]
    const placed = [
      ...[1, 1.5, 2, 2.5, 3, 3.5].map((x, i) => pf(`s${i}`, 'shower', [x, 0.5])),
      ...[10, 11, 12, 13, 14, 15, 16].map((x, i) => pf(`t${i}`, 'toilet', [x, 0.5])),
    ]
    const { members } = layoutPlumbing(walls, rooms, undefined, placed)
    const main = members.find((m) => m.sourceId === 'dwv-main')
    const branchMax = Math.max(
      ...members
        .filter((m) => m.sourceId.startsWith('dwv-branch-'))
        .map((m) => Math.min(m.dims[1], m.dims[2]) / 0.0254),
    )
    expect(main).toBeDefined()
    const mainIn = Math.min((main as Member).dims[1], (main as Member).dims[2]) / 0.0254
    expect(mainIn + 1e-6).toBeGreaterThanOrEqual(branchMax)
  })

  test('D4: a fixture inside a door RO gets an OPENING flag', () => {
    const { walls, rooms } = housePlan()
    const placed = [pf('lav', 'lavatory', [4, 0.05]), pf('wc', 'toilet', [6.5, 0.6])]
    const { members } = layoutPlumbing(walls, rooms, undefined, placed)
    const flags = members.filter((m) => m.flag?.includes('OPENING')).map((m) => m.flag)
    expect(flags.length).toBeGreaterThan(0)
  })

  test('D5: back-to-back toilets across a wall do NOT trigger the clearance flag', () => {
    const { walls, rooms } = housePlan()
    const placed = [pf('wc1', 'toilet', [4.8, 4]), pf('wc2', 'toilet', [5.2, 4])]
    const { members } = layoutPlumbing(walls, rooms, undefined, placed)
    const clearanceFlags = members.filter((m) => m.flag?.includes('CLEARANCE'))
    expect(clearanceFlags).toEqual([])
  })
})

describe('P5 gate — re-verify round 2 (riser colinearity, short garage wall)', () => {
  test('D2b: pipe and wire detour RISERS never share a plan point at a door', () => {
    const { walls, rooms } = housePlan()
    const placed = [pf('wc', 'toilet', [6.5, 0.6]), pf('ks', 'kitchen-sink', [1.5, 7.6])]
    const { members } = layoutPlumbing(walls, rooms, undefined, placed)
    const { layoutElectrical, routeWiring } = require('./electrical') as typeof import('./electrical')
    const wires = routeWiring(layoutElectrical(walls, rooms), walls)
    const vertical = (m: Member) => m.dims[1] > m.dims[0]
    const pipeRisers = members.filter((m) => m.role === 'pipe-run' && vertical(m) && (m.sourceId.startsWith('cold-') || m.sourceId.startsWith('hot-')))
    const wireRisers = wires.filter((m) => m.role === 'wire-run' && vertical(m))
    for (const p of pipeRisers) {
      for (const w of wireRisers) {
        const planDist = Math.hypot(p.position[0] - w.position[0], p.position[2] - w.position[2])
        const yOverlap =
          Math.min(p.position[1] + p.dims[1] / 2, w.position[1] + w.dims[1] / 2) -
          Math.max(p.position[1] - p.dims[1] / 2, w.position[1] - w.dims[1] / 2)
        if (yOverlap > 0.1) expect(planDist).toBeGreaterThan(0.02)
      }
    }
  })

  test('D1b: a 1.5m garage wall falls back to tankless — never a tank on the panel', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
      makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
      makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
      makeWall({ id: 'w_g', start: [0, 5], end: [1.5, 5], exterior: false }),
    ]
    const rooms = [
      room('r_garage', 'garage', [[0, 5], [1.5, 5], [1.5, 8], [0, 8]], ['w_g']),
      room('r_bath', 'bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]]),
    ]
    const placed = [pf('wc', 'toilet', [6.5, 0.6])]
    const { members, fixtures } = layoutPlumbing(walls, rooms, undefined, placed)
    const wh = members.find((m) => m.role === 'water-heater')
    const whFix = fixtures.find((f) => f.kind === 'water-heater')
    expect((whFix?.label ?? '').toLowerCase()).toContain('tankless')
    // and never overlapping the panel enclosure box
    const { layoutElectrical } = require('./electrical') as typeof import('./electrical')
    const panel = layoutElectrical(walls, rooms).find((f) => f.kind === 'panel')
    if (wh && panel) {
      const overlap =
        Math.abs(panel.position[0] - wh.position[0]) < wh.dims[0] / 2 + 0.2 &&
        Math.abs(panel.position[2] - wh.position[2]) < wh.dims[2] / 2 + 0.2 &&
        Math.abs(panel.position[1] - wh.position[1]) < wh.dims[1] / 2 + 0.38
      expect(overlap).toBe(false)
    }
  })
})

describe('P5 gate — re-verify round 3 (mulled-opening riser clearance)', () => {
  test('D2c: a window 1.5cm past the door edge never swallows the shifted risers', () => {
    const walls = [
      makeWall({
        id: 'w_s',
        start: [0, 0],
        end: [10, 0],
        openings: [
          opening('door', 4, 0.95, 0, 2.15),
          opening('window', 4.69, 0.4, 0.5, 1.4), // RO [4.49, 4.89], sill above the run plane
        ],
      }),
      makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
      makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
      makeWall({ id: 'w_mid', start: [5, 0], end: [5, 8], exterior: false }),
    ]
    const rooms = [
      room('r_bath', 'bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]]),
      room('r_kitchen', 'kitchen', [[0, 5], [5, 5], [5, 8], [0, 8]]),
    ]
    const placed = [pf('wc', 'toilet', [6.5, 0.6]), pf('ks', 'kitchen-sink', [1.5, 7.6])]
    const { members } = layoutPlumbing(walls, rooms, undefined, placed)
    // no unflagged supply member point inside either RO volume
    const bad = pipesThroughOpenings(members, walls)
    expect(bad).toEqual([])
  })
})

describe('P5 gate — re-verify round 4 (exhaustion flags, clamp re-check, wire skin)', () => {
  const wideWalls = (windowW: number, sill: number) => [
    makeWall({
      id: 'w_s',
      start: [0, 0],
      end: [10, 0],
      openings: [opening('door', 4, 0.95, 0, 2.15), opening('window', 4.49 + windowW / 2 + 0.0, windowW, sill, 1.4)],
    }),
    makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
    makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
    makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
    makeWall({ id: 'w_mid', start: [5, 0], end: [5, 8], exterior: false }),
  ]
  const roomsFor = () => [
    room('r_bath', 'bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]]),
    room('r_kitchen', 'kitchen', [[0, 5], [5, 5], [5, 8], [0, 8]]),
  ]

  test('1.2m mulled window: risers are clear OR carry the OPENING flag — never silent', () => {
    const walls = wideWalls(1.2, 0.7)
    const placed = [pf('wc', 'toilet', [6.5, 0.6]), pf('ks', 'kitchen-sink', [1.5, 7.6])]
    const { members } = layoutPlumbing(walls, roomsFor(), undefined, placed)
    // pipesThroughOpenings ignores flagged members; unflagged crossings = 0
    expect(pipesThroughOpenings(members, walls)).toEqual([])
  })

  test('narrow window: cleared risers stay >=2cm from the RO edge (electrical stands there)', () => {
    const walls = wideWalls(0.465, 0.5)
    const placed = [pf('wc', 'toilet', [6.5, 0.6]), pf('ks', 'kitchen-sink', [1.5, 7.6])]
    const { members } = layoutPlumbing(walls, roomsFor(), undefined, placed)
    expect(pipesThroughOpenings(members, walls)).toEqual([])
    const risers = members.filter(
      (m) => m.role === 'pipe-run' && m.dims[1] > m.dims[0] && !m.flag &&
        (m.sourceId.startsWith('cold-') || m.sourceId.startsWith('hot-')),
    )
    for (const r of risers) {
      const u = r.position[0] // w_s runs along +x from origin
      if (Math.abs(r.position[2]) > 0.1) continue
      for (const w of wideWalls(0.465, 0.5).slice(0, 1)) {
        const { openingSpans } = require('./electrical') as typeof import('./electrical')
        for (const sp of openingSpans(w, 0.02, w.height - 0.02)) {
          if (u > sp.lo - 0.02 && u < sp.hi + 0.02) {
            throw new Error(`riser ${r.sourceId} at u=${u.toFixed(3)} within 2cm of RO [${sp.lo},${sp.hi}]`)
          }
        }
      }
    }
  })
})

describe('flexible connectors — off-wall fixtures get braided supply arcs (task 18a)', () => {
  const { walls, rooms } = housePlan()

  test('toilet 0.3m off the wall → conn members chain stub → tank inlet', () => {
    const placed = [pf('wc', 'toilet', [6.5, 0.3])]
    const { members, fixtures } = layoutPlumbing(walls, rooms, undefined, placed)
    const conns = members.filter((m) => m.sourceId === 'conn-cold-wc')
    // 2-3 short chained members, no new roles, plain copper
    expect(conns.length).toBeGreaterThanOrEqual(2)
    expect(conns.length).toBeLessThanOrEqual(3)
    for (const c of conns) {
      expect(c.role).toBe('pipe-run')
      expect(c.material).toBe('copper')
      expect(c.label).toBe('braided supply connector')
      expect(c.length).toBeLessThan(0.5) // short segments, not a homerun
    }
    // endpoints land within 2cm of the stub and of the tank inlet (~0.2m)
    const stub = fixtures.find(
      (f) => f.kind === 'stub-out' && f.meta?.fixtureId === 'wc',
    ) as Fixture
    const pts = conns.flatMap((c) => endpointsOf(c))
    const near = (p: readonly [number, number, number]): number =>
      Math.min(...pts.map((q) => q.distanceTo(new Vector3(p[0], p[1], p[2]))))
    expect(near(stub.position)).toBeLessThan(0.02)
    expect(near([6.5, 0.2, 0.3])).toBeLessThan(0.02)
    // the chain is contiguous: consecutive segments share an endpoint
    for (let i = 0; i < conns.length - 1; i++) {
      const [a1, a2] = endpointsOf(conns[i] as Member)
      const [b1, b2] = endpointsOf(conns[i + 1] as Member)
      const gap = Math.min(
        a1.distanceTo(b1),
        a1.distanceTo(b2),
        a2.distanceTo(b1),
        a2.distanceTo(b2),
      )
      expect(gap).toBeLessThan(0.005)
    }
    // toilet is cold-only: no hot connector doubles the arc
    expect(members.filter((m) => m.sourceId === 'conn-hot-wc')).toHaveLength(0)
  })

  test('hot fixture off the wall gets BOTH hoses; flush fixture gets none', () => {
    const placed = [pf('lav', 'lavatory', [7.6, 0.4]), pf('wc', 'toilet', [6.5, 0.0])]
    const { members } = layoutPlumbing(walls, rooms, undefined, placed)
    // lav: cold arc + hot arc = 3 segments under each per-hose conn id
    expect(members.filter((m) => m.sourceId === 'conn-cold-lav')).toHaveLength(3)
    expect(members.filter((m) => m.sourceId === 'conn-hot-lav')).toHaveLength(3)
    // flush toilet (plan point ON the wall line): no connector at all
    expect(members.filter((m) => m.sourceId.startsWith('conn-') && m.sourceId.endsWith('-wc'))).toHaveLength(0)
  })

  test('island fixture keeps its flagged air run — no connector doubles it', () => {
    const islandWalls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
      makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
      makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
    ]
    const placed = [pf('island', 'kitchen-sink', [4, 4]), pf('wc', 'toilet', [8, 0.6])]
    const { members } = layoutPlumbing(islandWalls, [], undefined, placed)
    expect(members.filter((m) => m.sourceId.endsWith('-island') && m.sourceId.startsWith('conn-'))).toHaveLength(0)
    // the wall-adjacent toilet still gets its hose
    expect(members.filter((m) => m.sourceId === 'conn-cold-wc').length).toBeGreaterThan(0)
  })

  test('connectivity harness stays green with connectors in the member set', () => {
    const placed = [
      pf('wc', 'toilet', [6.5, 0.3]),
      pf('lav', 'lavatory', [7.6, 0.4]),
      pf('ks', 'kitchen-sink', [1.5, 7.6]),
    ]
    const { members, fixtures } = layoutPlumbing(walls, rooms, undefined, placed)
    checkSupply(members, fixtures)
    expect(drainFailures(members, ['wc', 'lav', 'ks'])).toEqual([])
    expect(pipesThroughOpenings(members, walls)).toEqual([])
    // connector attaches stub ↔ fixture: walking cold pipe PLUS connectors
    // from the meter reaches the tank-inlet point itself
    const meter = fixtures.find((f) => f.kind === 'water-meter') as Fixture
    const coldPlus = members.filter(
      (m) =>
        m.role === 'pipe-run' &&
        (m.sourceId.startsWith('cold-') || m.sourceId.startsWith('conn-cold-')),
    )
    expect(
      unreachableFrom(coldPlus, meter.position, 0.12, [{ id: 'wc-inlet', position: [6.5, 0.2, 0.3] }], 0.03),
    ).toEqual([])
  })
})

describe('connector defects — round-3 scorecard fix batch', () => {
  const { walls, rooms } = housePlan()

  test('P5d: a hose through the door RO is FLAGGED — never a silent crossing', () => {
    // repro from the scorecard: lav dropped IN the door RO (u=4 on w_s) put
    // 6 unflagged connector samples through the opening
    const placed = [pf('lav', 'lavatory', [4.0, 0.03]), pf('wc', 'toilet', [6.5, 0.6])]
    const { members } = layoutPlumbing(walls, rooms, undefined, placed)
    expect(pipesThroughOpenings(members, walls)).toEqual([])
    const conns = members.filter((m) => m.sourceId.startsWith('conn-'))
    expect(conns.length).toBeGreaterThan(0)
    expect(conns.some((m) => m.flag?.includes('OPENING'))).toBe(true)
  })

  test('clean hoses stay unflagged (wall-adjacent fixtures, no RO nearby)', () => {
    const placed = [pf('wc', 'toilet', [6.5, 0.3]), pf('lav', 'lavatory', [7.6, 0.4])]
    const { members } = layoutPlumbing(walls, rooms, undefined, placed)
    const conns = members.filter((m) => m.sourceId.startsWith('conn-'))
    expect(conns.length).toBeGreaterThan(0)
    for (const c of conns) expect(c.flag).toBeUndefined()
  })

  test('hose over 0.6 m carries the too-long flag', () => {
    // 0.9m off the wall: still under ISLAND_DIST (1.2) so it gets a hose,
    // but the arc runs past CONN_MAX
    const placed = [pf('wc', 'toilet', [6.5, 0.9])]
    const { members } = layoutPlumbing(walls, rooms, undefined, placed)
    const conns = members.filter((m) => m.sourceId === 'conn-cold-wc')
    expect(conns.length).toBeGreaterThan(0)
    for (const c of conns) expect(c.flag).toContain('connector too long')
  })

  test('takeoff: off-wall fixtures add ZERO copper lf + zero elbows; hoses count as pcs', () => {
    const { computeTakeoff } = require('./takeoff') as typeof import('./takeoff')
    const flush = layoutPlumbing(walls, rooms, undefined, [
      pf('wc', 'toilet', [6.5, 0.0]),
      pf('lav', 'lavatory', [7.6, 0.0]),
    ])
    const off = layoutPlumbing(walls, rooms, undefined, [
      pf('wc', 'toilet', [6.5, 0.3]),
      pf('lav', 'lavatory', [7.6, 0.4]),
    ])
    const a = computeTakeoff(flush.members, flush.fixtures)
    const b = computeTakeoff(off.members, off.fixtures)
    const copperLf = (rows: typeof a) =>
      rows.filter((r) => r.item.startsWith('Copper') && r.unit === 'lf').reduce((s, r) => s + r.quantity, 0)
    const copperElbows = (rows: typeof a) =>
      rows.filter((r) => r.item.startsWith('Copper') && r.item.includes('fittings')).reduce((s, r) => s + r.quantity, 0)
    // same anchors, same homeruns — the hoses add no billable pipe or bends
    expect(copperLf(b)).toBeCloseTo(copperLf(a), 3)
    expect(copperElbows(b)).toBe(copperElbows(a))
    // and the hoses show up as a piece count: wc cold + lav cold + lav hot
    const hoses = b.find((r) => r.item === 'Braided supply connector')
    expect(hoses?.quantity).toBe(3)
    expect(hoses?.unit).toBe('pcs')
    expect(a.find((r) => r.item === 'Braided supply connector')).toBeUndefined()
  })

  test('hoses read cold-blue / hot-red in 3D and on the MEP sheet', () => {
    const { PLUMBING_COLORS, plumbingPipeColor } =
      require('../plans/circuit-colors') as typeof import('../plans/circuit-colors')
    expect(plumbingPipeColor('conn-cold-lav')).toBe(PLUMBING_COLORS.cold)
    expect(plumbingPipeColor('conn-hot-lav')).toBe(PLUMBING_COLORS.hot)
  })
})

describe('P5 gate — re-verify round 5 (jumper through a tee-spanning window)', () => {
  test('sill-0.5 1.2m window over the tee: jumpers are flagged, never silent', () => {
    const walls = [
      makeWall({
        id: 'w_s',
        start: [0, 0],
        end: [10, 0],
        openings: [opening('door', 4, 0.95, 0, 2.15), opening('window', 5.09, 1.2, 0.5, 1.4)],
      }),
      makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
      makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
      makeWall({ id: 'w_mid', start: [5, 0], end: [5, 8], exterior: false }),
    ]
    const rooms = [
      room('r_bath', 'bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]]),
      room('r_kitchen', 'kitchen', [[0, 5], [5, 5], [5, 8], [0, 8]]),
    ]
    const placed = [pf('wc', 'toilet', [6.5, 0.6]), pf('ks', 'kitchen-sink', [1.5, 7.6])]
    const { members } = layoutPlumbing(walls, rooms, undefined, placed)
    expect(pipesThroughOpenings(members, walls)).toEqual([])
  })
})
