import { type BomLine, type FormworkPartKind, KIND_ORDER } from './parts'

/**
 * What it takes to put the formwork up and take it down again — the cost every
 * other module in this folder deliberately left out.
 *
 * `supply.ts` says which parts are hired, `hire.ts` for how long, `cost.ts` what that
 * costs, and all three carry the same caveat: this is what the formwork costs to
 * *hold*, not what it costs to *form* the job, and labour is normally the largest of
 * the things outside it. That caveat has been on every surface of this feature since
 * the money arrived, which makes it the biggest single gap in the answer rather than a
 * footnote. This closes it.
 *
 * ## The norms are the project's, and there is deliberately no shipped table
 *
 * This is the decision the module exists to record, and it goes further than the one
 * `FormworkRateSettings` records about prices.
 *
 * A weight has a manufacturer's table behind it. A striking period has a code's table
 * behind it. Published labour constants also exist — CPWD's Analysis of Rates prints
 * carpenter and mazdoor days per 10 m² of shuttering, Spon's and RSMeans print hours
 * per m² and daily crew outputs — and none of them is a table this engine can apply.
 * Two reasons, and the second is the decisive one:
 *
 * 1. They are per m² of a whole trade operation, priced as one item that already
 *    contains the backing, the props, the ties and the strike. A bill here is per
 *    *part*, so applying a per-m² constant to a panel line and a waler line would
 *    charge the same work twice — and applying it once to an area would throw away
 *    the only quantities this engine actually derived.
 * 2. An output norm is a fact about a **gang**, not about a product or a code. The same
 *    crew on its tenth identical floor fits panels at twice the rate it managed on its
 *    first, and two contractors in one city working from the same price book book
 *    different hours against the same wall. There is nothing conservative to fall back
 *    to, exactly as with a price, and a shipped figure would look as authoritative as
 *    the weights beside it while being a guess about someone else's crew.
 *
 * So a project states its own norms and this multiplies. Where a kind carries no norm
 * the line carries no hours rather than a zero, and `unnormedFittings` says how much of
 * the bill the answer does not cover — a total over half a bill is a floor, and a floor
 * presented as a figure is the thing this whole feature is written against.
 *
 * ## Per fitting, not per part owned
 *
 * The join is `BomLine.quantity`, and the reason it works is that a project bill is
 * built from every shutter's parts: a panel type fitted on three pours contributes
 * three times, so the quantity is already total *fittings* across the job rather than
 * the number of panels standing at once. That is the right multiplicand — a gang is
 * paid to fit a panel each time it fits it — and it is the opposite of what `sets.ts`
 * reports, where the peak is what to order. Never cross the two: a set count times a
 * norm is the labour of forming the job once.
 *
 * ## Erect and strike are separate, because they are different operations
 *
 * Not a factor on one figure, and not symmetric. Striking is faster than erecting on
 * most parts and slower on a few — a tie is a spanner one way and a cut rod, a patched
 * cone and a made-good face the other — and the two happen weeks apart to different
 * halves of a bill: the deck comes off in four days and the props under it stay ten. A
 * single "handling" figure could not answer what comes off when, and a strike derived
 * by halving an erect would be a second invented number on top of the first.
 *
 * A project may state one and not the other, and that is reported (`erect-only`,
 * `strike-only`) rather than filled in. Half of a two-part operation is a floor.
 *
 * ## What is not in here, and why it is said rather than approximated
 *
 * No cleaning, no moving between pours, no setting out, no scaffold, no waiting on
 * concrete, no travel, no supervision, no preliminaries. Each of those is real and none
 * has a quantity anywhere in this model to hang off. And no gang size, which is the one
 * worth stating twice: man-hours are not a duration, and 400 hours is 400 hours rather
 * than ten days until somebody says how many people are on it.
 */

/** Hours to fit one, and hours to take it off again. Either may be unstated. */
export interface LabourNorm {
  /** Man-hours to fit one of these, once. */
  erectHours?: number
  /** Man-hours to strike one of these — not the erect reversed. */
  strikeHours?: number
}

/** The project's own output norms, plus what an hour of the gang costs. */
export interface NormTable {
  byPartKind: Readonly<Partial<Record<FormworkPartKind, LabourNorm>>>
  /** What one man-hour costs, all-in for the gang. Absent means hours with no money. */
  gangRatePerHour?: number
  /**
   * ISO 4217, taken from the project's rates rather than stated again here.
   *
   * One currency for the project rather than one per cost, because a takeoff whose hire
   * is in one and whose labour is in another totals to a number that is not money.
   */
  currency?: string
}

/**
 * Why a line carries fewer hours than its quantity suggests.
 *
 * Per line rather than one flag, for `CostGap`'s reason: the remedies differ. A missing
 * norm is a row somebody fills in, and a line measured in litres cannot take a
 * per-fitting norm at all however complete the table gets.
 */
export type LabourGap =
  /** No norm recorded against this part kind. */
  | 'no-norm'
  /** Hours to erect, and none stated to strike — half of the operation. */
  | 'erect-only'
  /** Hours to strike, and none stated to erect. */
  | 'strike-only'
  /**
   * Measured in its own unit rather than counted, so a per-fitting norm cannot apply.
   *
   * A drum of release agent is 12 litres and applying it is real labour, but "hours per
   * fitting" has no meaning against a litre. Reported rather than multiplied, because
   * 12 × an hours-per-panel figure is a number with no interpretation.
   */
  | 'not-counted-in-fittings'
  /** Hours derived, and no gang rate to turn them into money. */
  | 'no-gang-rate'

export const LABOUR_GAP_LABELS: Record<LabourGap, string> = {
  'no-norm': 'No output norm recorded for this kind of part',
  'erect-only': 'Hours to erect are recorded and hours to strike are not — this is half the job',
  'strike-only': 'Hours to strike are recorded and hours to erect are not — this is half the job',
  'not-counted-in-fittings':
    'Measured in its own unit rather than counted, so an hours-per-fitting norm cannot apply',
  'no-gang-rate': 'No gang rate recorded, so the hours carry no money',
}

/** One bill line's labour. */
export interface LabourLine {
  line: BomLine
  /** Man-hours to fit every one of them, once each. */
  erectHours?: number
  /** Man-hours to strike them. */
  strikeHours?: number
  /** Both, where both are stated. Absent where either is. */
  totalHours?: number
  /** The hours at the project's gang rate. */
  cost?: number
  gaps: LabourGap[]
}

/**
 * One part kind's labour across the scope — the readout worth showing.
 *
 * A bill has two hundred lines and a gang has five operations, so a per-line table
 * answers "how long does this line take" and nothing about where the time goes. Sorted
 * by hours rather than by bill order for that reason: the kind at the top is the one
 * worth changing the design over.
 */
export interface KindLabour {
  kind: FormworkPartKind
  /** Fittings across the whole scope — the multiplicand, not a stock count. */
  fittings: number
  erectHours: number
  strikeHours: number
  totalHours: number
  cost?: number
}

export interface BomLabour {
  currency?: string
  lines: LabourLine[]
  /** Per kind, most hours first. */
  byKind: KindLabour[]
  erectHours: number
  strikeHours: number
  /** Erect and strike. Man-hours, not a duration — no gang size exists in this model. */
  totalHours: number
  /** The hours at the gang rate, or absent where no rate is recorded. */
  cost?: number
  /**
   * Fittings the answer does not cover, because their kind has no norm.
   *
   * The figure that says whether the total is a price or a fragment. A bill whose panels
   * are normed and whose ties are not has an hours figure that reads complete and is
   * short by every tie in the job.
   */
  unnormedFittings: number
  /** Which kinds those were, so a reader knows what to fill in. */
  unnormedKinds: FormworkPartKind[]
  /** False where any line went without hours. The total is then a floor. */
  complete: boolean
  gaps: LabourGap[]
}

/**
 * The gang's hours for a bill, given the project's own norms.
 *
 * Takes the bill rather than the parts, so the quantities are the same ones the order and
 * the money are derived from — the discipline `bomCost` follows about the supply split.
 */
export function bomLabour(lines: readonly BomLine[], norms: NormTable): BomLabour {
  const rate = norms.gangRatePerHour
  const unnormed = new Map<FormworkPartKind, number>()
  const gaps = new Set<LabourGap>()

  const labourLines: LabourLine[] = lines.map((line) => {
    // A line counted in litres, metres or square metres. `bomLines` puts a consumable's
    // own unit on the line and `no` on everything else, so this is the whole test.
    if (line.unit !== 'no') {
      gaps.add('not-counted-in-fittings')
      return { line, gaps: ['not-counted-in-fittings'] }
    }
    const norm = norms.byPartKind[line.kind]
    if (norm === undefined || (norm.erectHours === undefined && norm.strikeHours === undefined)) {
      unnormed.set(line.kind, (unnormed.get(line.kind) ?? 0) + line.quantity)
      gaps.add('no-norm')
      return { line, gaps: ['no-norm'] }
    }

    const lineGaps: LabourGap[] = []
    if (norm.strikeHours === undefined) lineGaps.push('erect-only')
    if (norm.erectHours === undefined) lineGaps.push('strike-only')
    const erectHours = norm.erectHours === undefined ? undefined : norm.erectHours * line.quantity
    const strikeHours =
      norm.strikeHours === undefined ? undefined : norm.strikeHours * line.quantity
    // The sum of what is stated, rather than absent until both are. A line with an erect
    // norm and no strike has really been worked for those hours, and withholding the
    // figure would put the same line in `unnormedFittings` as one nobody normed at all.
    const totalHours = (erectHours ?? 0) + (strikeHours ?? 0)
    if (rate === undefined) lineGaps.push('no-gang-rate')
    for (const gap of lineGaps) gaps.add(gap)
    return {
      line,
      ...(erectHours === undefined ? {} : { erectHours }),
      ...(strikeHours === undefined ? {} : { strikeHours }),
      totalHours,
      ...(rate === undefined ? {} : { cost: totalHours * rate }),
      gaps: lineGaps,
    }
  })

  const kinds = new Map<FormworkPartKind, KindLabour>()
  for (const entry of labourLines) {
    if (entry.totalHours === undefined) continue
    const existing = kinds.get(entry.line.kind)
    const kind = existing ?? {
      kind: entry.line.kind,
      fittings: 0,
      erectHours: 0,
      strikeHours: 0,
      totalHours: 0,
    }
    kind.fittings += entry.line.quantity
    kind.erectHours += entry.erectHours ?? 0
    kind.strikeHours += entry.strikeHours ?? 0
    kind.totalHours += entry.totalHours
    if (rate !== undefined) kind.cost = kind.totalHours * rate
    if (!existing) kinds.set(entry.line.kind, kind)
  }

  const erectHours = labourLines.reduce((total, entry) => total + (entry.erectHours ?? 0), 0)
  const strikeHours = labourLines.reduce((total, entry) => total + (entry.strikeHours ?? 0), 0)
  const totalHours = erectHours + strikeHours
  return {
    ...(norms.currency === undefined ? {} : { currency: norms.currency }),
    lines: labourLines,
    byKind: [...kinds.values()].sort(
      // Hours first, then the bill's own order, so two kinds on equal hours do not swap
      // places between two reads of the same job.
      (a, b) =>
        b.totalHours - a.totalHours || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    ),
    erectHours,
    strikeHours,
    totalHours,
    ...(rate === undefined ? {} : { cost: totalHours * rate }),
    unnormedFittings: [...unnormed.values()].reduce((total, quantity) => total + quantity, 0),
    unnormedKinds: [...unnormed.keys()].sort(
      (a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b),
    ),
    complete: gaps.size === 0,
    gaps: [...gaps],
  }
}

/**
 * What makes an hours figure wrong, in words.
 *
 * Separate from the figures for `bomCostCaveats`'s reason, and needed harder here: an
 * hours total looks like a programme, reads like a duration, and is neither.
 */
export function bomLabourCaveats(labour: BomLabour): string[] {
  const out: string[] = []
  if (labour.lines.length === 0) return out
  out.push(
    'These are man-hours from the norms this project stated, not a duration. Nothing here knows the gang size, so this is how much work there is rather than how long it takes — dividing it by a crew is the reader’s decision, and the two are not the same number once striking and erecting fall in different weeks.',
  )
  out.push(
    'Erecting and striking only. No cleaning, no moving the set between pours, no setting out, no access scaffold, no waiting on concrete and no travel — a gang books all of those against the same job.',
  )
  out.push(
    'A norm is an average, and nothing here applies a learning curve: the first fitting of a system takes materially longer than the tenth, so a job with little repetition is understated by these figures and a repetitive one is overstated.',
  )
  if (labour.unnormedFittings > 0) {
    const kinds = labour.unnormedKinds.join(', ')
    out.push(
      `${labour.unnormedFittings} fittings carry no norm at all — ${kinds} — so this total is a floor rather than the work in the job, and it is short by every one of them.`,
    )
  }
  if (labour.gaps.includes('erect-only') || labour.gaps.includes('strike-only')) {
    out.push(
      'Some kinds have hours for one half of the operation and not the other, so those lines are counted for the erect or the strike alone. Striking is not the erect reversed — a tie is a spanner one way and a cut rod, a patched cone and a made-good face the other.',
    )
  }
  if (labour.gaps.includes('not-counted-in-fittings')) {
    out.push(
      'Lines measured in litres, metres or square metres carry no hours: applying release agent is real work, and an hours-per-fitting norm has no meaning against a litre.',
    )
  }
  if (labour.cost === undefined) {
    out.push(
      'No gang rate is recorded, so this is hours with no money against it. An all-in rate per man-hour is what turns it into a cost.',
    )
  } else {
    out.push(
      'The money is the gang’s time at the project’s stated rate. It is not the cost of the trade: no supervision, no plant, no overheads and no preliminaries are in it.',
    )
  }
  return out
}
