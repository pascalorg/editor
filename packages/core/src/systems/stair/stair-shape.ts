import type { AttachmentSide, StairSegmentType } from '../../schema'

/**
 * Placement shapes the stair tool can lay down.
 *
 * These are NOT `StairNode.stairType` values — every one of them is a
 * `'straight'` (segment-chained) stair. The shape only decides which
 * `stair-segment` chain the tool creates, because `attachmentSide` turns the
 * chain ±90° per segment: an L needs one landing, a U needs two (there is no
 * 180° attachment). Nothing about the shape is persisted; once placed, the
 * stair is an ordinary segment chain the segment panel can retune.
 */
export type StairShape = 'straight' | 'l-shaped' | 'u-shaped'

export type StairShapeSegmentSpec = {
  segmentType: StairSegmentType
  width: number
  length: number
  height: number
  stepCount: number
  attachmentSide: AttachmentSide
}

export type StairShapeParams = {
  /** Width of every flight and landing in the chain. */
  width: number
  /** Total horizontal run across the flights — landings are extra. */
  length: number
  /** Total rise across the flights. */
  height: number
  /** Total step count across the flights. */
  stepCount: number
  /** Which way the chain turns at each landing. */
  turn?: Extract<AttachmentSide, 'left' | 'right'>
}

/** Landings are square (width × width) so both the flight arriving on one edge
 * and the flight leaving the adjacent edge meet a full-width landing side. A
 * turn attaches the next segment at the midpoint of the previous segment's
 * side, so `landing.length` has to equal the following flight's `width`. */
function landingSpec(width: number, attachmentSide: AttachmentSide): StairShapeSegmentSpec {
  return {
    segmentType: 'landing',
    width,
    length: width,
    height: 0,
    stepCount: 0,
    attachmentSide,
  }
}

/**
 * The `stair-segment` chain for a placement shape.
 *
 * Flights split the total rise, run and step count so the riser and tread
 * stay identical to the straight stair of the same parameters — an L or U of
 * 10 steps climbs the same 2.5 m in two flights of 5.
 */
export function stairShapeSegmentSpecs(
  shape: StairShape,
  params: StairShapeParams,
): StairShapeSegmentSpec[] {
  const { width, length, height, stepCount } = params
  const turn = params.turn ?? 'left'

  if (shape === 'straight') {
    return [
      {
        segmentType: 'stair',
        width,
        length,
        height,
        stepCount,
        attachmentSide: 'front',
      },
    ]
  }

  const totalSteps = Math.max(2, Math.round(stepCount))
  const lowerSteps = Math.ceil(totalSteps / 2)
  const upperSteps = totalSteps - lowerSteps
  const flight = (steps: number, attachmentSide: AttachmentSide): StairShapeSegmentSpec => ({
    segmentType: 'stair',
    width,
    length: (length * steps) / totalSteps,
    height: (height * steps) / totalSteps,
    stepCount: steps,
    attachmentSide,
  })

  // L: one landing carries the single 90° turn, which the upper flight makes.
  // U: two landings sit side by side, each contributing 90°, so the upper
  // flight comes back alongside the lower one.
  return shape === 'l-shaped'
    ? [flight(lowerSteps, 'front'), landingSpec(width, 'front'), flight(upperSteps, turn)]
    : [
        flight(lowerSteps, 'front'),
        landingSpec(width, 'front'),
        landingSpec(width, turn),
        flight(upperSteps, turn),
      ]
}
