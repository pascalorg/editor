import type { FormworkLogisticsSettings } from '../../schema/nodes/formwork-project-settings'
import type { FormworkLifts } from './lifts'

/**
 * Getting the formwork to the job and off the lorry — the two costs every total in this
 * folder has excluded since the money arrived.
 *
 * `cost.excludes` has named transport and craneage on every surface from the day
 * `cost.ts` landed, and the reason was not an oversight: neither had a quantity to hang
 * off. A delivery is priced per *load* and a crane per *lift*, and a bill of 2,400 parts
 * is neither of those. What made both expressible is that the two quantities now exist —
 * `bomWeightKg` says what the lorries carry and `formworkLifts` says how many times the
 * hook goes up — and this module is the arithmetic that joins each to a rate. It derives
 * no weight, groups no gang, and invents no rate.
 *
 * ## Two sweeps, because they are two different questions
 *
 * The loads come off the *weight* and the crane hours come off the *picks*, and neither
 * substitutes for the other. A job of 60 t in 30 picks and a job of 60 t in 300 picks
 * cost the same to deliver and ten times as much to lift, which is the whole reason a
 * pick count had to exist before this could be written. Reporting one figure for "site
 * logistics" would average the two and answer neither.
 *
 * ## A load is a lorry, and the rounding up is the answer
 *
 * 8.2 t against an 8 t payload is two loads, and the second lorry is invoiced at what the
 * first one was. Rounding down or pro-rating would produce a figure lower than any real
 * invoice on almost every job, which is the direction that gets quoted.
 *
 * The loads are counted on the *whole* bill's weight rather than on the peak the set
 * count reports, and the difference is deliberate. A set delivered once and reused on
 * twelve pours travels once; that is true, and it is not what this counts. This counts
 * what the job passes through, because a panel that comes back to the yard between two
 * pours travels twice and the programme is what says whether it does — and the programme
 * cannot say, because nothing in this model knows whether a struck set stays on site.
 * So `loadsAreOneTrip` says the figure is the minimum trips a job of this weight takes,
 * and every surface repeats it.
 *
 * ## Craneage is the hook time, and it is a mobile crane's charge or nothing
 *
 * The cycle is sling, lift, land, release and hook back — the whole cycle rather than the
 * lift, because a crane is booked by the hour and the two minutes a gang spends in the
 * air are the smallest part of the twenty it occupies. And the money is a *mobile* crane's
 * hourly hire. A tower crane standing over the pour is a preliminary charged by the week
 * whether it lifts this formwork or not, so pricing hook time against one double-counts a
 * cost the job already carries. That is not something this module can detect, so it is
 * said on every surface instead.
 *
 * ## Unweighed and unweighable, kept apart
 *
 * A bill whose weight is incomplete gives a load count that is a floor, and an incomplete
 * *lifting schedule* — picks with no weight — does not affect the crane hours at all,
 * because a cycle is timed per pick rather than per kilo. The two gaps are reported
 * separately for that reason: one makes the transport a floor and the other does not touch
 * it.
 */

/** The rates this needs, which live with the money rather than beside the payload. */
export interface LogisticsRates {
  currency?: string
  /** One load, one way. Absent means the loads are counted and not priced. */
  transportPerLoad?: number
  /** An hour of a mobile crane, all-in. Absent means the hours carry no money. */
  cranePerHour?: number
}

/** Why a figure here is a floor, or missing. */
export type LogisticsGap =
  /** Some parts carry no published weight, so the tonnage the loads come off is short. */
  | 'weight-incomplete'
  /** No payload recorded, so there is no load count at all. */
  | 'no-payload'
  /** No cycle time recorded, so there are no crane hours at all. */
  | 'no-cycle-time'
  /** Nothing in scope is ganged, so there are no picks to time. */
  | 'nothing-ganged'
  /** Loads counted with no rate to charge them at. */
  | 'no-transport-rate'
  /** Hook time derived with no crane rate to charge it at. */
  | 'no-crane-rate'

export const LOGISTICS_GAP_LABELS: Record<LogisticsGap, string> = {
  'weight-incomplete':
    'Some parts have no published weight, so the tonnage the loads are counted from is short and the load count is a floor',
  'no-payload':
    'No lorry payload recorded, so the weight cannot be turned into loads — state what one lorry carries',
  'no-cycle-time':
    'No minutes per pick recorded, so there is no hook time — state how long one pick takes, sling to hook back',
  'nothing-ganged':
    'Nothing in scope is ganged, so there are no picks to time — a shutter struck panel by panel is craned in pieces this cannot count',
  'no-transport-rate': 'No charge per load recorded, so the loads are counted and not priced',
  'no-crane-rate':
    'No crane rate recorded, so the hook time carries no money — state the hourly rate of the crane the job hires',
}

export interface FormworkLogistics {
  currency?: string
  /**
   * Lorry loads out, rounded up from the bill's weight against the payload.
   *
   * Absent where no payload is recorded. One way — see `returnLoads`.
   */
  outboundLoads?: number
  /**
   * Loads back to the yard, which is what returns rather than what went out.
   *
   * Equal to `outboundLoads` unless the project has stated a fraction, because a
   * returnable bill comes back on the same number of lorries it went out on.
   */
  returnLoads?: number
  /** Both directions — what a haulier invoices. */
  totalLoads?: number
  /** The weight the loads were counted from, kg, so a reader can check the division. */
  weighedKg?: number
  /** What one lorry was taken to carry, kg — the figure the project stated. */
  payloadKg?: number
  /** `totalLoads` at the stated charge. Absent where no charge is recorded. */
  transportCost?: number
  /** Picks the hook makes, straight off the lifting schedule. */
  pickCount?: number
  /** Hours of hook time, `pickCount` × the stated cycle. */
  craneHours?: number
  /** `craneHours` at the stated rate. Absent where no rate is recorded. */
  craneCost?: number
  /** Transport and craneage. Absent where neither could be priced. */
  totalCost?: number
  /** False where any figure above is a floor or missing. */
  complete: boolean
  gaps: LogisticsGap[]
}

/** Minutes to hours, for a cycle stated the way a site states one. */
const MINUTES_PER_HOUR = 60

/**
 * What it costs to deliver this bill and to lift it into place.
 *
 * Takes the bill's weight and the lifting schedule rather than the parts or the scene, so
 * the loads are counted off the same tonnage the takeoff prints and the picks off the same
 * schedule the crane was checked against. A second sweep here would be a second answer to
 * "how heavy is this", and the two would diverge on the first line with no stated weight.
 *
 * `lifts` is optional because a conventional shutter has no gangs: there is nothing to
 * lift as an assembly, so there is no hook time to price, and the transport half of the
 * answer is unaffected.
 */
export function formworkLogistics(
  weight: { totalKg: number; complete: boolean },
  lifts: FormworkLifts | undefined,
  logistics: FormworkLogisticsSettings,
  rates: LogisticsRates | undefined,
): FormworkLogistics {
  const gaps: LogisticsGap[] = []
  const payloadKg = logistics.lorryPayloadKg
  const perLoad = rates?.transportPerLoad
  const perHour = rates?.cranePerHour

  let outboundLoads: number | undefined
  let returnLoads: number | undefined
  let totalLoads: number | undefined
  let transportCost: number | undefined
  if (payloadKg === undefined) {
    gaps.push('no-payload')
  } else {
    if (!weight.complete) gaps.push('weight-incomplete')
    // At least one load for any weight at all: a bill of one panel still sends a lorry, and
    // `Math.ceil` of a fraction gives that. A bill of nothing sends nothing.
    outboundLoads = weight.totalKg > 0 ? Math.ceil(weight.totalKg / payloadKg) : 0
    // Rounded up again rather than off the fractional loads, because the lorries that come
    // back are whole lorries too — a third of six loads returning is two.
    returnLoads =
      logistics.returnLoadFraction === undefined
        ? outboundLoads
        : Math.ceil(outboundLoads * logistics.returnLoadFraction)
    totalLoads = outboundLoads + returnLoads
    if (perLoad === undefined) gaps.push('no-transport-rate')
    else transportCost = totalLoads * perLoad
  }

  let craneHours: number | undefined
  let craneCost: number | undefined
  const pickCount = lifts?.pickCount
  if (pickCount === undefined) {
    gaps.push('nothing-ganged')
  } else if (logistics.minutesPerPick === undefined) {
    gaps.push('no-cycle-time')
  } else {
    craneHours = (pickCount * logistics.minutesPerPick) / MINUTES_PER_HOUR
    if (perHour === undefined) gaps.push('no-crane-rate')
    else craneCost = craneHours * perHour
  }

  const priced = [transportCost, craneCost].filter((value): value is number => value !== undefined)
  return {
    ...(rates?.currency === undefined ? {} : { currency: rates.currency }),
    ...(outboundLoads === undefined ? {} : { outboundLoads }),
    ...(returnLoads === undefined ? {} : { returnLoads }),
    ...(totalLoads === undefined ? {} : { totalLoads }),
    ...(payloadKg === undefined ? {} : { weighedKg: weight.totalKg, payloadKg }),
    ...(transportCost === undefined ? {} : { transportCost }),
    ...(pickCount === undefined ? {} : { pickCount }),
    ...(craneHours === undefined ? {} : { craneHours }),
    ...(craneCost === undefined ? {} : { craneCost }),
    ...(priced.length > 0 ? { totalCost: priced.reduce((a, b) => a + b, 0) } : {}),
    complete: gaps.length === 0,
    gaps,
  }
}

/**
 * What makes a transport or craneage figure wrong, in words.
 *
 * Leads with the two sentences a reader of either figure has to have, because both are
 * about what the number *is* rather than about a gap in the inputs: a load count is a
 * minimum number of trips rather than a delivery schedule, and hook time is only a charge
 * at all on a crane the job hires by the hour.
 */
export function formworkLogisticsCaveats(logistics: FormworkLogistics): string[] {
  const out: string[] = []
  if (logistics.totalLoads !== undefined) {
    out.push(
      `${logistics.totalLoads} loads is what a job of this weight takes at ${logistics.payloadKg} kg a lorry, out and back — the fewest trips it can be done in rather than a delivery schedule. A set that goes back to the yard between two pours travels again, and nothing here knows whether it stays on site, so this is a floor whenever the same plant serves more than one pour.`,
    )
  }
  if (logistics.craneHours !== undefined) {
    out.push(
      'The hook time is a charge only where the job hires a crane by the hour. A tower crane standing over the pour is a preliminary charged by the week whether it lifts this formwork or not, so adding these hours to it charges the same crane twice — nothing in this model can tell which of the two the job has.',
    )
    out.push(
      'It is the formwork’s cycles alone. The same hook lifts rebar, concrete skips and everything else on the job, and a crane already at its capacity in hours cannot take these on top of what it is doing — which is a programme question rather than a price.',
    )
  }
  for (const gap of logistics.gaps) out.push(LOGISTICS_GAP_LABELS[gap])
  return out
}
