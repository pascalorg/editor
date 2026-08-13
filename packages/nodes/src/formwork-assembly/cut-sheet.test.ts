import { describe, expect, test } from 'bun:test'
import {
  cutInstruction,
  type NestedSheet,
  nestCutPieces,
  type SheetStock,
  sheetCutSequence,
  sheetStock,
} from '@pascal-app/core/formwork'
import { cutSheetShapes, cutSheetSvg } from './cut-sheet-drawing'

/**
 * The drawing, not the nest.
 *
 * The arithmetic is asserted in `cut-optimiser.test.ts` and the cut order in
 * `cut-plan.test.ts`. What is left to check is the part a carpenter would notice: that every
 * board on the sheet is drawn and labelled, that a board the nest refused appears on the
 * drawing as words rather than being silently absent, and that the printed file carries the
 * same sequence the panel does — one layout, two consumers.
 */

const plain = sheetStock('ply-1220x2440x18-plain') as SheetStock

function nested(pieces: Array<{ mark: string; widthMm: number; heightMm: number }>): NestedSheet {
  const sheet = nestCutPieces(pieces, [plain]).sheets[0]
  if (sheet === undefined) throw new Error('the fixture nested nothing')
  return sheet
}

const mixed = () =>
  nested([
    { mark: 'W1-P1', widthMm: 600, heightMm: 2440 },
    { mark: 'W1-P2', widthMm: 400, heightMm: 1200 },
    { mark: 'W1-P3', widthMm: 180, heightMm: 900 },
  ])

describe('cutSheetShapes', () => {
  test('draws every board on the sheet, and marks each one', () => {
    const sheet = mixed()
    const shapes = cutSheetShapes(sheet, sheetCutSequence(sheet))
    const boards = shapes.filter((shape) => shape.kind === 'board')
    const marks = shapes.filter((shape) => shape.kind === 'label' && shape.role === 'mark')

    expect(boards).toHaveLength(sheet.placements.length)
    expect(marks.map((label) => (label.kind === 'label' ? label.text : '')).sort()).toEqual(
      sheet.placements.map((placed) => placed.mark).sort(),
    )
    // The rectangles are the nest's own coordinates, unscaled — a drawing a reader can
    // measure is one whose viewBox is the sheet.
    expect(
      boards.every(
        (board) =>
          board.kind === 'board' &&
          sheet.placements.some(
            (placed) =>
              placed.xMm === board.xMm &&
              placed.yMm === board.yMm &&
              placed.widthMm === board.widthMm,
          ),
      ),
    ).toBe(true)
  })

  test('turns the label on a board too narrow to letter across', () => {
    const sheet = mixed()
    const shapes = cutSheetShapes(sheet, sheetCutSequence(sheet))
    const narrow = shapes.find(
      (shape) => shape.kind === 'label' && shape.role === 'mark' && shape.text === 'W1-P3',
    )
    const wide = shapes.find(
      (shape) => shape.kind === 'label' && shape.role === 'mark' && shape.text === 'W1-P1',
    )

    // 180 mm cannot hold "W1-P3" across it at a size read off a bench; 600 mm can.
    expect(narrow?.kind === 'label' && narrow.turned).toBe(true)
    expect(wide?.kind === 'label' && wide.turned).toBeUndefined()
  })

  test('numbers the cut lines on the drawing in the order they are sawn', () => {
    const sheet = mixed()
    const plan = sheetCutSequence(sheet)
    const shapes = cutSheetShapes(sheet, plan)
    const lines = shapes.filter((shape) => shape.kind === 'cut')
    const numbers = shapes.filter((shape) => shape.kind === 'label' && shape.role === 'cut')

    expect(lines).toHaveLength(plan.cuts.length)
    expect(numbers.map((label) => (label.kind === 'label' ? label.text : ''))).toEqual(
      plan.cuts.map((cut) => String(cut.order)),
    )
    // A rip is drawn as a vertical line and a crosscut as a horizontal one, which is the
    // one thing about the drawing that has to match the machine.
    expect(
      lines.every((line) =>
        line.kind === 'cut' && line.axis === 'rip'
          ? line.x1Mm === line.x2Mm
          : line.kind === 'cut' && line.y1Mm === line.y2Mm,
      ),
    ).toBe(true)
  })

  test('says which offcut goes back on the rack and which is scrap', () => {
    const list = nestCutPieces([{ mark: 'A', widthMm: 600, heightMm: 1200 }], [plain], {
      offcutPolicy: { minKeepWidthMm: 200, minKeepLengthMm: 600 },
    })
    const sheet = list.sheets[0] as NestedSheet
    const shapes = cutSheetShapes(sheet, sheetCutSequence(sheet))
    const offcuts = shapes.filter((shape) => shape.kind === 'offcut')

    expect(offcuts.length).toBeGreaterThan(0)
    expect(offcuts.some((shape) => shape.kind === 'offcut' && shape.keep)).toBe(true)
    expect(
      shapes.some(
        (shape) => shape.kind === 'label' && shape.role === 'offcut' && shape.text.includes('keep'),
      ),
    ).toBe(true)
  })
})

describe('cutInstruction', () => {
  test('leads with the machine and names only the boards a cut actually frees', () => {
    const sheet = mixed()
    const plan = sheetCutSequence(sheet)
    const lines = plan.cuts.map(cutInstruction)

    expect(lines[0]).toMatch(/^1\. (Rip|Crosscut) at \d/)
    expect(lines.some((line) => line.includes('frees W1-P1'))).toBe(true)
    // Every mark is freed once, and some cuts free nothing — a "frees" on every line
    // would be the placement list again rather than an instruction.
    for (const placed of sheet.placements) {
      expect(
        lines.filter((line) => line.includes(`frees`) && line.includes(placed.mark)),
      ).toHaveLength(1)
    }
  })
})

describe('cutSheetSvg', () => {
  test('carries every sheet, each with its own numbered list', () => {
    const list = nestCutPieces(
      Array.from({ length: 4 }, (_, index) => ({
        mark: `P${index + 1}`,
        widthMm: 600,
        heightMm: 2400,
      })),
      [plain],
    )
    const svg = cutSheetSvg(
      list.sheets.map((sheet) => ({ sheet, plan: sheetCutSequence(sheet) })),
      'Level 1',
    )

    expect(list.sheets.length).toBe(2)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('Cut sheet — Level 1')
    expect(svg).toContain('sheet 1')
    expect(svg).toContain('sheet 2')
    for (const mark of ['P1', 'P2', 'P3', 'P4']) expect(svg).toContain(mark)
    // The same instructions the panel prints, out of the same function.
    for (const sheet of list.sheets) {
      for (const cut of sheetCutSequence(sheet).cuts) expect(svg).toContain(cutInstruction(cut))
    }
  })

  test('names a board no sheet holds, rather than leaving it off the drawing', () => {
    const list = nestCutPieces(
      [
        { mark: 'A', widthMm: 600, heightMm: 2400 },
        { mark: 'X1', widthMm: 1600, heightMm: 3200 },
      ],
      [plain],
    )
    const svg = cutSheetSvg(
      list.sheets.map((sheet) => ({ sheet, plan: sheetCutSequence(sheet) })),
      'Whole project',
      list.oversize,
    )

    expect(list.oversize.map((piece) => piece.mark)).toEqual(['X1'])
    expect(svg).toContain('X1 is 1600 × 3200 mm and larger than every stated sheet')
    expect(svg).toContain('defect rather than a cut')
  })

  test('says on the drawing that a layout no saw can cut has no sequence', () => {
    // A pinwheel, which is a legal nest on no machine. The drawing has to refuse rather
    // than print four of the five cuts it would take.
    const pinwheel: NestedSheet = {
      sheetId: plain.id,
      number: 1,
      widthMm: 1220,
      heightMm: 2440,
      placements: [
        { mark: 'A', xMm: 0, yMm: 0, widthMm: 800, heightMm: 400 },
        { mark: 'B', xMm: 800, yMm: 0, widthMm: 400, heightMm: 800 },
        { mark: 'C', xMm: 400, yMm: 800, widthMm: 800, heightMm: 400 },
        { mark: 'D', xMm: 0, yMm: 400, widthMm: 400, heightMm: 800 },
      ],
      offcuts: [],
      usedAreaMm2: 4 * 800 * 400,
    }
    const svg = cutSheetSvg([{ sheet: pinwheel, plan: sheetCutSequence(pinwheel) }], 'Level 1')

    expect(svg).toContain('No cut sequence')
    expect(svg).toContain('A, B, C, D')
    // The boards are still drawn: the layout is what somebody has to look at to see why.
    for (const mark of ['A', 'B', 'C', 'D']) expect(svg).toContain(`>${mark}</text>`)
  })

  test('escapes a mark that would otherwise break the file', () => {
    const sheet: NestedSheet = {
      sheetId: 'ply & board',
      number: 1,
      widthMm: 1220,
      heightMm: 2440,
      placements: [{ mark: 'W<1>', xMm: 0, yMm: 0, widthMm: 1220, heightMm: 2440 }],
      offcuts: [],
      usedAreaMm2: 1220 * 2440,
    }
    const svg = cutSheetSvg([{ sheet, plan: sheetCutSequence(sheet) }], 'A & B')

    expect(svg).toContain('W&lt;1&gt;')
    expect(svg).toContain('ply &amp; board')
    expect(svg).toContain('Cut sheet — A &amp; B')
    expect(svg).not.toContain('<1>')
  })
})
