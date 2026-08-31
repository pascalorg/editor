import { type AnyNode, pointInPolygon2D, type ZoneNode } from '@pascal-app/core'
import type { LocalSurfaceHit } from './surface-query'

function polygonArea(polygon: ReadonlyArray<readonly [number, number]>) {
  let area = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area) * 0.5
}

export function resolveSmartMeasurementSurfaceHit(
  hit: LocalSurfaceHit,
  nodes: Readonly<Record<string, AnyNode | undefined>>,
  levelId: string,
): LocalSurfaceHit {
  const target = hit.targetNodeId ? nodes[hit.targetNodeId] : undefined
  if (target?.type !== 'slab' || Math.abs(hit.normal[1]) < 0.75) return hit

  const zone = Object.values(nodes)
    .filter(
      (node): node is ZoneNode =>
        node?.type === 'zone' &&
        node.parentId === levelId &&
        pointInPolygon2D([hit.point[0], hit.point[2]], node.polygon),
    )
    .sort((left, right) => polygonArea(left!.polygon) - polygonArea(right!.polygon))[0]

  return zone ? { ...hit, targetNodeId: zone.id } : hit
}
