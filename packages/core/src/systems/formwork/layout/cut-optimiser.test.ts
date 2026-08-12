import { describe, expect, it } from 'bun:test'
import { SHEET_STOCK, type SheetStock, sheetStock } from '../catalog'
import { type CutPiece, cutListCaveats, nestCutPieces } from './cut-optimiser'

/**
 * Nesting the boards out of the sheets.
 *
 * Most of what is below is about the two things a nest gets wrong quietly: the kerf, which
 * turns four boards that fit on paper into five sheets on site, and the grain, which makes
 * a rotation an error rather than an optimisation. The rest is the arithmetic a quantity
 * surveyor would check by hand — sheets, area, waste — and the refusals.
 */

const plain = sheetStock('ply-1220x2440x18-plain') as SheetStock
const birch = sheetStock('ply-1250x2500x18-birch-wbp') as SheetStock

const boards = (count: number, widthMm: number, heightMm: number): CutPiece[] =>
  Array.from({ length: count }, (_, index) => ({ mark: `P${index + 1}`, widthMm, heightMm }))

describe('nestCutPieces', () => {
  it('counts sheets rather than area — two full-height boards to a sheet, not two and a half', () => {
    // 4 × 600 × 2400 is 5.76 m² of ply, which is 1.9 sheets by area and 2 sheets by nest:
    // only two 600 mm boards fit across 1220 mm, so the third opens a sheet.
    const out = nestCutPieces(boards(4, 600, 2400), [plain])

    expect(out.sheets.length).toBe(2)
    expect(out.order).toEqual([{ sheetId: plain.id, sheets: 2 }])
    expect(out.sheets.every((sheet) => sheet.placements.length === 2)).toBe(true)
    expect(out.pieceAreaMm2).toBe(4 * 600 * 2400)
    expect(out.sheetAreaMm2).toBe(2 * 1220 * 2440)
    expect(out.cuttingWasteFraction).toBeCloseTo(0.033, 3)
    expect(out.oversize).toEqual([])
  })

  it('makes the blade cost a sheet — four boards that fit on paper do not fit through a saw', () => {
    // 4 × 304 mm is 1216 mm across a 1220 mm sheet, so they fit with 4 mm to spare. Three
    // cuts between them take 10.5 mm, which they do not have. The kerf is the whole
    // difference between one sheet and two here, which is why it is reserved per cut and
    // not applied as a percentage at the end.
    const pieces = boards(4, 304, 2400)

    expect(nestCutPieces(pieces, [plain], { kerfMm: 0 }).sheets.length).toBe(1)
    expect(nestCutPieces(pieces, [plain]).sheets.length).toBe(2)
  })

  it('reserves the kerf between two boards and not against the sheet’s own edge', () => {
    // 610 + 600 is 1210 and fits with the blade's 3.5 mm between them; 610 + 610 is exactly
    // 1220 and does not, because a cut down the middle of a sheet costs material. The far
    // edge is not a cut, so a board flush against it leaves no offcut at all rather than a
    // negative one.
    const pair = nestCutPieces(
      [
        { mark: 'A', widthMm: 610, heightMm: 2440 },
        { mark: 'B', widthMm: 600, heightMm: 2440 },
      ],
      [plain],
    )

    expect(pair.sheets.length).toBe(1)
    expect(pair.sheets[0]?.placements.map((placed) => placed.xMm)).toEqual([0, 613.5])
    expect(nestCutPieces(boards(2, 610, 2440), [plain]).sheets.length).toBe(2)

    // A board filling the sheet leaves nothing — not a negative rectangle from a kerf
    // charged against an edge nobody cuts.
    const whole = nestCutPieces([{ mark: 'F1', widthMm: 1220, heightMm: 2440 }], [plain])
    expect(whole.sheets[0]?.offcuts).toEqual([])
    expect(whole.cuttingWasteFraction).toBe(0)
  })

  it('will not turn a board against the grain', () => {
    // 2400 × 600 lying across a 1220 × 2440 sheet: it fits turned and only turned. Face
    // grain runs along the length and carries the bending, so this is a refusal rather
    // than a rotation — every sheet in the catalog is rotatable: false.
    const across: CutPiece[] = [{ mark: 'W1', widthMm: 2400, heightMm: 600 }]

    expect(nestCutPieces(across, [plain]).oversize.map((piece) => piece.mark)).toEqual(['W1'])
    expect(nestCutPieces(across, [plain], { allowRotation: true }).oversize).toHaveLength(1)
  })

  it('turns a board that spans nothing, when the caller allows it', () => {
    // The piece's claim, not the sheet's: a box-out reveal carries no bending, so which
    // way its grain runs does not matter and it may be turned to fit.
    const reveal: CutPiece[] = [{ mark: 'B1', widthMm: 2400, heightMm: 600, grainAgnostic: true }]

    expect(nestCutPieces(reveal, [plain], { allowRotation: true }).oversize).toEqual([])
    expect(
      nestCutPieces(reveal, [plain], { allowRotation: true }).sheets[0]?.placements[0],
    ).toEqual({
      mark: 'B1',
      xMm: 0,
      yMm: 0,
      widthMm: 600,
      heightMm: 2400,
      rotated: true,
    })
    // Still a refusal without the flag: a rotation is the caller's decision because it is
    // a claim about what the board spans.
    expect(nestCutPieces(reveal, [plain]).oversize).toHaveLength(1)
  })

  it('names a board no sheet holds instead of splicing it across two', () => {
    // A formlining board with a joint mid-span is a defect rather than a cut, so the
    // answer is the same one bomWeightKg gives: say which piece, and do not estimate.
    // 1600 × 3200 is over the largest sheet stocked, which is the 1500 × 3000.
    const out = nestCutPieces([{ mark: 'X1', widthMm: 1600, heightMm: 3200 }], SHEET_STOCK)

    expect(out.oversize.map((piece) => piece.mark)).toEqual(['X1'])
    expect(out.sheets).toEqual([])
    expect(out.gaps).toEqual(['piece-over-sheet'])
    expect(out.complete).toBe(false)
  })

  it('nests the rest of the job around the board it refused', () => {
    const out = nestCutPieces(
      [{ mark: 'X1', widthMm: 1300, heightMm: 2600 }, ...boards(2, 600, 2400)],
      [plain],
    )

    expect(out.oversize.map((piece) => piece.mark)).toEqual(['X1'])
    expect(out.sheets.length).toBe(1)
    expect(out.sheets[0]?.placements).toHaveLength(2)
  })

  it('takes the first stated sheet that holds the board, so the list is a preference', () => {
    // 1240 mm fits the birch sheet and not the 1220. Stated birch-first it uses birch;
    // stated the other way round it still uses birch, because the 1220 cannot hold it.
    const wide: CutPiece[] = [{ mark: 'W1', widthMm: 1240, heightMm: 2400 }]

    expect(nestCutPieces(wide, [birch, plain]).order).toEqual([{ sheetId: birch.id, sheets: 1 }])
    expect(nestCutPieces(wide, [plain, birch]).order).toEqual([{ sheetId: birch.id, sheets: 1 }])
  })

  it('says there is nothing to nest out of rather than assuming a sheet size', () => {
    const out = nestCutPieces(boards(2, 600, 2400), [])

    expect(out.gaps).toEqual(['no-stock-stated', 'piece-over-sheet'])
    expect(out.oversize).toHaveLength(2)
    expect(out.order).toEqual([])
    expect(out.cuttingWasteFraction).toBe(0)
  })

  it('nests nothing out of nothing without inventing a gap about the boards', () => {
    const out = nestCutPieces([], [])

    expect(out.gaps).toEqual(['no-stock-stated'])
    expect(out.oversize).toEqual([])
  })

  it('buys no sheets for a job with no boards', () => {
    const out = nestCutPieces([], [plain])

    expect(out.sheets).toEqual([])
    expect(out.order).toEqual([])
    expect(out.complete).toBe(true)
    expect(out.gaps).toEqual([])
  })

  it('keeps the offcut worth racking and calls the sliver scrap', () => {
    // One 600 × 2400 board on a 1220 × 2440 sheet leaves a 616.5 × 2440 offcut, which any
    // yard racks, and a 600 × 36.5 strip, which splits when it is nailed.
    const out = nestCutPieces(boards(1, 600, 2400), [plain], {
      offcutPolicy: { minKeepWidthMm: 150, minKeepLengthMm: 600 },
    })

    const kept = out.sheets[0]?.offcuts.filter((offcut) => offcut.keep) ?? []
    const scrap = out.sheets[0]?.offcuts.filter((offcut) => !offcut.keep) ?? []
    expect(kept.map((offcut) => [offcut.widthMm, offcut.heightMm])).toEqual([[616.5, 2440]])
    expect(scrap.map((offcut) => [offcut.widthMm, offcut.heightMm])).toEqual([[600, 36.5]])
    expect(out.retainableAreaMm2).toBeCloseTo(616.5 * 2440, 1)
    expect(out.gaps).toEqual(['offcuts-retainable'])
  })

  it('keeps nothing where the policy states no threshold', () => {
    // An unstated threshold is a question nobody answered, not a yard that racks slivers.
    const out = nestCutPieces(boards(1, 600, 2400), [plain], { offcutPolicy: {} })

    expect(out.retainableAreaMm2).toBe(0)
    expect(out.gaps).toEqual([])
  })

  it('never nets the retained offcut off the waste', () => {
    // A kept offcut only saves a sheet if the next job finds it on the rack. The waste is
    // what this job's sheets did not become boards, whoever keeps the remainder.
    const pieces = boards(1, 600, 2400)
    const kept = nestCutPieces(pieces, [plain], {
      offcutPolicy: { minKeepWidthMm: 150, minKeepLengthMm: 600 },
    })
    const notKept = nestCutPieces(pieces, [plain])

    expect(kept.cuttingWasteFraction).toBe(notKept.cuttingWasteFraction)
    expect(kept.retainableAreaMm2).toBeGreaterThan(0)
    expect(notKept.retainableAreaMm2).toBe(0)
  })

  it('applies the damage allowance to the sheet count and leaves the waste alone', () => {
    // Two wastes, not one: the nest's 3.3 % is reducible and the 10 % for damaged edges
    // is not, so folding them into one figure hides which of them anybody can move.
    const out = nestCutPieces(boards(6, 600, 2400), [plain], { handlingWasteFraction: 0.1 })

    expect(out.order).toEqual([{ sheetId: plain.id, sheets: 3 }])
    // 3 × 1.1 is 3.3 sheets, and a third of a sheet is not orderable.
    expect(out.orderWithAllowance).toEqual([{ sheetId: plain.id, sheets: 4 }])
    expect(out.cuttingWasteFraction).toBeCloseTo(0.033, 3)
  })

  it('rounds the allowance per stock id rather than over the total', () => {
    // Two half-allowances of different sizes are not one sheet of either.
    const out = nestCutPieces(
      [...boards(2, 600, 2400), { mark: 'W1', widthMm: 1240, heightMm: 2400 }],
      [plain, birch],
      { handlingWasteFraction: 0.1 },
    )

    expect(out.orderWithAllowance).toEqual([
      { sheetId: plain.id, sheets: 2 },
      { sheetId: birch.id, sheets: 2 },
    ])
  })

  it('carries no allowance figure where none is stated', () => {
    expect(nestCutPieces(boards(2, 600, 2400), [plain]).orderWithAllowance).toBeUndefined()
  })

  it('numbers the sheets from one within each stock id, the way a cut sheet is numbered', () => {
    const out = nestCutPieces(
      [...boards(4, 600, 2400), { mark: 'W1', widthMm: 1240, heightMm: 2400 }],
      [plain, birch],
    )

    expect(out.sheets.map((sheet) => [sheet.sheetId, sheet.number])).toEqual([
      [birch.id, 1],
      [plain.id, 1],
      [plain.id, 2],
    ])
  })

  it('nests the same job the same way whatever order the boards arrive in', () => {
    // A bill that changed between two reads of one scene would be unusable, so the
    // insertion order is total: width, then height, then the mark.
    const forwards: CutPiece[] = [
      { mark: 'A', widthMm: 600, heightMm: 2400 },
      { mark: 'B', widthMm: 400, heightMm: 2400 },
      { mark: 'C', widthMm: 600, heightMm: 1200 },
      { mark: 'D', widthMm: 200, heightMm: 900 },
    ]
    const backwards = [...forwards].reverse()

    expect(nestCutPieces(backwards, [plain])).toEqual(nestCutPieces(forwards, [plain]))
    expect(nestCutPieces(forwards, [plain])).toEqual(nestCutPieces(forwards, [plain]))
  })

  it('cuts every board a stated order left out', () => {
    // Silently dropping a board is the one failure a nest could hide from every surface
    // downstream, so an order is a preference over the pieces and not a filter on them.
    const pieces = boards(4, 600, 2400)
    const out = nestCutPieces(pieces, [plain], { order: ['P3', 'P1'] })

    expect(
      out.sheets.flatMap((sheet) => sheet.placements.map((placed) => placed.mark)).sort(),
    ).toEqual(['P1', 'P2', 'P3', 'P4'])
    expect(out.sheets[0]?.placements.map((placed) => placed.mark)).toEqual(['P3', 'P1'])
  })

  it('ignores a mark in the order that is not in the job', () => {
    const out = nestCutPieces(boards(2, 600, 2400), [plain], { order: ['nope', 'P2'] })

    expect(out.sheets[0]?.placements.map((placed) => placed.mark)).toEqual(['P2', 'P1'])
  })

  it('places every board inside its sheet and clear of every other board', () => {
    // The invariant the whole module exists to hold: overlapping placements would produce
    // a nest that balances on area and cannot be cut at all.
    const out = nestCutPieces(
      [
        ...boards(5, 600, 2400),
        { mark: 'S1', widthMm: 450, heightMm: 1100 },
        { mark: 'S2', widthMm: 380, heightMm: 950 },
        { mark: 'S3', widthMm: 220, heightMm: 700 },
      ],
      [plain],
    )

    for (const sheet of out.sheets) {
      for (const placed of sheet.placements) {
        expect(placed.xMm + placed.widthMm).toBeLessThanOrEqual(sheet.widthMm)
        expect(placed.yMm + placed.heightMm).toBeLessThanOrEqual(sheet.heightMm)
      }
      for (const [i, a] of sheet.placements.entries()) {
        for (const b of sheet.placements.slice(i + 1)) {
          const apart =
            a.xMm + a.widthMm <= b.xMm ||
            b.xMm + b.widthMm <= a.xMm ||
            a.yMm + a.heightMm <= b.yMm ||
            b.yMm + b.heightMm <= a.yMm
          expect(apart).toBe(true)
        }
      }
    }
  })

  it('keeps every offcut clear of every board too, so the rack figure is real', () => {
    const out = nestCutPieces(
      [...boards(3, 600, 2400), { mark: 'S1', widthMm: 450, heightMm: 1100 }],
      [plain],
    )

    for (const sheet of out.sheets) {
      for (const offcut of sheet.offcuts) {
        for (const placed of sheet.placements) {
          const apart =
            offcut.xMm + offcut.widthMm <= placed.xMm ||
            placed.xMm + placed.widthMm <= offcut.xMm ||
            offcut.yMm + offcut.heightMm <= placed.yMm ||
            placed.yMm + placed.heightMm <= offcut.yMm
          expect(apart).toBe(true)
        }
      }
    }
  })

  it('never claims more used area than the sheet holds', () => {
    const out = nestCutPieces(boards(9, 380, 2400), [plain])

    for (const sheet of out.sheets) {
      expect(sheet.usedAreaMm2).toBeLessThanOrEqual(sheet.widthMm * sheet.heightMm)
    }
    expect(out.pieceAreaMm2).toBeLessThanOrEqual(out.sheetAreaMm2)
    expect(out.cuttingWasteFraction).toBeGreaterThan(0)
    expect(out.cuttingWasteFraction).toBeLessThan(1)
  })

  it('takes the catalog kerf where the caller states none', () => {
    expect(nestCutPieces(boards(1, 600, 2400), [plain]).kerfMm).toBe(3.5)
    expect(nestCutPieces(boards(1, 600, 2400), [plain], { kerfMm: 5 }).kerfMm).toBe(5)
  })
})

describe('cutListCaveats', () => {
  it('leads with the constraint the nest does not carry', () => {
    // A cut list goes straight to somebody with a saw, and the first thing they will apply
    // is the one thing this cannot check: a cut board's edge has to land behind a waler.
    const out = cutListCaveats(nestCutPieces(boards(4, 600, 2400), [plain]))

    expect(out[0]).toContain('behind a waler')
    expect(out[0]).toContain('3.5 mm')
    expect(out.some((line) => line.includes('separate allowance'))).toBe(true)
  })

  it('says the retained offcut is not subtracted from anything', () => {
    const out = cutListCaveats(
      nestCutPieces(boards(1, 600, 2400), [plain], {
        offcutPolicy: { minKeepWidthMm: 150, minKeepLengthMm: 600 },
      }),
    )

    expect(out.some((line) => line.includes('finds it on the rack'))).toBe(true)
    expect(out.some((line) => line.includes('large enough to rack under the stated policy'))).toBe(
      true,
    )
  })

  it('names the boards it refused rather than reporting a total that hides them', () => {
    const out = cutListCaveats(
      nestCutPieces([{ mark: 'X1', widthMm: 1600, heightMm: 3200 }], SHEET_STOCK),
    )

    expect(out.some((line) => line.includes('larger than every stated sheet'))).toBe(true)
  })

  it('says nothing about a saw where nothing was nested', () => {
    const out = cutListCaveats(nestCutPieces([], []))

    expect(out.some((line) => line.includes('behind a waler'))).toBe(false)
    expect(out).toEqual([
      'No sheet stock stated, so there is nothing to nest out of — record the sheet the job buys, because its size is what decides how many are needed',
    ])
  })
})
