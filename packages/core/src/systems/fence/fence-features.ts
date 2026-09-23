import type { z } from 'zod'
import type { AnyNode, FenceFeatureNode, FenceNode } from '../../schema'
import type { FenceFeature } from '../../schema/nodes/fence'
import {
  getFenceCenterlineFrameAt,
  getFenceCenterlineLength,
  sampleFenceCenterline,
} from './fence-centerline'

export type FenceFeatureData = z.infer<typeof FenceFeature>
export type FenceWithFeatures = FenceNode & { features?: FenceFeatureData[] }
export type ResolvedFenceFeature = FenceFeatureData & {
  startT: number
  endT: number
  centerT: number
}

export function canPlaceFenceFeature(fence: FenceWithFeatures, feature: FenceFeatureData): boolean {
  const length = getFenceCenterlineLength(fence)
  const margin = Math.max(fence.postSize / 2, 0.04)
  const start = feature.center - feature.width / 2
  const end = feature.center + feature.width / 2
  const gap = Math.max(fence.postSize, 0.05)
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    feature.width >= 0.35 &&
    start >= margin &&
    end <= length - margin &&
    !(fence.features ?? []).some(
      (other) =>
        other.id !== feature.id &&
        start < other.center + other.width / 2 + gap &&
        end > other.center - other.width / 2 - gap,
    )
  )
}

export function resolveFenceFeatures(fence: FenceWithFeatures): ResolvedFenceFeature[] {
  const length = getFenceCenterlineLength(fence)
  if (length < 0.35) return []
  return [...(fence.features ?? [])]
    .sort((a, b) => a.center - b.center)
    .filter((feature) => canPlaceFenceFeature(fence, feature))
    .map((feature) => ({
      ...feature,
      startT: (feature.center - feature.width / 2) / length,
      endT: (feature.center + feature.width / 2) / length,
      centerT: feature.center / length,
    }))
}

export function projectPointToFence(fence: FenceNode, point: readonly [number, number]) {
  const points = sampleFenceCenterline(fence)
  let traversed = 0
  let distance = Infinity
  let center = 0
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!
    const b = points[index]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (length < 1e-8) continue
    const t = Math.max(
      0,
      Math.min(1, ((point[0] - a.x) * dx + (point[1] - a.y) * dy) / (length * length)),
    )
    const nextDistance = Math.hypot(point[0] - a.x - dx * t, point[1] - a.y - dy * t)
    if (nextDistance < distance) {
      distance = nextDistance
      center = traversed + length * t
    }
    traversed += length
  }
  return { center, distance }
}

export function getFenceGateLeaves(fence: FenceNode, feature: ResolvedFenceFeature) {
  const a = getFenceCenterlineFrameAt(fence, feature.startT).point
  const b = getFenceCenterlineFrameAt(fence, feature.endT).point
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const ux = (b.x - a.x) / Math.max(length, 1e-6)
  const uz = (b.y - a.y) / Math.max(length, 1e-6)
  const gap = Math.min(Math.max(fence.postSize / 2 + 0.025, 0.06), length * 0.15)
  const usable = Math.max(0.05, length - 2 * gap)
  const double = feature.leafType === 'double'
  const split = feature.leafSplit ?? 0.5
  const angle =
    (((feature.openAngle ?? 0) * Math.PI) / 180) * (feature.swing === 'outward' ? -1 : 1)
  return (double ? (['left', 'right'] as const) : [feature.hinge ?? 'left']).map((side) => {
    const sign = side === 'left' ? 1 : -1
    const hinge =
      side === 'left'
        ? { x: a.x + ux * gap, y: a.y + uz * gap }
        : { x: b.x - ux * gap, y: b.y - uz * gap }
    const width = double
      ? Math.max(0.025, usable * (side === 'left' ? split : 1 - split) - 0.015)
      : usable
    const closedAngle = Math.atan2(uz * sign, ux * sign)
    const rotation = closedAngle + angle * sign
    return {
      hinge,
      width,
      rotation,
      closedAngle,
      end: { x: hinge.x + Math.cos(rotation) * width, y: hinge.y + Math.sin(rotation) * width },
    }
  })
}

export function isFenceFeatureNode(node: AnyNode | undefined): node is FenceFeatureNode {
  return node?.type === 'fence-gate' || node?.type === 'fence-opening'
}

export function fenceFeatureData(node: FenceFeatureNode): FenceFeatureData {
  return { ...node, kind: node.type === 'fence-gate' ? 'gate' : 'opening' }
}

export function fenceWithFeatures(
  fence: FenceWithFeatures,
  children: readonly (AnyNode | undefined)[],
): FenceWithFeatures {
  return {
    ...fence,
    features: [
      ...children
        .filter(isFenceFeatureNode)
        .filter((n) => n.visible !== false)
        .map(fenceFeatureData),
      ...(fence.features ?? []),
    ],
  }
}
