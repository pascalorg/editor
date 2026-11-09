import type { AnyNodeId } from '@pascal-app/core'

export type RunPoint = [number, number, number]

export type RunWallSide = 'front' | 'back'

export type RunSurfaceFrame = {
  origin: RunPoint
  normal: RunPoint
  tangent: RunPoint
  bitangent: RunPoint
}

export type RunSurfaceBounds = {
  minU: number
  maxU: number
  minV: number
  maxV: number
}

export type RunWallAttachment = {
  wallId: Extract<AnyNodeId, `wall_${string}`>
  side: RunWallSide
  startUV: [number, number]
  endUV: [number, number]
  offset: number
}

/**
 * The surface selected for the current run. A wall target is semantic: the
 * host id and side are required so later snapping cannot fall back to any
 * other object that happens to be close in the viewport.
 */
export type RunSurfaceTarget =
  | {
      kind: 'floor' | 'ceiling' | 'surface'
      hostId?: AnyNodeId
      levelId: AnyNodeId
      frame: RunSurfaceFrame
    }
  | {
      kind: 'wall'
      levelId: AnyNodeId
      hostId: AnyNodeId
      side: RunWallSide
      frame: RunSurfaceFrame
      bounds: RunSurfaceBounds
    }

/** Move a run centerline clear of a wall face along the captured normal. */
export function offsetRunPointFromSurface(
  point: RunPoint,
  target: RunSurfaceTarget | null,
  offset: number,
): RunPoint {
  if (!target || offset === 0) return [...point]
  return [
    point[0] + target.frame.normal[0] * offset,
    point[1] + target.frame.normal[1] * offset,
    point[2] + target.frame.normal[2] * offset,
  ]
}

export function runPointToSurfaceUV(
  point: RunPoint,
  target: Extract<RunSurfaceTarget, { kind: 'wall' }>,
): [number, number] {
  const dx = point[0] - target.frame.origin[0]
  const dy = point[1] - target.frame.origin[1]
  const dz = point[2] - target.frame.origin[2]
  return [
    dx * target.frame.tangent[0] + dy * target.frame.tangent[1] + dz * target.frame.tangent[2],
    dx * target.frame.bitangent[0] +
      dy * target.frame.bitangent[1] +
      dz * target.frame.bitangent[2],
  ]
}

export function createRunWallAttachment(
  wallId: Extract<AnyNodeId, `wall_${string}`>,
  side: RunWallSide,
  start: RunPoint,
  end: RunPoint,
  target: Extract<RunSurfaceTarget, { kind: 'wall' }>,
  offset: number,
): RunWallAttachment {
  return {
    wallId,
    side,
    startUV: runPointToSurfaceUV(start, target),
    endUV: runPointToSurfaceUV(end, target),
    offset,
  }
}
