/**
 * Porch bearing — the way PlanCrafters' `F.porchWall` frames a covered
 * entrance (Steve, 2026-09-06: "porch beams should be sized correctly,
 * girder, and the gable wall on it, look at plan crafters"): a 6x8 beam
 * along the open bearing line with a single top plate on it, carried on
 * 6x6 posts that run from their pad footings up to the beam's underside.
 * The pediment studs the roof engine already stands on the plate line are
 * this beam's gable wall.
 *
 * Pure: the generated entrance's posts (`PorchPostSlice`, the column nodes
 * with `metadata.porch`), the level's walls and roofs, the spec → members.
 *
 *   - the BEAM LINE runs through the entrance's posts (the generator seats
 *     one at each outer corner, one each side of the flight, none over
 *     8 ft apart); the beam spans post face to post face, the plate over it;
 *   - each post is a 6x6 from its own base (grade under a deck, the slab of
 *     a concrete porch) to the beam's underside; its pad footing is poured
 *     by the foundation engine (compute passes the posts along with the
 *     girder posts);
 *   - a cover that dies INTO the house roof (a gable or hip, not a shed on
 *     a ledger) also needs the two SIDE beams from the corner posts back to
 *     the house wall, where the rafters' inboard ends bear: 6x8 + plate,
 *     ending at the wall face.
 *
 * Nothing is invented: the beam is PlanCrafters' 6x8 (5½ × 7¼), the posts
 * the generator's own 6x6, the heights the posts' own; a cover this cannot
 * read (posts on no line, no cover over them) frames nothing and says so.
 */

import { PORCH_BEAM_SIZE as BEAM_SIZE, PORCH_PLATE_SIZE as PLATE_SIZE } from '../core/shell-sync'
import type { FramingSpec } from '../core/spec'
import type { Member, PorchPostSlice, WallSlice } from '../core/types'
import { formatIn, inches } from '../core/units'
import { LUMBER_CROSS_SECTIONS, type LumberSize } from '../lumber'
import type { RoofSegmentSlice } from './roof-framing'

const EPS = 1e-6
/** A wall within this of the beam line, running with it, is the house wall the side beams reach. */
const HOUSE_WALL_REACH = 8
/** Posts closer than this to a straight line through them are on that line. */
const LINE_TOLERANCE = inches(2)

export type PorchFrame = { members: Member[]; warnings: string[] }

type Pt = readonly [number, number]

/** three.js Y rotation: local +x → world (cos θ, 0, −sin θ). */
const yawOf = (dir: Pt) => Math.atan2(-dir[1], dir[0])

export function framePorches(
  posts: readonly PorchPostSlice[],
  walls: readonly WallSlice[],
  roofs: readonly RoofSegmentSlice[],
  spec: FramingSpec,
): PorchFrame {
  const members: Member[] = []
  const warnings: string[] = []
  const groups = new Map<string, PorchPostSlice[]>()
  for (const post of posts) {
    const key = post.entrance ?? post.id
    groups.set(key, [...(groups.get(key) ?? []), post])
  }
  for (const [entrance, group] of groups) {
    const frame = framePorch(entrance, group, walls, roofs, spec)
    members.push(...frame.members)
    warnings.push(...frame.warnings)
  }
  return { members, warnings }
}

function framePorch(
  entrance: string,
  posts: PorchPostSlice[],
  walls: readonly WallSlice[],
  roofs: readonly RoofSegmentSlice[],
  spec: FramingSpec,
): PorchFrame {
  const members: Member[] = []
  const warnings: string[] = []
  const name = `${entrance} porch`
  if (posts.length < 2) {
    warnings.push(`${name}: one post — no beam line to frame (a beam needs two posts).`)
    return { members, warnings }
  }
  // the beam line: through the two posts farthest apart; every post must sit on it
  let a = posts[0] as PorchPostSlice
  let b = posts[1] as PorchPostSlice
  let far = 0
  for (const p of posts) {
    for (const q of posts) {
      const d = Math.hypot(q.plan[0] - p.plan[0], q.plan[1] - p.plan[1])
      if (d > far) {
        far = d
        a = p
        b = q
      }
    }
  }
  if (far < inches(12)) {
    warnings.push(`${name}: its posts stand within a foot of each other — no beam line.`)
    return { members, warnings }
  }
  const dir: Pt = [(b.plan[0] - a.plan[0]) / far, (b.plan[1] - a.plan[1]) / far]
  const normal: Pt = [-dir[1], dir[0]]
  const along = (p: Pt) => (p[0] - a.plan[0]) * dir[0] + (p[1] - a.plan[1]) * dir[1]
  const across = (p: Pt) => (p[0] - a.plan[0]) * normal[0] + (p[1] - a.plan[1]) * normal[1]
  const off = posts.filter((p) => Math.abs(across(p.plan)) > LINE_TOLERANCE)
  if (off.length > 0) {
    warnings.push(
      `${name}: ${off.length} post(s) stand off the beam line — the porch is not a straight run; its beam is not framed.`,
    )
    return { members, warnings }
  }
  const size = Math.max(...posts.map((p) => p.size))
  const postSize: LumberSize = size > inches(5) ? '6x6' : '4x4'
  // the posts stop under the beam (the generator's columns end at the band's
  // underside); the beam sits on them, the plate on the beam, the cover on the plate
  const beamBottom = Math.max(...posts.map((p) => p.baseY + p.height))
  const [plateT] = LUMBER_CROSS_SECTIONS[PLATE_SIZE]
  const [beamW, beamD] = LUMBER_CROSS_SECTIONS[BEAM_SIZE]
  const beamY = beamBottom + beamD / 2
  const plateY = beamBottom + beamD + plateT / 2
  const yaw = yawOf(dir)
  const sorted = [...posts].sort((p, q) => along(p.plan) - along(q.plan))
  const s0 = along((sorted[0] as PorchPostSlice).plan) - size / 2
  const s1 = along((sorted[sorted.length - 1] as PorchPostSlice).plan) + size / 2
  const len = s1 - s0
  const mid: Pt = [a.plan[0] + dir[0] * (s0 + s1) / 2, a.plan[1] + dir[1] * (s0 + s1) / 2]
  const bays = sorted.length - 1
  let widest = 0
  for (let i = 0; i + 1 < sorted.length; i++) {
    widest = Math.max(
      widest,
      along((sorted[i + 1] as PorchPostSlice).plan) - along((sorted[i] as PorchPostSlice).plan),
    )
  }
  const push = (
    role: Member['role'],
    lumber: LumberSize,
    dims: readonly [number, number, number],
    position: readonly [number, number, number],
    rotation: number,
    length: number,
    label: string,
    sourceId: string,
  ) =>
    members.push({
      system: 'roof-framing',
      role,
      size: lumber,
      dims,
      length,
      position,
      rotation: [0, rotation, 0],
      material: 'lumber',
      sourceId,
      label,
    })
  // the beam and its plate along the post line
  push(
    'girder',
    BEAM_SIZE,
    [len, beamD, beamW],
    [mid[0], beamY, mid[1]],
    yaw,
    len,
    `Porch beam ${BEAM_SIZE} on ${sorted.length} ${postSize} posts — ${bays} bay${bays === 1 ? '' : 's'}, widest ${formatIn(widest)} (PlanCrafters porchWall: 6x8 under the cover's bearing line)`,
    a.id,
  )
  push(
    'top-plate',
    PLATE_SIZE,
    [len, plateT, beamW],
    [mid[0], plateY, mid[1]],
    yaw,
    len,
    `Porch beam plate ${PLATE_SIZE} — the cover's rafters seat here`,
    a.id,
  )
  // the posts: base to the beam's underside
  for (const p of sorted) {
    const h = beamBottom - p.baseY
    if (h < inches(12)) {
      warnings.push(`${name}: post ${p.id} has ${formatIn(h)} between its base and the beam — not framed.`)
      continue
    }
    push(
      'post',
      postSize,
      [size, h, size],
      [p.plan[0], p.baseY + h / 2, p.plan[1]],
      yaw,
      h,
      `Porch post ${postSize} — ${formatIn(h)} from its pad footing to the beam (R407.3 base restraint)`,
      p.id,
    )
  }
  // the side beams back to the house — a cover that dies into the house roof
  const cover = roofs.find((r) => coversPoint(r, mid))
  if (!cover) {
    warnings.push(`${name}: no roof segment stands over its beam line — side beams not framed.`)
    return { members, warnings }
  }
  if (cover.attach === 'high') return { members, warnings } // a shed on a ledger: the rafters bear at the wall
  const house = houseWallFor(walls, mid, dir)
  if (!house) {
    warnings.push(
      `${name}: no house wall runs with its beam line within ${HOUSE_WALL_REACH} m — side beams not framed.`,
    )
    return { members, warnings }
  }
  // which way the house lies, and how far the wall FACE is from the post line
  const toWall = across(house.start) > 0 ? 1 : -1
  const wallLineDistance = Math.abs(across(house.start))
  const reach = wallLineDistance - house.thickness / 2
  for (const end of [sorted[0] as PorchPostSlice, sorted[sorted.length - 1] as PorchPostSlice]) {
    const run = reach - size / 2
    if (run < inches(12)) continue
    const sideDir: Pt = [normal[0] * toWall, normal[1] * toWall]
    const from: Pt = [end.plan[0] + sideDir[0] * (size / 2), end.plan[1] + sideDir[1] * (size / 2)]
    const centre: Pt = [from[0] + sideDir[0] * (run / 2), from[1] + sideDir[1] * (run / 2)]
    const sideYaw = yawOf(sideDir)
    push(
      'girder',
      BEAM_SIZE,
      [run, beamD, beamW],
      [centre[0], beamY, centre[1]],
      sideYaw,
      run,
      `Porch side beam ${BEAM_SIZE} — corner post to the house wall face, ${formatIn(run)} (the cover's eave rafters bear on it)`,
      end.id,
    )
    push(
      'top-plate',
      PLATE_SIZE,
      [run, plateT, beamW],
      [centre[0], plateY, centre[1]],
      sideYaw,
      run,
      `Porch side beam plate ${PLATE_SIZE}`,
      end.id,
    )
  }
  void spec
  return { members, warnings }
}

/** Whether a roof segment's plan footprint (no overhang) covers `p`. */
function coversPoint(roof: RoofSegmentSlice, p: Pt): boolean {
  const dx = p[0] - roof.position[0]
  const dz = p[1] - roof.position[2]
  const c = Math.cos(roof.yaw)
  const s = Math.sin(roof.yaw)
  // world → segment-local: rotate by −yaw about y (local +x → world (cos, −sin))
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  const pad = roof.overhang + inches(6)
  return Math.abs(lx) <= roof.width / 2 + pad + EPS && Math.abs(lz) <= roof.depth / 2 + pad + EPS
}

/** The exterior wall running with the beam line nearest to it (within reach). */
function houseWallFor(
  walls: readonly WallSlice[],
  mid: Pt,
  dir: Pt,
): WallSlice | null {
  let best: WallSlice | null = null
  let bestDistance = HOUSE_WALL_REACH
  for (const wall of walls) {
    if (!wall.exterior) continue
    const parallel = Math.abs(wall.dir[0] * dir[0] + wall.dir[1] * dir[1])
    if (parallel < 0.95) continue
    // perpendicular distance from the beam midpoint to the wall line, and
    // the midpoint's projection must fall within the wall's own span
    const n: Pt = [-wall.dir[1], wall.dir[0]]
    const rel: Pt = [mid[0] - wall.start[0], mid[1] - wall.start[1]]
    const distance = Math.abs(rel[0] * n[0] + rel[1] * n[1])
    const s = rel[0] * wall.dir[0] + rel[1] * wall.dir[1]
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    if (s < -inches(6) || s > length + inches(6)) continue
    if (distance < bestDistance) {
      bestDistance = distance
      best = wall
    }
  }
  return best
}
