import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member, RoomSlice, WallSlice } from '../core/types'
import { inches, toFeet } from '../core/units'
import type { PlacedFixtureSlice } from '../core/wall-model'
import { applyJurisdiction, profileFor } from '../jurisdiction/profiles'
import { layoutPlumbing } from './plumbing'
import { drainFailures } from './plumbing.test-helpers'
import { computeTakeoff } from './takeoff'

/**
 * Checklist row P6 — plumbing SAFETY truth (LOD-400 batch 20):
 *  (a) the water heater ships with its safety hardware — T&P relief valve +
 *      ¾" discharge terminating within 6" of the floor (P2803.6.1), a tank
 *      STAND holding the M1307.3 ignition height, a drain pan (P2801.6),
 *      and seismic straps at the tank's upper+lower thirds in SDC-D specs
 *      only (P2801.8) — never in low-seismic specs;
 *  (b) P3105.1 trap-arm flags measure TRAP WEIR → VENT (developed distance
 *      to the re-vent riser actually serving the wall), per trap, with the
 *      measured feet in the flag; islands flag P3112 island venting;
 *  (c) a 3" stack with less than 1.5" of cover to the wall face flags the
 *      P2603.2.1 shield-plate requirement (the plate members ride B15);
 *  (d) the water meter + cold-main riser warn when they land inside the
 *      electrical panel's NEC 110.26(E) dedicated space (the spatial
 *      reservation itself rides B12/B16).
 */

// ---- scene builders (plumbing.connectivity.test.ts pattern) ----------------

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

const room = (
  id: string,
  category: RoomSlice['category'],
  polygon: [number, number][],
  boundaryWallIds: string[] = [],
): RoomSlice => ({ id, name: category, category, polygon, boundaryWallIds, ceilingHeight: 2.5 })

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

/** 10×8 shell with a west garage — the tank-WH scene (housePlan pattern). */
function garagePlan() {
  const walls = [
    makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
    makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
    makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
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
  ]
  const placed = [pf('wc', 'toilet', [6.5, 0.6]), pf('lav', 'lavatory', [7.6, 0.6])]
  return { walls, rooms, placed }
}

/** Open 10×8 shell, no garage → tankless WH. */
function tanklessPlan() {
  const walls = [
    makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
    makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
    makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
    makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
  ]
  const rooms = [room('r_bath', 'bathroom', [[0, 0], [10, 0], [10, 8], [0, 8]])]
  const placed = [pf('wc', 'toilet', [8, 0.6]), pf('lav', 'lavatory', [7, 0.6])]
  return { walls, rooms, placed }
}

const CA_SPEC = applyJurisdiction(DEFAULT_SPEC, profileFor('CA'))

const bySource = (members: Member[], sid: string): Member[] =>
  members.filter((m) => m.sourceId === sid)
const strapsOf = (members: Member[]): Member[] =>
  members.filter((m) => m.sourceId.startsWith('wh-strap-'))

// ---------------------------------------------------------------------------
// (a) WH safety census
// ---------------------------------------------------------------------------

describe('P6 — WH safety census (T&P + discharge + pan + stand + strap matrix)', () => {
  const { walls, rooms, placed } = garagePlan()
  const intl = layoutPlumbing(walls, rooms, DEFAULT_SPEC, placed)
  const ca = layoutPlumbing(walls, rooms, CA_SPEC, placed)

  test('the tank sits on a REAL stand — steel from the floor to the pan, M1307.3 cite', () => {
    const tank = intl.members.find((m) => m.role === 'water-heater') as Member
    expect(tank.label).toContain('tank')
    const stand = bySource(intl.members, 'wh-stand')[0] as Member
    expect(stand).toBeDefined()
    expect(stand.label).toContain('M1307.3')
    expect(stand.material).toBe('steel')
    // stand bottom ON the floor…
    expect(stand.position[1] - stand.dims[1] / 2).toBeCloseTo(0, 6)
    // …its top + the pan depth land exactly at the tank bottom (nothing floats)
    const pan = bySource(intl.members, 'wh-pan')[0] as Member
    expect(pan).toBeDefined()
    const tankBottom = tank.position[1] - tank.dims[1] / 2
    expect(tankBottom).toBeCloseTo(inches(18), 6)
    expect(stand.position[1] + stand.dims[1] / 2 + pan.dims[1]).toBeCloseTo(tankBottom, 6)
    // the pan wraps the tank footprint
    expect(pan.dims[0]).toBeGreaterThan(tank.dims[0])
    expect(pan.label).toContain('P2801.6')
  })

  test('T&P relief valve + ¾" discharge terminating within 6" of the floor (P2803.6.1)', () => {
    expect(bySource(intl.members, 'wh-tp-valve')).toHaveLength(1)
    const discharge = bySource(intl.members, 'wh-tp-discharge')
    expect(discharge.length).toBeGreaterThanOrEqual(2) // nipple + drop
    for (const m of discharge) expect(m.label).toContain('P2803.6.1')
    const bottom = Math.min(...discharge.map((m) => m.position[1] - m.dims[1] / 2))
    expect(bottom).toBeLessThanOrEqual(inches(6) + 1e-6)
    // the drop starts at the valve, not in the air
    const valve = bySource(intl.members, 'wh-tp-valve')[0] as Member
    const top = Math.max(...discharge.map((m) => m.position[1] + m.dims[1] / 2))
    expect(Math.abs(top - valve.position[1])).toBeLessThan(0.1)
  })

  test('straps matrix: SDC-D (CA) spec straps upper+lower thirds; low-seismic INTL ships ZERO', () => {
    expect(DEFAULT_SPEC.seismicHoldDowns).toBe(false)
    expect(CA_SPEC.seismicHoldDowns).toBe(true) // non-vacuous matrix
    expect(strapsOf(intl.members)).toHaveLength(0)
    const straps = strapsOf(ca.members)
    const ids = new Set(straps.map((m) => m.sourceId))
    expect([...ids].sort()).toEqual(['wh-strap-lower', 'wh-strap-upper'])
    for (const m of straps) {
      expect(m.material).toBe('steel')
      expect(m.label).toContain('P2801.8')
    }
    const tank = ca.members.find((m) => m.role === 'water-heater') as Member
    const bot = tank.position[1] - tank.dims[1] / 2
    const h = tank.dims[1]
    const upperY = (straps.find((m) => m.sourceId === 'wh-strap-upper') as Member).position[1]
    const lowerY = (straps.find((m) => m.sourceId === 'wh-strap-lower') as Member).position[1]
    expect(upperY).toBeGreaterThan(bot + (2 * h) / 3) // upper third
    expect(upperY).toBeLessThan(bot + h)
    expect(lowerY).toBeGreaterThan(bot + inches(4)) // above the controls
    expect(lowerY).toBeLessThan(bot + h / 3) // lower third
  })

  test('tankless (no garage): T&P + discharge still ship; pan/stand/straps never do', () => {
    const { walls: tw, rooms: tr, placed: tp } = tanklessPlan()
    const { members } = layoutPlumbing(tw, tr, CA_SPEC, tp)
    const wh = members.find((m) => m.role === 'water-heater') as Member
    expect(wh.label).toContain('Tankless')
    expect(bySource(members, 'wh-tp-valve')).toHaveLength(1)
    const discharge = bySource(members, 'wh-tp-discharge')
    const bottom = Math.min(...discharge.map((m) => m.position[1] - m.dims[1] / 2))
    expect(bottom).toBeLessThanOrEqual(inches(6) + 1e-6)
    expect(bySource(members, 'wh-pan')).toHaveLength(0)
    expect(bySource(members, 'wh-stand')).toHaveLength(0)
    expect(strapsOf(members)).toHaveLength(0)
  })

  test('takeoff books the hardware as pieces from the members (never assumed)', () => {
    const rows = computeTakeoff(ca.members, ca.fixtures)
    const row = (item: string) => rows.find((r) => r.item === item)
    expect(row('T&P relief valve')?.quantity).toBe(1)
    expect(row('T&P relief valve')?.detail).toContain('P2803.6.1')
    expect(row('Water-heater drain pan')?.quantity).toBe(1)
    expect(row('Water-heater stand')?.quantity).toBe(1)
    expect(row('Seismic straps')?.quantity).toBe(2)
    expect(row('Seismic straps')?.detail).toContain('P2801.8')
    // low-seismic INTL: no strap row at all
    const intlRows = computeTakeoff(intl.members, intl.fixtures)
    expect(intlRows.find((r) => r.item === 'Seismic straps')).toBeUndefined()
  })

  test('LOD 200 keeps the schematic tank + stand; valve/pan/straps are fabrication detail', () => {
    const { members } = layoutPlumbing(walls, rooms, { ...CA_SPEC, detail: '200' }, placed)
    expect(members.find((m) => m.role === 'water-heater')).toBeDefined()
    expect(bySource(members, 'wh-stand')).toHaveLength(1) // nothing floats at any LOD
    expect(bySource(members, 'wh-tp-valve')).toHaveLength(0)
    expect(bySource(members, 'wh-pan')).toHaveLength(0)
    expect(strapsOf(members)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// (b) weir→vent measurement + island venting
// ---------------------------------------------------------------------------

describe('P6 — P3105.1 measures trap weir → vent, per trap', () => {
  const walls = [
    makeWall({ id: 'w_s', start: [0, 0], end: [14, 0] }),
    makeWall({ id: 'w_e', start: [14, 0], end: [14, 8] }),
    makeWall({ id: 'w_n', start: [14, 8], end: [0, 8] }),
    makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
  ]
  const rooms = [room('r_bath', 'bathroom', [[0, 0], [14, 0], [14, 8], [0, 8]])]
  // Cluster near x≈3 (stack + the wall's re-vent carrier) + one FAR lav on
  // the SAME wall: the old fixture→wall measure read 0.6 m for every one
  // of them, so the far trap was silently "served" at any distance.
  const placed = [
    pf('wc', 'toilet', [2, 0.6]),
    pf('lav_near', 'lavatory', [2.8, 0.6]),
    pf('lav_far', 'lavatory', [9, 0.6]),
  ]
  const { members } = layoutPlumbing(walls, rooms, DEFAULT_SPEC, placed)
  const armOf = (id: string) => members.find((m) => m.sourceId === `dwv-arm-${id}`) as Member

  test('far trap on a vented wall FLAGS with the true weir→vent distance', () => {
    const arm = armOf('lav_far')
    expect(arm).toBeDefined()
    expect(arm.flag).toContain('TRAP ARM')
    expect(arm.flag).toContain('P3105.1')
    // weir→vent = 0.3 m emitted arm + 6.2 m along the wall to the re-vent
    // riser at the near lav's junction = 6.5 m ≈ 21.3 ft (limit: 5 ft @ 1.25")
    expect(arm.flag).toContain('21.3 ft')
    // …and the flag STATES the measured target (skeptic attack 3)
    expect(arm.flag).toContain("from its wall's re-vent")
  })

  test('near trap (the vent carrier) and the exempt-but-measured WC stay clean', () => {
    expect(armOf('lav_near').flag).toBeUndefined()
    expect(armOf('wc').flag).toBeUndefined()
  })

  test('the arm label states the weir→vent basis', () => {
    expect(armOf('lav_near').label).toContain('weir→vent')
  })
})

describe('P6 — island fixtures flag island venting (P3112), never silence', () => {
  const walls = [
    makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
    makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
    makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
    makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
  ]
  const rooms = [room('r_kitchen', 'kitchen', [[0, 0], [10, 0], [10, 8], [0, 8]])]
  const placed = [pf('island', 'kitchen-sink', [4, 4]), pf('wc', 'toilet', [8, 0.6])]
  const { members } = layoutPlumbing(walls, rooms, DEFAULT_SPEC, placed)

  test('island arm carries the honest P3112 flag alongside the distance flag', () => {
    const arm = members.find((m) => m.sourceId === 'dwv-arm-island') as Member
    expect(arm.flag).toContain('ISLAND VENT')
    expect(arm.flag).toContain('P3112')
    expect(arm.flag).toContain('not modeled')
    // the distance violation still prints too (composed, not replaced)
    expect(arm.flag).toContain('TRAP ARM')
  })

  test('the wall-hugging toilet is not an island and stays clean', () => {
    expect(members.find((m) => m.sourceId === 'dwv-arm-wc')?.flag).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (c) thin-wall stack cover (P2603.2.1)
// ---------------------------------------------------------------------------

describe('P6 — stack cover flags shield plates on thin walls (P2603.2.1)', () => {
  const plan = (midThickness: number) => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [10, 0], thickness: 0.2 }),
      makeWall({ id: 'w_e', start: [10, 0], end: [10, 8], thickness: 0.2 }),
      makeWall({ id: 'w_n', start: [10, 8], end: [0, 8], thickness: 0.2 }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0], thickness: 0.2 }),
      makeWall({ id: 'w_mid', start: [5, 0], end: [5, 8], exterior: false, thickness: midThickness }),
    ]
    const rooms = [room('r_bath', 'bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]])]
    // both fixtures hug w_mid → the DFU centroid elects it as the stack wall
    const placed = [pf('wc', 'toilet', [5.4, 3]), pf('lav', 'lavatory', [5.4, 2])]
    return layoutPlumbing(walls, rooms, DEFAULT_SPEC, placed)
  }

  test('a 3" stack centered in a 2x4 partition (0.09 m) flags its ~0.3" cover', () => {
    const stack = plan(0.09).members.find((m) => m.role === 'vent-stack') as Member
    expect(stack.flag).toContain('SHIELD')
    expect(stack.flag).toContain('P2603.2.1')
    expect(stack.flag).toContain('does not fit')
  })

  test('a genuinely thick wall (0.2 m → 2.4" cover) stays clean', () => {
    const stack = plan(0.2).members.find((m) => m.role === 'vent-stack') as Member
    expect(stack.flag).toBeUndefined()
  })

  test('the room-category fallback stack confesses the same cover story', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
      makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
      makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
      makeWall({ id: 'w_mid', start: [5, 0], end: [5, 8], exterior: false, thickness: 0.09 }),
    ]
    const rooms = [
      room('r_bath', 'bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]], ['w_mid']),
    ]
    const { members } = layoutPlumbing(walls, rooms, DEFAULT_SPEC)
    const stack = members.find((m) => m.role === 'vent-stack') as Member
    expect(stack.flag).toContain('P2603.2.1')
  })
})

// ---------------------------------------------------------------------------
// (d) water meter vs panel dedicated space (NEC 110.26(E))
// ---------------------------------------------------------------------------

describe('P6 — meter/cold-main vs panel dedicated space warns honestly', () => {
  const { walls, rooms, placed } = tanklessPlan()

  test('both trades elect the longest wall at panelMountU → the riser + meter warn', () => {
    const { members, fixtures } = layoutPlumbing(walls, rooms, DEFAULT_SPEC, placed)
    const riser = members.find(
      (m) => m.sourceId === 'cold-main' && m.dims[1] > m.dims[0] && m.flag,
    ) as Member
    expect(riser).toBeDefined()
    expect(riser.flag).toContain('TRADE CLASH')
    expect(riser.flag).toContain('NEC 110.26')
    const meter = fixtures.find((f) => f.kind === 'water-meter')
    expect(meter?.label).toContain('110.26')
  })

  test('a water-entry override away from the panel wall clears the warning', () => {
    const { members, fixtures } = layoutPlumbing(walls, rooms, DEFAULT_SPEC, placed, {
      waterEntry: { wallId: 'w_e', wallT: 0.5 },
    })
    const flagged = members.filter((m) => m.sourceId === 'cold-main' && m.flag)
    expect(flagged).toEqual([])
    const meter = fixtures.find((f) => f.kind === 'water-meter')
    expect(meter?.label).not.toContain('110.26')
  })
})

// ---------------------------------------------------------------------------
// F3 residual continuity: the clamped drops still DRAIN
// ---------------------------------------------------------------------------

describe('P6 — clamped corner drops keep full drainage continuity', () => {
  test('exhibit-B scene: every trap still reaches the sewer exit downhill', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
      makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
      makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
      makeWall({ id: 'w_mid', start: [5, 0], end: [5, 8], exterior: false }),
    ]
    const rooms = [room('r_bath', 'bathroom', [[5, 0], [10, 0], [10, 4], [5, 4]])]
    const placed = [pf('wc22', 'toilet', [5.22, 0.2]), pf('lavc', 'lavatory', [9.9, 0.08])]
    const { members } = layoutPlumbing(walls, rooms, { ...DEFAULT_SPEC, detail: '400' }, placed)
    expect(drainFailures(members, ['wc22', 'lavc'])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Closing round (examiner + inline skeptic attacks)
// ---------------------------------------------------------------------------

describe('P6 closing — WH hardware anchors off the FINISHED FACE, never in the studs', () => {
  // Examiner flag: whOff measured from the CENTERLINE put the pan edge on
  // the centerline (6.2 cm into the studs) and the stand through the
  // PT-plate band. Equipment is scoped out of the structural SAT matrix
  // (S1) — assert the clearance directly: every across-wall half extent of
  // tank/pan/stand stays outside the drawn wall body.
  const { walls, rooms, placed } = garagePlan()
  const { members } = layoutPlumbing(walls, rooms, CA_SPEC, placed)

  test('tank, pan and stand all clear the wall face (plan-square boxes vs the host wall)', () => {
    const tank = members.find((m) => m.role === 'water-heater') as Member
    expect(tank).toBeDefined()
    // host wall = nearest centerline to the tank
    const host = walls.reduce((best, w) => {
      const offOf = (wl: typeof w) => {
        const dx = tank.position[0] - wl.start[0]
        const dz = tank.position[2] - wl.start[1]
        return Math.abs(-dx * wl.dir[1] + dz * wl.dir[0])
      }
      return offOf(w) < offOf(best) ? w : best
    })
    const offOf = (m: Member) => {
      const dx = m.position[0] - host.start[0]
      const dz = m.position[2] - host.start[1]
      return Math.abs(-dx * host.dir[1] + dz * host.dir[0])
    }
    const pieces: [string, Member, number][] = [
      ['tank', tank, tank.dims[2] / 2],
      ['pan', bySource(members, 'wh-pan')[0] as Member, (bySource(members, 'wh-pan')[0] as Member).dims[2] / 2],
      ['stand', bySource(members, 'wh-stand')[0] as Member, (bySource(members, 'wh-stand')[0] as Member).dims[2] / 2],
    ]
    for (const [name, m, half] of pieces) {
      expect(m).toBeDefined()
      const clear = offOf(m) - half - host.thickness / 2
      expect(clear).toBeGreaterThan(0) // outside the drawn wall body
      if (clear <= 0) throw new Error(`${name} enters the wall body by ${-clear}`)
    }
  })
})

describe('P6 closing — vent-less walls measure to the stack, and say so (attack 3)', () => {
  test('island trap: the TRAP ARM flag names the stack vent as its measured target', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
      makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
      makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
    ]
    const rooms = [room('r_kitchen', 'kitchen', [[0, 0], [10, 0], [10, 8], [0, 8]])]
    const placed = [pf('island', 'kitchen-sink', [4, 4]), pf('wc', 'toilet', [8, 0.6])]
    const { members } = layoutPlumbing(walls, rooms, DEFAULT_SPEC, placed)
    const arm = members.find((m) => m.sourceId === 'dwv-arm-island') as Member
    expect(arm.flag).toContain('the stack vent')
  })

  test('a lone fixture (its wall vent IS the stack) never crashes and stays clean', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
      makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
      makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
    ]
    const rooms = [room('r_bath', 'bathroom', [[0, 0], [10, 0], [10, 8], [0, 8]])]
    const { members } = layoutPlumbing(walls, rooms, DEFAULT_SPEC, [pf('lav', 'lavatory', [5, 0.6])])
    const arm = members.find((m) => m.sourceId === 'dwv-arm-lav') as Member
    expect(arm).toBeDefined()
    expect(arm.flag).toBeUndefined()
    // the stack IS this wall's vent — no redundant re-vent riser emits
    expect(members.some((m) => m.sourceId.startsWith('dwv-vent-'))).toBe(false)
  })
})

describe('P6 closing — pinched/surrounded drops give up with a FLAG, never loop (attacks 4+5b)', () => {
  test('twin bearing walls 0.45 m apart: the pinched drop emits SLEEVED with a P4-visible flag', () => {
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
      makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
      makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
      // twin interior BEARING walls: two 16"-wide thickened-footing bands
      // (need ≈ 0.26 m each) with 0.45 m between centerlines — no clear slot
      makeWall({ id: 'w_a', start: [5, 0], end: [5, 8], exterior: false }),
      makeWall({ id: 'w_b', start: [5.45, 0], end: [5.45, 8], exterior: false }),
    ]
    const rooms = [room('r_bath', 'bathroom', [[0, 0], [10, 0], [10, 8], [0, 8]])]
    const { members } = layoutPlumbing(walls, rooms, DEFAULT_SPEC, [pf('wc', 'toilet', [5.2, 4])])
    const drop = members.find(
      (m) => m.sourceId === 'dwv-trap-wc' && m.dims[1] > m.dims[0],
    ) as Member
    expect(drop).toBeDefined()
    // the label is the SAT exemption; the FLAG is the paper surface — the
    // riser is VERTICAL, so the sheets' tick layer never draws it (P4)
    expect(drop.label).toContain('sleeved')
    expect(drop.flag).toContain('SLEEVE')
    expect(drop.flag).toContain('P2603.4')
  })

  test('crawl-of-death: a drop surrounded by concrete on ALL sides terminates, sleeved + flagged', () => {
    const cell = 0.45
    const walls = [
      makeWall({ id: 'w_s', start: [0, 0], end: [10, 0] }),
      makeWall({ id: 'w_e', start: [10, 0], end: [10, 8] }),
      makeWall({ id: 'w_n', start: [10, 8], end: [0, 8] }),
      makeWall({ id: 'w_w', start: [0, 8], end: [0, 0] }),
      // a tiny exterior cell (stemwalls on all four sides) around the fixture
      makeWall({ id: 'c_s', start: [5 - cell / 2, 4 - cell / 2], end: [5 + cell / 2, 4 - cell / 2] }),
      makeWall({ id: 'c_e', start: [5 + cell / 2, 4 - cell / 2], end: [5 + cell / 2, 4 + cell / 2] }),
      makeWall({ id: 'c_n', start: [5 + cell / 2, 4 + cell / 2], end: [5 - cell / 2, 4 + cell / 2] }),
      makeWall({ id: 'c_w', start: [5 - cell / 2, 4 + cell / 2], end: [5 - cell / 2, 4 - cell / 2] }),
    ]
    const rooms = [room('r_bath', 'bathroom', [[0, 0], [10, 0], [10, 8], [0, 8]])]
    // completing at all proves clampDropClear terminates (bounded passes)
    const { members } = layoutPlumbing(walls, rooms, DEFAULT_SPEC, [pf('wc', 'toilet', [5, 4])])
    const drop = members.find(
      (m) => m.sourceId === 'dwv-trap-wc' && m.dims[1] > m.dims[0],
    ) as Member
    expect(drop).toBeDefined()
    expect(drop.label).toContain('sleeved')
    expect(drop.flag).toContain('P2603.4')
  })
})
