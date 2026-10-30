/**
 * A railing wall's guard (`wallType: 'railing'`) as pure data: where it runs, where its posts
 * stand, and its members as oriented boxes. It is laid out on the stair guards' chassis
 * (`stair/guard-path.ts`): the same path sampling, equally spaced posts and rail joinery, with the
 * stair styles' members (`stair/*-guard.ts`) stood on a level floor and sized by the railing's
 * config. The 3D builder (`railing-wall-geometry.ts`) turns the boxes into the wall's mesh and the
 * plan (`railing-wall-floorplan.ts`) draws the posts, so both show the same guard.
 *
 * The guard runs along the wall's body centreline from the floor up to the wall's height. A door
 * on the railing is a gap in it: the guard stops either side with a post whose face is on the
 * gap's edge, so the gap is the door's width clear. An end that dies into a solid wall has no post:
 * the rails run on into the wall. Every other end, and every
 * corner where two railings meet, has its post centred on the wall's end. Between the ends the
 * posts are equally spaced at most `postSpacing` apart, and the balusters of each bay equally
 * spaced at most `infillGap` clear.
 */

import {
  type AnyNode,
  getRailingWallConfig,
  getRailingWallHeight,
  getWallBodyCenterOffset,
  getWallBodyLine,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallThickness,
  isCurvedWall,
  isRailingWall,
  type RailingWallConfig,
  sampleWallCenterline,
  type WallNode,
} from '@pascal-app/core'
import {
  add,
  barBox,
  type GuardBox,
  type GuardRail,
  postBox,
  railBars,
  resolveGuardPath,
  scale,
  sub,
  UP,
  type Vec3,
} from '../stair/guard-path'

const IN = 0.0254

// The stair guards' members (`stair/*-guard.ts`), metres.
const DECK_CAP_W = 5.5 * IN // a 2x6 cap laid flat
const DECK_CAP_T = 1.5 * IN
const DECK_RAIL_T = 1.5 * IN // a 2x4 rail on edge: thin across the run…
const DECK_RAIL_D = 3.5 * IN // …and deep
const BOARD_T = 0.75 * IN // a 1x6 board on the flat
const HANDRAIL_W = 0.062 // the baluster style's graspable top rail…
const HANDRAIL_T = 0.05
const SHOE_RAIL = 0.045 // …and its shoe rail
const NEWEL_ABOVE = 0.04 // a newel stands this far over the handrail…
const NEWEL_CAP_T = 0.028 // …under a cap of its own
const NEWEL_CAP_OVERHANG = 0.03
const SLIM_CAP_W = 0.0635 // a cable or glass guard's flat cap rail
const SLIM_CAP_T = 0.0381
const CABLE_CLEAR = 0.025 // the top cable stays this far under the cap
const SLEEVE_D = 0.019 // a swage sleeve where a cable dies into its terminal post
const SLEEVE_LEN = 0.05
const PANE_REVEAL = 0.015 // a glass pane stands this far off each post…
const PANE_HEAD = 0.01 // …and this far under the cap
const CLAMP_W = 0.05 // a point clamp holding a pane edge to its post
const CLAMP_T = 0.03
const CLAMP_LEN = 0.05
const CLAMP_LEVELS = [0.22, 0.78]
const METAL_TOP_W = 0.05 // a fabricated guard's flat top rail…
const METAL_TOP_T = 0.03
const METAL_BOTTOM_W = 0.038 // …and its bottom rail
const METAL_BOTTOM_T = 0.025
const BASEPLATE_W = 0.1 // the plate a steel post is welded to, on the floor
const BASEPLATE_T = 0.008

/** Ends this close to a solid wall's body (beyond its half thickness) die into it, metres. */
const WALL_END_TOLERANCE = 0.02
/** Infill closer than this on centre would merge into a solid sheet. */
const MIN_INFILL = 0.005

/**
 * A stretch of a railing's guard, `from` to `to` metres along the wall: whether a post stands at
 * each end, and whether that end faces a gap (a door), where the cap stops flush with the post.
 */
export type RailingRun = {
  from: number
  to: number
  startPost: boolean
  endPost: boolean
  startGap: boolean
  endGap: boolean
}

/** How a run ends (`RailingRun` without its stretch). */
export type RailingRunEnds = Omit<RailingRun, 'from' | 'to'>

/** A railing's guard: its frame (posts, rails, caps), its infill, and where its posts stand. */
export type RailingGuard = { frame: GuardBox[]; infill: GuardBox[]; posts: Vec3[] }

/** The frame the guard's points are given in: the wall's mesh frame, or the level's plan. */
export type RailingFrame = 'local' | 'plan'

/**
 * The doors (and any window) a railing hosts as gaps along it, `[from, to]` metres from its
 * start, clipped to the wall, merged where they touch, in order.
 */
export function railingWallGaps(
  wall: WallNode,
  children: readonly AnyNode[],
): Array<[number, number]> {
  const length = getWallCurveLength(wall)
  const spans = children
    .flatMap((child): Array<[number, number]> => {
      if (child.type !== 'door' && child.type !== 'window') return []
      const center = child.position?.[0]
      if (typeof center !== 'number' || !(child.width > 0)) return []
      const from = Math.max(0, center - child.width / 2)
      const to = Math.min(length, center + child.width / 2)
      return to > from ? [[from, to]] : []
    })
    .sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const span of spans) {
    const last = merged.at(-1)
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
    else merged.push([...span])
  }
  return merged
}

/** Distance from `point` to the segment `a`–`b`, in plan. */
function distanceToSegment(
  point: readonly [number, number],
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t =
    lengthSq < 1e-12
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - a.x) * dx + (point[1] - a.y) * dy) / lengthSq))
  return Math.hypot(point[0] - (a.x + dx * t), point[1] - (a.y + dy * t))
}

/** Whether `point` lies in a wall's body (a straight wall's exactly, a curved one's near enough). */
function inWallBody(point: readonly [number, number], wall: WallNode): boolean {
  const half = getWallThickness(wall) / 2 + WALL_END_TOLERANCE
  if (!isCurvedWall(wall)) {
    const line = getWallBodyLine(wall)
    return distanceToSegment(point, line.start, line.end) <= half
  }
  const reach = half + Math.abs(getWallBodyCenterOffset(wall))
  const points = sampleWallCenterline(wall)
  return points
    .slice(1)
    .some((end, index) => distanceToSegment(point, points[index]!, end) <= reach)
}

/**
 * Which ends of a railing die into a solid wall among `walls` (its level's): a railing run up to
 * the house stops in its wall with no post, its rails carried into it.
 */
export function railingWallEndsAtWalls(
  wall: WallNode,
  walls: readonly WallNode[],
): { start: boolean; end: boolean } {
  const solid = walls.filter(
    (other) => other.id !== wall.id && other.visible !== false && !isRailingWall(other),
  )
  return {
    start: solid.some((other) => inWallBody(wall.start, other)),
    end: solid.some((other) => inWallBody(wall.end, other)),
  }
}

/**
 * The runs of a railing's guard over its `length`: the wall less its `gaps`, a post either side
 * of each gap with its face on the gap's edge, and none at an end that dies into a wall
 * (`atWall`). A stretch shorter than a post holds no guard.
 */
export function railingWallRuns(
  length: number,
  gaps: ReadonlyArray<readonly [number, number]>,
  postSize: number,
  atWall: { start: boolean; end: boolean },
): RailingRun[] {
  const runs: RailingRun[] = []
  let from = 0
  const push = (to: number) => {
    const startGap = from > 0
    const endGap = to < length
    const a = from + (startGap ? postSize / 2 : 0)
    const b = to - (endGap ? postSize / 2 : 0)
    if (b - a >= postSize - 1e-9)
      runs.push({
        from: a,
        to: b,
        startPost: startGap || !atWall.start,
        endPost: endGap || !atWall.end,
        startGap,
        endGap,
      })
  }
  for (const [gapFrom, gapTo] of gaps) {
    if (gapFrom > from) push(gapFrom)
    from = gapTo
  }
  if (from < length) push(length)
  return runs
}

/**
 * Points along a railing's body centreline from `from` to `to` metres along it, on its floor: in
 * the wall's mesh frame (x along its chord from its start, z toward face `a`) or in plan (level x
 * and z). A curve is sampled finely enough for its rails to read as one.
 */
export function railingRunPoints(
  wall: WallNode,
  from: number,
  to: number,
  frame: RailingFrame,
): Vec3[] {
  const length = getWallCurveLength(wall)
  if (length < 1e-9) return []
  const offset = getWallBodyCenterOffset(wall)
  const [sx, sz] = wall.start
  const angle = Math.atan2(wall.end[1] - sz, wall.end[0] - sx)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const segments = isCurvedWall(wall) ? Math.max(2, Math.min(64, Math.ceil((to - from) / 0.2))) : 1
  const points: Vec3[] = []
  for (let i = 0; i <= segments; i++) {
    const along = from + ((to - from) * i) / segments
    const { point, normal } = getWallCurveFrameAt(wall, along / length)
    const x = point.x + normal.x * offset
    const z = point.y + normal.y * offset
    if (frame === 'plan') points.push([x, 0, z])
    else {
      const dx = x - sx
      const dz = z - sz
      points.push([dx * cos + dz * sin, 0, -dx * sin + dz * cos])
    }
  }
  return points
}

/** What a style is built of at `height`: its rails, infill, posts and end caps. */
type RailingMembers = {
  /** Frame rails following the run, bottom to top. */
  rails: GuardRail[]
  /** Board courses following the run (infill). */
  boards: GuardRail[]
  /** The posts' top over the floor. */
  postTop: number
  /** Balusters (pickets, bars) standing between these heights. */
  pickets: [number, number] | null
  /** Cables pulled post to post between these heights. */
  cables: [number, number] | null
  /** A glass pane in each bay between these heights. */
  glass: [number, number] | null
  /** The cap closing the run over its end posts: its square width, thickness and centre height. */
  endCap: { width: number; thickness: number; y: number } | null
  /** A cap on every post (the baluster style's newels). */
  newelCap: boolean
  /** A baseplate under every post (the metal style). */
  baseplate: boolean
}

function railingMembers(config: RailingWallConfig, height: number): RailingMembers {
  const clear = config.bottomClearance
  const none = {
    boards: [],
    pickets: null,
    cables: null,
    glass: null,
    endCap: null,
    newelCap: false,
    baseplate: false,
  }
  const flatCap = (width: number, thickness: number) => ({
    rail: { y: height - thickness / 2, across: width, vertical: thickness },
    endCap: { width, thickness, y: height - thickness / 2 },
  })
  switch (config.style) {
    case 'balusters':
      return {
        ...none,
        rails: [
          { y: clear + SHOE_RAIL / 2, across: SHOE_RAIL, vertical: SHOE_RAIL },
          { y: height - HANDRAIL_T / 2, across: HANDRAIL_W, vertical: HANDRAIL_T },
        ],
        postTop: height + NEWEL_ABOVE,
        pickets: [clear + SHOE_RAIL, height - HANDRAIL_T],
        newelCap: true,
      }
    case 'cable': {
      const cap = flatCap(SLIM_CAP_W, SLIM_CAP_T)
      return {
        ...none,
        rails: [cap.rail],
        postTop: height - SLIM_CAP_T,
        cables: [clear, height - SLIM_CAP_T - CABLE_CLEAR],
        endCap: cap.endCap,
      }
    }
    case 'boards': {
      const cap = config.cap ? flatCap(DECK_CAP_W, DECK_CAP_T) : null
      const top = cap ? height - DECK_CAP_T : height
      const size = Math.max(config.infillSize, MIN_INFILL)
      const boards: GuardRail[] = []
      for (let bottom = clear; bottom + size <= top + 1e-6; bottom += size + config.infillGap)
        boards.push({ y: bottom + size / 2, across: BOARD_T, vertical: size })
      return {
        ...none,
        rails: cap ? [cap.rail] : [],
        boards,
        postTop: top,
        endCap: cap?.endCap ?? null,
      }
    }
    case 'glass': {
      const cap = flatCap(SLIM_CAP_W, SLIM_CAP_T)
      return {
        ...none,
        rails: [cap.rail],
        postTop: height - SLIM_CAP_T,
        glass: [clear, height - SLIM_CAP_T - PANE_HEAD],
        endCap: cap.endCap,
      }
    }
    case 'metal': {
      const top = flatCap(METAL_TOP_W, METAL_TOP_T)
      return {
        ...none,
        rails: [
          { y: clear + METAL_BOTTOM_T / 2, across: METAL_BOTTOM_W, vertical: METAL_BOTTOM_T },
          top.rail,
        ],
        postTop: height - METAL_TOP_T,
        pickets: [clear + METAL_BOTTOM_T, height - METAL_TOP_T],
        endCap: top.endCap,
        baseplate: true,
      }
    }
    default: {
      // The DCA 6 deck guard: a 2x4 bottom rail, a 2x4 top rail on edge under a 2x6 cap.
      const cap = config.cap ? flatCap(DECK_CAP_W, DECK_CAP_T) : null
      const top = cap ? height - DECK_CAP_T : height
      return {
        ...none,
        rails: [
          { y: clear + DECK_RAIL_D / 2, across: DECK_RAIL_T, vertical: DECK_RAIL_D },
          { y: top - DECK_RAIL_D / 2, across: DECK_RAIL_T, vertical: DECK_RAIL_D },
          ...(cap ? [cap.rail] : []),
        ],
        postTop: top,
        pickets: [clear + DECK_RAIL_D, top - DECK_RAIL_D],
        endCap: cap?.endCap ?? null,
      }
    }
  }
}

/** A box standing square on the floor's plane, `size` wide and `thickness` tall, centred at `y`. */
function flatBox(at: Vec3, size: number, thickness: number, y: number): GuardBox {
  return { center: [at[0], at[1] + y, at[2]], size: [size, size, thickness], direction: UP }
}

const FREE_ENDS: RailingRunEnds = {
  startPost: true,
  endPost: true,
  startGap: false,
  endGap: false,
}

/**
 * One run of a railing's guard along `points` (on the floor, bottom first), `height` tall, built
 * as `config` says, with or without a post at either end (`ends`).
 */
export function buildRailingRunGuard(
  points: Vec3[],
  config: RailingWallConfig,
  height: number,
  ends: RailingRunEnds = FREE_ENDS,
): RailingGuard {
  const guard: RailingGuard = { frame: [], infill: [], posts: [] }
  const postSize = Math.max(config.postSize, MIN_INFILL)
  const path = resolveGuardPath(points, {
    postSpacing: Math.max(config.postSpacing, postSize * 2),
  })
  if (path?.kind !== 'path' || height <= 0) return guard
  const members = railingMembers(config, height)
  const { postStations, postPositions, pointAt } = path
  const last = postStations.length - 1
  const hasPost = (index: number) =>
    (index > 0 || ends.startPost) && (index < last || ends.endPost) && index >= 0 && index <= last

  guard.frame.push(...railBars(path.railPoints, path.isCorner, members.rails))
  guard.infill.push(...railBars(path.railPoints, path.isCorner, members.boards))

  postPositions.forEach((at, index) => {
    if (!hasPost(index)) return
    guard.posts.push(at)
    guard.frame.push(postBox(at, members.postTop, postSize))
    if (members.baseplate) guard.frame.push(flatBox(at, BASEPLATE_W, BASEPLATE_T, BASEPLATE_T / 2))
    if (members.newelCap)
      guard.frame.push(
        flatBox(at, postSize + NEWEL_CAP_OVERHANG, NEWEL_CAP_T, members.postTop + NEWEL_CAP_T / 2),
      )
    const cap = members.endCap
    if (!cap || (index !== 0 && index !== last)) return
    // Beside a gap the cap stops flush with the post, keeping the gap clear its full height…
    const gap = index === 0 ? ends.startGap : ends.endGap
    if (gap) {
      const rail = path.railPoints
      const away = index === 0 ? sub(rail[0]!, rail[1]!) : sub(rail.at(-1)!, rail.at(-2)!)
      const reach = Math.hypot(away[0], away[2])
      const face = add(at, scale(away, reach > 1e-9 ? postSize / 2 / reach : 0))
      const flush = barBox(
        add(face, [0, cap.y, 0]),
        add(at, [0, cap.y, 0]),
        cap.width,
        cap.thickness,
      )
      if (flush) guard.frame.push(flush)
      return
    }
    // …anywhere else it runs on over the end post, closing a corner where two railings meet.
    guard.frame.push(flatBox(at, cap.width, cap.thickness, cap.y))
  })

  // Each bay between two posts, its clear stretch past the posts standing in it.
  const bays = postStations.slice(1).map((to, i) => {
    const from = postStations[i]!
    return {
      from: from + (hasPost(i) ? postSize / 2 : 0),
      to: to - (hasPost(i + 1) ? postSize / 2 : 0),
    }
  })

  if (members.pickets && members.pickets[1] - members.pickets[0] > 1e-3) {
    const [bottom, top] = members.pickets
    const size = Math.max(config.infillSize, MIN_INFILL)
    const gap = Math.max(config.infillGap, 0)
    for (const bay of bays) {
      const clear = bay.to - bay.from
      // As few balusters as keep every gap within `gap`, equally spaced.
      const count = Math.max(0, Math.ceil((clear - gap) / (size + gap) - 1e-9))
      if (count === 0) continue
      const spacing = (clear - count * size) / (count + 1)
      for (let k = 0; k < count; k++) {
        const foot = pointAt(bay.from + spacing + size / 2 + k * (size + spacing))
        const baluster = barBox(add(foot, [0, bottom, 0]), add(foot, [0, top, 0]), size, size)
        if (baluster) guard.infill.push(baluster)
      }
    }
  }

  if (members.cables) {
    const [bottom, top] = members.cables
    const size = Math.max(config.infillSize, MIN_INFILL)
    const pitch = size + Math.max(config.infillGap, 0)
    for (let y = bottom + size / 2; y + size / 2 <= top + 1e-9; y += pitch) {
      for (let i = 1; i <= last; i++) {
        const cable = barBox(
          add(postPositions[i - 1]!, [0, y, 0]),
          add(postPositions[i]!, [0, y, 0]),
          size,
          size,
        )
        if (cable) guard.infill.push({ ...cable, round: true })
      }
      if (last < 1) continue
      if (hasPost(0)) guard.frame.push(sleeve(postPositions[0]!, postPositions[1]!, y))
      if (hasPost(last)) guard.frame.push(sleeve(postPositions[last]!, postPositions[last - 1]!, y))
    }
  }

  if (members.glass && members.glass[1] - members.glass[0] > 1e-3) {
    const [bottom, top] = members.glass
    const middle = (bottom + top) / 2
    bays.forEach((bay, i) => {
      const from = bay.from + PANE_REVEAL
      const to = bay.to - PANE_REVEAL
      if (to - from < 0.05) return
      const a = add(pointAt(from), [0, middle, 0])
      const b = add(pointAt(to), [0, middle, 0])
      const pane = barBox(a, b, Math.max(config.infillSize, MIN_INFILL), top - bottom)
      if (pane) guard.infill.push(pane)
      // Point clamps tie each pane edge to the post beside it.
      for (const [edge, post] of [
        [pointAt(from), i],
        [pointAt(to), i + 1],
      ] as const) {
        if (!hasPost(post)) continue
        for (const level of CLAMP_LEVELS) {
          const y = bottom + level * (top - bottom)
          const bridge = barBox(
            add(postPositions[post]!, [0, y, 0]),
            add(edge, [0, y, 0]),
            CLAMP_W,
            CLAMP_T,
          )
          if (bridge)
            guard.frame.push({ ...bridge, size: [CLAMP_W, CLAMP_T, bridge.size[2] + CLAMP_LEN] })
        }
      }
    })
  }

  return guard
}

/** A short round sleeve at `post`, height `y`, pointing along the cable toward `toward`. */
function sleeve(post: Vec3, toward: Vec3, y: number): GuardBox {
  const along = sub(toward, post)
  const length = Math.hypot(along[0], along[1], along[2])
  const unit: Vec3 = length > 1e-6 ? scale(along, 1 / length) : [1, 0, 0]
  return {
    center: add(add(post, [0, y, 0]), scale(unit, SLEEVE_LEN / 2)),
    size: [SLEEVE_D, SLEEVE_D, SLEEVE_LEN],
    direction: unit,
    round: true,
  }
}

/**
 * A railing wall's runs: its length less the doors it hosts, with no post at an end that dies
 * into one of `walls` (its level's).
 */
export function railingWallLayout(
  wall: WallNode,
  children: readonly AnyNode[],
  walls: readonly WallNode[],
): RailingRun[] {
  const config = getRailingWallConfig(wall)
  return railingWallRuns(
    getWallCurveLength(wall),
    railingWallGaps(wall, children),
    Math.max(config.postSize, MIN_INFILL),
    railingWallEndsAtWalls(wall, walls),
  )
}

/** A railing wall's whole guard, in its mesh frame or in plan (`railingWallLayout`). */
export function buildRailingWallGuard(
  wall: WallNode,
  children: readonly AnyNode[],
  walls: readonly WallNode[],
  frame: RailingFrame = 'local',
): RailingGuard {
  const config = getRailingWallConfig(wall)
  const height = getRailingWallHeight(wall)
  const guard: RailingGuard = { frame: [], infill: [], posts: [] }
  for (const run of railingWallLayout(wall, children, walls)) {
    const part = buildRailingRunGuard(
      railingRunPoints(wall, run.from, run.to, frame),
      config,
      height,
      run,
    )
    guard.frame.push(...part.frame)
    guard.infill.push(...part.infill)
    guard.posts.push(...part.posts)
  }
  return guard
}
