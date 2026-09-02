import { describe, expect, test } from 'bun:test'
import { Euler, Matrix4, Vector3 } from 'three'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member, OpeningSlice, SlabSlice, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { COURSE_HEIGHT, MIXED_CORNER_FLAG, cmuDowelPositions, cmuWall, cmuWalls, mixedCmuWall } from './cmu'
import { applyDeviceOverrides, layoutElectrical, pointInPolygon } from './electrical'
import { frameFloor } from './floor-framing'
import { buildFoundation } from './foundation'
import { layoutPlumbing } from './plumbing'
import { frameRoofs, type RoofSegmentSlice } from './roof-framing'
import { dedupeFoundationStraps, frameWall, frameWalls } from './wall-framing'
import { lgsFrameWalls } from './lgs-wall-framing'
import { layoutWallLayers } from './wall-layers'
import type { PlacedFixtureSlice } from '../core/wall-model'
import type { RoomSlice } from '../core/types'

/**
 * Repo-wide interpenetration gate (round-10): no two STRUCTURAL members of
 * one engine may occupy the same volume, across a matrix of scenarios per
 * engine. Members are oriented boxes — the test runs a 15-axis SAT
 * (separating axis theorem) on the world-composed OBBs, shrunk by a small
 * epsilon so face/edge CONTACT (blocking between joists, plates on studs)
 * never trips it; only real volume overlap does.
 *
 * Connectors that wrap or embed by design are allow-listed by role pair
 * (hangers around joists, anchor bolts through mudsills, rebar inside
 * concrete/masonry). MEP engines are out of scope — pipes, wires and ducts
 * legitimately cross structure and each other's envelopes at LOD 400
 * (penetrations are real); their geometry is validated by their own suites.
 */

// ---------------------------------------------------------------------------
// Oriented-box SAT
// ---------------------------------------------------------------------------

/** Shrink applied to each half-extent — face contact is not interpenetration. */
const SKIN = 0.002

type Obb = {
  center: Vector3
  /** local axes (columns of the rotation matrix) */
  axes: [Vector3, Vector3, Vector3]
  /** half extents AFTER the skin shrink */
  half: [number, number, number]
  /** world-space AABB for prefiltering */
  min: Vector3
  max: Vector3
  member: Member
}

function toObb(member: Member): Obb {
  const [rx, ry, rz] = member.rotation
  const m = new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz, 'XYZ'))
  const e = m.elements
  const axes: [Vector3, Vector3, Vector3] = [
    new Vector3(e[0], e[1], e[2]),
    new Vector3(e[4], e[5], e[6]),
    new Vector3(e[8], e[9], e[10]),
  ]
  const half: [number, number, number] = [
    Math.max(1e-4, member.dims[0] / 2 - SKIN),
    Math.max(1e-4, member.dims[1] / 2 - SKIN),
    Math.max(1e-4, member.dims[2] / 2 - SKIN),
  ]
  const center = new Vector3(member.position[0], member.position[1], member.position[2])
  // AABB of the OBB: center ± Σ |axis_i| · half_i
  const ext = new Vector3(
    Math.abs(axes[0].x) * half[0] + Math.abs(axes[1].x) * half[1] + Math.abs(axes[2].x) * half[2],
    Math.abs(axes[0].y) * half[0] + Math.abs(axes[1].y) * half[1] + Math.abs(axes[2].y) * half[2],
    Math.abs(axes[0].z) * half[0] + Math.abs(axes[1].z) * half[1] + Math.abs(axes[2].z) * half[2],
  )
  return {
    center,
    axes,
    half,
    min: center.clone().sub(ext),
    max: center.clone().add(ext),
    member,
  }
}

function aabbTouch(a: Obb, b: Obb): boolean {
  return (
    a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z
  )
}

/** Projected radius of an OBB onto a unit axis. */
function radius(o: Obb, axis: Vector3): number {
  return (
    Math.abs(o.axes[0].dot(axis)) * o.half[0] +
    Math.abs(o.axes[1].dot(axis)) * o.half[1] +
    Math.abs(o.axes[2].dot(axis)) * o.half[2]
  )
}

function obbOverlap(a: Obb, b: Obb): boolean {
  const t = new Vector3().subVectors(b.center, a.center)
  const axes: Vector3[] = [...a.axes, ...b.axes]
  for (const ax of a.axes) {
    for (const bx of b.axes) {
      const cross = new Vector3().crossVectors(ax, bx)
      // parallel axes produce a degenerate cross — the face axes cover it
      if (cross.lengthSq() > 1e-8) axes.push(cross.normalize())
    }
  }
  for (const axis of axes) {
    if (Math.abs(t.dot(axis)) > radius(a, axis) + radius(b, axis)) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Design-intent contacts (unordered role pairs that legitimately overlap)
// ---------------------------------------------------------------------------

const ALLOWED: ReadonlySet<string> = new Set(
  [
    // Hangers wrap the carried member AND face-mount on the carrier.
    ['hanger', 'joist'],
    ['hanger', 'girder'],
    ['hanger', 'rim-joist'],
    ['hanger', 'blocking'],
    ['hanger', 'header'],
    ['hanger', 'rafter'],
    ['hanger', 'top-plate'],
    ['hanger', 'cap-plate'],
    // Anchor hardware threads through the sill into the concrete below.
    ['anchor-bolt', 'mudsill'],
    // …and on slab-on-grade there IS no mudsill member: the foundation's
    // bolts rise through the wall engine's bottom plate — the (PT, R317.1)
    // sole plate they exist to clamp (R403.1.6). Closes the S1 residual
    // 'anchor-bolt × bottom-plate' class (LOD-400 audit B5).
    ['anchor-bolt', 'bottom-plate'],
    ['anchor-bolt', 'stemwall'],
    ['anchor-bolt', 'footing'],
    ['anchor-bolt', 'bond-beam'],
    ['anchor-bolt', 'plate-washer'],
    ['plate-washer', 'mudsill'],
    ['hold-down', 'mudsill'],
    ['hold-down', 'stemwall'],
    ['hold-down', 'stud'],
    ['hold-down', 'king-stud'],
    // …and the CS-PF portal hold-down post (B9): the HDU body exists to
    // CLAMP that post — same design intent as the stud/king-stud pairs.
    ['hold-down', 'post'],
    // The HDU standoff base bears ON the sole plate at its anchor (the
    // foundation emits the body from the plate line up the post by design —
    // R602.10.4.4 practice). Pre-existing on every seismic slab-on-grade
    // wall; first composed by the B9 garage-portal scenario.
    ['hold-down', 'bottom-plate'],
    ['hold-down', 'anchor-bolt'],
    // Rebar embeds inside concrete and grouted masonry by definition, and
    // bars LAP each other (hooked verticals into the bond-beam bar, corner
    // laps) — bar-to-bar overlap is the detailing intent, not a clash.
    ['rebar', 'rebar'],
    ['rebar', 'block'],
    ['rebar', 'bond-beam'],
    ['rebar', 'lintel'],
    ['rebar', 'footing'],
    ['rebar', 'stemwall'],
    // Mixed-wall seam bolts embed 7" into the grouted bond beam (R403.1.6)
    // exactly where its horizontal bars run — a J-bolt sits beside/around
    // the bar inside the grout (tie-wired in practice). Thin walls carry a
    // single CENTERED beam bar, so the box-vs-box model cannot offset the
    // two apart; the coexistence is the detailing intent, not a clash.
    ['anchor-bolt', 'rebar'],
  ].map(([x, y]) => pairKey(x as string, y as string)),
)

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * LGS design-intent nesting (Phase 1, box-envelope geometry): C-studs SEAT
 * INSIDE their tracks — member ends bear on the track WEB, between its
 * flanges — so the stud box overlaps the track's flange band by design
 * (exactly like an anchor bolt threads its plate). MATERIAL- and
 * WALL-SCOPED, never a blanket role pair: both members must be steel
 * catalog profiles of the SAME wall, so a lumber stud overlapping a lumber
 * plate (a real defect) still trips the gate.
 */
const STEEL_NEST: ReadonlySet<string> = new Set(
  [
    ['stud', 'bottom-plate'],
    ['stud', 'top-plate'],
    ['king-stud', 'bottom-plate'],
    ['king-stud', 'top-plate'],
    ['trimmer', 'bottom-plate'],
    ['cripple', 'bottom-plate'],
    ['cripple', 'top-plate'],
    ['cripple', 'sill'],
  ].map(([x, y]) => pairKey(x as string, y as string)),
)

function steelNestContact(a: Member, b: Member): boolean {
  return (
    a.material === 'steel' &&
    b.material === 'steel' &&
    a.system === 'wall-framing' &&
    b.system === 'wall-framing' &&
    a.profile !== undefined &&
    b.profile !== undefined &&
    a.sourceId === b.sourceId &&
    STEEL_NEST.has(pairKey(a.role, b.role))
  )
}

function violations(members: Member[]): string[] {
  // A member with non-finite geometry would make every AABB/SAT comparison
  // false and let broken scenarios pass VACUOUSLY (round-11 blocker: a bad
  // slab fixture composed all floor members at NaN Y and the gate saw
  // nothing). Non-finite geometry is itself a violation.
  const bad: string[] = []
  for (const m of members) {
    const nums = [...m.dims, ...m.position, ...m.rotation, m.length]
    if (nums.some((v) => !Number.isFinite(v))) {
      bad.push(`${m.role}(${m.label ?? ''}) has non-finite geometry`)
    }
  }
  if (bad.length > 0) return bad
  const obbs = members.map(toObb)
  for (let i = 0; i < obbs.length; i++) {
    const a = obbs[i] as Obb
    for (let j = i + 1; j < obbs.length; j++) {
      const b = obbs[j] as Obb
      if (!aabbTouch(a, b)) continue
      if (ALLOWED.has(pairKey(a.member.role, b.member.role))) continue
      if (steelNestContact(a.member, b.member)) continue
      if (!obbOverlap(a, b)) continue
      bad.push(
        `${a.member.role}(${a.member.label ?? ''}) @${a.member.position.map((v) => v.toFixed(2)).join(',')}` +
          ` × ${b.member.role}(${b.member.label ?? ''}) @${b.member.position.map((v) => v.toFixed(2)).join(',')}`,
      )
      if (bad.length >= 12) return bad // enough to diagnose
    }
  }
  return bad
}

// ---------------------------------------------------------------------------
// Scenario matrix
// ---------------------------------------------------------------------------

const spec400 = { ...DEFAULT_SPEC, detail: '400' as const }

function wall(overrides: Partial<WallSlice> = {}): WallSlice {
  const start = overrides.start ?? [0, 0]
  const end = overrides.end ?? [6, 0]
  const dx = (end[0] ?? 0) - (start[0] ?? 0)
  const dz = (end[1] ?? 0) - (start[1] ?? 0)
  const length = Math.hypot(dx, dz)
  return {
    id: 'wall_gate',
    start,
    end,
    dir: [dx / length, dz / length],
    length,
    height: 2.44,
    thickness: 0.114,
    exterior: true,
    curved: false,
    openings: [],
    ...overrides,
  }
}

const door = (u: number): OpeningSlice => ({
  id: `door_${u}`,
  kind: 'door',
  u,
  width: 0.9,
  roughWidth: 0.95,
  height: 2.1,
  roughHeight: 2.15,
  sillHeight: 0,
})

const window_ = (u: number): OpeningSlice => ({
  id: `win_${u}`,
  kind: 'window',
  u,
  width: 1.2,
  roughWidth: 1.25,
  height: 1.2,
  roughHeight: 1.25,
  sillHeight: 0.9,
})

function slab(polygon: [number, number][], overrides: Partial<SlabSlice> = {}): SlabSlice {
  return { id: 'slab_gate', polygon, elevation: 0, thickness: 0.2, holes: [], ...overrides }
}

const rect = (w: number, d: number): [number, number][] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
]

function roofSeg(overrides: Partial<RoofSegmentSlice> = {}): RoofSegmentSlice {
  return {
    id: 'roofseg_gate',
    roofType: 'gable',
    position: [0, 2.5, 0],
    yaw: 0,
    width: 8,
    depth: 6,
    pitch: (40 * Math.PI) / 180,
    overhang: 0.3,
    wallHeight: 0.5,
    ...overrides,
  }
}

/** A closed 6×4 rectangle of exterior walls (foundation + corners). */
function rectWalls(): WallSlice[] {
  return [
    wall({ id: 'w_s', start: [0, 0], end: [6, 0] }),
    wall({ id: 'w_e', start: [6, 0], end: [6, 4] }),
    wall({ id: 'w_n', start: [6, 4], end: [0, 4] }),
    wall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
  ]
}

describe('interpenetration gate — structural members never share volume', () => {
  test('wall framing: openings, thick wall, short wall', () => {
    expect(violations(frameWall(wall({ openings: [door(2), window_(4.2)] }), spec400))).toEqual([])
    expect(violations(frameWall(wall({ thickness: 0.15, openings: [window_(3)] }), spec400))).toEqual([])
    expect(violations(frameWall(wall({ end: [1.2, 0] }), spec400))).toEqual([])
  })

  test('device blocking (movable outlets): the off-stud block composes SAT-clean with the wall framing', () => {
    // A sparse rhythm (grid studs thinned out) forces the off-stud path:
    // the moved box keeps its spot and books a 'device blocking' member
    // between the bay's remaining studs — that block must share volume
    // with NOTHING (face contact with the studs is the design intent).
    const w = wall({ id: 'w_dev' })
    const framing = frameWall(w, spec400)
    const sparse = framing.filter((m) => {
      if (m.role !== 'stud') return true
      const u = (m.position[0] - w.start[0]) * w.dir[0] + (m.position[2] - w.start[1]) * w.dir[1]
      return u < 0.5 || u > 2.4 // open a ~1.9 m bay mid-wall
    })
    const fixtures = layoutElectrical([w], [])
    const id = String(fixtures.find((f) => f.kind === 'receptacle')?.meta?.deviceId)
    const applied = applyDeviceOverrides(
      fixtures,
      [w],
      [],
      sparse,
      new Map([[id, { wallId: w.id, wallT: 1.5 / w.length, heightAff: 0.45 }]]),
    )
    expect(applied.members.map((m) => m.label)).toEqual(['device blocking — box off-stud'])
    expect(violations([...sparse, ...applied.members])).toEqual([])
  })

  test('wall framing + assembly layers: default rectangle (round-14)', () => {
    // Round-14 blocker: equal-length corners inset NEITHER wall's layers →
    // 20 clashes on a plain drawn rectangle. Framing + layers together.
    const rectangle = [
      wall({ id: 'w_s', start: [0, 0], end: [6, 0] }),
      wall({ id: 'w_e', start: [6, 0], end: [6, 4] }),
      wall({ id: 'w_n', start: [6, 4], end: [0, 4] }),
      wall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms = [
      {
        id: 'room_r',
        name: 'room',
        category: 'other' as const,
        polygon: [[0, 0], [6, 0], [6, 4], [0, 4]] as [number, number][],
        boundaryWallIds: ['w_s', 'w_e', 'w_n', 'w_w'],
        ceilingHeight: 2.7,
      },
    ]
    const combined = [
      ...frameWalls(rectangle, spec400),
      ...layoutWallLayers(rectangle, rooms, spec400, 'NY'),
    ]
    expect(violations(combined)).toEqual([])
  })

  test('wall framing + layers + insulation batts: rectangle with openings (engineering panel)', () => {
    // Batts fill the stud bays — they must lay out against the framing's
    // OWN trimmed runs, corner backing studs and opening frames, so the
    // composed member set stays SAT-clean with NO allow-list entry for
    // insulation (a batt across a stud would be a real violation).
    const rectangle = [
      wall({ id: 'w_s', start: [0, 0], end: [6, 0], openings: [door(2), window_(4.2)] }),
      wall({ id: 'w_e', start: [6, 0], end: [6, 4] }),
      wall({ id: 'w_n', start: [6, 4], end: [0, 4], openings: [window_(3)] }),
      wall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms = [
      {
        id: 'room_r',
        name: 'room',
        category: 'other' as const,
        polygon: [[0, 0], [6, 0], [6, 4], [0, 4]] as [number, number][],
        boundaryWallIds: ['w_s', 'w_e', 'w_n', 'w_w'],
        ceilingHeight: 2.7,
      },
    ]
    const overrides = new Map(
      rectangle.map((w) => [w.id, { insulation: 'batt' as const }]),
    )
    const combined = [
      ...frameWalls(rectangle, spec400),
      ...layoutWallLayers(rectangle, rooms, spec400, 'NY', [], overrides),
    ]
    expect(combined.some((m) => m.role === 'insulation')).toBe(true)
    expect(violations(combined)).toEqual([])
  })

  test('0.15m zone-5 wall: batts compress into the layer cavity, never share volume (verify S1)', () => {
    // The blocker case the 0.114m gates missed: NY (zone 5) books a nominal
    // 5.5" batt, but a 0.15m wall's layer stacks start at (0.15-1")/2 from
    // center — the batt must compress to that cavity, not poke 7.55mm into
    // the gypsum. Framing×layer pairs at 0.15m are the QUEUED pre-existing
    // stackOrigin flaw, so this gate owns the INSULATION pairs only.
    const w015 = wall({ id: 'w_thick', start: [0, 0], end: [6, 0], thickness: 0.15 })
    const rooms = [
      {
        id: 'room_r',
        name: 'room',
        category: 'other' as const,
        polygon: [[0, 0], [6, 0], [6, 4], [0, 4]] as [number, number][],
        boundaryWallIds: ['w_thick'],
        ceilingHeight: 2.7,
      },
    ]
    const overrides = new Map([['w_thick', { insulation: 'batt' as const }]])
    const combined = [
      ...frameWall(w015, spec400),
      ...layoutWallLayers([w015], rooms, spec400, 'NY', [], overrides),
    ]
    const batts = combined.filter((m) => m.role === 'insulation')
    expect(batts.length).toBeGreaterThan(0)
    // Nominal 5.5" (0.1397m) does not fit — depth capped at thickness - 1".
    for (const b of batts) {
      expect(b.dims[2]).toBeLessThanOrEqual(0.15 - 0.0254 + 1e-9)
      expect(b.flag).toContain('compressed')
    }
    expect(violations(combined).filter((v) => v.includes('insulation'))).toEqual([])
  })

  test('cavity-fit sweep: framing+layers+batts SAT-clean at EVERY thickness (night-4 S1)', () => {
    // The redesign's crown gate: the 140-pair default-scene interpenetration
    // class is dead at every drawn thickness, with and without explicit
    // stud overrides, batts on, opening frames included. Compressed stud
    // faces land exactly on the layer stacks' origin — contact, not overlap.
    const rooms = [
      {
        id: 'room_r',
        name: 'room',
        category: 'other' as const,
        polygon: [[0, 0], [6, 0], [6, 4], [0, 4]] as [number, number][],
        boundaryWallIds: ['w_s', 'w_e', 'w_n', 'w_w'],
        ceilingHeight: 2.7,
      },
    ]
    for (const th of [0.09, 0.1, 0.114, 0.13, 0.15, 0.164, 0.165, 0.2]) {
      for (const studSize of [undefined, '2x4' as const, '2x6' as const]) {
        const rect = [
          wall({ id: 'w_s', start: [0, 0], end: [6, 0], thickness: th, openings: [door(2), window_(4.2)] }),
          wall({ id: 'w_e', start: [6, 0], end: [6, 4], thickness: th }),
          wall({ id: 'w_n', start: [6, 4], end: [0, 4], thickness: th, openings: [window_(3)] }),
          wall({ id: 'w_w', start: [0, 4], end: [0, 0], thickness: th }),
        ]
        const framingOv = new Map(
          rect.map((w) => [w.id, studSize ? { studSize } : {}]),
        )
        const layerOv = new Map(
          rect.map((w) => [w.id, { ...(studSize ? { studSize } : {}), insulation: 'batt' as const }]),
        )
        const combined = [
          ...frameWalls(rect, spec400, framingOv),
          ...layoutWallLayers(rect, rooms, spec400, 'NY', [], layerOv),
        ]
        const label = `th=${th} stud=${studSize ?? 'default'}`
        expect(violations(combined), label).toEqual([])
        // batt depth never exceeds the framing geometry depth (parity)
        const studGeom = combined.find((m) => m.role === 'stud')?.dims[2] as number
        for (const b of combined.filter((m) => m.role === 'insulation')) {
          expect(b.dims[2], label).toBeLessThanOrEqual(studGeom + 1e-9)
        }
      }
    }
  })

  test('tee trio: perpendicular, REVERSE-direction and OBLIQUE stems compose SAT-clean with layers (night-5)', () => {
    // The queued trio: stem face layers used to run to the through
    // CENTERLINE (no tee inset in the layer engine), and oblique stems
    // inset by plain t/2 in the framing. Full composed SAT, no filtering.
    const rooms = [
      {
        id: 'room_r',
        name: 'room',
        category: 'other' as const,
        polygon: [[0, 0], [8, 0], [8, 6], [0, 6]] as [number, number][],
        boundaryWallIds: ['w_th'],
        ceilingHeight: 2.7,
      },
    ]
    const cases: { name: string; stem: WallSlice }[] = [
      // stem END lands on the through wall (forward)
      { name: 'perpendicular-fwd', stem: wall({ id: 'w_stem', start: [4, 3], end: [4, 0], exterior: false }) },
      // stem START lands on the through wall (reverse direction)
      { name: 'perpendicular-rev', stem: wall({ id: 'w_stem', start: [4, 0], end: [4, 3], exterior: false }) },
      // oblique 45° stem into the through wall
      { name: 'oblique-45', stem: wall({ id: 'w_stem', start: [5.5, 1.5], end: [4, 0], exterior: false }) },
      // shallow oblique ~27°
      { name: 'oblique-27', stem: wall({ id: 'w_stem', start: [6, 1], end: [4, 0], exterior: false }) },
    ]
    for (const c of cases) {
      const through = wall({ id: 'w_th', start: [0, 0], end: [8, 0] })
      const set = [through, c.stem]
      const combined = [
        ...frameWalls(set, spec400),
        ...layoutWallLayers(set, rooms, spec400, 'NY'),
      ]
      expect(violations(combined), c.name).toEqual([])
      // non-vacuous: the stem really framed and layered
      expect(combined.some((m) => m.sourceId === 'w_stem' && m.role === 'stud'), c.name).toBe(true)
      expect(combined.some((m) => m.sourceId === 'w_stem' && m.role === 'drywall'), c.name).toBe(true)
    }
  })

  test('TX brick-default rectangle: veneer + air gap SAT-clean at corners (S9)', () => {
    // The brick wythe sits a full 1" airspace beyond the WRB (round-2 air
    // gap fix) — this pins the moved wythes clashing with nothing,
    // including wythe-vs-wythe at the four corners (skeptic advisory: the
    // matrix had no brick-state scenario).
    const rectangle = [
      wall({ id: 'w_s', start: [0, 0], end: [6, 0] }),
      wall({ id: 'w_e', start: [6, 0], end: [6, 4] }),
      wall({ id: 'w_n', start: [6, 4], end: [0, 4] }),
      wall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms = [
      {
        id: 'room_r',
        name: 'room',
        category: 'other' as const,
        polygon: [[0, 0], [6, 0], [6, 4], [0, 4]] as [number, number][],
        boundaryWallIds: ['w_s', 'w_e', 'w_n', 'w_w'],
        ceilingHeight: 2.7,
      },
    ]
    const combined = [
      ...frameWalls(rectangle, spec400),
      ...layoutWallLayers(rectangle, rooms, spec400, 'TX'),
    ]
    expect(combined.some((m) => m.role === 'cladding' && m.label?.includes('wythe'))).toBe(true)
    expect(violations(combined)).toEqual([])
  })

  test('batts + tee partition backing: ladder bay skipped, SAT-clean (engineering panel)', () => {
    const composed = [
      wall({ id: 'w_through', start: [0, 0], end: [6, 0] }),
      wall({ id: 'w_butt', start: [0, 0], end: [0, 4] }),
      wall({ id: 'w_stem', start: [3, 0], end: [3, 2.5] }),
    ]
    const overrides = new Map(composed.map((w) => [w.id, { insulation: 'batt' as const }]))
    // Framing + batts only: the stem's FACE layers (drywall) crossing the
    // through wall's plates at a tee is a PRE-EXISTING runInsets gap
    // (endpoint-only corner detection — queued on the night board); this
    // gate owns the batt surface: batts must skip the backing-ladder bay
    // and never share volume with any framing member.
    const members = [
      ...frameWalls(composed, spec400),
      ...layoutWallLayers(composed, [], spec400, 'NY', [], overrides).filter(
        (m) => m.role === 'insulation',
      ),
    ]
    expect(members.some((m) => m.role === 'insulation')).toBe(true)
    expect(violations(members)).toEqual([])
  })

  test('tall wall batts split around LOD-400 fire blocking (engineering panel)', () => {
    const tall = wall({ id: 'w_tall', height: 3.6 })
    const members = [
      ...frameWalls([tall], spec400),
      ...layoutWallLayers(
        [tall],
        [],
        spec400,
        'NY',
        [],
        new Map([['w_tall', { insulation: 'batt' as const }]]),
      ),
    ]
    expect(members.some((m) => m.role === 'fire-blocking')).toBe(true)
    expect(members.some((m) => m.role === 'insulation')).toBe(true)
    expect(violations(members)).toEqual([])
  })

  test('wall framing: oblique corners 20/45/60/135° (round-14)', () => {
    for (const deg of [20, 45, 60, 135]) {
      const th = (deg * Math.PI) / 180
      const pair = [
        wall({ id: 'w_base', start: [0, 0], end: [6, 0] }),
        wall({ id: 'w_ob', start: [6, 0], end: [6 + 4 * Math.cos(th), 4 * Math.sin(th)] }),
      ]
      expect({ deg, v: violations(frameWalls(pair, spec400)) }).toEqual({ deg, v: [] })
    }
  })

  test('wall framing: L-corner + tee composition (round-10)', () => {
    // An L pair plus a partition tee — the butting/stem frames must stop at
    // the through wall's face instead of sharing the corner volume.
    const composed = frameWalls(
      [
        wall({ id: 'w_through', start: [0, 0], end: [6, 0] }),
        wall({ id: 'w_butt', start: [0, 0], end: [0, 4] }),
        wall({ id: 'w_stem', start: [3, 0], end: [3, 2.5] }),
      ],
      spec400,
    )
    expect(violations(composed)).toEqual([])
  })

  test('floor framing: plain, hole, multi-girder span', () => {
    expect(violations(frameFloor([slab(rect(4, 6))], [], spec400))).toEqual([])
    // stair hole mid-span forces trimmers/headers/tail pieces
    expect(
      violations(
        frameFloor(
          [slab(rect(6, 9), { holes: [[[2, 3], [4, 3], [4, 5], [2, 5]]] })],
          [],
          spec400,
        ),
      ),
    ).toEqual([])
    // 12×12 needs TWO girders (round-9 scenario)
    expect(violations(frameFloor([slab(rect(12, 12))], [], spec400))).toEqual([])
  })

  test('roof framing: flat, gambrel, big gable, steep hip (round-14)', () => {
    const cases: [string, Partial<RoofSegmentSlice>][] = [
      ['flat', { roofType: 'flat' }],
      ['gambrel', { roofType: 'gambrel' }],
      ['gambrel60', { roofType: 'gambrel', pitch: (60 * Math.PI) / 180 }],
      ['bigGable', { width: 16, depth: 12 }],
      // the B2 audit repro: purlin row + struts compose SAT-clean against
      // rafters, ceiling joists, collar ties and the dropped end rafters
      ['reproGable', { width: 10, depth: 12 }],
      ['hip60', { roofType: 'hip', pitch: (60 * Math.PI) / 180 }],
      ['gable10', { pitch: (10 * Math.PI) / 180 }],
    ]
    for (const [name, over] of cases) {
      expect({ name, v: violations(frameRoofs([roofSeg(over)], [], spec400)) }).toEqual({
        name,
        v: [],
      })
    }
  })

  test('floor framing: rotated slabs 10/30/45° (round-14)', () => {
    for (const deg of [10, 30, 45]) {
      const th = (deg * Math.PI) / 180
      const cos = Math.cos(th)
      const sin = Math.sin(th)
      const rot = (x: number, z: number): [number, number] => [
        x * cos - z * sin,
        x * sin + z * cos,
      ]
      const poly = [rot(0, 0), rot(6, 0), rot(6, 9), rot(0, 9)]
      expect({
        deg,
        v: violations(frameFloor([slab(poly)], [], spec400)),
      }).toEqual({ deg, v: [] })
    }
  })

  test('roof framing: gable, hip', () => {
    expect(violations(frameRoofs([roofSeg()], [], spec400))).toEqual([])
    expect(violations(frameRoofs([roofSeg({ roofType: 'hip' })], [], spec400))).toEqual([])
  })

  test('roof framing: SQUARE hips — the degenerate pyramid apex composes SAT-clean (NIGHT-10)', () => {
    // Pre-existing residual, never gated: width == depth drops the ridge
    // board (ridgeHalf 0) and layout() parks the apex common pair OFF-CENTER
    // — the two hips pointing at the pair's overhung side drove through it
    // (2 hip×common SAT pairs at the ridge point, byte-identical across 3
    // branches). The apex trim now bears those hips on the pair's FAR face.
    // The square mansard CROWN is the same code path (inner frameHip).
    // Non-vacuous: hips and commons must exist in every case. SCOPE: cases
    // run NON-windy — windy SLOPED roofs carry a distinct pre-existing
    // class (tieAt centers the steel ON the rafter station at every gable/
    // shed/hip bearing, 28-44 SAT pairs each on the rect defaults; only the
    // FLAT windy shape got the B8b beside-the-joist fix and joined the
    // matrix) — board-queued, not this residual's class.
    const cases: [string, Partial<RoofSegmentSlice>][] = [
      ['square8', { roofType: 'hip', width: 8, depth: 8 }],
      ['square6', { roofType: 'hip', width: 6, depth: 6 }],
      ['square10steep', { roofType: 'hip', width: 10, depth: 10, pitch: (60 * Math.PI) / 180 }],
      ['square10shallow', { roofType: 'hip', width: 10, depth: 10, pitch: (25 * Math.PI) / 180 }],
      ['nearSquareSliver', { roofType: 'hip', width: 8, depth: 7.95 }],
      ['mansardSquareCrown', { roofType: 'mansard', width: 8, depth: 8 }],
    ]
    for (const [name, over] of cases) {
      const members = frameRoofs([roofSeg(over)], [], spec400)
      expect({
        name,
        hips: members.filter((m) => m.role === 'hip').length >= 4,
        commons: members.some((m) => m.label?.includes('(hip common)')),
        v: violations(members),
      }).toEqual({ name, hips: true, commons: true, v: [] })
    }
  })

  // Two intersecting segments still interpenetrate where the wing meets the
  // main roof: proper overframing (California valley) stops the wing's
  // near-slope rafters and ceiling joists AT the valley boards instead of
  // running them through the main roof's volume. That is the multi-segment
  // clipping feature - tracked for the next round; the valley boards and
  // jacks themselves already exist.
  test.todo('roof framing: intersecting gable pair clips at the valley (overframing)', () => {})

  test('roof framing: WINDY flat — B8b hurricane ties compose SAT-clean beside joists and rims', () => {
    // Non-vacuous: ties must exist (2 per joist). The connectors nail to the
    // joist FACES at the plate line — beside-offset + rim clamp keep the
    // steel out of every joist/rim volume (zero-overhang worst case incl.)
    const windy400 = { ...spec400, hurricaneTies: true }
    const cases: [string, Partial<RoofSegmentSlice>][] = [
      ['flat', { roofType: 'flat' }],
      ['flatWide', { roofType: 'flat', width: 12, depth: 8 }],
      ['flatZeroOverhang', { roofType: 'flat', overhang: 0 }],
      // fix round (skeptic F1): the end-gap WINDOW — layout's guaranteed end
      // station can survive < tieClear + tieHalf + t/2 from its neighbor.
      // 6.9×5 → gap 0.0705 (the skeptic repro: end tie 13 mm off the
      // neighbor joist centerline + tie×tie 0.0705 < 0.0762); 2×2 @ zero
      // overhang → gap 0.0571 (2 rafter×tie + 2 tie×tie hits pre-fix).
      ['flatEndGapWindow', { roofType: 'flat', width: 6.9, depth: 5 }],
      ['flatTightZero', { roofType: 'flat', width: 2, depth: 2, overhang: 0 }],
    ]
    for (const [name, over] of cases) {
      const members = frameRoofs([roofSeg(over)], [], windy400)
      expect({
        name,
        ties: members.filter((m) => m.label?.startsWith('hurricane tie')).length > 0,
        v: violations(members),
      }).toEqual({ name, ties: true, v: [] })
    }
  })

  test('roof framing: B8d gambrel break struts + rake ladder compose SAT-clean (non-vacuous)', () => {
    // Struts thread between joists (feet ON them), the purlin underside and
    // the kink rafters; the rake ladder (barges + outlookers + rake drip)
    // rides over the dropped end rafters under the widened deck — the exact
    // classes the gate names: struts vs purlins/rafters, ladder vs deck/drip.
    const cases: [string, Partial<RoofSegmentSlice>][] = [
      ['gambrel40', { roofType: 'gambrel' }],
      ['gambrel25', { roofType: 'gambrel', pitch: (25 * Math.PI) / 180 }],
      ['gambrel60b8', { roofType: 'gambrel', pitch: (60 * Math.PI) / 180 }],
      ['gambrelWide', { roofType: 'gambrel', width: 12, depth: 8 }],
    ]
    for (const [name, over] of cases) {
      const members = frameRoofs([roofSeg(over)], [], spec400)
      expect({
        name,
        struts: members.some((m) => m.role === 'post'),
        ladder: members.some((m) => m.role === 'outlooker'),
        rakeDrip: members.filter((m) => m.role === 'drip-edge' && m.label?.includes('rake')).length,
        v: violations(members),
      }).toEqual({ name, struts: true, ladder: true, rakeDrip: 8, v: [] })
    }
  })

  test('roof framing: mansard + dutch skirts inscribe at arris hips (round-14)', () => {
    for (const type of ['mansard', 'dutch'] as const) {
      expect({
        type,
        v: violations(frameRoofs([roofSeg({ roofType: type })], [], spec400)),
      }).toEqual({ type, v: [] })
    }
  })

  test('roof framing: B7 thrust members (ceiling joists + collar ties) compose SAT-clean across the hip family', () => {
    // Joists thread UNDER jacks, kings, hips, the B6 deck/underlayment and
    // the fascia band; ties thread BETWEEN the commons under the ridge —
    // non-vacuous: every case must actually carry ceiling joists.
    const cases: [string, Partial<RoofSegmentSlice>][] = [
      ['hipAudit', { roofType: 'hip', width: 10, depth: 12 }], // the B7 audit repro
      ['hip25', { roofType: 'hip', pitch: (25 * Math.PI) / 180 }], // snapped-station collapse repro
      ['hip75', { roofType: 'hip', pitch: (75 * Math.PI) / 180 }],
      ['hipWide', { roofType: 'hip', width: 16, depth: 14 }],
      ['hipZspan', { roofType: 'hip', width: 6, depth: 8 }],
      ['mansard55', { roofType: 'mansard', pitch: (55 * Math.PI) / 180 }], // steep crown ties live
      ['mansard25', { roofType: 'mansard', pitch: (25 * Math.PI) / 180 }], // near-flat crown: ridge-skip guard
      ['dutch25', { roofType: 'dutch', pitch: (25 * Math.PI) / 180 }],
      ['dutch70', { roofType: 'dutch', pitch: (70 * Math.PI) / 180 }],
      ['dutchWide', { roofType: 'dutch', width: 16, depth: 10 }],
    ]
    for (const [name, over] of cases) {
      const members = frameRoofs([roofSeg(over)], [], spec400)
      expect({
        name,
        cj: members.some((m) => m.role === 'ceiling-joist'),
        v: violations(members),
      }).toEqual({ name, cj: true, v: [] })
    }
  })
  const UNUSED = () => {
    expect(
      violations(
        frameRoofs(
          [
            roofSeg(),
            roofSeg({
              id: 'roofseg_wing',
              width: 4,
              depth: 4,
              yaw: Math.PI / 2,
              position: [1, 2.5, 4],
            }),
          ],
          [],
          spec400,
        ),
      ),
    ).toEqual([])
  }
  void UNUSED

  test('foundation: closed rectangle with slab', () => {
    expect(violations(buildFoundation(rectWalls(), [slab(rect(6, 4))], spec400))).toEqual([])
  })

  test('foundation: slab-on-grade field with a stair hole — carved, SAT-clean (B17)', () => {
    // The field + vapor retarder tile around the opening AND around every
    // stemwall/interior-footing band; the composed pour may not overlap
    // itself, the perimeter kit, or reach into the hole.
    const members = buildFoundation(
      rectWalls(),
      [slab(rect(6, 4), { holes: [[[2, 1.2], [3.2, 1.2], [3.2, 2.8], [2, 2.8]]] })],
      spec400,
    )
    const field = members.filter((m) => m.role === 'slab')
    expect(field.length).toBeGreaterThan(0)
    expect(violations(members)).toEqual([])
    for (const m of field) {
      const [hx, hz] = [m.dims[0] / 2, m.dims[2] / 2]
      const ox = Math.min(m.position[0] + hx, 3.2) - Math.max(m.position[0] - hx, 2)
      const oz = Math.min(m.position[2] + hz, 2.8) - Math.max(m.position[2] - hz, 1.2)
      expect(Math.min(ox, oz)).toBeLessThanOrEqual(1e-6)
    }
  })

  test('slab-on-grade compose: anchor bolts clamp the PT sole plate — design intent, never a clash (B5)', () => {
    // Foundation + ground-level walls composed in one SAT pass: the bolts
    // rise through the wall engine's bottom plate — the (PT, R317.1) sole
    // plate they exist to clamp (R403.1.6). The allow-listed pair keeps the
    // S1 gate honest about it.
    const walls = rectWalls()
    const composed = [
      ...buildFoundation(walls, [slab(rect(6, 4))], spec400),
      ...frameWalls(walls, spec400, undefined, { slabBearing: true }),
    ]
    const v = violations(composed)
    expect(v.filter((s) => s.includes('bottom-plate'))).toEqual([])
    // KNOWN pre-existing residual (S1 row): a bolt shank tops out 3" above
    // the slab — 1.5" above the plate — and can land inside a grid stud's
    // footprint. Bolt-vs-stud layout nudging is queued on the board, not
    // B5 scope; the compose must not silently widen beyond that class.
    expect(v.every((s) => s.includes('anchor-bolt') && s.includes('stud'))).toBe(true)
  })

  test('SDC-D garage portal (B9): posts + straps compose SAT-clean with framing, layers and foundation', () => {
    // 16-ft door in a 6.4 m exterior front wall → CS-PF portal set at both
    // narrow returns (R602.10.6.4). The doubled hold-down posts must land in
    // CONTACT with the panel-edge studs (never overlap, grid studs yield)
    // and the 1000-lb straps are surface hardware — flat steel on the
    // framing face under the SAT skin, never inside a stud volume (S1).
    const seismic = { ...spec400, seismicHoldDowns: true }
    const garageDoor = (u: number): OpeningSlice => ({
      id: 'garage_door',
      kind: 'door',
      u,
      width: 4.83,
      roughWidth: 4.877, // 16 ft RO
      height: 2.13,
      roughHeight: 2.17,
      sillHeight: 0,
    })
    const walls = [
      wall({ id: 'w_s', start: [0, 0], end: [6.4, 0], openings: [garageDoor(3.2)] }),
      wall({ id: 'w_e', start: [6.4, 0], end: [6.4, 4] }),
      wall({ id: 'w_n', start: [6.4, 4], end: [0, 4] }),
      wall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms: RoomSlice[] = [
      {
        id: 'room_g',
        name: 'Garage',
        category: 'garage',
        polygon: [[0, 0], [6.4, 0], [6.4, 4], [0, 4]],
        boundaryWallIds: ['w_s', 'w_e', 'w_n', 'w_w'],
        ceilingHeight: 2.44,
      },
    ]
    const framing = frameWalls(walls, seismic, undefined, { slabBearing: true })
    expect(framing.filter((m) => m.role === 'strap')).toHaveLength(2)
    expect(framing.filter((m) => m.role === 'post')).toHaveLength(4)
    // walls + layers alone: strictly clean
    const withLayers = [...framing, ...layoutWallLayers(walls, rooms, seismic, 'CA')]
    expect(violations(withLayers)).toEqual([])
    // + seismic foundation (HDU hold-downs at the braced wall ends): only
    // KNOWN pre-existing residual classes may remain — none involving the
    // portal hardware. This is the FIRST seismic foundation × walls ×
    // layers compose, so it names the classes it inherits (all present in
    // prod CA scenes today, none introduced by B9):
    //  (1) anchor-bolt × stud (the S1 row's documented bolt-shank class)
    //      and its washer sibling plate-washer × stud (the 3" washer
    //      follows its bolt one-for-one under a grid stud's footprint);
    //  (2) corner drywall × hold-down: a layer running to the through
    //      wall's face crosses the neighbor's HDU body at the corner (the
    //      tee/corner layer-vs-hardware family, queued on the board).
    const composed = [...withLayers, ...buildFoundation(walls, [slab(rect(6.4, 4))], seismic)]
    const v = violations(composed)
    expect(v.filter((s) => s.includes('strap') || s.includes('Portal'))).toEqual([])
    const boltKit = (s: string) =>
      s.includes('stud') && (s.includes('anchor-bolt') || s.includes('plate-washer'))
    const cornerLayer = (s: string) => s.includes('drywall') && s.includes('hold-down')
    expect(v.filter((s) => !boltKit(s) && !cornerLayer(s))).toEqual([])
  })

  test('two-storey compose: every girder post bears on its pad, slab carved, SAT-clean (B18d)', () => {
    // The upper storey's floor framing (posts included) composed INTO the
    // ground level's frame (ground_y = upper_local_y + storeyHeight): each
    // 4x4 lands EXACTLY on a pad top at y = 0 — contact, never overlap —
    // and the slab field pours around the pads. Pre-B18d the posts bore on
    // nothing (and over-ran the bearing plane by the girder depth).
    const storeyHeight = 2.5
    const walls = [
      wall({ id: 'w_s', start: [0, 0], end: [8, 0] }),
      wall({ id: 'w_e', start: [8, 0], end: [8, 6] }),
      wall({ id: 'w_n', start: [8, 6], end: [0, 6] }),
      wall({ id: 'w_w', start: [0, 6], end: [0, 0] }),
    ]
    // 6 m clear span forces a girder + posts on the upper floor
    const upperFloor = frameFloor(
      [slab(rect(8, 6), { elevation: 0.05, thickness: 0.05 })],
      [],
      spec400,
      storeyHeight,
    )
    const posts = upperFloor.filter((m) => m.role === 'post')
    expect(posts.length).toBeGreaterThan(0)
    const foundation = buildFoundation(walls, [slab(rect(8, 6))], spec400, {
      girderPosts: posts.map((p) => ({
        plan: [p.position[0], p.position[2]] as const,
        sourceId: p.sourceId,
      })),
    })
    const pads = foundation.filter((m) => m.label?.startsWith('Pad footing'))
    // census: every post has a pad directly under it (or a poured band —
    // none here, the girder runs mid-plan), bearing plane exactly y = 0
    expect(pads.length).toBe(posts.length)
    const composed = [
      ...foundation,
      ...upperFloor.map((m) => ({
        ...m,
        position: [m.position[0], m.position[1] + storeyHeight, m.position[2]] as const,
      })),
    ]
    for (const p of posts) {
      const bottom = p.position[1] + storeyHeight - p.dims[1] / 2
      expect(bottom).toBeCloseTo(0, 6)
      const pad = pads.find(
        (d) =>
          Math.abs((d.position[0] ?? 0) - p.position[0]) < 1e-6 &&
          Math.abs((d.position[2] ?? 0) - p.position[2]) < 1e-6,
      )
      expect(pad).toBeDefined()
    }
    expect(violations(composed)).toEqual([])
  })

  test('foundation: oblique 45° chamfer corner (round-10)', () => {
    const c = 2 * Math.SQRT1_2
    const chamfered = [
      wall({ id: 'w_a', start: [0, 0], end: [4, 0] }),
      wall({ id: 'w_c', start: [4, 0], end: [4 + c, c] }),
      wall({ id: 'w_b', start: [4 + c, c], end: [4 + c, 5] }),
    ]
    expect(violations(buildFoundation(chamfered, [], spec400))).toEqual([])
  })

  test('foundation: 45° chamfered plan WITH the slab field — axis-aligned strips clear the oblique stemwall (B17)', () => {
    // The slab strips are axis-aligned boxes; the chamfer stemwall is a 45°
    // band. The carve is a conservative box per strip — the composed SAT
    // proves no strip reaches into the oblique pour.
    const c = 2 * Math.SQRT1_2
    const plan = [
      wall({ id: 'w_a', start: [0, 0], end: [4, 0] }),
      wall({ id: 'w_c', start: [4, 0], end: [4 + c, c] }),
      wall({ id: 'w_b', start: [4 + c, c], end: [4 + c, 5] }),
      wall({ id: 'w_n', start: [4 + c, 5], end: [0, 5] }),
      wall({ id: 'w_w', start: [0, 5], end: [0, 0] }),
    ]
    const poly: [number, number][] = [
      [0, 0],
      [4, 0],
      [4 + c, c],
      [4 + c, 5],
      [0, 5],
    ]
    const members = buildFoundation(plan, [slab(poly)], spec400)
    expect(members.some((m) => m.role === 'slab')).toBe(true)
    expect(violations(members)).toEqual([])
  })

  test('foundation: Y-junction — three runs sharing one endpoint (round-12)', () => {
    // The crossed-boxes artifact on exported plans: pairwise corner marks
    // let several walls extend through the same point. One through wall,
    // everyone else butts.
    const y = [
      wall({ id: 'w_long', start: [0, 0], end: [6, 0] }),
      wall({ id: 'w_up', start: [6, 0], end: [8, -3] }),
      wall({ id: 'w_down', start: [6, 0], end: [8, 3] }),
    ]
    expect(violations(buildFoundation(y, [], spec400))).toEqual([])
  })

  test('foundation: interior bearing tee stops at the exterior run (round-12)', () => {
    const tee = [
      wall({ id: 'w_s', start: [0, 0], end: [8, 0] }),
      wall({ id: 'w_e', start: [8, 0], end: [8, 6] }),
      wall({ id: 'w_n', start: [8, 6], end: [0, 6] }),
      wall({ id: 'w_w', start: [0, 6], end: [0, 0] }),
      // long interior bearing wall teeing into both perimeter runs
      wall({ id: 'w_int', start: [4, 0], end: [4, 6], exterior: false }),
    ]
    expect(violations(buildFoundation(tee, [], spec400))).toEqual([])
  })

  test('foundation: gabled-plan composite — peaks, oblique runs, interior tee (round-12)', () => {
    // Shaped like the user's exported plan: two non-rectangular loops
    // sharing a spine, with roofline-angled top runs meeting at peaks.
    const plan = [
      wall({ id: 'p_w', start: [0, 4], end: [0, 10] }),
      wall({ id: 'p_s', start: [0, 10], end: [7, 10] }),
      wall({ id: 'p_spine', start: [7, 10], end: [7, 1] }),
      wall({ id: 'p_roofL', start: [0, 4], end: [7, 1] }),
      wall({ id: 'p_roofR', start: [7, 1], end: [14, 3] }),
      wall({ id: 'p_e', start: [14, 3], end: [14, 11] }),
      wall({ id: 'p_s2', start: [14, 11], end: [7, 11] }),
      wall({ id: 'p_link', start: [7, 11], end: [7, 10], exterior: false }),
    ]
    expect(violations(buildFoundation(plan, [], spec400))).toEqual([])
  })

  test('CMU foundation interface: dowels lap the wall verticals, bolt kit GONE — composed SAT-clean (B18b)', () => {
    // Pre-B18b this compose carried 'sole plate anchorage' J-bolts rising
    // 3" into block cells where no plate exists, and (under seismic specs)
    // HDU hold-down bodies inside the first block course. The foundation
    // now swaps the kit for #5 dowels at the wall's OWN cell layout
    // (cmu.ts cmuDowelPositions) — rebar embeds in grouted masonry and
    // laps bar-to-bar by detailing intent (existing allow-list pairs:
    // rebar×block / rebar×rebar / rebar×stemwall / rebar×footing —
    // NO new pair needed).
    const seismic400 = { ...spec400, seismicHoldDowns: true }
    const walls = rectWalls().map((w) => ({
      ...w,
      thickness: 0.2032,
      openings:
        w.id === 'w_s' ? [door(2), window_(4.2)] : w.id === 'w_n' ? [window_(3)] : [],
    }))
    const cmuMap = new Map(walls.map((w) => [w.id, cmuDowelPositions(w)]))
    const foundation = buildFoundation(walls, [slab(rect(6, 4))], seismic400, { cmu: cmuMap })
    const blockwork = cmuWalls(walls, seismic400)
    // truth before geometry: no sole-plate hardware anywhere on the compose
    for (const m of foundation) {
      expect(['anchor-bolt', 'plate-washer', 'hold-down']).not.toContain(m.role)
    }
    const dowels = foundation.filter((m) => m.label?.startsWith('#5 dowel'))
    expect(dowels.length).toBeGreaterThan(0)
    // every wall vertical is lapped: a dowel of the same wall within 1" plan
    const verticals = blockwork.filter((m) => m.label?.startsWith('#5 vertical'))
    expect(verticals.length).toBeGreaterThan(0)
    for (const v of verticals) {
      expect(
        dowels.some(
          (d) =>
            d.sourceId === v.sourceId &&
            Math.hypot(
              (d.position[0] ?? 0) - (v.position[0] ?? 0),
              (d.position[2] ?? 0) - (v.position[2] ?? 0),
            ) <
              inches(1) + 1e-6,
        ),
      ).toBe(true)
    }
    expect(violations([...foundation, ...blockwork])).toEqual([])
  })

  test('SLIVER plate sections crowd no steel: corner-sliver + twin-door scenes SAT-clean on washers/HDU (skeptic F2)', () => {
    // Pre-F2 a 150 mm section (door RO ending at the corner) took TWO
    // bolts 50 mm apart under the >=2 rule: 3" plate washers overlapped
    // each other AND the corner hold-down. Sliver sections now take one
    // legal bolt or none (+ the strap flag) — the composed seismic-400
    // foundation carries zero washer x washer / washer x hold-down pairs.
    const seismic400 = { ...spec400, seismicHoldDowns: true }
    const gd = (u: number, roughWidth: number): OpeningSlice => ({
      id: `gd_${u}`,
      kind: 'door',
      u,
      width: roughWidth - 0.038,
      roughWidth,
      height: 2.1,
      roughHeight: 2.15,
      sillHeight: 0,
    })
    const scenes: WallSlice[][] = [
      // corner sliver: RO ends 150 mm from the wall start
      [wall({ id: 'w_g', start: [0, 0], end: [9, 0], openings: [gd(0.15 + 4.877 / 2, 4.877)] })],
      // twin doors leaving a 200 mm middle sliver
      [wall({ id: 'w_g', start: [0, 0], end: [9, 0], openings: [gd(2, 2), gd(4.2, 2)] })],
    ]
    for (const walls of scenes) {
      const members = buildFoundation(walls, [], seismic400)
      // non-vacuous: the seismic kit exists on the normal sections
      expect(members.some((m) => m.role === 'plate-washer')).toBe(true)
      expect(members.some((m) => m.role === 'hold-down')).toBe(true)
      expect(members.some((m) => m.flag?.includes('plate section too short'))).toBe(true)
      const v = violations(members)
      expect(v.filter((s) => s.includes('plate-washer'))).toEqual([])
      expect(v.filter((s) => s.includes('hold-down'))).toEqual([])
    }
  })

  test('KNEE-wall dowels cap at the seam story — never through the PT sill / framed zone (skeptic F1)', () => {
    // Verbatim skeptic repro shape: 6×4 box, w_s a 0.61 m CMU knee wall
    // (3 courses), the rest framed. Fixed 30" dowels used to punch 14-76 mm
    // into the PT seam sill, the framed zone's bottom plate and its studs
    // (13 SAT pairs). The dowel now tops at the ZONE's bar top (bond-beam
    // mid-height) with the short-lap flag + true-overlap label.
    const knee = wall({ id: 'w_s', start: [0, 0], end: [6, 0], thickness: 0.15 })
    const others = [
      wall({ id: 'w_e', start: [6, 0], end: [6, 4], thickness: 0.15 }),
      wall({ id: 'w_n', start: [6, 4], end: [0, 4], thickness: 0.15 }),
      wall({ id: 'w_w', start: [0, 4], end: [0, 0], thickness: 0.15 }),
    ]
    for (const seamReq of [0.61, 0.2]) {
      const layout = cmuDowelPositions(knee, seamReq, others)
      const foundation = buildFoundation([knee, ...others], [slab(rect(6, 4))], spec400, {
        cmu: new Map([['w_s', layout]]),
      })
      const dowels = foundation.filter((m) => m.label?.startsWith('#5 dowel'))
      expect(dowels.length).toBeGreaterThan(0)
      for (const d of dowels) {
        // capped at the zone bar top — 20" real lap at 0.61 m, 4" at 1 course
        expect((d.position[1] ?? 0) + d.dims[1] / 2).toBeCloseTo(layout.barTop, 6)
        expect(d.label).toContain(`laps CMU wall vertical ${seamReq === 0.61 ? '20"' : '4"'}`)
        expect(d.flag).toBe(
          '#5 dowel lap short of 48d_b — hook into bond beam per detail, verify',
        )
      }
      const composed = [
        ...foundation,
        ...mixedCmuWall(knee, spec400, seamReq, others).members,
        ...frameWalls(others, spec400),
      ]
      const v = violations(composed)
      // the F1 class is DEAD: no dowel touches anything wooden
      expect(v.filter((s) => s.includes('#5 dowel'))).toEqual([])
      // only the KNOWN pre-existing residual survives (anchor-bolt × stud
      // shank class, S1 row — B5 compose pins the same)
      expect(v.every((s) => s.includes('anchor-bolt') && s.includes('stud'))).toBe(true)
    }
  })

  test('CMU: oblique corner pairs 45/60/120° (round-14)', () => {
    for (const deg of [45, 60, 120]) {
      const th = (deg * Math.PI) / 180
      const pair = [
        wall({ id: 'w_cbase', start: [0, 0], end: [6, 0], thickness: 0.2032 }),
        wall({
          id: 'w_cob',
          start: [6, 0],
          end: [6 + 4 * Math.cos(th), 4 * Math.sin(th)],
          thickness: 0.2032,
        }),
      ]
      expect({ deg, v: violations(cmuWalls(pair, spec400)) }).toEqual({ deg, v: [] })
    }
  })

  test('CMU: wall with a window', () => {
    expect(violations(cmuWall(wall({ height: 2.4, openings: [window_(2)] }), spec400))).toEqual([])
  })

  test('mixed CMU/framed wall: 50% split, knee wall + crossing door, zoned windows (board 2026-08-16)', () => {
    const H = COURSE_HEIGHT
    // plain 50% split — thin wall exercises the single centered beam bar
    expect(violations(mixedCmuWall(wall({ height: 2.44 }), spec400, 1.22).members)).toEqual([])
    // 8"-nominal block wall, same split
    expect(
      violations(mixedCmuWall(wall({ height: 2.44, thickness: 0.2032 }), spec400, 1.22).members),
    ).toEqual([])
    // 3-course knee wall with a full-height door CROSSING the seam — the
    // framed zone frames it, the blockwork jamb-cuts around it
    expect(
      violations(
        mixedCmuWall(wall({ height: 2.44, thickness: 0.2, openings: [door(3)] }), spec400, 3 * H)
          .members,
      ),
    ).toEqual([])
    // window fully ABOVE a knee-wall seam (framed-zone king/trimmer/sill)
    expect(
      violations(
        mixedCmuWall(wall({ height: 2.44, openings: [window_(4.2)] }), spec400, 3 * H).members,
      ),
    ).toEqual([])
    // window CROSSING a high seam (CMU zone taller — jamb cuts, no lintel)
    expect(
      violations(
        mixedCmuWall(wall({ height: 2.44, thickness: 0.2, openings: [window_(3)] }), spec400, 9 * H)
          .members,
      ),
    ).toEqual([])
  })

  test('mixed wall corners: butt joints against every neighbor kind (S1 fix, board 2026-08-16)', () => {
    // The S1 defect: a mixed wall joined NEITHER corner-fabrication group,
    // so its courses/bond beam/PT sill/plates ran to the centerline at a
    // shared corner (16 violations vs a full-CMU neighbor, 23 vs framed).
    // Both zones now BUTT at the neighbor's near face, with the per-corner
    // MIXED_CORNER_FLAG advisory.
    const mixedA = wall({ id: 'wall_a', start: [0, 0], end: [6, 0], thickness: 0.2032 })

    // mixed + full-CMU corner (FL default neighbor)
    const fullCmu = wall({ id: 'wall_b', start: [6, 0], end: [6, 4], thickness: 0.2032 })
    const vsCmu = mixedCmuWall(mixedA, spec400, 1.22, [fullCmu])
    expect(violations([...vsCmu.members, ...cmuWalls([fullCmu], spec400)])).toEqual([])
    expect(vsCmu.warnings).toContain(`${MIXED_CORNER_FLAG} (wall wall_a, end)`)

    // mixed + framed corner
    const framed = wall({ id: 'wall_f', start: [6, 0], end: [6, 4] })
    const vsFramed = mixedCmuWall(mixedA, spec400, 1.22, [framed])
    expect(violations([...vsFramed.members, ...frameWalls([framed], spec400)])).toEqual([])
    expect(vsFramed.warnings).toContain(`${MIXED_CORNER_FLAG} (wall wall_a, end)`)

    // mixed + mixed corner: both butt — a verifiable joint, never shared volume
    const mixedB = wall({ id: 'wall_c', start: [6, 0], end: [6, 4], thickness: 0.2032 })
    const sideA = mixedCmuWall(mixedA, spec400, 1.22, [mixedB])
    const sideB = mixedCmuWall(mixedB, spec400, 1.22, [mixedA])
    expect(violations([...sideA.members, ...sideB.members])).toEqual([])
    expect(sideB.warnings).toContain(`${MIXED_CORNER_FLAG} (wall wall_c, start)`)

    // T junction: mixed stem lands mid-run on a full-CMU through wall
    const through = wall({ id: 'wall_t', start: [0, 0], end: [8, 0], thickness: 0.2032 })
    const stem = wall({ id: 'wall_stem', start: [4, 0], end: [4, 3], thickness: 0.2032 })
    const tee = mixedCmuWall(stem, spec400, 1.22, [through])
    expect(violations([...tee.members, ...cmuWalls([through], spec400)])).toEqual([])
    expect(tee.warnings).toContain(`${MIXED_CORNER_FLAG} (wall wall_stem, start)`)
  })

  test('mixed wall corners: acute 45° against thin framed neighbors (skeptic 2026-08-16)', () => {
    // The k·neighborThickness/2 retreat is exact only when the retreating
    // member is no wider than the neighbor's thickness. CMU blocks are
    // 7-5/8" (0.19368 m) deep — wider than a 2x4/2x6 framed neighbor — so
    // an acute 45° corner undershot ~4–6 cm and the block noses clipped the
    // neighbor's studs (1 violation vs 0.114, 3 vs 0.0889).
    for (const t of [0.114, 0.0889]) {
      const mixed = wall({ id: 'wall_mx', start: [0, 0], end: [6, 0], thickness: 0.2032 })
      const framed = wall({ id: 'wall_fr', start: [6, 0], end: [6 - 2.828, 2.828], thickness: t })
      const mx = mixedCmuWall(mixed, spec400, 1.22, [framed])
      expect({ t, v: violations([...mx.members, ...frameWalls([framed], spec400)]) }).toEqual({
        t,
        v: [],
      })
      expect(mx.warnings).toContain(`${MIXED_CORNER_FLAG} (wall wall_mx, end)`)
    }
  })
})

describe('night-5 skeptic round: tee edge cases', () => {
  test('d2: back-to-back PARALLEL walls are NOT tees — no run collapse', () => {
    // Two rooms each drawing their shared boundary, offset a full
    // thickness: pre-fix this registered as a tee with sinθ=0 → floored
    // 0.2 → 0.57m inset PER END silently ate 1.14m of framing+finishes.
    const a = wall({ id: 'w_a', start: [0, 0], end: [4, 0], exterior: false })
    const b = wall({ id: 'w_b', start: [1.5, 0.113], end: [3.5, 0.113], exterior: false })
    const members = frameWalls([a, b], spec400)
    const bPlate = members.find((m) => m.role === 'bottom-plate' && m.sourceId === 'w_b')
    expect(bPlate?.dims[0]).toBeCloseTo(2.0, 2) // full run, no tee inset
  })

  test('a: a FAT stem longer than the through wall still insets its layers at the tee', () => {
    // Corner-candidate (endpoint within tol of the through end) that LOSES
    // the tie-break used to shadow the tee probe → zero layer inset.
    const through = wall({ id: 'w_th', start: [0, 0], end: [1, 0], thickness: 0.114 })
    const stem = wall({ id: 'w_stem', start: [0.87, 0], end: [0.87, 3], thickness: 0.2, exterior: false })
    const rooms = [
      {
        id: 'room_r',
        name: 'room',
        category: 'other' as const,
        polygon: [[0, 0], [1, 0], [1, 3], [0, 3]] as [number, number][],
        boundaryWallIds: ['w_th'],
        ceilingHeight: 2.7,
      },
    ]
    const combined = [
      ...frameWalls([through, stem], spec400),
      ...layoutWallLayers([through, stem], rooms, spec400, 'NY'),
    ]
    // The FIXED class: the stem's DRYWALL through the through wall's
    // framing. (The corner-lap cap × through-drywall pair on this hybrid
    // corner/tee geometry is a separate pre-existing class — board-queued.)
    const stemLayerPairs = violations(combined).filter(
      (v) => v.startsWith('drywall') && v.includes('plate'),
    )
    expect(stemLayerPairs).toEqual([])
  })

  test('c: MIXED 45° stem into a framed through wall uses the width-aware retreat', () => {
    const through = wall({ id: 'w_th', start: [0, 0], end: [8, 0] })
    const stem = wall({ id: 'w_stem', start: [5.5, 1.5], end: [4, 0], thickness: 0.2, exterior: false })
    const { members } = mixedCmuWall(stem, spec400, 0.6096, [through, stem])
    const framing = frameWalls([through], spec400)
    expect(violations([...members, ...framing])).toEqual([])
  })
})

describe('ship-gate follow-up: blocking bears on joists, never on rim or air', () => {
  test('wedge-sliver slab: no blocking × rim-joist overlap (SAT)', () => {
    // Ship-gate repro: polygon containment at the joist faces held near
    // the wedge tip while the space there was entirely rim joist — the
    // block overlapped the rim until a ~50mm skin. Joist-coverage truth
    // kills the block instead.
    const members = frameFloor(
      [slab([[0, 0], [3.5, 0.18], [0, 0.36]])],
      [],
      spec400,
    )
    // Scope: BLOCKING pairs (the ship-gate finding). This ~6° sliver also
    // exhibits rim×rim + joist×rim contact at the acute tip — a distinct
    // pre-existing miter class, queued in the backlog appendix, and pinned
    // EXACTLY so the frozen class can't silently grow (ship-gate round 2
    // advisory: a ≤4 pin left room for the class to double unnoticed).
    const v = violations(members)
    expect(v.filter((s) => s.includes('blocking'))).toEqual([])
    expect(v).toHaveLength(2)
    for (const pair of v) expect(pair).toContain('rim-joist')
  })

  test('needle sliver: zero joists ⇒ zero blocking (no lumber bearing on air)', () => {
    const members = frameFloor([slab([[0, 0], [5, 0.1], [0, 0.2]])], [], spec400)
    expect(members.filter((m) => m.role === 'joist')).toHaveLength(0)
    expect(members.filter((m) => m.role === 'blocking')).toHaveLength(0)
    // the tip rim×rim miter residual — same queued class, pinned exactly
    const v = violations(members)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('rim-joist')
  })

  test('L-notch with the cross edge just past a bay mid: the FULL block stays inside (no rim poke)', () => {
    // Ship-gate round 2: the centerline-only coverage test left a ≤t/2
    // window — a notch edge at mid + t + 8mm produced FIVE blocking×rim
    // SAT pairs while every block was 'covered' at its center.
    const members = frameFloor(
      [
        slab([
          [0, 0],
          [4, 0],
          [4, 2],
          [2.0461, 2],
          [2.0461, 4],
          [4, 4],
          [4, 6],
          [0, 6],
        ]),
      ],
      [],
      spec400,
    )
    expect(violations(members).filter((s) => s.includes('blocking'))).toEqual([])
    expect(members.some((m) => m.role === 'blocking')).toBe(true) // non-vacuous
  })

  test('narrow stair hole strictly BETWEEN rows: no block over the well, no trimmer impale', () => {
    // Ship-gate round 2: (a) off-center hole in its bay — the center-only
    // inHole test kept the block over the stairwell; (b) even centered,
    // the NEIGHBORING bay's block clipped a trimmer ply.
    for (const hole of [
      [
        [1, 2.09],
        [3, 2.09],
        [3, 2.25],
        [1, 2.25],
      ],
      [
        [1, 2.1],
        [3, 2.1],
        [3, 2.4],
        [1, 2.4],
      ],
    ] as [number, number][][]) {
      const members = frameFloor([slab(rect(4, 6), { holes: [hole] })], [], spec400)
      expect(violations(members).filter((s) => s.includes('blocking'))).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// Under-floor DWV vs footings + floor platform (feat/underfloor-dwv gate).
// Drainage members hang below the floor plane, sharing that stratum with the
// foundation and (on framed floors) the joist platform. MEP stays out of the
// STRUCTURAL matrix above — in-wall supply/vent pipes legitimately penetrate
// framing — but the buried DRAIN tree must never share volume with concrete
// or the platform:
//  - horizontal drains pass UNDER footings and BELOW joists/girders;
//  - the ONLY concrete crossings are the labeled sleeves (P2603.4), exempted
//    by their label — never silently;
//  - vertical through-floor drops are checked against CONCRETE only: a drop
//    crosses the platform inside a joist bay in practice — bay coordination
//    with the joist layout is future routing work (B20 territory).
// ---------------------------------------------------------------------------

describe('under-floor DWV vs footings + floor platform (drainage gate)', () => {
  const shellWall = (
    id: string,
    start: [number, number],
    end: [number, number],
    exterior = true,
  ): WallSlice => wall({ id, start, end, exterior })
  const shell: WallSlice[] = [
    shellWall('w_s', [0, 0], [10, 0]),
    shellWall('w_e', [10, 0], [10, 8]),
    shellWall('w_n', [10, 8], [0, 8]),
    shellWall('w_w', [0, 8], [0, 0]),
    shellWall('w_mid', [5, 0], [5, 8], false),
  ]
  const slabs: SlabSlice[] = [
    {
      id: 'slab_gate',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      holes: [],
      elevation: 0.05, // host defaults (extractSlabs)
      thickness: 0.05,
    },
  ]
  const wetRooms: RoomSlice[] = [
    {
      id: 'r_bath',
      name: 'Bathroom',
      category: 'bathroom',
      polygon: [
        [5, 0],
        [10, 0],
        [10, 4],
        [5, 4],
      ],
      boundaryWallIds: ['w_mid'],
      ceilingHeight: 2.5,
    },
    {
      id: 'r_kitchen',
      name: 'Kitchen',
      category: 'kitchen',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
      boundaryWallIds: ['w_mid'],
      ceilingHeight: 2.5,
    },
    {
      id: 'r_laundry',
      name: 'Laundry',
      category: 'laundry',
      polygon: [
        [0, 4],
        [5, 4],
        [5, 8],
        [0, 8],
      ],
      boundaryWallIds: [],
      ceilingHeight: 2.5,
    },
  ]
  // Composed structure sharing the under-floor stratum: perimeter footings +
  // stemwalls + the interior thickened footing under w_mid (foundation) and
  // a framed platform (joists/girder/rims) hung under the slab surface.
  const structureFor = (spec: typeof spec400): Member[] =>
    [...buildFoundation(shell, slabs, spec), ...frameFloor(slabs, shell, spec, 2.4)].filter((m) =>
      ['footing', 'stemwall', 'slab-edge', 'joist', 'rim-joist', 'girder', 'blocking', 'subfloor'].includes(
        m.role,
      ),
    )
  const CONCRETE = new Set(['footing', 'stemwall', 'slab-edge'])
  // Deep frost foundation (footingDepth 60"): the stemwall reaches WELL
  // below the drain depth — the skeptic's S1 repro class. Wet rooms whose
  // wet wall is the EXTERIOR south wall put every junction against it.
  const specFrost = { ...spec400, footingDepth: inches(60) }
  const wetRoomsExterior: RoomSlice[] = wetRooms.map((r) =>
    r.id === 'r_laundry' ? r : { ...r, boundaryWallIds: ['w_s'] },
  )

  function drainClashes(plumbing: Member[], structure: Member[]): string[] {
    // The DRAIN tree below the floor — including the stack (role
    // 'vent-stack', S1b: it used to run bare through frost stemwalls).
    // Sleeve-labeled members are the DESIGNED concrete crossings
    // (P2603.4); the label is applied per-LEG by the engine, so this
    // exemption never blankets an interior run (S3a).
    const drains = plumbing.filter(
      (m) =>
        ((m.role === 'pipe-run' &&
          m.sourceId.startsWith('dwv-') &&
          !m.sourceId.startsWith('dwv-vent')) ||
          (m.system === 'plumbing' && m.role === 'vent-stack')) &&
        !(m.label ?? '').includes('sleeve'),
    )
    expect(drains.length).toBeGreaterThan(0) // never vacuous
    const bad: string[] = []
    for (const d of drains) {
      const vertical = d.dims[1] > d.dims[0]
      const dObb = toObb(d)
      for (const s of structure) {
        if (vertical && !CONCRETE.has(s.role)) continue
        const sObb = toObb(s)
        if (!aabbTouch(dObb, sObb)) continue
        if (!obbOverlap(dObb, sObb)) continue
        bad.push(
          `${d.label ?? d.sourceId} @${d.position.map((v) => v.toFixed(2)).join(',')}` +
            ` × ${s.role} @${s.position.map((v) => v.toFixed(2)).join(',')}`,
        )
      }
    }
    return bad
  }

  const placedSet: PlacedFixtureSlice[] = [
    { id: 'wc', kind: 'toilet', plan: [6.5, 0.6], yaw: 0, hot: false, dfu: 3, drainIn: 3 },
    { id: 'shw', kind: 'shower', plan: [9.2, 0.7], yaw: 0, hot: true, dfu: 2, drainIn: 2 },
    { id: 'lav', kind: 'lavatory', plan: [7.6, 0.6], yaw: 0, hot: true, dfu: 1, drainIn: 1.25 },
    { id: 'ks', kind: 'kitchen-sink', plan: [1.5, 0.6], yaw: 0, hot: true, dfu: 2, drainIn: 1.5 },
  ]

  test('fallback tree (room categories) composes SAT-clean', () => {
    const { members } = layoutPlumbing(shell, wetRooms, spec400)
    expect(drainClashes(members, structureFor(spec400))).toEqual([])
  })

  test('placed-fixture tree composes SAT-clean', () => {
    const { members } = layoutPlumbing(shell, wetRooms, spec400, placedSet)
    expect(drainClashes(members, structureFor(spec400))).toEqual([])
  })

  test('S1: FROST spec + exterior wet wall — fallback junctions stay inboard of the stemwall', () => {
    const { members } = layoutPlumbing(shell, wetRoomsExterior, specFrost)
    expect(drainClashes(members, structureFor(specFrost))).toEqual([])
  })

  test('S1b+R4b: FROST + placed fixtures incl. a FLUSH lav — arms/branches/stack/riser all clear', () => {
    // R4b: a fixture flush against the frost wall used to keep its trap
    // riser at f.plan — a bare vertical through the stemwall.
    const flushLav: PlacedFixtureSlice = {
      id: 'lav2',
      kind: 'lavatory',
      plan: [8.4, 0.06],
      yaw: 0,
      hot: true,
      dfu: 1,
      drainIn: 1.25,
    }
    const { members } = layoutPlumbing(shell, wetRoomsExterior, specFrost, [
      ...placedSet,
      flushLav,
    ])
    expect(drainClashes(members, structureFor(specFrost))).toEqual([])
    // the flush lav's drop is pulled to the inboard junction
    const trap = members.find((m) => m.sourceId === 'dwv-trap-lav2' && m.dims[1] > m.dims[0])
    expect(trap).toBeDefined()
    expect(Math.abs(trap?.position[2] ?? 0)).toBeGreaterThanOrEqual(0.25)
    // the exit leg CROSSES the frost south stemwall → it MUST carry the
    // sleeve (the old `≤ 1` phrasing passed with zero sleeves — advisory)
    const sleeved = members.filter(
      (m) => m.sourceId === 'dwv-main' && m.label?.includes('sleeved through foundation (P2603.4)'),
    )
    expect(sleeved.length).toBeGreaterThanOrEqual(1)
  })

  test('R2+R4a: corner powder room at frost — per-crossing sleeves + clamped drops', () => {
    // 1.0 m wide bath in the SW corner on the exterior south wall; the
    // sewer exit forced WEST so the main's X-leg crosses the west
    // stemwall mid-run (the old terminal-leg heuristic left it bare).
    const powder: RoomSlice[] = [
      {
        id: 'r_pow',
        name: 'Powder',
        category: 'bathroom',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 2],
          [0, 2],
        ],
        boundaryWallIds: ['w_s'],
        ceilingHeight: 2.5,
      },
    ]
    const { members } = layoutPlumbing(shell, powder, specFrost, [], {
      sewerExit: { position: [-0.8, 0, 0.9] },
    })
    expect(drainClashes(members, structureFor(specFrost))).toEqual([])
    const sleevedMains = members.filter(
      (m) => m.sourceId === 'dwv-main' && m.label?.includes('P2603.4'),
    )
    expect(sleevedMains.length).toBeGreaterThanOrEqual(1)
    // R4a: every through-floor drop stays INSIDE the 1 m room — the
    // unclamped ±0.4 offsets put the toilet drop inside the west stemwall
    const drops = members.filter(
      (m) => m.sourceId.startsWith('dwv-trap-') && m.dims[1] > m.dims[0],
    )
    expect(drops.length).toBeGreaterThan(0)
    for (const d of drops) {
      expect(pointInPolygon([d.position[0], d.position[2]], powder[0]?.polygon ?? [])).toBe(true)
    }
  })

  test('R3: courtyard plan at frost — branch legs sleeve through BOTH courtyard stemwalls', () => {
    const uWalls: WallSlice[] = [
      shellWall('u_s', [0, 0], [12, 0]),
      shellWall('u_e', [12, 0], [12, 8]),
      shellWall('u_n', [12, 8], [0, 8]),
      shellWall('u_w', [0, 8], [0, 0]),
      // the courtyard's own exterior stemwalls, mid-plan
      shellWall('u_c1', [5, 2], [5, 6]),
      shellWall('u_c2', [7, 2], [7, 6]),
    ]
    const uRooms: RoomSlice[] = [
      {
        id: 'r_ubath',
        name: 'Bathroom',
        category: 'bathroom',
        polygon: [
          [8, 2],
          [11, 2],
          [11, 6],
          [8, 6],
        ],
        boundaryWallIds: ['u_e'],
        ceilingHeight: 2.5,
      },
      {
        id: 'r_ukitchen',
        name: 'Kitchen',
        category: 'kitchen',
        polygon: [
          [1, 2],
          [4, 2],
          [4, 6],
          [1, 6],
        ],
        boundaryWallIds: ['u_w'],
        ceilingHeight: 2.5,
      },
    ]
    const uSlabs: SlabSlice[] = [
      {
        id: 'slab_u',
        polygon: [
          [0, 0],
          [12, 0],
          [12, 8],
          [0, 8],
        ],
        holes: [],
        elevation: 0.05,
        thickness: 0.05,
      },
    ]
    const uStructure = [
      ...buildFoundation(uWalls, uSlabs, specFrost),
      ...frameFloor(uSlabs, uWalls, specFrost, 2.4),
    ].filter((m) =>
      ['footing', 'stemwall', 'slab-edge', 'joist', 'rim-joist', 'girder', 'blocking', 'subfloor'].includes(
        m.role,
      ),
    )
    const { members } = layoutPlumbing(uWalls, uRooms, specFrost)
    expect(drainClashes(members, uStructure)).toEqual([])
    // the west-wing branch crossed both courtyard stemwalls bare (2
    // clashes pre-fix) — its crossing leg now carries the sleeve
    const sleevedBranch = members.filter(
      (m) => m.sourceId === 'dwv-branch-r_ukitchen' && m.label?.includes('P2603.4'),
    )
    expect(sleevedBranch.length).toBeGreaterThanOrEqual(1)
  })

  test('the concrete crossings that DO exist are labeled sleeves (P2603.4), never silent', () => {
    const { members } = layoutPlumbing(shell, wetRooms, spec400)
    const stackBase = members.find(
      (m) => m.sourceId === 'dwv-stack-base' && m.label?.includes('sleeved'),
    )
    expect(stackBase).toBeDefined()
    expect(stackBase?.label).toContain('P2603.4')
  })

  // ---- F3 trap-drop residuals (B20): drops were validated only against
  // the fixture's OWN anchor wall — both confirmed exhibits below clashed
  // pre-fix (verified: the repros SAT-failed on the pre-clamp engine). ----

  test('F3 residual A: corner-flush lav at frost — the drop clears the PERPENDICULAR stemwall', () => {
    // Lav 8 cm off the south wall, 10 cm from the east corner: anchored to
    // w_s, its drop vertical used to stand INSIDE w_e's frost stemwall.
    const lavCorner: PlacedFixtureSlice = {
      id: 'lavc',
      kind: 'lavatory',
      plan: [9.9, 0.08],
      yaw: 0,
      hot: true,
      dfu: 1,
      drainIn: 1.25,
    }
    const { members } = layoutPlumbing(shell, wetRoomsExterior, specFrost, [
      ...placedSet,
      lavCorner,
    ])
    expect(drainClashes(members, structureFor(specFrost))).toEqual([])
    // the clamp is real geometry, not an exemption: the drop stands clear
    // of the east wall's concrete band (stemwall half + pipe half)
    const drop = members.find(
      (m) => m.sourceId === 'dwv-trap-lavc' && m.dims[1] > m.dims[0],
    ) as Member
    expect(drop).toBeDefined()
    expect(10 - drop.position[0]).toBeGreaterThan(0.2)
  })

  test('F3 residual B: toilet 0.22 m off the interior bearing wall — the drop clears its 12" thickened footing', () => {
    // Anchored to w_s (0.20 m) but 0.22 m off w_mid's centerline: the
    // pulled drop used to sit inside w_mid's 16"-wide thickened footing.
    const wc22: PlacedFixtureSlice = {
      id: 'wc22',
      kind: 'toilet',
      plan: [5.22, 0.2],
      yaw: 0,
      hot: false,
      dfu: 3,
      drainIn: 3,
    }
    const lav: PlacedFixtureSlice = {
      id: 'lav_b',
      kind: 'lavatory',
      plan: [8, 0.5],
      yaw: 0,
      hot: true,
      dfu: 1,
      drainIn: 1.25,
    }
    const { members } = layoutPlumbing(shell, wetRooms, spec400, [wc22, lav])
    expect(drainClashes(members, structureFor(spec400))).toEqual([])
    const drop = members.find(
      (m) => m.sourceId === 'dwv-trap-wc22' && m.dims[1] > m.dims[0],
    ) as Member
    expect(drop).toBeDefined()
    // clear of the interior footing band: 16"/2 + 3"-pipe half
    expect(Math.abs(drop.position[0] - 5)).toBeGreaterThan(0.203 + 0.038)
  })
})

describe('high-wind uplift hardware composes SAT-clean (LOD-400 B10 / S1)', () => {
  const uplift400 = { ...spec400, highWindUplift: true }
  const upliftRoles = new Set(['uplift-connector', 'uplift-strap', 'foundation-strap'])

  test('LA walls + layers BOTH faces: connectors/straps under the skin, strictly clean', () => {
    // The S13 convention under scrutiny: 1.2 mm surface steel on the
    // framing face, drywall inside + sheathing/WRB/cladding outside — the
    // hardware must never register against the studs it laps NOR the layer
    // stacks on either face (scan vs wall layers both faces — no uplift
    // allow-list pair exists).
    const walls = [
      wall({ id: 'w_s', start: [0, 0], end: [6, 0], openings: [door(2), window_(4.2)] }),
      wall({ id: 'w_e', start: [6, 0], end: [6, 4] }),
      wall({ id: 'w_n', start: [6, 4], end: [0, 4], openings: [window_(3)] }),
      wall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms: RoomSlice[] = [
      {
        id: 'room_r',
        name: 'room',
        category: 'other',
        polygon: [[0, 0], [6, 0], [6, 4], [0, 4]],
        boundaryWallIds: ['w_s', 'w_e', 'w_n', 'w_w'],
        ceilingHeight: 2.7,
      },
    ]
    const framing = frameWalls(walls, uplift400, undefined, { slabBearing: true })
    expect(framing.some((m) => m.role === 'uplift-connector')).toBe(true)
    expect(framing.some((m) => m.role === 'uplift-strap')).toBe(true)
    expect(framing.some((m) => m.role === 'foundation-strap')).toBe(true)
    const composed = [...framing, ...layoutWallLayers(walls, rooms, uplift400, 'LA')]
    expect(violations(composed)).toEqual([])
  })

  test('+ foundation (post-dedupe): inherits ONLY the documented bolt-shank class', () => {
    const walls = rectWalls()
    const composed = [
      ...buildFoundation(walls, [slab(rect(6, 4))], uplift400),
      ...frameWalls(walls, uplift400, undefined, { slabBearing: true }),
    ]
    dedupeFoundationStraps(composed) // the compute order (B10b)
    expect(composed.some((m) => m.role === 'foundation-strap')).toBe(true)
    const v = violations(composed)
    // No violation may involve the uplift hardware; the only residual is
    // the S1 row's documented pre-existing anchor-bolt × stud class.
    expect(v.filter((s) => [...upliftRoles].some((r) => s.includes(r)))).toEqual([])
    expect(v.every((s) => s.includes('anchor-bolt') && s.includes('stud'))).toBe(true)
  })

  test('HI garage (seismic AND high-wind): portal set + uplift set coexist, no new classes', () => {
    // Both hardware families on one wall: B9's portal strap owns the king
    // line, the B10 opening strap rides the trimmer line, and the king's
    // stud-to-plate connector SIDE-STEPS one strap width (co-planar surface
    // steel never shares a drawn spot).
    const hi = { ...spec400, seismicHoldDowns: true, highWindUplift: true }
    const garageDoor = (u: number): OpeningSlice => ({
      id: 'garage_door',
      kind: 'door',
      u,
      width: 4.83,
      roughWidth: 4.877,
      height: 2.13,
      roughHeight: 2.17,
      sillHeight: 0,
    })
    const walls = [
      wall({ id: 'w_s', start: [0, 0], end: [6.4, 0], openings: [garageDoor(3.2)] }),
      wall({ id: 'w_e', start: [6.4, 0], end: [6.4, 4] }),
      wall({ id: 'w_n', start: [6.4, 4], end: [0, 4] }),
      wall({ id: 'w_w', start: [0, 4], end: [0, 0] }),
    ]
    const rooms: RoomSlice[] = [
      {
        id: 'room_g',
        name: 'Garage',
        category: 'garage',
        polygon: [[0, 0], [6.4, 0], [6.4, 4], [0, 4]],
        boundaryWallIds: ['w_s', 'w_e', 'w_n', 'w_w'],
        ceilingHeight: 2.44,
      },
    ]
    const framing = frameWalls(walls, hi, undefined, { slabBearing: true })
    expect(framing.filter((m) => m.role === 'strap')).toHaveLength(2) // B9 census intact
    expect(framing.filter((m) => m.role === 'uplift-strap')).toHaveLength(2)
    const withLayers = [...framing, ...layoutWallLayers(walls, rooms, hi, 'HI')]
    expect(violations(withLayers)).toEqual([])
    // + seismic foundation: post-dedupe, only the B9-named pre-existing
    // classes may remain (bolt kit under grid studs, corner drywall × HDU)
    // — never one involving the uplift hardware or the portal straps.
    const composed = [...withLayers, ...buildFoundation(walls, [slab(rect(6.4, 4))], hi)]
    dedupeFoundationStraps(composed)
    const v = violations(composed)
    expect(v.filter((s) => [...upliftRoles].some((r) => s.includes(r)))).toEqual([])
    expect(v.filter((s) => s.includes('strap'))).toEqual([])
    const boltKit = (s: string) =>
      s.includes('stud') && (s.includes('anchor-bolt') || s.includes('plate-washer'))
    const cornerLayer = (s: string) => s.includes('drywall') && s.includes('hold-down')
    expect(v.filter((s) => !boltKit(s) && !cornerLayer(s))).toEqual([])
  })
})

describe('LGS steel walls compose SAT-clean (Phase 1 / S1)', () => {
  // The compute wiring, mirrored: ONE hint graph over lumber + steel
  // (hintWalls), each engine framing only its own walls, layers over the
  // combined list with the engineering map carrying construction.
  const lgsMap = (ids: string[], extra: Record<string, unknown> = {}) =>
    new Map(ids.map((id) => [id, { construction: 'lgs' as const, ...extra }]))

  test('single steel wall + door + window (+ layers): tracks/studs/kings/jacks/header/sill/straps clean', () => {
    const w = wall({ id: 'w_lgs', start: [0, 0], end: [8, 0], openings: [door(2), window_(6)] })
    const eng = lgsMap(['w_lgs'])
    const { members } = lgsFrameWalls([w], spec400, eng)
    // non-vacuous: the full member family is present
    for (const role of ['bottom-plate', 'top-plate', 'stud', 'king-stud', 'trimmer', 'header', 'sill', 'cripple', 'strap-bracing']) {
      expect(members.some((m) => m.role === role)).toBe(true)
    }
    const composed = [
      ...members,
      ...layoutWallLayers([w], [], spec400, 'TX', [], eng),
    ]
    expect(violations(composed)).toEqual([])
  })

  test('the steel-nest allowance is SCOPED: a lumber stud parked inside a lumber plate still trips', () => {
    // Mutation guard for the allowance itself — dropping the material/
    // profile/sourceId scoping would blind the gate to real lumber
    // defects. Two synthetic lumber members in the exact nest pose:
    const nest: Member[] = [
      {
        system: 'wall-framing', role: 'bottom-plate', dims: [2, 0.038, 0.089],
        length: 2, position: [1, 0.019, 0], rotation: [0, 0, 0],
        material: 'lumber', sourceId: 'w_x',
      },
      {
        system: 'wall-framing', role: 'stud', dims: [0.038, 2.3, 0.089],
        length: 2.3, position: [1, 1.15 + 0.002, 0], rotation: [0, 0, 0],
        material: 'lumber', sourceId: 'w_x',
      },
    ]
    expect(violations(nest).length).toBeGreaterThan(0)
    // …and the same pose in catalog steel on one wall is the design intent
    const steelNest = nest.map((m) => ({
      ...m,
      material: 'steel' as const,
      profile: m.role === 'stud' ? '350S162-68' : '350T125-68',
    }))
    expect(violations(steelNest)).toEqual([])
    // …but steel across TWO walls is NOT nesting — still a violation
    const crossWall = steelNest.map((m, i) => ({ ...m, sourceId: i === 0 ? 'w_a' : 'w_b' }))
    expect(violations(crossWall).length).toBeGreaterThan(0)
  })

  test('L-corner steel × lumber: shared hint graph, butt insets, suppressed cap lap — clean', () => {
    const lumberW = wall({ id: 'w_wood', start: [0, 0], end: [6, 0], openings: [door(3)] })
    const steelW = wall({ id: 'w_steel', start: [0, 0], end: [0, 4] })
    const all = [lumberW, steelW]
    const eng = new Map<string, { construction: 'framed' | 'lgs' }>([
      ['w_wood', { construction: 'framed' }],
      ['w_steel', { construction: 'lgs' }],
    ])
    const composed = [
      ...frameWalls([lumberW], spec400, eng, { hintWalls: all }),
      ...lgsFrameWalls([steelW], spec400, eng, { hintWalls: all }).members,
      ...layoutWallLayers(all, [], spec400, 'TX', [], eng),
    ]
    expect(composed.some((m) => m.profile !== undefined)).toBe(true)
    expect(composed.some((m) => m.material === 'lumber' && m.role === 'stud')).toBe(true)
    // LABEL TRUTH at the mixed corner: the lumber through wall's cap must
    // NOT claim to lap onto the steel wall (a wood cap lap splice onto a
    // steel top track is not a thing — frameHints suppresses the deltas at
    // mixed-material corners). The corner geometry itself is inset-clean
    // either way; the claim is what the suppression guards.
    expect(
      composed.some((m) => m.role === 'cap-plate' && (m.label ?? '').includes('laps corner')),
    ).toBe(false)
    expect(violations(composed)).toEqual([])
  })

  test('INVERSE corner — steel THROUGH, lumber butting: composes clean, no cap-lap claims', () => {
    // The steel through wall has no cap plate for the hint's extend to
    // land on, and the lumber butting wall only ever pulls SHORT — the
    // suppression keeps both directions claim-free; the SAT run proves
    // the inset/track geometry composes.
    const steelW = wall({ id: 'w_steel', start: [0, 0], end: [6, 0] })
    const lumberW = wall({ id: 'w_wood', start: [0, 0], end: [0, 4] })
    const all = [steelW, lumberW]
    const eng = new Map<string, { construction: 'framed' | 'lgs' }>([
      ['w_steel', { construction: 'lgs' }],
      ['w_wood', { construction: 'framed' }],
    ])
    const composed = [
      ...frameWalls([lumberW], spec400, eng, { hintWalls: all }),
      ...lgsFrameWalls([steelW], spec400, eng, { hintWalls: all }).members,
      ...layoutWallLayers(all, [], spec400, 'TX', [], eng),
    ]
    // the lumber cap stays home (no 'laps corner' label on this pair)
    expect(
      composed.some((m) => m.role === 'cap-plate' && (m.label ?? '').includes('laps corner')),
    ).toBe(false)
    expect(violations(composed)).toEqual([])
  })

  test('steel × steel corner + lumber tee into a steel through wall: clean, backing present', () => {
    const s1 = wall({ id: 'w_s1', start: [0, 0], end: [6, 0], openings: [window_(3)] })
    const s2 = wall({ id: 'w_s2', start: [0, 0], end: [0, 4] })
    const stem = wall({ id: 'w_stem', start: [3, 0], end: [3, 2.5] })
    const all = [s1, s2, stem]
    const eng = new Map<string, { construction: 'framed' | 'lgs' }>([
      ['w_s1', { construction: 'lgs' }],
      ['w_s2', { construction: 'lgs' }],
      ['w_stem', { construction: 'framed' }],
    ])
    const steel = lgsFrameWalls([s1, s2], spec400, eng, { hintWalls: all })
    // the tee books CFS backing (150U050 bridging channel) on the through wall
    expect(steel.members.some((m) => m.role === 'backing' && m.profile === '150U050-54')).toBe(true)
    const composed = [
      ...steel.members,
      ...frameWalls([stem], spec400, eng, { hintWalls: all }),
      ...layoutWallLayers(all, [], spec400, 'TX', [], eng),
    ]
    expect(violations(composed)).toEqual([])
  })

  test('insulated steel wall with openings: batts hug the steel members (steel-aware bays) — clean', () => {
    const w = wall({
      id: 'w_ins',
      start: [0, 0],
      end: [8, 0],
      thickness: 0.15,
      exterior: true,
      openings: [door(2), window_(6)],
    })
    const eng = new Map([[
      'w_ins',
      { construction: 'lgs' as const, insulation: 'batt' as const, insulationR: 13 },
    ]])
    const steel = lgsFrameWalls([w], spec400, eng)
    const layers = layoutWallLayers([w], [], spec400, 'TX', [], eng)
    expect(layers.some((m) => m.role === 'insulation')).toBe(true)
    expect(violations([...steel.members, ...layers])).toEqual([])
  })

  test('steel partition between CMU walls (the FL default composition): straps trim clear of the blocks (round-1 F4d)', () => {
    // FL's jurisdiction default composes EXACTLY this: CMU shell + steel
    // interior partitions under framingSystem 'lgs'. The shared hint graph
    // is masonry-blind (the documented S1 'partition tees into full-CMU'
    // class — the steel stud/track run keeps lumber-twin symmetry with
    // it), but the NEW strap-bracing role must not join the class: strap
    // runs trim clear of the CMU through-wall bodies via mixedWallInsets.
    const cmuS = wall({ id: 'w_cmu_s', start: [0, 0], end: [6, 0], thickness: 0.15 })
    const cmuN = wall({ id: 'w_cmu_n', start: [0, 4], end: [6, 4], thickness: 0.15 })
    const stem = wall({ id: 'w_stem', start: [3, 0], end: [3, 4], thickness: 0.114 })
    const eng = lgsMap(['w_stem'])
    const steel = lgsFrameWalls([stem], spec400, eng, { cmuNeighbors: [cmuS, cmuN] })
    const straps = steel.members.filter((m) => m.role === 'strap-bracing')
    expect(straps.length).toBeGreaterThan(0)
    for (const st of straps) {
      expect(st.advisory).toContain('run trimmed clear of a CMU junction')
    }
    const masonry = cmuWalls([cmuS, cmuN], spec400)
    // ZERO strap × masonry contact — proven on the ISOLATED pair set (the
    // full compose's violation list caps at 12 diagnostics, so a
    // straps-only scan is the non-maskable form)
    expect(violations([...straps, ...masonry])).toEqual([])
    // …and everything the full compose reports is the DOCUMENTED
    // masonry-blind tee class (steel stud/track tips inside the masonry
    // bodies — blocks and the bond-beam course; the lumber-twin residual)
    const v = violations([...steel.members, ...masonry])
    expect(v.length).toBeGreaterThan(0) // the documented class is real
    expect(v.every((s) => s.includes('block') || s.includes('bond-beam'))).toBe(true)
    // guard for the fix itself: WITHOUT the trim the straps bore the blocks
    const untrimmed = lgsFrameWalls([stem], spec400, eng)
    const rawStraps = untrimmed.members.filter((m) => m.role === 'strap-bracing')
    expect(violations([...rawStraps, ...masonry]).length).toBeGreaterThan(0)
  })

  test('round-2 A: a CMU STEM teeing INTO a steel through wall — straps SPLIT around the stem band', () => {
    // The round-1 trim only engaged when the steel wall was the corner
    // party or the tee STEM (mixedWallInsets skips through-side tees) — a
    // grouted CMU stem crossing the steel run left straps boring its block
    // cells. The executed round-2 exhibit: steel through [0,0]→[6,0]
    // 0.114 m + CMU stem [3,0]→[3,3] 0.15 m.
    const steelThru = wall({ id: 'w_thru', start: [0, 0], end: [6, 0], thickness: 0.114 })
    const cmuStem = wall({ id: 'w_cstem', start: [3, 0], end: [3, 3], thickness: 0.15 })
    const eng = lgsMap(['w_thru'])
    const steel = lgsFrameWalls([steelThru], spec400, eng, { cmuNeighbors: [cmuStem] })
    const straps = steel.members.filter((m) => m.role === 'strap-bracing')
    // 2.44 m wall → mid-height row × both faces, SPLIT in two per face
    expect(straps.length).toBe(4)
    for (const st of straps) {
      expect(st.advisory).toContain('run trimmed clear of a CMU junction')
      // no strap crosses the stem band [3 − 0.075, 3 + 0.075]
      const min = st.position[0] - st.dims[0] / 2
      const max = st.position[0] + st.dims[0] / 2
      expect(max <= 3 - 0.075 + 1e-9 || min >= 3 + 0.075 - 1e-9).toBe(true)
    }
    // the non-maskable straps-only SAT scan against the stem's blockwork
    const masonry = cmuWalls([cmuStem], spec400)
    expect(violations([...straps, ...masonry])).toEqual([])
    // guard: WITHOUT the neighbors the straps bore the stem's blocks
    const raw = lgsFrameWalls([steelThru], spec400, eng)
    const rawStraps = raw.members.filter((m) => m.role === 'strap-bracing')
    expect(violations([...rawStraps, ...masonry]).length).toBeGreaterThan(0)
    // …and the steel wall's OWN members are byte-identical apart from the
    // straps (the trim must only touch the new role — round-2 held item)
    const others = (ms: Member[]) => ms.filter((m) => m.role !== 'strap-bracing')
    expect(JSON.stringify(others(steel.members))).toBe(JSON.stringify(others(raw.members)))
  })

  test('round-3 F2: an OBLIQUE CMU stem — the strap-plane offset shifts the crossing; the widened band covers it', () => {
    // The skeptic's ground truth: 45° stem [23,0]→[25.5,2.5] t=0.19 into
    // steel [20,0]→[26,0]. The straps live at z = ±(wFit/2 + strap/2) ≈
    // ±0.045 off the centerline, and the stem's crossing of that offset
    // plane shifts along u by z·cot45° = 0.045 — past the round-2
    // centerline band, so the +z strap penetrated a grouted block 32 mm.
    // The band half-width now widens by |z|·cosθ/sinθ.
    const steelThru = wall({ id: 'w_othru', start: [20, 0], end: [26, 0], thickness: 0.114 })
    const obliqueStem = wall({ id: 'w_ostem', start: [23, 0], end: [25.5, 2.5], thickness: 0.19 })
    const eng = lgsMap(['w_othru'])
    const steel = lgsFrameWalls([steelThru], spec400, eng, { cmuNeighbors: [obliqueStem] })
    const straps = steel.members.filter((m) => m.role === 'strap-bracing')
    expect(straps.length).toBeGreaterThan(0)
    const masonry = cmuWalls([obliqueStem], spec400)
    expect(masonry.some((m) => m.role === 'block')).toBe(true)
    // the non-maskable straps-only OBB scan (the skeptic's ground truth)
    expect(violations([...straps, ...masonry])).toEqual([])
    // guard for the widening itself: the round-2 centerline-only band
    // (reconstructed here) leaves a strap crossing the stem's offset-plane
    // band — the scenario is non-vacuous, not a geometry accident
    const sinT = Math.SQRT1_2
    const oldHalf = 0.19 / (2 * sinT)
    const crossesOldBandEdge = straps.some((m) => {
      const min = m.position[0] - m.dims[0] / 2
      const max = m.position[0] + m.dims[0] / 2
      // a strap ending strictly INSIDE (23 − oldHalf, 23 + oldHalf) would
      // mean the old band already governed; the widened band must push
      // every strap edge PAST the old band edge on at least one side
      return min > 23 + oldHalf + 1e-9 || max < 23 - oldHalf - 1e-9
    })
    expect(crossesOldBandEdge).toBe(true)
    // perpendicular stems keep the exact round-2 band (byte parity): the
    // round-2 A exhibit above pins [3 − 0.075, 3 + 0.075] unchanged.
  })

  test('round-2 B: trim attribution is honest — a stub teeing into LUMBER never claims CMU', () => {
    // Short steel stub into a lumber through wall: the 4·tS minimum-run
    // re-extension (u0 0.057 + 0.165 = 0.222 > the 0.215 m drawn length)
    // overruns the drawn length; the clamp is geometry hygiene and says
    // so — zero masonry in the scene, zero CMU claims.
    const lumberThru = wall({ id: 'w_lthru', start: [0, 0], end: [4, 0], thickness: 0.114 })
    const stub = wall({ id: 'w_stub', start: [1, 0], end: [1, 0.215], thickness: 0.114 })
    const eng = new Map<string, { construction: 'framed' | 'lgs' }>([
      ['w_lthru', { construction: 'framed' }],
      ['w_stub', { construction: 'lgs' }],
    ])
    const { members } = lgsFrameWalls([stub], spec400, eng, { hintWalls: [lumberThru, stub] })
    const straps = members.filter((m) => m.role === 'strap-bracing')
    expect(straps.length).toBeGreaterThan(0)
    for (const st of straps) {
      expect(st.advisory).not.toContain('CMU')
      expect(st.advisory).toContain('strap run clamped to the wall length')
    }
    // …and a REAL CMU end-trim still claims CMU, never the length clamp
    const cmuThru = wall({ id: 'w_cthru', start: [0, 0], end: [4, 0], thickness: 0.15 })
    const stem = wall({ id: 'w_sstem', start: [1, 0], end: [1, 3], thickness: 0.114 })
    const cmuSide = lgsFrameWalls([stem], spec400, lgsMap(['w_sstem']), { cmuNeighbors: [cmuThru] })
    const cmuStraps = cmuSide.members.filter((m) => m.role === 'strap-bracing')
    expect(cmuStraps.length).toBeGreaterThan(0)
    for (const st of cmuStraps) {
      expect(st.advisory).toContain('run trimmed clear of a CMU junction')
      expect(st.advisory).not.toContain('clamped to the wall length')
    }
  })

  test('taller strap wall (third points) with 24" spacing: clean', () => {
    const spec24 = { ...spec400, studSpacing: inches(24) }
    const w = wall({ id: 'w_tall', start: [0, 0], end: [6, 0], height: 2.9, openings: [door(3)] })
    const eng = lgsMap(['w_tall'])
    const { members } = lgsFrameWalls([w], spec24, eng)
    expect(members.filter((m) => m.role === 'strap-bracing').length).toBe(4)
    expect(violations([...members, ...layoutWallLayers([w], [], spec24, 'TX', [], eng)])).toEqual([])
  })
})
