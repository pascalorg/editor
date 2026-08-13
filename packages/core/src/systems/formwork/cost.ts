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
 * ## Owned stock is charged, and it is charged as an internal hire rather than amortised
 *
 * A panel the yard already holds used to be absent from all three, on the grounds that
 * pricing a sunk asset needs a life in uses that nothing in the catalog carries. Excluding
 * it made owning formwork look free, which is the more misleading of the two errors, so an
 * owned part is charged at what the project itself says hiring one costs, for the period
 * the line is held: an internal hire, the way a plant department recharges its own sites.
 * That needs no life and no invented figure.
 *
 * **Where the project states a life, the charge is amortisation instead**, at
 * `(purchasePerUnit − residualPerUnit) / expectedUses` per fitting. The life is on the
 * rate table rather than in the catalog for the price's own reason — how hard a yard works
 * its plant is a commercial judgement, not a product fact — and it is *not* the set
 * count's `reuseFactor`, which says how many times this job fits a part and nothing about
 * how many fittings the part had left when it arrived. The multiplicand is the owned
 * quantity off the bill, which is total *fittings*: a panel fitted on three pours is three
 * in that quantity, and three uses is what this job took out of its life.
 *
 * The two bases are reported apart and totalled together, because they are not the same
 * claim: an amortised figure is a share of a purchase somebody already made, and a
 * recharge is a transfer price. A single owned total made of both is what a post-job
 * costing wants, and `ownedBasis` per line is what makes it auditable.
 *
 * It is deliberately **not** in `totalCost`, because it is not money leaving the business.
 * A tender wants the cash, and an internal costing wants both; putting them in one total
 * would produce a figure that is neither.
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
  /**
   * One delivery load, one way, and an hour of a mobile crane.
   *
   * Carried on the rate table rather than beside the payload and the cycle time they
   * multiply, for the gang rate's reason: they are money, and the currency they are
   * denominated in is stated once here. `logistics.ts` reads them; nothing in this module
   * does, because neither is a charge against a bill *line* — a lorry carries a mixed load
   * and a pick lifts a gang of several.
   */
  transportPerLoad?: number
  cranePerHour?: number
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

/**
 * How the yard's own stock on a line was charged.
 *
 * `amortised` needs a life and a price and is the figure an accountant recognises;
 * `recharge` needs neither and is a transfer price for the period held. Named per line
 * rather than per project because a rate table is filled in a part at a time: a yard that
 * has stated a life for its panels and not for its ties is charging both, differently.
 */
export type OwnedBasis = 'amortised' | 'recharge'

export const OWNED_BASIS_LABELS: Record<OwnedBasis, string> = {
  amortised: 'Amortised over its stated life in uses, less residual value',
  recharge: 'Recharged at the project’s own hire rate for the period held — no life stated',
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
  /**
   * What the yard's own stock on this line is worth holding, at the project's hire rate.
   *
   * An internal recharge rather than a cash cost, and outside `totalCost` for that reason.
   * The figure that answers "what did using our own plant on this job cost us" — which is
   * not zero, and was reported as nothing at all until this existed.
   */
  ownedCost?: number
  /** Which basis produced `ownedCost`. Absent where nothing owned was charged. */
  ownedBasis?: OwnedBasis
  /** Hire, recharge and consumed. Deliberately without `ownedCost` — that is not cash. */
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
  /** The three above. Not a project cost: no labour, transport or finance. */
  totalCost: number
  /**
   * The yard's own stock, charged at the project's own hire rate for the period held.
   *
   * Outside `totalCost` on purpose: it is a recharge between two parts of one business
   * rather than money spent. `totalCost + ownedCost` is what the job consumed in plant;
   * `totalCost` is what it costs to deliver. A tender needs the second and a post-job
   * costing needs both, and a single figure would serve neither.
   */
  ownedCost: number
  /** The share of `ownedCost` charged over a stated life. */
  ownedAmortisedCost: number
  /** The share charged at the project's own hire rate, for want of a life. */
  ownedRechargeCost: number
  /**
   * Lines whose charge is the minimum period rather than the time held — where holding
   * the set longer costs nothing and striking sooner saves nothing.
   */
  linesAtMinimum: CostLine[]
  /**
   * Quantity the project owns that still could not be charged at all.
   *
   * Was every owned part, when owned stock was excluded wholesale. Now only the ones with
   * no hire rate to charge them at — so a zero here means the internal recharge is complete
   * rather than that the yard owns nothing.
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

/**
 * What one fitting of an owned part costs, where the project stated a life for it.
 *
 * Both a price and a life or nothing: a life with no price cannot be divided into, and a
 * price with no life is the case the internal recharge exists for. Returning `undefined`
 * rather than 0 is the load-bearing part — a zero here would put an owned panel in the
 * answer at nothing, which is the error this whole block was written to remove.
 *
 * A residual above the price would make the charge negative — a part the job is paid to
 * use — so it is clamped at 0 rather than trusted.
 */
function perUseCost(rate: PartRate): number | undefined {
  if (rate.expectedUses === undefined || rate.purchasePerUnit === undefined) return undefined
  const recoverable = Math.min(rate.residualPerUnit ?? 0, rate.purchasePerUnit)
  return (rate.purchasePerUnit - recoverable) / rate.expectedUses
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

    const ownedQuantity = split?.ownedQuantity ?? 0
    const monthly = monthlyRate(rate)
    // A line nothing strikes has no period — a tie cast into the wall. It is not
    // hired for zero days, it is not hired: `bomSupply` already put ties on the hired
    // side by catalog id, and the honest reading is that a part never recovered is
    // spent. Charging it as a same-day hire is the error the null in `HireLine.hours`
    // exists to prevent.
    const days = held?.hours === undefined ? undefined : held.hours / 24

    let hireCost: number | undefined
    let chargedDays: number | undefined
    let atMinimumPeriod: true | undefined
    if (hiredQuantity > 0) {
      if (monthly === undefined) gaps.push('no-rental-rate')
      else if (days === undefined) gaps.push('hired-but-never-struck')
      else {
        const minimum = rates.minHireDays ?? 0
        chargedDays = Math.max(days, minimum)
        if (chargedDays > days) atMinimumPeriod = true
        hireCost = monthly * (chargedDays / DAYS_PER_MONTH) * hiredQuantity
      }
    }

    // The yard's own parts, at the project's own hire rate for the period they are held —
    // an internal recharge. No minimum period: that is a term of an agreement with a hire
    // company, and a yard does not charge itself a penalty for striking early. A line with
    // no period is left uncharged for the same reason a hired one is.
    let ownedCost: number | undefined
    let ownedBasis: OwnedBasis | undefined
    if (ownedQuantity > 0) {
      const perUse = perUseCost(rate)
      if (perUse !== undefined) {
        // No period and no minimum in it: amortisation is per fitting, so a part held over
        // a weekend costs what it costs used once. That is the whole difference between a
        // life and a hire term, and it is why the two bases are named rather than summed
        // into one figure a reader would have to reverse-engineer.
        ownedCost = perUse * ownedQuantity
        ownedBasis = 'amortised'
      } else if (monthly === undefined) gaps.push('no-rental-rate')
      else if (days === undefined) gaps.push('hired-but-never-struck')
      else {
        ownedCost = monthly * (days / DAYS_PER_MONTH) * ownedQuantity
        ownedBasis = 'recharge'
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
      ...(ownedCost === undefined ? {} : { ownedCost }),
      ...(ownedBasis === undefined ? {} : { ownedBasis }),
      ...(priced.length > 0 ? { totalCost: priced.reduce((a, b) => a + b, 0) } : {}),
      ...(chargedDays === undefined ? {} : { chargedDays }),
      ...(atMinimumPeriod ? { atMinimumPeriod } : {}),
      gaps,
    }
  })

  let hireCost = 0
  let rechargeCost = 0
  let consumedCost = 0
  let ownedCost = 0
  let ownedAmortisedCost = 0
  let ownedRechargeCost = 0
  let ownedQuantityExcluded = 0
  const gaps = new Set<CostGap>()
  for (const entry of costLines) {
    hireCost += entry.hireCost ?? 0
    rechargeCost += entry.rechargeCost ?? 0
    consumedCost += entry.consumedCost ?? 0
    ownedCost += entry.ownedCost ?? 0
    if (entry.ownedBasis === 'amortised') ownedAmortisedCost += entry.ownedCost ?? 0
    if (entry.ownedBasis === 'recharge') ownedRechargeCost += entry.ownedCost ?? 0
    const owned = bySupply.get(entry.line)?.ownedQuantity ?? 0
    if (owned > 0 && entry.ownedCost === undefined) ownedQuantityExcluded += owned
    for (const gap of entry.gaps) gaps.add(gap)
  }

  return {
    ...(rates.currency === undefined ? {} : { currency: rates.currency }),
    lines: costLines,
    hireCost,
    rechargeCost,
    consumedCost,
    totalCost: hireCost + rechargeCost + consumedCost,
    ownedCost,
    ownedAmortisedCost,
    ownedRechargeCost,
    linesAtMinimum: costLines.filter((entry) => entry.atMinimumPeriod),
    ownedQuantityExcluded,
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
  if (cost.ownedCost > 0) {
    const both = cost.ownedAmortisedCost > 0 && cost.ownedRechargeCost > 0
    const basis = both
      ? `${formatMoney(cost.ownedAmortisedCost, cost.currency)} of it amortised over the lives the project stated and ${formatMoney(cost.ownedRechargeCost, cost.currency)} recharged at the project's own hire rate for the period held, so the figure combines two bases`
      : cost.ownedAmortisedCost > 0
        ? 'amortised over the lives the project stated — the purchase less its residual value, divided by the uses it is expected to give, per fitting this job made of it'
        : "charged at the project's own hire rate for the period held"
    out.push(
      `${formatMoney(cost.ownedCost, cost.currency)} of that is the yard's own stock, ${basis}, and it is not in the total. It is what using owned plant cost this job rather than money leaving the business — real enough that owning formwork is not free, and not cash a tender can be built on.`,
    )
  }
  if (cost.ownedQuantityExcluded > 0) {
    out.push(
      `${cost.ownedQuantityExcluded} parts off the yard's own rack could not be charged at all, because there is no hire rate to charge them at or nothing strikes them. Those parts appear in this job at nothing, which makes owning them look free.`,
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
