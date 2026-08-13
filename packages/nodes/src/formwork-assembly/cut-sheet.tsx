'use client'

import {
  cutInstruction,
  type NestedSheet,
  type SheetCutPlan,
  sheetCutSequence,
} from '@pascal-app/core/formwork'
import { ActionButton, downloadText } from '@pascal-app/editor'
import { Download } from 'lucide-react'
import {
  CUT_SHEET_COLORS,
  type CutSheetShape,
  cutSheetShapes,
  cutSheetSvg,
} from './cut-sheet-drawing'
import { Note, Section, WarningLine } from './report-ui'

/**
 * The cut sheet on screen, and the file somebody takes to the saw.
 *
 * The layout is `cut-sheet-drawing.ts` and only the layout is: this draws the same shapes
 * that module gives the downloaded SVG, so the sidebar and the printed sheet cannot come to
 * disagree about which line is cut first. What lives here instead is the two things a screen
 * has that paper does not — one sheet at a time, because a sidebar 26 rem wide cannot show
 * four sheets at 1220 mm each and a drawing scaled to fit four is a drawing nobody can read;
 * and the cut list as text beside the drawing, since a numbered line on a rectangle is a
 * reminder and "rip at 600 mm" is the instruction.
 */

const SHEET_PAD_MM = 70

function shapeElement(shape: CutSheetShape, key: string) {
  const c = CUT_SHEET_COLORS
  if (shape.kind === 'sheet') {
    return (
      <rect
        fill={c.sheet}
        height={shape.heightMm}
        key={key}
        stroke={c.sheetEdge}
        strokeWidth={6}
        width={shape.widthMm}
        x={0}
        y={0}
      />
    )
  }
  if (shape.kind === 'board') {
    return (
      <rect
        fill={c.board}
        height={shape.heightMm}
        key={key}
        stroke={c.boardEdge}
        strokeWidth={4}
        width={shape.widthMm}
        x={shape.xMm}
        y={shape.yMm}
      />
    )
  }
  if (shape.kind === 'offcut') {
    return (
      <rect
        fill={shape.keep ? c.keep : c.scrap}
        height={shape.heightMm}
        key={key}
        stroke={shape.keep ? c.keepEdge : c.scrapEdge}
        strokeDasharray={shape.keep ? undefined : '24 16'}
        strokeWidth={3}
        width={shape.widthMm}
        x={shape.xMm}
        y={shape.yMm}
      />
    )
  }
  if (shape.kind === 'cut') {
    return (
      <line
        key={key}
        stroke={c.cut}
        strokeDasharray="40 24"
        strokeWidth={7}
        x1={shape.x1Mm}
        x2={shape.x2Mm}
        y1={shape.y1Mm}
        y2={shape.y2Mm}
      />
    )
  }
  const fill = shape.role === 'mark' ? c.mark : shape.role === 'cut' ? c.cut : c.dim
  const size = shape.role === 'mark' ? 62 : shape.role === 'cut' ? 46 : 40
  return (
    <text
      dominantBaseline="middle"
      fill={fill}
      fontFamily="monospace"
      fontSize={size}
      key={key}
      textAnchor="middle"
      transform={shape.turned ? `rotate(-90 ${shape.xMm} ${shape.yMm})` : undefined}
      x={shape.xMm}
      y={shape.yMm}
    >
      {shape.text}
    </text>
  )
}

/** One sheet, at its own size — the viewBox is millimetres, so the drawing is the sheet. */
export function CutSheetDrawing({ plan, sheet }: { plan: SheetCutPlan; sheet: NestedSheet }) {
  const shapes = cutSheetShapes(sheet, plan)
  return (
    <svg
      aria-label={`Cut sheet ${sheet.number} of ${sheet.sheetId}`}
      className="w-full"
      role="img"
      viewBox={`${-SHEET_PAD_MM} ${-SHEET_PAD_MM} ${sheet.widthMm + SHEET_PAD_MM * 2} ${sheet.heightMm + SHEET_PAD_MM * 2}`}
    >
      {shapes.map((shape, index) => shapeElement(shape, `${shape.kind}-${index}`))}
    </svg>
  )
}

/**
 * The nest as a drawing, one sheet at a time, with the file to print.
 *
 * Every figure here is already on the takeoff panel above it — this adds no arithmetic and
 * deliberately repeats none of the totals, because a sheet count in two places is a sheet
 * count somebody reconciles. What it adds is the placements, which nothing rendered.
 */
export function FormworkCutSheet({
  onSheetChange,
  oversize,
  sheetIndex,
  sheets,
  subject,
}: {
  onSheetChange: (index: number) => void
  oversize: readonly { mark: string; widthMm: number; heightMm: number }[]
  sheetIndex: number
  sheets: readonly NestedSheet[]
  subject: string
}) {
  if (sheets.length === 0) return null
  // A sheet deleted out from under the selector — a scope change, a settings edit — would
  // otherwise draw nothing and read as a nest that placed no boards.
  const index = Math.min(sheetIndex, sheets.length - 1)
  const sheet = sheets[index] as NestedSheet
  const plan = sheetCutSequence(sheet)

  return (
    <Section title="Cut sheet">
      {sheets.length > 1 && (
        <label className="flex items-center gap-2 text-[11px]" htmlFor="formwork-cut-sheet-pick">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">Sheet</span>
          <select
            className="h-7 min-w-0 max-w-[60%] rounded-md border border-border/50 bg-[#232325] px-1.5 text-foreground outline-none"
            id="formwork-cut-sheet-pick"
            onChange={(event) => onSheetChange(Number(event.target.value))}
            value={index}
          >
            {sheets.map((entry, at) => (
              <option key={`${entry.sheetId}-${entry.number}`} value={at}>
                {entry.sheetId} — {entry.number} of {sheets.length}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="overflow-hidden rounded-md border border-border/40 bg-[#0c0c0d] p-1">
        <CutSheetDrawing plan={plan} sheet={sheet} />
      </div>
      <div className="text-[10px] text-muted-foreground/80">
        {sheet.placements.length} {sheet.placements.length === 1 ? 'board' : 'boards'} ·{' '}
        {sheet.widthMm} × {sheet.heightMm} mm ·{' '}
        {Math.round((sheet.usedAreaMm2 / (sheet.widthMm * sheet.heightMm)) * 100)}% used
      </div>
      {/* The sequence as words, because the numbers on the drawing say the order and not the
          setting-out. A carpenter sets a fence to a figure, not to a rectangle. */}
      {plan.guillotineable ? (
        plan.cuts.length === 0 ? (
          <Note>No cuts — one board fills this sheet.</Note>
        ) : (
          <div className="space-y-0.5 font-mono text-[10px] text-foreground/75 leading-snug">
            {plan.cuts.map((cut) => (
              <div key={cut.order}>{cutInstruction(cut)}</div>
            ))}
          </div>
        )
      ) : (
        <WarningLine
          message={`No cut sequence for this sheet: ${plan.unsequencedMarks.join(', ')} cannot be separated by edge-to-edge cuts, so a panel saw cannot make this layout. The boards need nesting again.`}
        />
      )}
      {/* On the drawing rather than only in the Cutting section above, because this is the
          document somebody takes to the bench: a board that is on no sheet has to be
          missing *from the drawing*, in words, or the drawing looks complete. */}
      {oversize.map((piece) => (
        <WarningLine
          key={piece.mark}
          message={`${piece.mark} is ${piece.widthMm} × ${piece.heightMm} mm and on no sheet here — larger than every stated sheet, and a board spliced mid-span is a defect rather than a cut.`}
        />
      ))}
      <ActionButton
        icon={<Download className="h-3.5 w-3.5" />}
        label="Download cut sheet"
        onClick={() =>
          downloadText(
            cutSheetSvg(
              sheets.map((entry) => ({ sheet: entry, plan: sheetCutSequence(entry) })),
              subject,
              oversize,
            ),
            `cut-sheet-${subject.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`,
            'image/svg+xml;charset=utf-8',
          )
        }
      />
      <Note>
        Every sheet, stacked in cutting order, each with its own numbered list — printed and read in
        order, because a board off the second sheet is no use to somebody still cutting the first.
        Set out in millimetres from the sheet's own corner, which is the only frame a saw has.
        Nothing here is priced: these boards are already bill lines, and the sheets are what they
        are cut from.
      </Note>
    </Section>
  )
}
