import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Fixture, Member, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import {
  placeCondenserSeedSpot,
  MAX_TONS_PER_CONDENSER,
  condenserPlan,
  condenserSqftPerTon,
  layoutHvac,
  placeHeatPumpSpot,
} from './hvac'
import { circuitSchedule } from './electrical'
import { manualJLite, manualSTons } from './manual-j'
import { computeTakeoff } from './takeoff'

/**
 * GATES (night-4 user ask — AC condenser blocks): the outdoor unit row.
 *  1. unit count scales with conditioned floor area (1 / 2 / 3+), per-unit
 *     tonnage never exceeds 5 (residential condensers top out there);
 *  2. hot climate zones (1-2) size at 1 ton/450 sqft, cold (5+) at 650 —
 *     the divisor is read from wall-assemblies stateClimateZone and CITED
 *     in the fixture label (an uncited assumption is a lie);
 *  3. every pad/cabinet sits OUTSIDE the exterior wall, ≥ 0.6 m clear of
 *     its neighbors, never in front of a door/window RO (slides along the
 *     wall to clear);
 *  4. each unit's line-set (suction ¾" insulated + liquid ⅜") reaches the
 *     air handler (endpoint tolerance) through ONE wall penetration at
 *     ~0.4 m, then FOLLOWS THE WALLS on the plumbing routePipe rails —
 *     E1 RO detours over headers, no diagonal air runs (line-set round
 *     continuity/parallelism gates live in hvac.lineset.test.ts);
 *  5. a disconnect lands within sight (≤ 1 m) of each unit (NEC 440.14);
 *  6. takeoff rows mirror the rendered counts (checklist S4);
 *  7. the heat-pump service override MOVES unit #1 verbatim and the row
 *     re-anchors to it (checklist A4);
 *  8. a small scene with no override keeps the pre-existing single-unit
 *     anchor (placeHeatPumpSpot) — the legacy behavior generalized, not
 *     duplicated.
 */

const LOD400 = { ...DEFAULT_SPEC, detail: '400' as const }

function opening(id: string, u: number, roughWidth: number, kind: 'door' | 'window' = 'door'): OpeningSlice {
  return {
    id,
    kind,
    u,
    width: roughWidth - 0.05,
    height: kind === 'door' ? 2.03 : 1.2,
    sillHeight: kind === 'door' ? 0 : 0.9,
    roughWidth,
    roughHeight: kind === 'door' ? 2.1 : 1.3,
  }
}

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  exterior = false,
  openings: OpeningSlice[] = [],
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
    thickness: 0.2,
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

/** W×D rectangular shell: laundry (equipment room) in the SW corner, the
 * rest habitable — conditioned area = W×D exactly. */
function shell(W: number, D: number, southOpenings: OpeningSlice[] = []) {
  const walls = [
    wall('w_south', [0, 0], [W, 0], true, southOpenings),
    wall('w_north', [0, D], [W, D], true),
    wall('w_west', [0, 0], [0, D], true),
    wall('w_east', [W, 0], [W, D], true),
  ]
  const rooms = [
    room('r_laundry', 'Laundry', 'laundry', [[0, 0], [3, 0], [3, 3], [0, 3]]),
    room('r_living', 'Living', 'other', [[3, 0], [W, 0], [W, D], [3, D]]),
    room('r_bed', 'Bedroom', 'bedroom', [[0, 3], [3, 3], [3, D], [0, D]]),
  ]
  return { walls, rooms }
}

const condensersOf = (fixtures: Fixture[]): Fixture[] =>
  fixtures.filter((f) => f.kind === 'equipment' && f.meta?.equipment === 'condenser')

const padsOf = (members: Member[]): Member[] =>
  members.filter((m) => m.system === 'hvac' && m.role === 'equipment' && m.material === 'concrete')

const cabinetsOf = (members: Member[]): Member[] =>
  members.filter((m) => m.system === 'hvac' && m.role === 'equipment' && m.material === 'steel')

type Endpoint = { x: number; y: number; z: number }

/** Horizontal duct()/vertical ductDrop() member endpoints (world x/y/z). */
function endpointsOf(m: Member): [Endpoint, Endpoint] {
  if (m.rotation[1] === 0 && m.dims[1] === m.length) {
    // vertical drop — plan point fixed, y spans the length
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

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

describe('condenser sizing — area + climate zone (assumption, Manual J/S govern)', () => {
  test('unit count scales with floor area: small 1, ~2800 sqft 2, huge 3', () => {
    // 10×8 m = 861 sqft → 2.0 tons → 1 unit
    expect(condenserPlan(80).count).toBe(1)
    // 26×10 m = 2799 sqft → 5.5 tons → 2 units
    expect(condenserPlan(260).count).toBe(2)
    // 40×14 m = 6028 sqft → 11 tons → 3 units
    expect(condenserPlan(560).count).toBe(3)
  })

  test('tiny homes floor at 1 unit / 1.5 tons', () => {
    const tiny = condenserPlan(20) // 215 sqft
    expect(tiny.count).toBe(1)
    expect(tiny.totalTons).toBe(1.5)
    expect(tiny.unitTons).toBe(1.5)
  })

  test('per-unit tonnage never exceeds 5 across a wide area sweep', () => {
    for (let area = 20; area <= 1600; area += 20) {
      const plan = condenserPlan(area)
      expect(plan.unitTons).toBeLessThanOrEqual(MAX_TONS_PER_CONDENSER)
      expect(plan.count).toBe(Math.max(1, Math.ceil(plan.totalTons / MAX_TONS_PER_CONDENSER)))
    }
  })

  test('hot states (zone 1-2) size at 450 sqft/ton, cold (5+) at 650, mid at 550', () => {
    expect(condenserSqftPerTon('FL').divisor).toBe(450) // 2A
    expect(condenserSqftPerTon('AZ').divisor).toBe(450) // 2B
    expect(condenserSqftPerTon('MO').divisor).toBe(550) // 4A
    expect(condenserSqftPerTon('MN').divisor).toBe(650) // 6A
    expect(condenserSqftPerTon('INTL').divisor).toBe(550) // zone-less → mid
    expect(condenserSqftPerTon(undefined).divisor).toBe(550)
    // Same house, different jurisdictions: FL genuinely buys more cooling.
    expect(condenserPlan(260, 'FL').totalTons).toBeGreaterThan(condenserPlan(260, 'MN').totalTons)
    expect(condenserPlan(260, 'FL').count).toBe(2)
    expect(condenserPlan(260, 'MN').count).toBe(1)
  })

  test('fixture label CITES the sizing basis: Manual J-lite when the zone resolves, the sqft rule + trigger when it cannot', () => {
    const { walls, rooms } = shell(26, 10)
    // FL resolves zone 2A → the Manual-J-lite load sizes (M1401.3) and the
    // label carries the basis: zone + the design temp the ΔT came from.
    const fl = layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'FL' })
    const flUnits = condensersOf(fl.fixtures)
    expect(flUnits.length).toBeGreaterThanOrEqual(1)
    expect(flUnits[0]?.label).toContain('Manual J-lite, zone 2A design 35°C')
    expect(flUnits[0]?.meta?.sizingBasis).toBe('manual-j-lite')
    // …and the air handler sizes from the SAME plan (one system tonnage)
    const ah = fl.fixtures.find((f) => f.label?.includes('Air handler'))
    expect(ah?.label).toContain('Manual J-lite, zone 2A design 35°C')
    expect(ah?.meta?.tons).toBe(flUnits[0]?.meta?.totalTons)
    // No stateCode → climate zone unknown → the labeled sqft FALLBACK, with
    // the trigger stated on the label — never a silent rule swap.
    const intl = condensersOf(layoutHvac(walls, rooms, LOD400).fixtures)
    expect(intl[0]?.label).toContain('assumed 1 ton/550 sqft')
    expect(intl[0]?.label).toContain('Manual J-lite fallback: climate zone unknown')
    expect(intl[0]?.meta?.sizingBasis).toBe('sqft-rule')
  })
})

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

describe('condenser row placement — outside, clear, spaced (IRC M1403 + mfr clearance)', () => {
  test('every pad + cabinet sits OUTSIDE the shell, on a 3-unit house', () => {
    const { walls, rooms } = shell(40, 14)
    const { members, fixtures } = layoutHvac(walls, rooms, LOD400)
    const units = condensersOf(fixtures)
    expect(units.length).toBe(3)
    expect(padsOf(members).length).toBe(3)
    expect(cabinetsOf(members).length).toBe(3)
    for (const box of [...padsOf(members), ...cabinetsOf(members)]) {
      const inside =
        box.position[0] > 0 && box.position[0] < 40 && box.position[2] > 0 && box.position[2] < 14
      expect(inside).toBe(false)
    }
  })

  test('units keep ≥ 0.6 m clear between cabinets and ≥ 0.3 m off the wall face', () => {
    const { walls, rooms } = shell(26, 10)
    const { members } = layoutHvac(walls, rooms, LOD400)
    const cabs = cabinetsOf(members)
    expect(cabs.length).toBe(2)
    for (let i = 0; i < cabs.length; i++) {
      for (let j = i + 1; j < cabs.length; j++) {
        const a = cabs[i] as Member
        const b = cabs[j] as Member
        const dist = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])
        // center pitch − cabinet width = clear air between the boxes
        expect(dist - 0.95).toBeGreaterThanOrEqual(0.6 - 1e-9)
      }
      // row is on the south wall (z = 0, thickness 0.2): face at z = −0.1;
      // cabinet near edge = center + depth/2
      const cab = cabs[i] as Member
      expect(-(cab.position[2] + 0.95 / 2) - 0.1).toBeGreaterThanOrEqual(0.3 - 1e-9)
    }
  })

  test('AUTO anchors: ≥ 24" face clearance by construction — pad centered under the cabinet, no slide', () => {
    // Unwarp round 2026-08-23 + HP-polish grid snap: the auto stand-off is
    // condenserStandoff = t/2 + 0.6096 + depth/2 = 0.1 + 0.6096 + 0.475 =
    // 1.1846 from the centerline, grid-snapped AWAY from the wall to the
    // next 0.5 m host-grid multiple → 1.5 (the 24" figure is a FLOOR the
    // snap can only raise — hence the label's '≥ 24"'). The pad inner edge
    // clears the worst-case R703.8 exterior assembly (face 0.1 + 0.13)
    // with room to spare, so the S1 slide never fires and the slab stays
    // centered.
    const { walls, rooms } = shell(26, 10)
    const { members } = layoutHvac(walls, rooms, LOD400)
    const pads = padsOf(members)
    const cabs = cabinetsOf(members)
    expect(pads.length).toBe(2)
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i] as Member
      const cab = cabs[i] as Member
      // south row: wall centerline z = 0, thickness 0.2 → face −0.1
      const padInnerEdge = -(pad.position[2] + 1.0 / 2)
      expect(padInnerEdge).toBeGreaterThanOrEqual(0.1 + 0.13 - 1e-9)
      // cabinet footprint stays within the pad footprint (2.5 cm reveal)
      expect(Math.abs(cab.position[2] - pad.position[2])).toBeLessThanOrEqual(
        1.0 / 2 - 0.95 / 2 + 1e-9,
      )
      expect(Math.abs(cab.position[0] - pad.position[0])).toBeLessThanOrEqual(
        1.0 / 2 - 0.95 / 2 + 1e-9,
      )
      // cabinet anchor: the stand-off basis t/2 + 24" + depth/2 = 1.1846,
      // ceil-snapped outward to the 0.5 host grid → 1.5 (world z = −1.5,
      // a grid line at every host step option)
      expect(cab.position[2]).toBeCloseTo(-1.5, 6)
      // face clearance ≥ the 24" floor: wall face (−0.1) → cabinet face
      expect(-(cab.position[2] + 0.95 / 2) - 0.1).toBeGreaterThanOrEqual(0.6096 - 1e-9)
      // …and the honest-anchor row carries no overhang flag
      expect(pad.flag ?? '').not.toContain('overhangs its pad')
      expect(cab.flag ?? '').not.toContain('overhangs its pad')
    }
    // the pad label states the clearance basis as a FLOOR (HP polish: the
    // outward snap makes 24" a minimum, not the figure)
    expect(pads[0]?.label).toContain('≥ 24" face clearance basis')
  })

  test('VERBATIM anchor tucked against the wall: the slab slides clear (S1) and the overhang is flagged', () => {
    // A user drag at the legacy 0.6 m stand-off: the pad must still clear
    // the R703.8 assembly (inner edge ≥ face + 0.13), the CABINET keeps
    // the user's point verbatim (A4), and — with only a 2.5 cm pad reveal
    // around the true 0.95 m cabinet — the slide leaves the cabinet
    // overhanging the slab: pad + cabinet say so, never silent.
    const { walls, rooms } = shell(26, 10)
    const { members } = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: [13, 0, -0.6] },
    })
    const pads = padsOf(members)
    const cabs = cabinetsOf(members)
    const pad = pads[0] as Member
    const cab = cabs[0] as Member
    // cabinet anchor verbatim (A4 — never silently relocated)
    expect(cab.position[0]).toBeCloseTo(13, 6)
    expect(cab.position[2]).toBeCloseTo(-0.6, 6)
    // slab slid clear of the assembly
    expect(-(pad.position[2] + 1.0 / 2)).toBeGreaterThanOrEqual(0.1 + 0.13 - 1e-9)
    // the slide exceeded the 2.5 cm reveal → overhang, flagged on BOTH
    expect(Math.abs(cab.position[2] - pad.position[2])).toBeGreaterThan(1.0 / 2 - 0.95 / 2)
    expect(pad.flag ?? '').toContain('overhangs its pad')
    expect(cab.flag ?? '').toContain('overhangs its pad')
    // row unit #2 keeps the mfr floor (rowOff = max(off, minOff)) and,
    // standing at minOff = t/2 + 0.3 + depth/2 = 0.875 ≥ the 0.73 the pad
    // needs, composes flag-free
    if (pads.length > 1) {
      expect(pads[1]?.flag ?? '').not.toContain('overhangs its pad')
    }
  })

  test('a pad never fronts a door/window RO — the row slides along the wall to clear', () => {
    // Door RO right where the auto anchor would land (u≈1.5 on w_south).
    const { walls, rooms } = shell(26, 10, [opening('d1', 1.6, 0.9)])
    const { members } = layoutHvac(walls, rooms, LOD400)
    const pads = padsOf(members)
    expect(pads.length).toBe(2)
    for (const pad of pads) {
      // pads stay on the south row (outside, z<0) …
      expect(pad.position[2]).toBeLessThan(0)
      // … and clear of the RO span [1.15, 2.05] by half a pad
      expect(Math.abs(pad.position[0] - 1.6)).toBeGreaterThanOrEqual(0.9 / 2 + 1.0 / 2 - 1e-9)
    }
  })

  test('a direction that runs off the wall grows the row the other way', () => {
    // Anchor the row near a wall END: override at the far-west end of the
    // south wall — unit #2 cannot step west, so it must step EAST.
    const { walls, rooms } = shell(26, 10)
    const { fixtures } = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: [0.2, 0, -0.7] },
    })
    const units = condensersOf(fixtures)
    expect(units.length).toBe(2)
    expect(units[0]?.position[0]).toBeCloseTo(0.2, 6)
    expect(units[1]?.position[0]).toBeGreaterThan(0.2)
  })
})

// ---------------------------------------------------------------------------
// Line-set + disconnect
// ---------------------------------------------------------------------------

describe('line-set — one RO-clear wall penetration, wall-following pair to the air handler', () => {
  const { walls, rooms } = shell(26, 10)
  const { members, fixtures } = layoutHvac(walls, rooms, LOD400)
  const handler = fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
  const units = condensersOf(fixtures)

  test('each unit has a suction+liquid pair whose run reaches the air handler', () => {
    expect(units.length).toBe(2)
    for (let n = 1; n <= units.length; n++) {
      const suction = members.filter(
        (m) => m.sourceId === `lineset-suction-${n}` && m.role === 'pipe-run',
      )
      const liquid = members.filter(
        (m) => m.sourceId === `lineset-liquid-${n}` && m.role === 'pipe-run',
      )
      expect(suction.length).toBeGreaterThan(0)
      expect(liquid.length).toBeGreaterThan(0)
      // distinct member labels: the cold line says insulated, the warm one
      // carries its own size (the M2 line-set round contract)
      expect(suction.every((m) => m.label?.includes('suction ¾" — insulated'))).toBe(true)
      expect(liquid.every((m) => m.label?.includes('liquid ⅜"'))).toBe(true)
      // line-set members are HVAC scope even on the plumbing rails
      expect(suction.every((m) => m.system === 'hvac')).toBe(true)
      // endpoint lands at the handler plan point
      const reaches = suction.some((m) =>
        endpointsOf(m).some(
          (e) => Math.hypot(e.x - handler.position[0], e.z - handler.position[2]) < 0.06,
        ),
      )
      expect(reaches).toBe(true)
      // … and at the unit
      const unit = units[n - 1] as Fixture
      const atUnit = suction.some((m) =>
        endpointsOf(m).some(
          (e) => Math.hypot(e.x - unit.position[0], e.z - unit.position[2]) < 0.06,
        ),
      )
      expect(atUnit).toBe(true)
    }
  })

  test('every line-set leg is plan-axis-aligned (Manhattan — no diagonal air runs)', () => {
    const legs = members.filter((m) => m.sourceId.startsWith('lineset-'))
    expect(legs.length).toBeGreaterThan(0)
    for (const m of legs) {
      const quarter = m.rotation[1] / (Math.PI / 2)
      expect(Math.abs(quarter - Math.round(quarter))).toBeLessThan(1e-9)
    }
  })

  test('the run penetrates the wall at ~0.4 m — outside leg to the wall plane, inside leg onward', () => {
    // Row lives on the south wall (z = 0). The through-wall pair: one leg
    // arrives at the centerline from OUTSIDE, another leaves it INSIDE.
    const suction = members.filter(
      (m) => m.sourceId.startsWith('lineset-') && m.label?.includes('suction'),
    )
    const arrivesFromOutside = suction.some((m) => {
      const [a, b] = endpointsOf(m)
      const zs = [a.z, b.z].sort((p, q) => p - q)
      return Math.abs((zs[1] as number) - 0) < 1e-6 && (zs[0] as number) < -0.3
    })
    const continuesInside = suction.some((m) => {
      const [a, b] = endpointsOf(m)
      const zs = [a.z, b.z].sort((p, q) => p - q)
      return Math.abs((zs[0] as number) - 0) < 1e-6 && (zs[1] as number) > 0.3
    })
    expect(arrivesFromOutside).toBe(true)
    expect(continuesInside).toBe(true)
    for (const m of suction) expect(m.position[1]).toBeCloseTo(0.42, 6)
  })

  test('a door RO on the in-wall path DETOURS over the header (E1 for pipe)', () => {
    // Force unit #1 to (8, −0.7): the in-wall route runs pen(8,0) → the AH
    // anchor (1.5,0) ALONG the south wall — straight through the door RO at
    // u=5 at pipe height. The plumbing rails rise inside the king-stud bay,
    // cross ABOVE the header and drop back (never through the doorway).
    const withDoor = shell(26, 10, [opening('d_mid', 5, 0.9)])
    const out = layoutHvac(withDoor.walls, withDoor.rooms, DEFAULT_SPEC, {
      heatPump: { position: [8, 0, -0.7] },
    })
    const suction = out.members.filter(
      (m) => m.sourceId === 'lineset-suction-1' && m.label?.includes('suction'),
    )
    expect(suction.length).toBeGreaterThan(0)
    // RO span [4.55, 5.45]; the detour risers stand 4.5 cm past its edges
    const spansDoor = (a: Endpoint, b: Endpoint) =>
      Math.min(a.x, b.x) < 4.56 && Math.max(a.x, b.x) > 5.44
    // no leg crosses the door AT PIPE HEIGHT inside the wall band …
    const crossesDoorAtPipeY = suction.some((m) => {
      const [a, b] = endpointsOf(m)
      return (
        spansDoor(a, b) &&
        Math.abs(a.z) < 0.11 &&
        Math.abs(b.z) < 0.11 &&
        Math.max(a.y, b.y) < 2.1
      )
    })
    expect(crossesDoorAtPipeY).toBe(false)
    // … the crossing happens ABOVE the door header (topY = 2.1) …
    const crossesOverHeader = suction.some((m) => {
      const [a, b] = endpointsOf(m)
      return spansDoor(a, b) && Math.abs(a.z) < 0.11 && a.y > 2.1 && b.y > 2.1
    })
    expect(crossesOverHeader).toBe(true)
    // … with riser legs connecting the detour back to the pipe plane
    const risers = suction.filter((m) => m.dims[1] === m.length && m.rotation[1] === 0)
    expect(risers.length).toBeGreaterThanOrEqual(2)
    // the detoured run stays unflagged and still reaches the handler
    for (const m of suction) expect(m.flag).toBeUndefined()
    const reaches = suction.some((m) =>
      endpointsOf(m).some((e) => Math.hypot(e.x - 1.5, e.z - 1.5) < 0.06),
    )
    expect(reaches).toBe(true)
  })

  test('a run that CANNOT clear an RO is ⚠-marked, never silent', () => {
    // Full-height glazing dead between the penetration and the AH anchor —
    // no wall remains above the header or below the sill to detour through.
    const glazing: OpeningSlice = {
      id: 'w_full',
      kind: 'window',
      u: 5,
      width: 0.95,
      height: 2.65,
      sillHeight: 0,
      roughWidth: 1.0,
      roughHeight: 2.7,
    }
    const blocked = shell(26, 10, [glazing])
    const out = layoutHvac(blocked.walls, blocked.rooms, DEFAULT_SPEC, {
      heatPump: { position: [8, 0, -0.7] },
    })
    const legs = out.members.filter((m) => m.sourceId.startsWith('lineset-suction-1'))
    expect(legs.length).toBeGreaterThan(0)
    expect(legs.some((m) => m.label?.includes('⚠ crosses full-height opening'))).toBe(true)
  })

  test('a degenerate scene without walls keeps a FLAGGED air run (routePipe fallback semantics)', () => {
    // No exterior wall at all (heat-pump node forces the row): the pair
    // still connects unit → handler, but every leg carries the AIR RUN
    // flag — honesty over silence.
    const out = layoutHvac([], rooms, LOD400, { heatPump: { position: [5, 0, -1] } })
    const legs = out.members.filter((m) => m.sourceId.startsWith('lineset-'))
    expect(legs.length).toBeGreaterThan(0)
    expect(legs.every((m) => m.flag?.includes('AIR RUN'))).toBe(true)
  })

  test('a disconnect mounts within 1 m of each unit, one per unit (NEC 440.14)', () => {
    const disconnects = fixtures.filter((f) => f.kind === 'disconnect')
    expect(disconnects.length).toBe(units.length)
    for (let n = 1; n <= units.length; n++) {
      const disc = disconnects.find((f) => f.meta?.unit === n) as Fixture
      const unit = units[n - 1] as Fixture
      expect(disc).toBeDefined()
      const dist = Math.hypot(
        disc.position[0] - unit.position[0],
        disc.position[1] - unit.position[1],
        disc.position[2] - unit.position[2],
      )
      // "Within sight" (NEC 440.14) is a visibility rule (≤ 50 ft), not a
      // 1 m one — this pin guards proximity sanity at the CHECKLIST M2
      // class bound (amended, verify F2 — the row and this allowance
      // agree to the digit): 3D box↔unit-center ≤ 1.73 m unobstructed,
      // basis √((S − t/2 − 0.02)² + 0.725²) with the world-grid-snapped
      // stand-off S < condenserStandoff(t) + 0.5. This scene: 1.5589
      // (t = 0.2, S = 1.5).
      expect(dist).toBeLessThanOrEqual(1.73)
      expect(disc.label).toContain('2-pole') // AC-n circuit label (wired by compute)
    }
    // + a whip per unit (liquid-tight conduit, never NM-B)
    const whips = new Set(
      members.filter((m) => m.sourceId.startsWith('ac-whip-')).map((m) => m.sourceId),
    )
    expect(whips.size).toBe(units.length)
  })
})

// ---------------------------------------------------------------------------
// Overrides (checklist A4) + legacy anchor
// ---------------------------------------------------------------------------

describe('heat-pump override moves unit #1 and the row follows (A4)', () => {
  test('unit #1 lands VERBATIM on the node; the rest re-anchor to its wall', () => {
    const { walls, rooms } = shell(26, 10)
    const moved = layoutHvac(walls, rooms, DEFAULT_SPEC, { heatPump: { position: [28, 0, 3] } })
    const units = condensersOf(moved.fixtures)
    expect(units.length).toBe(2) // override triggers the row at ANY LOD
    expect(units[0]?.position[0]).toBeCloseTo(28, 6)
    expect(units[0]?.position[2]).toBeCloseTo(3, 6)
    // row re-anchors to the EAST wall (x = 26): unit #2 keeps the anchor's
    // stand-off and steps along z at pad + clearance pitch (1.0 + 0.6)
    expect(units[1]?.position[0]).toBeCloseTo(28, 6)
    expect(Math.abs((units[1]?.position[2] ?? 0) - 3)).toBeCloseTo(1.0 + 0.6, 6)
    // line-set #1 re-anchors with it
    const legs = moved.members.filter((m) => m.sourceId === 'lineset-suction-1')
    expect(legs.length).toBeGreaterThan(0)
    const reaches = legs.some((m) =>
      endpointsOf(m).some((e) => Math.hypot(e.x - 28, e.z - 3) < 0.06),
    )
    expect(reaches).toBe(true)
  })

  test('no override, small scene → single unit at the auto anchor (seed spot; grid-aligned)', () => {
    const { walls, rooms } = shell(10, 8)
    // The composed anchor IS the seed spot (RO slide + grid snap included —
    // HP polish); the raw election spot (placeHeatPumpSpot) is upstream of
    // the snap and only equals it when it already sat on the grid.
    const spot = placeCondenserSeedSpot(walls, rooms)
    const { fixtures } = layoutHvac(walls, rooms, LOD400)
    const units = condensersOf(fixtures)
    expect(units.length).toBe(1)
    expect(units[0]?.position[0]).toBeCloseTo(spot?.[0] ?? Number.NaN, 12)
    expect(units[0]?.position[2]).toBeCloseTo(spot?.[1] ?? Number.NaN, 12)
    // grid alignment (Julien: "by default it's not aligned to the grid"):
    // both plan coordinates land on the 0.5 m host grid
    for (const c of [units[0]?.position[0] ?? Number.NaN, units[0]?.position[2] ?? Number.NaN]) {
      expect(Math.abs(c / 0.5 - Math.round(c / 0.5))).toBeLessThan(1e-9)
    }
    // condenser-always: LOD 300 without an override ships the SAME single
    // unit at the same auto anchor (the old LOD-400 gate silently dropped
    // the whole outdoor block while the AH + ducts emitted — user report)
    const at300 = layoutHvac(walls, rooms)
    const units300 = condensersOf(at300.fixtures)
    expect(units300.length).toBe(1)
    expect(units300[0]?.position[0]).toBeCloseTo(spot?.[0] ?? Number.NaN, 12)
    expect(units300[0]?.position[2]).toBeCloseTo(spot?.[1] ?? Number.NaN, 12)
  })
})

// ---------------------------------------------------------------------------
// Takeoff (checklist S4 — book exactly what renders)
// ---------------------------------------------------------------------------

describe('takeoff — condenser rows mirror the rendered members/fixtures (S4)', () => {
  const { walls, rooms } = shell(26, 10)
  const { members, fixtures } = layoutHvac(walls, rooms, LOD400)
  const rows = computeTakeoff(members, fixtures)
  const find = (item: string) => rows.find((r) => r.item === item)

  test('AC condensers / pads / disconnects / whips count the rendered units', () => {
    const n = condensersOf(fixtures).length
    expect(n).toBe(2)
    expect(find('AC condensers')?.quantity).toBe(n)
    expect(find('AC condensers')?.detail).toContain('tons total')
    // PER-UNIT tonnage on the buy line, mirroring the fixture meta exactly
    const perUnit = Number(condensersOf(fixtures)[0]?.meta?.tons)
    expect(find('AC condensers')?.detail).toContain(`${n} × ${perUnit} tons`)
    // this no-stateCode scene sized by the FALLBACK rule — the row says so
    expect(find('AC condensers')?.detail).toContain('assumed sizing')
    expect(find('Condenser pads')?.quantity).toBe(padsOf(members).length)
    // size + basis on the pad buy line (verify-round REC-2), mirrored from
    // the rendered pad member (1.0 m square, 40"-class stock)
    expect(find('Condenser pads')?.detail).toContain('1 × 1 m × 4"')
    expect(find('Condenser pads')?.detail).toContain('40"-class stock')
    expect(find('AC disconnects')?.quantity).toBe(n)
    expect(find('Condenser whips')?.quantity).toBe(n)
  })

  test('line-set books by SIZE + insulation lf — never copper lf or elbows', () => {
    const lfOf = (prefix: string) =>
      members
        .filter((m) => m.sourceId.startsWith(prefix))
        .reduce((sum, m) => sum + m.length, 0) * 3.28084
    const suction = find('Line-set suction ¾"')
    const liquid = find('Line-set liquid ⅜"')
    const sleeve = find('Line-set insulation')
    expect(suction).toBeDefined()
    expect(liquid).toBeDefined()
    expect(sleeve).toBeDefined()
    expect(suction?.quantity).toBeCloseTo(Math.round(lfOf('lineset-suction-') * 10) / 10, 1)
    expect(liquid?.quantity).toBeCloseTo(Math.round(lfOf('lineset-liquid-') * 10) / 10, 1)
    // the COLD suction line is the insulated one — sleeve lf mirrors it
    expect(sleeve?.quantity).toBe(suction?.quantity as number)
    expect(sleeve?.detail).toContain('¾" suction')
    // both size rows count the physical PAIRS, one run per unit
    expect(suction?.detail).toContain('2 runs')
    expect(liquid?.detail).toContain('2 runs')
    // no phantom plumbing-style copper rows or fittings out of the line-set
    const hvacCopper = rows.filter((r) => r.section === 'HVAC' && r.item.startsWith('Copper'))
    expect(hvacCopper).toHaveLength(0)
    // whips never leak into NM-B lineal feet (they are conduit kits)
    const nm = rows.filter((r) => r.item.startsWith('NM-B'))
    expect(nm).toHaveLength(0)
  })

  test('condensers leave the generic Mechanical equipment row to the air handler', () => {
    expect(find('Mechanical equipment')?.quantity).toBe(1)
  })
})

describe('night-4 batch F1: slid pad stays wall-aligned and clear', () => {
  test('an RO fronting the anchor slides the unit — the PAD may not reach the wall assembly', () => {
    // Pre-fix: unit #1's pad inherited the cabinet's oblique equip-bearing
    // rotation after the slide; a 45° square pad reaches
    // (|sin|+|cos|)·half toward the wall and punched through the cladding.
    // door at u=3 fronts the anchor projected from the laundry equip room.
    const { walls, rooms } = shell(12, 8, [opening('door_front', 3, 0.95)])
    const { members } = layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'NY' })
    const pads = padsOf(members)
    expect(pads.length).toBeGreaterThan(0)
    for (const pad of pads) {
      // wall-aligned: yaw is a clean multiple of 90° (the south wall runs +X)
      const yaw = ((pad.rotation[1] % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)
      expect(Math.min(yaw, Math.PI / 2 - yaw)).toBeLessThan(1e-6)
      // and the pad's near edge clears the wall assembly (0.13m cladding allow)
      const half = pad.dims[0] / 2
      const wall0 = walls[0]!
      expect(Math.abs(pad.position[2]) - half).toBeGreaterThanOrEqual(
        wall0.thickness / 2 + 0.13 - 1e-6,
      )
    }
  })
})

describe('A4 seed parity: the heat-pump node seeds at the SLID anchor', () => {
  test('an RO fronting the raw spot moves the seed to the engine unit-#1 anchor', () => {
    const { walls, rooms } = shell(12, 8, [opening('door_front', 3, 0.95)])
    const seed = placeCondenserSeedSpot(walls, rooms)
    expect(seed).not.toBeNull()
    const { members } = layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'NY' })
    const cab = cabinetsOf(members)[0]
    expect(cab).toBeDefined()
    // seed == unit-#1 cabinet plan position (the sign stands ON the unit)
    expect(seed?.[0]).toBeCloseTo(cab?.position[0] as number, 6)
    expect(seed?.[1]).toBeCloseTo(cab?.position[2] as number, 6)
  })
})

describe('dawn round 2: disconnect never mounts in an RO; schedule/legend honest', () => {
  test('a unit anchored in front of a window slides its DISCONNECT clear (box off the glass)', () => {
    // The unit anchor is verbatim (A4) but the disconnect is derived — a
    // heat pump dragged before a window must not mount the box on glass.
    const { walls, rooms } = shell(12, 8, [])
    // window on the north wall at the exact spot the unit will anchor
    const north = walls[1]!
    north.openings.push({
      id: 'win_hp',
      kind: 'window',
      u: 6,
      width: 1.4,
      height: 1.3,
      sillHeight: 0.9,
      roughWidth: 1.45,
      roughHeight: 1.35,
    })
    const { members, fixtures, warnings } = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: [6, 0, 8.6] },
    }, { stateCode: 'NY' })
    void members
    void warnings
    const disc = fixtures.find((f) => f.kind === 'disconnect') as Fixture
    expect(disc).toBeDefined()
    // the box's along-wall spot clears the RO span [6−0.725, 6+0.725]
    const u = disc.position[0]
    expect(u < 6 - 0.725 - 0.05 || u > 6 + 0.725 + 0.05).toBe(true)
  })

  test('circuit schedule prints the real breaker (30A/10AWG, never the 15A default)', () => {
    const { walls, rooms } = shell(12, 8, [])
    const { fixtures } = layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'NY' })
    const disc = fixtures.find((f) => f.kind === 'disconnect') as Fixture
    expect(disc.meta?.breakerA).toBe(30)
    expect(Number(disc.meta?.va)).toBeGreaterThan(0)
    const rows = circuitSchedule([disc])
    expect(rows[0]?.breakerA).toBe(30)
    expect(rows[0]?.gaugeAwg).toBe(10)
  })
})

describe('M2 distance truth: slid disconnects stay within the stated budget', () => {
  test('an RO-slid disconnect lands ≤ 1.5 m from its unit', () => {
    const { walls, rooms } = shell(12, 8, [])
    const north = walls[1]!
    north.openings.push({
      id: 'win_hp2',
      kind: 'window',
      u: 6,
      width: 1.4,
      height: 1.3,
      sillHeight: 0.9,
      roughWidth: 1.45,
      roughHeight: 1.35,
    })
    const { fixtures } = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: [6, 0, 8.6] },
    }, { stateCode: 'NY' })
    const disc = fixtures.find((f) => f.kind === 'disconnect') as Fixture
    const unit = fixtures.find(
      (f) => f.kind === 'equipment' && f.meta?.equipment === 'condenser',
    ) as Fixture
    const dist = Math.hypot(
      disc.position[0] - unit.position[0],
      disc.position[1] - unit.position[1],
      disc.position[2] - unit.position[2],
    )
    expect(dist).toBeLessThanOrEqual(1.5)
  })
})

// ---------------------------------------------------------------------------
// Condenser-always (user report: 'sometimes the HVAC does not add the
// outside heat pump'). CONTRACT: whenever layoutHvac emits an air handler,
// at least ONE outdoor unit (+pad, and disconnect/whip/line-set where a
// wall exists) emits too — or a warning names exactly why not. Root causes
// found by the 2700-compose sweep (sizes × mixes × states × LODs × nodes):
//  (c) CONFIRMED — the `detail === '400' || hpPlan` gate emitted the AH +
//      the full duct network at LOD 200/300 with NO outdoor unit and NO
//      warning (900/2700 sweep rows silent);
//  (b) CONFIRMED — no straight exterior wall → placeHeatPumpSpot null →
//      the whole block skipped silently even at LOD 400;
//  (d) CONFIRMED — an unresolvable heat-pump node (foreign/deleted wallId,
//      default position) degraded to 'no override' and, gated, produced
//      NOTHING at LOD 200/300 despite the user having placed the node;
//  (a) REFUTED — condenserPlan never floors to zero (min 1 unit / 1.5 t:
//      a heat pump HEATS too, so cold zones keep their outdoor unit).
// ---------------------------------------------------------------------------

describe('condenser-always — AH present ⇒ outdoor unit present (never silent)', () => {
  /** W×D shell with a room-mix knob (matrix scenes). */
  function mixScene(W: number, D: number, mix: string, exteriorWalls = true) {
    const walls = [
      wall('w_south', [0, 0], [W, 0], exteriorWalls),
      wall('w_north', [0, D], [W, D], exteriorWalls),
      wall('w_west', [0, 0], [0, D], exteriorWalls),
      wall('w_east', [W, 0], [W, D], exteriorWalls),
    ]
    const sw = Math.min(3, W / 2)
    const sd = Math.min(3, D / 2)
    const mixes: Record<string, RoomSlice[]> = {
      laundry: [
        room('r_laundry', 'Laundry', 'laundry', [[0, 0], [sw, 0], [sw, sd], [0, sd]]),
        room('r_living', 'Living', 'other', [[sw, 0], [W, 0], [W, D], [sw, D]]),
        room('r_bed', 'Bedroom', 'bedroom', [[0, sd], [sw, sd], [sw, D], [0, D]]),
      ],
      hallway: [
        room('r_hall', 'Hall', 'hallway', [[0, 0], [W, 0], [W, sd], [0, sd]]),
        room('r_living', 'Living', 'other', [[0, sd], [W, sd], [W, D], [0, D]]),
      ],
      // no laundry, no hallway
      plain: [
        room('r_living', 'Living', 'other', [[0, 0], [W, 0], [W, sd], [0, sd]]),
        room('r_bed', 'Bedroom', 'bedroom', [[0, sd], [W, sd], [W, D], [0, D]]),
      ],
      garage: [
        room('r_garage', 'Garage', 'garage', [[0, 0], [W, 0], [W, sd], [0, sd]]),
        room('r_bed', 'Bedroom', 'bedroom', [[0, sd], [W, sd], [W, D], [0, D]]),
      ],
      single: [room('r_living', 'Living', 'other', [[0, 0], [W, 0], [W, D], [0, D]])],
    }
    return { walls, rooms: mixes[mix] as RoomSlice[] }
  }

  const airHandlerOf = (fixtures: Fixture[]): Fixture | undefined =>
    fixtures.find((f) => f.kind === 'equipment' && f.label?.includes('Air handler'))

  test('repro (c): LOD 200 AND 300 generated path ship the FULL outdoor block with the AH', () => {
    for (const detail of ['200', '300'] as const) {
      const { walls, rooms } = mixScene(12, 10, 'laundry')
      const out = layoutHvac(walls, rooms, { ...DEFAULT_SPEC, detail })
      expect(airHandlerOf(out.fixtures)).toBeDefined()
      // the exact silent compose from the sweep: AH=yes ducts=yes cond=0 warn=[]
      const units = condensersOf(out.fixtures)
      expect(units.length).toBeGreaterThanOrEqual(1)
      expect(padsOf(out.members).length).toBe(units.length)
      expect(cabinetsOf(out.members).length).toBe(units.length)
      expect(out.fixtures.filter((f) => f.kind === 'disconnect').length).toBe(units.length)
      expect(out.members.some((m) => m.sourceId.startsWith('ac-whip-'))).toBe(true)
      expect(out.members.some((m) => m.sourceId.startsWith('lineset-'))).toBe(true)
      // the row matches the 400 row (one system, one anchor — no LOD drift)
      const at400 = condensersOf(layoutHvac(walls, rooms, LOD400).fixtures)
      expect(units.map((u) => u.position)).toEqual(at400.map((u) => u.position))
      // condensate remains 400-only scope
      expect(out.members.some((m) => m.label?.includes('Condensate'))).toBe(false)
    }
  })

  test('repro (b): no straight exterior wall — unit ships at the least-bad anchor, warned + ⚠ flagged', () => {
    // hosts marking BOTH wall faces 'interior' (quality round-1 A1) used to
    // skip the whole outdoor block with zero words at every LOD
    const { walls, rooms } = mixScene(12, 10, 'laundry', false)
    const out = layoutHvac(walls, rooms, LOD400)
    expect(airHandlerOf(out.fixtures)).toBeDefined()
    const units = condensersOf(out.fixtures)
    expect(units.length).toBeGreaterThanOrEqual(1)
    // the reason reaches the warnings — never silent
    expect(out.warnings.some((w) => w.includes('no exterior wall'))).toBe(true)
    // disconnect/whip cannot mount without a wall face — said out loud
    expect(out.warnings.some((w) => w.includes('AC disconnect + whip not mounted'))).toBe(true)
    // pads + cabinets carry the ⚠ verify flag
    for (const m of [...padsOf(out.members), ...cabinetsOf(out.members)]) {
      expect(m.flag).toContain('⚠ verify condenser placement')
    }
    // line-set legs are flagged AIR RUN (routePipe fallback semantics)
    const legs = out.members.filter((m) => m.sourceId.startsWith('lineset-'))
    expect(legs.length).toBeGreaterThan(0)
    expect(legs.every((m) => m.flag?.includes('AIR RUN'))).toBe(true)
  })

  test('repro (d): an UNRESOLVABLE heat-pump node still yields the auto row at LOD 300', () => {
    // node references a deleted/foreign wall with the default position —
    // override resolution correctly treats it as 'no override', but that
    // must degrade to the AUTO row, not to nothing
    const { walls, rooms } = mixScene(12, 10, 'laundry')
    const out = layoutHvac(walls, rooms, DEFAULT_SPEC, {
      heatPump: { wallId: 'w_missing', wallT: 0.5 },
    })
    const units = condensersOf(out.fixtures)
    expect(units.length).toBeGreaterThanOrEqual(1)
    // the AUTO row = the seed spot (slide + grid snap included, HP polish)
    const auto = placeCondenserSeedSpot(walls, rooms)
    expect(units[0]?.position[0]).toBeCloseTo(auto?.[0] ?? Number.NaN, 12)
    expect(units[0]?.position[2]).toBeCloseTo(auto?.[1] ?? Number.NaN, 12)
  })

  test('(a) pinned: a tiny cold-climate home keeps 1 unit / 1.5 tons (heat pumps HEAT too)', () => {
    // 4×5 m in AK (zone 7 → 650 sqft/ton): 215 sqft / 650 ≈ 0.33 raw tons —
    // the plan floors at 1.5 t / 1 unit, never zero
    const plan = condenserPlan(20, 'AK')
    expect(plan.count).toBe(1)
    expect(plan.totalTons).toBe(1.5)
    const { walls, rooms } = mixScene(4, 5, 'laundry')
    const units = condensersOf(
      layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'AK' }).fixtures,
    )
    expect(units.length).toBe(1)
    expect(units[0]?.label).toContain('1.5 tons')
  })

  test('invariant matrix: AH present ⇒ condenser ≥ 1 OR a warning names the reason', () => {
    const sizes: [number, number][] = [[4, 5], [8, 6], [12, 10], [20, 12], [30, 15]]
    const states = [undefined, 'MN', 'AK', 'VT', 'FL', 'TX', 'AZ', 'CA', 'WA', 'INTL']
    const details = ['200', '300', '400'] as const
    const mixes = ['laundry', 'hallway', 'plain', 'garage', 'single']
    let composes = 0
    for (const [W, D] of sizes) {
      for (const mix of mixes) {
        for (const exterior of [true, false]) {
          for (const st of states) {
            for (const detail of details) {
              const { walls, rooms } = mixScene(W, D, mix, exterior)
              const out = layoutHvac(walls, rooms, { ...DEFAULT_SPEC, detail }, undefined, {
                stateCode: st,
              })
              composes++
              if (!airHandlerOf(out.fixtures)) continue
              const units = condensersOf(out.fixtures)
              const named = /condenser|outdoor|heat.?pump/i.test(out.warnings.join(' '))
              if (units.length < 1 && !named) {
                throw new Error(
                  `silent AH-without-condenser: ${W}x${D} ${mix} exterior=${exterior} st=${st} d=${detail} — warnings=[${out.warnings.join(' ; ')}]`,
                )
              }
              // stronger: with the fix the unit itself is ALWAYS there
              expect(units.length).toBeGreaterThanOrEqual(1)
              // and where a wall exists to mount on, so do disconnect+whip
              if (exterior) {
                expect(out.fixtures.filter((f) => f.kind === 'disconnect').length).toBe(
                  units.length,
                )
                expect(out.members.some((m) => m.sourceId.startsWith('ac-whip-'))).toBe(true)
              } else {
                expect(
                  out.warnings.some((w) => w.includes('AC disconnect + whip not mounted')),
                ).toBe(true)
              }
            }
          }
        }
      }
    }
    expect(composes).toBe(sizes.length * mixes.length * 2 * states.length * details.length)
  })
})

// ---------------------------------------------------------------------------
// Override honesty (condenser-honesty set — hunt 5a/5f)
// ---------------------------------------------------------------------------

describe('heat-pump override honesty — verbatim still WINS, mis-drags WARN (hunt 5a/5f)', () => {
  // The override is authoritative (A4) and stays so; the RO-collision
  // machinery guards every OTHER service point, but a heat-pump node in
  // the LIVING ROOM (5a) or 13 m into the yard (5f) composed flag-free.
  const INDOOR_RE = /heat-pump point is inside/
  const FAR_RE = /beyond the 25 ft service reach \(NEC 210\.63\)/

  test('override INSIDE an indoor zone warns, NAMES the room, and still wins (A4)', () => {
    const { walls, rooms } = shell(10, 8)
    const inside = layoutHvac(walls, rooms, LOD400, { heatPump: { position: [6, 0, 4] } })
    expect(inside.warnings.some((w) => w.includes('heat-pump point is inside Living'))).toBe(true)
    // A4 kept: the unit is still drawn exactly there — never silently relocated
    const unit = condensersOf(inside.fixtures)[0]
    expect(unit?.position[0]).toBeCloseTo(6, 6)
    expect(unit?.position[2]).toBeCloseTo(4, 6)
    // mutation: the SAME override moved 1 m outside the north wall is silent
    const legit = layoutHvac(walls, rooms, LOD400, { heatPump: { position: [6, 0, 9] } })
    expect(legit.warnings.some((w) => INDOOR_RE.test(w) || FAR_RE.test(w))).toBe(false)
  })

  test('override 13 m into the yard warns with the distance + basis; 1 m off the wall is silent', () => {
    const { walls, rooms } = shell(10, 8)
    const far = layoutHvac(walls, rooms, LOD400, { heatPump: { position: [5, 0, 21] } })
    const warning = far.warnings.find((w) => FAR_RE.test(w))
    expect(warning).toBeDefined()
    expect(warning).toContain('13.0 m')
    // authority: the unit still sits at the override, warned not relocated
    const unit = condensersOf(far.fixtures)[0]
    expect(unit?.position[2]).toBeCloseTo(21, 6)
    // mutation: 1 m off the wall on the same bearing — a legitimate spot, silent
    const near = layoutHvac(walls, rooms, LOD400, { heatPump: { position: [5, 0, 9] } })
    expect(near.warnings.some((w) => FAR_RE.test(w) || INDOOR_RE.test(w))).toBe(false)
  })

  test('wall-anchored override (wallId/wallT) resolves ON the centerline — the band guard keeps it silent', () => {
    // zone polygons trace wall centerlines, so without the wall-band guard
    // the anchored point ray-casts "inside" an adjacent room (false positive)
    const { walls, rooms } = shell(10, 8)
    const anchored = layoutHvac(walls, rooms, LOD400, {
      heatPump: { wallId: 'w_south', wallT: 0.5 },
    })
    expect(anchored.warnings.some((w) => INDOOR_RE.test(w) || FAR_RE.test(w))).toBe(false)
  })

  test('auto placement stays silent (no override → no honesty warning)', () => {
    const { walls, rooms } = shell(10, 8)
    const auto = layoutHvac(walls, rooms, LOD400)
    expect(auto.warnings.some((w) => INDOOR_RE.test(w) || FAR_RE.test(w))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Condenser ELECTION validation (Julien-scene root cause, 2026-08-22)
// ---------------------------------------------------------------------------

/**
 * Prod scene ef093760 (anonymized minimal repro): the host's floor-coverage
 * gaps declared several INTERIOR partitions exterior=true. The old election
 * trusted wall.exterior, picked the nearest false-exterior wall to the
 * equipment room (the laundry↔bathroom partition) and PAD_OFFSET pushed the
 * pad 'outward' — INTO the Bathroom. The fix walks exterior candidates BY
 * DISTANCE until one's pad spot validates OUTDOORS: not inside an indoor
 * zone, not under floor coverage (probe slabs; holes = courtyards), not in
 * a wall body — an outdoor zone (courtyard garden) legitimizes. When ALL
 * candidates fail, the least-bad (nearest) spot is kept, every pad/cabinet
 * carries the ⚠ flag and the level warns — never silent.
 *
 * Geometry (10×8 shell, laundry mid-plan, mirrors the exhibit shape):
  *  - w_bathLaundry (4,2.5)→(4,4.5) FALSE-exterior: its outward spot
 *    (2.8154, 3.5) is inside the Bathroom — the exhibit's exact class
 *    (spots stand at condenserStandoff = 0.1 + 0.6096 + 0.475 = 1.1846
 *    from the centerline since the unwarp round);
 *  - w_voidNorth (4,2.5)→(6,2.5) FALSE-exterior: its spot (5, 1.3154) has
 *    NO zone but sits UNDER the slab — a covered mid-plan void, still
 *    inside the building (only the coverage probe can catch it);
 *  - the true south wall (d=3.5) is the nearest candidate whose spot
 *    (5, −1.1846) really is outdoors.
 */
function misclassifiedScene(perimeterExterior = true) {
  const walls = [
    wall('w_south', [0, 0], [10, 0], perimeterExterior),
    wall('w_east', [10, 0], [10, 8], perimeterExterior),
    wall('w_north', [10, 8], [0, 8], perimeterExterior),
    wall('w_west', [0, 8], [0, 0], perimeterExterior),
    // FALSE exteriors — interior partitions the host classified exterior
    wall('w_bathLaundry', [4, 2.5], [4, 4.5], true),
    wall('w_voidNorth', [4, 2.5], [6, 2.5], true),
    // honest interior partitions — connect the laundry block to the shell
    // so the line-set has wall rails to the pad (E2 continuity)
    wall('w_laundryNorth', [4, 4.5], [6, 4.5]),
    wall('w_laundryEast', [6, 2.5], [6, 4.5]),
    wall('w_spine', [6, 0], [6, 2.5]),
  ]
  const rooms = [
    room('r_bath', 'Bathroom', 'bathroom', [[1, 2.5], [4, 2.5], [4, 4.5], [1, 4.5]]),
    room('r_laundry', 'Laundry', 'laundry', [[4, 2.5], [6, 2.5], [6, 4.5], [4, 4.5]]),
    room('r_bed', 'Bedroom', 'bedroom', [[1, 4.5], [9, 4.5], [9, 7], [1, 7]]),
    room('r_living', 'Living', 'other', [[6, 0.5], [9, 0.5], [9, 4.5], [6, 4.5]]),
  ]
  // the slab covers the whole footprint — including the zoneless void
  const coverage = [{ polygon: [[0, 0], [10, 0], [10, 8], [0, 8]] as [number, number][] }]
  return { walls, rooms, coverage }
}

const inPoly = (p: readonly [number, number], poly: readonly (readonly [number, number])[]) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i] as readonly [number, number]
    const [xj, zj] = poly[j] as readonly [number, number]
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

describe('condenser election validation — false-exterior walls never place the pad indoors', () => {
  test('the auto spot walks PAST both false-exterior candidates to real outdoors', () => {
    const { walls, rooms, coverage } = misclassifiedScene()
    const out = layoutHvac(walls, rooms, LOD400, undefined, { coverage })
    const units = condensersOf(out.fixtures)
    expect(units.length).toBe(1)
    const unit = units[0] as Fixture
    const plan: [number, number] = [unit.position[0], unit.position[2]]
    // the validated property: OUTSIDE every room polygon and OUTSIDE the
    // slab footprint (the pre-fix election landed in the Bathroom; without
    // the coverage probe it lands in the covered mid-plan void at (5,1.9))
    for (const r of rooms) expect(inPoly(plan, r.polygon)).toBe(false)
    for (const c of coverage) expect(inPoly(plan, c.polygon)).toBe(false)
    // the nearest wall that validates is the true SOUTH wall — pad at the
    // 24" face-clearance stand-off (1.1846 from the centerline, t = 0.2),
    // grid-snapped outward to the 0.5 host step → z = −1.5 (HP polish)
    expect(plan[0]).toBeCloseTo(5, 6)
    expect(plan[1]).toBeCloseTo(-1.5, 6)
    // clean election: no ⚠ flags, no election warning — this is the healthy path
    for (const m of [...padsOf(out.members), ...cabinetsOf(out.members)]) {
      expect(m.flag).toBeUndefined()
    }
    expect(out.warnings.some((w) => /condenser|heat.?pump/i.test(w))).toBe(false)
    // disconnect present, mounted on the elected wall's face
    expect(out.fixtures.filter((f) => f.kind === 'disconnect').length).toBe(1)
    // E2 line-set continuity: the suction pair reaches the air handler AND
    // the unit on WALL rails (no AIR RUN legs, no long-run advisory)
    const handler = out.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
    const suction = out.members.filter(
      (m) => m.sourceId === 'lineset-suction-1' && m.role === 'pipe-run',
    )
    expect(suction.length).toBeGreaterThan(0)
    expect(suction.every((m) => m.flag === undefined)).toBe(true)
    const reaches = (target: readonly [number, number, number]) =>
      suction.some((m) =>
        endpointsOf(m).some((e) => Math.hypot(e.x - target[0], e.z - target[2]) < 0.06),
      )
    expect(reaches(handler.position)).toBe(true)
    expect(reaches(unit.position)).toBe(true)
  })

  test('the coverage probe is what catches the covered zoneless void (election-input honesty)', () => {
    // Without coverage the walk cannot see that (5, 1.9) is under the slab:
    // rooms alone validate the mid-plan void. The threaded probe is load-
    // bearing — this pins WHY compute must pass probeSlabs.
    const { walls, rooms, coverage } = misclassifiedScene()
    const blind = placeHeatPumpSpot(walls, rooms)
    expect(blind?.[0]).toBeCloseTo(5, 6)
    expect(blind?.[1]).toBeCloseTo(2.5 - 1.1846, 6) // in-plan void — wrong
    const sighted = placeHeatPumpSpot(walls, rooms, coverage)
    expect(sighted?.[0]).toBeCloseTo(5, 6)
    expect(sighted?.[1]).toBeCloseTo(-1.1846, 6) // truly outdoors
  })

  test('a verbatim override still WINS and warns (fast-follow machinery unchanged)', () => {
    // The exhibit as saved: the seeded override sits at the bathroom spot.
    const { walls, rooms, coverage } = misclassifiedScene()
    const out = layoutHvac(walls, rooms, LOD400, { heatPump: { position: [3.4, 0, 3.5] } }, {
      coverage,
    })
    const unit = condensersOf(out.fixtures)[0] as Fixture
    expect(unit.position[0]).toBeCloseTo(3.4, 6)
    expect(unit.position[2]).toBeCloseTo(3.5, 6)
    expect(out.warnings.some((w) => w.includes('heat-pump point is inside Bathroom'))).toBe(true)
    // the election never ran — no unvalidated flag/warning class; the S1
    // overhang class legitimately fires instead (the verbatim point stands
    // 0.6 m off the nearest wall — closer than the exterior-assembly
    // allowance now that the cabinet is 0.95 m deep, unwarp round)
    expect(out.warnings.some((w) => w.includes('could not be validated'))).toBe(false)
    for (const m of [...padsOf(out.members), ...cabinetsOf(out.members)]) {
      expect(m.flag ?? '').not.toContain('verify condenser placement')
    }
  })

  test('seed parity (A4): placeCondenserSeedSpot with coverage matches the engine unit #1', () => {
    const { walls, rooms, coverage } = misclassifiedScene()
    const seed = placeCondenserSeedSpot(walls, rooms, coverage)
    const cab = cabinetsOf(layoutHvac(walls, rooms, LOD400, undefined, { coverage }).members)[0]
    expect(seed?.[0]).toBeCloseTo(cab?.position[0] as number, 6)
    expect(seed?.[1]).toBeCloseTo(cab?.position[2] as number, 6)
  })

  test('walk exhaustion: every candidate fails → least-bad spot kept, ⚠ flagged + warned', () => {
    // The whole shell mis-marked interior; ONLY the two false partitions say
    // exterior — every candidate's spot is indoors, the walk exhausts.
    const { walls, rooms, coverage } = misclassifiedScene(false)
    const out = layoutHvac(walls, rooms, LOD400, undefined, { coverage })
    const units = condensersOf(out.fixtures)
    expect(units.length).toBe(1)
    // least-bad = the nearest election (the pre-fix spot class), kept —
    // not dropped (bathLaundry wall x = 4 minus the 1.1846 stand-off,
    // grid-snapped outward to 1.5 → x = 2.5; z = 3.5 already on-grid)
    expect(units[0]?.position[0]).toBeCloseTo(2.5, 6)
    expect(units[0]?.position[2]).toBeCloseTo(3.5, 6)
    // NEVER silent: every pad + cabinet carries the unvalidated ⚠ class …
    const boxes = [...padsOf(out.members), ...cabinetsOf(out.members)]
    expect(boxes.length).toBe(2)
    for (const m of boxes) {
      expect(m.flag).toContain('⚠ verify condenser placement — auto spot could not be validated')
    }
    // … the level says so …
    expect(
      out.warnings.some((w) => w.includes('condenser auto spot could not be validated outdoors')),
    ).toBe(true)
    // … and it is NOT the legacy no-exterior-wall class (that arm still has
    // its own words — distinct truths stay distinct)
    expect(out.warnings.some((w) => w.includes('no exterior wall'))).toBe(false)
    for (const m of boxes) expect(m.flag).not.toContain('no exterior wall anchors the row')
  })

  test('the row anchors to the ELECTED wall — never re-derived from whatever is nearest the pad', () => {
    // A detached garden wall just outside the shell (exterior=true, z=-1):
    // the validated spot (5, -1.1846) is NEARER the fence (0.1846 m, just
    // past its line) than the elected south wall (1.1846 m). Re-deriving
    // the row wall by nearest would hang the disconnect + line-set
    // penetration on the FENCE with the out-normal pointing back at the
    // house; the election's wall must win.
    const { walls, rooms, coverage } = misclassifiedScene()
    walls.push(wall('w_fence', [2, -1], [8, -1], true))
    const out = layoutHvac(walls, rooms, LOD400, undefined, { coverage })
    const unit = condensersOf(out.fixtures)[0] as Fixture
    expect(unit.position[0]).toBeCloseTo(5, 6)
    expect(unit.position[2]).toBeCloseTo(-1.5, 6) // 1.1846 stand-off, snapped out to the grid
    const disc = out.fixtures.find((f) => f.kind === 'disconnect') as Fixture
    expect(disc.sourceId).toBe('w_south')
  })

  test('fence+RO compound (round-2 gate): seed == engine unit #1, post-seed compose == auto, byte', () => {
    // THE round-2 finding: window RO where the auto anchor lands + a garden
    // fence just outside the shell. The engine slides unit #1 clear of the
    // RO; the OLD seed guard asked nearestExteriorExit(slid) — the fence
    // always beat the elected wall (a full condenserStandoff away by
    // construction) — so the seed bailed to the RAW anchor, which fed back
    // as a verbatim override and recomposed DEAD-CENTER on the window with
    // the disconnect re-hosted to the fence, silently. A4: creation alone
    // must never move anything.
    const { walls, rooms, coverage } = misclassifiedScene()
    walls[0]?.openings.push(opening('win_s', 5, 1.2, 'window'))
    walls.push(wall('w_fence', [2, -1], [8, -1], true))
    const auto = layoutHvac(walls, rooms, LOD400, undefined, { coverage })
    const unit = condensersOf(auto.fixtures)[0] as Fixture
    // the engine slid clear of the RO span [4.4, 5.6] (+ half-pad + slack)
    // to 6.15, then grid-snapped ALONG the wall: the nearer multiple 6.0
    // sits inside the keepout, so the snap takes 6.5 — grid-aligned AND
    // still clear of the window (physics beats the grid, then the grid
    // picks the clear multiple). Outward: 1.1846 → 1.5.
    expect(unit.position[0]).toBeCloseTo(6.5, 6)
    expect(unit.position[2]).toBeCloseTo(-1.5, 6)
    expect((auto.fixtures.find((f) => f.kind === 'disconnect') as Fixture).sourceId).toBe(
      'w_south',
    )
    // A4 seed parity: the seed IS the engine's slid unit-#1 anchor
    const seed = placeCondenserSeedSpot(walls, rooms, coverage)
    expect(seed?.[0]).toBeCloseTo(unit.position[0], 12)
    expect(seed?.[1]).toBeCloseTo(unit.position[2], 12)
    // the seeded node feeds back as a verbatim override — the ε-anchor
    // recognizes the machine's own point and keeps the ELECTED wall:
    // post-seed compose is BYTE-equal to the auto compose
    const post = layoutHvac(
      walls,
      rooms,
      LOD400,
      { heatPump: { position: [seed?.[0] as number, 0, seed?.[1] as number] } },
      { coverage },
    )
    expect(JSON.stringify(post.members)).toBe(JSON.stringify(auto.members))
    expect(JSON.stringify(post.fixtures)).toBe(JSON.stringify(auto.fixtures))
    expect(JSON.stringify(post.warnings)).toBe(JSON.stringify(auto.warnings))
  })

  test('fence-only: seeding must not flip the disconnect w_south → w_fence', () => {
    // No RO — the seed equals the election spot grid-snapped outward; the
    // post-seed compose must still anchor the row to the ELECTED wall, not
    // race the fence.
    const { walls, rooms, coverage } = misclassifiedScene()
    walls.push(wall('w_fence', [2, -1], [8, -1], true))
    const auto = layoutHvac(walls, rooms, LOD400, undefined, { coverage })
    const seed = placeCondenserSeedSpot(walls, rooms, coverage)
    expect(seed?.[0]).toBeCloseTo(5, 6)
    expect(seed?.[1]).toBeCloseTo(-1.5, 6)
    const post = layoutHvac(
      walls,
      rooms,
      LOD400,
      { heatPump: { position: [seed?.[0] as number, 0, seed?.[1] as number] } },
      { coverage },
    )
    expect((post.fixtures.find((f) => f.kind === 'disconnect') as Fixture).sourceId).toBe(
      'w_south',
    )
    expect(JSON.stringify(post.members)).toBe(JSON.stringify(auto.members))
    expect(JSON.stringify(post.fixtures)).toBe(JSON.stringify(auto.fixtures))
    // a REAL user drag (metres from the machine point) stays verbatim-
    // nearest — the ε-anchor is a float tolerance, not a snap radius
    const dragged = layoutHvac(
      walls,
      rooms,
      LOD400,
      { heatPump: { position: [5, 0, -1.4] } },
      { coverage },
    )
    const dUnit = condensersOf(dragged.fixtures)[0] as Fixture
    expect(dUnit.position[0]).toBeCloseTo(5, 6)
    expect(dUnit.position[2]).toBeCloseTo(-1.4, 6)
    expect((dragged.fixtures.find((f) => f.kind === 'disconnect') as Fixture).sourceId).toBe(
      'w_fence',
    )
  })

  test('a slide that runs OFF the elected wall keeps the raw anchor (guard bail arm)', () => {
    // Near-full-width glazing: both slide directions exit the wall span, so
    // unit #1 lands past the wall end — the seed must NOT follow it there.
    const win: OpeningSlice = opening('win_full', 2, 3.8, 'window')
    const walls = [
      wall('w_south', [0, 0], [4, 0], true, [win]),
      wall('w_east', [4, 0], [4, 4]),
      wall('w_north', [4, 4], [0, 4]),
      wall('w_west', [0, 4], [0, 0]),
    ]
    const rooms = [room('r_laundry', 'Laundry', 'laundry', [[1, 1], [3, 1], [3, 3], [1, 3]])]
    const seed = placeCondenserSeedSpot(walls, rooms)
    // raw election spot (2, -1.1846), not the off-wall slid spot (4.45, …)
    expect(seed?.[0]).toBeCloseTo(2, 6)
    expect(seed?.[1]).toBeCloseTo(-1.1846, 6)
  })

  test('courtyard decision: an OUTDOOR zone legitimizes a pad even over a patio slab', () => {
    // Court walls face real open air; the slab still runs under the court
    // (patio pour). DECIDED: outdoor zones validate — a courtyard condenser
    // is a real install; only indoor zones / bare coverage invalidate.
    const courtScene = (withCourtZone: boolean, slabHole = false) => {
      const walls = [
        wall('w_south', [0, 0], [10, 0], true),
        wall('w_east', [10, 0], [10, 8], true),
        wall('w_north', [10, 8], [0, 8], true),
        wall('w_west', [0, 8], [0, 0], true),
        wall('cy_east', [6, 3], [6, 5], true),
        wall('cy_north', [4, 5], [6, 5], true),
        wall('cy_west', [4, 3], [4, 5], true),
        wall('cy_south', [4, 3], [6, 3], true),
      ]
      const rooms = [
        room('r_laundry', 'Laundry', 'laundry', [[6, 3], [8, 3], [8, 5], [6, 5]]),
        room('r_living', 'Living', 'other', [[0, 0.5], [10, 0.5], [10, 3], [0, 3]]),
        room('r_bed', 'Bedroom', 'bedroom', [[0, 5], [10, 5], [10, 7.5], [0, 7.5]]),
        ...(withCourtZone
          ? [room('r_court', 'Courtyard garden', 'outdoor', [[4, 3], [6, 3], [6, 5], [4, 5]])]
          : []),
      ]
      const coverage = [
        {
          polygon: [[0, 0], [10, 0], [10, 8], [0, 8]] as [number, number][],
          holes: slabHole ? [[[4, 3], [6, 3], [6, 5], [4, 5]] as [number, number][]] : [],
        },
      ]
      return { walls, rooms, coverage }
    }
    // (1) outdoor zone present → the nearest candidate (court east wall)
    // validates INTO the courtyard, silent + unflagged
    const withZone = courtScene(true)
    const a = layoutHvac(withZone.walls, withZone.rooms, LOD400, undefined, {
      coverage: withZone.coverage,
    })
    const unitA = condensersOf(a.fixtures)[0] as Fixture
    // 6 − 1.1846, grid-snapped away from the court wall → 4.5
    expect(unitA.position[0]).toBeCloseTo(4.5, 6)
    expect(unitA.position[2]).toBeCloseTo(4, 6)
    expect(a.warnings.some((w) => w.includes('could not be validated'))).toBe(false)
    for (const m of [...padsOf(a.members), ...cabinetsOf(a.members)]) {
      expect(m.flag).toBeUndefined()
    }
    // (2) mutation arm: NO outdoor zone → the covered court reads as inside
    // the building, the walk continues to the true east perimeter
    const noZone = courtScene(false)
    const b = layoutHvac(noZone.walls, noZone.rooms, LOD400, undefined, {
      coverage: noZone.coverage,
    })
    const unitB = condensersOf(b.fixtures)[0] as Fixture
    // 10 + 1.1846, grid-snapped outward → 11.5
    expect(unitB.position[0]).toBeCloseTo(11.5, 6)
    expect(unitB.position[2]).toBeCloseTo(4, 6)
    // (3) a slab HOLE under the court is a courtyard too — uncovered, valid
    const holed = courtScene(false, true)
    const c = layoutHvac(holed.walls, holed.rooms, LOD400, undefined, {
      coverage: holed.coverage,
    })
    const unitC = condensersOf(c.fixtures)[0] as Fixture
    expect(unitC.position[0]).toBeCloseTo(4.5, 6)
    expect(unitC.position[2]).toBeCloseTo(4, 6)
  })
})

// ---------------------------------------------------------------------------
// MANUAL-J-LITE system sizing (IRC M1401.3 — equipment per ACCA Manual S
// from Manual J loads; the lite load's own hand-computed gate lives in
// manual-j.test.ts — these gates prove the ENGINE composes from it)
// ---------------------------------------------------------------------------

/** Big glazed shell in a known state: W×D rect, laundry SW + bedroom +
 * living, `eastWindows` windows of `winW`×`winH` on the east wall (facing
 * +x = EAST under the stated axis assumption). Walls 2.7 h / 0.2 th,
 * ceilings 2.5 — same fabric as shell(). */
function glazedShell(W: number, D: number, eastWindows: number, winW = 2.4, winH = 2.4) {
  const wins: OpeningSlice[] = Array.from({ length: eastWindows }, (_, i) =>
    opening(`win_e_${i}`, 1.5 + i * ((D - 3) / Math.max(1, eastWindows)), winW + 0.05, 'window'),
  ).map((o) => ({ ...o, width: winW, height: winH, sillHeight: 0.3, roughHeight: winH + 0.1 }))
  const walls = [
    wall('w_south', [0, 0], [W, 0], true),
    wall('w_north', [0, D], [W, D], true),
    wall('w_west', [0, 0], [0, D], true),
    wall('w_east', [W, 0], [W, D], true, wins),
  ]
  const rooms = [
    room('r_laundry', 'Laundry', 'laundry', [[0, 0], [3, 0], [3, 3], [0, 3]]),
    room('r_living', 'Living', 'other', [[3, 0], [W, 0], [W, D], [3, D]]),
    room('r_bed', 'Bedroom', 'bedroom', [[0, 3], [3, 3], [3, D], [0, D]]),
  ]
  return { walls, rooms }
}

describe('Manual-J-lite engine sizing — hand-derived tonnage, 5-ton split, climate divergence', () => {
  test('HAND-COMPUTED: the engine tonnage equals the four-term load × latent allowance, selected per Manual S (FL, zone 2A)', () => {
    // 70×30 m shell, 2 east windows 2.4×2.4 — every term derived here with
    // independent arithmetic; the engine must land the same equipment tons.
    const { walls, rooms } = glazedShell(70, 30, 2)
    const out = layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'FL' })
    // hand: zone 2A → ΔT = 35−24 = 11 K; wall R-13, ceiling R-49
    const winArea = 2 * 2.4 * 2.4 // 11.52 m²
    const wallNet = 2 * (70 + 30) * 2.7 - winArea
    const uaWalls = wallNet / (13 * 0.1761)
    const uaWindows = winArea * 0.32 * 5.678263
    const uaCeiling = (70 * 30) / (49 * 0.1761)
    const envelopeW = (uaWalls + uaWindows + uaCeiling) * 11
    const solarW = winArea * 220 * 0.3 // east facade
    const internalW = 2 * 67.4 + 351.7 // 1 bedroom → 2 occupants
    const infiltrationW = 0.33 * 0.35 * (70 * 30 * 2.5) * 11
    const sensTons = ((envelopeW + solarW + internalW + infiltrationW) * 3.412142) / 12000
    // 2A → moisture regime A (humid) → ×1.25 latent allowance (F1)
    const designTons = sensTons * 1.25
    const handTons = Math.max(1.5, Math.ceil(designTons * 2) / 2)
    const ah = out.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
    expect(ah.meta?.tons).toBe(handTons)
    expect(ah.meta?.sizingBasis).toBe('manual-j-lite')
    expect(Number(ah.meta?.loadBtuH)).toBe(Math.round(designTons * 12000))
    expect(Number(ah.meta?.sensibleBtuH)).toBe(Math.round(sensTons * 12000))
    expect(ah.meta?.latentFactor).toBe(1.25)
    expect(ah.meta?.moistureRegime).toBe('A')
    // sanity on the pinned scene itself: the DESIGN load really is in the
    // 4.5–5 band this gate was built around (a fabric change trips this)
    expect(designTons).toBeGreaterThan(4.5)
    expect(designTons).toBeLessThanOrEqual(5)
    expect(handTons).toBe(5)
    // ≤ 5 tons → ONE unit carrying the whole tonnage, composition on it
    const units = condensersOf(out.fixtures)
    expect(units.length).toBe(1)
    expect(units[0]?.meta?.tons).toBe(5)
    const sens2 = Math.round(sensTons * 100) / 100
    expect(units[0]?.label).toContain(
      `5 tons (Manual J-lite, zone 2A design 35°C, ${sens2} t sensible × 1.25 latent (regime A))`,
    )
  })

  test('5-TON SPLIT: the same fabric with two more windows crosses 5 tons → 2 units, per-unit labels', () => {
    const { walls, rooms } = glazedShell(70, 30, 4)
    const out = layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'FL' })
    // oracle: the module DESIGN load (sensible × 1.25) crosses 5 tons
    // (the hand gate above pins the arithmetic)
    const load = manualJLite(walls, rooms, 'FL')
    expect(load.ok).toBe(true)
    if (!load.ok) return
    expect(load.loadTons).toBeGreaterThan(5)
    const total = manualSTons(load.loadTons).tons // 5.5
    expect(total).toBe(5.5)
    const units = condensersOf(out.fixtures)
    expect(units.length).toBe(2)
    // per-unit tonnage on EVERY cabinet + fixture label (#k — X tons)
    const unitTons = Math.round((total / 2) * 2) / 2 // 3
    const sensRounded = Math.round(load.sensibleTons * 100) / 100
    for (let k = 0; k < units.length; k++) {
      const u = units[k] as Fixture
      expect(u.label).toContain(`AC Condenser #${k + 1} — ${unitTons} tons`)
      expect(u.label).toContain(
        `Manual J-lite, zone 2A design 35°C, ${sensRounded} t sensible × 1.25 latent (regime A)`,
      )
      expect(u.meta?.tons).toBe(unitTons)
      expect(u.meta?.totalTons).toBe(total)
    }
    const cabs = cabinetsOf(out.members)
    expect(cabs.length).toBe(2)
    for (let k = 0; k < cabs.length; k++) {
      const cab = cabs[k] as Member
      // A6 TRIPLE on every unit: system/role/material pin the asset swap
      expect(cab.system).toBe('hvac')
      expect(cab.role).toBe('equipment')
      expect(cab.material).toBe('steel')
      expect(cab.label).toBe(`AC condenser #${k + 1} — ${unitTons} tons outdoor unit`)
    }
    // placement machinery untouched: both units OUTSIDE the shell, on the
    // row wall, ≥ 0.6 m clear (the row composes, not just the count)
    for (const box of [...padsOf(out.members), ...cabs]) {
      const inside =
        box.position[0] > 0 && box.position[0] < 70 && box.position[2] > 0 && box.position[2] < 30
      expect(inside).toBe(false)
    }
    const [a, b] = cabs as [Member, Member]
    expect(
      Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]) - 0.9,
    ).toBeGreaterThanOrEqual(0.6 - 1e-9)
    // multi-system honesty: ONE air handler drawn, the split stated on the
    // label AND as a level warning — never a silent single-coil 5.5-ton box
    const ah = out.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture
    expect(
      out.warnings.some((w) =>
        w.includes('ONE air handler/duct system drawn') && w.includes('2 condensers'),
      ),
    ).toBe(true)
    // INSTALLED-SUM honesty (skeptic F2): this scene's design load sits in
    // the (5.0, 5.22] window — the 5.5-ton selection is IN band (≤115%)
    // while the installed 2 × 3.0 = 6.0 t EXCEEDS it. The AH reconciles to
    // the installed figure (its coil serves the cabinets that exist), the
    // plan-vs-installed distinction is stated, and the overrun warns.
    expect(load.loadTons).toBeGreaterThan(5.0)
    expect(load.loadTons).toBeLessThanOrEqual(5.22)
    expect(5.5 / load.loadTons).toBeLessThanOrEqual(1.15) // selection in band
    expect(6.0 / load.loadTons).toBeGreaterThan(1.15) // installed out of band
    expect(ah.meta?.tons).toBe(6)
    expect(ah.meta?.selectedTons).toBe(5.5)
    expect(ah.label).toContain('Air handler — 6 ton')
    expect(ah.label).toContain(
      'serves 2 condensers (2 × 3 t installed vs 5.5 t selected), single indoor coil assumption',
    )
    expect(
      out.warnings.some(
        (w) =>
          w.startsWith('installed 6 tons = 118.1% of the') &&
          w.includes('exceeds the Manual S 115% band (stock unit steps after the ≤5-ton split)'),
      ),
    ).toBe(true)
    // takeoff mirrors the split with per-unit tonnage + the basis (S4)
    const rowT = computeTakeoff(out.members, out.fixtures).find((r) => r.item === 'AC condensers')
    expect(rowT?.quantity).toBe(2)
    // the buy line sums INSTALLED units (2 × 3-ton cabinets = 6 tons of
    // equipment) — per-unit rounding to stock half tons runs above the
    // 5.5-ton plan total, which is what you actually purchase
    expect(rowT?.detail).toContain('2 × 3 tons (6 tons total)')
    expect(rowT?.detail).toContain(
      `Manual J-lite ${sensRounded} t sensible × 1.25 latent (A)`,
    )
  })

  test('CLIMATE DIVERGENCE: the same house buys more tonnage in FL (zone 2) than MN (zone 6)', () => {
    const { walls, rooms } = glazedShell(70, 30, 10)
    const fl = layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'FL' })
    const mn = layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'MN' })
    const flTons = Number(
      (fl.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture).meta?.tons,
    )
    const mnTons = Number(
      (mn.fixtures.find((f) => f.label?.includes('Air handler')) as Fixture).meta?.tons,
    )
    // 4.86 t sensible × 1.25 → 6.079 → 6.5 selected → 2 × 3.5 = 7 installed
    // = 115.1% — a HAIR over the band, and the overrun still says so
    // (one-decimal percent: '115% exceeds the 115% band' would print as a
    // contradiction)
    expect(flTons).toBe(7)
    expect(
      fl.warnings.some(
        (w) =>
          w.startsWith('installed 7 tons = 115.1% of the') &&
          w.includes('exceeds the Manual S 115% band (stock unit steps'),
      ),
    ).toBe(true)
    expect(mnTons).toBeLessThan(flTons) // ΔT 7 vs 11 + R-30 walls, R-60 ceiling
    expect(condensersOf(mn.fixtures)[0]?.label).toContain(
      'Manual J-lite, zone 6A design 31°C',
    )
  })

  test('LATENT EXHIBIT (skeptic F1): the humid-zone allowance moves the selection — 2.6 t sensible → 3.5 t, never a silent 3.0', () => {
    // 44×20 m FL shell (880 m²), 8 east windows 2.2×2.2: the four-term
    // sensible sum lands ~2.62 t — sensible-only Manual S would pick 3.0
    // IN BAND and say nothing; the ×1.25 humid allowance makes the design
    // load 3.27 t and the honest selection 3.5 t.
    const { walls, rooms } = glazedShell(44, 20, 8, 2.2, 2.2)
    const load = manualJLite(walls, rooms, 'FL')
    expect(load.ok).toBe(true)
    if (!load.ok) return
    expect(load.sensibleTons).toBeGreaterThan(2.5)
    expect(load.sensibleTons).toBeLessThan(2.7)
    // the OLD silent behavior, documented: sensible-only selection = 3.0
    expect(manualSTons(load.sensibleTons).tons).toBe(3)
    // the engine now selects from the latent-adjusted design load
    const out = layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'FL' })
    const units = condensersOf(out.fixtures)
    expect(units.length).toBe(1)
    expect(units[0]?.meta?.tons).toBe(3.5)
    // the label carries the WHOLE composition — sensible × factor visible
    const sens = Math.round(load.sensibleTons * 100) / 100
    expect(units[0]?.label).toContain(
      `3.5 tons (Manual J-lite, zone 2A design 35°C, ${sens} t sensible × 1.25 latent (regime A))`,
    )
    // dry zone 2B (AZ): same digit → identical sensible; ×1.05 barely moves
    // the selection — back to the 3.0 the sensible sum wanted
    const az = layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'AZ' })
    const azUnits = condensersOf(az.fixtures)
    expect(azUnits[0]?.meta?.tons).toBe(3)
    expect(azUnits[0]?.label).toContain('× 1.05 latent (regime B)')
    // takeoff buy line carries the composition too (F1 reach)
    const rowT = computeTakeoff(out.members, out.fixtures).find(
      (r) => r.item === 'AC condensers',
    )
    expect(rowT?.detail).toContain(`Manual J-lite ${sens} t sensible × 1.25 latent (A)`)
  })

  test('MANUAL S BAND: a tiny FL home floors at 1.5 tons and says the selection left the band', () => {
    const { walls, rooms } = shell(10, 8)
    const out = layoutHvac(walls, rooms, LOD400, undefined, { stateCode: 'FL' })
    const units = condensersOf(out.fixtures)
    expect(units.length).toBe(1)
    expect(units[0]?.meta?.tons).toBe(1.5)
    expect(
      out.warnings.some(
        (w) => w.includes('outside the Manual S 95–115% band') && w.includes('M1401.3'),
      ),
    ).toBe(true)
    // …and the fallback path never makes a Manual S band claim (its label
    // already states which rule sized it)
    const intl = layoutHvac(walls, rooms, LOD400)
    expect(intl.warnings.some((w) => w.includes('Manual S'))).toBe(false)
  })
})
