import {
  type CutAxis,
  cutInstruction,
  type NestedSheet,
  type SheetCutPlan,
} from '@pascal-app/core/formwork'

/**
 * The nest as something somebody cuts from.
 *
 * The arithmetic is finished before this file starts: `cut-optimiser.ts` says where every
 * board sits on every sheet and `cut-plan.ts` says which order the lines are sawn in. What
 * was still missing is the only form of that answer a carpenter can use — a sheet of
 * plywood with rectangles and numbered cut lines on it. A sheet count and a waste
 * percentage are the *summary* of a `CutPlacement[]`, and nobody cuts from a summary.
 *
 * ## Shapes, so the screen and the printed sheet cannot disagree
 *
 * This emits a list of drawn shapes rather than either an element tree or markup, because
 * there are two consumers and they must not each decide what a cut sheet looks like: the
 * panel draws it in the sidebar, and `cutSheetSvg` writes the file somebody prints and
 * takes to the saw. The second is the one that matters — a drawing read off a phone beside
 * a bench is not what a board gets cut against — and a second implementation of the layout
 * would be a printed sheet that quietly disagrees with the screen about which line is cut
 * first.
 *
 * ## Millimetres from a corner, which is the only frame a saw has
 *
 * The coordinates are the nest's own, unscaled: a sheet is 1220 × 2440 and the drawing's
 * viewBox is too. Everything on it is therefore already in the units a fence is set in, and
 * a reader who measures the drawing gets the cut. The colours are literals rather than
 * theme classes for the same reason the geometry is literal — a downloaded SVG carries no
 * stylesheet, and a cut sheet that prints as black rectangles on black is not a drawing.
 *
 * ## An unplaced board is on the drawing, as a refusal
 *
 * `oversize` boards belong to no sheet, so nothing here can draw one — and leaving them off
 * makes a cut sheet that looks complete and is short by a board somebody has to source. So
 * they are named on the sheet, in words, as the last thing on it.
 */

/** Concrete colours, because a printed SVG carries no stylesheet. */
export const CUT_SHEET_COLORS = {
  sheet: '#1c1c1e',
  sheetEdge: '#6b7280',
  board: '#1e3a5f',
  boardEdge: '#60a5fa',
  keep: '#14532d',
  keepEdge: '#4ade80',
  scrap: '#292524',
  scrapEdge: '#57534e',
  cut: '#f87171',
  mark: '#e5e7eb',
  dim: '#9ca3af',
  refusal: '#fbbf24',
  title: '#e5e7eb',
} as const

/**
 * Text heights in millimetres, since the drawing is in millimetres.
 *
 * A mark is read across the bench and a dimension is read up close, which is why they are
 * not one size: a cut sheet with every label at one height loses the mark in the figures.
 */
const MARK_MM = 62
const DIM_MM = 40
const CUT_MM = 46
const TITLE_MM = 54

/** Under this a board cannot hold a horizontal mark, so the label turns with the board. */
const MIN_HORIZONTAL_LABEL_MM = 240
/** Under this an offcut is too small to letter at all — the rectangle says it. */
const MIN_OFFCUT_LABEL_MM = 160

export type CutSheetShape =
  | { kind: 'sheet'; widthMm: number; heightMm: number }
  | { kind: 'board'; xMm: number; yMm: number; widthMm: number; heightMm: number; mark: string }
  | {
      kind: 'offcut'
      xMm: number
      yMm: number
      widthMm: number
      heightMm: number
      keep: boolean
    }
  | {
      kind: 'cut'
      order: number
      axis: CutAxis
      x1Mm: number
      y1Mm: number
      x2Mm: number
      y2Mm: number
    }
  | {
      kind: 'label'
      xMm: number
      yMm: number
      text: string
      role: 'mark' | 'dim' | 'cut' | 'offcut'
      /** Set where the label runs along the board rather than across it. */
      turned?: true
    }

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * The shapes one nested sheet draws as, in paint order.
 *
 * Offcuts under the boards and the cuts over both: a cut line has to be readable where it
 * runs along a board's edge, which is where every one of them runs.
 */
export function cutSheetShapes(sheet: NestedSheet, plan: SheetCutPlan): CutSheetShape[] {
  const shapes: CutSheetShape[] = [
    { kind: 'sheet', widthMm: sheet.widthMm, heightMm: sheet.heightMm },
  ]
  for (const offcut of sheet.offcuts) {
    shapes.push({
      kind: 'offcut',
      xMm: offcut.xMm,
      yMm: offcut.yMm,
      widthMm: offcut.widthMm,
      heightMm: offcut.heightMm,
      keep: offcut.keep,
    })
  }
  for (const placed of sheet.placements) {
    shapes.push({
      kind: 'board',
      xMm: placed.xMm,
      yMm: placed.yMm,
      widthMm: placed.widthMm,
      heightMm: placed.heightMm,
      mark: placed.mark,
    })
  }
  for (const cut of plan.cuts) {
    shapes.push(
      cut.axis === 'rip'
        ? {
            kind: 'cut',
            order: cut.order,
            axis: cut.axis,
            x1Mm: cut.atMm,
            y1Mm: cut.fromMm,
            x2Mm: cut.atMm,
            y2Mm: cut.toMm,
          }
        : {
            kind: 'cut',
            order: cut.order,
            axis: cut.axis,
            x1Mm: cut.fromMm,
            y1Mm: cut.atMm,
            x2Mm: cut.toMm,
            y2Mm: cut.atMm,
          },
    )
  }

  for (const placed of sheet.placements) {
    const turned = placed.widthMm < MIN_HORIZONTAL_LABEL_MM
    const cx = round(placed.xMm + placed.widthMm / 2)
    const cy = round(placed.yMm + placed.heightMm / 2)
    shapes.push({
      kind: 'label',
      xMm: cx,
      yMm: cy,
      text: placed.mark,
      role: 'mark',
      ...(turned ? { turned: true } : {}),
    })
    // The size is on the board rather than in a schedule beside it, because the one thing
    // a carpenter checks before cutting is that the rectangle in front of them is the size
    // the drawing claims. Dropped where the board is too small to carry both labels.
    const room = turned ? placed.heightMm : placed.widthMm
    const depth = turned ? placed.widthMm : placed.heightMm
    if (room > MARK_MM * 4 && depth > MARK_MM + DIM_MM * 2) {
      shapes.push({
        kind: 'label',
        xMm: turned ? round(cx + MARK_MM * 0.9) : cx,
        yMm: turned ? cy : round(cy + MARK_MM * 0.9),
        text: `${placed.widthMm} × ${placed.heightMm}${placed.rotated ? ' turned' : ''}`,
        role: 'dim',
        ...(turned ? { turned: true } : {}),
      })
    }
  }
  for (const offcut of sheet.offcuts) {
    if (Math.min(offcut.widthMm, offcut.heightMm) < MIN_OFFCUT_LABEL_MM) continue
    shapes.push({
      kind: 'label',
      xMm: round(offcut.xMm + offcut.widthMm / 2),
      yMm: round(offcut.yMm + offcut.heightMm / 2),
      text: `${offcut.keep ? 'keep' : 'scrap'} ${offcut.widthMm} × ${offcut.heightMm}`,
      role: 'offcut',
      ...(offcut.widthMm < MIN_HORIZONTAL_LABEL_MM ? { turned: true } : {}),
    })
  }
  for (const cut of plan.cuts) {
    shapes.push({
      kind: 'label',
      xMm: cut.axis === 'rip' ? round(cut.atMm + CUT_MM * 0.5) : round((cut.fromMm + cut.toMm) / 2),
      yMm: cut.axis === 'rip' ? round((cut.fromMm + cut.toMm) / 2) : round(cut.atMm - CUT_MM * 0.4),
      text: String(cut.order),
      role: 'cut',
    })
  }
  return shapes
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fontMm(role: 'mark' | 'dim' | 'cut' | 'offcut'): number {
  if (role === 'mark') return MARK_MM
  if (role === 'cut') return CUT_MM
  return DIM_MM
}

function shapeMarkup(shape: CutSheetShape): string {
  const c = CUT_SHEET_COLORS
  if (shape.kind === 'sheet') {
    return `<rect x="0" y="0" width="${shape.widthMm}" height="${shape.heightMm}" fill="${c.sheet}" stroke="${c.sheetEdge}" stroke-width="6"/>`
  }
  if (shape.kind === 'board') {
    return `<rect x="${shape.xMm}" y="${shape.yMm}" width="${shape.widthMm}" height="${shape.heightMm}" fill="${c.board}" stroke="${c.boardEdge}" stroke-width="4"/>`
  }
  if (shape.kind === 'offcut') {
    return `<rect x="${shape.xMm}" y="${shape.yMm}" width="${shape.widthMm}" height="${shape.heightMm}" fill="${shape.keep ? c.keep : c.scrap}" stroke="${shape.keep ? c.keepEdge : c.scrapEdge}" stroke-width="3" stroke-dasharray="${shape.keep ? '' : '24 16'}"/>`
  }
  if (shape.kind === 'cut') {
    return `<line x1="${shape.x1Mm}" y1="${shape.y1Mm}" x2="${shape.x2Mm}" y2="${shape.y2Mm}" stroke="${c.cut}" stroke-width="7" stroke-dasharray="40 24"/>`
  }
  const fill = shape.role === 'mark' ? c.mark : shape.role === 'cut' ? c.cut : c.dim
  const turn = shape.turned ? ` transform="rotate(-90 ${shape.xMm} ${shape.yMm})"` : ''
  return `<text x="${shape.xMm}" y="${shape.yMm}" fill="${fill}" font-size="${fontMm(shape.role)}" font-family="monospace" text-anchor="middle" dominant-baseline="middle"${turn}>${escapeXml(shape.text)}</text>`
}

/** Where one sheet's block starts, and how tall it is including its cut list. */
const BLOCK_PAD_MM = 90
const LINE_MM = 62
/** So the cut list is not clipped by a sheet narrower than its own instructions. */
const MIN_PAGE_WIDTH_MM = 1600

export interface CutSheetPage {
  sheet: NestedSheet
  plan: SheetCutPlan
}

/**
 * The whole cut list as one printable drawing.
 *
 * One file rather than one per sheet, and the sheets stacked down it rather than tiled,
 * because it is printed and read in order: sheet 1 is cut before sheet 2, and a board off
 * the second is no use to somebody still cutting the first. Each block carries its own
 * numbered cut list under its drawing, so a sheet cannot be read against another sheet's
 * sequence — which is the one error a shared list at the end of the file would invite.
 */
export function cutSheetSvg(
  pages: readonly CutSheetPage[],
  subject: string,
  oversize: readonly { mark: string; widthMm: number; heightMm: number }[] = [],
): string {
  const pageWidthMm = Math.max(MIN_PAGE_WIDTH_MM, ...pages.map((page) => page.sheet.widthMm))
  const c = CUT_SHEET_COLORS
  const blocks: string[] = []
  let yMm = BLOCK_PAD_MM
  for (const { sheet, plan } of pages) {
    const lines = plan.guillotineable
      ? plan.cuts.map(cutInstruction)
      : [
          `No cut sequence: ${plan.unsequencedMarks.join(', ')} cannot be separated by edge-to-edge cuts. Nest these boards again — a panel saw cannot make this layout.`,
        ]
    const listLines =
      plan.guillotineable && plan.cuts.length === 0
        ? ['No cuts — one board fills the sheet.']
        : lines
    const usedPercent = Math.round((sheet.usedAreaMm2 / (sheet.widthMm * sheet.heightMm)) * 100)
    blocks.push(
      [
        `<g transform="translate(0 ${yMm})">`,
        `<text x="0" y="0" fill="${c.title}" font-size="${TITLE_MM}" font-family="monospace">${escapeXml(sheet.sheetId)} — sheet ${sheet.number}, ${sheet.widthMm} × ${sheet.heightMm} mm, ${sheet.placements.length} ${sheet.placements.length === 1 ? 'board' : 'boards'}, ${usedPercent}% used</text>`,
        `<g transform="translate(0 ${TITLE_MM})">`,
        ...cutSheetShapes(sheet, plan).map(shapeMarkup),
        '</g>',
        ...listLines.map(
          (line, index) =>
            `<text x="0" y="${TITLE_MM + sheet.heightMm + BLOCK_PAD_MM + index * LINE_MM}" fill="${c.dim}" font-size="${DIM_MM}" font-family="monospace">${escapeXml(line)}</text>`,
        ),
        '</g>',
      ].join('\n'),
    )
    yMm += TITLE_MM + sheet.heightMm + BLOCK_PAD_MM + listLines.length * LINE_MM + BLOCK_PAD_MM * 2
  }
  for (const piece of oversize) {
    blocks.push(
      `<text x="0" y="${yMm}" fill="${c.refusal}" font-size="${DIM_MM}" font-family="monospace">${escapeXml(piece.mark)} is ${piece.widthMm} × ${piece.heightMm} mm and larger than every stated sheet, so it is on no drawing here — a board spliced mid-span is a defect rather than a cut.</text>`,
    )
    yMm += LINE_MM
  }

  const heightMm = yMm + BLOCK_PAD_MM
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-BLOCK_PAD_MM} ${-BLOCK_PAD_MM} ${pageWidthMm + BLOCK_PAD_MM * 2} ${heightMm + BLOCK_PAD_MM}" width="${pageWidthMm + BLOCK_PAD_MM * 2}" height="${heightMm + BLOCK_PAD_MM}">`,
    `<rect x="${-BLOCK_PAD_MM}" y="${-BLOCK_PAD_MM}" width="${pageWidthMm + BLOCK_PAD_MM * 2}" height="${heightMm + BLOCK_PAD_MM}" fill="#0c0c0d"/>`,
    `<text x="0" y="0" fill="${c.title}" font-size="${TITLE_MM}" font-family="monospace">Cut sheet — ${escapeXml(subject)}</text>`,
    `<text x="0" y="${TITLE_MM}" fill="${c.dim}" font-size="${DIM_MM}" font-family="monospace">Dimensions in mm from the sheet's own corner. Cut in the order numbered; each cut runs only as far as the drawing shows. The boards are already on the bill — the sheets are what they are cut from.</text>`,
    ...blocks,
    '</svg>',
  ].join('\n')
}
