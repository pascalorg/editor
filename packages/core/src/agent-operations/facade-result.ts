import type { FacadeFillPlan } from '../building/facade'
import type { Achieved } from './achieved'
import type { facadeTargetsFor } from './facade-targets'

type Targets = ReturnType<typeof facadeTargetsFor>

/**
 * What apply_facade answers, on every surface: what the fill planned on each floor, the walls left
 * out of it, and what the scene holds after (`achieved`). Each host adds its drawing of the result.
 */
export function facadeAppliedResult(input: {
  plans: FacadeFillPlan[]
  leftOut: NonNullable<Targets['leftOut']>
  curved: NonNullable<Targets['curved']>
  achieved: Achieved
}) {
  const sum = (count: (plan: FacadeFillPlan) => number) =>
    input.plans.reduce((total, plan) => total + count(plan), 0)
  const unlitRooms = [...new Set(input.plans.flatMap((plan) => plan.unlitRooms ?? []))]
  return {
    status: 'applied' as const,
    levels: input.plans.length,
    walls: sum((plan) => plan.walls.length),
    runs: sum((plan) => plan.runs.length),
    replaced: sum((plan) => plan.displaced.length),
    skipped: sum((plan) => plan.skipped),
    // Loop walls that run past a corner of the loop: left out, to split at the junction.
    ...(input.leftOut.length ? { leftOut: input.leftOut } : {}),
    // Arcs of the loop: left out, a facade goes on straight walls only.
    ...(input.curved.length ? { curved: input.curved } : {}),
    // With obstacles 'room': the habitable rooms no window fits.
    ...(unlitRooms.length ? { unlitRooms } : {}),
    achieved: input.achieved,
  }
}
