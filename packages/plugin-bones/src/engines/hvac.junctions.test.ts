import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { DUCT_JUNCTION_BURY, layoutHvac } from './hvac'

/**
 * DUCT×EQUIPMENT JUNCTION GATE (day-9 z-fight — Julien screenshots: striped
 * color oscillation where the supply trunk meets the AH/plenum stack).
 *
 * THE Z-FIGHT PREDICATE: two SAME-facing parallel faces on ONE plane whose
 * rectangles overlap render at identical depth — the GPU picks a winner per
 * frame. The emission produced that class at every duct/equipment junction:
 * junction VERTICALS (trunk riser = the supply plenum stack, register
 * boots, return riser/drop, the whip conduit drop) carried EXACTLY the
 * section of the run connecting into them (matched side planes) and capped
 * exactly ON the run's center plane (matched cap planes — the equipment
 * room's own register put boot + plenum caps coplanar at ONE plan point).
 *
 * THE FIX (hvac.ts DUCT_JUNCTION_BURY): the receiving body is a hair larger
 * than the duct it swallows — junction verticals grow 2×BURY across the
 * section and their caps leave the run's center plane (plenum class +BURY
 * past, boot collars 2×BURY short). The junction stays a legal S1
 * connection: the run still terminates INSIDE the vertical — the
 * whip/line-set terminating-INTO precedent (MEP is deliberately outside the
 * structural interpenetration gate; THIS suite owns the junction class).
 *
 * GATE: sweep every composed scenario for SAME-normal coplanar overlapping
 * face pairs involving a junction body (any VERTICAL duct/pipe/conduit
 * member, an `equipment` member, or two members of DIFFERENT runs — cross-
 * sourceId horizontals can sit in different color buckets) — expect ZERO
 * outside the one allow-listed pre-existing residual (the day-8 queued
 * lineset×dryer-duct BORE, pinned present so the allowance cannot go
 * stale). Out of scope by construction: ANTI abutments (trunk step-down
 * seams, opposed branch tees — backface culling, legal S1 seams) and
 * same-run horizontal elbow corners (one sourceId, one color bucket —
 * identical fragments cannot oscillate). Mutations at the bottom revert
 * one junction class each and demand the sweep FIRES — the gate can never
 * go vacuous.
 *
 * CAUSATION CAVEAT (round-1 verdict): every pair the burial FIXED was
 * same-color-bucket — identical fragments, so the fix closes the coplanar
 * GEOMETRY class as hygiene, but Julien's TWO-COLOR striping most likely
 * comes from a cross-color mechanism: the dryer×line-set caps (the
 * allow-listed bore), the bath register×exhaust-fan fixture coincidence,
 * or a host hover/selection tint. The dawn visual round owns the
 * confirmation (docs/plans/ZFIGHT-EXPECTED-DIFF.md, verification block).
 */

// ---------------------------------------------------------------------------
// plan builders (hvac.return.test plan family)
// ---------------------------------------------------------------------------

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

function room(
  id: string,
  name: string,
  category: RoomSlice['category'],
  polygon: [number, number][],
): RoomSlice {
  return { id, name, category, polygon, boundaryWallIds: [], ceilingHeight: 2.5 }
}

/** 14×8 shell (hvac.return.test plan): the equipment room column [4..6] is
 * habitable (laundry) — its own register drops AT the plenum stack's plan
 * point, the day-9 degenerate that put boot + riser caps on one plane. */
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
  const rooms = [
    room('r_garage', 'Garage', 'garage', [[0, 0], [4, 0], [4, 8], [0, 8]]),
    room('r_living', 'Living', 'other', [[6, 0], [14, 0], [14, 4], [6, 4]]),
    room('r_bed', 'Bedroom', 'bedroom', [[6, 4], [14, 4], [14, 8], [6, 8]]),
    room('r_bath', 'Bath', 'bathroom', [[12, 0], [14, 0], [14, 2], [12, 2]]),
  ]
  if (middle === 'utility') {
    rooms.push(room('r_util', 'Utility', 'laundry', [[4, 0], [6, 0], [6, 8], [4, 8]]))
  } else if (middle === 'hallway') {
    rooms.push(room('r_hall', 'Hallway', 'hallway', [[4, 0], [6, 0], [6, 8], [4, 8]]))
  }
  return { walls, rooms }
}

/** One-sided plan: the AH at the WEST end (a garage equipment room — no
 * register of its own, so no cfm tees off at the stack) and every register
 * east of it — the first trunk segment carries the WHOLE cfm at the FULL
 * 14" width, the exact section the plenum stack used to share side planes
 * with (Julien's exhibit class: the supply trunk against the AH/plenum
 * stack). */
function oneSidedPlan() {
  // 6×14 NORTH-RUNNING shell: the register spread runs along Z, so the trunk
  // does too — its across-axis is the plenum riser's 14" side (dims[0]), the
  // matched plane pair of the exhibit. An X-running trunk crosses the riser's
  // 8" side instead and never matched (orientation matters to the mutation).
  const walls = [
    wall('w_s', [0, 0], [6, 0]),
    wall('w_e', [6, 0], [6, 14]),
    wall('w_n', [6, 14], [0, 14]),
    wall('w_w', [0, 14], [0, 0]),
    wall('w_m1', [0, 3], [6, 3], false),
    wall('w_m2', [0, 8], [6, 8], false),
  ]
  const rooms = [
    room('r_garage', 'Garage', 'garage', [[0, 0], [6, 0], [6, 3], [0, 3]]),
    room('r_living', 'Living', 'other', [[0, 3], [6, 3], [6, 8], [0, 8]]),
    room('r_bed', 'Bedroom', 'bedroom', [[0, 8], [6, 8], [6, 14], [0, 14]]),
  ]
  return { walls, rooms }
}

/** The M3 doorwayPlan (hvac.return.test round-3 verbatim): 8×6 hall/laundry
 * split. The laundry equipment room puts the dryer exhaust and the line-set
 * coil stub on the SAME equipAt → wall-anchor segment — the day-8 queued
 * lineset×dryer-duct BORE, whose coincident end caps are the sweep's one
 * allow-listed (cross-color) residual. */
function doorwayPlan() {
  const d: OpeningSlice = {
    id: 'd_m',
    kind: 'door',
    u: 2.5,
    width: 0.9,
    height: 2.1,
    sillHeight: 0,
    roughWidth: 0.95,
    roughHeight: 2.17,
  }
  const walls = [
    wall('w_s', [0, 0], [8, 0]),
    wall('w_e', [8, 0], [8, 6]),
    wall('w_n', [8, 6], [0, 6]),
    wall('w_w', [0, 6], [0, 0]),
    wall('w_m', [4, 0], [4, 6], false, [d]),
  ]
  const rooms = [
    room('r_hall', 'Hallway', 'hallway', [[0, 0], [4, 0], [4, 6], [0, 6]]),
    room('r_laundry', 'Laundry', 'laundry', [[4, 0], [8, 0], [8, 6], [4, 6]]),
  ]
  return { walls, rooms }
}

// ---------------------------------------------------------------------------
// the sweep: SAME-normal coplanar overlapping face pairs at junction bodies
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number]
type Box = {
  label: string
  sourceId: string
  center: Vec3
  half: Vec3
  yaw: number
  vertical: boolean
  equipment: boolean
  dryer: boolean
  lineset: boolean
}
type Face = { n: Vec3; d: number; u: Vec3; v: Vec3; hu: number; hv: number; c: Vec3 }

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Yaw-only members become oriented boxes; sloped runs (condensate euler
 * pitch) have TILTED planes that cannot coincide with axis planes — skip. */
function boxOf(m: Member): Box | null {
  if (m.rotation[0] !== 0 || m.rotation[2] !== 0) return null
  return {
    label: `${m.label ?? m.role} @ [${m.position.map((x) => x.toFixed(2)).join(',')}]`,
    sourceId: m.sourceId,
    center: [m.position[0], m.position[1], m.position[2]],
    half: [m.dims[0] / 2, m.dims[1] / 2, m.dims[2] / 2],
    yaw: m.rotation[1],
    vertical: m.dims[1] > m.dims[0],
    equipment: m.role === 'equipment',
    dryer: m.label?.startsWith('Dryer exhaust') === true,
    lineset: m.sourceId.startsWith('lineset-'),
  }
}

function facesOf(b: Box): Face[] {
  const cy = Math.cos(b.yaw)
  const sy = Math.sin(b.yaw)
  // world axes of the yaw-only box (euler XYZ member convention)
  const ax: Vec3[] = [
    [cy, 0, -sy],
    [0, 1, 0],
    [sy, 0, cy],
  ]
  const out: Face[] = []
  for (let i = 0; i < 3; i++) {
    for (const s of [1, -1] as const) {
      const axis = ax[i] as Vec3
      const n: Vec3 = [axis[0] * s, axis[1] * s, axis[2] * s]
      const c: Vec3 = [
        b.center[0] + n[0] * (b.half[i] as number),
        b.center[1] + n[1] * (b.half[i] as number),
        b.center[2] + n[2] * (b.half[i] as number),
      ]
      out.push({
        n,
        d: dot(n, c),
        u: ax[(i + 1) % 3] as Vec3,
        v: ax[(i + 2) % 3] as Vec3,
        hu: b.half[(i + 1) % 3] as number,
        hv: b.half[(i + 2) % 3] as number,
        c,
      })
    }
  }
  return out
}

/** Coincident-plane tolerance: the z-fight class is EXACT shared arithmetic
 * (both faces derive from one constant expression — 1 ulp apart at most);
 * the burial separates planes by ≥ 5 mm, so 1e-6 m cleanly splits the two. */
const PLANE_EPS = 1e-6

/** True when two coplanar rectangles genuinely share area (edge/corner touch
 * is contact, not a fight). */
function rectsOverlap(f: Face, g: Face): boolean {
  const rel: Vec3 = [g.c[0] - f.c[0], g.c[1] - f.c[1], g.c[2] - f.c[2]]
  const gu = Math.abs(dot(g.u, f.u)) * g.hu + Math.abs(dot(g.v, f.u)) * g.hv
  const gv = Math.abs(dot(g.u, f.v)) * g.hu + Math.abs(dot(g.v, f.v)) * g.hv
  return (
    Math.abs(dot(rel, f.u)) < f.hu + gu - 1e-9 && Math.abs(dot(rel, f.v)) < f.hv + gv - 1e-9
  )
}

/**
 * ALLOW-LISTED pre-existing residual (day-8 queue: lineset×dryer-duct
 * BORE): in a laundry equipment room the dryer exhaust and the line-set
 * coil stub both run equipAt → the same nearest-wall anchor, so the liquid
 * line rides COAXIALLY INSIDE the 4" exhaust body and their end caps land
 * on ONE plane with ONE normal (M3 doorwayPlan: both caps at x=6 and x=8,
 * the ⅜" cap inside the 4" cap). This is the sweep's only CROSS-COLOR
 * coincidence (duct gray × liquid warm-red — the class that can visibly
 * stripe in two colors); the fix is the queued BORE relocation, not a
 * junction burial — the pair is pinned below (symptomPresent) so the
 * allow-list dies with the bore fix instead of going stale.
 */
const allowedPair = (a: Box, b: Box): boolean =>
  (a.dryer && b.lineset) || (b.dryer && a.lineset)

/**
 * Every SAME-normal coplanar overlapping face pair whose pair involves a
 * junction body — a VERTICAL member, an `equipment` member, or two members
 * of DIFFERENT runs (different sourceId ⇒ potentially different color
 * buckets: sourceId drives every color route — circuit/pipe/duct-tone).
 * Same-sourceId horizontal pairs stay out of scope: one run's own elbow
 * corners live in ONE color bucket, and identical fragments cannot stripe.
 * `violations` empty = gate holds; `allowed` carries the day-8 bore
 * symptom pairs (pinned present in the doorway compose below).
 */
function sweep(members: Member[]): { violations: string[]; allowed: string[] } {
  const boxes: Box[] = []
  for (const m of members) {
    if (m.system !== 'hvac') continue
    const b = boxOf(m)
    if (b) boxes.push(b)
  }
  const violations: string[] = []
  const allowed: string[] = []
  for (let i = 0; i < boxes.length; i++) {
    const bi = boxes[i] as Box
    for (let j = i + 1; j < boxes.length; j++) {
      const bj = boxes[j] as Box
      const inScope =
        bi.vertical || bj.vertical || bi.equipment || bj.equipment || bi.sourceId !== bj.sourceId
      if (!inScope) continue
      for (const f of facesOf(bi)) {
        for (const g of facesOf(bj)) {
          const align = dot(f.n, g.n)
          if (align < 1 - PLANE_EPS) continue // SAME-normal only (ANTI = abutment)
          if (Math.abs(f.d - g.d) > PLANE_EPS) continue
          if (!rectsOverlap(f, g)) continue
          const desc = `${bi.label} × ${bj.label} (n=[${f.n.map((x) => x.toFixed(1)).join(',')}] d=${f.d.toFixed(4)})`
          ;(allowedPair(bi, bj) ? allowed : violations).push(desc)
        }
      }
    }
  }
  return { violations, allowed }
}

/** The gate view: violations only (allow-listed residuals excluded). */
function zFightPairs(members: Member[]): string[] {
  return sweep(members).violations
}

const BURY = DUCT_JUNCTION_BURY

// ---------------------------------------------------------------------------
// the sweep gate
// ---------------------------------------------------------------------------

describe('day-9 z-fight — no coplanar face pairs at any duct/equipment junction', () => {
  test('the full scenario matrix sweeps clean, attic AND soffit, every LOD', () => {
    const scenarios: { tag: string; members: Member[] }[] = []
    for (const middle of ['utility', 'hallway', 'none'] as const) {
      const { walls, rooms } = plan(middle)
      for (const ctx of [undefined, { hasLevelAbove: true }]) {
        scenarios.push({
          tag: `${middle}/${ctx ? 'soffit' : 'attic'}`,
          members: layoutHvac(walls, rooms, DEFAULT_SPEC, undefined, ctx).members,
        })
      }
    }
    {
      const { walls, rooms } = plan('utility')
      scenarios.push({
        tag: 'utility/attic/LOD400',
        members: layoutHvac(walls, rooms, { ...DEFAULT_SPEC, detail: '400' }).members,
      })
    }
    {
      const { walls, rooms } = oneSidedPlan()
      scenarios.push({
        tag: 'one-sided/attic',
        members: layoutHvac(walls, rooms).members,
      })
      scenarios.push({
        tag: 'one-sided/soffit',
        members: layoutHvac(walls, rooms, DEFAULT_SPEC, undefined, { hasLevelAbove: true })
          .members,
      })
    }
    {
      const { walls, rooms } = doorwayPlan()
      for (const ctx of [undefined, { hasLevelAbove: true }]) {
        scenarios.push({
          tag: `doorway/${ctx ? 'soffit' : 'attic'}`,
          members: layoutHvac(walls, rooms, DEFAULT_SPEC, undefined, ctx).members,
        })
      }
    }
    for (const s of scenarios) {
      expect({ tag: s.tag, pairs: zFightPairs(s.members) }).toEqual({ tag: s.tag, pairs: [] })
    }
  })

  test('the day-8 bore symptom is PRESENT and allow-listed — the allow-list dies with the bore fix', () => {
    // The doorway/laundry compose: dryer exhaust and line-set coil stub run
    // the same equipAt → wall-anchor segment, end caps coincident on one
    // plane with one normal (the ⅜" liquid cap INSIDE the 4" exhaust cap at
    // both ends) — the only CROSS-COLOR coplanar pair the sweep knows (duct
    // gray × warm red: the two-color striping class). When the queued bore
    // fix relocates the line-set, this pin fails ⇒ delete the allow-list
    // (allowedPair) together with this test.
    const { walls, rooms } = doorwayPlan()
    const { allowed, violations } = sweep(layoutHvac(walls, rooms).members)
    expect(violations).toEqual([])
    expect(allowed.length).toBeGreaterThan(0)
    expect(allowed.every((p) => p.includes('Dryer exhaust') && p.includes('Line-set'))).toBe(true)
  })

  test('the exhibit scene really exercises the exhibit: a FULL-width trunk leaves the plenum', () => {
    const { walls, rooms } = oneSidedPlan()
    const { members } = layoutHvac(walls, rooms)
    // every register east of the AH ⇒ the first trunk segment carries the
    // whole cfm at the full 14" section — the width that used to share the
    // plenum stack's side planes (non-vacuity for the riser mutation below)
    const full = members.filter(
      (m) => m.label?.startsWith('Trunk 14"') && m.dims[0] >= m.dims[1],
    )
    expect(full.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// junction pins — the burial geometry, hand-computed (a revert fails these)
// ---------------------------------------------------------------------------

describe('day-9 z-fight — junction burial pins (hand-computed)', () => {
  const TRUNK_W = 14 * 0.0254
  const TRUNK_H = 8 * 0.0254
  const BRANCH = 6 * 0.0254
  // plan(): ceilings 2.5, walls 2.5 ⇒ attic trunkY = 2.8, soffit = 2.15;
  // return plane = trunkY ± (TRUNK_H + 0.05)
  const ATTIC_Y = 2.5 + 0.3
  const SOFFIT_Y = 2.5 - 0.35

  const vertical = (ms: Member[], prefix: string): Member[] =>
    ms.filter((m) => m.label?.startsWith(prefix) && m.dims[1] > m.dims[0])
  const top = (m: Member): number => m.position[1] + m.dims[1] / 2
  const bottom = (m: Member): number => m.position[1] - m.dims[1] / 2

  test('attic: plenum riser +BURY past trunkY, 2×BURY fat; boots 2×BURY short, 2×BURY fat', () => {
    const { walls, rooms } = plan('utility')
    const { members } = layoutHvac(walls, rooms)
    const [riser] = vertical(members, 'Trunk riser')
    expect(riser).toBeDefined()
    expect(top(riser as Member)).toBeCloseTo(ATTIC_Y + BURY, 9)
    expect((riser as Member).dims[0]).toBeCloseTo(TRUNK_W + 2 * BURY, 9)
    expect((riser as Member).dims[2]).toBeCloseTo(TRUNK_H + 2 * BURY, 9)
    const boots = vertical(members, 'Supply boot')
    expect(boots.length).toBeGreaterThan(0)
    for (const boot of boots) {
      expect(top(boot)).toBeCloseTo(ATTIC_Y - 2 * BURY, 9)
      expect(boot.dims[0]).toBeCloseTo(BRANCH + 2 * BURY, 9)
      expect(boot.dims[2]).toBeCloseTo(BRANCH + 2 * BURY, 9)
    }
    // the day-9 degenerate: the equipment room's own register drops AT the
    // plenum plan point — the caps are now 3×BURY apart, never one plane
    const stackBoot = boots.find(
      (b) =>
        Math.abs(b.position[0] - (riser as Member).position[0]) < 1e-9 &&
        Math.abs(b.position[2] - (riser as Member).position[2]) < 1e-9,
    )
    expect(stackBoot).toBeDefined()
  })

  test('soffit: the boot enters from above — the retreat flips sign, planes stay distinct', () => {
    const { walls, rooms } = plan('utility')
    const { members } = layoutHvac(walls, rooms, DEFAULT_SPEC, undefined, {
      hasLevelAbove: true,
    })
    const [riser] = vertical(members, 'Trunk riser')
    expect(top(riser as Member)).toBeCloseTo(SOFFIT_Y + BURY, 9)
    for (const boot of vertical(members, 'Supply boot')) {
      expect(bottom(boot)).toBeCloseTo(SOFFIT_Y + 2 * BURY, 9)
    }
  })

  test('return riser/drop: 2×BURY fat, caps BURY past the leg plane (attic up, soffit down)', () => {
    const { walls, rooms } = plan('none')
    const RETURN_OFFSET = TRUNK_H + 0.05
    {
      const { members } = layoutHvac(walls, rooms)
      const [rise] = vertical(members, 'Return riser')
      const [drop] = vertical(members, 'Return drop')
      expect(top(rise as Member)).toBeCloseTo(ATTIC_Y + RETURN_OFFSET + BURY, 9)
      expect(top(drop as Member)).toBeCloseTo(ATTIC_Y + RETURN_OFFSET + BURY, 9)
      for (const m of [rise, drop] as Member[]) {
        expect(m.dims[0]).toBeCloseTo(TRUNK_H + 2 * BURY, 9)
        expect(m.dims[2]).toBeCloseTo(TRUNK_W + 2 * BURY, 9)
      }
      // coplanar caps without plan overlap are legal: the two verticals
      // stand RETURN_DROP_OFFSET apart — assert the separation is real
      const dx = (rise as Member).position[0] - (drop as Member).position[0]
      const dz = (rise as Member).position[2] - (drop as Member).position[2]
      expect(Math.hypot(dx, dz)).toBeGreaterThan(
        (TRUNK_W + 2 * BURY) / 2 + (TRUNK_H + 2 * BURY) / 2,
      )
    }
    {
      const { members } = layoutHvac(walls, rooms, DEFAULT_SPEC, undefined, {
        hasLevelAbove: true,
      })
      const [rise] = vertical(members, 'Return riser')
      const [drop] = vertical(members, 'Return drop')
      // soffit: the legs sit BELOW the grille — the riser descends and its
      // cap extends DOWN past the leg plane; the drop still rises from the AH
      expect(bottom(rise as Member)).toBeCloseTo(SOFFIT_Y - RETURN_OFFSET - BURY, 9)
      expect(top(drop as Member)).toBeCloseTo(SOFFIT_Y - RETURN_OFFSET + BURY, 9)
    }
  })

  test('whip conduit drop: 2×BURY fatter than its 16 mm run, caps untouched', () => {
    const { walls, rooms } = plan('utility')
    const { members } = layoutHvac(walls, rooms)
    const whips = members.filter((m) => m.sourceId.startsWith('ac-whip-'))
    const drop = whips.find((m) => m.dims[1] > m.dims[0])
    const run = whips.find((m) => m.dims[0] >= m.dims[1])
    expect(drop).toBeDefined()
    expect(run).toBeDefined()
    expect((drop as Member).dims[0]).toBeCloseTo(0.016 + 2 * BURY, 9)
    expect((drop as Member).dims[2]).toBeCloseTo(0.016 + 2 * BURY, 9)
    expect((run as Member).dims[1]).toBeCloseTo(0.016, 9)
    // the drop's junction cap stays ON the run's center plane — 8 mm from
    // either run face, never coplanar with one
    expect(bottom(drop as Member)).toBeCloseTo((run as Member).position[1], 9)
  })
})

// ---------------------------------------------------------------------------
// mutations — revert one junction class, the sweep MUST fire (non-vacuity)
// ---------------------------------------------------------------------------

/** Rebuild a junction vertical's pre-burial box: shrink the section back by
 * 2×BURY and restore the junction cap to the run's center plane. */
function revert(
  members: Member[],
  match: (m: Member) => boolean,
  capTo: number,
  capSide: 'hi' | 'lo',
): Member[] {
  return members.map((m) => {
    if (!match(m) || !(m.dims[1] > m.dims[0])) return m
    const lo = capSide === 'lo' ? capTo : m.position[1] - m.dims[1] / 2
    const hi = capSide === 'hi' ? capTo : m.position[1] + m.dims[1] / 2
    return {
      ...m,
      dims: [m.dims[0] - 2 * BURY, hi - lo, m.dims[2] - 2 * BURY] as [number, number, number],
      length: hi - lo,
      position: [m.position[0], (lo + hi) / 2, m.position[2]] as [number, number, number],
    }
  })
}

describe('day-9 z-fight — mutation probes: reverting one junction fails the gate', () => {
  const ATTIC_Y = 2.8

  test('reverted boots share side planes with their 6" branches again', () => {
    const { walls, rooms } = plan('utility')
    const { members } = layoutHvac(walls, rooms)
    const mutated = revert(members, (m) => m.label?.startsWith('Supply boot') === true, ATTIC_Y, 'hi')
    expect(zFightPairs(mutated).length).toBeGreaterThan(0)
  })

  test('a reverted plenum riser shares side planes with the full-width trunk again', () => {
    const { walls, rooms } = oneSidedPlan()
    const { members } = layoutHvac(walls, rooms)
    const mutated = revert(members, (m) => m.label?.startsWith('Trunk riser') === true, ATTIC_Y, 'hi')
    expect(zFightPairs(mutated).length).toBeGreaterThan(0)
  })

  test('a reverted return riser shares side planes with the return leg again', () => {
    const { walls, rooms } = plan('none')
    const { members } = layoutHvac(walls, rooms)
    const RETURN_Y = ATTIC_Y + 8 * 0.0254 + 0.05
    const mutated = revert(
      members,
      (m) => m.label?.startsWith('Return riser') === true,
      RETURN_Y,
      'hi',
    )
    expect(zFightPairs(mutated).length).toBeGreaterThan(0)
  })

  test('a reverted whip drop shares side planes with the whip run again', () => {
    const { walls, rooms } = plan('utility')
    const { members } = layoutHvac(walls, rooms)
    const mutated = members.map((m) =>
      m.sourceId.startsWith('ac-whip-') && m.dims[1] > m.dims[0]
        ? { ...m, dims: [0.016, m.dims[1], 0.016] as [number, number, number] }
        : m,
    )
    expect(zFightPairs(mutated).length).toBeGreaterThan(0)
  })

  test('the day-9 degenerate bites: reverted boot + riser CAPS land on one plane', () => {
    // equip-room register: boot and plenum riser at ONE plan point — with
    // both caps reverted to trunkY their top faces overlap coplanar (the
    // striped patch ON TOP of the stack in Julien's screenshots)
    const { walls, rooms } = plan('utility')
    const { members } = layoutHvac(walls, rooms)
    const capsOnly = members.map((m) => {
      if (
        (m.label?.startsWith('Supply boot') === true ||
          m.label?.startsWith('Trunk riser') === true) &&
        m.dims[1] > m.dims[0]
      ) {
        const lo = m.position[1] - m.dims[1] / 2
        return {
          ...m,
          dims: [m.dims[0], ATTIC_Y - lo, m.dims[2]] as [number, number, number],
          length: ATTIC_Y - lo,
          position: [m.position[0], (lo + ATTIC_Y) / 2, m.position[2]] as [
            number,
            number,
            number,
          ],
        }
      }
      return m
    })
    expect(
      zFightPairs(capsOnly).some((p) => p.includes('Trunk riser') && p.includes('Supply boot')),
    ).toBe(true)
  })
})
