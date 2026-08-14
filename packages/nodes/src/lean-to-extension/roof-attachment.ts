import {
  type AnyNode,
  type AnyNodeId,
  getLevelElevations,
  getWallBaseElevationForNodes,
  type LeanToExtensionNode,
  type LeanToRoofEdge,
  type RoofNode,
  type RoofSegmentNode,
  type WallNode,
} from '@pascal-app/core'
import { getRoofTopSurfaceY } from '../shared/roof-surface'
import { leanToLowEdgeHeight } from './layout'

const MAX_EDGE_DISTANCE = 1.25
const MIN_EDGE_OVERLAP = 0.35
const MAX_EDGE_SLOPE_DELTA = 0.06
const MIN_PARALLEL_DOT = Math.cos((8 * Math.PI) / 180)
const EDGE_SAMPLES = [0, 0.25, 0.5, 0.75, 1] as const
const MIN_EXTENSION_SPAN = 0.5
const MAX_EXTENSION_SPAN = 100

export type LeanToRoofAttachment = {
  roofId: RoofNode['id']
  roofSegmentId: RoofSegmentNode['id']
  edge: LeanToRoofEdge
  edgeRange: readonly [number, number]
  highEdgeHeight: number
  planDistance: number
  overlap: number
  edgeSpan: number
  wallLocalCenterX: number
  deckThickness: number
  shingleThickness: number
}

type ResolveOptions = {
  roofSegmentId?: string
  edge?: LeanToRoofEdge
}

type PlanPoint = { x: number; z: number }
type EdgePoint = PlanPoint & { y: number }

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

function rotateY(x: number, z: number, rotation: number): PlanPoint {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return { x: x * cos + z * sin, z: -x * sin + z * cos }
}

function segmentPointToLevel(
  roof: RoofNode,
  segment: RoofSegmentNode,
  localX: number,
  localZ: number,
): EdgePoint {
  const inRoof = rotateY(localX, localZ, segment.rotation ?? 0)
  const inLevel = rotateY(
    segment.position[0] + inRoof.x,
    segment.position[2] + inRoof.z,
    roof.rotation ?? 0,
  )
  return {
    x: roof.position[0] + inLevel.x,
    y: roof.position[1] + segment.position[1] + getRoofTopSurfaceY(localX, localZ, segment),
    z: roof.position[2] + inLevel.z,
  }
}

function edgeEndpoints(
  segment: RoofSegmentNode,
  edge: LeanToRoofEdge,
): readonly [[number, number], [number, number]] {
  const halfWidth = segment.width / 2 + Math.max(0, segment.overhang ?? 0)
  const halfDepth = segment.depth / 2 + Math.max(0, segment.overhang ?? 0)
  switch (edge) {
    case '+X':
      return [
        [halfWidth, -halfDepth],
        [halfWidth, halfDepth],
      ]
    case '-X':
      return [
        [-halfWidth, -halfDepth],
        [-halfWidth, halfDepth],
      ]
    case '+Z':
      return [
        [-halfWidth, halfDepth],
        [halfWidth, halfDepth],
      ]
    case '-Z':
      return [
        [-halfWidth, -halfDepth],
        [halfWidth, -halfDepth],
      ]
  }
}

function sampleEdge(roof: RoofNode, segment: RoofSegmentNode, edge: LeanToRoofEdge): EdgePoint[] {
  const [start, end] = edgeEndpoints(segment, edge)
  return EDGE_SAMPLES.map((t) =>
    segmentPointToLevel(
      roof,
      segment,
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
    ),
  )
}

function projection(point: PlanPoint, origin: PlanPoint, axis: PlanPoint): number {
  return (point.x - origin.x) * axis.x + (point.z - origin.z) * axis.z
}

function nearestPointOnSegment(point: PlanPoint, start: PlanPoint, end: PlanPoint): PlanPoint {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSquared = dx * dx + dz * dz
  const t =
    lengthSquared <= 1e-9
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared),
        )
  return { x: start.x + dx * t, z: start.z + dz * t }
}

function wallFrame(wall: WallNode, leanTo: LeanToExtensionNode) {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length <= 1e-6) return null
  const along = { x: dx / length, z: dz / length }
  const perpendicular = { x: -along.z, z: along.x }
  const side = Math.cos(leanTo.rotation[1]) >= 0 ? 1 : -1
  const center = {
    x: wall.start[0] + along.x * leanTo.position[0] + perpendicular.x * leanTo.position[2],
    z: wall.start[1] + along.z * leanTo.position[0] + perpendicular.z * leanTo.position[2],
  }
  return {
    along,
    outward: { x: perpendicular.x * side, z: perpendicular.z * side },
    center,
    wallStart: { x: wall.start[0], z: wall.start[1] },
  }
}

function autoSpanPatch(
  leanTo: LeanToExtensionNode,
  visibleSpan: number,
  wallLocalCenterX: number,
): Pick<LeanToExtensionNode, 'position' | 'span'> {
  const span = Math.max(
    MIN_EXTENSION_SPAN,
    Math.min(MAX_EXTENSION_SPAN, visibleSpan - leanTo.leftOverhang - leanTo.rightOverhang),
  )
  return {
    span,
    position: [wallLocalCenterX, leanTo.position[1], leanTo.position[2]],
  }
}

function gutterEdgeRange(
  edge: LeanToRoofEdge,
  edgeStart: number,
  edgeEnd: number,
  halfSpan: number,
): readonly [number, number] {
  const overlapFrom = Math.max(-halfSpan, Math.min(edgeStart, edgeEnd))
  const overlapTo = Math.min(halfSpan, Math.max(edgeStart, edgeEnd))
  const delta = edgeEnd - edgeStart
  if (Math.abs(delta) <= 1e-9) return [0, 1]
  const first = (overlapFrom - edgeStart) / delta
  const second = (overlapTo - edgeStart) / delta
  const from = Math.max(0, Math.min(1, Math.min(first, second)))
  const to = Math.max(0, Math.min(1, Math.max(first, second)))
  return edge === '-Z' || edge === '+X' ? [1 - to, 1 - from] : [from, to]
}

export function resolveLeanToRoofAttachment(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
  nodes: Record<AnyNodeId, AnyNode>,
  options: ResolveOptions = {},
): LeanToRoofAttachment | null {
  const frame = wallFrame(wall, leanTo)
  if (!frame) return null
  const wallBase = getWallBaseElevationForNodes(wall, nodes)
  const levelElevations = getLevelElevations(nodes)
  const wallLevel = wall.parentId ? levelElevations.get(wall.parentId) : undefined
  const halfSpan =
    leanTo.span / 2 + Math.max(Math.max(0, leanTo.leftOverhang), Math.max(0, leanTo.rightOverhang))
  let best: { attachment: LeanToRoofAttachment; score: number } | null = null

  for (const candidate of Object.values(nodes)) {
    if (candidate.type !== 'roof') continue
    if (metadataRecord(candidate.metadata).managedByLeanTo) continue
    const roof = candidate
    const roofLevel = roof.parentId ? levelElevations.get(roof.parentId) : undefined
    if (roof.parentId !== wall.parentId) {
      if (!(wallLevel && roofLevel) || wallLevel.buildingId !== roofLevel.buildingId) continue
    }
    const roofToWallY = (roofLevel?.baseY ?? 0) - (wallLevel?.baseY ?? 0)

    for (const childId of roof.children) {
      const child = nodes[childId as AnyNodeId]
      if (child?.type !== 'roof-segment') continue
      const segment = child
      if (options.roofSegmentId && segment.id !== options.roofSegmentId) continue

      for (const edge of ['+X', '-X', '+Z', '-Z'] as const) {
        if (options.edge && edge !== options.edge) continue
        const samples = sampleEdge(roof, segment, edge)
        const start = samples[0]!
        const end = samples.at(-1)!
        const edgeDx = end.x - start.x
        const edgeDz = end.z - start.z
        const edgeLength = Math.hypot(edgeDx, edgeDz)
        if (edgeLength <= 1e-6) continue
        const parallel = Math.abs(
          (edgeDx / edgeLength) * frame.along.x + (edgeDz / edgeLength) * frame.along.z,
        )
        if (parallel < MIN_PARALLEL_DOT) continue

        const ys = samples.map((sample) => sample.y)
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)
        if (maxY - minY > MAX_EDGE_SLOPE_DELTA) continue

        const edgeStart = projection(start, frame.center, frame.along)
        const edgeEnd = projection(end, frame.center, frame.along)
        const edgeMin = Math.min(edgeStart, edgeEnd)
        const edgeMax = Math.max(edgeStart, edgeEnd)
        const overlap = Math.min(halfSpan, edgeMax) - Math.max(-halfSpan, edgeMin)
        if (overlap < Math.min(MIN_EDGE_OVERLAP, halfSpan * 0.5)) continue

        const nearest = nearestPointOnSegment(frame.center, start, end)
        const toEdge = {
          x: nearest.x - frame.center.x,
          z: nearest.z - frame.center.z,
        }
        const planDistance = Math.hypot(toEdge.x, toEdge.z)
        if (planDistance > MAX_EDGE_DISTANCE) continue
        if (toEdge.x * frame.outward.x + toEdge.z * frame.outward.z < -0.1) continue

        const edgeTopY = ys.reduce((sum, value) => sum + value, 0) / ys.length
        const highEdgeHeight =
          edgeTopY -
          wallBase +
          roofToWallY +
          planDistance * Math.tan((leanTo.pitch * Math.PI) / 180) +
          (leanTo.connectionOffset ?? 0)
        if (highEdgeHeight < 0.8 || highEdgeHeight > 10) continue

        const attachment: LeanToRoofAttachment = {
          roofId: roof.id,
          roofSegmentId: segment.id,
          edge,
          edgeRange: gutterEdgeRange(edge, edgeStart, edgeEnd, halfSpan),
          highEdgeHeight,
          planDistance,
          overlap,
          edgeSpan: Math.abs(
            projection(end, frame.wallStart, frame.along) -
              projection(start, frame.wallStart, frame.along),
          ),
          wallLocalCenterX:
            (projection(start, frame.wallStart, frame.along) +
              projection(end, frame.wallStart, frame.along)) /
            2,
          deckThickness: segment.deckThickness,
          shingleThickness: segment.shingleThickness ?? 0,
        }
        const score = planDistance + (1 - parallel) * 2 - Math.min(overlap, halfSpan * 2) * 0.02
        if (!best || score < best.score) best = { attachment, score }
      }
    }
  }

  return best?.attachment ?? null
}

export function applyLeanToRoofAttachment(
  leanTo: LeanToExtensionNode,
  attachment: LeanToRoofAttachment,
): LeanToExtensionNode {
  const highEdgeHeight = attachment.highEdgeHeight
  const lowEdgeHeight = leanToLowEdgeHeight({ ...leanTo, highEdgeHeight })
  return {
    ...leanTo,
    ...(leanTo.autoSpan
      ? autoSpanPatch(leanTo, attachment.edgeSpan, attachment.wallLocalCenterX)
      : {}),
    connectionMode: 'auto',
    hostRoofId: attachment.roofId,
    hostRoofSegmentId: attachment.roofSegmentId,
    hostRoofEdge: attachment.edge,
    hostRoofEdgeRange: leanTo.autoSpan ? [0, 1] : [...attachment.edgeRange],
    connectionInset: attachment.planDistance,
    highEdgeHeight,
    lowEdgeHeight,
    ...(leanTo.matchHostRoofStructure !== false
      ? {
          roofThickness: attachment.deckThickness,
          shingleThickness: attachment.shingleThickness,
        }
      : {}),
  }
}

export function applyLeanToWallAutoSpan(
  leanTo: LeanToExtensionNode,
  wall: WallNode,
): LeanToExtensionNode {
  if (!leanTo.autoSpan) return leanTo
  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  if (wallLength <= 1e-6) return leanTo
  return {
    ...leanTo,
    ...autoSpanPatch(leanTo, wallLength, wallLength / 2),
  }
}

export function detachLeanToFromRoof(leanTo: LeanToExtensionNode): LeanToExtensionNode {
  return {
    ...leanTo,
    connectionMode: 'manual',
    hostRoofId: undefined,
    hostRoofSegmentId: undefined,
    hostRoofEdge: undefined,
    hostRoofEdgeRange: undefined,
    connectionInset: 0,
  }
}

export function clearLeanToRoofAttachment(leanTo: LeanToExtensionNode): LeanToExtensionNode {
  return {
    ...leanTo,
    connectionMode: 'auto',
    hostRoofId: undefined,
    hostRoofSegmentId: undefined,
    hostRoofEdge: undefined,
    hostRoofEdgeRange: undefined,
    connectionInset: 0,
  }
}

export function resolveLeanToHostRoof(
  leanTo: LeanToExtensionNode,
  nodes: Record<AnyNodeId, AnyNode>,
): RoofNode | undefined {
  const roof = leanTo.hostRoofId ? nodes[leanTo.hostRoofId as AnyNodeId] : undefined
  return roof?.type === 'roof' ? roof : undefined
}
