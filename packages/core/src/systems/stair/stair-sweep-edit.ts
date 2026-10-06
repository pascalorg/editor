import type { StairNode } from '../../schema'

/** Keep the opposite arrival/entry edge fixed, and preserve winding at the zero-sweep limit. */
export function planStairSweepEdit(
  stair: Pick<StairNode, 'sweepAngle' | 'rotation'>,
  delta: number,
  end: 'start' | 'end',
) {
  const sign = Math.sign(stair.sweepAngle) || 1
  const target = stair.sweepAngle + (end === 'end' ? delta : -delta)
  const sweepAngle = sign * Math.max(0.0001, sign * target)
  const change = sweepAngle - stair.sweepAngle
  return { sweepAngle, rotation: stair.rotation + (end === 'end' ? -change / 2 : change / 2) }
}
