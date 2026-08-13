import type { FormworkSheetSettings } from '../../schema/nodes/formwork-project-settings'
import { type SheetStock, sheetStock } from './catalog'
import { type CutList, type CutPiece, chooseNestStock, cutListCaveats } from './layout'
import type { FormworkPart } from './parts'

/**
 * The sheets a job buys, from the boards its bill already lists.
 *
 * `layout/cut-optimiser.ts` nests rectangles out of stock and knows nothing about a scene.
 * This is the join: it sweeps the bespoke ply out of a scope's parts, nests it against the
 * sheets the project says it buys, and reports the order. The reason it is one module and
 * not two lines at each surface is the reason `logistics.ts` is: the panel, the CSV and the
 * chat tool must not each decide which parts are boards.
 *
 * ## The sheet has to be stated, because a sheathing grade has no size
 *
 * `parts.sheathingId` already names the face material — `film-faced-ply-18` and the rest —
 * and it cannot supply this nest. A `SheathingType` carries permissible pressures and a
 * capacity basis and **no width and no length at all**, because it is a grade rather than a
 * product. Only `SheetStock` carries `widthMm` and `lengthMm`, and which of the seven the
 * yard actually buys is a commercial fact about this job: a merchant selling 1220 × 2440
 * and one selling 1250 × 2500 give the same wall different sheet counts. So the stock is
 * stated, and until it is there is no cut list — the same answer the rack and the rates
 * give, for the same reason.
 *
 * ## The boards are already on the bill, so the sheets are not added to it
 *
 * Every board in this nest is a `ply-piece` line in `bom` already, priced as consumed and
 * weighed into the tonnage. The sheet count is what those boards are *cut from*, which is
 * the same material counted a second way — so adding sheets to a bill that already lists
 * the boards double-counts the ply, and this is deliberately not folded into `bom`,
 * `supply` or `cost`. It is a purchasing answer beside the bill rather than a line in it,
 * and every surface says so.
 *
 * ## One nest across the whole scope, because that is where the offcut goes
 *
 * Nesting each wall separately and adding the sheets up is the wrong answer, and by a wide
 * margin on a job of many short boards: a 400 mm board off one wall comes out of another
 * wall's offcut, and a per-element nest can never see it. So the sweep is over every part
 * in scope at once. The consequence worth knowing is that a cut list for a selection is
 * not a slice of the cut list for the floor — two scopes' sheet counts do not add up, the
 * same way two scopes' owned quantities do not.
 *
 * ## The plain sort rather than the search
 *
 * `orderPiecesForNest` finds a better order and costs 1.2 s at 600 boards, against 2.6 ms
 * for the plain nest. This runs inside `solveProjectFormwork`, which runs on every panel
 * read, every CSV export and every AI call, so the plain widest-first sort is what a scope
 * gets and the caveats say a better order may exist. The search is for a caller that has
 * asked for one nest and can wait for it.
 *
 * ## Nothing is turned
 *
 * `allowRotation` is off and no board is marked grain-agnostic. Face grain carries the
 * bending, and every one of these boards is a form face — a box-out reveal takes the
 * pressure of the pour against it exactly as a wall board does — so turning one is a
 * different product rather than the same board sideways.
 */

/** What the nest produced, and what the project stated it out of. */
export interface FormworkCutList {
  /** The nest itself: sheets, placements, offcuts, and the sheets to order. */
  list: CutList
  /** Boards swept out of the bill — what went into the nest. */
  boardCount: number
  /**
   * Area of those boards, m².
   *
   * The figure the sheet count is read against, and it includes the boards no sheet held:
   * an area answer that quietly dropped a refused board would make the nest look better
   * the worse the stock fitted the job.
   */
  boardAreaM2: number
  /** Sheet ids the nest opened out of, in the order the project stated them. */
  stockIds: string[]
  /**
   * Stated sizes this job does not need, from the subset sweep — a purchasing answer.
   *
   * Empty where every stated size earned its place, which is the ordinary case on a yard
   * holding one. A size in here is not a failure: it says the job nests out of fewer sizes
   * than the yard stocks, which is one fewer delivery to take.
   */
  droppedStockIds: string[]
  /**
   * Stated ids that name no sheet in the catalog.
   *
   * Stored and nesting nothing, which is the rack's failure mode: the write paths refuse
   * these, so one arriving here came from an older scene or a hand-edited node, and
   * reporting it is the difference between "the yard buys one sheet size" and "the yard
   * buys two and one of them is a typo".
   */
  unknownStockIds: string[]
  /** False where the nest is short, an id names nothing, or an offcut is racked. */
  complete: boolean
}

/** Two decimals of a square metre, which is finer than a sheet is bought. */
function areaM2(mm2: number): number {
  return Math.round((mm2 / 1_000_000) * 100) / 100
}

/**
 * The sheets a scope's boards nest out of, or `undefined` where it has no boards.
 *
 * Absent rather than an empty nest, following `formworkLifts`: a steel-panel job with no
 * cut ply in it has no cutting to do, and a cut list of zero sheets reads as a job whose
 * ply is free rather than as a job with no ply in it.
 *
 * Takes the parts rather than the bill, and that is the one decision here worth stating.
 * `bomLines` groups boards of one size into a line with a quantity, and a nest needs the
 * pieces: four 380 × 2400 boards are one bill line and four rectangles, and a nest over the
 * line would place one board and buy a sheet for it.
 */
export function formworkCutList(
  parts: readonly FormworkPart[],
  sheets: FormworkSheetSettings,
): FormworkCutList | undefined {
  const pieces: CutPiece[] = []
  let boardAreaMm2 = 0
  for (const part of parts) {
    if (part.kind !== 'ply-piece' || part.omitted) continue
    pieces.push({ mark: part.mark, widthMm: part.widthMm, heightMm: part.heightMm })
    boardAreaMm2 += part.widthMm * part.heightMm
  }
  if (pieces.length === 0) return undefined

  const stated = sheets.stockIds ?? []
  const stock: SheetStock[] = []
  const unknownStockIds: string[] = []
  for (const id of stated) {
    const entry = sheetStock(id)
    if (entry === undefined) unknownStockIds.push(id)
    else stock.push(entry)
  }

  const policy = {
    ...(sheets.minKeepWidthMm === undefined ? {} : { minKeepWidthMm: sheets.minKeepWidthMm }),
    ...(sheets.minKeepLengthMm === undefined ? {} : { minKeepLengthMm: sheets.minKeepLengthMm }),
    ...(sheets.minKeepAreaM2 === undefined ? {} : { minKeepAreaM2: sheets.minKeepAreaM2 }),
  }
  const choice = chooseNestStock(pieces, stock, {
    // An unstated policy keeps nothing rather than everything — see `keepsOffcut`. Passed
    // only where the yard stated a threshold so the two cases stay distinguishable here.
    ...(Object.keys(policy).length > 0 ? { offcutPolicy: policy } : {}),
    ...(sheets.edgeTrimMm === undefined ? {} : { edgeTrimMm: sheets.edgeTrimMm }),
    ...(sheets.handlingWasteFraction === undefined
      ? {}
      : { handlingWasteFraction: sheets.handlingWasteFraction }),
  })
  const list = choice.list

  return {
    list,
    boardCount: pieces.length,
    boardAreaM2: areaM2(boardAreaMm2),
    stockIds: choice.stockIds,
    droppedStockIds: choice.droppedStockIds,
    unknownStockIds,
    complete: list.complete && unknownStockIds.length === 0,
  }
}

/**
 * What a sheet count is, and is not, in words.
 *
 * Leads with the double-count, because it is the one error a reader of this figure makes
 * without noticing: the boards are on the bill above it and the sheets are the same ply
 * counted a second way. Everything about the nest itself comes verbatim from
 * `cutListCaveats` rather than being rephrased here.
 */
export function formworkCutListCaveats(cut: FormworkCutList): string[] {
  const out: string[] = []
  const ordered = cut.list.order.reduce((total, entry) => total + entry.sheets, 0)
  if (ordered > 0) {
    out.push(
      `${ordered} ${ordered === 1 ? 'sheet' : 'sheets'} is what ${cut.boardCount} boards totalling ${cut.boardAreaM2} m² nest out of. It is a purchasing figure beside the bill rather than a line in it: those boards are already billed as cut ply, so adding the sheets to the bill counts the same material twice. Nothing here is in the weight, the owned/hired split or the cost.`,
    )
    out.push(
      'The boards are nested in one plain widest-first pass across the whole scope, which is why this is not a slice of a larger cut list — a board off one wall comes out of another wall’s offcut, so two scopes’ sheet counts do not add up. A better insertion *order* usually exists and is not searched for here, because that search costs a second on a job of six hundred boards and this is recomputed on every read. The *mix of sheet sizes* is searched, because there are at most a handful of them and a nest is milliseconds.',
    )
  }
  if (cut.droppedStockIds.length > 0) {
    out.push(
      `${cut.droppedStockIds.join(', ')} ${cut.droppedStockIds.length === 1 ? 'is' : 'are'} stocked and not used: nesting out of the sizes above buys less ply than nesting out of all of them. The sizes interact — a job of 1150 mm boards wastes 70 mm on every 1220 mm sheet and fits a 1250 with room for the trim — so the mix is searched rather than taken in the order stated, and dropping a size is an answer rather than an omission.`,
    )
  }
  if (cut.unknownStockIds.length > 0) {
    out.push(
      `${cut.unknownStockIds.join(', ')} ${cut.unknownStockIds.length === 1 ? 'names' : 'name'} no sheet in the catalog, so ${cut.unknownStockIds.length === 1 ? 'it is' : 'they are'} recorded and nesting nothing. Correct the stated stock — a sheet size that resolves to nothing cannot hold a board, and the boards it would have held are refused instead.`,
    )
  }
  out.push(...cutListCaveats(cut.list))
  return out
}

/**
 * What the drawing answers, for a surface that has no screen.
 *
 * Shared by both AI surfaces so neither writes its own account of a cut sheet. It leads
 * with what a sequence is for rather than with the placements, because the placements are
 * the part a model will happily paraphrase into a list of coordinates — and a list of
 * rectangles is what this exists to *stop* being the answer.
 */
export const FORMWORK_CUT_SHEET_DESCRIPTION =
  'The cut sheet for the bespoke ply: where every board sits on every sheet, and the order the cuts are made in. Use it for any question about cutting rather than buying — inspect_project_formwork already says how many sheets to order, and this says how to get the boards out of them. Each sheet carries its placements in millimetres from that sheet’s own corner, its offcuts marked keep or scrap under the yard’s stated policy, and a numbered list of cuts. Three rules about the cuts, and the first is what the sequence is for: they have to be followed in the order given, because each one runs only as far as the material still joined at that point — a later cut quoted as running the full width of the sheet takes the blade back through a board freed two cuts earlier. A position is the cut face, which is where a fence goes, and the kerf comes off the offcut side as the nest reserved it, so never add or subtract the blade width from a figure here. And guillotineable false is a refusal rather than a warning: that layout cannot be cut on a panel saw, a beam saw or a site table saw at all, and the remedy is nesting those boards again rather than cutting carefully. Report boardsLargerThanEverySheet even though it is also in the takeoff: those boards are on no drawing here, so a cut sheet presented without them looks complete and is short. Where there is no cut list read noCutSheetBecause and pass it on — a job with no cut ply has nothing to cut, and a job that cuts ply with no sheet stated is a missing input whose remedy is set_formwork_settings sheets, never a sheet size taken from a sheathing grade or picked.'
