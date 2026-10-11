import type { AnyNode, AnyNodeId, WallNode } from '../schema'
import { resolveWallLoop } from '../systems/wall/wall-loop'
import type { FacadeWallTarget } from './facade-runs'

export type FacadeScope = 'wall' | 'exterior' | 'interior' | 'both'

const COVERAGE_TOLERANCE = 0.01

const polylineLength = (points: readonly [number, number][]) =>
  points
    .slice(1)
    .reduce(
      (total, point, i) => total + Math.hypot(point[0] - points[i]![0], point[1] - points[i]![1]),
      0,
    )

/** A loop wall that runs on past one of the loop's corners: filled, it would get openings outside. */
export type FacadePastCorner = { wallId: string; covered: number; length: number }

const metres = (value: number) => (Math.round(value * 100) / 100).toFixed(2)

/** The walls left out, named with how much of each the loop covers. */
export function describePastCorner(walls: readonly FacadePastCorner[]) {
  return walls
    .map(
      ({ wallId, covered, length }) =>
        `${wallId} (the loop covers ${metres(covered)} of ${metres(length)} m)`,
    )
    .join(', ')
}

/**
 * The walls a loop scope fills from one picked wall, and which face of each; a wall running past a
 * corner of the loop is left out and reported (`pastCorner`), and so is an arc (`curved`), which no
 * facade covers yet: one rounded corner refused the whole floor (Hawkesbury run 2, 2026-10-03).
 */
export function facadeLoopTargets(
  nodes: Record<AnyNodeId, AnyNode>,
  wall: WallNode,
  scope: Exclude<FacadeScope, 'wall'>,
  joinTolerance?: number,
  paintOnly = false,
): {
  walls: WallNode[]
  targets: Record<string, FacadeWallTarget>
  pastCorner: FacadePastCorner[]
  curved: WallNode['id'][]
} {
  const loop = resolveWallLoop(nodes, wall.id, scope === 'both' ? 'exterior' : scope, joinTolerance)
  const targets: Record<string, FacadeWallTarget> = {}
  const walls: WallNode[] = []
  const pastCorner: FacadePastCorner[] = []
  const curved: WallNode['id'][] = []
  for (const target of loop.walls) {
    if (target.curveOffset && !paintOnly) {
      curved.push(target.id)
      continue
    }
    const faces = loop.boundary.filter((b) => b.wallId === target.id)
    const covered = faces.reduce((sum, b) => sum + polylineLength(b.points), 0)
    const length = Math.hypot(target.end[0] - target.start[0], target.end[1] - target.start[1])
    if (covered < length - COVERAGE_TOLERANCE) {
      pastCorner.push({ wallId: target.id, covered, length })
      continue
    }
    const face = faces[0]!.face
    const semantic = face === 'front' ? target.frontSide : target.backSide
    const slot =
      semantic === 'interior' || semantic === 'exterior'
        ? semantic
        : face === 'front'
          ? 'interior'
          : 'exterior'
    targets[target.id] = { surface: scope === 'both' ? 'both' : slot, face }
    walls.push(target)
  }
  return { walls, targets, pastCorner, curved }
}

/**
 * The walls a facade applies to from one picked wall, and which face of each. A loop scope takes
 * the whole closed perimeter on the picked wall's level, and is refused while a wall of it runs on
 * past a corner of the loop, naming each.
 */
export function facadeScopeTargets(
  nodes: Record<AnyNodeId, AnyNode>,
  wall: WallNode,
  scope: FacadeScope,
  joinTolerance?: number,
  paintOnly = false,
): { walls: WallNode[]; targets: Record<string, FacadeWallTarget>; curved?: WallNode['id'][] } {
  if (scope === 'wall') return { walls: [wall], targets: {} }
  const { walls, targets, pastCorner, curved } = facadeLoopTargets(
    nodes,
    wall,
    scope,
    joinTolerance,
    paintOnly,
  )
  if (pastCorner.length)
    throw Error(
      `Split each wall at the perimeter junction before filling this loop: ${describePastCorner(pastCorner)}.`,
    )
  return { walls, targets, ...(curved.length ? { curved } : {}) }
}
