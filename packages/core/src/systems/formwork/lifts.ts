import type { FormworkCraneSettings } from '../../schema/nodes/formwork-project-settings'
import {
  bestCraneCapacityKg,
  craneHookHeightMm,
  cranePickVerdict,
  craneRadiusForPickM,
  craneReachM,
  worstCraneCapacityKg,
} from './crane'
import type { FaceGangs, Gang } from './layout/gangs'

/**
 * Every pick on the job, heaviest first — the lifting schedule a takeoff prints.
 *
 * `layout/gangs.ts` groups one face and `crane.ts` reads one chart. Neither answers the
 * question a surface asks, which is about the *job*: what is the heaviest thing this crane
 * has to lift, how many picks are there, and which of them are a problem. That question
 * spans elements, so it cannot be answered inside either module, and every surface that
 * needs it — the takeoff panel, the CSV, both AI reads — would otherwise sweep the gangs
 * itself. Four sweeps of one input is four chances to sort differently, count a face twice,
 * or classify a pick against the wrong end of the chart.
 *
 * ## Nothing here is a second opinion
 *
 * The verdict per pick is `cranePickVerdict`, the same call the validator makes, so a panel
 * cannot call a gang liftable that the report faults. The radius is `craneRadiusForPickM`,
 * so it is a published row rather than the interpolated crossing. What this module adds is
 * the aggregation: the sort, the counts, and the totals — arithmetic over answers rather
 * than answers of its own.
 *
 * ## A heaviest pick is not a total, and the two must not be added
 *
 * `heaviestPickKg` is the figure a crane is chosen against; `totalWeightKg` on a face is
 * what a lorry carries. Adding picks together produces a load nothing ever lifts, which is
 * why there is no summed pick weight anywhere in this type — only the heaviest, and the
 * count of them.
 *
 * ## Unweighed picks are counted, never estimated
 *
 * A gang with no `pickWeightKg` is a gang nothing can check, following `bomWeightKg` and
 * `gangFace` exactly. It is in `pickCount` because the crane still lifts it, and in
 * `unweighedPicks` because no verdict about it exists. A surface that printed only the
 * weighed ones would report a shorter lifting schedule than the job has.
 */

/** One pick, with the element it belongs to and what the chart says about it. */
export interface LiftPick {
  /** The element whose face this gang is on, so a pick traces back to a wall. */
  elementId: string
  /** 1-based, matching the validator's `face 2 gang 1` wording. */
  faceNumber: number
  gangNumber: number
  widthMm: number
  heightMm: number
  panelCount: number
  /** Panels and make-up pieces, kg. Absent where a piece in it carries no stated weight. */
  pickWeightKg?: number
  /** Headroom the slings want between the gang's top and the hook, mm. */
  minHookHeightMm?: number
  /**
   * What the chart says. Absent where there is no chart, which is not a pick that passed.
   */
  verdict?: ReturnType<typeof cranePickVerdict>
  /**
   * The furthest published radius that still takes this pick, m.
   *
   * Only meaningful on a `position` verdict — on a `lifts` pick it is the jib tip and says
   * nothing, and on an `over-chart` pick no row takes it at all.
   */
  liftsInsideM?: number
  /** Set where the slings want more height than the crane has. */
  overHookHeight?: true
  /** Set where the gang breaks a stated limit and holds no joint to break at. */
  overLimit?: true
}

export interface FormworkLifts {
  /** Every pick in scope, heaviest first, then by element for a stable order. */
  picks: LiftPick[]
  pickCount: number
  /**
   * The heaviest single pick, kg — the figure the crane is chosen against.
   *
   * Absent where no pick in scope has a weight at all. Deliberately not a sum: see the
   * module docstring.
   */
  heaviestPickKg?: number
  /** Picks with no weight, so a short schedule cannot read as a complete one. */
  unweighedPicks: number
  /** Picks no radius on the jib lifts — the ones that need a different layout. */
  overChartPicks: number
  /** Picks that lift nearer the mast but not at the tip. */
  positionPicks: number
  /** Picks whose slings want more height under the hook than the crane has. */
  overHookHeightPicks: number
  /**
   * The chart these were read against, for a surface that prints what it checked.
   *
   * Absent where no chart is recorded, which is the state that means no pick in this
   * schedule has been checked against anything.
   */
  crane?: {
    worstCapacityKg: number
    bestCapacityKg: number
    reachFromM: number
    reachToM: number
    hookHeightMm?: number
  }
}

/** One face's gangs as picks, with the element they belong to. */
export interface ElementGangs {
  elementId: string
  faces: readonly FaceGangs[]
}

function pickFor(
  elementId: string,
  faceNumber: number,
  gang: Gang,
  crane: FormworkCraneSettings | undefined,
  hookHeightMm: number | undefined,
): LiftPick {
  const pickKg = gang.pickWeightKg
  const verdict = pickKg === undefined ? undefined : cranePickVerdict(crane, pickKg)
  const insideM =
    pickKg === undefined || verdict !== 'position' ? undefined : craneRadiusForPickM(crane, pickKg)
  return {
    elementId,
    faceNumber,
    gangNumber: gang.index + 1,
    widthMm: Math.round(gang.widthMm),
    heightMm: Math.round(gang.heightMm),
    panelCount: gang.panelCount,
    ...(pickKg === undefined ? {} : { pickWeightKg: pickKg }),
    ...(gang.minHookHeightMm === undefined ? {} : { minHookHeightMm: gang.minHookHeightMm }),
    ...(verdict === undefined ? {} : { verdict }),
    ...(insideM === undefined ? {} : { liftsInsideM: insideM }),
    ...(hookHeightMm !== undefined &&
    gang.minHookHeightMm !== undefined &&
    gang.minHookHeightMm > hookHeightMm
      ? { overHookHeight: true as const }
      : {}),
    ...(gang.overLimit ? { overLimit: true as const } : {}),
  }
}

/**
 * The job's lifting schedule, off the gangs the geometry already produced.
 *
 * Takes the gangs rather than the scene, for the reason the validator does: grouping the
 * faces here would be a second gang division, and a schedule that disagreed with the
 * drawing about where a gang breaks would send a rigger to a joint that is not on the panel.
 *
 * Returns `undefined` where nothing in scope has a gang. That is a conventional job — a
 * carpenter's shutter is struck panel by panel and there is no assembly to lift — and a
 * lifting schedule of zero picks reads as a crane with nothing to do rather than as a job
 * with no craning in it.
 */
export function formworkLifts(
  gangs: readonly ElementGangs[],
  crane?: FormworkCraneSettings,
): FormworkLifts | undefined {
  const hookHeightMm = craneHookHeightMm(crane)
  const picks: LiftPick[] = []
  for (const element of gangs) {
    for (const [index, face] of element.faces.entries()) {
      for (const gang of face.gangs) {
        picks.push(pickFor(element.elementId, index + 1, gang, crane, hookHeightMm))
      }
    }
  }
  if (picks.length === 0) return undefined

  // Heaviest first, because the heaviest pick is the one the crane is chosen against and a
  // reader scanning this list is looking for it. Unweighed last rather than first: they are
  // not the largest, they are the unknown, and `unweighedPicks` is what reports them.
  picks.sort(
    (a, b) =>
      (b.pickWeightKg ?? -1) - (a.pickWeightKg ?? -1) ||
      a.elementId.localeCompare(b.elementId) ||
      a.faceNumber - b.faceNumber ||
      a.gangNumber - b.gangNumber,
  )

  const weights = picks
    .map((pick) => pick.pickWeightKg)
    .filter((weight): weight is number => weight !== undefined)
  const worstKg = worstCraneCapacityKg(crane)
  const bestKg = bestCraneCapacityKg(crane)
  const reach = craneReachM(crane)

  return {
    picks,
    pickCount: picks.length,
    ...(weights.length === 0 ? {} : { heaviestPickKg: Math.max(...weights) }),
    unweighedPicks: picks.filter((pick) => pick.pickWeightKg === undefined).length,
    overChartPicks: picks.filter((pick) => pick.verdict === 'over-chart').length,
    positionPicks: picks.filter((pick) => pick.verdict === 'position').length,
    overHookHeightPicks: picks.filter((pick) => pick.overHookHeight).length,
    ...(worstKg === undefined || bestKg === undefined || reach === undefined
      ? {}
      : {
          crane: {
            worstCapacityKg: worstKg,
            bestCapacityKg: bestKg,
            reachFromM: reach.fromM,
            reachToM: reach.toM,
            ...(hookHeightMm === undefined ? {} : { hookHeightMm }),
          },
        }),
  }
}

/**
 * What makes a lifting schedule say less than it looks like it does.
 *
 * `formworkCraneCaveats` covers the chart and `formworkGangCaveats` covers one face. This
 * covers the schedule: the sentences that are only true of a list of picks across a job,
 * and the ones a reader of a heaviest-pick figure has to have.
 */
export function formworkLiftCaveats(lifts: FormworkLifts): string[] {
  const out: string[] = []
  out.push(
    'Every pick here is panels and make-up pieces only. Walers, ties, couplers, brackets and any working platform travel with a ganged face and are not in these figures, so the load on the hook is higher than what is printed — on a steel-framed gang the steelwork is around a fifth of it.',
  )
  if (lifts.crane === undefined) {
    out.push(
      'No load chart is recorded, so no pick here has been checked against a lift at all. Each face is grouped as one gang, which is what the layout allows rather than what the site can lift — record the chart as capacity against radius and the faces divide at the joints already in them.',
    )
  }
  if (lifts.unweighedPicks > 0) {
    out.push(
      `${lifts.unweighedPicks} of ${lifts.pickCount} picks have no weight at all, because a piece in them carries no stated weight — a site-cut board, or a catalog entry whose published sheet gives a range. Those picks are in the count and in nothing else: no verdict about them exists.`,
    )
  }
  if (lifts.heaviestPickKg !== undefined) {
    out.push(
      `The crane is chosen against the heaviest pick, ${lifts.heaviestPickKg} kg, and never against a sum of picks — the picks happen one at a time, so a total of them is a load nothing ever lifts.`,
    )
  }
  if (lifts.positionPicks > 0) {
    out.push(
      `${lifts.positionPicks} ${lifts.positionPicks === 1 ? 'pick lifts' : 'picks lift'} nearer the mast but not at the jib tip. Nothing in the model says where the crane stands, so these are measured against the chart's worst figure rather than the one at the wall — they are a position to fix on a lifting plan rather than a layout to redo.`,
    )
  }
  if (lifts.overChartPicks > 0) {
    out.push(
      `${lifts.overChartPicks} ${lifts.overChartPicks === 1 ? 'pick is' : 'picks are'} over the best figure anywhere on the chart, so no radius on the jib lifts ${lifts.overChartPicks === 1 ? 'it' : 'them'}. That is a layout to redo — narrower panels give more joints and a lighter gang — or a face to hand-set.`,
    )
  }
  if (lifts.overHookHeightPicks > 0) {
    out.push(
      `${lifts.overHookHeightPicks} ${lifts.overHookHeightPicks === 1 ? 'pick wants' : 'picks want'} more height between the gang and the hook than the crane has, for the sling angle in force. A lifting beam brings the legs vertical and removes the demand; a flatter sling does not, which is what a stated minimum angle forbids.`,
    )
  }
  return out
}
