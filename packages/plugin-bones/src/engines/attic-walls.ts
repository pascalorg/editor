/**
 * Attic separation walls (W17) — the dwelling–garage separation carried to
 * the roof deck.
 *
 * Table R302.6 puts 1/2 in gypsum on the garage side of the walls between
 * the garage and the dwelling; where the garage and the house share an
 * attic (the generator's garage wing runs under the main roof, W16c) that
 * separation has to continue above the ceiling to the underside of the
 * roof, or the gypsum stops at the plate and the attic is one open volume.
 * The wall engine frames every wall to its plate; this engine frames the
 * wall ABOVE it: a flat 2x plate laid across the ceiling joists along the
 * separation line, studs at the wall's stud spacing from that plate up to
 * the roof underside at each station (the box inscribed a hair under the
 * sloped plane at both faces), skipping stations the roof's own members
 * occupy (the ridge board and purlins, collar ties, purlin struts, hips and
 * valleys — no fake wood through real wood) and stations too short to be
 * a stud. Roofs on another level are not seen (their frame differs).
 */
import type { FramingSpec } from '../core/spec'
import type { Member, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { LUMBER_CROSS_SECTIONS } from '../lumber'
import { memberAxis, type RoofSegmentSlice, roofPlaneAt } from './roof-framing'
import { frameOf, studSizeFor } from './wall-framing'

const EPS = 1e-9
/** A stud shorter than this is a block, not a wall — the plane is already at the plate. */
const MIN_STUD = 0.15
/** Clearance under the roof underside (the plane is the rafters' bottom face). */
const UNDER_ROOF = 0.005
/** A roof member this close (plan) to a stud line owns that station. */
const OBSTACLE_MARGIN = 0.02
/** Roof members a stud must not pass through — the ridge board and purlins,
 * collar ties, purlin struts, hips, valleys, and the roof's own gable /
 * pediment studs (an attic wall butts a gable wall, never shares its line). */
const OBSTACLES = new Set<Member['role']>(['ridge', 'collar-tie', 'post', 'hip', 'valley', 'stud'])
/** A joist whose axis passes this close to a station bears the plate there. */
const JOIST_REACH = 0.3
/** A separation wall this close to a gable segment's end line IS that gable end. */
const GABLE_END_TOLERANCE = 0.1

/**
 * True when the wall runs along a gable segment's end line — the roof
 * engine already frames that line with gable-end studs from the plate to
 * the rafters (the generator's garage wing hangs off the main's gable
 * end), so the separation above the ceiling is that infill, not a new wall.
 */
export function onGableEnd(wall: WallSlice, roofs: readonly RoofSegmentSlice[]): boolean {
  const mx = (wall.start[0] + wall.end[0]) / 2
  const mz = (wall.start[1] + wall.end[1]) / 2
  for (const roof of roofs) {
    if (roof.roofType !== 'gable') continue
    const [xl, zl] = toLocal(roof, mx, mz)
    if (Math.abs(Math.abs(xl) - roof.width / 2) > GABLE_END_TOLERANCE) continue
    if (Math.abs(zl) > roof.depth / 2 + GABLE_END_TOLERANCE) continue
    // the wall must run across the ridge (with the end line): its direction
    // along the segment's local x must be ~0
    const cos = Math.cos(roof.yaw)
    const sin = Math.sin(roof.yaw)
    const alongRidge = wall.dir[0] * cos - wall.dir[1] * sin
    if (Math.abs(alongRidge) < 0.1) return true
  }
  return false
}

export interface AtticSeparationResult {
  members: Member[]
  warnings: string[]
}

/** What the wall above the ceiling is: the garage separation, or a bearing partition under a shed's rafters (W18). */
export type WallToRoofKind = 'separation' | 'bearing'

/** Level plan point → a segment's local (x along its ridge axis, z across). */
function toLocal(roof: RoofSegmentSlice, px: number, pz: number): [number, number] {
  const dx = px - roof.position[0]
  const dz = pz - roof.position[2]
  const cos = Math.cos(roof.yaw)
  const sin = Math.sin(roof.yaw)
  return [dx * cos - dz * sin, dx * sin + dz * cos]
}

/** The lowest roof underside over a level plan point, or null off every roof. */
export function roofUndersideAt(
  roofs: readonly RoofSegmentSlice[],
  px: number,
  pz: number,
): number | null {
  let low: number | null = null
  for (const roof of roofs) {
    const [xl, zl] = toLocal(roof, px, pz)
    if (Math.abs(xl) > roof.width / 2 + EPS || Math.abs(zl) > roof.depth / 2 + EPS) continue
    const y = roofPlaneAt(roof, xl, zl)
    if (y === null) continue
    if (low === null || y < low) low = y
  }
  return low
}

/** Half the member's plan footprint across its axis — a vertical member's
 * whole plan footprint, a stick's thickness. */
function planHalfAcross(m: Member): number {
  const axis = memberAxis(m)
  return Math.abs(axis[1]) > 0.9 ? Math.max(m.dims[0], m.dims[2]) / 2 : m.dims[2] / 2
}

/** Plan distance from a point to a member's axis segment. */
function planDistance(m: Member, px: number, pz: number): number {
  const axis = memberAxis(m)
  const half = m.dims[0] / 2
  const ax = m.position[0] - axis[0] * half
  const az = m.position[2] - axis[2] * half
  const bx = m.position[0] + axis[0] * half
  const bz = m.position[2] + axis[2] * half
  const vx = bx - ax
  const vz = bz - az
  const len2 = vx * vx + vz * vz
  const t = len2 < EPS ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2))
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz))
}

/**
 * Frame the attic walls over `separations` (the dwelling–garage walls, as
 * compute picks them with `garageSideOf`) under `roofs` on the same level,
 * against the roof `members` already framed there.
 */
export function frameAtticSeparations(
  separations: readonly WallSlice[],
  roofs: readonly RoofSegmentSlice[],
  roofMembers: readonly Member[],
  spec: FramingSpec,
): AtticSeparationResult {
  return frameWallsToRoof(separations, roofs, roofMembers, spec, 'separation')
}

/**
 * The interior partitions a shed's rafters bear on (W18), framed from
 * their plates up to the rafters' underside — the same machinery as the
 * garage separation, worded for bearing.
 */
export function frameBearingWallsToRoof(
  bearing: readonly WallSlice[],
  roofs: readonly RoofSegmentSlice[],
  roofMembers: readonly Member[],
  spec: FramingSpec,
): AtticSeparationResult {
  return frameWallsToRoof(bearing, roofs, roofMembers, spec, 'bearing')
}

export function frameWallsToRoof(
  separations: readonly WallSlice[],
  roofs: readonly RoofSegmentSlice[],
  roofMembers: readonly Member[],
  spec: FramingSpec,
  kind: WallToRoofKind,
): AtticSeparationResult {
  const members: Member[] = []
  const warnings: string[] = []
  if (roofs.length === 0 || separations.length === 0) return { members, warnings }
  const what = kind === 'separation' ? 'dwelling–garage separation' : 'shed bearing partition'
  const joists = roofMembers.filter((m) => m.role === 'ceiling-joist')
  // …a valley SLEEPER (W19) lies on the deck, above every stud top
  const obstacles = roofMembers.filter(
    (m) => OBSTACLES.has(m.role) && !m.label?.startsWith('Valley sleeper'),
  )
  // walls framed earlier in this pass: their studs and plates are obstacles
  // to the next wall, and a later plate is cut around an earlier one where
  // the two cross (one plate runs through, the other butts it)
  const placed: Member[] = []
  const placedPlates: {
    start: readonly [number, number]
    dir: readonly [number, number]
    u0: number
    u1: number
    wFit: number
  }[] = []
  let studs = 0
  let wallsFramed = 0
  let onGableEnds = 0
  let noAttic = 0
  for (const wall of separations) {
    if (wall.curved) continue
    if (onGableEnd(wall, roofs)) {
      onGableEnds += 1
      continue
    }
    const { yaw, place } = frameOf(wall)
    const studSize = studSizeFor(wall, spec)
    const [t, w] = LUMBER_CROSS_SECTIONS[studSize]
    const wFit = Math.min(w, Math.max(inches(1.5), wall.thickness - inches(0.1)))
    const halfT = t / 2
    const wallTop = (wall.baseY ?? 0) + wall.height
    // the plate rides the tallest joist the wall crosses (the W15 lapped
    // pieces are sized per span — the shorter ones get shims, said below)
    let joistTop = wallTop
    const stations: { u: number; px: number; pz: number }[] = []
    for (let u = halfT; u <= wall.length - halfT + EPS; u += spec.studSpacing) {
      const [px, , pz] = place(u, 0)
      stations.push({ u, px, pz })
    }
    const last = wall.length - halfT
    if (stations.length === 0 || last - (stations[stations.length - 1]?.u ?? 0) > t) {
      const [px, , pz] = place(last, 0)
      stations.push({ u: last, px, pz })
    }
    for (const st of stations) {
      for (const j of joists) {
        if (planDistance(j, st.px, st.pz) > JOIST_REACH) continue
        joistTop = Math.max(joistTop, j.position[1] + j.dims[1] / 2)
      }
    }
    // a flat plate only where joists carry the wall; with none (a shed's
    // vaulted ceiling) the studs stand on the wall's own top plate
    const onJoists = joistTop > wallTop + EPS
    const plateBottom = joistTop
    const plateTop = onJoists ? plateBottom + t : wallTop
    const framed: { u: number; height: number }[] = []
    let tooShort = 0
    const [dx, dz] = wall.dir
    // the stud's plan rectangle: ±halfT along the wall, ±wFit/2 across it
    const nx = -dz
    const nz = dx
    const studRadius = Math.max(halfT, wFit / 2)
    for (const st of stations) {
      // the underside at the four corners of the plumb stud — the lowest governs
      const corners: number[] = []
      let offRoof = false
      for (const a of [-halfT, halfT]) {
        for (const b of [-wFit / 2, wFit / 2]) {
          const y = roofUndersideAt(roofs, st.px + dx * a + nx * b, st.pz + dz * a + nz * b)
          if (y === null) offRoof = true
          else corners.push(y)
        }
      }
      if (offRoof || corners.length === 0) continue
      const top = Math.min(...corners) - UNDER_ROOF
      const height = top - plateTop
      if (height < MIN_STUD) {
        tooShort += 1
        continue
      }
      // no stud through the ridge, a purlin, a collar tie, a strut, a hip, a
      // valley or a gable stud within the stud's reach
      const blocked = [...obstacles, ...placed].some((m) => {
        if (planDistance(m, st.px, st.pz) > planHalfAcross(m) + studRadius + OBSTACLE_MARGIN) {
          return false
        }
        const mBottom = m.position[1] - m.dims[1] / 2
        return mBottom < top + EPS
      })
      if (blocked) continue
      framed.push({ u: st.u, height })
    }
    if (framed.length === 0) {
      // every station on the roof but under a stud's height: the roof
      // meets the plate along this wall (a hip end) — no attic to separate
      if (tooShort > 0 && tooShort === stations.length) noAttic += 1
      continue
    }
    wallsFramed += 1
    const u0 = (framed[0]?.u ?? 0) - halfT
    const u1 = (framed[framed.length - 1]?.u ?? 0) + halfT
    // cut this plate around every earlier plate it crosses
    const cuts: [number, number][] = []
    for (const p of placedPlates) {
      // solve start + dir·u = p.start + p.dir·s
      const det = dx * -p.dir[1] - dz * -p.dir[0]
      if (Math.abs(det) < 1e-9) continue // parallel
      const rx = p.start[0] - wall.start[0]
      const rz = p.start[1] - wall.start[1]
      const u = (rx * -p.dir[1] - rz * -p.dir[0]) / det
      const sv = (dx * rz - dz * rx) / det
      if (u < u0 || u > u1 || sv < p.u0 || sv > p.u1) continue
      const gap = p.wFit / 2 + 0.005
      cuts.push([u - gap, u + gap])
    }
    cuts.sort((a, b) => a[0] - b[0])
    const pieces: [number, number][] = []
    let cursor = u0
    for (const [a, b] of cuts) {
      if (a > cursor) pieces.push([cursor, Math.min(a, u1)])
      cursor = Math.max(cursor, b)
    }
    if (cursor < u1) pieces.push([cursor, u1])
    for (const [a, b] of pieces) {
      const plateLen = b - a
      if (plateLen < 0.3) continue
      if (!onJoists) {
        placedPlates.push({ start: wall.start, dir: wall.dir, u0: a, u1: b, wFit })
        continue
      }
      const plate: Member = {
        system: 'wall-framing',
        role: 'bottom-plate',
        size: studSize,
        dims: [plateLen, t, wFit],
        length: plateLen,
        position: place((a + b) / 2, plateBottom + t / 2),
        rotation: [0, yaw, 0],
        material: 'lumber',
        sourceId: wall.id,
        label:
          kind === 'separation'
            ? `Attic separation wall plate ${studSize} flat on the ceiling joists — the dwelling–garage separation carried to the roof deck (R302.6); shim to the shallower lapped joist pieces${cuts.length > 0 ? '; butts the crossing separation wall' : ''}`
            : `Bearing partition plate ${studSize} flat on the ceiling joists — the wall carried up to the shed rafters it bears (R802.4.1); shim to the shallower joist pieces${cuts.length > 0 ? '; butts the crossing wall' : ''}`,
      }
      members.push(plate)
      placed.push(plate)
      placedPlates.push({ start: wall.start, dir: wall.dir, u0: a, u1: b, wFit })
    }
    for (const f of framed) {
      // a stud whose plate piece was cut away (the crossing) goes with it
      if (!pieces.some(([a, b]) => f.u >= a - EPS && f.u <= b + EPS)) continue
      studs += 1
      const stud: Member = {
        system: 'wall-framing',
        role: 'stud',
        size: studSize,
        dims: [t, f.height, wFit],
        length: f.height,
        position: place(f.u, plateTop + f.height / 2),
        rotation: [0, yaw, 0],
        material: 'lumber',
        sourceId: wall.id,
        label:
          kind === 'separation'
            ? `Attic separation stud ${studSize} — dwelling–garage separation to the roof deck (R302.6), top cut to the roof slope`
            : `Bearing partition stud ${studSize} — the wall carried up to the shed rafters it bears, top cut to the roof slope (sloped top plate not modelled; R802.4.1 span between supports)`,
      }
      members.push(stud)
      placed.push(stud)
    }
  }
  if (studs > 0) {
    warnings.push(
      kind === 'separation'
        ? `attic separation: the dwelling–garage separation is carried above the ceiling to the roof deck on ${wallsFramed} wall${wallsFramed === 1 ? '' : 's'} (${studs} studs on a flat plate over the ceiling joists) — 1/2 in gypsum on the garage side up to the deck (Table R302.6); stations under the ridge, purlins, ties, struts, hips and valleys are left open for that wood`
        : `shed bearing: ${wallsFramed} interior partition${wallsFramed === 1 ? '' : 's'} carr${wallsFramed === 1 ? 'ies' : 'y'} the shed rafters and ${wallsFramed === 1 ? 'is' : 'are'} framed up to their underside (${studs} studs, tops cut to the slope; the sloped top plate is not modelled) — frame ${wallsFramed === 1 ? 'it' : 'them'} as BEARING: double top plate, studs stacked, the load path to the foundation (girder / thickened slab) to verify (R802.4.1)`,
    )
  }
  if (noAttic > 0) {
    warnings.push(
      `attic separation: the roof meets the plate along ${noAttic} ${what} wall${noAttic === 1 ? '' : 's'} (a hip end) — no attic above ${noAttic === 1 ? 'it' : 'them'} to separate; the wall's own garage-side gypsum reaches the deck (Table R302.6)`,
    )
  }
  if (onGableEnds > 0) {
    warnings.push(
      `attic separation: ${onGableEnds} ${what} wall${onGableEnds === 1 ? ' lies' : 's lie'} on a gable end — the gable-end studs above the plate are that separation: 1/2 in gypsum on the garage side of that infill up to the deck (Table R302.6)`,
    )
  }
  return { members, warnings }
}
