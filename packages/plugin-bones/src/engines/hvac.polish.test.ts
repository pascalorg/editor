import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Fixture, Member, OpeningSlice, RoomSlice, WallSlice } from '../core/types'
import { EDITOR_GRID_STEP_M, layoutHvac, placeCondenserSeedSpot } from './hvac'

/**
 * HP OBJECT POLISH gates (Julien, hands-on with the shipped heat pump:
 * "by default it's not aligned to the grid… it's tilted… it looks like I
 * can't rotate it like a normal object or with R… let's make sure it's
 * aligned normally and grayed out normally like the object would be").
 * The COLOR gate lives with the renderer (condenser-asset.test.ts census);
 * these are the ENGINE truths:
 *  2. TILT   — the WHOLE assembly (cabinet + pad + fixture/proxy yaw) sits
 *              SQUARE to its row wall on ANY azimuth; the disconnect (a
 *              wall-face box) shares the wall-square bearing. Rule: machine
 *              placements square to the ELECTED wall, a verbatim drag
 *              squares to ITS row wall (nearest exterior exit).
 *  3. GRID   — the AUTO anchor lands on **WORLD XZ** grid multiples (the
 *              lattice the editor renders — the host floorStrategy
 *              convention; verify round F1 corrected the frame), moving
 *              only AWAY from the wall, so the ≥ 24" face clearance is a
 *              FLOOR the snap never violates; verbatim drags stay verbatim
 *              (A4); physics beats the grid (RO keepouts / wall span
 *              exhaust the window → honest off-grid + the F3 flag).
 *  4. ROTATE — `yawOverride` (the service node's additive field) beats
 *              wall-square for unit #1's assembly, verbatim at any angle;
 *              absent == wall-square (never a stored derivation copy).
 */

const LOD400 = { ...DEFAULT_SPEC, detail: '400' as const }

function opening(id: string, u: number, roughWidth: number): OpeningSlice {
  return {
    id,
    kind: 'window',
    u,
    width: roughWidth - 0.05,
    height: 1.2,
    sillHeight: 0.9,
    roughWidth,
    roughHeight: 1.3,
  }
}

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

/** 10×8 shell, laundry (equipment room) in the SW corner — the elected
 * exit is the SOUTH wall (w_s) — rotated by `theta` around the origin and
 * shifted by `shift`, so azimuth sweeps exercise the SAME election on
 * arbitrary bearings (the off-axis "rotY 2.99" class Julien hit). */
function shell(theta: number, shift: [number, number] = [0, 0], thickness = 0.2, southOpenings: OpeningSlice[] = []) {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const xf = (p: [number, number]): [number, number] => [
    p[0] * c - p[1] * s + shift[0],
    p[0] * s + p[1] * c + shift[1],
  ]
  const walls = [
    wall('w_s', xf([0, 0]), xf([10, 0]), true, southOpenings, thickness),
    wall('w_n', xf([0, 8]), xf([10, 8]), true, [], thickness),
    wall('w_w', xf([0, 0]), xf([0, 8]), true, [], thickness),
    wall('w_e', xf([10, 0]), xf([10, 8]), true, [], thickness),
  ]
  const rooms = [
    room('r_laundry', 'Laundry', 'laundry', [xf([0, 0]), xf([3, 0]), xf([3, 3]), xf([0, 3])]),
    room('r_living', 'Living', 'other', [xf([3, 0]), xf([10, 0]), xf([10, 8]), xf([3, 8])]),
    room('r_bed', 'Bedroom', 'bedroom', [xf([0, 3]), xf([3, 3]), xf([3, 8]), xf([0, 8])]),
  ]
  // the rotated south wall's outward normal (away from the shell interior)
  const out: [number, number] = [s, -c] // R(theta) · (0, −1)
  return { walls, rooms, out }
}

const cabinetsOf = (members: Member[]): Member[] =>
  members.filter((m) => m.system === 'hvac' && m.role === 'equipment' && m.material === 'steel')
const padsOf = (members: Member[]): Member[] =>
  members.filter((m) => m.system === 'hvac' && m.role === 'equipment' && m.material === 'concrete')
const condensersOf = (fixtures: Fixture[]): Fixture[] =>
  fixtures.filter((f) => f.kind === 'equipment' && f.meta?.equipment === 'condenser')

const onGrid = (v: number): boolean =>
  Math.abs(v / EDITOR_GRID_STEP_M - Math.round(v / EDITOR_GRID_STEP_M)) < 1e-6

// ---------------------------------------------------------------------------
// Item 2 — TILT: wall-square assembly, pinned on 3 azimuths
// ---------------------------------------------------------------------------

describe('wall-square assembly — yaw = the row wall normal (item 2)', () => {
  // 0 (axis-aligned), 90°, and the off-axis class (≈ 33.7°, arctan 2/3):
  // the shipped bug was the equipment-room BEARING as unit #1's yaw — on
  // off-axis scenes an arbitrary tilt (rotY ≈ 2.99) against a wall-aligned
  // pad. Pin the yaw to the wall normal at every azimuth.
  const azimuths = [0, Math.PI / 2, Math.atan2(2, 3)]

  for (const theta of azimuths) {
    test(`azimuth ${(theta * 180 / Math.PI).toFixed(1)}°: cabinet = pad = fixture yaw = wall normal; disconnect square too`, () => {
      const { walls, rooms, out } = shell(theta)
      const { members, fixtures } = layoutHvac(walls, rooms, LOD400)
      const wallSquare = Math.atan2(out[0], out[1])
      const cab = cabinetsOf(members)[0] as Member
      const pad = padsOf(members)[0] as Member
      const unit = condensersOf(fixtures)[0] as Fixture
      const disc = fixtures.find((f) => f.kind === 'disconnect') as Fixture
      expect(cab.rotation[1]).toBeCloseTo(wallSquare, 9)
      // ONE rigid assembly: pad and fixture carry the SAME yaw (the pick
      // proxy reads the fixture — proxy.test.ts pins that identity)
      expect(pad.rotation[1]).toBe(cab.rotation[1])
      expect(unit.rotationY).toBe(cab.rotation[1])
      // the wall-face disconnect shares the wall-square bearing
      expect(disc.rotationY).toBeCloseTo(wallSquare, 9)
    })
  }

  test('azimuth 0 pinned absolutely: south row faces out at exactly π (mutation gate on the legacy bearing)', () => {
    const { walls, rooms } = shell(0)
    const cab = cabinetsOf(layoutHvac(walls, rooms, LOD400).members)[0] as Member
    // the legacy equipment-room bearing on this scene is ≈ 2.85 — NOT π;
    // only the wall normal lands exactly on atan2(0, −1)
    expect(cab.rotation[1]).toBeCloseTo(Math.PI, 12)
  })

  test('row of two: BOTH units wall-square (the old split — bearing #1, normal #2 — is dead)', () => {
    // 26×10 shell sizes to 2 units; unit #1 used to keep the legacy
    // bearing while unit #2 faced the normal.
    const walls = [
      wall('w_s', [0, 0], [26, 0], true),
      wall('w_n', [0, 10], [26, 10], true),
      wall('w_w', [0, 0], [0, 10], true),
      wall('w_e', [26, 0], [26, 10], true),
    ]
    const rooms = [
      room('r_laundry', 'Laundry', 'laundry', [[0, 0], [3, 0], [3, 3], [0, 3]]),
      room('r_living', 'Living', 'other', [[3, 0], [26, 0], [26, 10], [3, 10]]),
      room('r_bed', 'Bedroom', 'bedroom', [[0, 3], [3, 3], [3, 10], [0, 10]]),
    ]
    const { members } = layoutHvac(walls, rooms, LOD400)
    const cabs = cabinetsOf(members)
    const pads = padsOf(members)
    expect(cabs.length).toBe(2)
    for (let i = 0; i < cabs.length; i++) {
      expect(cabs[i]?.rotation[1]).toBeCloseTo(Math.PI, 12)
      expect(pads[i]?.rotation[1]).toBe(cabs[i]?.rotation[1] as number)
    }
  })

  test('verbatim drag rule: the assembly squares to ITS OWN row wall (nearest exterior exit), position verbatim', () => {
    const { walls, rooms } = shell(0)
    // a real user drag east of the shell → nearest exterior exit = w_e
    // (x = 10, outward normal (1, 0) → yaw π/2); the POSITION is never
    // touched (A4), the ORIENTATION is derived truth
    const dragged = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: [11.3, 0, 4.1] },
    })
    const cab = cabinetsOf(dragged.members)[0] as Member
    expect(cab.position[0]).toBeCloseTo(11.3, 12)
    expect(cab.position[2]).toBeCloseTo(4.1, 12)
    expect(cab.rotation[1]).toBeCloseTo(Math.PI / 2, 9)
    expect(padsOf(dragged.members)[0]?.rotation[1]).toBe(cab.rotation[1])
  })
})

// ---------------------------------------------------------------------------
// Item 3 — GRID: snapped auto anchor, clearance floor, verbatim untouched
// ---------------------------------------------------------------------------

describe('grid-snapped auto anchor — aligned normally, clearance never violated (item 3)', () => {
  test('sweep: thickness × shell offset — plan coords on the grid, face clearance ≥ 24" always', () => {
    // Odd shell offsets make every RAW anchor land off-grid; the composed
    // anchor must still sit on 0.5 m multiples (both axes, axis-aligned
    // scenes) with the wall-face → cabinet-face clearance never under 24".
    const FACE_CLEAR = 0.6096
    const DEPTH = 0.95
    let checked = 0
    for (const t of [0.1, 0.114, 0.15, 0.2, 0.25, 0.35]) {
      for (const shift of [[0, 0], [0.137, -0.261], [-1.03, 0.449], [3.31, 7.77]] as const) {
        const { walls, rooms } = shell(0, [shift[0], shift[1]], t)
        const { members, warnings } = layoutHvac(walls, rooms, LOD400)
        const cab = cabinetsOf(members)[0] as Member
        expect(onGrid(cab.position[0])).toBe(true)
        expect(onGrid(cab.position[2])).toBe(true)
        // south wall centerline z = shift[1]; face at −t/2; cabinet face
        // toward the house at position + depth/2 (outward = −z)
        const clearance = -(cab.position[2] - shift[1]) - t / 2 - DEPTH / 2
        expect(clearance).toBeGreaterThanOrEqual(FACE_CLEAR - 1e-9)
        // healthy path: the snap never minted a flag or warning class
        expect(cab.flag).toBeUndefined()
        expect(warnings.some((w) => /condenser|heat.?pump/i.test(w))).toBe(false)
        checked++
      }
    }
    expect(checked).toBe(24)
  })

  test('oblique + fronting-RO exhibit: the pick can legitimately exceed the axis-aligned bound — the M2 OBLIQUE row digits cover it (round-2 F2)', () => {
    // The round-2 skeptic class: on oblique walls keepouts cut DIAGONAL
    // stripes through the lattice, so the minimal-valid-stand-off
    // candidate can sit rows beyond the first — 'S < S0 + 0.5' is an
    // AXIS-ALIGNED theorem only. This composed exhibit (θ = π/5, t = 0.2,
    // long low window + a second window past the slide edge) accepts a
    // lattice spot at S − S0 ≈ 2.17: beyond the axis bound, WITHIN the
    // window-supremum theorem S ≤ S0 + 1.75·(|sin θ|+|cos θ|), on the
    // world grid, flag-free (a valid spot exists — the honest path), and
    // the disconnect reach stays inside the M2 oblique digits.
    const theta = Math.PI / 5
    const t = 0.2
    const opens = [opening('a', 1.2, 3.2), opening('b', 4.45, 1.0)]
    const { walls, rooms } = shell(theta, [0.29, 0.23], t, opens)
    const r = layoutHvac(walls, rooms, LOD400)
    const cab = cabinetsOf(r.members)[0] as Member
    const disc = r.fixtures.find((f) => f.kind === 'disconnect') as Fixture
    const unit = condensersOf(r.fixtures)[0] as Fixture
    // world-grid + healthy path (no off-grid class — a candidate WAS found)
    expect(onGrid(cab.position[0])).toBe(true)
    expect(onGrid(cab.position[2])).toBe(true)
    expect(cab.flag).toBeUndefined()
    // stand-off vs the row wall: beyond the axis bound, within the theorem
    const w = walls.find((x) => x.id === disc.sourceId) as WallSlice
    const n: [number, number] = [-w.dir[1], w.dir[0]]
    const side =
      (cab.position[0] - w.start[0]) * n[0] + (cab.position[2] - w.start[1]) * n[1] >= 0
        ? 1
        : -1
    const sVal =
      ((cab.position[0] - w.start[0]) * n[0] + (cab.position[2] - w.start[1]) * n[1]) * side
    const s0 = w.thickness / 2 + 0.6096 + 0.475
    expect(sVal - s0).toBeGreaterThan(0.5) // non-vacuous: axis digits do NOT cover this
    expect(sVal).toBeLessThanOrEqual(s0 + 1.75 * (Math.abs(n[0]) + Math.abs(n[1])) + 1e-9)
    expect(sVal - s0).toBeCloseTo(2.17445, 4) // the pinned exhibit
    // disconnect reach: beyond the axis-row digit, inside the oblique digit
    const reach = Math.hypot(
      disc.position[0] - unit.position[0],
      disc.position[1] - unit.position[1],
      disc.position[2] - unit.position[2],
    )
    expect(reach).toBeGreaterThan(1.73) // the round-1 scene-gate blind spot, exercised
    expect(reach).toBeLessThanOrEqual(3.62) // == the amended M2 oblique digits
    // machinery invariants hold out here too: byte seed parity + determinism
    const seed = placeCondenserSeedSpot(walls, rooms)
    expect(seed?.[0]).toBe(unit.position[0])
    expect(seed?.[1]).toBe(unit.position[2])
    const post = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: [seed?.[0] as number, 0, seed?.[1] as number] },
    })
    expect(JSON.stringify(post.members)).toBe(JSON.stringify(r.members))
  })

  test('tie-break is LEAST-STAND-OFF-FIRST: a nearer lattice spot with more stand-off loses (round-2 F2a pin)', () => {
    // Discriminating scene (θ = atan2(2,3), t = 0.1, windows u = 1.2 rw 1.0
    // + u = 2.9 rw 0.8): the window candidates include (4.0, 1.0) at
    // d² ≈ 0.065 / S ≈ 1.387 and (4.5, 1.5) at d² ≈ 0.540 / S ≈ 1.248.
    // Nearest-first accepts the former; the M2 bounds are provable only
    // because the pick minimizes the ACCEPTED stand-off — (4.5, 1.5) must
    // win. (The class-sweep's supremum theorem holds for ANY window pick,
    // so only this pin bites a tie-break regression.)
    const theta = Math.atan2(2, 3)
    const opens = [opening('a', 1.2, 1.0), opening('b', 2.9, 0.8)]
    const { walls, rooms } = shell(theta, [0, 0], 0.1, opens)
    const cab = cabinetsOf(layoutHvac(walls, rooms, LOD400).members)[0] as Member
    expect(cab.position[0]).toBe(4.5)
    expect(cab.position[2]).toBe(1.5)
    expect(cab.flag).toBeUndefined()
  })

  test('CLASS-SWEEP S-theorem (round-2 loop lesson: a numeric class bound for a search needs a class-sweep gate, not a scene gate)', () => {
    // Every composed pick across azimuth × thickness × shift × window
    // combinations satisfies the M2 theorems: floor S ≥ S0 (away-only);
    // accepted picks S ≤ S0 + 1.75·(|sin θ|+|cos θ|) (window supremum —
    // ≤ S0 + 0.5 degenerates out of it on axis-parallel walls only
    // because keepouts are u-only there; the sweep includes both);
    // flagged (exhausted) composes stand at the honest stand-off S0
    // exactly; disconnect 3D reach ≤ 3.62 (the M2 oblique row digit,
    // 1.73 on axis-parallel walls); and the search is DETERMINISTIC
    // (byte-equal recompose).
    const thetas = [0, Math.PI / 2, Math.atan2(2, 3), Math.PI / 5, Math.PI / 7]
    const windowSets: OpeningSlice[][] = [
      [],
      [opening('a', 1.2, 3.2), opening('b', 4.45, 1.0)],
      [opening('a', 0.6, 0.5), opening('b', 2.4, 0.5)],
      [opening('a', 1.8, 2.4), opening('b', 4.75, 1.0)],
    ]
    let composed = 0
    let beyondAxis = 0
    let flagged = 0
    for (const theta of thetas) {
      const axisParallel = theta === 0 || theta === Math.PI / 2
      for (const t of [0.1, 0.2]) {
        for (const shift of [[0, 0], [0.13, 0], [0.29, 0.23]] as const) {
          for (const opens of windowSets) {
            const { walls, rooms } = shell(theta, [shift[0], shift[1]], t, opens)
            const r = layoutHvac(walls, rooms, LOD400)
            const cab = cabinetsOf(r.members)[0] as Member
            const disc = r.fixtures.find((f) => f.kind === 'disconnect') as Fixture | undefined
            const unit = condensersOf(r.fixtures)[0] as Fixture | undefined
            if (!cab || !disc || !unit) continue
            const w = walls.find((x) => x.id === disc.sourceId) as WallSlice
            const n: [number, number] = [-w.dir[1], w.dir[0]]
            const side =
              (cab.position[0] - w.start[0]) * n[0] +
                (cab.position[2] - w.start[1]) * n[1] >=
              0
                ? 1
                : -1
            const sVal =
              ((cab.position[0] - w.start[0]) * n[0] +
                (cab.position[2] - w.start[1]) * n[1]) *
              side
            const s0 = w.thickness / 2 + 0.6096 + 0.475
            const isOffGrid = (cab.flag ?? '').includes('off-grid')
            // floor: never toward the wall
            expect(sVal).toBeGreaterThanOrEqual(s0 - 1e-9)
            if (isOffGrid) {
              // exhausted ⇒ the fully honest spot: stand-off is S0 exactly
              expect(sVal).toBeCloseTo(s0, 9)
              flagged++
            } else {
              const cap = axisParallel ? 0.5 : 1.75 * (Math.abs(n[0]) + Math.abs(n[1]))
              expect(sVal).toBeLessThanOrEqual(s0 + cap + 1e-9)
              if (sVal - s0 > 0.5) beyondAxis++
            }
            // reach digits == the amended M2 row, per class
            const reach = Math.hypot(
              disc.position[0] - unit.position[0],
              disc.position[1] - unit.position[1],
              disc.position[2] - unit.position[2],
            )
            expect(reach).toBeLessThanOrEqual(axisParallel ? 1.73 : 3.62)
            // deterministic: byte-equal recompose (totality of the
            // (s, d², u) order — distinct lattice points cannot tie on
            // both s and u)
            const r2 = layoutHvac(walls, rooms, LOD400)
            expect(JSON.stringify(r2.members)).toBe(JSON.stringify(r.members))
            composed++
          }
        }
      }
    }
    // the sweep is a CLASS gate, not a scene gate: it must actually
    // contain beyond-axis picks AND exhaustion firings, or it gates nothing
    expect(composed).toBeGreaterThanOrEqual(100)
    expect(beyondAxis).toBeGreaterThan(0)
    expect(flagged).toBeGreaterThan(0)
  })

  test('off-axis azimuth: the snap lives on the WORLD XZ grid — the lattice the editor renders (verify F1)', () => {
    // The skeptic's exhibit class: wall-frame multiples sit visibly OFF
    // the world lattice on oblique walls (residuals 0.153/0.496). The host
    // floorStrategy convention is the WORLD grid (placement-strategies.ts
    // + world-grid-snap.ts): both world plan components land on 0.5 m
    // multiples EXACTLY (the lattice point is taken verbatim), the yaw
    // stays wall-square (rotation is not the snap's business), and the
    // away-only stand-off floor holds.
    const theta = Math.atan2(2, 3)
    const { walls, rooms } = shell(theta, [0.7, -0.3])
    const { members, fixtures, warnings } = layoutHvac(walls, rooms, LOD400)
    const cab = cabinetsOf(members)[0] as Member
    expect(onGrid(cab.position[0])).toBe(true)
    expect(onGrid(cab.position[2])).toBe(true)
    // wall-square yaw survives the world snap — square to the ELECTED row
    // wall (the disconnect names it: the laundry centroid stands exactly
    // 1.5 m from BOTH the south and west walls, so the shifted/rotated tie
    // may break either way in float — the contract is wall-squareness,
    // not which of two equidistant candidates wins)
    const rowWallId = (fixtures.find((f) => f.kind === 'disconnect') as Fixture).sourceId
    const w = walls.find((x) => x.id === rowWallId) as WallSlice
    const n: [number, number] = [-w.dir[1], w.dir[0]]
    const side =
      (cab.position[0] - w.start[0]) * n[0] + (cab.position[2] - w.start[1]) * n[1] >= 0
        ? 1
        : -1
    const outW: [number, number] = [n[0] * side, n[1] * side]
    expect(cab.rotation[1]).toBeCloseTo(Math.atan2(outW[0], outW[1]), 9)
    // away-only floor: at least the raw condenserStandoff off the wall line
    const s =
      (cab.position[0] - w.start[0]) * outW[0] + (cab.position[2] - w.start[1]) * outW[1]
    expect(s).toBeGreaterThanOrEqual(0.1 + 0.6096 + 0.475 - 1e-9)
    // a lattice spot exists here — the honest path stays silent
    expect(cab.flag).toBeUndefined()
    expect(warnings.some((w2) => /grid/i.test(w2))).toBe(false)
  })

  test('outward is AWAY-only: the lattice search never accepts a spot closer than the honest stand-off', () => {
    // t = 0.2 → raw stand-off 1.1846 → the accepted lattice point stands at
    // 1.5 (never 1.0, which would leave ~0.42 m face clearance — under the
    // 24\" floor). The along-wall coordinate may move either way; the
    // stand-off may only grow.
    const { walls, rooms } = shell(0)
    const cab = cabinetsOf(layoutHvac(walls, rooms, LOD400).members)[0] as Member
    expect(cab.position[2]).toBeCloseTo(-1.5, 9)
  })

  test('physics beats the grid: window exhausted → HONEST un-snapped spot + the off-grid flag (verify F3)', () => {
    // Shell shifted +0.13: the raw anchor's along-wall world coord is 1.63.
    // Window keepouts blanket EVERY x-column of the search window (0.5–3.0:
    // off-span, K1 [−0.2, 1.4] or K2 [1.6, 3.2]) while the raw spot sits in
    // the clear gap between them — the lattice search exhausts, the unit
    // stands at the fully HONEST pre-snap spot (no partial outward snap
    // either — the honest position is the honest position), and pad +
    // cabinet carry the promised off-grid honesty flag. Never silent.
    const win1 = opening('win1', 0.6, 0.5) // keepout ≈ [−0.2, 1.4] (u-space)
    const win2 = opening('win2', 2.4, 0.5) // keepout ≈ [1.6, 3.2]
    const { walls, rooms } = shell(0, [0.13, 0], 0.2, [win1, win2])
    const { members } = layoutHvac(walls, rooms, LOD400)
    const cab = cabinetsOf(members)[0] as Member
    const pad = padsOf(members)[0] as Member
    expect(cab.position[0]).toBeCloseTo(1.63, 9) // honest along (u = 1.5)
    expect(onGrid(cab.position[0])).toBe(false)
    expect(cab.position[2]).toBeCloseTo(-1.1846, 9) // honest stand-off kept
    for (const m of [pad, cab]) {
      expect(m.flag ?? '').toContain(
        '⚠ off-grid — clearance/openings leave no 0.5 m grid position near the elected spot',
      )
    }
    // a GENUINE user drag (not a machine spelling — metres/centimetres
    // away, not nanometres) never carries the class: drags don't snap, so
    // they can't exhaust a snap (A4)
    const dragged = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: [1.68, 0, -1.9] },
    })
    for (const m of [...padsOf(dragged.members), ...cabinetsOf(dragged.members)]) {
      expect(m.flag ?? '').not.toContain('off-grid')
    }
  })

  test('the off-grid flag SURVIVES the default seed lifecycle: recognized machine seed replays it, byte-equal, N recomposes (round-2 F1)', () => {
    // The exhibit that broke round 1 (visual scene fbd31d0a5faf): the
    // editor auto-seeds the service node at the machine spot on first
    // load, the next compose runs verbatim, a verbatim row never snaps —
    // so the honesty flag lived for exactly ONE compose and vanished
    // silently on every activated exhaustion-class scene. Now the FULL
    // snap outcome (unit1OffGrid included) rides recognized machine
    // seeds: post-seed == auto BYTE-equal on the exhaustion class too,
    // and the flag persists across arbitrarily many seed→compose cycles.
    const win1 = opening('win1', 0.6, 0.5)
    const win2 = opening('win2', 2.4, 0.5)
    const { walls, rooms } = shell(0, [0.13, 0], 0.2, [win1, win2])
    const auto = layoutHvac(walls, rooms, LOD400)
    expect(
      cabinetsOf(auto.members)[0]?.flag ?? '',
    ).toContain('off-grid') // non-vacuous: this IS the exhaustion class
    // seed = the composed unit-#1 anchor (the auto-seed lifecycle)
    let seed = placeCondenserSeedSpot(walls, rooms)
    expect(seed?.[0]).toBe(cabinetsOf(auto.members)[0]?.position[0] as number)
    expect(seed?.[1]).toBe(cabinetsOf(auto.members)[0]?.position[2] as number)
    // N recomposes, each feeding the previous compose's unit-#1 spot back
    // as the node position (what reconcile/seeding does): byte-stable,
    // flag never laundered
    for (let n = 0; n < 3; n++) {
      const post = layoutHvac(walls, rooms, LOD400, {
        heatPump: { position: [seed?.[0] as number, 0, seed?.[1] as number] },
      })
      expect(JSON.stringify(post.members)).toBe(JSON.stringify(auto.members))
      expect(JSON.stringify(post.fixtures)).toBe(JSON.stringify(auto.fixtures))
      expect(JSON.stringify(post.warnings)).toBe(JSON.stringify(auto.warnings))
      const cab = cabinetsOf(post.members)[0] as Member
      expect(cab.flag ?? '').toContain('off-grid')
      seed = [cab.position[0], cab.position[2]]
    }
    // …and a genuine off-machine drag on the SAME scene clears it (A4)
    const dragged = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: [1.63, 0, -1.35] },
    })
    for (const m of [...padsOf(dragged.members), ...cabinetsOf(dragged.members)]) {
      expect(m.flag ?? '').not.toContain('off-grid')
    }
  })

  test('verbatim drags NEVER snap (A4 — the host move tool already applied the user grid mode)', () => {
    const { walls, rooms } = shell(0)
    const dragged = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: [5.313, 0, -1.777] },
    })
    const cab = cabinetsOf(dragged.members)[0] as Member
    expect(cab.position[0]).toBeCloseTo(5.313, 12)
    expect(cab.position[2]).toBeCloseTo(-1.777, 12)
  })

  test('seed parity on the SNAPPED geometry: seed == composed unit #1, post-seed compose == auto, byte — oblique included', () => {
    // The ε-anchor machinery must hold byte-for-byte on the new spots (the
    // fence/RO exhibits re-pin the elected-wall side in the condensers
    // suite). OBLIQUE azimuths ride the same guarantee BY CONSTRUCTION
    // since the world-grid rework: the auto path takes the lattice point
    // verbatim and re-derives u/out/stand-off with the exact verbatim-path
    // expressions, so the seeded round-trip reproduces every bit — no
    // normalize-ULP class on rotations (verify F1 hardening).
    for (const [theta, shift] of [
      [0, [0.137, -0.261]],
      [Math.atan2(2, 3), [0.7, -0.3]],
      [Math.PI / 7, [0, 0]],
    ] as const) {
      const { walls, rooms } = shell(theta, [shift[0], shift[1]])
      const seed = placeCondenserSeedSpot(walls, rooms)
      const auto = layoutHvac(walls, rooms, LOD400)
      const unit = condensersOf(auto.fixtures)[0] as Fixture
      expect(seed?.[0]).toBe(unit.position[0])
      expect(seed?.[1]).toBe(unit.position[2])
      const post = layoutHvac(walls, rooms, LOD400, {
        heatPump: { position: [seed?.[0] as number, 0, seed?.[1] as number] },
      })
      expect(JSON.stringify(post.members)).toBe(JSON.stringify(auto.members))
      expect(JSON.stringify(post.fixtures)).toBe(JSON.stringify(auto.fixtures))
      expect(JSON.stringify(post.warnings)).toBe(JSON.stringify(auto.warnings))
    }
  })

  test('legacy machine seeds (pre-snap coordinates) still read as the machine point — elected wall kept', () => {
    // Nodes seeded BEFORE the grid snap shipped carry the OLD unsnapped
    // spot. The SLID class is the sharp one: a pre-snap RO-slid seed
    // equals NEITHER the raw election spot NOR today's snapped unit #1 —
    // only `unit1Presnap` recognizes it. Recognition must hold: position
    // stays verbatim (A4 — no silent move on upgrade) and the row keeps
    // the ELECTED south wall even with a nearer fence — the round-2
    // disconnect-flip class must not come back for old scenes.
    const win = opening('win_s', 1.5, 1.2) // keepout ≈ [0.35, 2.65]
    const { walls, rooms } = shell(0, [0, 0], 0.2, [win])
    walls.push(wall('w_fence', [2, -2.2], [8, -2.2], true))
    // yesterday's machine spot: election (1.5, −1.1846) slid to u = 2.65,
    // NO grid snap — reconstructed exactly as the old engine wrote it
    const legacySeed: [number, number] = [2.65, -1.1846]
    // …and it really is neither of the other two machine spellings
    const todaySeed = placeCondenserSeedSpot(walls, rooms)
    expect(todaySeed?.[0]).toBeCloseTo(3.0, 9) // slid 2.65 → snapped 3.0
    expect(todaySeed?.[1]).toBeCloseTo(-1.5, 9)
    const out = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: [legacySeed[0], 0, legacySeed[1]] },
    })
    const unit = condensersOf(out.fixtures)[0] as Fixture
    expect(unit.position[0]).toBeCloseTo(legacySeed[0], 12)
    expect(unit.position[2]).toBeCloseTo(legacySeed[1], 12)
    expect((out.fixtures.find((f) => f.kind === 'disconnect') as Fixture).sourceId).toBe('w_s')
  })

  test('the pad label restates the basis as a floor: ≥ 24"', () => {
    const { walls, rooms } = shell(0)
    const pad = padsOf(layoutHvac(walls, rooms, LOD400).members)[0] as Member
    expect(pad.label).toContain('≥ 24" face clearance basis')
    expect(pad.label).not.toContain('(24"')
  })
})

// ---------------------------------------------------------------------------
// Item 4 — ROTATE: yawOverride consumed, verbatim, absent == wall-square
// ---------------------------------------------------------------------------

describe('yawOverride — rotate like a normal object (item 4)', () => {
  test('set → unit #1 assembly turns VERBATIM (cabinet + pad + fixture); disconnect + row units stay derived', () => {
    const walls = [
      wall('w_s', [0, 0], [26, 0], true),
      wall('w_n', [0, 10], [26, 10], true),
      wall('w_w', [0, 0], [0, 10], true),
      wall('w_e', [26, 0], [26, 10], true),
    ]
    const rooms = [
      room('r_laundry', 'Laundry', 'laundry', [[0, 0], [3, 0], [3, 3], [0, 3]]),
      room('r_living', 'Living', 'other', [[3, 0], [26, 0], [26, 10], [3, 10]]),
      room('r_bed', 'Bedroom', 'bedroom', [[0, 3], [3, 3], [3, 10], [0, 10]]),
    ]
    const yaw = Math.PI / 4 + 0.013 // NOT a 45° multiple — verbatim, no quantize
    const out = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: [5, 0, -1.5], yaw },
    })
    const cabs = cabinetsOf(out.members)
    const pads = padsOf(out.members)
    const units = condensersOf(out.fixtures)
    expect(cabs.length).toBe(2)
    // unit #1: the override, exactly
    expect(cabs[0]?.rotation[1]).toBe(yaw)
    expect(pads[0]?.rotation[1]).toBe(yaw)
    expect(units[0]?.rotationY).toBe(yaw)
    // unit #2 (auto row sibling): wall-square, untouched by the override
    expect(cabs[1]?.rotation[1]).toBeCloseTo(Math.PI, 12)
    // the disconnect is a WALL-FACE box: it keeps the wall-square bearing
    const disc = out.fixtures.find((f) => f.kind === 'disconnect' && f.meta?.unit === 1) as Fixture
    expect(disc.rotationY).toBeCloseTo(Math.PI, 12)
    // E2 continuity: the whip still chains the (rotated) unit to its box
    expect(out.members.some((m) => m.sourceId === 'ac-whip-1')).toBe(true)
  })

  test('rotate WITHOUT moving: yaw-only override rides the AUTO anchor (position untouched, grid intact)', () => {
    const { walls, rooms } = shell(0)
    const auto = layoutHvac(walls, rooms, LOD400)
    const spun = layoutHvac(walls, rooms, LOD400, { heatPump: { yaw: -1.1 } })
    const autoCab = cabinetsOf(auto.members)[0] as Member
    const spunCab = cabinetsOf(spun.members)[0] as Member
    expect(spunCab.position).toEqual(autoCab.position)
    expect(spunCab.rotation[1]).toBe(-1.1)
    expect(padsOf(spun.members)[0]?.rotation[1]).toBe(-1.1)
  })

  test('absent == wall-square (never a stored copy): no yaw field → the derived orientation', () => {
    const { walls, rooms } = shell(0)
    const out = layoutHvac(walls, rooms, LOD400, { heatPump: { position: [5, 0, -1.5] } })
    expect(cabinetsOf(out.members)[0]?.rotation[1]).toBeCloseTo(Math.PI, 12)
  })

  test('oblique pad honesty: a rotated pad reaches (|sin|+|cos|)·half — the clearance push grows with the angle', () => {
    // A verbatim anchor tucked near the wall: at 0° the pad slides just
    // past the R703.8 allowance; at 45° the oblique reach demands more —
    // the pad center ends further out and the overhang honesty fires
    // (cabinet stays put per A4). The night-4 punch-through class cannot
    // return through the rotation override.
    const { walls, rooms } = shell(0)
    const at: [number, number, number] = [5, 0, -0.6]
    const flat = layoutHvac(walls, rooms, LOD400, { heatPump: { position: at, yaw: Math.PI } })
    const spun = layoutHvac(walls, rooms, LOD400, {
      heatPump: { position: at, yaw: Math.PI + Math.PI / 4 },
    })
    const flatPad = padsOf(flat.members)[0] as Member
    const spunPad = padsOf(spun.members)[0] as Member
    // both slid off the too-close anchor; the 45° pad slid FURTHER
    expect(-spunPad.position[2]).toBeGreaterThan(-flatPad.position[2] + 0.1)
    // pad yaw follows the assembly in both
    expect(flatPad.rotation[1]).toBe(Math.PI)
    expect(spunPad.rotation[1]).toBe(Math.PI + Math.PI / 4)
    // the oblique slide leaves the cabinet overhanging — flagged, never silent
    expect(spunPad.flag ?? '').toContain('overhang')
  })
})
