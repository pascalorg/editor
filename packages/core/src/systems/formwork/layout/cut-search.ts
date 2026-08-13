import type { SheetStock } from '../catalog'
import { type CutList, type CutOptions, type CutPiece, nestCutPieces } from './cut-optimiser'

/**
 * Looking for a better order to feed the saw in.
 *
 * `nestCutPieces` is a one-pass placer: it takes the pieces in the order it is given and
 * never reconsiders. That is what makes it fast and what caps how good it can be, because
 * a guillotine nest's quality is mostly decided by the *sequence* — the same eleven boards
 * fed widest-first and fed shortest-first come out on four sheets and on five. So the
 * placer stays as it is and this searches the orderings over it, which is the standard
 * split (`products.md` §3.3 puts the gain at 5–10 % over a plain sort) and keeps the thing
 * a carpenter has to trust — that the pieces fit and the cuts are sawable — in one place.
 *
 * ## Simulated annealing, because the good orders are not near the obvious one
 *
 * Hill-climbing on swaps stalls immediately here: moving one board out of place almost
 * always opens a sheet, so every single-swap neighbour of a decent order is worse and a
 * greedy climb never reaches the order two swaps away that closes one. Annealing takes the
 * uphill move early and stops taking it later, which is the cheapest way through that.
 *
 * ## Seeded, because a bill that changes between two reads is not a bill
 *
 * `Math.random()` would make a quantity that moves when nothing about the scene moved: the
 * same wall would want 14 sheets this morning and 15 this afternoon, and no surveyor can
 * use that. The seed is required rather than defaulted so the caller has to decide what it
 * is derived from — a scene id, a pour id — and the same scene gives the same nest forever.
 *
 * ## The baseline is a floor, never a risk
 *
 * The search returns its own result only where that result is strictly better than the
 * plain sort. An annealer that finished on a worse order than it started from would make a
 * *worse* bill than not searching at all, which is a bad trade at any speed. So the
 * comparison is explicit and `improved` says which of the two came back.
 *
 * ## Rotation is written and currently unreachable
 *
 * The search will flip a piece's orientation where it is allowed to, and on today's catalog
 * that is nowhere: every sheet in `SHEET_STOCK` is `rotatable: false` because face grain
 * carries the bending, and a piece only overrides that by claiming it spans nothing. So
 * `rotationCandidates` reports how many pieces the flip was available on, and it is 0 on a
 * job of ordinary formlining. Saying that is better than leaving a reader to assume a
 * search dimension is working when it has no input.
 */

/** Enough iterations to find the two-swap improvements, cheap enough to run per read. */
const DEFAULT_ITERATIONS = 400

/** A runaway guard rather than a tuning knob: the curve is flat long before this. */
const MAX_ITERATIONS = 5000

/**
 * Starting and ending temperature, as a fraction of one sheet.
 *
 * Scaled to the objective rather than absolute: the score is in sheet-equivalents, so a
 * start of 0.6 takes a move that costs most of a sheet early and an end of 0.01 takes
 * essentially nothing at the finish.
 */
const START_TEMPERATURE = 0.6
const END_TEMPERATURE = 0.01

export interface NestSearchOptions extends Omit<CutOptions, 'order'> {
  /**
   * Required. Derive it from something about the scene — the same seed and the same pieces
   * must give the same bill, or a sheet count moves when nothing moved.
   */
  seed: number
  /** Orders to try. Clamped to `MAX_ITERATIONS`; absent means `DEFAULT_ITERATIONS`. */
  iterations?: number
}

export interface NestSearch {
  /** The nest to use: the search's own, or the plain sort's where it never improved. */
  list: CutList
  /** The order that produced `list`, so a caller can store it and reproduce the nest. */
  order: string[]
  /** True where the search beat the plain sort. False means `list` *is* the plain sort. */
  improved: boolean
  /** The plain sort's figures, so the gain is visible rather than asserted. */
  baseline: { sheets: number; cuttingWasteFraction: number }
  /** Orders actually evaluated, after the clamp. */
  iterations: number
  /**
   * Pieces the search was allowed to turn — 0 on ordinary formlining, because grain
   * direction forbids it. See the module note.
   */
  rotationCandidates: number
}

/**
 * Mulberry32. Small, fast, and good enough for an acceptance coin.
 *
 * Written out rather than reached for because `Math.random()` cannot appear anywhere a
 * quantity is derived, and a PRNG that lives beside its one caller is easier to check than
 * a dependency: the whole state is one 32-bit integer, so two runs on one seed are
 * identical by inspection.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * What makes one nest better than another, in sheets.
 *
 * Sheets first, because a sheet is what the job buys and half a sheet of saved offcut buys
 * nothing. Where two orders open the same number, the tie goes to the one whose leftover is
 * in *bigger pieces*: a nest ending on one 600 × 2400 offcut and one ending on twelve
 * slivers have identical waste fractions and are not equally good, because the first
 * remainder cuts another board and the second is a skip. Refused pieces cost a whole sheet
 * each so that an order which shrinks the nest by dropping a board can never win.
 */
function score(list: CutList): number {
  const sheets = list.sheets.length + list.oversize.length
  let bestOffcutFraction = 0
  for (const sheet of list.sheets) {
    // As a fraction of the sheet it came off, because a 0.5 m² offcut is most of a half
    // sheet and a fifth of a 1500 × 3000 — and a job can nest out of both.
    const sheetAreaMm2 = sheet.widthMm * sheet.heightMm
    for (const offcut of sheet.offcuts) {
      const fraction = (offcut.widthMm * offcut.heightMm) / sheetAreaMm2
      if (fraction > bestOffcutFraction) bestOffcutFraction = fraction
    }
  }
  // Halved, so the tiebreak can never outweigh opening a sheet.
  return sheets - bestOffcutFraction / 2
}

/** Swap two positions, or lift one piece out and drop it elsewhere. */
function neighbour(order: readonly string[], random: () => number): string[] {
  const next = [...order]
  const a = Math.floor(random() * next.length)
  let b = Math.floor(random() * next.length)
  if (a === b) b = (b + 1) % next.length
  if (random() < 0.5) {
    // A swap keeps both pieces near their old shelves, which is the small move.
    ;[next[a], next[b]] = [next[b] as string, next[a] as string]
    return next
  }
  // A reinsertion shifts everything between the two, which is the move that reaches the
  // orders a swap cannot: closing a sheet usually means a run of pieces sliding up one.
  const [lifted] = next.splice(a, 1)
  next.splice(b, 0, lifted as string)
  return next
}

/**
 * Search the orderings for a nest that buys fewer sheets.
 *
 * Returns the plain sort untouched where the search found nothing better, so calling this
 * instead of `nestCutPieces` can only help — the cost is the iterations rather than the
 * quality.
 */
export function orderPiecesForNest(
  pieces: readonly CutPiece[],
  stock: readonly SheetStock[],
  options: NestSearchOptions,
): NestSearch {
  const { seed, iterations: asked, ...nestOptions } = options
  const iterations = Math.max(0, Math.min(asked ?? DEFAULT_ITERATIONS, MAX_ITERATIONS))

  const baselineList = nestCutPieces(pieces, stock, nestOptions)
  const baseline = {
    sheets: baselineList.sheets.length,
    cuttingWasteFraction: baselineList.cuttingWasteFraction,
  }
  const rotationCandidates =
    nestOptions.allowRotation === true
      ? pieces.filter(
          (piece) => piece.grainAgnostic === true || stock.some((entry) => entry.rotatable),
        ).length
      : 0

  const plain = {
    list: baselineList,
    order: baselineList.sheets.flatMap((sheet) => sheet.placements.map((placed) => placed.mark)),
    improved: false,
    baseline,
    iterations: 0,
    rotationCandidates,
  }

  // Nothing to reorder: one piece has one order, and a job with no sheets to nest out of
  // has no better ordering either.
  if (pieces.length < 2 || iterations === 0 || stock.length === 0) return plain

  const random = mulberry32(seed)
  // Seeded from the plain sort rather than from a shuffle, because the plain sort is
  // already a good order and an annealer starting from noise spends its budget getting
  // back to it.
  let current = baselineList.sheets.flatMap((sheet) =>
    sheet.placements.map((placed) => placed.mark),
  )
  // Refused pieces are in no sheet, and an order that leaves them out is an order the
  // nest would silently re-append — carry them so the sequence is the whole job.
  for (const piece of baselineList.oversize) current.push(piece.mark)
  let currentScore = score(baselineList)
  let bestOrder = current
  let bestList = baselineList
  let bestScore = currentScore

  for (let step = 0; step < iterations; step++) {
    const temperature =
      START_TEMPERATURE * (END_TEMPERATURE / START_TEMPERATURE) ** (step / iterations)
    const candidateOrder = neighbour(current, random)
    const candidateList = nestCutPieces(pieces, stock, { ...nestOptions, order: candidateOrder })
    const candidateScore = score(candidateList)
    const delta = candidateScore - currentScore
    if (delta < 0 || random() < Math.exp(-delta / temperature)) {
      current = candidateOrder
      currentScore = candidateScore
      if (candidateScore < bestScore) {
        bestOrder = candidateOrder
        bestList = candidateList
        bestScore = candidateScore
      }
    }
  }

  // Strictly better, or the plain sort. An annealer that finished worse than it started
  // would make a worse bill than not searching at all.
  if (bestScore >= score(baselineList)) return { ...plain, iterations }
  return {
    list: bestList,
    order: bestOrder,
    improved: true,
    baseline,
    iterations,
    rotationCandidates,
  }
}

/**
 * Above this many stated sizes the subsets are not swept.
 *
 * 2ⁿ nests, and the nest is the expensive part: four sizes is 15 nests and a yard stating
 * five has said something this search cannot improve on cheaply enough to run per read.
 * The whole stated list is nested instead, which is what happened before this existed.
 */
const MAX_STOCK_FOR_SUBSETS = 4

export interface StockChoice {
  list: CutList
  /** The sizes the nest was allowed to open, in the order the project stated them. */
  stockIds: string[]
  /** Sizes the project states and this nest deliberately did not open. */
  droppedStockIds: string[]
  /** True where a subset beat the whole stated list. False means every size was used. */
  improved: boolean
  /** The whole stated list's figures, so the gain is visible rather than asserted. */
  baseline: { sheets: number; sheetAreaM2: number }
  /** Subsets nested. 0 where the list was too long to sweep — see the constant. */
  subsetsTried: number
}

/**
 * Refused boards, then square metres bought, then sheets — in that order.
 *
 * The order is the whole of the objective. Area rather than sheet *count*, because a count
 * across sizes is not a quantity: two 1220 × 2440 and one 1500 × 3000 is three sheets and
 * less material than four of the small one, and a nest chosen on count buys the wrong pile.
 * And a refused board outranks any amount of area, or the search would answer "buy less ply"
 * by declining to hold the widest boards — the cheapest nest of all is the one that nests
 * nothing.
 */
function stockCost(list: CutList): [number, number, number] {
  return [list.oversize.length, list.sheetAreaMm2, list.sheets.length]
}

function cheaper(a: readonly number[], b: readonly number[]): boolean {
  for (const [index, value] of a.entries()) {
    const other = b[index] as number
    if (value !== other) return value < other
  }
  return false
}

/**
 * Which of the sizes the yard stocks this job should actually be cut from.
 *
 * The stated list has always been a *preference*: `nestCutPieces` opens the first size a
 * board fits on, so the second size is reached only by a board too big for the first. That
 * is the right rule for one board and the wrong answer for a job, because the sizes interact
 * — a job of 1150 mm boards nested out of 1220 × 2440 wastes 70 mm on every sheet and nests
 * out of 1250 × 2500 with room for the trim, and no per-board rule finds that. The sizes are
 * few (a yard holds one or two) and the nest is cheap, so the subsets are enumerated rather
 * than reasoned about: this is the set-covering step the cut list has been missing, done by
 * exhaustion because at this size exhaustion is affordable and a heuristic is not honest.
 *
 * Dropping a size is a real answer and not an omission, which is why `droppedStockIds` is
 * reported: it says "this job does not need the 1500 × 3000 you also stock", which is a
 * purchasing decision somebody makes, rather than silently ordering none of them.
 */
export function chooseNestStock(
  pieces: readonly CutPiece[],
  stock: readonly SheetStock[],
  options: Omit<CutOptions, 'order'> = {},
): StockChoice {
  const whole = nestCutPieces(pieces, stock, options)
  const areaM2 = (mm2: number) => Math.round((mm2 / 1_000_000) * 100) / 100
  const plain: StockChoice = {
    list: whole,
    stockIds: stock.map((entry) => entry.id),
    droppedStockIds: [],
    improved: false,
    baseline: { sheets: whole.sheets.length, sheetAreaM2: areaM2(whole.sheetAreaMm2) },
    subsetsTried: 0,
  }
  if (stock.length < 2 || stock.length > MAX_STOCK_FOR_SUBSETS) return plain

  let best = plain
  let bestCost = stockCost(whole)
  let subsetsTried = 0
  // Bitmask over the stated list, so a subset keeps the stated order and the preference
  // inside the subset is unchanged — this chooses which sizes are available, never which
  // board goes on which sheet.
  for (let mask = 1; mask < (1 << stock.length) - 1; mask++) {
    const subset = stock.filter((_, index) => (mask & (1 << index)) !== 0)
    const list = nestCutPieces(pieces, subset, options)
    subsetsTried++
    if (!cheaper(stockCost(list), bestCost)) continue
    bestCost = stockCost(list)
    best = {
      list,
      stockIds: subset.map((entry) => entry.id),
      droppedStockIds: stock.filter((entry) => !subset.includes(entry)).map((entry) => entry.id),
      improved: true,
      baseline: plain.baseline,
      subsetsTried,
    }
  }
  return { ...best, subsetsTried }
}

/**
 * What a searched nest is, and is not, in words.
 *
 * A reader who sees "optimised" on a cut list will assume the sheet count is the least
 * possible, and it is not: this is the best of a few hundred orderings of one placer, the
 * true optimum is NP-hard, and the constraint that actually governs on site — a cut board's
 * edge landing behind a waler — is not in the objective at all.
 */
export function nestSearchCaveats(search: NestSearch): string[] {
  const out: string[] = []
  if (search.improved) {
    out.push(
      `${search.baseline.sheets} sheets on a plain widest-first sort, ${search.list.sheets.length} after searching ${search.iterations} orderings. This is the best order found rather than the fewest sheets possible — the true minimum is not computable at this size, so a better nest may exist.`,
    )
  } else if (search.iterations > 0) {
    out.push(
      `Searching ${search.iterations} orderings found nothing better than the plain widest-first sort, so that is the nest. It is not proof the sort is optimal, only that this search did not beat it.`,
    )
  }
  if (search.rotationCandidates === 0) {
    out.push(
      'No piece could be turned to fit: face grain runs along a sheet’s length and carries the bending, so a board cut across it is a different product rather than the same one rotated. The search moved the order only.',
    )
  }
  return out
}
