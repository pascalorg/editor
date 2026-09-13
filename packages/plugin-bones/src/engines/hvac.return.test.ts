import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Fixture, Member, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { toFeet } from '../core/units'
import { pointInPolygon } from './electrical'
import { DUCT_JUNCTION_BURY, equipmentRoomOf, layoutHvac, placeReturnGrilleSpot } from './hvac'
import { computeTakeoff } from './takeoff'

/**
 * B19 (a)+(c) gates — equipment placement + return-air truth (checklist M3).
 *
 * (a) BLOCKER: the air handler + the OPEN central return grille used to land
 *     inside the garage silently (old preference: laundry > garage > …) —
 *     IRC M1602.2(1) forbids taking return air from a garage and R302.5.2
 *     restricts garage duct penetrations. Now: conditioned service space
 *     wins; a garage-mounted AH is last-resort + LOUD; the grille never
 *     follows it there.
 * (c) The return-air path used to be MAGIC: supply fully modeled, zero
 *     return-side duct members. Now: a return trunk (grille → air handler,
 *     supply-trunk schematic sizing) + transfer-path assumption labels on
 *     closable rooms' supply registers (no invented jumper-duct geometry).
 */

const GARAGE_WARNING =
  'air handler in garage — M1602.2(1) forbids garage return air; provide a sealed return + R302.5.2 duct protection — verify'

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  exterior = true,
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
    thickness: 0.114,
    height: 2.5,
    exterior,
    openings,
    curved: false,
  }
}

function door(id: string, u: number): OpeningSlice {
  return {
    id,
    kind: 'door',
    u,
    width: 0.9,
    height: 2.1,
    sillHeight: 0,
    roughWidth: 0.95,
    roughHeight: 2.15,
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

/** 14×8 shell: garage in the WEST bay, two habitable rooms east of it. The
 * middle column [4..6] is swappable — utility / hallway / nothing — so ONE
 * plan composes all three placement scenarios. */
function plan(middle: 'utility' | 'hallway' | 'none') {
  const walls = [
    wall('w_s', [0, 0], [14, 0]),
    wall('w_e', [14, 0], [14, 8]),
    wall('w_n', [14, 8], [0, 8]),
    wall('w_w', [0, 8], [0, 0]),
    wall('w_garage', [4, 0], [4, 8], false),
    wall('w_mid', [6, 0], [6, 8], false),
    wall('w_split', [6, 4], [14, 4], false),
  ]
  const garage = room('r_garage', 'Garage', 'garage', [
    [0, 0],
    [4, 0],
    [4, 8],
    [0, 8],
  ])
  const rooms = [
    garage,
    room('r_living', 'Living', 'other', [
      [6, 0],
      [14, 0],
      [14, 4],
      [6, 4],
    ]),
    room('r_bed', 'Bedroom', 'bedroom', [
      [6, 4],
      [14, 4],
      [14, 8],
      [6, 8],
    ]),
  ]
  if (middle === 'utility') {
    rooms.push(room('r_util', 'Utility', 'laundry', [[4, 0], [6, 0], [6, 8], [4, 8]]))
  } else if (middle === 'hallway') {
    rooms.push(room('r_hall', 'Hallway', 'hallway', [[4, 0], [6, 0], [6, 8], [4, 8]]))
  }
  return { walls, rooms, garage }
}

const byKind = (fixtures: Fixture[], kind: string) => fixtures.filter((f) => f.kind === kind)
const airHandler = (fixtures: Fixture[]) =>
  fixtures.find((f) => f.kind === 'equipment' && f.label?.includes('Air handler')) as Fixture
const returnDucts = (members: Member[]) =>
  members.filter((m) => m.role === 'duct-run' && m.label?.startsWith('Return'))

// ---- return-network continuity (E2-style union-find, plates-harness math) ---

function ductEndpoints(m: Member): [[number, number, number], [number, number, number]] {
  const vertical = m.dims[1] > m.dims[0]
  if (vertical) {
    return [
      [m.position[0], m.position[1] - m.dims[1] / 2, m.position[2]],
      [m.position[0], m.position[1] + m.dims[1] / 2, m.position[2]],
    ]
  }
  const yaw = m.rotation[1]
  const half = m.dims[0] / 2
  const ax = Math.cos(yaw) * half
  const az = -Math.sin(yaw) * half
  return [
    [m.position[0] - ax, m.position[1], m.position[2] - az],
    [m.position[0] + ax, m.position[1], m.position[2] + az],
  ]
}

function segDist(p: readonly number[], m: Member): number {
  const [a, b] = ductEndpoints(m)
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len2 = (ab[0] as number) ** 2 + (ab[1] as number) ** 2 + (ab[2] as number) ** 2
  const t = Math.max(
    0,
    Math.min(
      1,
      (((p[0] as number) - a[0]) * (ab[0] as number) +
        ((p[1] as number) - a[1]) * (ab[1] as number) +
        ((p[2] as number) - a[2]) * (ab[2] as number)) /
        Math.max(1e-9, len2),
    ),
  )
  return Math.hypot(
    (p[0] as number) - (a[0] + (ab[0] as number) * t),
    (p[1] as number) - (a[1] + (ab[1] as number) * t),
    (p[2] as number) - (a[2] + (ab[2] as number) * t),
  )
}

/** True when the RETURN duct network is one connected chain that reaches
 * both the grille fixture and the air handler. */
function returnReachesAh(members: Member[], fixtures: Fixture[]): boolean {
  const ducts = returnDucts(members)
  if (ducts.length === 0) return false
  const grille = byKind(fixtures, 'return')[0]
  const ah = airHandler(fixtures)
  if (!grille || !ah) return false
  const parent = ducts.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r] as number
    return r
  }
  for (let i = 0; i < ducts.length; i++) {
    for (let j = i + 1; j < ducts.length; j++) {
      const [a1, a2] = ductEndpoints(ducts[i] as Member)
      const touch =
        segDist(a1, ducts[j] as Member) < 0.2 ||
        segDist(a2, ducts[j] as Member) < 0.2 ||
        ductEndpoints(ducts[j] as Member).some((e) => segDist(e, ducts[i] as Member) < 0.2)
      if (touch) parent[find(i)] = find(j)
    }
  }
  const compsNear = (p: readonly [number, number, number], tol: number): Set<number> => {
    const comps = new Set<number>()
    for (let i = 0; i < ducts.length; i++) {
      if (segDist(p, ducts[i] as Member) < tol) comps.add(find(i))
    }
    return comps
  }
  // The grille hangs at the riser foot (tight); the drop lands
  // RETURN_DROP_OFFSET (0.5 m) from the AH centroid by design.
  const grilleComps = compsNear(grille.position, 0.1)
  const ahComps = compsNear(ah.position, 0.6)
  return [...grilleComps].some((c) => ahComps.has(c))
}

// ---- duct-vs-duct SAT (round-1 BLOCKER: return tin inside supply tin) --------
// All hvac ducts are axis-aligned (Manhattan yaws) — exact AABBs, no sampling.

function ductAabb(m: Member): { min: [number, number, number]; max: [number, number, number] } {
  const vertical = m.dims[1] > m.dims[0]
  const yaw = m.rotation[1]
  const c = Math.abs(Math.cos(yaw))
  const s = Math.abs(Math.sin(yaw))
  const ex = vertical ? m.dims[0] / 2 : (c * m.dims[0] + s * m.dims[2]) / 2
  const ey = m.dims[1] / 2
  const ez = vertical ? m.dims[2] / 2 : (s * m.dims[0] + c * m.dims[2]) / 2
  return {
    min: [m.position[0] - ex, m.position[1] - ey, m.position[2] - ez],
    max: [m.position[0] + ex, m.position[1] + ey, m.position[2] + ez],
  }
}

/** (return, supply) duct pairs whose boxes share volume — empty = gate holds. */
function returnSupplyOverlaps(members: Member[]): string[] {
  const ducts = members.filter((m) => m.role === 'duct-run')
  const ret = ducts.filter((m) => m.label?.startsWith('Return'))
  const supply = ducts.filter((m) => !m.label?.startsWith('Return'))
  const EPS = 1e-6
  const out: string[] = []
  for (const r of ret) {
    const a = ductAabb(r)
    for (const s of supply) {
      const b = ductAabb(s)
      const overlaps = [0, 1, 2].every(
        (i) => (a.min[i] as number) < (b.max[i] as number) - EPS && (b.min[i] as number) < (a.max[i] as number) - EPS,
      )
      if (overlaps) out.push(`${r.label} × ${s.label}`)
    }
  }
  return out
}

describe('B19 round 2 — the return path NEVER shares tin with the supply system', () => {
  test('zero return×supply OBB overlaps in every scenario, attic AND soffit', () => {
    for (const middle of ['utility', 'hallway', 'none'] as const) {
      const { walls, rooms } = plan(middle)
      for (const ctx of [undefined, { hasLevelAbove: true }]) {
        const { members, warnings } = layoutHvac(walls, rooms, DEFAULT_SPEC, undefined, ctx)
        expect(returnSupplyOverlaps(members)).toEqual([])
        // …and none of these plans needs a routing compromise
        expect(warnings.some((w) => w.includes('return drop cannot clear'))).toBe(false)
        expect(warnings.some((w) => w.includes('return grille cannot fully clear'))).toBe(false)
      }
    }
  })

  test('the return plane rides one section height + gap off the supply plane', () => {
    const { walls, rooms } = plan('hallway')
    const planeOffset = 0.2032 + 0.05 // TRUNK_H + DUCT_CLEAR_GAP
    const attic = layoutHvac(walls, rooms)
    const legs = attic.members.filter(
      (m) => m.label?.startsWith('Return trunk') && m.dims[0] >= m.dims[1],
    )
    expect(legs.length).toBeGreaterThan(0)
    for (const m of legs) expect(m.position[1]).toBeCloseTo(2.5 + 0.3 + planeOffset, 6)
    const soffit = layoutHvac(walls, rooms, DEFAULT_SPEC, undefined, { hasLevelAbove: true })
    const soffitLegs = soffit.members.filter(
      (m) => m.label?.startsWith('Return trunk') && m.dims[0] >= m.dims[1],
    )
    expect(soffitLegs.length).toBeGreaterThan(0)
    for (const m of soffitLegs) {
      expect(m.position[1]).toBeCloseTo(2.5 - 0.35 - planeOffset, 6)
    }
  })
})

describe('B19 round 3 — soffit legs never hang in a doorway (unflagged)', () => {
  const DOOR_FLAG = (kind: string) =>
    `${kind} duct crosses a doorway — verify routing (soffit/floor-web coordination)`

  /** The confirmed compose verbatim: 8×6 interior storey, hall/laundry
   * split by interior wall m at x=4 with a door at u=2.5 (RO z≈2.03–2.98,
   * head 2.17) — the round-3 return leg crossed at z=2.50, dead center of
   * the doorway, half a meter below the head, unflagged. */
  function doorwayPlan(doorOverrides: Partial<OpeningSlice> = {}) {
    const d: OpeningSlice = {
      id: 'd_m',
      kind: 'door',
      u: 2.5,
      width: 0.9,
      height: 2.1,
      sillHeight: 0,
      roughWidth: 0.95,
      roughHeight: 2.17,
      ...doorOverrides,
    }
    const walls = [
      wall('w_s', [0, 0], [8, 0]),
      wall('w_e', [8, 0], [8, 6]),
      wall('w_n', [8, 6], [0, 6]),
      wall('w_w', [0, 6], [0, 0]),
      wall('w_m', [4, 0], [4, 6], false, [d]),
    ]
    const rooms = [
      room('r_hall', 'Hallway', 'hallway', [
        [0, 0],
        [4, 0],
        [4, 6],
        [0, 6],
      ]),
      room('r_laundry', 'Laundry', 'laundry', [
        [4, 0],
        [8, 0],
        [8, 6],
        [4, 6],
      ]),
    ]
    return { walls, rooms, ro: { lo: d.u - d.roughWidth / 2, hi: d.u + d.roughWidth / 2 } }
  }

  test('the confirmed compose: the return crossing slides to a SOLID segment', () => {
    const { walls, rooms, ro } = doorwayPlan()
    const { members, fixtures } = layoutHvac(walls, rooms, DEFAULT_SPEC, undefined, {
      hasLevelAbove: true,
    })
    const legs = returnDucts(members).filter(
      (m) => m.label?.startsWith('Return trunk') && m.dims[0] >= m.dims[1],
    )
    expect(legs.length).toBeGreaterThan(0)
    // no return member hangs in the doorway…
    for (const m of returnDucts(members)) expect(m.flag).toBeUndefined()
    // …because every leg crossing wall m (x=4) does so OUTSIDE the RO span
    const pad = 0.3556 / 2 // TRUNK_W / 2 along the crossed wall
    for (const m of legs) {
      const yaw = m.rotation[1]
      const dx = (Math.cos(yaw) * m.dims[0]) / 2
      const x0 = m.position[0] - Math.abs(dx)
      const x1 = m.position[0] + Math.abs(dx)
      if (x0 < 4 && x1 > 4) {
        const z = m.position[2]
        expect(z < ro.lo - pad || z > ro.hi + pad).toBe(true)
      }
    }
    // the return still reaches the AH and shares no tin with the supply
    expect(returnReachesAh(members, fixtures)).toBe(true)
    expect(returnSupplyOverlaps(members)).toEqual([])
    // the SUPPLY soffit path (axis fixed by the registers) crosses the
    // doorway at z=3.0 inside the padded span — it must say so
    const supplyFlagged = members.filter((m) => m.flag === DOOR_FLAG('supply'))
    expect(supplyFlagged.length).toBeGreaterThan(0)
    expect(supplyFlagged.some((m) => m.label?.startsWith('Trunk feed'))).toBe(true)
  })

  test('no solid segment on the wall: the crossing leg FLAGS, never silent', () => {
    // the door spans nearly the whole wall — every reachable crossing is in-RO
    const { walls, rooms } = doorwayPlan({ u: 3, width: 5.3, roughWidth: 5.5 })
    const { members, fixtures } = layoutHvac(walls, rooms, DEFAULT_SPEC, undefined, {
      hasLevelAbove: true,
    })
    const flagged = returnDucts(members).filter((m) => m.flag === DOOR_FLAG('return'))
    expect(flagged.length).toBeGreaterThan(0)
    // honesty over silence: the geometry stays drawn + continuous
    expect(returnReachesAh(members, fixtures)).toBe(true)
  })

  test('attic mode is immune — same plan, no level above, no doorway flags', () => {
    const { walls, rooms } = doorwayPlan()
    const { members } = layoutHvac(walls, rooms)
    expect(members.some((m) => m.flag?.includes('crosses a doorway'))).toBe(false)
  })
})

describe('B19 round 2 — compromised placements are LOUD, never silent', () => {
  /** 0.8×0.8 mech closet hugged by its own four walls: no drop candidate
   * and no grille spot can clear — both fallbacks must ⚠ (round-1 findings
   * 2+3: blind dropCands[0] + the verbatim-base grille landed silently). */
  function closetPlan() {
    const walls = [
      wall('w_s', [0, 0], [10, 0]),
      wall('w_e', [10, 0], [10, 10]),
      wall('w_n', [10, 10], [0, 10]),
      wall('w_w', [0, 10], [0, 0]),
      wall('c_s', [4, 4], [4.8, 4], false),
      wall('c_e', [4.8, 4], [4.8, 4.8], false),
      wall('c_n', [4.8, 4.8], [4, 4.8], false),
      wall('c_w', [4, 4.8], [4, 4], false),
    ]
    const rooms = [
      room('r_closet', 'Mech closet', 'other', [
        [4, 4],
        [4.8, 4],
        [4.8, 4.8],
        [4, 4.8],
      ]),
      room('r_living', 'Living', 'other', [
        [0, 0],
        [10, 0],
        [10, 4],
        [0, 4],
      ]),
      room('r_bed', 'Bedroom', 'bedroom', [
        [0, 4.8],
        [10, 4.8],
        [10, 10],
        [0, 10],
      ]),
    ]
    return { walls, rooms }
  }

  test('tiny equip closet: the return drop flags its wall intrusion, never silent', () => {
    const { walls, rooms } = closetPlan()
    expect(equipmentRoomOf(rooms).id).toBe('r_closet')
    const { warnings } = layoutHvac(walls, rooms)
    expect(
      warnings.some((w) => w.startsWith('return drop cannot clear walls in Mech closet')),
    ).toBe(true)
  })

  test('tiny grille room: the compromised grille spot reports clear:false + flags', () => {
    const { walls, rooms } = closetPlan()
    const spot = placeReturnGrilleSpot(walls, rooms)
    expect(spot?.clear).toBe(false)
    const { warnings } = layoutHvac(walls, rooms)
    expect(
      warnings.some((w) =>
        w.startsWith('return grille cannot fully clear the supply ducts in Mech closet'),
      ),
    ).toBe(true)
  })
})

// ---- (a) equipment placement truth ------------------------------------------

describe('B19a — the air handler prefers conditioned space over the garage', () => {
  test('utility room present: AH lands there, not in the garage, no warning', () => {
    const { walls, rooms } = plan('utility')
    expect(equipmentRoomOf(rooms).id).toBe('r_util')
    const { fixtures, warnings } = layoutHvac(walls, rooms)
    expect(airHandler(fixtures).sourceId).toBe('r_util')
    expect(warnings).not.toContain(GARAGE_WARNING)
  })

  test('no laundry but a hallway: AH lands in the hallway (the OLD order parked it in the garage)', () => {
    const { walls, rooms } = plan('hallway')
    expect(equipmentRoomOf(rooms).id).toBe('r_hall')
    const { fixtures, warnings } = layoutHvac(walls, rooms)
    expect(airHandler(fixtures).sourceId).toBe('r_hall')
    expect(warnings).not.toContain(GARAGE_WARNING)
  })

  test("a closet-named 'other' room reads as service space", () => {
    const { walls, rooms } = plan('none')
    const closet = room('r_closet', 'Mech closet', 'other', [
      [6, 3.4],
      [7.2, 3.4],
      [7.2, 4],
      [6, 4],
    ])
    const withCloset = [...rooms, closet]
    expect(equipmentRoomOf(withCloset).id).toBe('r_closet')
    expect(airHandler(layoutHvac(walls, withCloset).fixtures).sourceId).toBe('r_closet')
  })

  test('garage-only candidate: AH stays in the garage + the LOUD M1602.2(1) warning fires', () => {
    const { walls, rooms, garage } = plan('none')
    expect(equipmentRoomOf(rooms).id).toBe('r_garage')
    const { fixtures, warnings } = layoutHvac(walls, rooms)
    const ah = airHandler(fixtures)
    expect(ah.sourceId).toBe('r_garage')
    expect(pointInPolygon([ah.position[0], ah.position[2]], garage.polygon)).toBe(true)
    expect(warnings).toContain(GARAGE_WARNING)
  })

  test('the OPEN return grille never lands in the garage — even with a garage AH', () => {
    const { walls, rooms, garage } = plan('none')
    const { fixtures } = layoutHvac(walls, rooms)
    const grille = byKind(fixtures, 'return')[0] as Fixture
    expect(grille.sourceId).not.toBe('r_garage')
    expect(pointInPolygon([grille.position[0], grille.position[2]], garage.polygon)).toBe(false)
    // placeReturnGrilleSpot agrees (it feeds the thermostat target too)
    const spot = placeReturnGrilleSpot(walls, rooms)
    expect(spot?.room.category).not.toBe('garage')
  })

  test('conditioned scenes never warn (top-storey plan stays warning-free)', () => {
    const { walls, rooms } = plan('utility')
    expect(layoutHvac(walls, rooms).warnings).toEqual([])
  })
})

// ---- (c) return-air path ----------------------------------------------------

describe('B19c — a RETURN trunk connects the central grille to the air handler', () => {
  test('return members exist, labeled Return, full supply-trunk section', () => {
    const { walls, rooms } = plan('hallway')
    const { members } = layoutHvac(walls, rooms)
    const ret = returnDucts(members)
    expect(ret.length).toBeGreaterThanOrEqual(2) // riser + (legs) + drop
    expect(ret.some((m) => m.label?.includes('Return riser'))).toBe(true)
    expect(ret.some((m) => m.label?.includes('Return drop'))).toBe(true)
    for (const m of ret) {
      expect(m.material).toBe('duct')
      expect(m.sourceId).toBe('return-trunk')
      // schematic sizing mirror: the full 14×8 supply-trunk section
      if (m.dims[0] >= m.dims[1]) {
        // horizontal: dims = [len, H, W]
        expect(m.dims[1]).toBeCloseTo(8 * 0.0254, 6)
        expect(m.dims[2]).toBeCloseTo(14 * 0.0254, 6)
      } else {
        // vertical riser/drop: dims = [w, len, h] with the NARROW 8" side
        // first so dims[1] > dims[0] verticality holds on short risers.
        // Verticals are the return-side PLENUM class (day-9 z-fight): they
        // ride 2×BURY fatter than the legs entering them so the matched
        // 14×8 side planes never coincide (hvac.junctions.test.ts sweep).
        expect(m.dims[0]).toBeCloseTo(8 * 0.0254 + 2 * DUCT_JUNCTION_BURY, 6)
        expect(m.dims[2]).toBeCloseTo(14 * 0.0254 + 2 * DUCT_JUNCTION_BURY, 6)
      }
    }
    // the trunk leg carries the WHOLE system cfm — label honesty
    const ah = airHandler(layoutHvac(walls, rooms).fixtures)
    const cfm = Number(ah.meta?.cfm)
    expect(
      ret.some((m) => m.label?.includes('Return trunk') && m.label?.includes(`${cfm} cfm`)),
    ).toBe(true)
  })

  test('continuity grille → air handler (E2-style union-find) in every scenario', () => {
    for (const middle of ['utility', 'hallway', 'none'] as const) {
      const { walls, rooms } = plan(middle)
      const { members, fixtures } = layoutHvac(walls, rooms)
      expect(returnReachesAh(members, fixtures)).toBe(true)
    }
  })

  test('garage AH: the return trunk still reaches it from the conditioned grille', () => {
    const { walls, rooms, garage } = plan('none')
    const { members, fixtures } = layoutHvac(walls, rooms)
    expect(returnReachesAh(members, fixtures)).toBe(true)
    // the grille-side riser stands OUTSIDE the garage (the open end is in
    // conditioned space; only sealed trunk crosses toward the AH)
    const riser = returnDucts(members).find((m) => m.label?.includes('Return riser')) as Member
    expect(pointInPolygon([riser.position[0], riser.position[2]], garage.polygon)).toBe(false)
  })

  test('interior storey: return path rides the soffit plane, below the ceiling', () => {
    const { walls, rooms } = plan('hallway')
    const { members } = layoutHvac(walls, rooms, DEFAULT_SPEC, undefined, {
      hasLevelAbove: true,
    })
    const ret = returnDucts(members)
    expect(ret.length).toBeGreaterThanOrEqual(2)
    for (const m of ret) {
      expect(m.position[1] + m.dims[1] / 2).toBeLessThanOrEqual(2.5)
    }
    expect(ret.some((m) => m.label?.includes('soffit'))).toBe(true)
  })
})

describe('B19c — closable rooms carry the transfer-path assumption label', () => {
  test('a door on the room boundary labels its register; open rooms stay clean', () => {
    const { rooms } = plan('hallway')
    // Door reaching ONLY the bedroom (on its exterior north wall, mid-room:
    // w_n runs [14,8]→[0,8], u=4 → x=10 — inside r_bed's span). A door
    // between two rooms honestly labels both; this isolates the predicate.
    const walls = [
      wall('w_s', [0, 0], [14, 0]),
      wall('w_e', [14, 0], [14, 8]),
      wall('w_n', [14, 8], [0, 8], true, [door('d_bed', 4)]),
      wall('w_w', [0, 8], [0, 0]),
      wall('w_garage', [4, 0], [4, 8], false),
      wall('w_mid', [6, 0], [6, 8], false),
      wall('w_split', [6, 4], [14, 4], false),
    ]
    const { members, fixtures } = layoutHvac(walls, rooms)
    const regs = byKind(fixtures, 'register')
    const bed = regs.find((r) => r.sourceId === 'r_bed') as Fixture
    expect(bed.label).toContain('door undercut / jumper duct assumed (M1602.2)')
    expect(bed.meta?.transferAirAssumed).toBe(true)
    const living = regs.find((r) => r.sourceId === 'r_living') as Fixture
    expect(living.label).not.toContain('door undercut')
    expect(living.meta?.transferAirAssumed).toBeUndefined()
    // …and the assumption reaches PAPER (examiner round 2: labels never
    // typeset): the closable room's boot carries the flag, the takeoff
    // aggregates it into ONE Flags row.
    const FLAG = 'door undercut / jumper duct assumed — M1602.2'
    const flaggedBoots = members.filter((m) => m.flag === FLAG)
    expect(flaggedBoots.map((m) => m.sourceId)).toEqual(['r_bed'])
    const rows = computeTakeoff(members, fixtures)
    const flagRow = rows.find((r) => r.section === 'Flags' && r.detail === FLAG)
    expect(flagRow?.quantity).toBe(1)
    expect(flagRow?.unit).toBe('ea')
  })

  test('the grille room itself never carries the label (it feeds the return directly)', () => {
    // no hallway → the grille lives in the equipment room (utility). A door
    // into the utility room must NOT label its register.
    const base = plan('utility')
    const walls = base.walls.map((w) =>
      w.id === 'w_mid' ? wall('w_mid', [6, 0], [6, 8], false, [door('d_util', 4)]) : w,
    )
    const { fixtures } = layoutHvac(walls, base.rooms)
    const grille = byKind(fixtures, 'return')[0] as Fixture
    expect(grille.sourceId).toBe('r_util')
    const util = byKind(fixtures, 'register').find((r) => r.sourceId === 'r_util') as Fixture
    expect(util.label).not.toContain('door undercut')
  })
})

// ---- takeoff: return rows == drawn lengths -----------------------------------

describe('B19c — takeoff books return duct rows equal to the drawn members', () => {
  test('Return duct lf rows sum to the drawn return lengths, on their own rows', () => {
    const { walls, rooms } = plan('hallway')
    const { members, fixtures } = layoutHvac(walls, rooms)
    const rows = computeTakeoff(members, fixtures)
    const returnRows = rows.filter((r) => r.item.startsWith('Return duct') && r.unit === 'lf')
    expect(returnRows.length).toBeGreaterThan(0)
    for (const r of returnRows) expect(r.section).toBe('HVAC')
    const booked = returnRows.reduce((s, r) => s + r.quantity, 0)
    const drawn = returnDucts(members).reduce((s, m) => s + toFeet(m.length), 0)
    expect(booked).toBeCloseTo(drawn, 0)
    // supply rows never absorb the return lengths (mirror, not merge)
    const supplyDuct = rows.filter(
      (r) => r.item.startsWith('Duct') && r.unit === 'lf' && r.section === 'HVAC',
    )
    const supplyDrawn = members
      .filter((m) => m.role === 'duct-run' && !m.label?.startsWith('Return'))
      .reduce((s, m) => s + toFeet(m.length), 0)
    expect(supplyDuct.reduce((s, r) => s + r.quantity, 0)).toBeCloseTo(supplyDrawn, 0)
  })

  test('vertical duct rows book their TRUE section, never length-as-a-side (round-2 F4)', () => {
    const { walls, rooms } = plan('hallway')
    const { members, fixtures } = layoutHvac(walls, rooms)
    const rows = computeTakeoff(members, fixtures)
    // the whole return chain (riser + legs + drop) books under ONE section
    const returnRows = rows.filter((r) => r.item.startsWith('Return duct') && r.unit === 'lf')
    expect(returnRows.map((r) => r.item)).toEqual(['Return duct 14×8"'])
    // no HVAC duct row prints a member LENGTH as a section side — every
    // rectangular side stays within the real tin sections (≤ 14")
    for (const r of rows.filter((x) => x.section === 'HVAC' && x.item.includes('×'))) {
      const m = r.item.match(/(\d+)×(\d+)"/) as RegExpMatchArray
      expect(Math.max(Number(m[1]), Number(m[2]))).toBeLessThanOrEqual(14)
    }
    // the supply riser (vertical, dims [14", len, 8"]) merged into the
    // rectangular trunk row instead of a fictitious 'Duct 8×NN"' row
    expect(
      rows.some((r) => r.section === 'HVAC' && /^Duct 8×\d+"$/.test(r.item) && !r.item.endsWith('8×8"')),
    ).toBe(false)
  })
})
