import type { PartRate } from '../../schema/nodes/formwork-project-settings'
import type { RateTable } from './cost'
import type { FormworkPartKind } from './parts'
import type { FormworkSetCount, SetPeak } from './sets'
import type { OwnedStock } from './supply'

/**
 * What the yard has to go out and get, and whether to buy it or hire it.
 *
 * Two questions this feature could not previously ask, both of which need the set count
 * that now exists.
 *
 * ## Why the supply split cannot answer the first one
 *
 * `bomSupply` splits the *bill*: a yard owning 100 panels against a bill of 400 is told it
 * hires 300. For a job of four sequential pours that is wrong by a factor of three — the
 * same 100 panels serve all four, and the yard hires nothing. The split has carried that
 * caveat since it was written ("two scopes are not additive") and named the set count as
 * what would fix it. This is that fix: a shortfall is the *peak* against the rack, never
 * the bill against the rack.
 *
 * The consequence is worth stating plainly, because it changes a number a reader may have
 * already quoted: a project can have a large hired quantity in the bill and nothing at all
 * to acquire.
 *
 * ## Why buy-or-hire is decidable here, and why it is not about reuse
 *
 * What was missing was the span. `committedDays` is how long the item is genuinely on the
 * job — which is *not* the sum of its strike periods, and a hire quoted off that sum is the
 * commonest way to make buying look absurd. See `SetPeak.committedDays`.
 *
 * The comparison is then the project's own hire rate over that span against the project's
 * own list price, and the arithmetic says something the trade's rule of thumb does not.
 * "Buy it if you use it more than five times" is about *uses*, and uses do not enter this
 * at all: hire is charged per unit per month, so both courses scale identically with
 * quantity and the ratio between them depends only on how long the thing is held. At 3 % of
 * new value per month — the middle of the band a hire desk quotes — a purchase pays for
 * itself after some 33 months of continuous hire. Almost no single job holds a set that
 * long. So the honest output of this comparison is that hiring usually wins *for one job*,
 * and owning is justified by a succession of jobs rather than by this one.
 *
 * That is why the decision-relevant figure is `paybackJobs` rather than a break-even number
 * of uses: a yard that will run four more jobs like this one is looking at a different
 * answer from a yard that will run none, and this model cannot know which — but it can say
 * exactly where the line is.
 *
 * There is no panel life, no residual value and no discount rate in any of it, because none
 * of the three has a source in this model, and a payback computed off an invented eight-year
 * life would be the untraceable figure `cost.ts` refuses to produce. What that omission
 * costs is said in the caveats rather than absorbed.
 *
 * ## The recommendation is per catalog id, and it is not a total
 *
 * Summing "buy" lines into a capital figure is arithmetically fine and commercially
 * misleading, because the decision is not taken line by line at one moment: a yard buys the
 * panel type it uses on every job and hires the odd corner unit. The lines carry their own
 * verdicts and the totals stay separate.
 */

/**
 * Which course is cheaper *over this job*, which is the only span this model can see.
 *
 * `hire` is the common answer and is not a weak one: hire at a few per cent of new value a
 * month takes years of continuous holding to reach a list price, and a job holds a set for
 * weeks. `buy` here means the span alone justifies the purchase, which happens on long
 * programmes and on anything held against a punitive minimum period.
 */
export type AcquireVerdict =
  /** Hire over the committed span costs more than buying outright. */
  | 'buy'
  /** Hire over the span is cheaper than buying, for this job taken alone. */
  | 'hire'
  /** The two are within a tenth of each other — too close for this model to call. */
  | 'marginal'

export const ACQUIRE_VERDICT_LABELS: Record<AcquireVerdict, string> = {
  buy: 'Hire over this job’s span costs more than buying outright',
  hire: 'Cheaper to hire for this job — owning pays off over more jobs than this one',
  marginal: 'Buying and hiring are within a tenth of each other over this job',
}

/** Why a line carries no buy-or-hire verdict. */
export type AcquireGap =
  /** No rate recorded against this catalog id, so neither course has a price. */
  | 'no-rate'
  /** A hire rate but no list price, so there is nothing to compare a purchase against. */
  | 'no-purchase-price'
  /** A list price but no hire rate, so the hire side of the comparison is missing. */
  | 'no-rental-rate'

export const ACQUIRE_GAP_LABELS: Record<AcquireGap, string> = {
  'no-rate': 'No rate recorded for this part, so neither buying nor hiring has a price',
  'no-purchase-price': 'No list price recorded, so a purchase cannot be compared against hire',
  'no-rental-rate': 'No hire rate recorded, so hire cannot be compared against a purchase',
}

/** One catalog id: what the peak needs, what the yard has, and what to do about it. */
export interface AcquireLine {
  catalogId: string
  kind: FormworkPartKind
  description: string
  /** The most needed at once — `SetPeak.peakQuantity`, and the number that matters here. */
  peakQuantity: number
  /** `YYYY-MM-DD` — the day the peak falls, which is the day a shortfall has to be met by. */
  peakOn: string
  /** What the project says it owns of this id. */
  ownedQuantity: number
  /**
   * Peak over owned, floored at zero — what has to be acquired.
   *
   * Not the bill over owned. See the module docstring: those differ by the reuse factor,
   * and on a sequential programme they differ by an order of magnitude.
   */
  shortfall: number
  /** Owned over peak, floored at zero — stock this job never needs at once. */
  surplus: number
  /** From `SetPeak`, carried so a verdict can be read beside what produced it. */
  reuseFactor: number
  committedDays: number
  /**
   * The pours standing together on the peak day — what a shortfall is *about*.
   *
   * A shortfall has no element of its own: it is a property of a catalog id across a set of
   * concurrent pours. These are the pours whose overlap creates it, which is what makes the
   * finding selectable on a panel and, more usefully, what makes it fixable — resequencing
   * any one of them out of the overlap removes the shortfall.
   */
  peakPourIds: string[]
  /**
   * How busy the set is kept: `fittedUnitDays / (peakQuantity × committedDays)`.
   *
   * A ratio rather than the two figures, because the reader's question is whether they are
   * paying to hold idle plant. 1.0 is a set fitted somewhere every day it is on site; 0.2
   * is one held for a span it is used a fifth of, which is a programme with gaps in it and
   * an argument for a shorter hire rather than a bigger rack.
   */
  utilisation: number
  /** Hire of the shortfall over `committedDays` at the project's rate. */
  hireCost?: number
  /** List price of the shortfall. */
  purchaseCost?: number
  /** Which is cheaper over this job, where both are priced. */
  verdict?: AcquireVerdict
  /**
   * How many jobs like this one a purchase pays back over: `purchaseCost / hireCost`.
   *
   * The figure that makes a verdict arguable rather than oracular, and the one to read
   * instead of the verdict. "Hire — but owning pays back over 3.4 jobs like this" is a claim
   * a reader can settle against their own order book, and a bare "hire" is not.
   *
   * Jobs rather than uses, because uses do not enter the comparison: hire is per unit per
   * month, so adding pours *within* the same span changes neither side. What changes the
   * answer is holding the set for longer, and the unit a yard thinks in is the next job.
   * At or below 1 the purchase pays back inside this job alone, which is what `buy` means.
   */
  paybackJobs?: number
  gaps: AcquireGap[]
}

export interface FormworkAcquisition {
  currency?: string
  /** Every id with a peak, largest shortfall first. Lines with none are still reported. */
  lines: AcquireLine[]
  /** Lines with a shortfall, so a reader can see the acquisition list on its own. */
  shortfalls: AcquireLine[]
  /** Ids the project owns that this scope's peaks never need at once. */
  surpluses: AcquireLine[]
  /** Total quantity to acquire, across ids. A count of parts, not a price. */
  shortfallQuantity: number
  /**
   * Hire and purchase of the whole shortfall, for a reader who wants the two courses
   * costed. Deliberately not netted into a "saving": see `acquireCaveats`.
   */
  hireCost: number
  purchaseCost: number
  /** False where any line could not be costed, making both totals floors. */
  complete: boolean
  gaps: AcquireGap[]
}

/** A month, matching `cost.ts` — the same rate over the same kind of span. */
const DAYS_PER_MONTH = 30

/** The band within which this model will not call a buy-or-hire decision either way. */
const MARGINAL_BAND = 0.1

/** Hire per unit per month, on the same rule `bomCost` applies: a quote beats a percentage. */
function monthlyRate(rate: PartRate): number | undefined {
  if (rate.rentalPerUnitPerMonth !== undefined) return rate.rentalPerUnitPerMonth
  if (rate.purchasePerUnit === undefined || rate.rentalPercentPerMonth === undefined) {
    return undefined
  }
  return (rate.purchasePerUnit * rate.rentalPercentPerMonth) / 100
}

/**
 * What to acquire, and whether to buy or hire it.
 *
 * `owned` is required rather than optional, and that is the caller's decision to make: a
 * project that has never recorded a rack has not said it owns nothing, so the caller passes
 * no acquisition at all rather than one reporting the whole peak as short. The same rule
 * `bomSupply` follows, and for the same reason.
 *
 * `rates` is optional because a shortfall is worth reporting without one — "you are 40
 * panels short" is useful with no price attached, and it is the half of this that needs no
 * commercial input.
 */
export function formworkAcquisition(
  count: FormworkSetCount,
  owned: OwnedStock,
  rates: RateTable | undefined,
): FormworkAcquisition {
  const gaps = new Set<AcquireGap>()
  const lines: AcquireLine[] = count.peaks.map((peak) => line(peak, owned, rates, gaps))

  const shortfalls = lines
    .filter((entry) => entry.shortfall > 0)
    .sort((a, b) => b.shortfall - a.shortfall || a.catalogId.localeCompare(b.catalogId))

  let hireCost = 0
  let purchaseCost = 0
  for (const entry of shortfalls) {
    hireCost += entry.hireCost ?? 0
    purchaseCost += entry.purchaseCost ?? 0
  }

  return {
    ...(rates?.currency === undefined ? {} : { currency: rates.currency }),
    lines: [...lines].sort(
      (a, b) => b.shortfall - a.shortfall || a.catalogId.localeCompare(b.catalogId),
    ),
    shortfalls,
    surpluses: lines
      .filter((entry) => entry.surplus > 0)
      .sort((a, b) => b.surplus - a.surplus || a.catalogId.localeCompare(b.catalogId)),
    shortfallQuantity: shortfalls.reduce((sum, entry) => sum + entry.shortfall, 0),
    hireCost,
    purchaseCost,
    complete: gaps.size === 0,
    gaps: [...gaps],
  }
}

function line(
  peak: SetPeak,
  owned: OwnedStock,
  rates: RateTable | undefined,
  gaps: Set<AcquireGap>,
): AcquireLine {
  const ownedQuantity = owned[peak.catalogId] ?? 0
  const shortfall = Math.max(0, peak.peakQuantity - ownedQuantity)
  const base: AcquireLine = {
    catalogId: peak.catalogId,
    kind: peak.kind,
    description: peak.description,
    peakQuantity: peak.peakQuantity,
    peakOn: peak.peakOn,
    ownedQuantity,
    shortfall,
    surplus: Math.max(0, ownedQuantity - peak.peakQuantity),
    reuseFactor: peak.reuseFactor,
    committedDays: peak.committedDays,
    peakPourIds: peak.peakPourIds,
    utilisation: peak.fittedUnitDays / (peak.peakQuantity * peak.committedDays),
    gaps: [],
  }

  // Nothing to acquire is not a gap. A line the yard already covers needs no verdict, and
  // reporting one against it would put "cheaper to buy" beside a purchase nobody is making.
  if (shortfall === 0 || rates === undefined) return base

  const rate = rates.byCatalogId[peak.catalogId]
  if (rate === undefined) {
    gaps.add('no-rate')
    return { ...base, gaps: ['no-rate'] }
  }

  const monthly = monthlyRate(rate)
  const lineGaps: AcquireGap[] = []
  // The minimum hire period applies here for the same reason it does in `bomCost`, and it
  // moves this decision rather than rounding it: a set committed 12 days against a 28-day
  // minimum is hired for 28, which is what makes buying win on short fast-cycle jobs.
  const chargedDays = Math.max(peak.committedDays, rates.minHireDays ?? 0)
  const hireCost =
    monthly === undefined ? undefined : monthly * (chargedDays / DAYS_PER_MONTH) * shortfall
  if (monthly === undefined) {
    lineGaps.push('no-rental-rate')
    gaps.add('no-rental-rate')
  }
  const purchaseCost =
    rate.purchasePerUnit === undefined ? undefined : rate.purchasePerUnit * shortfall
  if (rate.purchasePerUnit === undefined) {
    lineGaps.push('no-purchase-price')
    gaps.add('no-purchase-price')
  }

  let verdict: AcquireVerdict | undefined
  let paybackJobs: number | undefined
  if (hireCost !== undefined && purchaseCost !== undefined && hireCost > 0) {
    paybackJobs = purchaseCost / hireCost
    verdict =
      Math.abs(paybackJobs - 1) <= MARGINAL_BAND ? 'marginal' : paybackJobs < 1 ? 'buy' : 'hire'
  }

  return {
    ...base,
    ...(hireCost === undefined ? {} : { hireCost }),
    ...(purchaseCost === undefined ? {} : { purchaseCost }),
    ...(verdict === undefined ? {} : { verdict }),
    ...(paybackJobs === undefined ? {} : { paybackJobs }),
    gaps: lineGaps,
  }
}

/**
 * What makes an acquisition list wrong, in words.
 *
 * The first one is printed always, because it is the claim a reader is most likely to carry
 * away wrong: this list is smaller than the bill's hired quantity, and the difference is not
 * an error in either.
 */
export function acquireCaveats(acquisition: FormworkAcquisition): string[] {
  const out: string[] = []
  if (acquisition.lines.length === 0) return out
  out.push(
    'This is what the peak needs over what the yard owns, not the bill over what the yard owns. A job whose pours run in sequence reuses the same sets, so this list is normally far shorter than the hired quantity in the bill — and neither figure is wrong.',
  )
  if (acquisition.shortfalls.length === 0) {
    out.push(
      'Nothing is short: the yard owns enough of every item to cover its own peak. That is a statement about this scope only — the same stock cannot cover two scopes formed at the same time.',
    )
  }
  const decided = acquisition.lines.filter((entry) => entry.paybackJobs !== undefined)
  if (decided.length > 0) {
    out.push(
      'Buy-or-hire here compares this job’s hire against the list price and nothing else. There is no panel life, no resale value and no cost of capital in it, because none of the three has a source in this model — so a purchase that serves the next job as well is under-valued by exactly the part that cannot be seen from here.',
    )
    out.push(
      'Read the payback rather than the verdict. Hire runs at a few per cent of new value a month, so hiring is cheaper than buying on almost any single job — and a line saying "hire, pays back over 2.1 jobs like this" is a purchase for a yard with three more of these booked and a hire for one with none. That is a question about an order book rather than about this programme.',
    )
  }
  const idle = acquisition.lines.filter((entry) => entry.utilisation < 0.5)
  if (idle.length > 0) {
    out.push(
      `${idle.length} ${idle.length === 1 ? 'item is' : 'items are'} in use less than half the days ${idle.length === 1 ? 'it is' : 'they are'} committed, so the hire above pays for plant standing idle. That is a programme with gaps in it rather than a fault in the design, and resequencing the pours is what shortens the hire.`,
    )
  }
  if (!acquisition.complete) {
    const reasons = acquisition.gaps.map((gap) => ACQUIRE_GAP_LABELS[gap].toLowerCase()).join('; ')
    out.push(`Some lines carry no comparison, so both totals are floors — ${reasons}.`)
  }
  if (acquisition.surpluses.length > 0) {
    out.push(
      `${acquisition.surpluses.length} ${acquisition.surpluses.length === 1 ? 'item' : 'items'} the yard owns ${acquisition.surpluses.length === 1 ? 'is' : 'are'} never all needed at once here. That is spare capacity for another job rather than a saving on this one — the money is already spent.`,
    )
  }
  if (acquisition.shortfallQuantity > 0) {
    out.push(
      'A shortfall is counted against the peak day. Acquiring it later than that day does not delay the pours by the difference — it moves the pour, because the peak day is when every one of these has to be standing.',
    )
  }
  return out
}
