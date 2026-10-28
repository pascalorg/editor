import { isOutdoorRoomType } from '../../lib/outdoor-room'
import { pointInPolygon as pointInPolygon2D } from '../../lib/polygon-relations'
import { detectSpacesForLevel } from '../../lib/space-detection'
import type { AnyNode, LevelNode, SeparatorNode, WallNode, ZoneNode } from '../../schema'
import { isRailingWall } from '../../schema/nodes/railing-wall'
import { getLevelBelow } from '../../services/storey'
import { isCurvedWall } from '../wall/wall-curve'
import { getWallThickness } from '../wall/wall-footprint'
import { getWallBodyLine } from '../wall/wall-frame'

export type RoofFootprintTarget = {
  id: string
  polygon: Array<[number, number]>
  /** The walls it stands on: a room's walls; a porch's, deck's or patio's house walls. */
  wallIds: WallNode['id'][]
  /**
   * A porch's, deck's or patio's invisible walls and railings along its outside edge: the edge the
   * roof's outer face stands on, not walls it stands on (`outdoorRoomRoofOutline`).
   */
  edgeIds?: string[]
  /** The level the room is on. */
  levelId?: LevelNode['id']
  center: [number, number]
  width: number
  depth: number
  rotation: number
  rectangular: boolean
}

type P = [number, number]

/** What runs along an edge of a room's roof outline: a wall, a railing or an invisible wall. */
export type RoofOutlineEdge = { kind: 'wall' | 'railing' | 'separator'; id: string } | null

/** A room's outline edge this near a boundary's line, and parallel to it, runs along it (m). */
const ON_BOUNDARY = 0.01

/** What runs along the room edge `a` → `b`: the nearest straight wall or invisible wall on it. */
function boundaryAlong(
  a: P,
  b: P,
  walls: readonly WallNode[],
  separators: readonly SeparatorNode[],
): (RoofOutlineEdge & { thickness: number }) | null {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (length < 1e-9) return null
  const dir: P = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
  const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const lines = [
    // A wall drawn by a face runs its rooms along its body's centre, half its thickness off it.
    ...walls.flatMap((wall) => {
      if (isCurvedWall(wall)) return []
      const body = getWallBodyLine(wall)
      return [
        {
          kind: isRailingWall(wall) ? ('railing' as const) : ('wall' as const),
          id: wall.id,
          start: [body.start.x, body.start.y] as P,
          end: [body.end.x, body.end.y] as P,
          thickness: getWallThickness(wall),
        },
      ]
    }),
    ...separators.map((separator) => ({
      kind: 'separator' as const,
      id: separator.id,
      start: separator.start,
      end: separator.end,
      thickness: 0,
    })),
  ]
  let found: (RoofOutlineEdge & { thickness: number }) | null = null
  let nearest = ON_BOUNDARY
  for (const line of lines) {
    const run: P = [line.end[0] - line.start[0], line.end[1] - line.start[1]]
    const span = Math.hypot(run[0], run[1])
    if (span < 1e-6) continue
    const u: P = [run[0] / span, run[1] / span]
    if (Math.abs(u[0] * dir[1] - u[1] * dir[0]) > 1e-3) continue
    const rel: P = [mid[0] - line.start[0], mid[1] - line.start[1]]
    const across = Math.abs(rel[0] * u[1] - rel[1] * u[0])
    const along = rel[0] * u[0] + rel[1] * u[1]
    if (across > nearest || along < -ON_BOUNDARY || along > span + ON_BOUNDARY) continue
    found = { kind: line.kind, id: line.id, thickness: line.thickness }
    nearest = across
  }
  return found
}

/**
 * The outside edge of a porch, deck or patio (`lib/outdoor-room`) a roof over it lines up with,
 * in its level's plan: the room's outline with each edge on a railing moved out to the railing's
 * outside face (to its posts' outer corners where two railings meet). An edge on an invisible wall
 * stays on its line, which is the room's edge, and one on the house wall the room leans on stays
 * on the wall's centre line, as a room's walls do in the house's own roof footprint. `edges[i]`
 * runs from `polygon[i]` to `polygon[i + 1]`: what runs along it, null on the short jog where a
 * railing runs on into an invisible wall along one line.
 */
export function outdoorRoomRoofOutline(
  zone: Pick<ZoneNode, 'polygon'>,
  walls: readonly WallNode[],
  separators: readonly SeparatorNode[],
): { polygon: P[]; edges: RoofOutlineEdge[] } {
  const points = zone.polygon.filter((point, index, all) => {
    const next = all[(index + 1) % all.length]!
    return Math.hypot(next[0] - point[0], next[1] - point[1]) > 1e-9
  }) as P[]
  const n = points.length
  if (n < 3) return { polygon: points, edges: points.map(() => null) }
  let area = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    area += a[0] * b[1] - b[0] * a[1]
  }
  const turn = area > 0 ? 1 : -1
  const sides = points.map((a, i) => {
    const b = points[(i + 1) % n]!
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    const dir: P = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
    const boundary = boundaryAlong(a, b, walls, separators)
    const edge: RoofOutlineEdge = boundary && { kind: boundary.kind, id: boundary.id }
    return {
      dir,
      out: [dir[1] * turn, -dir[0] * turn] as P,
      offset: boundary?.kind === 'railing' ? boundary.thickness / 2 : 0,
      edge,
    }
  })
  const polygon: P[] = []
  const edges: RoofOutlineEdge[] = []
  sides.forEach((side, i) => {
    const prev = sides[(i - 1 + n) % n]!
    const vertex = points[i]!
    const from: P = [vertex[0] + prev.out[0] * prev.offset, vertex[1] + prev.out[1] * prev.offset]
    const to: P = [vertex[0] + side.out[0] * side.offset, vertex[1] + side.out[1] * side.offset]
    const denom = prev.dir[0] * side.dir[1] - prev.dir[1] * side.dir[0]
    if (Math.abs(denom) > 1e-9) {
      // Where the two edges' moved lines meet.
      const t = ((to[0] - from[0]) * side.dir[1] - (to[1] - from[1]) * side.dir[0]) / denom
      polygon.push([from[0] + prev.dir[0] * t, from[1] + prev.dir[1] * t])
    } else {
      polygon.push(from)
      if (Math.hypot(to[0] - from[0], to[1] - from[1]) > 1e-9) {
        edges.push(null)
        polygon.push(to)
      }
    }
    edges.push(side.edge)
  })
  return { polygon, edges }
}

function polygonArea(polygon: ReadonlyArray<readonly [number, number]>): number {
  return Math.abs(
    polygon.reduce((area, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? area + point[0] * next[1] - next[0] * point[1] : area
    }, 0) / 2,
  )
}

export function fitRoofFootprint(
  id: string,
  polygon: Array<[number, number]>,
  wallIds: WallNode['id'][],
): RoofFootprintTarget | null {
  if (polygon.length < 3) return null

  let best:
    | {
        center: [number, number]
        width: number
        depth: number
        rotation: number
        area: number
      }
    | undefined

  for (let index = 0; index < polygon.length; index++) {
    const point = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    if (!(point && next)) continue
    const rotation = Math.atan2(next[1] - point[1], next[0] - point[0])
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const rotated = polygon.map(([x, z]) => [x * cos + z * sin, -x * sin + z * cos] as const)
    const xs = rotated.map(([x]) => x)
    const zs = rotated.map(([, z]) => z)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minZ = Math.min(...zs)
    const maxZ = Math.max(...zs)
    const width = maxX - minX
    const depth = maxZ - minZ
    const area = width * depth
    if (area <= 0 || (best && best.area <= area)) continue
    const localCenterX = (minX + maxX) / 2
    const localCenterZ = (minZ + maxZ) / 2
    best = {
      center: [localCenterX * cos - localCenterZ * sin, localCenterX * sin + localCenterZ * cos],
      width,
      depth,
      rotation: -rotation,
      area,
    }
  }

  if (!best) return null
  return {
    id,
    polygon,
    wallIds,
    center: best.center,
    width: best.width,
    depth: best.depth,
    rotation: best.rotation,
    rectangular: polygonArea(polygon) / best.area >= 0.96,
  }
}

/**
 * The Room pick's footprint at `point`, on the level or else the level below: the porch, deck or
 * patio there, to its outside edge (`resolveOutdoorRoomRoofFootprintOnLevel`), else the smallest
 * room the level's walls enclose (`resolveRoomRoofFootprintOnLevel`).
 */
export function resolveRoomRoofFootprint(
  levelId: LevelNode['id'],
  nodes: Readonly<Record<string, AnyNode>>,
  point: [number, number],
  options: { rectangularOnly?: boolean } = {},
): RoofFootprintTarget | null {
  const onLevel = (id: LevelNode['id']): RoofFootprintTarget | null => {
    const target =
      resolveOutdoorRoomRoofFootprintOnLevel(id, nodes, point) ??
      resolveRoomRoofFootprintOnLevel(id, nodes, point)
    return target && { ...target, levelId: id }
  }
  const activeTarget = onLevel(levelId)
  if (activeTarget && (!options.rectangularOnly || activeTarget.rectangular)) return activeTarget
  if (activeTarget) return null
  const levelBelow = getLevelBelow(levelId, nodes as Record<string, AnyNode>)
  const levelBelowTarget = levelBelow ? onLevel(levelBelow.id) : null
  return levelBelowTarget && (!options.rectangularOnly || levelBelowTarget.rectangular)
    ? levelBelowTarget
    : null
}

/**
 * The porch, deck or patio at `point` on `levelId` (the smallest), as a roof over it stands: its
 * outside edge (`outdoorRoomRoofOutline`), standing on the house walls it leans on, its invisible
 * walls and railings the edge its outer face lines up with. Null where no such room is. Indoors the
 * Room pick reads the walls alone, so an invisible wall splitting a room off inside the house
 * never shrinks the house's roof to it.
 */
export function resolveOutdoorRoomRoofFootprintOnLevel(
  levelId: LevelNode['id'],
  nodes: Readonly<Record<string, AnyNode>>,
  point: [number, number],
): RoofFootprintTarget | null {
  const level = nodes[levelId]
  if (level?.type !== 'level') return null
  const children = level.children.map((id) => nodes[id])
  const zone = children
    .filter(
      (node): node is ZoneNode =>
        node?.type === 'zone' &&
        isOutdoorRoomType(node.roomType) &&
        node.polygon.length >= 3 &&
        pointInPolygon2D(point, node.polygon),
    )
    .sort((left, right) => polygonArea(left.polygon) - polygonArea(right.polygon))[0]
  if (!zone) return null
  const walls = children.filter((node): node is WallNode => node?.type === 'wall')
  const separators = children.filter((node): node is SeparatorNode => node?.type === 'separator')
  const { polygon, edges } = outdoorRoomRoofOutline(zone, walls, separators)
  const ids = (kinds: ReadonlyArray<NonNullable<RoofOutlineEdge>['kind']>) => [
    ...new Set(edges.flatMap((edge) => (edge && kinds.includes(edge.kind) ? [edge.id] : []))),
  ]
  const target = fitRoofFootprint(zone.id, polygon, ids(['wall']) as WallNode['id'][])
  return target && { ...target, edgeIds: ids(['railing', 'separator']) }
}

export function resolveRoomRoofFootprintOnLevel(
  levelId: LevelNode['id'],
  nodes: Readonly<Record<string, AnyNode>>,
  point: [number, number],
): RoofFootprintTarget | null {
  const level = nodes[levelId]
  if (level?.type !== 'level') return null
  const walls = level.children
    .map((id) => nodes[id])
    .filter((node): node is WallNode => node?.type === 'wall')
  const spaces = detectSpacesForLevel(levelId, walls)
    .spaces.filter((space) => !space.isExterior && pointInPolygon2D(point, space.polygon))
    .sort((left, right) => polygonArea(left.polygon) - polygonArea(right.polygon))
  const space = spaces[0]
  return space ? fitRoofFootprint(space.id, space.polygon, space.wallIds) : null
}
