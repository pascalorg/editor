/**
 * Structural sheets (S-series): foundation, floor framing, roof framing and
 * the structural notes sheet — drawn from the Bones engines through the
 * `structural` viewport kind (providers/structural.ts).
 *
 * OWNER: structural workstream. Returns [] until it lands; `generate.ts` then
 * keeps its generic S1.0 foundation-plan fallback.
 */
import type { Plan, PlanSetContext } from './context'

export function structuralPlans(_ctx: PlanSetContext): Plan[] {
  return []
}
