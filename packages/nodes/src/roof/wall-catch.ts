import {
  type AnyNode,
  type AnyNodeId,
  getLevelBelow,
  getWallBodyLine,
  getWallThickness,
  isCurvedWall,
  isRailingWall,
  type RoofNode,
  type RoofSegmentNode,
  type WallNode,
} from '@pascal-app/core'

type Pt = readonly [number, number]

/** How near a roof's wall line comes to a wall's centre line before it catches on it (metres). */
export const ROOF_WALL_CATCH_M = 0.25

/**
 * A side drawn or picked this near a room's edge stands on it (metres): as near as a drawn corner
 * sticks to a wall in grid (the wall snap's connect radius), so one drawn on a railing's centre
 * line, a grid point, still takes its outside face.
 */
export const ROOF_EDGE_ON_M = 0.05

/** A wall within this of parallel (the sine of 1°) runs along a roof edge. */
const PARALLEL = Math.sin(Math.PI / 180)

/**
 * A segment's footprint at its wall centre lines, in its level's plan: its centre, the plan angle
 * of its own x axis (the floor plan's `-(roof.rotation + segment.rotation)`), and its own walls'
 * thickness, their outer faces half of it outside the line (absent, none).
 */
export type RoofWallLine = {
  center: Pt
  angle: number
  hw: number
  hd: number
  wallThickness?: number
}

/**
 * A room's edge a roof lines up with but does not stand on: an invisible wall (its line, no
 * thickness), or a railing (a guard round a deck or a porch, its faces half its thickness either
 * side of its line). A wall takes a roof's wall line on its centre line, the roof's walls as thick
 * as it, so their outer faces meet its outside face; an edge takes the roof's outer face itself,
 * on the edge's face on the roof's outer side, so the roof reaches the room's edge as it reaches
 * the house's walls' outside faces.
 */
export type RoofEdgeLine = { type: 'roof-edge'; id: string; start: Pt; end: Pt; thickness: number }

/** A line a roof catches on: a wall's centre line, or a room's edge (`RoofEdgeLine`). */
export type RoofCatchLine = WallNode | RoofEdgeLine

/** Which axes of the dragged frame caught on a wall, and the plan shift that lays them there. */
export type RoofWallCatch = { shift: [number, number]; u: boolean; v: boolean }

const NO_CATCH: RoofWallCatch = { shift: [0, 0], u: false, v: false }

const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1]

/**
 * A catch line's ends: a wall's body centre line (a wall drawn by a face has it half its thickness
 * off the middle), an edge's own.
 */
function lineEnds(line: RoofCatchLine): [Pt, Pt] {
  if (line.type === 'roof-edge') return [line.start, line.end]
  const body = getWallBodyLine(line)
  return [
    [body.start.x, body.start.y],
    [body.end.x, body.end.y],
  ]
}

/** A railing as a room's edge: its body's centre line, its faces half its thickness off it. */
function railingEdge(wall: WallNode): RoofEdgeLine {
  const [start, end] = lineEnds(wall)
  return { type: 'roof-edge', id: wall.id, start, end, thickness: getWallThickness(wall) }
}

/**
 * The line nearest an edge through `mid`, and how far along `n` the edge moves onto it: lines
 * parallel to the edge, within `threshold` of it, and overlapping its `half` length either side of
 * `mid` along `t`. Null when none does. A wall takes the edge on its centre line; a room's edge
 * takes the outer face of the roof's walls, `thickness` thick, on its face on the outer side.
 */
function nearestLine(
  mid: Pt,
  n: Pt,
  t: Pt,
  half: number,
  lines: readonly RoofCatchLine[],
  threshold: number,
  thickness: number,
): { gap: number; line: RoofCatchLine } | null {
  let best: { gap: number; line: RoofCatchLine } | null = null
  for (const line of lines) {
    const [from, to] = lineEnds(line)
    const run: Pt = [to[0] - from[0], to[1] - from[1]]
    const length = Math.hypot(run[0], run[1])
    if (length < 1e-6 || Math.abs(dot(run, n)) / length > PARALLEL) continue
    const start: Pt = [from[0] - mid[0], from[1] - mid[1]]
    const end: Pt = [to[0] - mid[0], to[1] - mid[1]]
    const gap = dot(start, n) + (line.type === 'roof-edge' ? (line.thickness - thickness) / 2 : 0)
    if (Math.abs(gap) > threshold) continue
    const a = dot(start, t)
    const b = dot(end, t)
    if (Math.max(a, b) <= -half || Math.min(a, b) >= half) continue
    if (best === null || Math.abs(gap) < Math.abs(best.gap)) best = { gap, line }
  }
  return best
}

/** A wall line's four edges: outward normal, run, distance from the centre, half length. */
function lineEdges(line: RoofWallLine) {
  const ex: Pt = [Math.cos(line.angle), Math.sin(line.angle)]
  const ez: Pt = [-ex[1], ex[0]]
  return [
    { n: ex, t: ez, offset: line.hw, half: line.hd },
    { n: [-ex[0], -ex[1]] as Pt, t: ez, offset: line.hw, half: line.hd },
    { n: ez, t: ex, offset: line.hd, half: line.hw },
    { n: [-ez[0], -ez[1]] as Pt, t: ex, offset: line.hd, half: line.hw },
  ]
}

/** A segment's wall line with its roof at `roof`'s place, which a drag may be proposing. */
export function segmentWallLine(
  roof: Pick<RoofNode, 'position' | 'rotation'>,
  segment: Pick<RoofSegmentNode, 'position' | 'rotation' | 'width' | 'depth'> &
    Partial<Pick<RoofSegmentNode, 'wallThickness'>>,
): RoofWallLine {
  const cos = Math.cos(-roof.rotation)
  const sin = Math.sin(-roof.rotation)
  const [lx, , lz] = segment.position
  return {
    center: [roof.position[0] + lx * cos - lz * sin, roof.position[2] + lx * sin + lz * cos],
    angle: -(roof.rotation + segment.rotation),
    hw: segment.width / 2,
    hd: segment.depth / 2,
    wallThickness: segment.wallThickness,
  }
}

/**
 * What a roof on `levelId` catches on, on its own level and the storey below, which the roof plan
 * draws dashed: the walls it sits on, and the rooms' edges there, their invisible walls and
 * railings (`RoofEdgeLine`): a porch's, a deck's, a patio's. Curved walls have no straight line to
 * catch on.
 */
export function roofCatchWalls(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: string | null | undefined,
): RoofCatchLine[] {
  if (!levelId) return []
  const below = getLevelBelow(levelId, nodes as Record<AnyNodeId, AnyNode>)
  const lines: RoofCatchLine[] = []
  for (const id of [levelId, below?.id]) {
    const level = id ? nodes[id as AnyNodeId] : undefined
    if (level?.type !== 'level') continue
    for (const childId of level.children) {
      const node = nodes[childId as AnyNodeId]
      if (node?.type === 'separator')
        lines.push({
          type: 'roof-edge',
          id: node.id,
          start: node.start,
          end: node.end,
          thickness: 0,
        })
      else if (node?.type === 'wall' && !isCurvedWall(node))
        lines.push(isRailingWall(node) ? railingEdge(node) : node)
    }
  }
  return lines
}

/**
 * Where a dragged roof's wall lines catch on the walls under it. Along each axis of the frame at
 * `angle` (the dragged segment's or roof's x and z), the edge nearest the centre line of a wall
 * that runs alongside it, parallel and within `threshold`, sets the shift onto that wall; one
 * nearest a room's edge (`RoofEdgeLine`) stands the outer face of the walls the segment takes
 * there on it.
 */
export function catchRoofOnWalls(args: {
  lines: readonly RoofWallLine[]
  walls: readonly RoofCatchLine[]
  angle: number
  threshold?: number
}): RoofWallCatch {
  const threshold = args.threshold ?? ROOF_WALL_CATCH_M
  const u: Pt = [Math.cos(args.angle), Math.sin(args.angle)]
  const v: Pt = [-u[1], u[0]]
  let bestU: number | null = null
  let bestV: number | null = null

  for (const line of args.lines) {
    const thickness = landedWallThickness(line, args.walls, threshold)
    for (const { n, t, offset, half } of lineEdges(line)) {
      // An edge of a segment turned off the dragged frame moves along neither axis alone.
      const alongU = dot(n, u)
      const alongV = dot(n, v)
      const axis = Math.abs(alongV) <= PARALLEL ? 'u' : Math.abs(alongU) <= PARALLEL ? 'v' : null
      if (!axis) continue
      const mid: Pt = [line.center[0] + n[0] * offset, line.center[1] + n[1] * offset]
      const gap = nearestLine(mid, n, t, half, args.walls, threshold, thickness)?.gap
      if (gap === undefined) continue
      const amount = gap * (axis === 'u' ? alongU : alongV)
      if (axis === 'u') {
        if (bestU === null || Math.abs(amount) < Math.abs(bestU)) bestU = amount
      } else if (bestV === null || Math.abs(amount) < Math.abs(bestV)) bestV = amount
    }
  }

  if (bestU === null && bestV === null) return NO_CATCH
  const du = bestU ?? 0
  const dv = bestV ?? 0
  return {
    shift: [u[0] * du + v[0] * dv, u[1] * du + v[1] * dv],
    u: bestU !== null,
    v: bestV !== null,
  }
}

/**
 * A dragged roof's place: along an axis its wall line caught on, the raw place shifted onto the
 * wall; along the other, the snapped place (the grid's, or the raw cursor's with no grid).
 */
export function placeRoofOnWalls(
  raw: Pt,
  snapped: Pt,
  caught: RoofWallCatch,
  angle: number,
): [number, number] {
  const out: [number, number] = [snapped[0], snapped[1]]
  const target: Pt = [raw[0] + caught.shift[0], raw[1] + caught.shift[1]]
  const u: Pt = [Math.cos(angle), Math.sin(angle)]
  const v: Pt = [-u[1], u[0]]
  for (const [axis, on] of [
    [u, caught.u],
    [v, caught.v],
  ] as const) {
    if (!on) continue
    const k = (target[0] - out[0]) * axis[0] + (target[1] - out[1]) * axis[1]
    out[0] += axis[0] * k
    out[1] += axis[1] * k
  }
  return out
}

/**
 * A side dragged out from `line` (the segment's wall line before the drag), its opposite side held:
 * the size along `axis` that lays the dragged side on the centre line of a wall alongside it, or
 * stands its outer face on a room's edge there (`RoofEdgeLine`); null when neither is within
 * `threshold` of `value`.
 */
export function catchRoofSideOnWalls(args: {
  line: RoofWallLine
  axis: 'x' | 'z'
  side: 1 | -1
  value: number
  walls: readonly RoofCatchLine[]
  threshold?: number
}): number | null {
  const { line, axis, side, value } = args
  const threshold = args.threshold ?? ROOF_WALL_CATCH_M
  const ex: Pt = [Math.cos(line.angle), Math.sin(line.angle)]
  const ez: Pt = [-ex[1], ex[0]]
  const along = axis === 'x' ? ex : ez
  const n: Pt = [along[0] * side, along[1] * side]
  const half = axis === 'x' ? line.hw : line.hd
  const reach = value - half
  const mid: Pt = [line.center[0] + n[0] * reach, line.center[1] + n[1] * reach]
  // Sized to `value`, the opposite side held: the thickness its walls take there.
  const shift = value / 2 - half
  const sized: RoofWallLine = {
    ...line,
    center: [line.center[0] + n[0] * shift, line.center[1] + n[1] * shift],
    hw: axis === 'x' ? value / 2 : line.hw,
    hd: axis === 'z' ? value / 2 : line.hd,
  }
  const caught = nearestLine(
    mid,
    n,
    axis === 'x' ? ez : ex,
    axis === 'x' ? line.hd : line.hw,
    args.walls,
    threshold,
    landedWallThickness(sized, args.walls, threshold),
  )
  return caught ? value + caught.gap : null
}

/**
 * The thickness a segment's walls take to stand flush on the walls under it: the thickest wall
 * whose centre line runs along an edge of its wall line, within `threshold`. A room's edge (an
 * invisible wall, a railing) carries no roof and gives none. Null when no wall does.
 */
export function bearingWallThickness(
  line: RoofWallLine,
  walls: readonly RoofCatchLine[],
  threshold = ROOF_WALL_CATCH_M,
): number | null {
  const bearing = walls.filter((wall): wall is WallNode => wall.type === 'wall')
  let thickest: number | null = null
  for (const { n, t, offset, half } of lineEdges(line)) {
    const mid: Pt = [line.center[0] + n[0] * offset, line.center[1] + n[1] * offset]
    const wall = nearestLine(mid, n, t, half, bearing, threshold, 0)?.line
    if (wall?.type === 'wall' && (thickest === null || getWallThickness(wall) > thickest))
      thickest = getWallThickness(wall)
  }
  return thickest
}

/** The thickness a wall line's walls take where it stands: the walls' under it, else its own. */
function landedWallThickness(
  line: RoofWallLine,
  walls: readonly RoofCatchLine[],
  threshold: number,
): number {
  return bearingWallThickness(line, walls, threshold) ?? line.wallThickness ?? 0
}

/**
 * A wall line drawn or picked out to a room's edges (`RoofEdgeLine`): each side lying on one,
 * within `tolerance`, moved in so the outer face of its walls, `thickness` thick, stands there, as
 * the house's roof stands its walls' outer faces on the walls' outside faces. A side on a wall's
 * centre line, or on nothing, stays.
 */
export function settleRoofOnEdges(
  line: RoofWallLine,
  walls: readonly RoofCatchLine[],
  thickness: number,
  tolerance = ROOF_EDGE_ON_M,
): RoofWallLine {
  const ex: Pt = [Math.cos(line.angle), Math.sin(line.angle)]
  const ez: Pt = [-ex[1], ex[0]]
  // How far each side (+x, -x, +z, -z) moves out along its own normal.
  const [px = 0, nx = 0, pz = 0, nz = 0] = lineEdges(line).map(({ n, t, offset, half }) => {
    const mid: Pt = [line.center[0] + n[0] * offset, line.center[1] + n[1] * offset]
    const on = nearestLine(mid, n, t, half, walls, tolerance, 0)
    return on?.line.type === 'roof-edge' ? on.gap - thickness / 2 : 0
  })
  const du = (px - nx) / 2
  const dv = (pz - nz) / 2
  return {
    ...line,
    center: [line.center[0] + ex[0] * du + ez[0] * dv, line.center[1] + ex[1] * du + ez[1] * dv],
    hw: Math.max(1e-3, line.hw + (px + nx) / 2),
    hd: Math.max(1e-3, line.hd + (pz + nz) / 2),
  }
}

/**
 * A segment drawn or picked out to a room's edges, in its roof at `roof`'s place: its size and
 * place in its roof with its walls' outer faces on them (`settleRoofOnEdges`).
 */
export function settleSegmentOnEdges(
  roof: Pick<RoofNode, 'position' | 'rotation'>,
  segment: Pick<RoofSegmentNode, 'position' | 'rotation' | 'width' | 'depth' | 'wallThickness'>,
  walls: readonly RoofCatchLine[],
): Pick<RoofSegmentNode, 'position' | 'width' | 'depth'> {
  const settled = settleRoofOnEdges(segmentWallLine(roof, segment), walls, segment.wallThickness)
  const dx = settled.center[0] - roof.position[0]
  const dz = settled.center[1] - roof.position[2]
  const cos = Math.cos(-roof.rotation)
  const sin = Math.sin(-roof.rotation)
  return {
    position: [dx * cos + dz * sin, segment.position[1], -dx * sin + dz * cos],
    width: settled.hw * 2,
    depth: settled.hd * 2,
  }
}
