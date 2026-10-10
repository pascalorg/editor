import type { AnyNode, WallNode } from '../schema'
import type { FacadeSurface } from '../systems/facade/facade-config'
import { DEFAULT_WALL_THICKNESS } from '../systems/wall/wall-footprint'
import { wallEffectiveHeightIn } from './wall-support-in'

export type FacadeFace = 'front' | 'back'
export type FacadeWallTarget = { surface: FacadeSurface; face?: FacadeFace }
export type FacadeTargetWall = { wall: WallNode; face: FacadeFace }

type Point = [number, number]

/** How far off a chain's centreline a wall may sit and still meet or continue it. */
const ON_LINE = 0.02
/** Shorter stretches between junctions cannot hold anything and are not runs. */
const MIN_RUN = 0.3
/** Below this angle a meeting wall continues the chain rather than making a junction. */
const MIN_SIN = 0.2

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0]
const unit = (a: Point): Point => {
  const length = Math.hypot(a[0], a[1])
  return [a[0] / length, a[1] / length]
}
const thicknessOf = (wall: WallNode) => wall.thickness ?? DEFAULT_WALL_THICKNESS

/**
 * What ends a run: an outside corner (the facade turns away), an inside corner
 * or a wall standing on the face, a wall meeting it from inside, or nothing.
 */
export type FacadeRunEnd = 'outside' | 'inside' | 'cut' | 'free'

export type FacadeRunWall = {
  wall: WallNode
  /** The wall's extent along the run axis. */
  from: number
  to: number
  /** The wall was drawn against the axis, so its local x runs the other way. */
  reversed: boolean
}

/**
 * One stretch of facade between two junctions, measured on the filled face:
 * `start`/`end` are positions along `direction` from `origin` (a centreline
 * point), and `normal` points out of the face.
 */
export type FacadeRun = {
  key: string
  origin: Point
  direction: Point
  normal: Point
  start: number
  end: number
  height: number
  walls: FacadeRunWall[]
  ends: [FacadeRunEnd, FacadeRunEnd]
  /**
   * In whole-side rhythm, the walls meeting the facade from inside that no
   * longer end the run: their spans along the axis, which nothing may land on.
   */
  partitions?: [number, number][]
}

/** The face a fill uses: the one whose side matches the surface, else the surface's convention. */
export function facadeFace(wall: WallNode, target: FacadeWallTarget): FacadeFace {
  if (target.face) return target.face
  const surface = target.surface === 'both' ? 'exterior' : target.surface
  if (wall.frontSide === surface) return 'front'
  if (wall.backSide === surface) return 'back'
  return surface === 'interior' ? 'front' : 'back'
}

/** A wall's front is its local +Z: the left normal of its start-to-end direction. */
export function facadeFaceNormal(wall: WallNode, face: FacadeFace): Point {
  const [dx, dz] = unit(sub(wall.end, wall.start))
  return face === 'front' ? [-dz, dx] : [dz, -dx]
}

const touches = (a: WallNode, b: WallNode) =>
  [a.start, a.end].some((p) =>
    [b.start, b.end].some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= ON_LINE),
  )

function continues(a: FacadeTargetWall, b: FacadeTargetWall) {
  if (a.wall.parentId !== b.wall.parentId || !touches(a.wall, b.wall)) return false
  const dirA = unit(sub(a.wall.end, a.wall.start))
  const dirB = unit(sub(b.wall.end, b.wall.start))
  if (Math.abs(cross(dirA, dirB)) > 1e-3) return false
  if (Math.abs(cross(dirA, sub(b.wall.start, a.wall.start))) > ON_LINE) return false
  return dot(facadeFaceNormal(a.wall, a.face), facadeFaceNormal(b.wall, b.face)) > 0.99
}

/** Collinear walls that touch and fill the same side form one continuous facade. */
export function facadeChains(targets: readonly FacadeTargetWall[]): FacadeTargetWall[][] {
  const parent = targets.map((_, i) => i)
  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root]!
    return root
  }
  for (let i = 0; i < targets.length; i++)
    for (let j = i + 1; j < targets.length; j++)
      if (continues(targets[i]!, targets[j]!)) parent[find(j)] = find(i)
  const groups = new Map<number, FacadeTargetWall[]>()
  targets.forEach((target, i) => {
    groups.set(find(i), [...(groups.get(find(i)) ?? []), target])
  })
  // Sorting by id keeps a chain's axis, and so its run keys, stable across refills.
  return [...groups.values()].map((chain) =>
    chain.sort((a, b) => a.wall.id.localeCompare(b.wall.id)),
  )
}

type Junction = {
  /** Where the meeting wall's centreline crosses the chain axis. */
  at: number
  /** Half the meeting wall's footprint along the axis. */
  half: number
  /** The meeting wall stands on the filled face's side, or passes through the chain end. */
  closesFace: boolean
}

function junctionsOf(
  chainWalls: readonly WallNode[],
  others: readonly WallNode[],
  axis: {
    origin: Point
    direction: Point
    normal: Point
    lo: number
    hi: number
  },
): Junction[] {
  const { origin, direction, normal, lo, hi } = axis
  const halfThickness = Math.max(...chainWalls.map(thicknessOf)) / 2
  const crossingAt = (point: Point, along: Point) => {
    const offset = dot(sub(point, origin), normal)
    const t = -offset / dot(along, normal)
    return dot(sub([point[0] + along[0] * t, point[1] + along[1] * t], origin), direction)
  }
  const junctions: Junction[] = []
  for (const other of others) {
    const along = unit(sub(other.end, other.start))
    const sin = Math.abs(cross(along, direction))
    if (sin < MIN_SIN) continue
    const half = thicknessOf(other) / 2 / sin
    // The other wall ends on the chain: a corner at a chain end, a T in between.
    for (const [point, far] of [
      [other.start, other.end],
      [other.end, other.start],
    ] as const) {
      const offset = dot(sub(point, origin), normal)
      const at = dot(sub(point, origin), direction)
      if (
        Math.abs(offset) > halfThickness + ON_LINE ||
        at < lo - half - ON_LINE ||
        at > hi + half + ON_LINE
      )
        continue
      junctions.push({
        at: crossingAt(point, along),
        half,
        closesFace: dot(sub(far, point), normal) > 0,
      })
    }
    // The chain ends against the other wall's body: that wall closes the face.
    for (const end of [lo, hi]) {
      const point: Point = [origin[0] + direction[0] * end, origin[1] + direction[1] * end]
      const length = Math.hypot(other.end[0] - other.start[0], other.end[1] - other.start[1])
      const along_ = dot(sub(point, other.start), along)
      const away = Math.abs(cross(along, sub(point, other.start)))
      if (
        along_ <= ON_LINE ||
        along_ >= length - ON_LINE ||
        away > thicknessOf(other) / 2 + ON_LINE
      )
        continue
      junctions.push({ at: crossingAt(other.start, along), half, closesFace: true })
    }
  }
  return junctions
}

/**
 * Split target walls into facade runs. Junctions are the chain ends and every
 * wall meeting the chain, so openings never land where a partition meets the
 * facade. Run ends sit on the filled face: an outside corner extends the run
 * by the neighbour's half thickness, an inside corner or a T shortens it.
 */
export function facadeRuns(
  nodes: Record<string, AnyNode>,
  targets: readonly FacadeTargetWall[],
  /** One rhythm from corner to corner: walls meeting the facade from inside do not cut it. */
  { continuous = false }: { continuous?: boolean } = {},
): FacadeRun[] {
  const runs: FacadeRun[] = []
  for (const chain of facadeChains(targets)) {
    const first = chain[0]!
    const origin = first.wall.start
    const normal = facadeFaceNormal(first.wall, first.face)
    // Runs read left to right for someone facing the filled face, as the unit is
    // designed in the studio: a wall's start → end does that for its front face,
    // and runs the other way for its back.
    const along = unit(sub(first.wall.end, first.wall.start))
    const direction: Point = first.face === 'front' ? along : [-along[0], -along[1]]
    const walls: FacadeRunWall[] = chain.map(({ wall }) => {
      const a = dot(sub(wall.start, origin), direction)
      const b = dot(sub(wall.end, origin), direction)
      return { wall, from: Math.min(a, b), to: Math.max(a, b), reversed: a > b }
    })
    const lo = Math.min(...walls.map((w) => w.from))
    const hi = Math.max(...walls.map((w) => w.to))
    const members = new Set<string>(chain.map(({ wall }) => wall.id))
    const others = Object.values(nodes).filter(
      (node): node is WallNode =>
        node.type === 'wall' && node.parentId === first.wall.parentId && !members.has(node.id),
    )
    const junctions = junctionsOf(
      chain.map(({ wall }) => wall),
      others,
      { origin, direction, normal, lo, hi },
    )

    const atStart = junctions.filter((j) => Math.abs(j.at - lo) <= j.half + ON_LINE)
    const atEnd = junctions.filter((j) => Math.abs(j.at - hi) <= j.half + ON_LINE)
    const faceStart = !atStart.length
      ? lo
      : atStart.some((j) => j.closesFace)
        ? Math.max(...atStart.filter((j) => j.closesFace).map((j) => j.at + j.half))
        : Math.min(...atStart.map((j) => j.at - j.half))
    const faceEnd = !atEnd.length
      ? hi
      : atEnd.some((j) => j.closesFace)
        ? Math.min(...atEnd.filter((j) => j.closesFace).map((j) => j.at - j.half))
        : Math.max(...atEnd.map((j) => j.at + j.half))
    const inner = junctions.filter((j) => !atStart.includes(j) && !atEnd.includes(j))
    // A wall standing on the filled face (a recess return, a fin) cuts in any rhythm.
    const passed = continuous ? inner.filter((j) => !j.closesFace) : []
    const cuts = inner
      .filter((j) => !passed.includes(j))
      .map((j): [number, number] => [j.at - j.half, j.at + j.half])
      .sort((a, b) => a[0] - b[0])
    const partitions = passed
      .map((j): [number, number] => [j.at - j.half, j.at + j.half])
      .sort((a, b) => a[0] - b[0])

    const endOf = (at: readonly Junction[]): FacadeRunEnd =>
      !at.length ? 'free' : at.some((j) => j.closesFace) ? 'inside' : 'outside'
    let cursor = faceStart
    let cursorEnd = endOf(atStart)
    const spans: [number, number, FacadeRunEnd, FacadeRunEnd][] = []
    for (const [from, to] of cuts) {
      if (from > cursor) spans.push([cursor, Math.min(from, faceEnd), cursorEnd, 'cut'])
      cursor = Math.max(cursor, to)
      cursorEnd = 'cut'
    }
    if (faceEnd > cursor) spans.push([cursor, faceEnd, cursorEnd, endOf(atEnd)])

    spans
      .filter(([start, end]) => end - start >= MIN_RUN)
      .forEach(([start, end, startEnd, endEnd], index) => {
        const overlapping = walls.filter((w) => w.from < end - ON_LINE && w.to > start + ON_LINE)
        runs.push({
          key: `${first.wall.id}:${index}`,
          origin,
          direction,
          normal,
          start,
          end,
          height: Math.min(...overlapping.map((w) => wallEffectiveHeightIn(w.wall, nodes))),
          walls: overlapping,
          ends: [startEnd, endEnd],
          ...(continuous
            ? { partitions: partitions.filter(([from, to]) => to > start && from < end) }
            : {}),
        })
      })
  }
  return runs
}
