import { getLevelDisplayName } from '../lib/level-name'
import type { WallFace, WallNode, ZoneNode } from '../schema'
import {
  resolveWallExteriorSide,
  wallAssemblyExposedStructure,
  wallAssemblyFinishRef,
} from '../systems/wall/wall-assembly'
import { getWallCurveFrameAt, isCurvedWall } from '../systems/wall/wall-curve'
import {
  describeWallFaceFinishes,
  getWallLevelZones,
  getWallZoneSpans,
} from '../systems/wall/wall-finish'
import {
  calculateLevelMiters,
  DEFAULT_WALL_HEIGHT,
  getWallPlanFootprint,
} from '../systems/wall/wall-footprint'
import { getWallFaceOffsets } from '../systems/wall/wall-frame'
import { distanceToSegment, pointInPolygon, type Vec2 } from './plan-geometry'
import { levelRole, levelsOf, nodesOnLevel } from './scene-queries'
import type { SceneNodes } from './types'

/**
 * Every visible wall face at the default finish, read from the walls themselves and not through a
 * room: a stub that stands inside a room on no boundary, a partition side no zone looks at, an outside
 * face, all show the viewer's fallback finish the same. A face is read where somebody wrote nothing for
 * it: no slot, no legacy finish, no room finish over it, no paint region on the stretch, no finish
 * script, and, on the exterior side, no assembly cladding. What is not visible is not read: the end
 * of a wall that runs into another wall's body (a face inside a body of the same height or more) is
 * no face. What is not modelled: a paint region that covers part of a face's height counts as covering
 * its stretch, and a curved wall's buried ends are not cut.
 */

type Interval = [number, number]

/** A default stretch shorter than this is a sliver at a join, not a face. */
const MIN_STRETCH_M = 0.1
/** A point of a face this far inside another wall's outline is in its body; closer is on its surface. */
const BURIED_MARGIN_M = 0.01
/** How far in front of a face a probe looks for the room it stands in. */
const LOOK_AHEAD_M = 0.05
/** Another wall buries a face only when it is not lower than the wall by more than this. */
const HEIGHT_SLACK_M = 0.05

export type DefaultWallFace = {
  wallId: string
  wallName: string
  levelId: string
  levelName: string
  face: WallFace
  /** Metres of the face at the default, visible stretches only. */
  metres: number
  /** Metres along the wall's reference line, each stretch. */
  stretches: Interval[]
  /** Plan points (x, z) on the wall's reference line where the first stretch starts and the last ends. */
  from: [number, number]
  to: [number, number]
  /** The rooms that stand on this face along its default stretches. */
  facing: string[]
  /** With none facing: the rooms the wall stands inside, on no boundary. */
  standsIn: string[]
}

export type WallFaceReading = {
  /** Visible wall faces read (a face with a visible stretch of `MIN_STRETCH_M` or more). */
  faces: number
  metres: number
  defaults: DefaultWallFace[]
}

const length = (stretches: readonly Interval[]) =>
  stretches.reduce((sum, [u0, u1]) => sum + u1 - u0, 0)

function merged(intervals: readonly Interval[]): Interval[] {
  const out: Interval[] = []
  for (const [u0, u1] of [...intervals].sort((p, q) => p[0] - q[0])) {
    const last = out.at(-1)
    if (last && u0 <= last[1] + 1e-9) last[1] = Math.max(last[1], u1)
    else out.push([u0, u1])
  }
  return out
}

/** `from` less every `cut`, as intervals longer than `MIN_STRETCH_M`. */
function subtract(from: readonly Interval[], cut: readonly Interval[]): Interval[] {
  const holes = merged(cut)
  const out: Interval[] = []
  for (const [a, b] of from) {
    let reach = a
    for (const [h0, h1] of holes) {
      if (h1 <= reach || h0 >= b) continue
      if (h0 > reach) out.push([reach, h0])
      reach = Math.max(reach, h1)
    }
    if (reach < b) out.push([reach, b])
  }
  return out.filter(([u0, u1]) => u1 - u0 >= MIN_STRETCH_M)
}

type Body = { wall: WallNode; ring: Vec2[]; bounds: [number, number, number, number] }

function bodiesOf(walls: readonly WallNode[]): Body[] {
  const usable = walls.filter(
    (wall) =>
      Array.isArray(wall.start) &&
      Array.isArray(wall.end) &&
      wall.wallType !== 'curtain' &&
      wall.visible !== false,
  )
  let miters: ReturnType<typeof calculateLevelMiters>
  try {
    miters = calculateLevelMiters(usable)
  } catch {
    return []
  }
  return usable.flatMap((wall) => {
    const ring = getWallPlanFootprint(wall, miters).map((point): Vec2 => [point.x, point.y])
    if (ring.length < 3) return []
    const xs = ring.map(([x]) => x)
    const zs = ring.map(([, z]) => z)
    return [
      { wall, ring, bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] },
    ]
  })
}

const heightOf = (wall: WallNode) => wall.height ?? DEFAULT_WALL_HEIGHT

/** Whether a point is in a ring's body: inside it and more than `BURIED_MARGIN_M` from its surface. */
function inBody(point: Vec2, ring: readonly Vec2[]): boolean {
  if (!pointInPolygon(point, [...ring], false)) return false
  for (let index = 0; index < ring.length; index += 1)
    if (distanceToSegment(point, ring[index]!, ring[(index + 1) % ring.length]!) < BURIED_MARGIN_M)
      return false
  return true
}

/**
 * The stretches of a straight wall's face line (metres along the wall) that lie inside the body of
 * another wall of the level, one at least as high: a face there is covered, not seen.
 */
function buriedStretches(wall: WallNode, offset: number, bodies: readonly Body[]): Interval[] {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const run = Math.hypot(dx, dz)
  if (run < 1e-9) return []
  const nx = -dz / run
  const nz = dx / run
  const p0: Vec2 = [wall.start[0] + nx * offset, wall.start[1] + nz * offset]
  const d: Vec2 = [dx, dz]
  const box = [
    Math.min(p0[0], p0[0] + dx),
    Math.min(p0[1], p0[1] + dz),
    Math.max(p0[0], p0[0] + dx),
    Math.max(p0[1], p0[1] + dz),
  ]
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx
  const buried: Interval[] = []
  for (const body of bodies) {
    if (body.wall.id === wall.id || heightOf(body.wall) < heightOf(wall) - HEIGHT_SLACK_M) continue
    const [x0, z0, x1, z1] = body.bounds
    if (x1 < box[0]! - BURIED_MARGIN_M || x0 > box[2]! + BURIED_MARGIN_M) continue
    if (z1 < box[1]! - BURIED_MARGIN_M || z0 > box[3]! + BURIED_MARGIN_M) continue
    const cuts = [0, 1]
    for (let index = 0; index < body.ring.length; index += 1) {
      const q0 = body.ring[index]!
      const q1 = body.ring[(index + 1) % body.ring.length]!
      const e: Vec2 = [q1[0] - q0[0], q1[1] - q0[1]]
      const denominator = cross(d[0], d[1], e[0], e[1])
      if (Math.abs(denominator) < 1e-12) continue
      const w: Vec2 = [q0[0] - p0[0], q0[1] - p0[1]]
      const t = cross(w[0], w[1], e[0], e[1]) / denominator
      const s = cross(w[0], w[1], d[0], d[1]) / denominator
      if (s >= 0 && s <= 1 && t > 0 && t < 1) cuts.push(t)
    }
    cuts.sort((p, q) => p - q)
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const [t0, t1] = [cuts[index]!, cuts[index + 1]!]
      if ((t1 - t0) * run < 1e-4) continue
      const middle: Vec2 = [p0[0] + d[0] * ((t0 + t1) / 2), p0[1] + d[1] * ((t0 + t1) / 2)]
      if (inBody(middle, body.ring)) buried.push([t0 * run, t1 * run])
    }
  }
  return merged(buried)
}

const rounded = (value: number) => Math.round(value * 100) / 100

function pointAlong(wall: WallNode, u: number): [number, number] {
  const run = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const { point } = getWallCurveFrameAt(wall, run > 0 ? u / run : 0)
  return [rounded(point.x), rounded(point.y)]
}

const FACES: readonly WallFace[] = ['a', 'b']

/**
 * Every wall face of the scene read for the default finish. Walls that are hidden, curtain walls and
 * walls on a roof level are left out; a scene whose walls cannot be walked reads as no faces.
 */
export function readWallFaces(nodes: SceneNodes): WallFaceReading {
  const reading: WallFaceReading = { faces: 0, metres: 0, defaults: [] }
  for (const level of levelsOf(nodes)) {
    if (levelRole(nodes, level).role === 'roof') continue
    const walls = nodesOnLevel(nodes, level.id).filter(
      (node): node is WallNode =>
        node.type === 'wall' &&
        node.visible !== false &&
        node.wallType !== 'curtain' &&
        Array.isArray(node.start) &&
        Array.isArray(node.end),
    )
    if (!walls.length) continue
    const bodies = bodiesOf(walls)
    const rooms = getWallLevelZones({ parentId: level.id }, nodes).filter(
      (zone) => zone.spaceRole === 'room' && zone.polygon.length >= 3,
    )
    const levelName = getLevelDisplayName(level)
    for (const wall of walls) {
      const run = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
      if (run < MIN_STRETCH_M) continue
      const finishes = describeWallFaceFinishes(wall, nodes)
      const offsets = getWallFaceOffsets(wall)
      const spans = getWallZoneSpans(wall, rooms)
      const exteriorSide = resolveWallExteriorSide(wall)
      const clad =
        wallAssemblyFinishRef(wall) !== null || wallAssemblyExposedStructure(wall) !== null
      for (const face of FACES) {
        const buried = isCurvedWall(wall) ? [] : buriedStretches(wall, offsets[face], bodies)
        const visible = subtract([[0, run]], buried)
        const seen = length(visible)
        if (seen < MIN_STRETCH_M) continue
        reading.faces += 1
        reading.metres += seen
        const written =
          wall.finishScripts?.[face] !== undefined ||
          (clad && exteriorSide !== null && (exteriorSide === 1 ? 'a' : 'b') === face)
        if (written) continue
        const own = finishes[face].stretches
          .filter((stretch) => stretch.source === 'wall_face' && stretch.chain === 'default')
          .map((stretch): Interval => [stretch.u0, stretch.u1])
        const painted = finishes[face].paintRegions.map(
          (region): Interval => [region.u0 ?? 0, region.u1 ?? run],
        )
        const stretches = subtract(subtract(own, painted), buried)
        if (!stretches.length) continue
        const first = stretches[0]![0]
        const last = stretches.at(-1)![1]
        const faceSpans = spans.filter(
          (span) =>
            span.face === face &&
            stretches.some(([u0, u1]) => span.t1 * run > u0 + 0.02 && span.t0 * run < u1 - 0.02),
        )
        const facing = [...new Set(faceSpans.map((span) => (nodes[span.zoneId] as ZoneNode).name))]
        const standsIn = facing.length
          ? []
          : roomsStoodIn(wall, face, offsets[face], stretches, rooms)
        reading.defaults.push({
          wallId: wall.id,
          wallName: wall.name ?? wall.id,
          levelId: level.id,
          levelName,
          face,
          metres: length(stretches),
          stretches,
          from: pointAlong(wall, first),
          to: pointAlong(wall, last),
          facing,
          standsIn,
        })
      }
    }
  }
  return reading
}

/** The rooms a probe a little in front of the stretches' middle lies in. */
function roomsStoodIn(
  wall: WallNode,
  face: WallFace,
  offset: number,
  stretches: readonly Interval[],
  rooms: readonly ZoneNode[],
): string[] {
  const widest = [...stretches].sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0]!
  const run = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const [x, z] = pointAlong(wall, (widest[0] + widest[1]) / 2)
  const ahead = offset + (face === 'a' ? LOOK_AHEAD_M : -LOOK_AHEAD_M)
  const probe: Vec2 = [x + (-dz / run) * ahead, z + (dx / run) * ahead]
  return rooms
    .filter(
      (zone) =>
        pointInPolygon(probe, zone.polygon as Vec2[]) &&
        !(zone.holes ?? []).some((hole) => pointInPolygon(probe, hole as Vec2[], false)),
    )
    .map((zone) => zone.name)
}
