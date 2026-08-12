import type { FormworkCraneSettings } from '../../schema/nodes/formwork-project-settings'
import type { GangOptions } from './layout/gangs'

/**
 * Reading a crane's load chart — what the hook takes where the gang actually is.
 *
 * A separate module from `layout/gangs.ts` on purpose. A gang is a fact about a face:
 * these panels, bolted together, weighing this much. What can lift it is a fact about a
 * machine standing somewhere else, and the two meet only at the moment somebody asks
 * "can this crane lift that gang at that radius". Folding the chart into the layout
 * would put the crane's position into a module that has no idea where the wall is on
 * the site, and would make the layout re-run when the crane moved.
 *
 * ## Interpolated, and rounded the safe way
 *
 * A published chart is a table of points and a real crane's capacity falls smoothly
 * between them, so a radius between two rows is read on the straight line joining them.
 * That line sits slightly *above* the real curve, which sags — so where the answer is
 * used for a check, the interpolated figure is the optimistic one and the check is the
 * place to be conservative rather than here. Beyond the last point the chart simply
 * stops: a radius past the jib tip is not a small capacity, it is out of reach, and this
 * says so rather than extrapolating a number down to zero.
 *
 * Inside the first point the chart is flat. Every tower crane's chart has a plateau near
 * the mast where the hoist rope's own rating governs rather than the moment, and reading
 * a rising line inward from the first row would invent capacity the machine has not got.
 */

/** What a crane will take at a radius, and whether the chart actually covers it. */
export interface CraneCapacity {
  /** kg the hook takes there. Absent where the radius is off the end of the chart. */
  capacityKg?: number
  /** Set where the radius is beyond the last point — out of reach, not merely light. */
  outOfReach?: true
  /** Set where the figure sits between two chart points and was read off the line. */
  interpolated?: true
}

/**
 * The chart at a radius.
 *
 * `undefined` for a project with no curve, which is the answer that means no check
 * happened — the same shape `formworkCommitments` and `formworkSetCount` use, and for
 * the same reason: an unstated crane and a crane that lifts nothing must not read alike.
 */
export function craneCapacityAtM(
  crane: FormworkCraneSettings | undefined,
  radiusM: number,
): CraneCapacity | undefined {
  const curve = [...(crane?.capacityCurve ?? [])].sort((a, b) => a.radiusM - b.radiusM)
  const first = curve[0]
  const last = curve[curve.length - 1]
  if (first === undefined || last === undefined) return undefined
  if (radiusM <= first.radiusM) return { capacityKg: first.capacityKg }
  if (radiusM > last.radiusM) return { outOfReach: true }
  for (let index = 1; index < curve.length; index++) {
    const over = curve[index] as { radiusM: number; capacityKg: number }
    if (radiusM > over.radiusM) continue
    const under = curve[index - 1] as { radiusM: number; capacityKg: number }
    if (radiusM === over.radiusM) return { capacityKg: over.capacityKg }
    const span = over.radiusM - under.radiusM
    const fraction = span === 0 ? 0 : (radiusM - under.radiusM) / span
    return {
      capacityKg:
        Math.round((under.capacityKg + (over.capacityKg - under.capacityKg) * fraction) * 10) / 10,
      interpolated: true,
    }
  }
  return { capacityKg: last.capacityKg }
}

/**
 * The worst capacity anywhere the chart reaches — what a gang is checked against when
 * nobody has said where it is set.
 *
 * The jib tip on every real chart, and taken as the minimum rather than assumed to be
 * the last point, because a chart entered out of order or with a flat outer section
 * should still give the figure that governs. This is the conservative reading and it is
 * deliberately the one used where a radius is unknown: nothing in the scene says where
 * the crane stands, and a check against the near-mast rating would pass every gang on
 * the job.
 */
export function worstCraneCapacityKg(crane: FormworkCraneSettings | undefined): number | undefined {
  const curve = crane?.capacityCurve ?? []
  if (curve.length === 0) return undefined
  return Math.min(...curve.map((point) => point.capacityKg))
}

/**
 * The best capacity anywhere the chart reaches — the figure a pick has to beat to be
 * impossible rather than merely badly positioned.
 *
 * The plateau near the mast on every real chart. Paired with `worstCraneCapacityKg` it is
 * what separates the two failures a load chart has in it: over this, no radius on the jib
 * lifts the gang and the layout has to change; over the worst but inside this, the gang
 * lifts somewhere and the question is where it is set.
 */
export function bestCraneCapacityKg(crane: FormworkCraneSettings | undefined): number | undefined {
  const curve = crane?.capacityCurve ?? []
  if (curve.length === 0) return undefined
  return Math.max(...curve.map((point) => point.capacityKg))
}

/**
 * The furthest radius this chart still takes a pick at, as a published row.
 *
 * A row rather than the interpolated crossing, and that is the whole reason this is a
 * function rather than a `craneCapacityAtM` call: the straight line between two rows sits
 * above the real sagging curve, so the interpolated crossing is the optimistic radius. A
 * rigger reads a chart by its rows in any case.
 *
 * `undefined` where no row takes it — which is the same answer as no chart at all, because
 * both mean this crane is not the one to ask.
 */
export function craneRadiusForPickM(
  crane: FormworkCraneSettings | undefined,
  pickKg: number,
): number | undefined {
  const curve = [...(crane?.capacityCurve ?? [])].sort((a, b) => a.radiusM - b.radiusM)
  return curve.filter((point) => point.capacityKg >= pickKg).at(-1)?.radiusM
}

/** What the chart's own limits are, for a surface that prints the crane it checked against. */
export function craneReachM(
  crane: FormworkCraneSettings | undefined,
): { fromM: number; toM: number } | undefined {
  const curve = crane?.capacityCurve ?? []
  if (curve.length === 0) return undefined
  const radii = curve.map((point) => point.radiusM)
  return { fromM: Math.min(...radii), toM: Math.max(...radii) }
}

/**
 * The settings as the limits a face is grouped against.
 *
 * Here rather than at the call site because the *worst* capacity is what a layout may be
 * grouped against and picking the wrong figure off the chart is the one mistake in this
 * corner that produces a drawing rather than a wrong number: group against the near-mast
 * rating and every gang on the job is one pick that the crane cannot make at the wall.
 *
 * `undefined` for a project with no crane, and passed as `{}` by callers — which is
 * `gangFace`'s "no limits stated means one gang" rather than a limit of zero.
 */
export function craneGangOptions(crane: FormworkCraneSettings | undefined): GangOptions {
  const worstKg = worstCraneCapacityKg(crane)
  return {
    ...(worstKg === undefined ? {} : { maxPickWeightKg: worstKg }),
    ...(crane?.maxGangWidthMm === undefined ? {} : { maxWidthMm: crane.maxGangWidthMm }),
    ...(crane?.minSlingAngleDeg === undefined ? {} : { slingAngleDeg: crane.minSlingAngleDeg }),
  }
}

/** Height available between the top of a gang and the hook, mm — the slings' room. */
export function craneHookHeightMm(crane: FormworkCraneSettings | undefined): number | undefined {
  return crane?.hookHeightM === undefined ? undefined : crane.hookHeightM * 1000
}

/** What a chart says about one pick. */
export type CranePickVerdict =
  /** Inside the worst figure on the chart, so it lifts anywhere the jib reaches. */
  | 'lifts'
  /** Over the worst and inside the best: it lifts, and where it is set decides whether. */
  | 'position'
  /** Over the best figure anywhere on the chart — no radius on the jib takes it. */
  | 'over-chart'

/**
 * The three verdicts in a reader's words, for a surface that prints one.
 *
 * `position` is the one that has to say what it is *not*: a reader who takes it for a fail
 * re-lays a face that lifts perfectly well twenty metres nearer the mast.
 */
export const CRANE_PICK_VERDICT_LABELS: Record<CranePickVerdict, string> = {
  lifts: 'lifts anywhere the jib reaches',
  position: 'lifts nearer the mast — not at the jib tip, so the crane’s position decides it',
  'over-chart': 'over the chart everywhere — no radius on this jib lifts it',
}

/**
 * Whether this crane takes this pick, in the one place that decides it.
 *
 * Shared rather than repeated because the two readers of it are the validator, which turns
 * the answer into an error or a warning, and the takeoff, which prints it beside the gang.
 * Two implementations of the same three-way split is a panel calling a pick fine that the
 * report calls impossible, over the same wall and the same chart.
 *
 * `undefined` where there is no chart to ask — which is not a pick that fails.
 */
export function cranePickVerdict(
  crane: FormworkCraneSettings | undefined,
  pickKg: number,
): CranePickVerdict | undefined {
  const worstKg = worstCraneCapacityKg(crane)
  const bestKg = bestCraneCapacityKg(crane)
  if (worstKg === undefined || bestKg === undefined) return undefined
  if (pickKg > bestKg) return 'over-chart'
  return pickKg > worstKg ? 'position' : 'lifts'
}

/** What makes a crane check say less than it looks like it does. */
export function formworkCraneCaveats(crane: FormworkCraneSettings | undefined): string[] {
  const curve = crane?.capacityCurve ?? []
  if (curve.length === 0) {
    return [
      'No crane has been recorded, so no gang in this takeoff has been checked against a lift. Record the load chart — capacity against radius — and every gang is grouped and checked against it.',
    ]
  }
  const out: string[] = []
  const reach = craneReachM(crane) as { fromM: number; toM: number }
  const worst = worstCraneCapacityKg(crane) as number
  out.push(
    `Gangs are checked against the worst capacity on the chart, ${worst} kg, because nothing in the model says where the crane stands. A gang set nearer the mast than ${reach.toM} m has more than that available, so a gang reported over capacity may lift where it is actually being set.`,
  )
  if (curve.length < 3) {
    out.push(
      `The chart has ${curve.length} ${curve.length === 1 ? 'point' : 'points'}, so a capacity between them is read off a straight line. A real chart sags below that line, which makes an interpolated figure the optimistic one — add the rows off the published chart and the reading follows it.`,
    )
  }
  if (crane?.hookHeightM === undefined) {
    out.push(
      'No height under the hook was recorded, so the headroom each gang needs for its slings is reported but not checked. A gang whose eyes sit wide apart needs more height than a narrow one at the same weight.',
    )
  }
  return out
}
