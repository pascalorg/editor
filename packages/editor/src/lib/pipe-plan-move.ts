import type { PipeNode } from '@pascal-app/core'
import {
  applySegmentEndpointPreview,
  computeSegmentDragEndpoints,
  getLinkedSegmentSnapshots,
  getLinkedSegmentUpdates,
  getSegmentPlanMidpoint,
  type SegmentEndpointSnapshot,
} from './segment-plan-move'

export type LinkedPipeSnapshot = SegmentEndpointSnapshot

export const getPipePlanMidpoint = getSegmentPlanMidpoint
export const computePipeDragEndpoints = computeSegmentDragEndpoints
export const getLinkedPipeUpdates = getLinkedSegmentUpdates

export function getLinkedPipeSnapshots(args: {
  pipeId: PipeNode['id']
  pipeParentId: string | null
  originalStart: [number, number]
  originalEnd: [number, number]
}) {
  return getLinkedSegmentSnapshots({
    segmentId: args.pipeId,
    segmentParentId: args.pipeParentId,
    segmentType: 'pipe',
    originalStart: args.originalStart,
    originalEnd: args.originalEnd,
  })
}

export function applyPipeEndpointPreview(
  pipeId: PipeNode['id'],
  linkedPipes: SegmentEndpointSnapshot[],
  originalStart: [number, number],
  originalEnd: [number, number],
  nextStart: [number, number],
  nextEnd: [number, number],
) {
  applySegmentEndpointPreview(
    pipeId,
    linkedPipes,
    originalStart,
    originalEnd,
    nextStart,
    nextEnd,
  )
}
