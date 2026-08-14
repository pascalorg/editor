import type { FenceNode, WallNode } from '@pascal-app/core'
import type { FencePlanPoint } from '@pascal-app/editor'
import { type JunctionAngleSegment, pickJunctionAngleLabel } from '../shared/junction-angle'

/**
 * Beam-specific angle-pill picker — a thin wrapper over the shared
 * `pickJunctionAngleLabel` so the beam's 3D endpoint drag and 2D floor-plan
 * labels share one implementation with the wall surface.
 */

export type BeamAngleSegment = JunctionAngleSegment

export function referenceSegments(walls: WallNode[], fences: FenceNode[]): BeamAngleSegment[] {
  return [
    ...walls.map((w) => ({ id: w.id, start: w.start, end: w.end, curveOffset: w.curveOffset })),
    ...fences.map((f) => ({ id: f.id, start: f.start, end: f.end, curveOffset: f.curveOffset })),
  ]
}

export function pickBeamAngleLabel(args: {
  start: FencePlanPoint
  end: FencePlanPoint
  segments: BeamAngleSegment[]
}): { label: string; position: [number, number, number] } | null {
  return pickJunctionAngleLabel({
    targetId: 'beam',
    start: args.start,
    end: args.end,
    segments: args.segments,
  })
}
