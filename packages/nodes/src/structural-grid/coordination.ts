import type { AnyNode, StructuralGridNode } from '@pascal-app/core'

export type StructuralGridPoint = readonly [x: number, z: number]

export type StructuralGridSnap = {
  point: [number, number]
  distance: number
  kind: 'intersection' | 'line'
  axes: StructuralGridNode[]
  reference: string
}

export const STRUCTURAL_GRID_SNAP_DISTANCE_M = 0.25
export const STRUCTURAL_GRID_REFERENCE_TOLERANCE_M = 0.02

const EPSILON = 1e-9

export function collectStructuralGridAxes(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string | null | undefined,
): StructuralGridNode[] {
  if (!levelId) return []
  return Object.values(nodes).filter(
    (node): node is StructuralGridNode =>
      node.type === 'structural-grid' && node.parentId === levelId && node.visible !== false,
  )
}

export function formatStructuralGridReference(axes: readonly StructuralGridNode[]): string {
  const labels = [...new Set(axes.map((axis) => axis.label.trim()).filter(Boolean))]
  labels.sort((left, right) => {
    const leftFamily = structuralGridLabelSortFamily(left)
    const rightFamily = structuralGridLabelSortFamily(right)
    if (leftFamily !== rightFamily) return leftFamily - rightFamily
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
  })
  return labels.join('-')
}

export function resolveStructuralGridSnap(
  point: StructuralGridPoint,
  axes: readonly StructuralGridNode[],
  maxDistance = STRUCTURAL_GRID_SNAP_DISTANCE_M,
): StructuralGridSnap | null {
  let nearestIntersection: StructuralGridSnap | null = null

  for (let firstIndex = 0; firstIndex < axes.length; firstIndex += 1) {
    const first = axes[firstIndex]
    if (!first) continue
    for (let secondIndex = firstIndex + 1; secondIndex < axes.length; secondIndex += 1) {
      const second = axes[secondIndex]
      if (!second) continue
      const intersection = segmentIntersection(first.start, first.end, second.start, second.end)
      if (!intersection) continue
      const distance = pointDistance(point, intersection)
      if (
        distance > maxDistance ||
        (nearestIntersection && distance >= nearestIntersection.distance)
      ) {
        continue
      }
      nearestIntersection = {
        point: intersection,
        distance,
        kind: 'intersection',
        axes: [first, second],
        reference: formatStructuralGridReference([first, second]),
      }
    }
  }

  if (nearestIntersection) return nearestIntersection

  let nearestLine: StructuralGridSnap | null = null
  for (const axis of axes) {
    const projected = closestPointOnSegment(point, axis.start, axis.end)
    const distance = pointDistance(point, projected)
    if (distance > maxDistance || (nearestLine && distance >= nearestLine.distance)) continue
    nearestLine = {
      point: projected,
      distance,
      kind: 'line',
      axes: [axis],
      reference: formatStructuralGridReference([axis]),
    }
  }
  return nearestLine
}

export function resolveStructuralGridReference(
  point: StructuralGridPoint,
  axes: readonly StructuralGridNode[],
  tolerance = STRUCTURAL_GRID_REFERENCE_TOLERANCE_M,
): string | null {
  const matching = axes.filter(
    (axis) => pointDistance(point, closestPointOnSegment(point, axis.start, axis.end)) <= tolerance,
  )
  const reference = formatStructuralGridReference(matching)
  return reference || null
}

function structuralGridLabelSortFamily(label: string): number {
  if (/^[A-Za-z]+$/.test(label)) return 0
  if (/^\d+$/.test(label)) return 1
  return 2
}

function pointDistance(first: StructuralGridPoint, second: StructuralGridPoint): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1])
}

function closestPointOnSegment(
  point: StructuralGridPoint,
  start: StructuralGridPoint,
  end: StructuralGridPoint,
): [number, number] {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= EPSILON) return [start[0], start[1]]
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared),
  )
  return [start[0] + dx * t, start[1] + dz * t]
}

function segmentIntersection(
  firstStart: StructuralGridPoint,
  firstEnd: StructuralGridPoint,
  secondStart: StructuralGridPoint,
  secondEnd: StructuralGridPoint,
): [number, number] | null {
  const firstDx = firstEnd[0] - firstStart[0]
  const firstDz = firstEnd[1] - firstStart[1]
  const secondDx = secondEnd[0] - secondStart[0]
  const secondDz = secondEnd[1] - secondStart[1]
  const denominator = firstDx * secondDz - firstDz * secondDx
  if (Math.abs(denominator) <= EPSILON) return null

  const offsetX = secondStart[0] - firstStart[0]
  const offsetZ = secondStart[1] - firstStart[1]
  const firstT = (offsetX * secondDz - offsetZ * secondDx) / denominator
  const secondT = (offsetX * firstDz - offsetZ * firstDx) / denominator
  if (firstT < -EPSILON || firstT > 1 + EPSILON || secondT < -EPSILON || secondT > 1 + EPSILON) {
    return null
  }
  return [firstStart[0] + firstDx * firstT, firstStart[1] + firstDz * firstT]
}
