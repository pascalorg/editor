export const FITTING_CLEARANCE_MESSAGE =
  'Not enough room for this fitting. Lengthen the run or move the connection.'

type Point = readonly [number, number, number]

export function hasFittingClearance(
  start: Point,
  end: Point,
  direction: Point,
  minimum: number,
): boolean {
  const length = Math.hypot(...direction)
  if (length < 1e-9) return false
  const remaining =
    ((end[0] - start[0]) * direction[0] +
      (end[1] - start[1]) * direction[1] +
      (end[2] - start[2]) * direction[2]) /
    length
  return remaining >= minimum
}
