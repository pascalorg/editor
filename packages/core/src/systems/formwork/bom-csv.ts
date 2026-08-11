import { ACQUIRE_GAP_LABELS, ACQUIRE_VERDICT_LABELS, type FormworkAcquisition } from './acquire'
import { COMMITMENT_GAP_LABELS, type FormworkCommitments } from './commitments'
import { type BomCost, COST_GAP_LABELS, type CostLine } from './cost'
import { STRIKE_TARGET_LABELS, STRIKING_STANDARD_LABELS } from './design/striking'
import type { BomHire, HireLine } from './hire'
import { type BomLabour, LABOUR_GAP_LABELS } from './labour'
import { type BomLine, PART_KIND_LABELS } from './parts'
import { type FormworkResequence, RESEQUENCE_REFUSAL_LABELS } from './resequence'
import {
  type FormworkSchedule,
  SCHEDULE_GAP_LABELS,
  scheduleInPourOrder,
  scheduleOccupancyDays,
} from './schedule'
import { type FormworkSequence, PRECEDENCE_REASON_LABELS, SEQUENCE_GAP_LABELS } from './sequence'
import { type FormworkSetCount, SET_COUNT_GAP_LABELS } from './sets'
import type { BomSupply, SupplyLine } from './supply'

/**
 * A bill of materials as a file somebody can open.
 *
 * The last step between a bill on a screen and a bill a yard acts on, and it is a
 * serialiser rather than engine work: `bomLines` already produced the rows, and
 * everything here is about not corrupting them on the way out.
 *
 * Two things this deliberately does *not* do. It does not re-derive a quantity, a
 * weight or a total — every figure is carried from the lines it was given, so a CSV
 * and the panel above it cannot disagree. And it does not silently fill an unknown
 * weight with 0: a line whose parts have no published weight leaves the cell empty
 * and the total row says so, because a spreadsheet that sums a fabricated zero
 * produces a lifting weight nobody can check and everybody trusts.
 */

/** What a bill covers, so the file says what it is a bill *of*. */
export interface BomCsvScope {
  /** How the takeoff was scoped, e.g. "Wall wall_1" or "Project". */
  subject: string
  /** Elements the takeoff covers, where it covers more than one. */
  elementCount?: number
  /** Shutters the takeoff covers — a pour count, not an element count. */
  shutterCount?: number
  /**
   * Anything that makes the figures below incomplete, verbatim. An element formed
   * for fewer pours than it is cast in bills short, and every line in the file still
   * looks correct on its own, so the warning travels *inside* the file rather than
   * only in the UI that produced it.
   */
  caveats?: readonly string[]
  /**
   * Where the parts come from, where the project has said what it owns.
   *
   * Absent leaves the three columns off the file entirely rather than emptying them.
   * A blank cell in a spreadsheet is read as nothing to hire, and a column of blanks
   * under "Hire" is the most confident wrong answer this file could give — so the
   * question is not asked in the header unless there is an answer to it.
   */
  supply?: BomSupply
  /**
   * How long each line is held, where the caller has solved it.
   *
   * Optional here even though `ProjectFormwork.hire` never is, because this
   * serialiser also takes a bare list of lines from a caller with no project settings
   * to read — an element-scope export. Where it is given, it adds one column and a
   * preamble row naming the standard, so a reader can tell 10 calendar days from 10
   * qualifying days above 10 °C without opening the code.
   */
  hire?: BomHire
  /**
   * What the scope costs to hold, where the project has recorded rates.
   *
   * Absent leaves every money column off, for a stronger version of the reason the
   * supply columns come and go: a blank cell under "Hire cost" reads as free, and a
   * spreadsheet will sum a column of blanks into a total somebody puts in a tender.
   * A gap column travels beside the figures rather than only in the preamble, because
   * a row that carries no money has to say why in the row.
   */
  cost?: BomCost
  /**
   * The gang's hours, where the project has stated its own output norms.
   *
   * A preamble block rather than columns, and the join is the reason: a norm is per part
   * *kind* and a bill line is per catalog id, so the hours against a 0.6 m panel and a
   * 0.9 m one come off the same figure and a per-line column would print the same norm
   * forty times. The block below carries the per-kind readout instead, which is the one
   * that says where the time goes.
   *
   * Kept apart from the cost block on purpose. These are man-hours and, where a rate
   * exists, the gang's money — negotiated with different people from the hire desk and
   * moving for different reasons, so the two never sum into one figure here.
   */
  labour?: BomLabour
  /**
   * When the pours happen, where the project has dated any of them.
   *
   * The one block here that is deliberately **not** a set of line columns, and the
   * reason is the join rather than taste: a bill line spans pours. The same panel type
   * on a wall poured in March and one poured in May is one row, and a "Pour date" cell
   * on it could only hold one of the two — so the dates go in the preamble, per pour,
   * where a row means a pour rather than a product.
   */
  schedule?: FormworkSchedule
  /**
   * How many of each thing the job needs at once, where the programme supports counting.
   *
   * A preamble block for the same reason the dates are, and one more: a peak is not a
   * property of a line at all. A line's quantity is what passes through the job and a peak is
   * what stands on one day, so a "Peak" cell beside a quantity of 400 would invite the
   * subtraction — and 400 less a peak of 100 is not 300 of anything.
   */
  sets?: FormworkSetCount
  /**
   * What the yard has to go out and get, where a peak and a rack both exist.
   *
   * A preamble block for the sets' reason and one of its own: this is the block most likely
   * to be read against a column it must not be read against. "To hire" splits the bill and
   * this compares the rack against the peak day, so on a sequential programme the shortfall
   * is a fraction of the hired quantity — and a reader who takes the larger figure orders
   * several times what the job needs at once.
   */
  acquisition?: FormworkAcquisition
  /**
   * What has to happen before what, and how far each pour can move.
   *
   * A preamble block per *pour*, like the programme it is measured against — a dependency is
   * between two pours and a bill line spans them, so there is no line to put it on. The float
   * column is the one thing in this file that could be mistaken for a promise, so the header
   * names it an allowance and the caveats say it is not a critical path.
   */
  sequence?: FormworkSequence
  /**
   * Which pour to move instead of acquiring, where a shortage has an answer.
   *
   * The only block in this file that proposes a change to the project rather than reporting one,
   * so it is placed after the acquisition it is an alternative to and every row carries the peak
   * it would leave behind. A move with no "after" figure beside it reads as free.
   */
  resequence?: FormworkResequence
  /**
   * What is booked, where anybody has committed to a pour date.
   *
   * The one block in this file whose figures are deliberately *smaller* than the block above
   * it, and the only place that matters is a spreadsheet: a reader who sorts on quantity finds
   * a committed 40 beside a peak of 120 and takes the difference for a shortfall. So the block
   * is last, its header says what it is not, and the quantity column is named "Committed" with
   * no "Peak" anywhere near it.
   */
  commitments?: FormworkCommitments
}

/**
 * Escapes one cell.
 *
 * Quoted whenever the value contains a comma, a quote, a newline or leading and
 * trailing space, which is the RFC 4180 rule. Marks and catalog ids do not need it
 * and descriptions do — "Board, 2400 × 200 cut on site" is one cell and four
 * columns if this is skipped.
 */
function cell(value: string | number | undefined): string {
  if (value === undefined) return ''
  const text = String(value)
  if (text === '') return ''
  return /[",\n\r]/.test(text) || text.trim() !== text ? `"${text.replaceAll('"', '""')}"` : text
}

const HEADER = [
  'Mark count',
  'Kind',
  'Description',
  'Catalog id',
  'Condition',
  'Quantity',
  'Unit',
  'Weight kg',
  'Marks',
] as const

/**
 * Where the quantity comes from, following the quantity when the project has a rack.
 *
 * Three columns rather than one label because a line is normally split — 26 needed
 * against 20 owned is two numbers, and the row a yard acts on says both.
 */
const SUPPLY_HEADER = ['From own stock', 'To hire', 'Consumed'] as const

/**
 * How long the line is held, and as what.
 *
 * Two columns because the number alone is not actionable: 10 days is the answer for
 * the props under a slab and 4 for the deck over them, and a reader who cannot see
 * which is which has no way to check the figure against the drawing.
 */
const HIRE_HEADER = ['Days held', 'Struck as'] as const

/**
 * What the line costs, and why it may cost nothing.
 *
 * `Days charged` sits beside `Days held` rather than replacing it because the two
 * differ whenever a minimum hire period bites — which on a wall form is almost always
 * — and it is the difference that a reader checks an invoice against. The three costs
 * stay apart because they are three events with three remedies, and `Cost gap` is the
 * column that stops an unpriced line reading as a free one.
 */
const costHeader = (currency: string | undefined): string[] => {
  const money = currency === undefined ? 'cost' : `cost ${currency}`
  return [
    'Days charged',
    `Hire ${money}`,
    `Recharge ${money}`,
    `Purchase ${money}`,
    `Line ${money}`,
    // After the line total rather than before it, so a reader summing leftward across the
    // money columns reaches the total without this in it. It is an internal recharge.
    `Own stock ${money} (not in line)`,
    'Cost gap',
  ]
}

/**
 * Why a line's parts are what they are, in the yard's terms rather than the type's.
 *
 * `modified` is the one worth spelling out: a panel drilled for this pour is the
 * catalog item on the delivery note and no longer the catalog item in the yard, and
 * a bill that reads "standard" against it is how a drilled panel goes back on the
 * rack.
 */
const CONDITION_LABELS = {
  standard: 'stock, as supplied',
  modified: 'stock, altered for this pour',
  bespoke: 'made for this pour',
} as const

const round2 = (value: number): number => Math.round(value * 100) / 100

/**
 * The bill as CSV: a preamble naming the scope, the lines, and a total row.
 *
 * The marks travel in the last column, space-separated, because a quantity nobody
 * can trace back to a position on a drawing is a number to argue about on site. They
 * are last so a reader can ignore the column without scrolling past it.
 */
export function bomCsv(lines: readonly BomLine[], scope: BomCsvScope): string {
  const rows: string[] = []

  rows.push(['Formwork bill of materials', cell(scope.subject)].join(','))
  if (scope.elementCount !== undefined) {
    rows.push(['Elements', scope.elementCount].join(','))
  }
  if (scope.shutterCount !== undefined) {
    // Named as pours rather than shutters because it is the count of times a
    // shutter is erected and struck, which is what the number is useful for.
    rows.push(['Pours', scope.shutterCount].join(','))
  }
  for (const caveat of scope.caveats ?? []) {
    rows.push(['INCOMPLETE', cell(caveat)].join(','))
  }
  const supply = scope.supply
  if (supply && supply.hiredModifiedQuantity > 0) {
    // A cell rather than only the prose caveat, because this is the figure a quantity
    // surveyor prices and prose is not something a spreadsheet can multiply.
    rows.push(
      ['Hired parts altered here — recharged at list', supply.hiredModifiedQuantity].join(','),
    )
  }
  if (supply && supply.hiredWeightKg !== undefined) {
    // A hire is charged against what is held, so the tonnage on hire is a different
    // figure from the tonnage on site and it is the one a hire desk quotes from.
    rows.push(['On hire kg', round2(supply.hiredWeightKg)].join(','))
  }
  const hire = scope.hire
  if (hire) {
    // Which clock, before any period below it. Under ACI these are cumulative hours
    // above 10 °C rather than calendar days, and a programme written off the wrong one
    // strikes early in a cold spring.
    rows.push(['Striking standard', cell(STRIKING_STANDARD_LABELS[hire.standard])].join(','))
    rows.push(['Longest period held d', round2(hire.longestHours / 24)].join(','))
    for (const period of hire.periods) {
      rows.push(
        [
          cell(`Period — ${STRIKE_TARGET_LABELS[period.target]}`),
          round2(period.days),
          cell(period.governingRule),
        ].join(','),
      )
    }
    for (const assumption of hire.assumed) {
      // An assumed input is not a caveat about the bill, so it is not an INCOMPLETE row
      // — but a period taken from a table's own default column is a different claim
      // from one the job stated, and only this row says which.
      rows.push(['ASSUMED', cell(assumption.message)].join(','))
    }
  }
  const cost = scope.cost
  if (cost) {
    // Before any figure, because this is the row that decides what the money below is.
    // A reader who takes this for the cost of forming the job is wrong by more than
    // every gap in the rate table put together — labour is normally the largest cost
    // and there is none of it in here.
    rows.push(
      [
        'Cost basis',
        cell(
          scope.labour === undefined
            ? 'formwork held only — hire, recharges and what is spent. No labour, transport or finance'
            : 'formwork held only — hire, recharges and what is spent. No transport or finance. The gang’s time is in the LABOUR block below and is deliberately not in this total',
        ),
      ].join(','),
    )
    if (cost.currency !== undefined) rows.push(['Currency', cell(cost.currency)].join(','))
    rows.push(['Hire cost', round2(cost.hireCost)].join(','))
    if (cost.rechargeCost > 0) {
      rows.push(['Recharge cost — altered hire at list', round2(cost.rechargeCost)].join(','))
    }
    if (cost.consumedCost > 0)
      rows.push(['Purchase cost — consumed', round2(cost.consumedCost)].join(','))
    rows.push(
      [
        cost.complete ? 'TOTAL COST' : 'TOTAL COST — a floor, not a price',
        round2(cost.totalCost),
      ].join(','),
    )
    if (cost.ownedCost > 0) {
      // Below the total and labelled as outside it, because a spreadsheet reader adds
      // adjacent money columns. This is the yard's own plant charged at the yard's own
      // rate — a recharge between two parts of one business rather than cash spent.
      rows.push(
        ['Own stock at internal hire rate — not in the total', round2(cost.ownedCost)].join(','),
      )
    }
    if (cost.ownedQuantityExcluded > 0) {
      // A zero here has to keep meaning "the internal recharge is complete", so this counts
      // only the owned parts with no rate to charge them at — which appear in this job at
      // nothing, and a spreadsheet cannot tell that zero from one that means free.
      rows.push(
        ['Owned parts that could not be charged at all', cost.ownedQuantityExcluded].join(','),
      )
    }
    if (cost.linesAtMinimum.length > 0) {
      rows.push(['Lines charged at the minimum hire period', cost.linesAtMinimum.length].join(','))
    }
    for (const gap of cost.gaps) {
      rows.push(['UNPRICED', cell(COST_GAP_LABELS[gap])].join(','))
    }
  }
  const labour = scope.labour
  if (labour && labour.lines.length > 0) {
    rows.push('')
    // The basis before the hours, as the cost block does, and against a harder
    // misreading: an hours total looks like a programme. Nothing in this model knows the
    // gang size, so this is how much work there is rather than how long it takes.
    rows.push(
      [
        'LABOUR',
        cell(
          'Man-hours from this project’s own output norms — erecting and striking only. Not a duration: nothing here knows the gang size, so dividing by a crew is the reader’s decision. Not in the cost total above',
        ),
      ].join(','),
    )
    rows.push(['Erect man-hours', round2(labour.erectHours)].join(','))
    rows.push(['Strike man-hours', round2(labour.strikeHours)].join(','))
    rows.push(
      [
        labour.complete ? 'TOTAL MAN-HOURS' : 'TOTAL MAN-HOURS — a floor, not the work in the job',
        round2(labour.totalHours),
      ].join(','),
    )
    if (labour.cost !== undefined) {
      rows.push(
        [
          cell(
            labour.currency === undefined
              ? 'Labour cost at the gang rate — not in the cost total above'
              : `Labour cost ${labour.currency} at the gang rate — not in the cost total above`,
          ),
          round2(labour.cost),
        ].join(','),
      )
    }
    // Per kind rather than per line, because a norm is stated per kind: a bill's forty
    // panel rows come off one figure, and this is the readout that says which operation
    // the job's hours are actually in.
    rows.push(['Operation', 'Fittings', 'Erect h', 'Strike h', 'Total h', 'Cost'].join(','))
    for (const kind of labour.byKind) {
      rows.push(
        [
          cell(PART_KIND_LABELS[kind.kind]),
          kind.fittings,
          round2(kind.erectHours),
          round2(kind.strikeHours),
          round2(kind.totalHours),
          kind.cost === undefined ? '' : round2(kind.cost),
        ].join(','),
      )
    }
    if (labour.unnormedFittings > 0) {
      // The row that decides whether the total above is a figure or a fragment. A bill
      // whose panels are normed and whose ties are not is short by every tie in the job,
      // and nothing in the rows themselves shows it.
      rows.push(
        [
          'INCOMPLETE',
          cell(
            `${labour.unnormedFittings} fittings carry no norm at all (${labour.unnormedKinds.join(', ')}), so the hours above are short by every one of them`,
          ),
        ].join(','),
      )
    }
    for (const gap of labour.gaps.filter((entry) => entry !== 'no-norm')) {
      rows.push(['UNNORMED', cell(LABOUR_GAP_LABELS[gap])].join(','))
    }
  }
  const schedule = scope.schedule
  if (schedule) {
    // The window first, because it is the figure a delivery is booked against and the one
    // a reader takes away. `Plant on site d` is arrival to release across every pour, and
    // it is deliberately not the hire's `Longest period held` above it: a set used on five
    // pours a week apart is held two days each time and on site for five weeks.
    if (schedule.firstErectAt !== undefined) {
      rows.push(['Plant wanted on site', cell(schedule.firstErectAt)].join(','))
    }
    rows.push(['First pour', cell(schedule.firstPourAt)].join(','))
    rows.push(['Last pour', cell(schedule.lastPourAt)].join(','))
    if (schedule.lastReleaseAt !== undefined) {
      rows.push(['Plant free again', cell(schedule.lastReleaseAt)].join(','))
    }
    const occupancy = scheduleOccupancyDays(schedule)
    if (occupancy !== undefined) rows.push(['Plant on site d', occupancy].join(','))
    if (schedule.earliestOnly) {
      rows.push(
        [
          'PROGRAMME',
          cell(
            'ACI 347 counts qualifying hours above 10 °C, so every strike date below is the earliest the form could come off, not the date',
          ),
        ].join(','),
      )
    }
    // One row per pour rather than a single window, because a pour is the thing a shutter
    // is erected and struck for and the row a programme has to have. In date order so the
    // block reads as a sequence, with the undated pours last where they cannot be mistaken
    // for the start of the job.
    rows.push(['Pour', 'Erect', 'Pour date', 'Strike', 'Plant free', 'Note'].join(','))
    for (const pour of scheduleInPourOrder(schedule)) {
      rows.push(
        [
          cell(`Pour — ${pour.id}`),
          cell(pour.erectAt),
          cell(pour.pourAt),
          cell(pour.strikeAt),
          cell(pour.releaseAt),
          cell(pour.gaps.map((gap) => SCHEDULE_GAP_LABELS[gap]).join('; ')),
        ].join(','),
      )
    }
    if (schedule.unscheduled.length > 0) {
      // An INCOMPLETE row rather than a note, because the block above looks like a whole
      // programme: 3 dated pours of 40 is a true statement about 3 and a wrong one about
      // the job, and nothing in the rows themselves shows which.
      rows.push(
        [
          'INCOMPLETE',
          cell(
            `${schedule.unscheduled.length} of ${schedule.pours.length} pours have no date, so this programme covers ${schedule.scheduledCount} of them`,
          ),
        ].join(','),
      )
    }
  }
  const sets = scope.sets
  if (sets && sets.peaks.length > 0) {
    // Labelled as the order rather than as a peak, because the distinction from the
    // quantity column below is the entire content of this block: a bill of 400 panels with a
    // peak of 100 is an order for 100, and a reader who takes the bill's figure buys four
    // times what the job needs.
    rows.push(
      [
        'MOST NEEDED AT ONCE',
        cell(
          'What to own or hire. The quantities in the lines below are what passes through the job; these are what stand at the same time, so these are the order',
        ),
      ].join(','),
    )
    if (sets.peakConcurrentOn !== undefined) {
      rows.push(
        ['Pours at once', sets.peakConcurrentPours, cell(`on ${sets.peakConcurrentOn}`)].join(','),
      )
    }
    rows.push(
      ['Item', 'Catalog id', 'Most at once', 'Needed from', 'Fitted in total', 'Reuses'].join(','),
    )
    for (const peak of sets.peaks) {
      rows.push(
        [
          cell(peak.description),
          cell(peak.catalogId),
          peak.peakQuantity,
          cell(peak.peakOn),
          peak.totalFitted,
          // One decimal: a reuse factor is a ratio nobody orders by, and it is read as
          // "about eight times" rather than checked to the third place.
          peak.reuseFactor.toFixed(1),
        ].join(','),
      )
    }
    for (const kind of sets.kinds) {
      rows.push(['Rack —', cell(kind.label), kind.peakQuantity].join(','))
    }
    if (sets.countedPours < sets.totalPours) {
      // INCOMPLETE for the same reason the programme's row is, and with more force: these
      // figures can only be low, and a low order is one somebody places.
      rows.push(
        [
          'INCOMPLETE',
          cell(
            `${sets.totalPours - sets.countedPours} of ${sets.totalPours} pours are not in this sweep, so every figure above is a floor — the real peak is this or higher`,
          ),
        ].join(','),
      )
    }
    for (const gap of sets.gaps.filter((entry) => entry !== 'partial-programme')) {
      rows.push(['INCOMPLETE', cell(SET_COUNT_GAP_LABELS[gap])].join(','))
    }
  } else if (schedule) {
    // The refusal in the file, not only in the UI that made it. A reader comparing this
    // export against one that has the block is owed the reason it is missing, and "too few
    // pours are dated" is a thing they can act on.
    rows.push(
      [
        'NO SET COUNT',
        cell(
          `${schedule.scheduledCount} of ${schedule.pours.length} pours are dated, which is too few to sweep. A set count over part of a programme comes out low, so there is none here rather than a small one`,
        ),
      ].join(','),
    )
  }
  const acquisition = scope.acquisition
  if (acquisition && acquisition.lines.length > 0) {
    rows.push('')
    // Named against the hired quantity in the columns below rather than against the peak
    // above, because that is the number a reader has already taken off this file: the split
    // spends the rack line by line, this compares the rack against the one day it is most
    // wanted, and on a sequential programme the two differ several-fold.
    rows.push(
      [
        'TO ACQUIRE',
        cell(
          'What the peak needs over what the yard owns. Not the “To hire” column below, which splits the whole bill — on pours that run in sequence the same sets serve them all and this list is far shorter',
        ),
      ].join(','),
    )
    const money = acquisition.currency === undefined ? '' : ` ${acquisition.currency}`
    rows.push(
      [
        'Item',
        'Catalog id',
        'Most at once',
        'Owned',
        'Short by',
        'On site by',
        'Days committed',
        'In use',
        `Hire${money}`,
        `Buy${money}`,
        'Pays back over (jobs)',
        'Verdict',
      ].join(','),
    )
    const round1 = (value: number) => Math.round(value * 10) / 10
    for (const line of acquisition.lines) {
      rows.push(
        [
          cell(line.description),
          cell(line.catalogId),
          line.peakQuantity,
          line.ownedQuantity,
          line.shortfall,
          // Only on a line that is actually short: a date beside a zero shortfall reads as
          // a delivery somebody has to make.
          cell(line.shortfall > 0 ? line.peakOn : ''),
          line.committedDays,
          `${Math.round(line.utilisation * 100)}%`,
          line.hireCost === undefined ? '' : round2(line.hireCost),
          line.purchaseCost === undefined ? '' : round2(line.purchaseCost),
          // The payback rather than the verdict alone, in its own column, because it is the
          // figure a reader settles against their own order book.
          line.paybackJobs === undefined ? '' : round1(line.paybackJobs),
          cell(
            line.verdict === undefined
              ? line.gaps.map((gap) => ACQUIRE_GAP_LABELS[gap]).join('; ')
              : ACQUIRE_VERDICT_LABELS[line.verdict],
          ),
        ].join(','),
      )
    }
    rows.push(['Short in total', '', '', '', acquisition.shortfallQuantity].join(','))
    if (acquisition.hireCost > 0 || acquisition.purchaseCost > 0) {
      // The two courses side by side and never differenced. A subtraction here would print a
      // saving, and buying is not a saving: the money is spent on the day.
      rows.push(
        [
          cell(
            acquisition.complete
              ? 'Whole shortfall, hired against bought'
              : 'Whole shortfall, hired against bought — both are floors',
          ),
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          round2(acquisition.hireCost),
          round2(acquisition.purchaseCost),
        ].join(','),
      )
    }
  }
  if (supply && supply.unusedOwnedIds.length > 0) {
    // Plant the project owns and this scope never asks for. Nothing in the lines below
    // can say so, because a line the bill does not contain has no row.
    rows.push(['Owned, not used here', cell(supply.unusedOwnedIds.join(' '))].join(','))
  }

  const sequence = scope.sequence
  if (sequence && sequence.pours.length > 0) {
    rows.push('')
    rows.push(
      [
        'PRECEDENCE AND FLOAT',
        cell(
          'Every bound below comes from a neighbour’s stated pour date, so this is not a critical path — a pour with no allowance is pinned by the dates around it',
        ),
      ].join(','),
    )
    rows.push(
      [
        'Pour',
        'Elements',
        'Poured',
        'Waits on',
        'Held up',
        'No earlier than',
        'No later than',
        'Allowance (days)',
        'Note',
      ].join(','),
    )
    for (const pour of sequence.pours) {
      rows.push(
        [
          cell(pour.id),
          cell(pour.elementIds.join(' ')),
          cell(pour.pourAt ?? ''),
          cell(pour.predecessors.join(' ')),
          cell(pour.successors.join(' ')),
          cell(pour.earliestPourAt ?? ''),
          cell(pour.latestPourAt ?? ''),
          pour.totalFloat === undefined ? '' : pour.totalFloat,
          cell(pour.gaps.map((gap) => SEQUENCE_GAP_LABELS[gap]).join('; ')),
        ].join(','),
      )
    }
    // The reason on each edge, because a dependency a reader cannot argue with is one they
    // ignore. Only where there are any — an unsequenced job's empty table needs no header.
    if (sequence.edges.length > 0) {
      rows.push(['Dependency', 'Reason'].join(','))
      for (const edge of sequence.edges) {
        rows.push(
          [
            cell(`${edge.from} → ${edge.to}`),
            cell(`${PRECEDENCE_REASON_LABELS[edge.reason]} — ${edge.because}`),
          ].join(','),
        )
      }
    }
    for (const conflict of sequence.conflicts) {
      // INCOMPLETE rather than a note: a programme that breaks its own precedence is not a
      // programme with a caveat on it, and the pours below it are dated off a day that cannot
      // happen.
      rows.push(['INCOMPLETE', cell(conflict.message)].join(','))
    }
  }

  const resequence = scope.resequence
  if (resequence && resequence.answers.length > 0) {
    rows.push('')
    rows.push(
      [
        'MOVE INSTEAD OF BUYING',
        cell(
          'One move at a time: each allowance was measured against the other pours’ stated dates, so the first move changes every other. This knows about formwork precedence and nothing else — no gang, no crane, no concrete supply',
        ),
      ].join(','),
    )
    rows.push(
      [
        'Short item',
        'Short by',
        'Move pour',
        'From',
        'To',
        'Days',
        'Peak before',
        'Peak after',
        'Still short',
        'Costs elsewhere',
      ].join(','),
    )
    for (const answer of resequence.answers) {
      if (answer.refusal !== undefined) {
        rows.push(
          [
            cell(answer.description),
            answer.shortfall,
            cell(`NO MOVE — ${RESEQUENCE_REFUSAL_LABELS[answer.refusal]}`),
          ].join(','),
        )
        continue
      }
      for (const move of answer.moves) {
        rows.push(
          [
            cell(answer.description),
            answer.shortfall,
            cell(move.pourId),
            cell(move.fromDate),
            cell(move.toDate),
            move.days,
            move.peakBefore,
            move.peakAfter,
            move.shortfallAfter,
            // What the move costs elsewhere, in the row rather than in a caveat: a proposal
            // whose price is in a footnote is a proposal that reads as free.
            cell(
              move.raises.length === 0
                ? 'nothing'
                : move.raises
                    .map((rise) => `${rise.description} ${rise.from} → ${rise.to}`)
                    .join('; '),
            ),
          ].join(','),
        )
      }
    }
  }

  const commitments = scope.commitments
  if (commitments && (commitments.windows.length > 0 || commitments.drifts.length > 0)) {
    rows.push('')
    rows.push(
      [
        'COMMITTED',
        cell(
          `What somebody has agreed to, over ${commitments.committedPours} of ${commitments.totalPours} pours — not what the job needs. Every figure here is swept over the committed pours alone, so it is smaller than the peak above wherever a pour is still uncommitted and ordering to it would leave the rest short`,
        ),
      ].join(','),
    )
    rows.push(['Item', 'Catalog id', 'Committed', 'From', 'To', 'Days', 'Pours'].join(','))
    for (const window of commitments.windows) {
      rows.push(
        [
          cell(window.description),
          cell(window.catalogId),
          window.committedQuantity,
          cell(window.from),
          cell(window.to),
          window.days,
          cell(window.pourIds.join(' ')),
        ].join(','),
      )
    }
    if (commitments.drifts.length > 0) {
      // DRIFT rather than a note, and one row per pour rather than a count: this is the state
      // the whole block exists to expose, and it is the only figure in the file a reader has to
      // act on by picking up a phone. A cleared date says so in words, because "" days out of a
      // booking would read as none.
      rows.push(['DRIFT', 'Pour', 'Booked for', 'Now poured', 'Days out'].join(','))
      for (const drift of commitments.drifts) {
        rows.push(
          [
            '',
            cell(drift.pourId),
            cell(drift.committedAt),
            cell(drift.pourAt ?? 'no date — cleared'),
            drift.driftDays === undefined ? '' : drift.driftDays,
          ].join(','),
        )
      }
    }
    for (const gap of commitments.gaps) {
      rows.push(['Commitment gap', cell(COMMITMENT_GAP_LABELS[gap])].join(','))
    }
  }

  rows.push('')

  const bySupply = new Map<BomLine, SupplyLine>(
    (supply?.lines ?? []).map((entry) => [entry.line, entry]),
  )
  const supplyCells = (line: BomLine): Array<string | number> => {
    if (!supply) return []
    const entry = bySupply.get(line)
    return entry === undefined
      ? ['', '', '']
      : [entry.ownedQuantity, entry.hiredQuantity, entry.consumedQuantity]
  }

  const byHire = new Map<BomLine, HireLine>((hire?.lines ?? []).map((entry) => [entry.line, entry]))
  const hireCells = (line: BomLine): Array<string | number> => {
    if (!hire) return []
    const entry = byHire.get(line)
    if (entry?.hours === undefined) {
      // A tie is cut off in the wall and a drum of release agent is gone. A 0 here
      // would price spent material as plant returned the same day, and a spreadsheet
      // would multiply it.
      return ['', 'not struck']
    }
    return [
      round2(entry.hours / 24),
      cell(
        entry.mixed
          ? `${STRIKE_TARGET_LABELS[entry.striking?.target as never]} (mixed — longest shown)`
          : STRIKE_TARGET_LABELS[entry.striking?.target as never],
      ),
    ]
  }

  const byCost = new Map<BomLine, CostLine>((cost?.lines ?? []).map((entry) => [entry.line, entry]))
  const costCells = (line: BomLine): Array<string | number> => {
    if (!cost) return []
    const entry = byCost.get(line)
    if (entry === undefined) return ['', '', '', '', '', '', '']
    const money = (value: number | undefined) => (value === undefined ? '' : round2(value))
    return [
      entry.chargedDays === undefined
        ? ''
        : cell(
            entry.atMinimumPeriod
              ? `${round2(entry.chargedDays)} (minimum)`
              : round2(entry.chargedDays),
          ),
      money(entry.hireCost),
      money(entry.rechargeCost),
      money(entry.consumedCost),
      money(entry.totalCost),
      money(entry.ownedCost),
      cell(entry.gaps.map((gap) => COST_GAP_LABELS[gap]).join('; ')),
    ]
  }

  rows.push(
    [
      ...HEADER.slice(0, 6),
      ...(supply ? SUPPLY_HEADER : []),
      ...(hire ? HIRE_HEADER : []),
      ...(cost ? costHeader(cost.currency) : []),
      ...HEADER.slice(6),
    ].join(','),
  )
  let totalKg = 0
  let everyLineWeighed = lines.length > 0
  for (const line of lines) {
    if (line.totalWeightKg === undefined) everyLineWeighed = false
    else totalKg += line.totalWeightKg
    rows.push(
      [
        line.marks.length,
        cell(line.kind),
        cell(line.description),
        cell(line.catalogId),
        cell(CONDITION_LABELS[line.provenance]),
        line.quantity,
        ...supplyCells(line),
        ...hireCells(line),
        ...costCells(line),
        cell(line.unit),
        line.totalWeightKg === undefined ? '' : round2(line.totalWeightKg),
        cell(line.marks.join(' ')),
      ].join(','),
    )
  }

  // Blank rather than zero where a weight is unknown, and the label says which it
  // is. A total that silently omits three unweighed lines is the number somebody
  // books a crane against.
  rows.push('')
  rows.push(
    [
      '',
      'TOTAL',
      cell(
        everyLineWeighed
          ? 'every line weighed'
          : 'incomplete — some parts have no published weight',
      ),
      '',
      '',
      lines.reduce((sum, line) => sum + line.quantity, 0),
      ...(supply ? [supply.ownedQuantity, supply.hiredQuantity, supply.consumedQuantity] : []),
      // The longest period rather than a sum of the column above. A set comes free when
      // the last of it does, and adding periods together produces a hire longer than
      // the job — which is the arithmetic a spreadsheet does to any column of days.
      ...(hire ? [round2(hire.longestHours / 24), cell('longest, not a total')] : []),
      // Days are deliberately left blank in the cost block's first cell: the column
      // above holds a charged period per line and there is no such thing as a total
      // period. The money does total, and the last cell says whether it is a price.
      ...(cost
        ? [
            '',
            round2(cost.hireCost),
            round2(cost.rechargeCost),
            round2(cost.consumedCost),
            round2(cost.totalCost),
            round2(cost.ownedCost),
            cell(cost.complete ? '' : 'a floor — some lines unpriced'),
          ]
        : []),
      '',
      lines.length === 0 ? '' : round2(totalKg),
      '',
    ].join(','),
  )

  return `${rows.join('\n')}\n`
}

/**
 * A filename that says what it is without being opened.
 *
 * Sanitised because a subject carries a user-typed element name, and a slash in a
 * filename is a directory on one platform and an error on another.
 */
export function bomCsvFilename(subject: string, isoDate: string): string {
  const slug =
    subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'formwork'
  return `formwork-bom-${slug}-${isoDate}.csv`
}
