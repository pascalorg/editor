import { STAIR_CODE, type StairNode, StairStructure } from '@pascal-app/core'

/** A railing mode picked for the stair tool, or null when none (or an unknown one) is. */
export function pickedStairRailingMode(value: unknown): StairNode['railingMode'] | null {
  return value === 'none' || value === 'left' || value === 'right' || value === 'both'
    ? value
    : null
}

/**
 * The railing a flight fitted to a deck, porch or patio edge takes: both sides once it has four
 * risers (the IRC R311.7.8 handrail) or its open side drops more than 30 in (the R312.1.1 guard),
 * none on a shorter step. A railing mode picked for the tool still wins.
 */
export function surfaceFlightRailingMode(
  flight: { stepCount: number; totalRise: number },
  picked: StairNode['railingMode'] | null = null,
): StairNode['railingMode'] {
  if (picked) return picked
  return flight.stepCount >= STAIR_CODE.handrailRisers || flight.totalRise > STAIR_CODE.guardDrop
    ? 'both'
    : 'none'
}

/**
 * The structure a new stair is built with: the tool's when one is set, else standard wood
 * stringers — 2x12 cut stringers at 16 in o.c. at most (IRC R311.7, DCA 6).
 */
export function newStairStructure(picked?: unknown): StairStructure {
  const parsed = picked === undefined ? null : StairStructure.safeParse(picked)
  return parsed?.success ? parsed.data : StairStructure.parse({})
}
