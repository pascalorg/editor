import type { AnyNode, WallNode, ZoneNode } from '../schema'
import { DEFAULT_BEAM_SIZE_PRESET_ID } from '../schema/nodes/beam'
import { beamSizePreset } from './beam'
import { DEFAULT_FRAMING_POST_SIZE, FRAMING_POST_SIZES, type FramingPostSize } from './framing-post'

/**
 * Where a porch's posts and beam go (a porch room, `lib/outdoor-room`): a post on each outside
 * corner, where two open sides meet (a porch in a corner of the house gets its one corner post),
 * more along each open side at most `postSpacing` apart, evenly; none where a side meets the house,
 * whose wall carries the beam's end. The beam runs along each open side on the posts, dropped
 * under the porch ceiling. Pure geometry: the structure kernel turns it into post and beam nodes.
 *
 * A side is open when no wall stands on it (an invisible wall) or the wall on it is a railing.
 */

const IN = 0.0254
const FT = 0.3048

/** Post faces sit this far in from the slab edge. */
export const PORCH_POST_SETBACK = 1.5 * IN
/** Posts no more than 8 ft apart (the porch generator's and DCA 6's limit). */
export const PORCH_POST_SPACING = 8 * FT

export type PorchFramingSettings = {
  /** A framing post size (`FRAMING_POST_SIZES`). */
  postSize: FramingPostSize
  postSpacing: number
  /** A stock beam size id (`BEAM_SIZE_PRESETS`). */
  beamSize: string
}

export const DEFAULT_PORCH_FRAMING: PorchFramingSettings = {
  postSize: DEFAULT_FRAMING_POST_SIZE,
  postSpacing: PORCH_POST_SPACING,
  beamSize: DEFAULT_BEAM_SIZE_PRESET_ID,
}

const isPostSize = (size: string | undefined): size is FramingPostSize =>
  !!size && Object.hasOwn(FRAMING_POST_SIZES, size)

/** A porch's framing settings: its own, else the defaults (an unknown size is the default). */
export function porchFramingSettings(zone: Pick<ZoneNode, 'porchFraming'>): PorchFramingSettings {
  const own = zone.porchFraming
  return {
    postSize: isPostSize(own?.postSize) ? own.postSize : DEFAULT_PORCH_FRAMING.postSize,
    postSpacing: own?.postSpacing ?? DEFAULT_PORCH_FRAMING.postSpacing,
    beamSize:
      own?.beamSize && beamSizePreset(own.beamSize)
        ? beamSizePreset(own.beamSize)!.id
        : DEFAULT_PORCH_FRAMING.beamSize,
  }
}

type P = [number, number]

export type PorchPostPlan = {
  /** Stable within the porch: which corner or side, and which bay. */
  key: string
  position: P
  /** Actual post width (square). */
  size: number
  /** The beams (their keys) it stands under: two at a corner, one along a side. */
  beams: string[]
}

export type PorchBeamPlan = {
  key: string
  start: P
  end: P
  width: number
  depth: number
}

export type PorchFramingPlan = { posts: PorchPostPlan[]; beams: PorchBeamPlan[] }

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]]
const scale = (a: P, s: number): P => [a[0] * s, a[1] * s]
const len = (a: P) => Math.hypot(a[0], a[1])
const unit = (a: P): P => {
  const l = len(a)
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0]
}

/** The wall standing along `a` → `b` (its reference line on the segment), if any. */
function wallAlong(a: P, b: P, walls: readonly WallNode[]): WallNode | undefined {
  const dir = unit(sub(b, a))
  const mid = scale(add(a, b), 0.5)
  return walls.find((wall) => {
    if ((wall.curveOffset ?? 0) !== 0) return false
    const w = sub(wall.end as P, wall.start as P)
    const length = len(w)
    if (length < 1e-6) return false
    const u = scale(w, 1 / length)
    if (Math.abs(u[0] * dir[1] - u[1] * dir[0]) > 1e-3) return false
    const rel = sub(mid, wall.start as P)
    const across = Math.abs(rel[0] * u[1] - rel[1] * u[0])
    const along = rel[0] * u[0] + rel[1] * u[1]
    return across < 1e-3 && along > -1e-3 && along < length + 1e-3
  })
}

/** Whether a wall is a railing, which a porch's posts and beam still stand along. */
function isRailing(wall: WallNode): boolean {
  return (wall as WallNode & { wallType?: string }).wallType === 'railing'
}

/**
 * The posts and beams for porch `zone` among `nodes` (its level's walls decide which sides are
 * open). Empty when no side is open.
 */
export function planPorchFraming(
  zone: Pick<ZoneNode, 'polygon' | 'parentId' | 'porchFraming'>,
  nodes: Readonly<Record<string, AnyNode>>,
): PorchFramingPlan {
  const settings = porchFramingSettings(zone)
  const postSize = FRAMING_POST_SIZES[settings.postSize]
  const beam = beamSizePreset(settings.beamSize)!
  const spacing = Math.max(0.6, settings.postSpacing)
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === zone.parentId,
  )
  const polygon = zone.polygon as P[]
  const n = polygon.length
  if (n < 3) return { posts: [], beams: [] }
  // Inward normals: the polygon's winding decides which side of each edge is inside.
  let area = 0
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % n]!
    area += a[0] * b[1] - b[0] * a[1]
  }
  const turn = area > 0 ? 1 : -1
  const edges = polygon.map((a, i) => {
    const b = polygon[(i + 1) % n]!
    const wall = wallAlong(a, b, walls)
    const dir = unit(sub(b, a))
    const inward: P = [-dir[1] * turn, dir[0] * turn]
    return { a, b, dir, inward, open: !wall || isRailing(wall), wall }
  })
  const inset = postSize / 2 + PORCH_POST_SETBACK
  const posts: PorchPostPlan[] = []
  const beams: PorchBeamPlan[] = []
  // The post line of an edge: the edge moved in by the inset.
  const onLine = (edge: (typeof edges)[number], p: P): P => add(p, scale(edge.inward, inset))
  // The outside corner where open edge i-1 meets open edge i: the two post lines' crossing.
  const corner = (i: number): P => {
    const prev = edges[(i - 1 + n) % n]!
    const next = edges[i]!
    const p = onLine(prev, prev.b)
    const q = onLine(next, next.a)
    const denom = prev.dir[0] * next.dir[1] - prev.dir[1] * next.dir[0]
    if (Math.abs(denom) < 1e-9) return q
    const t = ((q[0] - p[0]) * next.dir[1] - (q[1] - p[1]) * next.dir[0]) / denom
    return add(p, scale(prev.dir, t))
  }
  edges.forEach((edge, i) => {
    if (!edge.open) return
    const prev = edges[(i - 1 + n) % n]!
    const next = edges[(i + 1) % n]!
    const startCorner = prev.open
    const endCorner = next.open
    // A side meeting the house starts at the wall's face, where the beam bears.
    const startFace = startCorner ? 0 : (prev.wall?.thickness ?? 0.15) / 2
    const endFace = endCorner ? 0 : (next.wall?.thickness ?? 0.15) / 2
    const start = startCorner ? corner(i) : add(onLine(edge, edge.a), scale(edge.dir, startFace))
    const end = endCorner
      ? corner((i + 1) % n)
      : sub(onLine(edge, edge.b), scale(edge.dir, endFace))
    if (startCorner)
      posts.push({
        key: `corner:${i}`,
        position: start,
        size: postSize,
        beams: [`beam:${(i - 1 + n) % n}`, `beam:${i}`],
      })
    const run = sub(end, start)
    const length = len(run)
    if (length < postSize) return
    const bays = Math.max(1, Math.ceil(length / spacing - 1e-9))
    for (let k = 1; k < bays; k++)
      posts.push({
        key: `side:${i}:${k}`,
        position: add(start, scale(run, k / bays)),
        size: postSize,
        beams: [`beam:${i}`],
      })
    // The beam reaches the corner posts' outside faces, so two sides' beams meet over a corner.
    const reachStart = startCorner ? postSize / 2 : 0
    const reachEnd = endCorner ? postSize / 2 : 0
    beams.push({
      key: `beam:${i}`,
      start: sub(start, scale(edge.dir, reachStart)),
      end: add(end, scale(edge.dir, reachEnd)),
      width: beam.width,
      depth: beam.depth,
    })
  })
  return { posts, beams }
}
