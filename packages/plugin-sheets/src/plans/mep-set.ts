/**
 * MEP sheets: E1.0 electrical (devices, circuits, panel schedule, legend,
 * notes) and P1.0 plumbing — through the `electrical` / `plumbing` viewport
 * kinds (providers/electrical.ts, providers/plumbing.ts).
 *
 * OWNER: MEP workstream. Returns [] until it lands; `generate.ts` then keeps
 * its generic E1.0 fallback.
 */
import type { Plan, PlanSetContext } from './context'

export function mepPlans(_ctx: PlanSetContext): Plan[] {
  return []
}
