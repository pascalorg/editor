import { exteriorWallLoops } from '../lib/exterior-wall-loops'
import type { SpaceBoundaryFace } from '../lib/room-graph'
import type { AnyNode, LevelNode, WallNode } from '../schema'

export type Point = [number, number]

export const sub = (a: readonly number[], b: readonly number[]): Point => [
  a[0]! - b[0]!,
  a[1]! - b[1]!,
]
export const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
export const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0]
export const polylineLength = (points: readonly Point[]) =>
  points.slice(1).reduce((sum, p, i) => sum + Math.hypot(...sub(p, points[i]!)), 0)
const shoelace = (points: readonly Point[]) =>
  Math.abs(
    points.reduce((sum, [x, z], i) => {
      const [nx, nz] = points[(i + 1) % points.length]!
      return sum + x * nz - nx * z
    }, 0),
  ) / 2

/** Every storey's visible walls, by level id. */
export function wallsByLevel(nodes: Record<string, AnyNode>) {
  const byLevel = new Map<string, WallNode[]>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall' || !node.parentId || node.visible === false) continue
    const walls = byLevel.get(node.parentId)
    if (walls) walls.push(node)
    else byLevel.set(node.parentId, [node])
  }
  return byLevel
}

/** A building's storeys by level index. */
export function buildingLevels(nodes: Record<string, AnyNode>, buildingId: string): LevelNode[] {
  const building = nodes[buildingId]
  if (building?.type !== 'building') throw Error('Pick a building for the facade.')
  return building.children
    .map((id) => nodes[id])
    .filter((node): node is LevelNode => node?.type === 'level')
    .sort((a, b) => a.level - b.level)
}

/** The largest outside loop of a storey's walls, or none when they do not close. */
export function outsideLoop(walls: WallNode[]): SpaceBoundaryFace[] | null {
  const loops = exteriorWallLoops(walls)
  if (!loops.length) return null
  return loops.reduce((best, loop) =>
    shoelace(loop.flatMap((face) => face.points)) > shoelace(best.flatMap((face) => face.points))
      ? loop
      : best,
  )
}

/**
 * The loop's walls a facade can go on, and those running past one of its
 * corners — which would take openings or bands outside the loop.
 */
export function loopWalls(loop: readonly SpaceBoundaryFace[], nodes: Record<string, AnyNode>) {
  const covered = new Map<string, number>()
  for (const face of loop)
    covered.set(face.wallId, (covered.get(face.wallId) ?? 0) + polylineLength(face.points))
  const fits: { wall: WallNode; face: SpaceBoundaryFace['face'] }[] = []
  const pastCorner: WallNode[] = []
  // A wall a junction splits shows as several faces of the loop: it is one target.
  const seen = new Set<string>()
  for (const face of loop) {
    if (seen.has(face.wallId)) continue
    seen.add(face.wallId)
    const wall = nodes[face.wallId] as WallNode
    const length = Math.hypot(...sub(wall.end, wall.start))
    if (covered.get(wall.id)! < length - 0.01) pastCorner.push(wall)
    else fits.push({ wall, face: face.face })
  }
  return { fits, pastCorner }
}
