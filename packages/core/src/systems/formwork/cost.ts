import type { PartRate } from '../../schema/nodes/formwork-project-settings'
import type { BomHire, HireLine } from './hire'
import type { BomLine } from './parts'
import type { BomSupply, SupplyLine } from './supply'

/**
 * What a scope's formwork costs to hold — the third factor, over the two that already
 * exist.
 *
 * `supply.ts` answers which parts are hired, `hire.ts` answers for how long, and both
 * stopped there deliberately: a period times an invented rate is a price, and a price
 * nobody can trace is the thing this whole feature is written against. So this adds no
 * rate of its own. Every figure below is a stated rate times a quantity this engine
 * already derived, and where the project has stated no rate for a part the line carries
 * no money rather than a zero.
 *
 * ## Three costs, because they are three different events
 *
 * A hire charge is time-based and reversible: the panel goes back. A recharge is a
 * purchase nobody decided to make — a hired panel this pour drilled does not return as
 * stock, so the hire company invoices it at list. A consumable is spent. Summing the
 * three into one number is arithmetically fine and commercially useless: the first is
 * negotiable on programme, the second is avoidable by allocating owned stock to the
 * drilled work, and the third is fixed by the design. They are reported apart and
 * totalled as well, because a total is what a tender needs.
 *
 * Owned stock is deliberately absent from all three. A panel the yard already holds is
 * a sunk asset amortising over its life, and pricing it here needs a reuse count per
 * *panel type* which nothing in the catalog carries — `SheetStock.expectedReuses` exists
 * for sheets and `PanelType` has no equivalent. `ownedQuantity` is reported so a reader
 * can see what is excluded, which is the honest version of that gap: a total that
 * quietly priced owned panels at zero would make owning them look free, and one that
 * priced them at a guessed reuse count would be the untraceable figure this module is
 * written to avoid.
 *
 * ## The minimum hire period is most of the answer on a fast cycle
 *
 * A wall form struck in 12 hours against a 28-day minimum is charged for 28 days. That
 * is not a rounding — it is a 56× difference on that line, and it is the single most
 * common reason a hire invoice does not match a programme. So `minHireDays` is applied
 * per line, and `linesAtMinimum` names the lines it caught, because the remedy is a
 * planning decision: hold the set and pour more with it, or negotiate the term.
 *
 * ## Why the rate is not read from the catalog entry
 *
 * See `FormworkRateSettings`. The short version is that a price is a fact about a
 * project's commercial terms rather than about a product, and a rate shipped in seed
 * data would drift with the catalog edition while looking as authoritative as the
 * weights beside it.
 */

/** Rates by catalog id, plus the terms that apply across them. */
export interface RateTable {
  /** ISO 4217. Carried through so no figure is ever shown as a bare number. */
  currency?: string
  /** The agreement's minimum hire period, days. */
  minHireDays?: number
  byCatalogId: Readonly<Record<string, PartRate>>
}

/**
 * Why a line carries no money.
 *
 * Reported per line rather than folded into a single "incomplete" flag, because the two
 * have different remedies: a missing rate is a table somebody has to fill in, and an
 * unpriceable consumable is a rate that exists for a purchase the bill does not make.
 */
export type CostGap =
  /** No rate recorded against this catalog id. */
  | 'no-rate'
  /** Nothing to match a rate against — made on site, no catalog id. */
  | 'no-catalog-id'
  /** A rate exists but not the kind this line needs: hired, with no hire rate stated. */
  | 'no-rental-rate'
  /** Consumed or recharged, with no purchase price to charge it at. */
  | 'no-purchase-price'
  /**
   * Hired, and nothing ever strikes it, so there is no period to charge against.
   *
   * A tie is the case: it carries a catalog id and is standard stock, so the supply
   * split puts it on the hired side, and nothing strikes it because it is cut off inside
   * the wall. Neither answer is wrong on its own and together they leave a real cost
   * with no way to price it — reported rather than dropped, because a bill missing every
   * tie in a job still totals cleanly.
   */
  | 'hired-but-never-struck'

export const COST_GAP_LABELS: Record<CostGap, string> = {
  'no-rate': 'No rate recorded for this part',
  'no-catalog-id': 'Made on site, so no catalog rate can apply',
  'no-rental-rate':
    'Hired, but no hire rate recorded — state a monthly percentage of new value, or a flat rate',
  'no-purchase-price':
    'Needs a list price and none is recorded — the recharge on an altered hired part is charged at list',
  'hired-but-never-struck':
    'Drawn from stock but never struck, so there is no hire period to charge — a tie is cut off inside the wall rather than returned',
}

/** One bill line, priced. */
export interface CostLine {
  line: BomLine
  /** Hire for the period held, on the hired quantity. Absent where it cannot be priced. */
  hireCost?: number
  /** List price of hired parts this pour alters, which do not go back as stock. */
  rechargeCost?: number
  /** Purchase of what is spent — bespoke pieces and consumables. */
  consumedCost?: number
  /** The three above, where any of them priced. */
  totalCost?: number
  /**
   * The days actually charged, which is `minHireDays` where the period is shorter.
   *
   * The figure a reader checks an invoice against, and it is not `HireLine.hours / 24`
   * whenever a minimum bites — which on a wall form is almost always.
   */
  chargedDays?: number
  /** True where the minimum period, not the strike time, set `chargedDays`. */
  atMinimumPeriod?: boolean
  /** Why this line carries less money than its quantity suggests, or nothing. */
  gaps: CostGap[]
}

export interface BomCost {
  currency?: string
  lines: CostLine[]
  hireCost: number
  rechargeCost: number
  consumedCost: number
  /** The three above. Not a project cost: no labour, transport, finance or owned asset. */
  totalCost: number
  /**
   * Lines whose charge is the minimum period rather than the time held — where holding
   * the set longer costs nothing and striking sooner saves nothing.
   */
  linesAtMinimum: CostLine[]
  /**
   * Quantity the project owns and this total therefore excludes.
   *
   * Not a cost of zero. Owned formwork is a sunk asset amortising over a reuse count
   * nothing in this model carries, so it is named as excluded rather than priced.
   */
  ownedQuantityExcluded: number
  /**
   * False where any line could not be priced. The total is then the sum of what could
   * be, which is a floor rather than a price.
   */
  complete: boolean
  /** Every distinct reason a line went unpriced, for a reader who has to fix the table. */
  gaps: CostGap[]
}

/** Hire per unit per month: a stated flat rate, or a percentage of new value. */
function monthlyRate(rate: PartRate): number | undefined {
  // A quote beats a rule of thumb. `rentalPercentPerMonth` is trade guidance applied to
  // a list price; a flat rate is what a desk actually said, so it wins.
  if (rate.rentalPerUnitPerMonth !== undefined) return rate.rentalPerUnitPerMonth
  if (rate.purchasePerUnit === undefined || rate.rentalPercentPerMonth === undefined) {
    return undefined
  }
  return (rate.purchasePerUnit * rate.rentalPercentPerMonth) / 100
}

/** A month, for converting a monthly rate to the days a line is actually held. */
const DAYS_PER_MONTH = 30

/**
 * What a scope's bill costs to hold, given the project's rates.
 *
 * Takes the supply split and the hire periods rather than re-deriving either, so a
 * cost and the quantity it prices cannot disagree — the same discipline `bom-csv.ts`
 * follows about weights. `supply` is optional because it is absent where the project
 * has recorded no rack: without it there is no owned/hired split, and the honest
 * reading is that every returnable part is hired, which is what a project with rates
 * and no stock list has in fact said.
 */
export function bomCost(
  lines: readonly BomLine[],
  rates: RateTable,
  hire: BomHire,
  supply: BomSupply | undefined,
): BomCost {
  const bySupply = new Map<BomLine, SupplyLine>((supply?.lines ?? []).map((e) => [e.line, e]))
  const byHire = new Map<BomLine, HireLine>(hire.lines.map((e) => [e.line, e]))

  const costLines: CostLine[] = lines.map((line) => {
    const split = bySupply.get(line)
    const held = byHire.get(line)
    const gaps: CostGap[] = []

    // No split recorded means no rack recorded. Everything returnable is then hired,
    // which is not an assumption: a project that has stated rates and no stock has said
    // it owns none of this.
    const consumedQuantity = split?.consumedQuantity ?? 0
    const hiredQuantity = split ? split.hiredQuantity : isReturnable(line) ? line.quantity : 0
    const hiredModified = split ? split.hiredModifiedQuantity : 0
    const consumed = split ? consumedQuantity : isReturnable(line) ? 0 : line.quantity

    if (line.catalogId === undefined) {
      // A cut board and a site-made soldier. There is no id a rate could be keyed by, so
      // this is a permanent gap in the answer rather than a table somebody can fill in.
      // Reported whatever the line turned out to be: `bomSupply` treats an id-less part
      // as consumed, and a future reading that hires one must not become an unpriced line
      // with no gap against it.
      return { line, gaps: ['no-catalog-id'] }
    }
    const rate = rates.byCatalogId[line.catalogId]
    if (rate === undefined) {
      return { line, gaps: ['no-rate'] }
    }

    let hireCost: number | undefined
    let chargedDays: number | undefined
    let atMinimumPeriod: true | undefined
    if (hiredQuantity > 0) {
      const monthly = monthlyRate(rate)
      // A line nothing strikes has no period — a tie cast into the wall. It is not
      // hired for zero days, it is not hired: `bomSupply` already put ties on the hired
      // side by catalog id, and the honest reading is that a part never recovered is
      // spent. Charging it as a same-day hire is the error the null in `HireLine.hours`
      // exists to prevent.
      const days = held?.hours === undefined ? undefined : held.hours / 24
      if (monthly === undefined) gaps.push('no-rental-rate')
      else if (days === undefined) gaps.push('hired-but-never-struck')
      else {
        const minimum = rates.minHireDays ?? 0
        chargedDays = Math.max(days, minimum)
        if (chargedDays > days) atMinimumPeriod = true
        hireCost = monthly * (chargedDays / DAYS_PER_MONTH) * hiredQuantity
      }
    }

    let rechargeCost: number | undefined
    if (hiredModified > 0) {
      if (rate.purchasePerUnit === undefined) gaps.push('no-purchase-price')
      else rechargeCost = rate.purchasePerUnit * hiredModified
    }

    let consumedCost: number | undefined
    if (consumed > 0) {
      if (rate.purchasePerUnit === undefined) gaps.push('no-purchase-price')
      else consumedCost = rate.purchasePerUnit * consumed
    }

    const priced = [hireCost, rechargeCost, consumedCost].filter(
      (value): value is number => value !== undefined,
    )
    return {
      line,
      ...(hireCost === undefined ? {} : { hireCost }),
      ...(rechargeCost === undefined ? {} : { rechargeCost }),
      ...(consumedCost === undefined ? {} : { consumedCost }),
      ...(priced.length > 0 ? { totalCost: priced.reduce((a, b) => a + b, 0) } : {}),
      ...(chargedDays === undefined ? {} : { chargedDays }),
      ...(atMinimumPeriod ? { atMinimumPeriod } : {}),
      gaps,
    }
  })

  let hireCost = 0
  let rechargeCost = 0
  let consumedCost = 0
  const gaps = new Set<CostGap>()
  for (const entry of costLines) {
    hireCost += entry.hireCost ?? 0
    rechargeCost += entry.rechargeCost ?? 0
    consumedCost += entry.consumedCost ?? 0
    for (const gap of entry.gaps) gaps.add(gap)
  }

  return {
    ...(rates.currency === undefined ? {} : { currency: rates.currency }),
    lines: costLines,
    hireCost,
    rechargeCost,
    consumedCost,
    totalCost: hireCost + rechargeCost + consumedCost,
    linesAtMinimum: costLines.filter((entry) => entry.atMinimumPeriod),
    ownedQuantityExcluded: supply?.ownedQuantity ?? 0,
    complete: gaps.size === 0,
    gaps: [...gaps],
  }
}

/**
 * Whether a line comes back, for a caller with no supply split to consult.
 *
 * The same rule `bomSupply` applies, and the duplication is deliberate rather than a
 * shared helper: this is the *fallback* reading for a project with rates and no stock
 * list, and `bomSupply`'s version is the one that owns the pool arithmetic. A shared
 * predicate would suggest the two are one decision, and the day the pool logic gains a
 * case this must not silently follow it.
 */
function isReturnable(line: BomLine): boolean {
  return line.provenance !== 'bespoke' && line.kind !== 'consumable'
}

/**
 * A figure with its currency on it.
 *
 * In core rather than at each surface because a bare number is the failure: "1,240" is
 * a different claim in three currencies, and a takeoff read in one and priced in another
 * is the kind of error that survives every check in this module. Where the project has
 * not stated a currency the figure is shown as a plain number and the reader is told
 * nothing it cannot verify — which is why `currency` is asked for beside the rates.
 *
 * Rounded to whole units past a thousand, because pence on a £40,000 hire is precision
 * the inputs do not have.
 */
export function formatMoney(value: number, currency: string | undefined): string {
  const digits = Math.abs(value) >= 1000 ? 0 : 2
  if (currency === undefined) {
    return value.toLocaleString('en-GB', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  }
  return value.toLocaleString('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/**
 * What makes a priced bill wrong, in words.
 *
 * Separate from the figures for the same reason `projectFormworkCaveats` is: a cost
 * with no caveat beside it is quoted, and every one of these makes the total a floor
 * rather than a price. Ordered with the omissions first, because a reader who takes
 * this for a project cost is wrong by more than any gap in the table.
 */
export function bomCostCaveats(cost: BomCost): string[] {
  const out: string[] = []
  if (cost.lines.length === 0) return out
  out.push(
    'This is what the formwork costs to hold: hire, recharges and what is spent. It is not the cost of forming the job — there is no labour, no transport and no finance in it, and labour is normally the largest of those.',
  )
  if (cost.ownedQuantityExcluded > 0) {
    out.push(
      `${cost.ownedQuantityExcluded} parts come off the yard's own rack and are not priced here. Owned formwork is a sunk asset amortising over its reuses, and nothing in this model records how many reuses a panel type has left.`,
    )
  }
  if (!cost.complete) {
    const reasons = cost.gaps.map((gap) => COST_GAP_LABELS[gap].toLowerCase()).join('; ')
    out.push(`Some lines carry no money, so the total is a floor rather than a price — ${reasons}.`)
  }
  if (cost.linesAtMinimum.length > 0) {
    const count = cost.linesAtMinimum.length
    out.push(
      `${count} ${count === 1 ? 'line is' : 'lines are'} charged at the minimum hire period rather than for the time held, so striking sooner saves nothing on ${count === 1 ? 'it' : 'them'} — pouring more with the same set does.`,
    )
  }
  if (cost.rechargeCost > 0) {
    out.push(
      'The recharge is a purchase nobody decided to make: hired parts drilled or cut for this pour do not go back as stock. Allocating the yard’s own stock to the altered work removes it.',
    )
  }
  return out
}
