import type { AnyNode, StairNode } from '../../schema'
import { StairSegmentNode } from '../../schema'
import { resolveStairTotalRise } from './stair-rise'

const MIN_STAIR_FLIGHT_RISE = 0.1
const MIN_STAIR_FLIGHT_STEP_COUNT = 2

export type StairFlightOverrides = Partial<
  Pick<
    StairSegmentNode,
    'width' | 'length' | 'height' | 'stepCount' | 'attachmentSide' | 'fillToFloor' | 'thickness'
  >
>

/**
 * The single definition of a default straight flight. Anything left out falls
 * through to the `StairSegmentNode` schema defaults (length 3 m, 10 steps,
 * filled to floor) rather than being spelled again per call site, so the stair
 * tool's seed segment, the flight the panel materializes when a curved stair
 * becomes straight, and the viewer's fallback body all describe one stair.
 */
export function createDefaultStairSegment(overrides: StairFlightOverrides = {}): StairSegmentNode {
  return StairSegmentNode.parse({ segmentType: 'stair', position: [0, 0, 0], ...overrides })
}

/**
 * The flight a straight stair implies from its own fields — used wherever a
 * straight stair has to stand in for missing `stair-segment` children.
 */
export function createStairFlightFromStair(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
): StairSegmentNode {
  return createDefaultStairSegment({
    width: stair.width,
    height: Math.max(resolveStairTotalRise(stair, nodes), MIN_STAIR_FLIGHT_RISE),
    stepCount: Math.max(MIN_STAIR_FLIGHT_STEP_COUNT, Math.round(stair.stepCount ?? 10)),
    thickness: stair.thickness,
    fillToFloor: stair.fillToFloor,
  })
}
