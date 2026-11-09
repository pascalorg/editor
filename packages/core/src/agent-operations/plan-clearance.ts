import type { PlanAabb } from './door-clearance'

/** The direction of a move in the plan, along the scene's x or z axis. */
export type ClearDirection = '+x' | '-x' | '+z' | '-z'

export type ClearMove = { direction: ClearDirection; distanceM: number }

const MM_PER_M = 1000

/** A length in metres, to the millimetre. */
export const roundMm = (value: number) => Math.round(value * MM_PER_M) / MM_PER_M

/** A length as the findings say it, to the millimetre. */
export const metres = (value: number) => value.toFixed(3)

/** Moves as the findings say them: "0.295 m toward -x or 0.620 m toward -z". */
export const describeMoves = (moves: readonly ClearMove[]) =>
  moves.map((move) => `${metres(move.distanceM)} m toward ${move.direction}`).join(' or ')

export const roundBox = (box: PlanAabb): PlanAabb => ({
  minX: roundMm(box.minX),
  maxX: roundMm(box.maxX),
  minZ: roundMm(box.minZ),
  maxZ: roundMm(box.maxZ),
})

/** Up to the millimetre, so a move of the stated length clears; the sliver below is float noise. */
const ceilMm = (value: number) => Math.ceil(value * MM_PER_M - 1e-9) / MM_PER_M

/**
 * How far two boxes share each plan axis: the length of the shared stretch, or minus the gap where
 * they are apart along it.
 */
export function axisOverlap(a: PlanAabb, b: PlanAabb): { x: number; z: number } {
  return {
    x: Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX),
    z: Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ),
  }
}

/**
 * The moves of `a` that leave `margin` between it and `b`: the nearer way out on each axis, away
 * from the other box's middle, shortest first. A box already clear by the margin has none.
 */
export function clearingMoves(a: PlanAabb, b: PlanAabb, margin: number): ClearMove[] {
  const awayX = a.minX + a.maxX >= b.minX + b.maxX
  const awayZ = a.minZ + a.maxZ >= b.minZ + b.maxZ
  const moves: ClearMove[] = [
    {
      direction: awayX ? '+x' : '-x',
      distanceM: awayX ? margin + b.maxX - a.minX : margin + a.maxX - b.minX,
    },
    {
      direction: awayZ ? '+z' : '-z',
      distanceM: awayZ ? margin + b.maxZ - a.minZ : margin + a.maxZ - b.minZ,
    },
  ]
  return moves
    .filter((move) => move.distanceM > 0)
    .map((move) => ({ ...move, distanceM: ceilMm(move.distanceM) }))
    .sort((first, second) => first.distanceM - second.distanceM)
}
