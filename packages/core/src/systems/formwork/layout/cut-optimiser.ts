import { SAW_KERF_MM, type SheetStock } from '../catalog'

/**
 * Nesting the boards somebody cuts out of the sheets somebody buys.
 *
 * Every module before this said what the formlining *is*: `strip-pack.ts` leaves a `cut`
 * piece where no catalog width answers a stretch, `geometry-slab.ts` emits a deck sheet
 * trimmed to its bay, and `parts.ts` gives each one a mark. None of them says what a yard
 * actually orders, which is **sheets**. A wall wanting eleven boards of 380 × 2400 is not
 * eleven sheets and it is not the sum of their areas either — it is however many 1220 ×
 * 2440 sheets those rectangles nest out of, which is four, and the difference between the
 * area answer and the sheet answer is the whole reason this exists.
 *
 * ## Guillotineable, or it cannot be cut at all
 *
 * The constraint that decides the algorithm: a panel saw, a beam saw and a site table saw
 * all make **edge-to-edge cuts only**, so every layout has to be reachable by a sequence
 * of full-width cuts. That rules out the tighter families — MaxRects and skyline nests
 * pack 5–12 % against a guillotine's 8–15 %, and their layouts often cannot be cut on a
 * saw at all. A nest nobody can cut is worse than a looser one they can, so this is a
 * recursive guillotine placer over a free-rectangle tree: each placement splits what is
 * left into two rectangles, and every rectangle is reachable by one straight cut.
 *
 * ## The kerf is not a rounding error
 *
 * A blade takes `SAW_KERF_MM` of material per cut, and twelve cuts across a 1220 mm sheet
 * lose 40 mm — a third of a board. So the kerf is reserved on every split rather than
 * applied as a percentage at the end: four 300 mm boards fit across 1220 mm on paper and
 * do not fit through a saw, and a nest that says they do sends somebody back for another
 * sheet. Where a piece finishes flush with the sheet's own edge no kerf is reserved,
 * because that edge is not a cut.
 *
 * ## Grain is a property of the product, not a preference
 *
 * Face grain runs along a sheet's length and carries the bending, so 1250 × 2500 and 2500
 * × 1250 are different products and a nest may not turn one into the other. Every sheet in
 * `SHEET_STOCK` is `rotatable: false` for that reason. A *piece* can still be turned where
 * it spans nothing — a box-out reveal, a packer — which is what `grainAgnostic` says, and
 * it is the piece's claim to make rather than this module's.
 *
 * ## A piece bigger than the sheet is refused, not spliced
 *
 * Following `bomWeightKg` and `gangPickWeightKg`: the answer to a board that fits on no
 * stated sheet is to say so. Splicing it across two sheets would produce a nest that
 * balances and a formlining board with a joint mid-span, which is a defect rather than a
 * cut. The piece comes back in `oversize` with the sheets it was tried against.
 *
 * ## Two wastes, because only one of them is anybody's to reduce
 *
 * Trade practice allows 5–10 % on sheet goods and reports it as one figure. That blurs the
 * only half a nest can move: **cutting** waste is geometric and computable, and
 * **handling** waste — damaged edges, breakage, sheets rejected on arrival — is a flat
 * allowance no layout affects. They are separate fields here, and the allowance is applied
 * to the sheet count rather than folded into the waste fraction, so a reader can see which
 * number a better nest would change.
 *
 * ## Retained offcuts are reported and never netted off
 *
 * A 600 × 900 remainder goes back on the rack and gets used; a 40 mm strip splits when it
 * is nailed and cannot span two walers, so it is scrap however neatly it completes the
 * arithmetic. The keep threshold is a yard's policy rather than a constant — one that racks
 * 100 mm strips and one that skips them buy different numbers of sheets — so it is stated,
 * not shipped. What this will not do is subtract the retained area from the waste: a
 * kept offcut is only saved if the next job actually finds it, and nothing here knows
 * whether the yard racks what this says it could.
 */

/** One rectangle to cut, and what it is allowed to be turned into. */
export interface CutPiece {
  /**
   * The part mark, so a rectangle on a nest traces back to a board on the drawing.
   *
   * One entry per physical piece rather than a quantity, matching `parts.ts`: a mark is
   * how a crew finds the board, and a nest that grouped by size could not say which of
   * four identical boards came off which sheet.
   */
  mark: string
  widthMm: number
  heightMm: number
  /**
   * Set where the piece may be turned 90°.
   *
   * The piece's claim, not the sheet's. A board spanning between walers takes its
   * bending along the grain and may not be turned however the stock is graded; a box-out
   * reveal or a packer spans nothing and may.
   */
  grainAgnostic?: boolean
}

/** Where one piece lands on one sheet, set out from the sheet's own corner. */
export interface CutPlacement {
  mark: string
  xMm: number
  yMm: number
  /** As cut, so a foreman reads the board rather than the piece it came from. */
  widthMm: number
  heightMm: number
  /** Set where the piece was turned — only ever on a grain-agnostic piece or sheet. */
  rotated?: true
}

/** A rectangle left over, and whether the yard's policy keeps it. */
export interface CutOffcut {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  /** False where it is under the stated keep size — scrap, not stock. */
  keep: boolean
}

export interface NestedSheet {
  /** Catalog id of the stock, so a sheet count is an orderable line. */
  sheetId: string
  /** 1-based within this sheet id, which is how a cut sheet is numbered. */
  number: number
  widthMm: number
  heightMm: number
  placements: CutPlacement[]
  offcuts: CutOffcut[]
  /** Area the placed pieces cover, mm² — never including the kerf around them. */
  usedAreaMm2: number
}

/** The yard's rules about what is worth keeping, which no engine can assume. */
export interface OffcutPolicy {
  /**
   * Narrowest offcut worth racking, mm. A ply strip under about 150 mm cannot span two
   * walers and splits when it is nailed, whatever its length.
   */
  minKeepWidthMm?: number
  /** Shortest offcut worth racking, mm. Under about 600 mm it is not worth handling. */
  minKeepLengthMm?: number
  /** Smallest offcut worth racking, m² — a long thin piece can pass both bounds above. */
  minKeepAreaM2?: number
}

export interface CutOptions {
  kerfMm?: number
  /**
   * Material taken off each of the four edges before anything is nested, mm.
   *
   * A sheet as delivered is not square to the millimetre and its edges are not sound: a
   * strapped pack rubs its outer sheets, the film chips where a forklift touched it, and a
   * board cut to a nominal width off an unsquared edge is out of square down its whole
   * length. So a yard that cares about the joint line skims all four edges first, and 10 mm
   * off each takes a 1220 × 2440 sheet to 1200 × 2420 — which is one 300 mm board fewer
   * across the width on a sheet cut four ways.
   *
   * Reserved on the nest rather than deducted from the count, and the waste it makes stays
   * in `cuttingWasteFraction`, because it is geometric and a nest that ignored it would place
   * boards on material the saw has already removed. Unstated means the sheet is nested to its
   * full size, which is what a yard cutting site formwork out of plain ply does.
   */
  edgeTrimMm?: number
  offcutPolicy?: OffcutPolicy
  /**
   * Damage and breakage allowance on top of the nest, as a fraction. Applied to the
   * sheet count and reported separately, because it is the half a better nest cannot
   * touch — see the module note.
   */
  handlingWasteFraction?: number
  /**
   * The order to insert pieces in. Absent means widest-then-tallest descending, which is
   * the deterministic default; `orderPiecesForNest` searches for a better one.
   */
  order?: readonly string[]
  /**
   * Turn grain-agnostic pieces where it helps. Off by default: a rotation is a claim
   * about a board's span and the caller is the one holding the design.
   */
  allowRotation?: boolean
}

export type CutGap =
  /** No sheet stock stated, so there is nothing to nest out of. */
  | 'no-stock-stated'
  /** A piece fits on no stated sheet, in either orientation. Refused, not spliced. */
  | 'piece-over-sheet'
  /** Some offcuts are large enough to rack, so the sheet count is a gross figure. */
  | 'offcuts-retainable'

export const CUT_GAP_LABELS: Record<CutGap, string> = {
  'no-stock-stated':
    'No sheet stock stated, so there is nothing to nest out of — record the sheet the job buys, because its size is what decides how many are needed',
  'piece-over-sheet':
    'Some boards are larger than every stated sheet, so they are not in this nest — a formlining board spliced mid-span is a defect rather than a cut, so they are named instead of divided',
  'offcuts-retainable':
    'Some offcuts are large enough to rack under the stated policy, so the sheet count is what this job buys rather than what it consumes',
}

export interface CutList {
  sheets: NestedSheet[]
  /** Sheets to buy, per stock id — the orderable line. */
  order: Array<{ sheetId: string; sheets: number }>
  /** Sheets to buy with the handling allowance applied, rounded up per stock id. */
  orderWithAllowance?: Array<{ sheetId: string; sheets: number }>
  /** Boards no stated sheet holds. Named rather than divided. */
  oversize: CutPiece[]
  /** Area of the placed pieces, mm². */
  pieceAreaMm2: number
  /** Area of the sheets the nest opened, mm². */
  sheetAreaMm2: number
  /** Offcuts the stated policy keeps, mm² — reported, never netted off the waste. */
  retainableAreaMm2: number
  /**
   * Sheet area the pieces did not take, over the sheet area bought.
   *
   * Geometric and reducible: the kerf and the offcuts are both in it, and a better
   * insertion order moves it. The handling allowance is deliberately not.
   */
  cuttingWasteFraction: number
  kerfMm: number
  /** Trim taken off each edge before nesting, mm. 0 where the sheet is cut as delivered. */
  edgeTrimMm: number
  complete: boolean
  gaps: CutGap[]
}

interface FreeRect {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
}

interface OpenSheet {
  stock: SheetStock
  number: number
  placements: CutPlacement[]
  free: FreeRect[]
}

/** Tenths of a millimetre. A saw is not set out finer and a float should not claim to be. */
function round(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Widest first, then tallest, then by mark.
 *
 * Descending area is the usual default and it is the wrong one for formlining, which is
 * mostly full-height boards of varying width: sorting on area interleaves a wide short
 * piece with a narrow tall one and breaks the shelf every guillotine nest depends on.
 * The mark is the last key so the order is total — two identical boards must not nest in
 * whichever order the map iterated.
 */
function defaultOrder(pieces: readonly CutPiece[]): CutPiece[] {
  return [...pieces].sort(
    (a, b) =>
      b.widthMm - a.widthMm ||
      b.heightMm - a.heightMm ||
      (a.mark < b.mark ? -1 : a.mark > b.mark ? 1 : 0),
  )
}

/** The sheet's own grain allows a turn, or the piece does not care which way it runs. */
function mayRotate(piece: CutPiece, stock: SheetStock, allow: boolean): boolean {
  return allow && (stock.rotatable || piece.grainAgnostic === true)
}

/**
 * Against the *trimmed* sheet, not the delivered one.
 *
 * A board that fits 1220 mm and not the 1200 mm left after skimming is oversize, and saying
 * otherwise would nest it onto material the saw has already taken off — the one place the
 * trim has to reach a refusal rather than only a count.
 */
function fitsSheet(
  piece: CutPiece,
  stock: SheetStock,
  allowRotation: boolean,
  edgeTrimMm = 0,
): boolean {
  const widthMm = stock.widthMm - 2 * edgeTrimMm
  const lengthMm = stock.lengthMm - 2 * edgeTrimMm
  const upright = piece.widthMm <= widthMm && piece.heightMm <= lengthMm
  if (upright) return true
  if (!mayRotate(piece, stock, allowRotation)) return false
  return piece.heightMm <= widthMm && piece.widthMm <= lengthMm
}

interface Candidate {
  sheet: OpenSheet
  rectIndex: number
  rect: FreeRect
  widthMm: number
  heightMm: number
  rotated: boolean
  /** Best-short-side-fit: the smaller leftover axis, which is what to minimise. */
  score: number
}

/**
 * Where this piece goes, by best-short-side fit.
 *
 * The leftover to minimise is the *shorter* of the two, not the area: leaving a 900 × 40
 * strip and a 900 × 800 rectangle scores better than leaving two 900 × 420s, because the
 * second pair is two pieces of stock and the first is one piece and one sliver. Ties are
 * broken on the sheet already open and then on rectangle order, so the nest is a function
 * of the input and not of the search.
 */
function bestFit(
  piece: CutPiece,
  sheets: readonly OpenSheet[],
  allowRotation: boolean,
): Candidate | undefined {
  let best: Candidate | undefined
  for (const sheet of sheets) {
    const orientations: Array<{ widthMm: number; heightMm: number; rotated: boolean }> = [
      { widthMm: piece.widthMm, heightMm: piece.heightMm, rotated: false },
    ]
    if (mayRotate(piece, sheet.stock, allowRotation) && piece.widthMm !== piece.heightMm) {
      orientations.push({ widthMm: piece.heightMm, heightMm: piece.widthMm, rotated: true })
    }
    for (const [rectIndex, rect] of sheet.free.entries()) {
      for (const at of orientations) {
        if (at.widthMm > rect.widthMm || at.heightMm > rect.heightMm) continue
        const score = Math.min(rect.widthMm - at.widthMm, rect.heightMm - at.heightMm)
        if (best === undefined || score < best.score) {
          best = {
            sheet,
            rectIndex,
            rect,
            widthMm: at.widthMm,
            heightMm: at.heightMm,
            rotated: at.rotated,
            score,
          }
        }
      }
    }
  }
  return best
}

/**
 * Split what is left of a rectangle after a placement, along the shorter leftover axis.
 *
 * Two rectangles, because a guillotine cut goes edge to edge: the cut either runs the
 * full width of the rectangle or its full height, and whichever it is decides which of
 * the two children is the full-length one. Splitting the shorter leftover keeps the
 * larger child whole, which is the child the next piece needs.
 *
 * The kerf is reserved on the cut face only. A piece flush with the rectangle's far edge
 * has no cut beyond it, and the negative remainder that produces is dropped rather than
 * charged.
 */
function split(rect: FreeRect, widthMm: number, heightMm: number, kerfMm: number): FreeRect[] {
  const leftoverW = rect.widthMm - widthMm
  const leftoverH = rect.heightMm - heightMm
  const out: FreeRect[] = []
  if (leftoverW < leftoverH) {
    // Cut across the width first: the right-hand child is the height of the piece, and
    // the child below it runs the rectangle's full width.
    out.push({
      xMm: rect.xMm + widthMm + kerfMm,
      yMm: rect.yMm,
      widthMm: leftoverW - kerfMm,
      heightMm,
    })
    out.push({
      xMm: rect.xMm,
      yMm: rect.yMm + heightMm + kerfMm,
      widthMm: rect.widthMm,
      heightMm: leftoverH - kerfMm,
    })
  } else {
    out.push({
      xMm: rect.xMm + widthMm + kerfMm,
      yMm: rect.yMm,
      widthMm: leftoverW - kerfMm,
      heightMm: rect.heightMm,
    })
    out.push({
      xMm: rect.xMm,
      yMm: rect.yMm + heightMm + kerfMm,
      widthMm,
      heightMm: leftoverH - kerfMm,
    })
  }
  return out.filter((child) => child.widthMm > 0 && child.heightMm > 0)
}

function keepsOffcut(rect: FreeRect, policy: OffcutPolicy | undefined): boolean {
  if (policy === undefined) return false
  const shortMm = Math.min(rect.widthMm, rect.heightMm)
  const longMm = Math.max(rect.widthMm, rect.heightMm)
  if (policy.minKeepWidthMm !== undefined && shortMm < policy.minKeepWidthMm) return false
  if (policy.minKeepLengthMm !== undefined && longMm < policy.minKeepLengthMm) return false
  if (
    policy.minKeepAreaM2 !== undefined &&
    (rect.widthMm / 1000) * (rect.heightMm / 1000) < policy.minKeepAreaM2
  ) {
    return false
  }
  // A policy that states none of the three keeps nothing rather than everything: an
  // unstated threshold is a question nobody answered, not a yard that racks slivers.
  return (
    policy.minKeepWidthMm !== undefined ||
    policy.minKeepLengthMm !== undefined ||
    policy.minKeepAreaM2 !== undefined
  )
}

/**
 * Nest a set of boards out of the sheets the project buys.
 *
 * `stock` is passed in rather than read from the catalog for the reason `packStrip` takes
 * a system: a yard holds one or two sheet sizes, and nesting against all seven in
 * `SHEET_STOCK` would answer for a merchant rather than for the job. Where more than one
 * is stated they are tried in the order given, so the list is a preference.
 */
export function nestCutPieces(
  pieces: readonly CutPiece[],
  stock: readonly SheetStock[],
  options: CutOptions = {},
): CutList {
  const kerfMm = options.kerfMm ?? SAW_KERF_MM
  const edgeTrimMm = Math.max(0, options.edgeTrimMm ?? 0)
  const allowRotation = options.allowRotation ?? false
  const gaps: CutGap[] = []

  if (stock.length === 0) {
    return {
      sheets: [],
      order: [],
      oversize: [...pieces],
      pieceAreaMm2: 0,
      sheetAreaMm2: 0,
      retainableAreaMm2: 0,
      cuttingWasteFraction: 0,
      kerfMm,
      edgeTrimMm,
      complete: false,
      gaps: pieces.length === 0 ? ['no-stock-stated'] : ['no-stock-stated', 'piece-over-sheet'],
    }
  }

  const byMark = new Map(pieces.map((piece) => [piece.mark, piece]))
  const ordered =
    options.order === undefined
      ? defaultOrder(pieces)
      : [
          ...options.order.flatMap((mark) => {
            const piece = byMark.get(mark)
            return piece === undefined ? [] : [piece]
          }),
          // Anything the stated order left out still has to be cut. Silently dropping a
          // board is the one failure a nest could hide from every surface downstream.
          ...defaultOrder(pieces.filter((piece) => !options.order?.includes(piece.mark))),
        ]

  const open: OpenSheet[] = []
  const counts = new Map<string, number>()
  const oversize: CutPiece[] = []

  for (const piece of ordered) {
    if (!stock.some((entry) => fitsSheet(piece, entry, allowRotation, edgeTrimMm))) {
      oversize.push(piece)
      continue
    }
    let candidate = bestFit(piece, open, allowRotation)
    if (candidate === undefined) {
      const entry = stock.find((sheet) => fitsSheet(piece, sheet, allowRotation, edgeTrimMm))
      if (entry === undefined) {
        oversize.push(piece)
        continue
      }
      const number = (counts.get(entry.id) ?? 0) + 1
      counts.set(entry.id, number)
      const sheet: OpenSheet = {
        stock: entry,
        number,
        placements: [],
        // Inset by the trim on all four edges, so a placement's own x/y is already measured
        // from the corner of the squared sheet rather than of the delivered one.
        free: [
          {
            xMm: edgeTrimMm,
            yMm: edgeTrimMm,
            widthMm: entry.widthMm - 2 * edgeTrimMm,
            heightMm: entry.lengthMm - 2 * edgeTrimMm,
          },
        ],
      }
      open.push(sheet)
      candidate = bestFit(piece, [sheet], allowRotation)
      if (candidate === undefined) {
        oversize.push(piece)
        continue
      }
    }
    const { sheet, rectIndex, rect, widthMm, heightMm, rotated } = candidate
    sheet.placements.push({
      mark: piece.mark,
      xMm: round(rect.xMm),
      yMm: round(rect.yMm),
      widthMm: round(widthMm),
      heightMm: round(heightMm),
      ...(rotated ? { rotated: true } : {}),
    })
    sheet.free.splice(rectIndex, 1, ...split(rect, widthMm, heightMm, kerfMm))
  }

  const policy = options.offcutPolicy
  let pieceAreaMm2 = 0
  let sheetAreaMm2 = 0
  let retainableAreaMm2 = 0
  const sheets: NestedSheet[] = open.map((sheet) => {
    const usedAreaMm2 = sheet.placements.reduce(
      (held, placed) => held + placed.widthMm * placed.heightMm,
      0,
    )
    pieceAreaMm2 += usedAreaMm2
    sheetAreaMm2 += sheet.stock.widthMm * sheet.stock.lengthMm
    const offcuts = sheet.free.map((rect) => {
      const keep = keepsOffcut(rect, policy)
      if (keep) retainableAreaMm2 += rect.widthMm * rect.heightMm
      return {
        xMm: round(rect.xMm),
        yMm: round(rect.yMm),
        widthMm: round(rect.widthMm),
        heightMm: round(rect.heightMm),
        keep,
      }
    })
    return {
      sheetId: sheet.stock.id,
      number: sheet.number,
      widthMm: sheet.stock.widthMm,
      heightMm: sheet.stock.lengthMm,
      placements: sheet.placements,
      offcuts,
      usedAreaMm2: round(usedAreaMm2),
    }
  })

  // In the order the stock was stated rather than the order the sheets happened to open,
  // which is the order a yard reads its own list in — and it keeps the line order off the
  // piece data, so adding one board cannot reshuffle an order sheet.
  const order = stock.flatMap((entry) => {
    const sheets_ = counts.get(entry.id)
    return sheets_ === undefined ? [] : [{ sheetId: entry.id, sheets: sheets_ }]
  })
  const allowance = options.handlingWasteFraction
  if (oversize.length > 0) gaps.push('piece-over-sheet')
  if (retainableAreaMm2 > 0) gaps.push('offcuts-retainable')

  return {
    sheets,
    order,
    ...(allowance === undefined
      ? {}
      : {
          // Rounded up per stock id rather than over the total, because an allowance buys
          // whole sheets of a stated size and two half-allowances of different sizes are
          // not one sheet of either.
          orderWithAllowance: order.map(({ sheetId, sheets: count }) => ({
            sheetId,
            sheets: Math.ceil(count * (1 + allowance)),
          })),
        }),
    oversize,
    pieceAreaMm2: round(pieceAreaMm2),
    sheetAreaMm2: round(sheetAreaMm2),
    retainableAreaMm2: round(retainableAreaMm2),
    cuttingWasteFraction:
      sheetAreaMm2 === 0
        ? 0
        : Math.round(((sheetAreaMm2 - pieceAreaMm2) / sheetAreaMm2) * 1000) / 1000,
    kerfMm,
    edgeTrimMm,
    complete: gaps.length === 0,
    gaps,
  }
}

/**
 * What makes a sheet count wrong, in words.
 *
 * Leads with what the nest *is* rather than with a gap, because the first thing a reader
 * does with a cut list is hand it to somebody with a saw: it is a nest, not a cutting
 * programme, and the one constraint it does not carry is the one that matters most on
 * site — a cut board's edge has to land behind a waler or a joist, so the real problem is
 * a *constrained* nest and this is the unconstrained answer to it.
 */
export function cutListCaveats(list: CutList): string[] {
  const out: string[] = []
  if (list.sheets.length > 0) {
    out.push(
      `${list.sheets.length} ${list.sheets.length === 1 ? 'sheet' : 'sheets'} at ${(list.cuttingWasteFraction * 100).toFixed(1)}% cutting waste, with ${list.kerfMm} mm reserved for the blade on every cut${list.edgeTrimMm > 0 ? ` and ${list.edgeTrimMm} mm skimmed off all four edges of every sheet before anything was nested on it — a delivered edge is neither square nor sound, and a board cut off one is out of square down its whole length` : ''}. This is a nest rather than a cutting programme: the pieces fit and the cuts are edge-to-edge so a panel saw can make them, but nothing here checks that a cut board's edge lands behind a waler or a joist, which is the constraint a carpenter will apply and this cannot.`,
    )
    out.push(
      'The waste is geometric and is the half a better nest can reduce. Damage, breakage and sheets rejected on arrival are a separate allowance on top, and reporting the two as one figure hides which of them anybody can do anything about.',
    )
  }
  if (list.retainableAreaMm2 > 0) {
    out.push(
      `${(list.retainableAreaMm2 / 1_000_000).toFixed(2)} m² of the offcut is large enough to rack under the stated policy. It is not subtracted from anything: a kept offcut only saves a sheet if the next job finds it on the rack, and nothing here knows whether the yard keeps what this says it could.`,
    )
  }
  for (const gap of list.gaps) out.push(CUT_GAP_LABELS[gap])
  return out
}
