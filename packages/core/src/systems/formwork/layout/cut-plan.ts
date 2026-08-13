import type { NestedSheet } from './cut-optimiser'

/**
 * The order somebody with a saw makes the cuts in.
 *
 * `cut-optimiser.ts` answers where every board sits on every sheet, and a set of rectangles
 * is not an instruction: handed a sheet with eleven boards drawn on it, the first question
 * is which line to cut first, and the answer is not free to choose. A panel saw cuts **edge
 * to edge**, so the first cut has to be one that runs clear across the sheet, and every cut
 * after it runs clear across *the piece in hand* rather than across the sheet. Draw the
 * rectangles without that and a carpenter is holding a puzzle instead of a cut list.
 *
 * ## Recovered from the layout rather than recorded during it
 *
 * The placer already made these decisions — every `split` is a cut — and this deliberately
 * does not have it keep a log. A `CutList` is what the surfaces hold, it is what an annealed
 * order returns, and it is what a stored solve would carry, so a sequence that existed only
 * as a side effect of nesting would be absent from every one of them. The layout itself is
 * enough: a guillotine nest is separable by construction, and finding the line that
 * separates it is cheap.
 *
 * ## Where the kerf goes, and the sliver it leaves
 *
 * A cut is reported at the **cut face** — the near piece's own edge — because that is the
 * line somebody sets a fence to, and the blade takes its `kerfMm` off the far side, which is
 * exactly what the nest reserved. A leftover under one kerf is not a cut at all: the placer
 * drops those children, so a board can finish 2 mm short of its neighbour's line with
 * nothing between them to saw, and inventing a cut there would send somebody back to the
 * bench for a shaving.
 *
 * ## Rip before crosscut, and near side before far
 *
 * Where both a rip and a crosscut separate what is in hand, the rip wins: formlining is
 * mostly full-height boards of varying width, so a sheet breaks down into full-length strips
 * and each strip is then cut to length — which is both what the nest's own shelves look like
 * and how a sheet is broken down on site. Within that, the sequence is depth-first from the
 * sheet's origin corner: cut the strip off, finish the strip, then pick up what is left.
 * Numbering breadth-first would have somebody put a part-cut board down and come back to it.
 *
 * ## No sequence at all, rather than a partial one
 *
 * If some region cannot be separated by a straight cut the whole plan comes back
 * `guillotineable: false` with the marks named, and no cuts. A drawing showing four of nine
 * cuts reads as a sheet with four cuts in it, and the fifth is the one that cannot be made.
 */

/** Which way the cut runs. */
export type CutAxis =
  /** Along the sheet's length, parallel to the face grain — the strip cut. */
  | 'rip'
  /** Across the sheet's width, shortening what is in hand. */
  | 'crosscut'

export interface SheetCut {
  /** 1-based, and the order matters: this is a sequence rather than a set. */
  order: number
  axis: CutAxis
  /** Position of the cut face from the sheet's origin corner, mm — where the fence goes. */
  atMm: number
  /**
   * Where the cut starts and stops on the other axis, mm.
   *
   * The extent of the material still joined at this point, not the sheet's: a cut that ran
   * the full sheet every time would go through boards cut two cuts ago.
   */
  fromMm: number
  toMm: number
  /**
   * Marks this cut finishes, if any.
   *
   * A cut that only breaks the sheet down frees nothing, which is most of them. Naming the
   * ones that do is how a drawing says which line makes a board rather than another
   * offcut.
   */
  frees: string[]
}

export interface SheetCutPlan {
  sheetId: string
  /** The sheet this is a plan for, matching `NestedSheet.number`. */
  number: number
  cuts: SheetCut[]
  /** False where some region of the sheet is not separable by an edge-to-edge cut. */
  guillotineable: boolean
  /** Marks on a sheet no sequence reached. Empty unless `guillotineable` is false. */
  unsequencedMarks: string[]
}

/** Tenths of a millimetre, the precision the nest itself reports at. */
const EPS = 0.05

const AXES: readonly CutAxis[] = ['rip', 'crosscut']

interface Item {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  /** Absent on an offcut, which is a leaf the sequence ends at rather than a board. */
  mark?: string
}

interface PlannedCut {
  axis: CutAxis
  atMm: number
  fromMm: number
  toMm: number
  frees: string[]
}

/** The axis the cut's position is measured on: across the width for a rip. */
function position(item: Item, axis: CutAxis): { startMm: number; endMm: number } {
  return axis === 'rip'
    ? { startMm: item.xMm, endMm: item.xMm + item.widthMm }
    : { startMm: item.yMm, endMm: item.yMm + item.heightMm }
}

/** The axis the cut runs along, which is what decides how far it travels. */
function span(items: readonly Item[], axis: CutAxis): { fromMm: number; toMm: number } {
  const starts = items.map((item) => (axis === 'rip' ? item.yMm : item.xMm))
  const ends = items.map((item) =>
    axis === 'rip' ? item.yMm + item.heightMm : item.xMm + item.widthMm,
  )
  return { fromMm: Math.min(...starts), toMm: Math.max(...ends) }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** A side that is one marked rectangle with nothing left to cut is a finished board. */
function freed(items: readonly Item[], cuts: readonly PlannedCut[]): string[] {
  if (cuts.length > 0 || items.length !== 1) return []
  const mark = items[0]?.mark
  return mark === undefined ? [] : [mark]
}

/**
 * The cuts that separate these rectangles, or `undefined` where no straight cut does.
 *
 * Backtracks rather than committing to the first line that separates: a cut can be legal
 * here and leave a side that is not, and a sequence that stops half way is worse than the
 * other axis tried first. In practice the first candidate holds, because the layout came
 * from a placer that made these same cuts.
 */
function sequence(items: readonly Item[]): PlannedCut[] | undefined {
  if (items.length <= 1) return []
  for (const axis of AXES) {
    const outer = Math.max(...items.map((item) => position(item, axis).endMm))
    const candidates = [...new Set(items.map((item) => position(item, axis).endMm))]
      .filter((at) => at < outer - EPS)
      .sort((a, b) => a - b)
    for (const at of candidates) {
      const near = items.filter((item) => position(item, axis).endMm <= at + EPS)
      const beyond = items.filter((item) => position(item, axis).startMm >= at - EPS)
      // Anything in neither straddles the line, so this cut would go through a board.
      if (near.length + beyond.length !== items.length) continue
      if (near.length === 0 || beyond.length === 0) continue
      const nearCuts = sequence(near)
      if (nearCuts === undefined) continue
      const beyondCuts = sequence(beyond)
      if (beyondCuts === undefined) continue
      const { fromMm, toMm } = span(items, axis)
      return [
        {
          axis,
          atMm: round(at),
          fromMm: round(fromMm),
          toMm: round(toMm),
          frees: [...freed(near, nearCuts), ...freed(beyond, beyondCuts)],
        },
        ...nearCuts,
        ...beyondCuts,
      ]
    }
  }
  return undefined
}

/**
 * The cuts one nested sheet takes, in order.
 *
 * Both the boards and the offcuts go in, because an offcut is what is on the far side of a
 * cut: sequencing the boards alone would produce a plan that stops as soon as the last board
 * is free and leave the reader to work out which lines made it.
 */
export function sheetCutSequence(sheet: NestedSheet): SheetCutPlan {
  const items: Item[] = [
    ...sheet.placements.map((placed) => ({
      xMm: placed.xMm,
      yMm: placed.yMm,
      widthMm: placed.widthMm,
      heightMm: placed.heightMm,
      mark: placed.mark,
    })),
    ...sheet.offcuts.map((offcut) => ({
      xMm: offcut.xMm,
      yMm: offcut.yMm,
      widthMm: offcut.widthMm,
      heightMm: offcut.heightMm,
    })),
  ]
  const cuts = sequence(items)
  if (cuts === undefined) {
    return {
      sheetId: sheet.sheetId,
      number: sheet.number,
      cuts: [],
      guillotineable: false,
      unsequencedMarks: sheet.placements.map((placed) => placed.mark),
    }
  }
  return {
    sheetId: sheet.sheetId,
    number: sheet.number,
    cuts: cuts.map((cut, index) => ({ order: index + 1, ...cut })),
    guillotineable: true,
    unsequencedMarks: [],
  }
}

/**
 * One cut in words.
 *
 * Here rather than at each surface because there are four of them — the panel, the printed
 * drawing and both AI replies — and a carpenter reading a downloaded sheet against an
 * agent's answer must not get two different sentences for the same line.
 *
 * The machine leads, because it is what somebody sets before the figure matters, and the
 * freed marks come last: most cuts free nothing and only break the sheet down, and naming a
 * board on every line would read as a sheet of finished boards.
 */
export function cutInstruction(cut: SheetCut): string {
  const what = cut.axis === 'rip' ? 'Rip' : 'Crosscut'
  const along = cut.axis === 'rip' ? 'down' : 'across'
  const frees = cut.frees.length === 0 ? '' : ` — frees ${cut.frees.join(', ')}`
  return `${cut.order}. ${what} at ${cut.atMm} mm, ${along} ${cut.fromMm}–${cut.toMm}${frees}`
}

/**
 * What a cut sequence is, and is not, in words.
 *
 * Leads with the sheet order rather than with the cuts, because it is the one thing about a
 * multi-sheet cut list a reader assumes and should not: the sheets are cut in the order the
 * nest opened them, and a board off the second is no use to somebody still on the first.
 */
export function cutSequenceCaveats(plans: readonly SheetCutPlan[]): string[] {
  const out: string[] = []
  if (plans.length === 0) return out
  out.push(
    `${plans.length} ${plans.length === 1 ? 'sheet' : 'sheets'}, cut in the order given. Every position is in millimetres from that sheet's own corner, measured to the cut face rather than to the far side of the blade — which is where a fence goes, and the kerf comes off the offcut side, as the nest reserved it.`,
  )
  out.push(
    'Each cut runs only as far as the material still joined at that point, not across the sheet: a later cut that ran the full width would take the blade back through a board freed two cuts earlier. So the sequence has to be followed in order rather than read as a set of positions.',
  )
  const refused = plans.filter((plan) => !plan.guillotineable)
  if (refused.length > 0) {
    out.push(
      `${refused.length} ${refused.length === 1 ? 'sheet has' : 'sheets have'} no cut sequence at all, because ${refused.flatMap((plan) => plan.unsequencedMarks).join(', ')} cannot be separated by edge-to-edge cuts. A panel saw, a beam saw and a site table saw all cut edge to edge, so that layout is uncuttable rather than awkward, and the remedy is nesting those boards again.`,
    )
  }
  return out
}
