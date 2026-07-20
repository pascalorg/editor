import type { AnyNode, AnyNodeId, ConstructionNoteNode, FloorplanPoint } from '@pascal-app/core'

export type ResolvedConstructionNoteAnchor = {
  point: FloorplanPoint
  dangling: boolean
}

export function constructionNoteTargetPoint(
  target: AnyNode,
  resolve: (id: AnyNodeId) => AnyNode | undefined,
): FloorplanPoint | null {
  if (target.type === 'wall') {
    return [(target.start[0] + target.end[0]) / 2, (target.start[1] + target.end[1]) / 2]
  }

  if (target.type === 'door' || target.type === 'window') {
    const wallId = target.wallId ?? target.parentId
    const wall = wallId ? resolve(wallId as AnyNodeId) : undefined
    if (wall?.type === 'wall') {
      const dx = wall.end[0] - wall.start[0]
      const dz = wall.end[1] - wall.start[1]
      const length = Math.hypot(dx, dz)
      if (length > 1e-9) {
        const along = Math.min(length, Math.max(0, target.position[0]))
        return [wall.start[0] + (dx / length) * along, wall.start[1] + (dz / length) * along]
      }
    }
  }

  const positioned = target as AnyNode & { position?: unknown }
  if (
    Array.isArray(positioned.position) &&
    positioned.position.length >= 3 &&
    positioned.position.every((value) => typeof value === 'number')
  ) {
    return [positioned.position[0] as number, positioned.position[2] as number]
  }

  const polygonal = target as AnyNode & { polygon?: unknown }
  if (Array.isArray(polygonal.polygon) && polygonal.polygon.length > 0) {
    const points = polygonal.polygon.filter(
      (point): point is [number, number] =>
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === 'number' &&
        typeof point[1] === 'number',
    )
    if (points.length > 0) {
      return [
        points.reduce((sum, point) => sum + point[0], 0) / points.length,
        points.reduce((sum, point) => sum + point[1], 0) / points.length,
      ]
    }
  }

  const segment = target as AnyNode & { start?: unknown; end?: unknown }
  if (isPlanPoint(segment.start) && isPlanPoint(segment.end)) {
    return [(segment.start[0] + segment.end[0]) / 2, (segment.start[1] + segment.end[1]) / 2]
  }

  return null
}

export function resolveConstructionNoteAnchor(
  note: Pick<ConstructionNoteNode, 'anchor' | 'targetId' | 'targetOffset'>,
  resolve: (id: AnyNodeId) => AnyNode | undefined,
): ResolvedConstructionNoteAnchor {
  if (!note.targetId) return { point: note.anchor, dangling: false }
  const target = resolve(note.targetId as AnyNodeId)
  const targetPoint = target ? constructionNoteTargetPoint(target, resolve) : null
  if (!targetPoint) return { point: note.anchor, dangling: true }
  return {
    point: [targetPoint[0] + note.targetOffset[0], targetPoint[1] + note.targetOffset[1]],
    dangling: false,
  }
}

function isPlanPoint(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  )
}
