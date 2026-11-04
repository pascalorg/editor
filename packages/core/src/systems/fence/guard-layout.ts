import type { FenceNode } from '../../schema'
import { getFenceCenterlineFrameAt, getFenceCenterlineLength } from './fence-centerline'

/** Dressed lumber the guard is built from, metres. */
const IN = 0.0254
const GUARD_CAP_T = 1.5 * IN
const GUARD_CAP_W = 5.5 * IN
const GUARD_RAIL_T = 1.5 * IN
const GUARD_RAIL_D = 3.5 * IN
const GUARD_BALUSTER = 1.5 * IN
const GUARD_BOARD_D = 5.5 * IN
const GUARD_CABLE = 0.5 * IN
const GUARD_POST_ABOVE_CAP = 3 * IN
const GUARD_POST_CAP_T = 1 * IN

/** A box standing on the fence's base: its centre, the turn about the vertical axis, its size along its own axes. */
export type GuardPost = {
  position: [number, number, number]
  rotationY: number
  scale: [number, number, number]
  /** A 4-sided cone, square base aligned to the box. */
  shape?: 'pyramid'
}

/**
 * A run along the centreline between two fractions of its length, `depth` across it, `height` tall
 * round `centerY`. `split` runs are cut into short segments so a curved fence bends them.
 */
export type GuardBlock = {
  startT: number
  endT: number
  centerY: number
  height: number
  depth: number
  split: boolean
}

export type GuardLayout = {
  posts: GuardPost[]
  /** The cap rail flat over the posts and the top rail on edge under it. */
  rail: GuardBlock[]
  /** The bottom rail the balusters stand on (balusters only). */
  base: GuardBlock[]
  /** Balusters, cables or boards. */
  infill: GuardBlock[]
}

type Frame = { x: number; z: number; angle: number }

function frameAt(fence: FenceNode, t: number): Frame {
  const { point, tangent } = getFenceCenterlineFrameAt(fence, t)
  return { x: point.x, z: point.y, angle: Math.atan2(tangent.y, tangent.x) }
}

/**
 * A deck guard the way the AWC Deck Construction Guide (DCA 6) draws one: 4x4 posts (`postSize`) no
 * more than `postSpacing` apart, the two ends counted as posts whether drawn or not (`startPost` /
 * `endPost` false: the rails die into a post already standing there), a 2x6 cap rail flat over the
 * posts, a 2x4 top rail on edge under it, and the infill: balusters (2x2 on a 2x4 bottom rail
 * `groundClearance` over the deck, `slatGap` clear), cable (½ in runs `slatGap` apart from
 * `groundClearance` up), or boards (`thickness` x 5½ in, `slatGap` apart from `groundClearance`
 * up). `postThrough` runs the posts 3 in past the cap under a cap of their own (`postCap`).
 *
 * The pure layout the guard renderer builds its meshes from and the usage field reads its
 * obstacles from, so the two cannot disagree.
 */
export function layoutGuardFence(fence: FenceNode): GuardLayout {
  const posts: GuardPost[] = []
  const infill: GuardBlock[] = []
  const base: GuardBlock[] = []
  const rail: GuardBlock[] = []
  const length = Math.max(getFenceCenterlineLength(fence), 0.01)
  const H = Math.max(fence.height, 0.4)
  const postW = Math.max(fence.postSize, 0.02)
  const clearance = Math.max(fence.groundClearance, 0)
  const gap = Math.max(fence.slatGap ?? 0.09, 0.01)
  const infillKind = fence.guardInfill ?? 'balusters'
  const through = fence.postThrough === true
  const capTop = H
  const capBottom = H - GUARD_CAP_T
  const topRailBottom = capBottom - GUARD_RAIL_D
  const bays = Math.max(1, Math.ceil(length / Math.max(fence.postSpacing, postW * 2)))
  const stations: number[] = []
  for (let i = 0; i <= bays; i++) stations.push(i / bays)

  // posts: to the cap's underside, or through it with a cap
  const postH = through ? capTop + GUARD_POST_ABOVE_CAP : capBottom
  for (const [i, t] of stations.entries()) {
    if (i === 0 && fence.startPost === false) continue
    if (i === stations.length - 1 && fence.endPost === false) continue
    const frame = frameAt(fence, t)
    posts.push({
      position: [frame.x, postH / 2, frame.z],
      rotationY: -frame.angle,
      scale: [postW, postH, postW],
    })
    if (through && (fence.postCap ?? 'flat') !== 'none') {
      const cap = fence.postCap ?? 'flat'
      if (cap === 'pyramid') {
        posts.push({
          position: [frame.x, postH + postW * 0.45, frame.z],
          rotationY: -frame.angle,
          scale: [postW * 1.18, postW * 0.9, postW * 1.18],
          shape: 'pyramid',
        })
      } else {
        posts.push({
          position: [frame.x, postH + GUARD_POST_CAP_T / 2, frame.z],
          rotationY: -frame.angle,
          scale: [postW + 2 * IN, GUARD_POST_CAP_T, postW + 2 * IN],
        })
      }
    }
  }

  const run = (centerY: number, height: number, depth: number): GuardBlock => ({
    startT: 0,
    endT: 1,
    centerY,
    height,
    depth,
    split: true,
  })
  rail.push(run(capBottom + GUARD_CAP_T / 2, GUARD_CAP_T, GUARD_CAP_W))
  rail.push(run(topRailBottom + GUARD_RAIL_D / 2, GUARD_RAIL_D, GUARD_RAIL_T))

  const postHalfT = postW / 2 / length
  const clearOfPosts = (t: number, halfT: number) =>
    !stations.some((s) => Math.abs(s - t) < postHalfT + halfT)

  if (infillKind === 'balusters') {
    // the 2x4 bottom rail `clearance` over the deck, the balusters on it
    const bottomRailTop = clearance + GUARD_RAIL_D
    base.push(run(clearance + GUARD_RAIL_D / 2, GUARD_RAIL_D, GUARD_RAIL_T))
    const balH = Math.max(topRailBottom - bottomRailTop, 0.05)
    const pitch = GUARD_BALUSTER + gap
    const halfT = GUARD_BALUSTER / 2 / length
    for (let s = pitch; s < length - GUARD_BALUSTER; s += pitch) {
      const t = s / length
      if (!clearOfPosts(t, halfT)) continue
      if (2 * halfT <= 1e-5) continue
      infill.push({
        startT: t - halfT,
        endT: t + halfT,
        centerY: bottomRailTop + balH / 2,
        height: balH,
        depth: GUARD_BALUSTER,
        split: false,
      })
    }
  } else if (infillKind === 'cable') {
    // ½ in cables `gap` apart from `clearance` up to under the top rail
    for (let y = clearance; y < topRailBottom - GUARD_CABLE; y += gap)
      infill.push(run(y + GUARD_CABLE / 2, GUARD_CABLE, GUARD_CABLE))
  } else {
    // boards `gap` apart from `clearance` up to under the top rail
    const boardT = Math.max(fence.thickness, 0.012)
    for (let y = clearance; y + GUARD_BOARD_D <= topRailBottom + 1e-6; y += GUARD_BOARD_D + gap)
      infill.push(run(y + GUARD_BOARD_D / 2, GUARD_BOARD_D, boardT))
  }

  return { posts, infill, base, rail }
}

/**
 * The fractions a run between `startT` and `endT` is cut at: segments no longer than
 * `maxSegmentLength`, so a curved fence bends them.
 */
export function fenceBlockSegments(
  fence: FenceNode,
  startT: number,
  endT: number,
  maxSegmentLength: number,
): [number, number][] {
  const length = getFenceCenterlineLength(fence) * Math.max(1e-4, endT - startT)
  const count = Math.max(1, Math.ceil(length / Math.max(1e-4, maxSegmentLength)))
  return Array.from({ length: count }, (_, index) => [
    startT + (endT - startT) * (index / count),
    startT + (endT - startT) * ((index + 1) / count),
  ])
}

type Corner = [number, number]

/**
 * The four plan corners of a run between `startT` and `endT`, `depth` across the centreline and
 * shifted `lateralOffset` to the side the frame's normal points: the outer then the inner corner at
 * the start, then at the end.
 */
export function fenceBlockCorners(
  fence: FenceNode,
  startT: number,
  endT: number,
  depth: number,
  lateralOffset = 0,
): [Corner, Corner, Corner, Corner] {
  const half = depth / 2
  const at = (t: number): [Corner, Corner] => {
    const frame = frameAt(fence, t)
    const nx = -Math.sin(frame.angle)
    const nz = Math.cos(frame.angle)
    return [
      [frame.x + nx * (half + lateralOffset), frame.z + nz * (half + lateralOffset)],
      [frame.x - nx * (half - lateralOffset), frame.z - nz * (half - lateralOffset)],
    ]
  }
  const [startOuter, startInner] = at(startT)
  const [endOuter, endInner] = at(endT)
  return [startOuter, startInner, endOuter, endInner]
}

/**
 * Where a run's end moves to when its fence meets `neighbor` at a corner: the two end corners slide
 * along the fence so the run meets the neighbour's in a mitre. `side` is -1 for the inner corner and
 * 1 for the outer, `reach` the metres along the unit vector `(ux, uz)`; null where the two run
 * nearly straight on, or the mitre would reach absurdly far.
 */
export function fenceMiter(
  fence: FenceNode,
  endpoint: 'start' | 'end',
  neighbor: FenceNode,
  depth: number,
  lateralOffset = 0,
): { side: -1 | 1; reach: number; ux: number; uz: number }[] | null {
  const point = fence[endpoint]
  const frame = getFenceCenterlineFrameAt(fence, endpoint === 'start' ? 0 : 1)
  const sign = endpoint === 'start' ? 1 : -1
  const ux = frame.tangent.x * sign
  const uz = frame.tangent.y * sign
  const neighborAtStart =
    Math.hypot(neighbor.start[0] - point[0], neighbor.start[1] - point[1]) < 0.001
  const other = getFenceCenterlineFrameAt(neighbor, neighborAtStart ? 0 : 1)
  const vx = other.tangent.x * (neighborAtStart ? 1 : -1)
  const vz = other.tangent.y * (neighborAtStart ? 1 : -1)
  const cross = ux * vz - uz * vx
  if (Math.abs(cross) < 0.15) return null
  const ratio = Math.max(neighbor.thickness, 0.03) / Math.max(fence.thickness, 0.03)
  const out: { side: -1 | 1; reach: number; ux: number; uz: number }[] = []
  for (const side of [-1, 1] as const) {
    const offset = lateralOffset + (side * depth) / 2
    const neighborOffset = -offset * sign * ratio
    const nx = -uz * offset * sign
    const nz = ux * offset * sign
    const mx = -vz * neighborOffset
    const mz = vx * neighborOffset
    const reach = ((mx - nx) * vz - (mz - nz) * vx) / cross
    if (Math.abs(reach) > Math.max(depth, depth * ratio) * 4) continue
    out.push({ side, reach, ux, uz })
  }
  return out
}
