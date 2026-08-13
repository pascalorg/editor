import { describe, expect, it } from 'bun:test'
import { type SheetStock, sheetStock } from '../catalog'
import { type CutPiece, type NestedSheet, nestCutPieces } from './cut-optimiser'
import { sheetCutSequence } from './cut-plan'

/**
 * The order a sheet is cut in.
 *
 * What is asserted here is not the nest — that is `cut-optimiser.test.ts` — but the one
 * property a drawing of it has to hold: every cut runs edge to edge across whatever is
 * still joined at that point, so a carpenter can make cut *n* with the piece cut *n-1*
 * produced. So most of these are checks that a cut never crosses a board, and that the
 * one case where a straight cut cannot separate a layout comes back as a refusal rather
 * than as a plan that stops half way.
 */

const plain = sheetStock('ply-1220x2440x18-plain') as SheetStock

const boards = (count: number, widthMm: number, heightMm: number): CutPiece[] =>
  Array.from({ length: count }, (_, index) => ({ mark: `P${index + 1}`, widthMm, heightMm }))

function nestOne(pieces: CutPiece[]): NestedSheet {
  const sheet = nestCutPieces(pieces, [plain]).sheets[0]
  if (sheet === undefined) throw new Error('the fixture nested nothing')
  return sheet
}

/** Whether any cut passes through the middle of a placed board, which is the whole test. */
function cutsThroughABoard(sheet: NestedSheet): boolean {
  const plan = sheetCutSequence(sheet)
  return plan.cuts.some((cut) =>
    sheet.placements.some((placed) => {
      const [nearMm, farMm, alongStartMm, alongEndMm] =
        cut.axis === 'rip'
          ? [placed.xMm, placed.xMm + placed.widthMm, placed.yMm, placed.yMm + placed.heightMm]
          : [placed.yMm, placed.yMm + placed.heightMm, placed.xMm, placed.xMm + placed.widthMm]
      const across = cut.atMm > nearMm + 0.05 && cut.atMm < farMm - 0.05
      const reaches = cut.fromMm < alongEndMm - 0.05 && cut.toMm > alongStartMm + 0.05
      return across && reaches
    }),
  )
}

describe('sheetCutSequence', () => {
  it('rips the strip off, at the fence position rather than at the offcut’s edge', () => {
    // Two full-height boards across a 1220 mm sheet: rips at 600 and at 1203.5, and the
    // second one is a cut rather than an edge — the 13 mm the kerf left over is only a
    // sliver *after* somebody saws the second board free of it.
    const plan = sheetCutSequence(nestOne(boards(2, 600, 2440)))

    expect(plan.guillotineable).toBe(true)
    expect(plan.cuts.map((cut) => cut.axis)).toEqual(['rip', 'rip'])
    // The cut face, which is where a fence goes — not 603.5, where the blade comes out.
    expect(plan.cuts.map((cut) => cut.atMm)).toEqual([600, 1203.5])
    // The first runs the whole sheet because nothing is off it yet; both run its length.
    expect(plan.cuts[0]?.fromMm).toBe(0)
    expect(plan.cuts[0]?.toMm).toBe(2440)
    expect(plan.cuts.map((cut) => cut.frees)).toEqual([['P1'], ['P2']])
  })

  it('numbers the cuts in an order a saw can follow — never across a board already placed', () => {
    // A mixed sheet: two full-height boards and two short ones, which is what a wall with
    // a lift joint in it actually produces. The property is the same on every one of them.
    const mixed = nestOne([
      { mark: 'A', widthMm: 600, heightMm: 2440 },
      { mark: 'B', widthMm: 400, heightMm: 1200 },
      { mark: 'C', widthMm: 400, heightMm: 900 },
      { mark: 'D', widthMm: 180, heightMm: 600 },
    ])
    const plan = sheetCutSequence(mixed)

    expect(plan.guillotineable).toBe(true)
    expect(plan.cuts.length).toBeGreaterThan(1)
    expect(plan.cuts.map((cut) => cut.order)).toEqual(plan.cuts.map((_, index) => index + 1))
    expect(cutsThroughABoard(mixed)).toBe(false)
  })

  it('does not run a later cut the full width of the sheet', () => {
    // The cut that frees a short board runs across the strip it is in, not across the
    // sheet: a plan whose every cut spanned 1220 mm would take the blade back through
    // boards freed two cuts earlier.
    const stack = nestOne([
      { mark: 'A', widthMm: 600, heightMm: 2440 },
      { mark: 'B', widthMm: 600, heightMm: 1200 },
      { mark: 'C', widthMm: 600, heightMm: 1200 },
    ])
    const plan = sheetCutSequence(stack)
    const crosscuts = plan.cuts.filter((cut) => cut.axis === 'crosscut')

    expect(crosscuts.length).toBeGreaterThan(0)
    expect(crosscuts.every((cut) => cut.toMm - cut.fromMm < 1220)).toBe(true)
    expect(cutsThroughABoard(stack)).toBe(false)
  })

  it('says which cut finishes a board and which only breaks the sheet down', () => {
    const plan = sheetCutSequence(
      nestOne([
        { mark: 'A', widthMm: 600, heightMm: 2440 },
        { mark: 'B', widthMm: 400, heightMm: 1200 },
      ]),
    )
    const freeing = plan.cuts.filter((cut) => cut.frees.length > 0)

    // Every mark on the sheet is freed by exactly one cut, and some cuts free nothing —
    // otherwise "frees" is a second copy of the placement list rather than an instruction.
    expect(freeing.flatMap((cut) => cut.frees).sort()).toEqual(['A', 'B'])
    expect(plan.cuts.some((cut) => cut.frees.length === 0)).toBe(true)
  })

  it('needs no cuts at all where one board fills the sheet', () => {
    const plan = sheetCutSequence(nestOne([{ mark: 'F1', widthMm: 1220, heightMm: 2440 }]))

    expect(plan.cuts).toEqual([])
    expect(plan.guillotineable).toBe(true)
    expect(plan.unsequencedMarks).toEqual([])
  })

  it('refuses a layout no straight cut separates, rather than sequencing part of it', () => {
    // A pinwheel: four boards around a hole, which is a legal MaxRects nest and cuttable
    // on no saw. Not a layout `nestCutPieces` produces — it is what the drawing has to be
    // safe against, since an annealed or hand-supplied nest is still a `NestedSheet`.
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
    const plan = sheetCutSequence(pinwheel)

    expect(plan.guillotineable).toBe(false)
    expect(plan.cuts).toEqual([])
    expect(plan.unsequencedMarks).toEqual(['A', 'B', 'C', 'D'])
  })

  it('carries the sheet it is a plan for, so a sequence cannot be read against the wrong sheet', () => {
    const list = nestCutPieces(boards(4, 600, 2400), [plain])
    const plans = list.sheets.map((sheet) => sheetCutSequence(sheet))

    expect(plans.map((plan) => plan.number)).toEqual([1, 2])
    expect(plans.every((plan) => plan.sheetId === plain.id)).toBe(true)
  })
})
