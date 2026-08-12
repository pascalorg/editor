import { describe, expect, it } from 'bun:test'
import { type SheetStock, sheetStock } from '../catalog'
import { type CutPiece, nestCutPieces } from './cut-optimiser'
import { type NestSearch, nestSearchCaveats, orderPiecesForNest } from './cut-search'

/**
 * Searching the orderings.
 *
 * Two properties carry most of the weight below, and both are about trust rather than
 * about the nest: the search can never come back worse than the plain sort, and the same
 * seed on the same pieces must give the same bill — a sheet count that moved between two
 * reads of one scene would be unusable whatever it saved.
 */

const plain = sheetStock('ply-1220x2440x18-plain') as SheetStock
const birch = sheetStock('ply-1250x2500x18-birch-wbp') as SheetStock

/**
 * A job the plain widest-first sort loses a sheet on.
 *
 * Not invented — found by nesting every permutation of it and comparing: 3 sheets sorted,
 * 2 on the best order, so a search that reports no gain here is broken rather than lucky.
 * The 750 is what does it, taking a sheet of its own that the 670 and the 520 then share.
 */
const beatable: CutPiece[] = [
  { mark: 'P1', widthMm: 750, heightMm: 1200 },
  { mark: 'P2', widthMm: 390, heightMm: 1800 },
  { mark: 'P3', widthMm: 290, heightMm: 1200 },
  { mark: 'P4', widthMm: 670, heightMm: 1700 },
  { mark: 'P5', widthMm: 590, heightMm: 700 },
  { mark: 'P6', widthMm: 520, heightMm: 1000 },
  { mark: 'P7', widthMm: 410, heightMm: 800 },
]

/**
 * A mixed job whose widths do not divide into 1220. Its 6.84 m² of ply cannot come off
 * fewer than 3 sheets of 2.98 m², and the plain sort already takes 3 — so this is the
 * fixture for everything *except* improvement, because there is nothing here to find.
 */
const mixed: CutPiece[] = [
  { mark: 'A1', widthMm: 750, heightMm: 2400 },
  { mark: 'A2', widthMm: 470, heightMm: 2400 },
  { mark: 'A3', widthMm: 610, heightMm: 1200 },
  { mark: 'A4', widthMm: 600, heightMm: 1200 },
  { mark: 'A5', widthMm: 430, heightMm: 900 },
  { mark: 'A6', widthMm: 380, heightMm: 1500 },
  { mark: 'A7', widthMm: 300, heightMm: 700 },
  { mark: 'A8', widthMm: 240, heightMm: 2400 },
  { mark: 'A9', widthMm: 900, heightMm: 800 },
]

describe('orderPiecesForNest', () => {
  it('saves the sheet the plain sort wastes', () => {
    // The test the module exists for. A brute force over every ordering of this job puts
    // the floor at 2 sheets and the widest-first sort takes 3, so the annealer has to find
    // it — and on every seed, because a search that only works on lucky seeds is not one.
    for (const seed of [1, 2, 3, 7, 17, 42]) {
      const out = orderPiecesForNest(beatable, [plain], { seed })

      expect(out.baseline.sheets).toBe(3)
      expect(out.list.sheets.length).toBe(2)
      expect(out.improved).toBe(true)
      expect(out.list.cuttingWasteFraction).toBeLessThan(out.baseline.cuttingWasteFraction)
      expect(out.list.oversize).toEqual([])
    }
  })

  it('cuts every board on the order it improved to', () => {
    // The failure a saving could hide: an order that loses a board nests on fewer sheets
    // and is a wrong answer rather than a better one.
    const out = orderPiecesForNest(beatable, [plain], { seed: 3 })

    expect(
      out.list.sheets.flatMap((sheet) => sheet.placements.map((placed) => placed.mark)).sort(),
    ).toEqual(beatable.map((piece) => piece.mark).sort())
  })

  it('gives the same bill twice on one seed', () => {
    // The property the whole module is arranged around: Math.random() here would make a
    // wall want 14 sheets this morning and 15 this afternoon.
    const first = orderPiecesForNest(mixed, [plain], { seed: 7 })
    const second = orderPiecesForNest(mixed, [plain], { seed: 7 })

    expect(second.order).toEqual(first.order)
    expect(second.list).toEqual(first.list)
  })

  it('reports the same baseline whatever seed it searched from', () => {
    // The baseline is the plain sort, which has nothing to do with the seed — a baseline
    // that moved with it would make the reported saving meaningless.
    const baseline = orderPiecesForNest(beatable, [plain], { seed: 1 }).baseline

    for (const seed of [1, 2, 3, 99, 12_345]) {
      const out = orderPiecesForNest(beatable, [plain], { seed })
      expect(out.baseline).toEqual(baseline)
      expect(out.list.sheets.length).toBeLessThanOrEqual(baseline.sheets)
    }
  })

  it('never returns a nest worse than the plain sort, whatever the search found', () => {
    // A short search is the case that would expose it: 3 iterations is not enough to find
    // anything, and an annealer that returned its last state rather than its best would
    // hand back a worse bill than not searching at all.
    for (const iterations of [1, 2, 3, 5, 20]) {
      const out = orderPiecesForNest(beatable, [plain], { seed: 4, iterations })
      expect(out.list.sheets.length).toBeLessThanOrEqual(out.baseline.sheets)
      if (!out.improved) expect(out.list.sheets.length).toBe(out.baseline.sheets)
    }
  })

  it('says it did not improve rather than claiming a gain it did not make', () => {
    // Four 600 mm boards nest two to a sheet in any order — there is nothing to find, and
    // an optimiser that reported a saving here would be reporting noise.
    const even: CutPiece[] = Array.from({ length: 4 }, (_, index) => ({
      mark: `E${index + 1}`,
      widthMm: 600,
      heightMm: 2400,
    }))
    const out = orderPiecesForNest(even, [plain], { seed: 11 })

    expect(out.improved).toBe(false)
    expect(out.list.sheets.length).toBe(2)
    expect(out.baseline.sheets).toBe(2)
    expect(out.iterations).toBe(400)
  })

  it('cuts every board whichever order won', () => {
    // The failure this could hide: an order that drops a piece nests on fewer sheets and
    // is not a better answer, it is a wrong one.
    const out = orderPiecesForNest(mixed, [plain], { seed: 21 })
    const cut = [
      ...out.list.sheets.flatMap((sheet) => sheet.placements.map((placed) => placed.mark)),
      ...out.list.oversize.map((piece) => piece.mark),
    ]

    expect(cut.sort()).toEqual(mixed.map((piece) => piece.mark).sort())
    expect(out.order.slice().sort()).toEqual(mixed.map((piece) => piece.mark).sort())
  })

  it('returns an order that reproduces the nest it came with', () => {
    // What makes the order worth returning at all: a caller can store it and get the same
    // cut sheets back without re-running the search.
    const out = orderPiecesForNest(mixed, [plain], { seed: 33 })
    const replayed = nestCutPieces(mixed, [plain], { order: out.order })

    expect(replayed.sheets.length).toBe(out.list.sheets.length)
    expect(replayed.cuttingWasteFraction).toBe(out.list.cuttingWasteFraction)
  })

  it('does not search a job with nothing to reorder', () => {
    const one = orderPiecesForNest([mixed[0] as CutPiece], [plain], { seed: 5 })

    expect(one.iterations).toBe(0)
    expect(one.improved).toBe(false)
    expect(one.list.sheets.length).toBe(1)
  })

  it('searches nothing where there is no stock to nest out of', () => {
    const out = orderPiecesForNest(mixed, [], { seed: 5 })

    expect(out.iterations).toBe(0)
    expect(out.list.gaps).toContain('no-stock-stated')
    expect(out.baseline.sheets).toBe(0)
  })

  it('honours a zero-iteration ask instead of searching anyway', () => {
    const out = orderPiecesForNest(mixed, [plain], { seed: 5, iterations: 0 })

    expect(out.iterations).toBe(0)
    expect(out.improved).toBe(false)
  })

  it('clamps a runaway iteration count', () => {
    // A guard rather than a knob — the curve is flat long before 5,000 orderings.
    const out = orderPiecesForNest(mixed.slice(0, 4), [plain], { seed: 5, iterations: 1_000_000 })

    expect(out.iterations).toBe(5000)
  })

  it('carries the nest options through to every ordering it tries', () => {
    // Otherwise the search optimises a nest with a different kerf from the one that ships.
    const searched = orderPiecesForNest(mixed, [plain], {
      seed: 8,
      kerfMm: 0,
      handlingWasteFraction: 0.1,
      offcutPolicy: { minKeepWidthMm: 150, minKeepLengthMm: 600 },
    })

    expect(searched.list.kerfMm).toBe(0)
    expect(searched.list.orderWithAllowance).toBeDefined()
    expect(searched.list.sheets.some((sheet) => sheet.offcuts.some((offcut) => offcut.keep))).toBe(
      true,
    )
  })

  it('reports no rotation candidates on ordinary formlining', () => {
    // Real code with no live input, and it should say so: every sheet in the catalog is
    // rotatable: false, so a board that has to be turned to fit is refused instead.
    const out = orderPiecesForNest(mixed, [plain, birch], { seed: 5, allowRotation: true })

    expect(out.rotationCandidates).toBe(0)
  })

  it('counts the pieces that may be turned where any of them say so', () => {
    const withReveals: CutPiece[] = [
      ...mixed,
      { mark: 'B1', widthMm: 900, heightMm: 300, grainAgnostic: true },
      { mark: 'B2', widthMm: 800, heightMm: 250, grainAgnostic: true },
    ]
    const out = orderPiecesForNest(withReveals, [plain], { seed: 5, allowRotation: true })

    expect(out.rotationCandidates).toBe(2)
    // Not counted where the caller did not allow rotation at all.
    expect(orderPiecesForNest(withReveals, [plain], { seed: 5 }).rotationCandidates).toBe(0)
  })

  it('prefers the nest whose leftover is in one usable piece when the sheet count ties', () => {
    // Two orders on the same number of sheets are not equally good: one 600 × 2400 offcut
    // cuts another board and twelve slivers of the same total area go in the skip.
    const out = orderPiecesForNest(mixed, [plain], { seed: 17 })
    const largest = Math.max(
      ...out.list.sheets.flatMap((sheet) =>
        sheet.offcuts.map((offcut) => offcut.widthMm * offcut.heightMm),
      ),
    )

    expect(largest).toBeGreaterThan(0)
    expect(out.list.sheets.length).toBeLessThanOrEqual(out.baseline.sheets)
  })
})

describe('nestSearchCaveats', () => {
  it('says the best order found is not the fewest sheets possible', () => {
    const out = nestSearchCaveats({
      list: { sheets: [{}, {}], oversize: [] },
      order: [],
      improved: true,
      baseline: { sheets: 3, cuttingWasteFraction: 0.2 },
      iterations: 400,
      rotationCandidates: 0,
    } as unknown as NestSearch)

    expect(out[0]).toContain('3 sheets on a plain widest-first sort, 2 after')
    expect(out[0]).toContain('rather than the fewest sheets possible')
  })

  it('says a search that found nothing is not proof the sort was optimal', () => {
    const out = nestSearchCaveats(orderPiecesForNest(mixed.slice(0, 2), [plain], { seed: 3 }))

    expect(out.some((line) => line.includes('did not beat it'))).toBe(true)
  })

  it('says the grain is why nothing was turned', () => {
    const out = nestSearchCaveats(orderPiecesForNest(mixed, [plain], { seed: 3 }))

    expect(out.some((line) => line.includes('face grain'))).toBe(true)
  })
})
