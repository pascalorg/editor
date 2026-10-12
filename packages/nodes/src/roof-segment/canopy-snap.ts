import {
  type AnyNode,
  type AnyNodeId,
  getRoofRingEdgeNormal,
  getRoofSegmentCoverOutline,
  getRoofSegmentWallOutline,
  type RoofNode,
  type RoofSegmentNode,
  type WallNode,
} from '@pascal-app/core'
import { buildingOutlines } from '../roof/outline-snap'

type PlanPoint = [number, number]

/** Metres: a pulled edge this close to a neighbouring line lands on it. */
export const CANOPY_SNAP_REACH = 0.2

// three.js rotation-y in plan (x, z), as the roof and its segments render
const rotate = ([x, z]: PlanPoint, angle: number): PlanPoint => [
  x * Math.cos(angle) + z * Math.sin(angle),
  -x * Math.sin(angle) + z * Math.cos(angle),
]

function parentRoof(segment: RoofSegmentNode, nodes: Readonly<Record<string, AnyNode>>) {
  const parent = segment.parentId ? nodes[segment.parentId as AnyNodeId] : undefined
  return parent?.type === 'roof' ? (parent as RoofNode) : null
}

/** Segment-local plan point → the level's plan. */
function segmentToPlan(
  segment: RoofSegmentNode,
  roof: RoofNode | null,
  point: PlanPoint,
): PlanPoint {
  const [sx, sz] = rotate(point, segment.rotation ?? 0)
  const inRoof: PlanPoint = [sx + segment.position[0], sz + segment.position[2]]
  if (!roof) return inRoof
  const [rx, rz] = rotate(inRoof, roof.rotation ?? 0)
  return [rx + roof.position[0], rz + roof.position[2]]
}

/** The level's plan → segment-local. */
function planToSegment(
  segment: RoofSegmentNode,
  roof: RoofNode | null,
  point: PlanPoint,
): PlanPoint {
  const inRoof = roof
    ? rotate([point[0] - roof.position[0], point[1] - roof.position[2]], -(roof.rotation ?? 0))
    : point
  return rotate(
    [inRoof[0] - segment.position[0], inRoof[1] - segment.position[2]],
    -(segment.rotation ?? 0),
  )
}

/**
 * Plan points a canopy edge may line up with, segment-local: the outer corners
 * of the house walls, the corners of slabs (a terrace, a porch), posts (centre
 * and faces), the
 * corners of every other roof's covering, and this roof's own walls and
 * covering — all but the corners of the edge being pulled.
 */
export function getCanopySnapPoints(
  segment: RoofSegmentNode,
  edge: number,
  nodes: Readonly<Record<string, AnyNode>>,
): PlanPoint[] {
  const roof = parentRoof(segment, nodes)
  const plan: PlanPoint[] = []
  const all = Object.values(nodes)
  const walls = all.filter((node): node is WallNode => node?.type === 'wall')
  for (const ring of buildingOutlines(walls)) plan.push(...ring)
  for (const node of all) {
    if (node?.type === 'slab') {
      const polygon = (node as { polygon?: [number, number][] }).polygon ?? []
      plan.push(...polygon.map(([x, z]): PlanPoint => [x, z]))
    } else if (node?.type === 'column') {
      // a post: its centre and the faces of its box (a beam sits on either)
      const post = node as {
        position?: [number, number, number]
        width?: number
        depth?: number
      }
      if (post.position) {
        const [x, , z] = post.position
        const hx = (post.width ?? 0) / 2
        const hz = (post.depth ?? post.width ?? 0) / 2
        plan.push([x, z], [x - hx, z - hz], [x + hx, z + hz])
      }
    } else if (node?.type === 'roof-segment' && node.id !== segment.id) {
      const other = node as RoofSegmentNode
      const otherRoof = parentRoof(other, nodes)
      for (const point of getRoofSegmentCoverOutline(other)) {
        plan.push(segmentToPlan(other, otherRoof, point))
      }
    }
  }
  const local = plan.map((point) => planToSegment(segment, roof, point))

  const cover = getRoofSegmentCoverOutline(segment)
  const moving = new Set([edge, (edge + 1) % cover.length])
  local.push(...getRoofSegmentWallOutline(segment))
  local.push(...cover.filter((_, index) => !moving.has(index)))
  return local
}

/**
 * The outward reach of a pulled edge, stuck to the nearest neighbouring line
 * across its normal within CANOPY_SNAP_REACH; unchanged when none is near.
 */
export function snapCanopyReach(
  segment: RoofSegmentNode,
  edge: number,
  reach: number,
  points: readonly PlanPoint[],
): number {
  const [nx, nz] = getRoofRingEdgeNormal(getRoofSegmentCoverOutline(segment), edge)
  let best = reach
  let bestDistance = CANOPY_SNAP_REACH
  for (const [x, z] of points) {
    const target = nx * x + nz * z
    const distance = Math.abs(target - reach)
    if (distance < bestDistance) {
      best = target
      bestDistance = distance
    }
  }
  return best
}
