import type { AnyNode, LevelNode, RoofNode, RoofSegmentNode, RoofSupport } from '../schema'
import { getRoofSegmentSurfaceY } from '../schema'

export type RoofPlacementMode = 'auto' | 'ground' | 'roof'

export type ConicalRoofLevelPlacement = {
  valid: true
  kind: 'level'
  position: [number, number, number]
  wallHeight: number
  support: Extract<RoofSupport, { kind: 'level' }>
}

export type ConicalRoofSurfacePlacement = {
  valid: true
  kind: 'roof'
  position: [number, number, number]
  wallHeight: number
  hostRoofId: RoofNode['id']
  support: Extract<RoofSupport, { kind: 'roof' }>
}

export type ConicalRoofInvalidPlacement = {
  valid: false
  reason: 'no-roof-support'
}

export type ConicalRoofPlacement =
  | ConicalRoofLevelPlacement
  | ConicalRoofSurfacePlacement
  | ConicalRoofInvalidPlacement

export type ResolveConicalRoofPlacementInput = {
  nodes: Readonly<Record<string, AnyNode>>
  levelId: LevelNode['id']
  center: readonly [number, number]
  radius: number
  curbHeight: number
  mode: RoofPlacementMode
}

const CUTTER_SEAT_DEPTH = 0.1
const FOOTPRINT_EPSILON = 1e-6
const CIRCLE_SEGMENTS = 32
const HEIGHT_GRID_STEPS = 8

type RoofCandidate = {
  roof: RoofNode
  segment: RoofSegmentNode
  localCenter: [number, number]
  minSurfaceY: number
  maxSurfaceY: number
}

function inverseRotatePlan(x: number, z: number, rotation: number): [number, number] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [x * cos - z * sin, x * sin + z * cos]
}

function worldToSegmentPlan(
  roof: RoofNode,
  segment: RoofSegmentNode,
  point: readonly [number, number],
): [number, number] {
  const [roofX, roofZ] = inverseRotatePlan(
    point[0] - roof.position[0],
    point[1] - roof.position[2],
    roof.rotation ?? 0,
  )
  return inverseRotatePlan(
    roofX - segment.position[0],
    roofZ - segment.position[2],
    segment.rotation ?? 0,
  )
}

function pointIsInsideSegment(segment: RoofSegmentNode, point: readonly [number, number]): boolean {
  if (segment.roofType === 'conical') {
    return Math.hypot(point[0], point[1]) <= segment.width / 2 + FOOTPRINT_EPSILON
  }
  return (
    Math.abs(point[0]) <= segment.width / 2 + FOOTPRINT_EPSILON &&
    Math.abs(point[1]) <= segment.depth / 2 + FOOTPRINT_EPSILON
  )
}

function circleBoundary(center: readonly [number, number], radius: number): [number, number][] {
  if (radius <= FOOTPRINT_EPSILON) return [[center[0], center[1]]]
  return Array.from({ length: CIRCLE_SEGMENTS }, (_, index) => {
    const angle = (index / CIRCLE_SEGMENTS) * Math.PI * 2
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]
  })
}

function circleHeightSamples(
  center: readonly [number, number],
  radius: number,
): [number, number][] {
  const samples = circleBoundary(center, radius)
  if (radius <= FOOTPRINT_EPSILON) return samples
  for (let zIndex = 0; zIndex <= HEIGHT_GRID_STEPS; zIndex += 1) {
    const z = -radius + (zIndex / HEIGHT_GRID_STEPS) * radius * 2
    for (let xIndex = 0; xIndex <= HEIGHT_GRID_STEPS; xIndex += 1) {
      const x = -radius + (xIndex / HEIGHT_GRID_STEPS) * radius * 2
      if (x * x + z * z > radius * radius + FOOTPRINT_EPSILON) continue
      samples.push([center[0] + x, center[1] + z])
    }
  }
  return samples
}

function findRoofCandidate(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: LevelNode['id'],
  center: readonly [number, number],
  radius: number,
): RoofCandidate | null {
  const boundary = circleBoundary(center, radius)
  const heightSamples = circleHeightSamples(center, radius)
  let best: RoofCandidate | null = null

  for (const node of Object.values(nodes)) {
    if (node.type !== 'roof' || node.parentId !== levelId) continue
    const roof = node
    for (const segmentId of roof.children ?? []) {
      const child = nodes[segmentId]
      if (child?.type !== 'roof-segment') continue
      const segment = child
      if (
        !boundary.every((point) =>
          pointIsInsideSegment(segment, worldToSegmentPlan(roof, segment, point)),
        )
      ) {
        continue
      }

      let minSurfaceY = Number.POSITIVE_INFINITY
      let maxSurfaceY = Number.NEGATIVE_INFINITY
      for (const point of heightSamples) {
        const local = worldToSegmentPlan(roof, segment, point)
        const surfaceY =
          roof.position[1] +
          segment.position[1] +
          getRoofSegmentSurfaceY(segment, local[0], local[1])
        minSurfaceY = Math.min(minSurfaceY, surfaceY)
        maxSurfaceY = Math.max(maxSurfaceY, surfaceY)
      }

      if (!(Number.isFinite(minSurfaceY) && Number.isFinite(maxSurfaceY))) continue
      if (best && best.maxSurfaceY >= maxSurfaceY) continue
      best = {
        roof,
        segment,
        localCenter: worldToSegmentPlan(roof, segment, center),
        minSurfaceY,
        maxSurfaceY,
      }
    }
  }

  return best
}

function levelPlacement(
  center: readonly [number, number],
  curbHeight: number,
): ConicalRoofLevelPlacement {
  return {
    valid: true,
    kind: 'level',
    position: [center[0], 0, center[1]],
    wallHeight: Math.max(0, curbHeight),
    support: { kind: 'level' },
  }
}

export function resolveConicalRoofPlacement({
  nodes,
  levelId,
  center,
  radius,
  curbHeight,
  mode,
}: ResolveConicalRoofPlacementInput): ConicalRoofPlacement {
  if (mode === 'ground') return levelPlacement(center, curbHeight)

  const candidate = findRoofCandidate(nodes, levelId, center, Math.max(0, radius))
  if (!candidate) {
    return mode === 'roof'
      ? { valid: false, reason: 'no-roof-support' }
      : levelPlacement(center, curbHeight)
  }

  const safeCurbHeight = Math.max(0, curbHeight)
  const baseY = candidate.minSurfaceY - CUTTER_SEAT_DEPTH
  return {
    valid: true,
    kind: 'roof',
    position: [center[0], baseY, center[1]],
    wallHeight: candidate.maxSurfaceY - baseY + safeCurbHeight,
    hostRoofId: candidate.roof.id,
    support: {
      kind: 'roof',
      roofSegmentId: candidate.segment.id,
      localPosition: candidate.localCenter,
      curbHeight: safeCurbHeight,
    },
  }
}
