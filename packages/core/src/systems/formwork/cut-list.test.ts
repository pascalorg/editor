import { describe, expect, it } from 'bun:test'
import { formworkCutList, formworkCutListCaveats } from './cut-list'
import { type FormworkPart, type FormworkPartSpec, partMark } from './parts'

/**
 * The join between a scene's boards and a merchant's sheets.
 *
 * The nest itself is tested in `layout/cut-optimiser.test.ts`. What is below is what this
 * layer decides: which parts are boards, that the pieces come off the parts rather than off
 * the grouped bill, that an unstated sheet gives no cut list rather than a plausible one,
 * and that the sheet count never reads as a bill line — which is the one failure here that
 * would produce a wrong total rather than a missing one.
 */

const PLAIN = 'ply-1220x2440x18-plain'
const BIRCH = 'ply-1250x2500x18-birch-wbp'

function board(stationMm: number, widthMm: number, heightMm: number): FormworkPart {
  const spec: FormworkPartSpec = {
    kind: 'ply-piece',
    use: 'cut-board',
    locus: { on: 'run', face: 'side-a', stationMm, courseIndex: 0 },
    description: 'Cut board',
    provenance: 'bespoke',
    widthMm,
    heightMm,
  }
  return { ...spec, mark: partMark(spec) }
}

function panel(stationMm: number): FormworkPart {
  const spec: FormworkPartSpec = {
    kind: 'panel',
    locus: { on: 'run', face: 'side-a', stationMm, courseIndex: 0 },
    catalogId: 'framax-2700-900',
    description: 'Framax Xlife 2.70 × 0.90 m',
    provenance: 'standard',
    weightKg: 86,
    widthMm: 900,
    heightMm: 2700,
  }
  return { ...spec, mark: partMark(spec) }
}

describe('formworkCutList', () => {
  it('nests the cut ply and leaves every other kind of part alone', () => {
    const out = formworkCutList([panel(0), board(900, 600, 2400), panel(1500)], {
      stockIds: [PLAIN],
    })

    expect(out?.boardCount).toBe(1)
    expect(out?.list.sheets).toHaveLength(1)
    expect(out?.list.sheets[0]?.placements.map((placed) => placed.mark)).toEqual([
      board(900, 600, 2400).mark,
    ])
  })

  it('has no cut list for a job with no cut ply in it', () => {
    // A steel-panel job has nothing to cut, and a cut list of zero sheets would read as a
    // job whose ply is free rather than as a job with no ply.
    expect(formworkCutList([panel(0), panel(900)], { stockIds: [PLAIN] })).toBeUndefined()
  })

  it('counts every board as a piece rather than the bill’s one grouped line', () => {
    // The decision this module exists to get right. `bomLines` folds four identical boards
    // into one line with a quantity of four; a nest over the line would place one board,
    // buy one sheet, and be short by three.
    const four = [
      board(0, 600, 2400),
      board(900, 600, 2400),
      board(1800, 600, 2400),
      board(2700, 600, 2400),
    ]
    const out = formworkCutList(four, { stockIds: [PLAIN] })

    expect(out?.boardCount).toBe(4)
    expect(out?.list.order).toEqual([{ sheetId: PLAIN, sheets: 2 }])
  })

  it('nests every element’s boards together, because that is where the offcut goes', () => {
    // Two 600 mm boards nested apart are two sheets; nested together they are one. A
    // per-element cut list added up is the wrong answer, and this is the size of the error.
    const together = formworkCutList([board(0, 600, 2400), board(900, 600, 2400)], {
      stockIds: [PLAIN],
    })
    const apart =
      (formworkCutList([board(0, 600, 2400)], { stockIds: [PLAIN] })?.list.sheets.length ?? 0) +
      (formworkCutList([board(900, 600, 2400)], { stockIds: [PLAIN] })?.list.sheets.length ?? 0)

    expect(together?.list.sheets).toHaveLength(1)
    expect(apart).toBe(2)
  })

  it('reports the board area including the boards no sheet could hold', () => {
    // An area figure that dropped a refusal would make the nest look better the worse the
    // stated sheet fitted the job.
    const out = formworkCutList([board(0, 600, 2400), board(900, 1600, 3200)], {
      stockIds: [PLAIN],
    })

    expect(out?.boardCount).toBe(2)
    expect(out?.boardAreaM2).toBe(6.56)
    expect(out?.list.oversize).toHaveLength(1)
    expect(out?.complete).toBe(false)
  })

  it('leaves an omitted board out of the nest', () => {
    // An override struck it from the shutter, so nobody cuts it and nobody buys ply for it.
    const struck: FormworkPart = { ...board(900, 600, 2400), omitted: true }
    const out = formworkCutList([board(0, 600, 2400), struck], { stockIds: [PLAIN] })

    expect(out?.boardCount).toBe(1)
    expect(out?.list.sheets[0]?.placements).toHaveLength(1)
  })

  it('nests nothing out of an empty sheet list rather than picking a sheet', () => {
    // Nesting against the whole catalog would answer for a merchant rather than for the job.
    const out = formworkCutList([board(0, 600, 2400)], {})

    expect(out?.list.gaps).toEqual(['no-stock-stated', 'piece-over-sheet'])
    expect(out?.list.order).toEqual([])
    expect(out?.complete).toBe(false)
  })

  it('records a sheathing grade as an id that nests nothing rather than nesting one', () => {
    // The write paths refuse this. One arriving here came from an older scene or a
    // hand-edited node, and a grade carries no width and no length at all.
    const out = formworkCutList([board(0, 600, 2400)], { stockIds: ['film-faced-ply-18'] })

    expect(out?.unknownStockIds).toEqual(['film-faced-ply-18'])
    expect(out?.stockIds).toEqual([])
    expect(out?.complete).toBe(false)
  })

  it('nests out of the sheets it does recognise beside one it does not', () => {
    const out = formworkCutList([board(0, 600, 2400)], { stockIds: ['nope', PLAIN] })

    expect(out?.unknownStockIds).toEqual(['nope'])
    expect(out?.stockIds).toEqual([PLAIN])
    expect(out?.list.sheets).toHaveLength(1)
  })

  it('states the sheets in the order the project stated them', () => {
    const out = formworkCutList([board(0, 1240, 2400)], { stockIds: [BIRCH, PLAIN] })

    expect(out?.stockIds).toEqual([BIRCH, PLAIN])
    expect(out?.list.order).toEqual([{ sheetId: BIRCH, sheets: 1 }])
  })

  it('racks the offcut only where the yard has stated a threshold', () => {
    const boards = [board(0, 600, 2400)]
    const kept = formworkCutList(boards, {
      stockIds: [PLAIN],
      minKeepWidthMm: 150,
      minKeepLengthMm: 600,
    })
    const unstated = formworkCutList(boards, { stockIds: [PLAIN] })

    expect(kept?.list.retainableAreaMm2).toBeGreaterThan(0)
    expect(unstated?.list.retainableAreaMm2).toBe(0)
    // A racked offcut is a gap because it is a figure somebody has to act on, not an error.
    expect(kept?.complete).toBe(false)
  })

  it('takes an area threshold on its own', () => {
    const out = formworkCutList([board(0, 600, 2400)], {
      stockIds: [PLAIN],
      minKeepAreaM2: 1,
    })

    expect(out?.list.retainableAreaMm2).toBeGreaterThan(0)
  })

  it('carries the handling allowance through to the order and leaves the nest alone', () => {
    const boards = Array.from({ length: 6 }, (_, index) => board(index * 700, 600, 2400))
    const out = formworkCutList(boards, { stockIds: [PLAIN], handlingWasteFraction: 0.1 })

    expect(out?.list.order).toEqual([{ sheetId: PLAIN, sheets: 3 }])
    expect(out?.list.orderWithAllowance).toEqual([{ sheetId: PLAIN, sheets: 4 }])
    expect(out?.list.cuttingWasteFraction).toBeCloseTo(0.033, 3)
  })

  it('carries no allowance where none is stated', () => {
    expect(
      formworkCutList([board(0, 600, 2400)], { stockIds: [PLAIN] })?.list.orderWithAllowance,
    ).toBeUndefined()
  })

  it('turns no board, whatever it is for', () => {
    // Every one of these is a form face — a box-out reveal takes the pour's pressure exactly
    // as a wall board does — so a board across the grain is a different product.
    const reveal: FormworkPartSpec = {
      kind: 'ply-piece',
      use: 'box-out',
      locus: { on: 'opening', openingId: 'op_1', reveal: 'head' },
      description: 'Box-out',
      provenance: 'bespoke',
      widthMm: 2400,
      heightMm: 600,
    }
    const out = formworkCutList([{ ...reveal, mark: partMark(reveal) }], { stockIds: [PLAIN] })

    expect(out?.list.oversize).toHaveLength(1)
    expect(out?.list.sheets).toEqual([])
  })

  it('nests the same boards the same way whatever order they arrive in', () => {
    // A sheet count that moved between two reads of one scene would be unusable.
    const forwards = [board(0, 600, 2400), board(900, 400, 1200), board(1800, 250, 800)]
    const backwards = [...forwards].reverse()

    expect(formworkCutList(backwards, { stockIds: [PLAIN] })).toEqual(
      formworkCutList(forwards, { stockIds: [PLAIN] }) as never,
    )
  })
})

describe('formworkCutListCaveats', () => {
  it('leads with the double-count, because that is the error a reader makes', () => {
    const out = formworkCutListCaveats(
      formworkCutList([board(0, 600, 2400), board(900, 600, 2400)], {
        stockIds: [PLAIN],
      }) as never,
    )

    expect(out[0]).toContain('counts the same material twice')
    expect(out[0]).toContain('1 sheet')
    expect(out[0]).toContain('2 boards')
    expect(out.some((line) => line.includes('two scopes’ sheet counts do not add up'))).toBe(true)
  })

  it('passes the nest’s own caveats through verbatim', () => {
    const out = formworkCutListCaveats(
      formworkCutList([board(0, 600, 2400)], { stockIds: [PLAIN] }) as never,
    )

    expect(out.some((line) => line.includes('behind a waler'))).toBe(true)
  })

  it('says which stated sheet is not a sheet', () => {
    const out = formworkCutListCaveats(
      formworkCutList([board(0, 600, 2400)], { stockIds: ['film-faced-ply-18'] }) as never,
    )

    expect(out.some((line) => line.includes('film-faced-ply-18'))).toBe(true)
    expect(out.some((line) => line.includes('names no sheet in the catalog'))).toBe(true)
  })

  it('says nothing about a purchase where no sheet was stated', () => {
    // Nothing was bought, so a sentence about what the sheets are not would be answering a
    // question nobody could have asked. The nest's own "no stock stated" line is the answer.
    const out = formworkCutListCaveats(formworkCutList([board(0, 600, 2400)], {}) as never)

    expect(out.some((line) => line.includes('counts the same material twice'))).toBe(false)
    expect(out.some((line) => line.includes('nothing to nest out of'))).toBe(true)
  })
})
