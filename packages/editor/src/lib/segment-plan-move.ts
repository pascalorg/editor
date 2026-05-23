import { getWallCurveFrameAt, type AnyNodeId, useScene } from '@pascal-app/core'

export type SegmentEndpointSnapshot = {
  id: string
  start: [number, number]
  end: [number, number]
}

function samePoint(a: [number, number], b: [number, number]) {
  return a[0] === b[0] && a[1] === b[1]
}

export function getSegmentPlanMidpoint(segment: {
  start: [number, number]
  end: [number, number]
  curveOffset?: number
}) {
  const frame = getWallCurveFrameAt(segment, 0.5)
  return [frame.point.x, frame.point.y] as [number, number]
}

export function getLinkedSegmentSnapshots(args: {
  segmentId: string
  segmentParentId: string | null
  segmentType: string
  originalStart: [number, number]
  originalEnd: [number, number]
}): SegmentEndpointSnapshot[] {
  const { segmentId, segmentParentId, segmentType, originalStart, originalEnd } = args
  const { nodes } = useScene.getState()
  const snapshots: SegmentEndpointSnapshot[] = []
  for (const node of Object.values(nodes)) {
    if (!(node?.type === segmentType && node.id !== segmentId)) continue
    if ((node.parentId ?? null) !== segmentParentId) continue
    const start = (node as { start: [number, number] }).start
    const end = (node as { end: [number, number] }).end
    if (
      !(
        samePoint(start, originalStart) ||
        samePoint(start, originalEnd) ||
        samePoint(end, originalStart) ||
        samePoint(end, originalEnd)
      )
    )
      continue
    snapshots.push({
      id: node.id,
      start: [...start],
      end: [...end],
    })
  }
  return snapshots
}

export function getLinkedSegmentUpdates(
  linkedSegments: SegmentEndpointSnapshot[],
  originalStart: [number, number],
  originalEnd: [number, number],
  nextStart: [number, number],
  nextEnd: [number, number],
) {
  return linkedSegments.map((segment) => ({
    id: segment.id,
    start: samePoint(segment.start, originalStart)
      ? nextStart
      : samePoint(segment.start, originalEnd)
        ? nextEnd
        : segment.start,
    end: samePoint(segment.end, originalStart)
      ? nextStart
      : samePoint(segment.end, originalEnd)
        ? nextEnd
        : segment.end,
  }))
}

/** Free plan X/Z translation — start and end shift by the same delta. */
export function computeSegmentDragEndpoints(args: {
  originalStart: [number, number]
  originalEnd: [number, number]
  dragAnchor: [number, number]
  cursorPlan: [number, number]
}) {
  const { originalStart, originalEnd, dragAnchor, cursorPlan } = args
  const deltaX = cursorPlan[0] - dragAnchor[0]
  const deltaZ = cursorPlan[1] - dragAnchor[1]
  return {
    start: [originalStart[0] + deltaX, originalStart[1] + deltaZ] as [number, number],
    end: [originalEnd[0] + deltaX, originalEnd[1] + deltaZ] as [number, number],
  }
}

export function applySegmentEndpointPreview(
  segmentId: string,
  linkedSegments: SegmentEndpointSnapshot[],
  originalStart: [number, number],
  originalEnd: [number, number],
  nextStart: [number, number],
  nextEnd: [number, number],
) {
  const updates = [
    { id: segmentId, start: nextStart, end: nextEnd },
    ...getLinkedSegmentUpdates(linkedSegments, originalStart, originalEnd, nextStart, nextEnd),
  ]
  useScene.getState().updateNodes(
    updates.map((entry) => ({
      id: entry.id as AnyNodeId,
      data: { start: entry.start, end: entry.end },
    })),
  )
  for (const entry of updates) {
    useScene.getState().markDirty(entry.id as AnyNodeId)
  }
}
