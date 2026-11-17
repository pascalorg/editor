import type { AnyNode } from '../schema'
import {
  getRoofSegmentSurfaceY,
  getSegmentSlopeFrame,
  isBandedShedSegment,
  type RoofSegmentNode,
} from '../schema/nodes/roof-segment'
import { pointInPolygon } from './polygon-relations'
import { getShedFootprintPieces, type ShedPlanPolygon } from './roof-shed-pieces'

/** Native concentric bend; Y is unchanged. Input is the persisted, flat segment frame. */
export function bendShedBandPoint(
  arc: NonNullable<RoofSegmentNode['arc']>,
  x: number,
  z: number,
): [number, number] {
  const signedRef = (Math.sign(arc.centerZ) || 1) * arc.radius
  const phi = (x - arc.centerX) / signedRef
  const radial = z - arc.centerZ
  return [arc.centerX - radial * Math.sin(phi), arc.centerZ + radial * Math.cos(phi)]
}

function transformShedPlanPoint(
  node: RoofSegmentNode,
  point: readonly [number, number],
): [number, number] {
  const frame = node.shedJointFrame
  // Managed curved footprints are flat-local; neighbor queries use their rendered frame.
  const bent = node.arc && frame ? bendShedBandPoint(node.arc, point[0], point[1]) : point
  const cos = Math.cos(node.rotation ?? 0)
  const sin = Math.sin(node.rotation ?? 0)
  const segmentPoint: [number, number] = [
    (node.position[0] ?? 0) + bent[0] * cos + bent[1] * sin,
    (node.position[2] ?? 0) - bent[0] * sin + bent[1] * cos,
  ]
  if (!frame) return segmentPoint
  const ownerCos = Math.cos(frame.rotation)
  const ownerSin = Math.sin(frame.rotation)
  return [
    frame.position[0] + segmentPoint[0] * ownerCos + segmentPoint[1] * ownerSin,
    frame.position[2] - segmentPoint[0] * ownerSin + segmentPoint[1] * ownerCos,
  ]
}

function inverseTransformShedPlanPoint(
  node: RoofSegmentNode,
  point: readonly [number, number],
): [number, number] {
  const frame = node.shedJointFrame
  let source = point
  if (frame) {
    const ownerCos = Math.cos(frame.rotation)
    const ownerSin = Math.sin(frame.rotation)
    const dx = point[0] - frame.position[0]
    const dz = point[1] - frame.position[2]
    source = [dx * ownerCos - dz * ownerSin, dx * ownerSin + dz * ownerCos]
  }
  const cos = Math.cos(node.rotation ?? 0)
  const sin = Math.sin(node.rotation ?? 0)
  const dx = source[0] - (node.position[0] ?? 0)
  const dz = source[1] - (node.position[2] ?? 0)
  const segmentPoint: [number, number] = [dx * cos - dz * sin, dx * sin + dz * cos]
  if (!node.arc || !frame) return segmentPoint
  const signedRef = (Math.sign(node.arc.centerZ) || 1) * node.arc.radius
  const radialX = segmentPoint[0] - node.arc.centerX
  const radialZ = segmentPoint[1] - node.arc.centerZ
  const radialSign = -(Math.sign(node.arc.centerZ) || 1)
  const phi = Math.atan2(-radialX * radialSign, radialZ * radialSign)
  const radial = Math.hypot(radialX, radialZ) * radialSign
  return [node.arc.centerX + phi * signedRef, node.arc.centerZ + radial]
}

function pointInOrNearShedPolygon(
  point: readonly [number, number],
  polygon: ShedPlanPolygon,
  tolerance: number,
): boolean {
  if (pointInPolygon([point[0], point[1]], polygon, { includeBoundary: false })) return true
  if (!(tolerance > 0)) return false
  const toleranceSquared = tolerance * tolerance
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const lengthSquared = dx * dx + dz * dz
    const ratio =
      lengthSquared > 1e-12
        ? Math.max(
            0,
            Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared),
          )
        : 0
    const closestX = start[0] + dx * ratio
    const closestZ = start[1] + dz * ratio
    const distanceSquared =
      (point[0] - closestX) * (point[0] - closestX) + (point[1] - closestZ) * (point[1] - closestZ)
    if (distanceSquared <= toleranceSquared) return true
  }
  return false
}

function shedJoinTolerance(node: RoofSegmentNode, sibling: RoofSegmentNode): number {
  const sideOverhang = (segment: RoofSegmentNode) => {
    const span = segment.shedSideInfillSpan
    return typeof span === 'number' && Number.isFinite(span)
      ? Math.max(0, (segment.width - span) / 2)
      : 0
  }
  return Math.max(
    0.02,
    Math.min(
      0.2,
      Math.max(
        node.overhang,
        sibling.overhang,
        node.wallThickness,
        sibling.wallThickness,
        sideOverhang(node),
        sideOverhang(sibling),
      ),
    ),
  )
}

/** First eligible sibling covering all three edge samples, in scene insertion order. */
export function getShedEdgeSibling(
  node: RoofSegmentNode,
  start: readonly [number, number],
  end: readonly [number, number],
  nodes?: Readonly<Record<string, AnyNode>>,
): RoofSegmentNode | undefined {
  if (!nodes) return undefined
  const neighbors = node.shedJointNeighborIds
  const siblings = Object.values(nodes).filter(
    (candidate): candidate is RoofSegmentNode =>
      candidate.type === 'roof-segment' &&
      candidate.id !== node.id &&
      (Boolean(node.parentId && candidate.parentId === node.parentId) ||
        Boolean(node.shedJointScopeId && candidate.shedJointScopeId === node.shedJointScopeId)) &&
      candidate.roofType === 'shed' &&
      (!neighbors?.length ||
        (candidate.shedJointOwnerId !== undefined &&
          neighbors.includes(candidate.shedJointOwnerId))),
  )
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length <= 1e-6) return undefined
  const nx = -dz / length
  const nz = dx / length
  return siblings.find((sibling) =>
    [0.25, 0.5, 0.75].every((ratio) => {
      const x = start[0] + dx * ratio
      const z = start[1] + dz * ratio
      const samples: [number, number][] = [
        transformShedPlanPoint(node, [x, z]),
        transformShedPlanPoint(node, [x + nx * 1e-4, z + nz * 1e-4]),
        transformShedPlanPoint(node, [x - nx * 1e-4, z - nz * 1e-4]),
      ]
      return samples.some((sample) => {
        const local = inverseTransformShedPlanPoint(sibling, sample)
        return getShedFootprintPieces(sibling).some((polygon) =>
          pointInOrNearShedPolygon(local, polygon, shedJoinTolerance(node, sibling)),
        )
      })
    }),
  )
}

function shedWorldYOrigin(node: RoofSegmentNode, nodes: Readonly<Record<string, AnyNode>>): number {
  if (node.shedJointFrame) return node.shedJointFrame.position[1] + (node.position[1] ?? 0)
  const parent = node.parentId ? nodes[node.parentId] : undefined
  return (parent?.type === 'roof' ? (parent.position[1] ?? 0) : 0) + (node.position[1] ?? 0)
}

function shedVerticalThickness(node: RoofSegmentNode): number {
  const { cosTheta } = getSegmentSlopeFrame(node)
  return node.deckThickness / Math.max(0.1, cosTheta) + node.shingleThickness * cosTheta
}

/** Neighbor's finished top expressed in this segment's vertical frame. */
export function getShedSiblingTopY(
  node: RoofSegmentNode,
  sibling: RoofSegmentNode,
  point: readonly [number, number],
  nodes: Readonly<Record<string, AnyNode>>,
): number {
  const worldPoint = transformShedPlanPoint(node, point)
  const siblingPoint = inverseTransformShedPlanPoint(sibling, worldPoint)
  return (
    shedWorldYOrigin(sibling, nodes) +
    getRoofSegmentSurfaceY(sibling, siblingPoint[0], siblingPoint[1]) +
    shedVerticalThickness(sibling) -
    shedWorldYOrigin(node, nodes)
  )
}

/** Heights of a sanitized flat-local render outline, before bending or any scene CSG. */
export function getShedPieceSurface(
  node: RoofSegmentNode,
  outline: readonly [number, number][],
  nodes?: Readonly<Record<string, AnyNode>>,
): { topY: number[]; verticalThickness: number; edgeSiblings: (RoofSegmentNode | undefined)[] } {
  const banded = isBandedShedSegment(node) && node.arc
  const verticalThickness = shedVerticalThickness(node)
  const edgeSiblings = banded
    ? outline.map(() => undefined)
    : outline.map((point, index) =>
        getShedEdgeSibling(node, point, outline[(index + 1) % outline.length]!, nodes),
      )
  const topY = outline.map(([x, z]) => getRoofSegmentSurfaceY(node, x, z) + verticalThickness)
  // Straight triangular infill pins its shared edge to the curved neighbor, in outline order.
  if (!banded && outline.length === 3 && nodes) {
    for (let index = 0; index < outline.length; index++) {
      const sibling = edgeSiblings[index]
      if (!sibling?.arc) continue
      const next = (index + 1) % outline.length
      topY[index] = getShedSiblingTopY(node, sibling, outline[index]!, nodes)
      topY[next] = getShedSiblingTopY(node, sibling, outline[next]!, nodes)
    }
  }
  return { topY, verticalThickness, edgeSiblings }
}
