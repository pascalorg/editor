import { describe, expect, it } from 'bun:test'
import { DOKA_FRAMAX_XLIFE, PERI_TRIO } from '../catalog'
import { courseJointsMm, stackCourses } from './stack'
import { bespokePieces, jointStationsMm, packStrip, type StripPack } from './strip-pack'
import { governingCapacity, tieForThickness, tieGrid } from './tie-grid'

/**
 * The packer's job is not to fill a length — any greedy loop does that. It is to
 * fill it with widths somebody sells, put the poor joint where nobody looks, and
 * say so when the arithmetic does not close. These tests are about those three.
 */

function widths(pack: StripPack): number[] {
  return pack.pieces.map((piece) => piece.widthMm)
}

function covered(pack: StripPack): number {
  return pack.pieces.reduce((sum, piece) => sum + piece.widthMm, 0)
}

describe('packing a run with widths the manufacturer sells', () => {
  it('tiles a whole multiple with full panels and nothing else', () => {
    // Framax's large-area panels are 2.40 and 2.70 m wide, so 4.05 m is two
    // pieces, not three 1.35s — fewer joints for the same length.
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 4050, { heightMm: 2700 })
    expect(widths(pack)).toEqual([2700, 1350])
    expect(pack.unfilledMm).toBe(0)
    expect(bespokePieces(pack)).toHaveLength(0)
  })

  it('stays inside a hand-set width when the crane is not available', () => {
    // The same run without the craned large-area panels: three 1.35s.
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 4050, {
      heightMm: 2700,
      preferredWidthMm: 1350,
    })
    expect(widths(pack)).toEqual([1350, 1350, 1350])
  })

  it('spends one wide panel rather than two narrow ones for the same width', () => {
    // 2.25 m is 1350 + 900 and also 1350 + 450 + 450. Both fit; the first is one
    // joint and one coupler fewer, which is the descent penalty doing its work.
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 2250, { heightMm: 2700 })
    expect(widths(pack).sort((a, b) => b - a)).toEqual([1350, 900])
  })

  it('covers the run exactly when it can', () => {
    for (const runMm of [1350, 1800, 2250, 3000, 4500, 6000]) {
      const pack = packStrip(DOKA_FRAMAX_XLIFE, runMm, { heightMm: 2700 })
      expect(covered(pack) + pack.unfilledMm).toBeCloseTo(runMm, 6)
    }
  })

  it('never leaves concrete unformed on a run any combination reaches', () => {
    for (let runMm = 300; runMm <= 6000; runMm += 25) {
      const pack = packStrip(PERI_TRIO, runMm, { heightMm: 2700 })
      expect(pack.unfilledMm).toBe(0)
    }
  })
})

describe('the make-up piece goes where a poor joint is least visible', () => {
  it('lands the filler mid-run, not against a corner', () => {
    // 4.15 m on Framax is 2700 + 1350 and 100 mm over — the fitting timber. Left
    // to right it would go at one end; it belongs between the two panels.
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 4150, { heightMm: 2700 })
    const madeUp = pack.pieces.findIndex((piece) => piece.kind !== 'panel')
    expect(madeUp).toBeGreaterThan(0)
    expect(madeUp).toBeLessThan(pack.pieces.length - 1)
  })

  it('honours a filler pushed to the start or the end', () => {
    const atStart = packStrip(DOKA_FRAMAX_XLIFE, 2900, {
      heightMm: 2700,
      fillerPosition: 'start',
    })
    const atEnd = packStrip(DOKA_FRAMAX_XLIFE, 2900, { heightMm: 2700, fillerPosition: 'end' })
    expect(atStart.pieces[0]?.kind).not.toBe('panel')
    expect(atEnd.pieces.at(-1)?.kind).not.toBe('panel')
  })

  it('splits the make-up in two so the end panels match, when asked', () => {
    // 100 mm each side on Framax is the 10 cm fitting timber, twice.
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 2900, {
      heightMm: 2700,
      fillerPosition: 'symmetric',
    })
    expect(pack.pieces[0]?.widthMm).toBe(100)
    expect(pack.pieces.at(-1)?.widthMm).toBe(100)
    expect(pack.pieces[0]?.kind).not.toBe('panel')
  })

  it('puts the widest panels at the ends, where the gang is craned from', () => {
    const pack = packStrip(PERI_TRIO, 4000, { heightMm: 2700 })
    const panels = pack.pieces.filter((piece) => piece.kind === 'panel')
    const first = panels[0]?.widthMm ?? 0
    const middle = panels[Math.floor(panels.length / 2)]?.widthMm ?? 0
    expect(first).toBeGreaterThanOrEqual(middle)
  })
})

describe('the compensation cascade, reached through the packer', () => {
  it('closes a gap with a system plate before a cut board', () => {
    // 2.70 m of TRIO: 2400 leaves 300 (a panel). 2450 leaves 50 — the WDA plate.
    const pack = packStrip(PERI_TRIO, 2450, { heightMm: 2700 })
    const filler = pack.pieces.find((piece) => piece.kind === 'filler')
    expect(filler?.widthMm).toBe(50)
    expect(bespokePieces(pack)).toHaveLength(0)
  })

  it('re-splits rather than emitting a sliver nothing can close', () => {
    // A naive greedy fill of 2410 mm on TRIO takes the 2400 panel and leaves
    // 10 mm — narrower than every filler and every workable cut. Dropping down a
    // panel size instead leaves a gap the cascade covers.
    const pack = packStrip(PERI_TRIO, 2410, { heightMm: 2700 })
    expect(pack.unfilledMm).toBe(0)
    for (const piece of pack.pieces) expect(piece.widthMm).toBeGreaterThanOrEqual(20)
  })

  it('reports an unformed strip rather than hiding it, when the run is tiny', () => {
    const pack = packStrip(PERI_TRIO, 15, { heightMm: 2700 })
    expect(pack.unfilledMm).toBe(15)
    expect(pack.pieces).toHaveLength(0)
  })

  it('falls to a cut board only where no catalog part reaches the width', () => {
    // Every Framax width is a multiple of 50 mm and so is every filler, so a run
    // 25 mm off the grid is the one case the catalog cannot answer at all.
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 4225, { heightMm: 2700 })
    const cuts = bespokePieces(pack)
    expect(cuts).toHaveLength(1)
    expect(cuts[0]?.widthMm).toBe(175)
  })

  it('prefers a narrower panel and a stock filler to a board somebody cuts', () => {
    // 400 mm is inside the reach of a bespoke piece, so the packer could answer it
    // with one board — and would, if cutting were priced like a catalog line. A
    // 0.30 panel and a 100 mm fitting timber are both stores issues.
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 400, { heightMm: 2700 })
    expect(bespokePieces(pack)).toHaveLength(0)
    expect(widths(pack).sort((a, b) => a - b)).toEqual([100, 300])
  })
})

describe('constraints a job puts on the packer', () => {
  it('will not spend a panel the site does not hold', () => {
    const wide = DOKA_FRAMAX_XLIFE.panels.filter(
      (panel) => panel.widthMm === 1350 && panel.heightMm === 2700,
    )
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 4050, {
      heightMm: 2700,
      avoidPanelIds: wide.map((panel) => panel.id),
    })
    expect(widths(pack)).not.toContain(1350)
    expect(pack.unfilledMm).toBe(0)
  })

  it('keeps under a hand-set weight limit', () => {
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 2700, { heightMm: 2700, maxPanelWeightKg: 80 })
    for (const piece of pack.pieces) {
      if (piece.kind === 'panel') expect(piece.panel.weightKg).toBeLessThanOrEqual(80)
    }
  })

  it('spends no universal panel on a plain run', () => {
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 5400, { heightMm: 2700 })
    for (const piece of pack.pieces) {
      if (piece.kind === 'panel') expect(piece.panel.universal ?? false).toBe(false)
    }
  })

  it('puts a joint on a station the architect fixed, and packs each stretch to it', () => {
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 5400, {
      heightMm: 2700,
      requiredJointsMm: [2700],
    })
    expect(jointStationsMm(pack)).toContain(2700)
  })

  it('reports the joint stations the courses above have to share', () => {
    const pack = packStrip(DOKA_FRAMAX_XLIFE, 4050, {
      heightMm: 2700,
      preferredWidthMm: 1350,
    })
    expect(jointStationsMm(pack)).toEqual([1350, 2700])
  })
})

describe('stacking courses up a lift', () => {
  it('runs one course proud of the concrete by a freeboard', () => {
    const stack = stackCourses(DOKA_FRAMAX_XLIFE, 2700, { kickerMm: 100 })
    expect(stack.courses).toHaveLength(1)
    expect(stack.courses[0]?.baseMm).toBe(100)
    expect(stack.freeboardMm).toBe(100)
    expect(stack.freeboardOutOfBand).toBe(false)
  })

  it('starts the courses at the top of the kicker, which is already cast', () => {
    const stack = stackCourses(DOKA_FRAMAX_XLIFE, 3000, { kickerMm: 150 })
    expect(stack.courses[0]?.baseMm).toBe(150)
    expect(stack.kickerMm).toBe(150)
  })

  it('stacks two courses on a lift one panel cannot reach', () => {
    const stack = stackCourses(DOKA_FRAMAX_XLIFE, 4000, { kickerMm: 100 })
    expect(stack.courses.length).toBeGreaterThan(1)
    expect(stack.courses.at(-1)?.topMm ?? 0).toBeGreaterThanOrEqual(4000)
  })

  it('never leaves the top of the pour open', () => {
    for (let liftMm = 1000; liftMm <= 8000; liftMm += 100) {
      const stack = stackCourses(DOKA_FRAMAX_XLIFE, liftMm, { kickerMm: 100 })
      expect(stack.courses.at(-1)?.topMm ?? 0).toBeGreaterThanOrEqual(liftMm)
    }
  })

  it('says when nothing in the system lands in the freeboard band', () => {
    // 2.00 m of concrete on a 100 mm kicker: the shortest Framax course is 1.35,
    // and two of them stand 800 mm proud. Buildable, and worth flagging.
    const stack = stackCourses(DOKA_FRAMAX_XLIFE, 2000, { kickerMm: 100 })
    expect(stack.freeboardOutOfBand).toBe(true)
    expect(stack.freeboardMm).toBeGreaterThan(150)
  })

  it('lands a horizontal joint on a construction joint the drawings fix', () => {
    const stack = stackCourses(DOKA_FRAMAX_XLIFE, 5500, {
      kickerMm: 100,
      requiredJointsMm: [2800],
    })
    expect(courseJointsMm(stack)).toContain(2800)
  })

  it('will not stand a course the site does not hold', () => {
    const stack = stackCourses(DOKA_FRAMAX_XLIFE, 4000, {
      kickerMm: 100,
      avoidHeightsMm: [1350, 900, 3300],
    })
    for (const course of stack.courses) expect(course.heightMm).toBe(2700)
  })
})

describe('ties land in holes the frame was drilled with', () => {
  // One course of exactly `heightMm`: no kicker and no freeboard, so the panel
  // height under test is the one that gets stood up.
  const stackOf = (system: typeof DOKA_FRAMAX_XLIFE, runMm: number, heightMm: number) => {
    const stack = stackCourses(system, heightMm, { kickerMm: 0, minFreeboardMm: 0 })
    return stack.courses.map((course) => ({
      course,
      pack: packStrip(system, runMm, { heightMm: course.panelHeightMm }),
    }))
  }

  it('puts every tie at a published hole position, never on a calculated spacing', () => {
    const courses = stackOf(PERI_TRIO, 2400, 2700)
    const grid = tieGrid(PERI_TRIO, courses, {
      pressureKnM2: 40,
      wallThicknessMm: 200,
    })
    // TRIO's 2.70 panel is drilled at 575 and 2125 and the 240-wide one at 540
    // and 1860 across. Nothing else is available.
    const elevations = [...new Set(grid.ties.map((tie) => tie.elevationMm))].sort((a, b) => a - b)
    expect(elevations).toEqual([575, 2125])
    const stations = [...new Set(grid.ties.map((tie) => tie.alongMm))].sort((a, b) => a - b)
    expect(stations).toEqual([540, 1860])
  })

  it('checks the part that governs, not the rod', () => {
    const dw15 = DOKA_FRAMAX_XLIFE.ties.find((tie) => tie.componentCapacitiesKn)
    const governing = governingCapacity(dw15 as never)
    expect(governing.capacityKn).toBeLessThan((dw15?.capacityKn ?? 0) as number)
    expect(governing.component.length).toBeGreaterThan(0)
  })

  it('tells you to reduce the pressure, because there is no hole to add', () => {
    const courses = stackOf(PERI_TRIO, 2400, 2700)
    const grid = tieGrid(PERI_TRIO, courses, {
      pressureKnM2: 70,
      wallThicknessMm: 200,
    })
    const overload = grid.warnings.find((warning) => warning.kind === 'over-capacity-no-hole')
    expect(overload).toBeDefined()
    expect(overload?.message).toContain('reduce the pressure')
  })

  it('passes a modest pour on the same panels without a warning', () => {
    const courses = stackOf(PERI_TRIO, 600, 2700)
    const grid = tieGrid(PERI_TRIO, courses, {
      pressureKnM2: 20,
      wallThicknessMm: 200,
    })
    expect(grid.warnings.filter((w) => w.kind === 'over-capacity-no-hole')).toHaveLength(0)
  })

  it('grades the load up the pour, so the bottom tie carries more than the top', () => {
    const courses = stackOf(PERI_TRIO, 2400, 2700)
    const grid = tieGrid(PERI_TRIO, courses, {
      pressureKnM2: 50,
      // Hydrostatic from the top down at 25 kN/m³, capped — the shape DIN 18218
      // and ACI 347 both produce.
      pressureAtMm: (elevationMm) => Math.min(50, ((2700 - elevationMm) / 1000) * 25),
      wallThicknessMm: 200,
    })
    const low = grid.ties.filter((tie) => tie.elevationMm === 575)
    const high = grid.ties.filter((tie) => tie.elevationMm === 2125)
    expect((low[0]?.forceKn ?? 0) > (high[0]?.forceKn ?? 0)).toBe(true)
  })

  it('says when the holes are further apart than a crew will accept', () => {
    const courses = stackOf(PERI_TRIO, 2400, 2700)
    const grid = tieGrid(PERI_TRIO, courses, {
      pressureKnM2: 10,
      wallThicknessMm: 200,
    })
    // 540 to 1860 is 1320 mm against TRIO's 900 mm practical limit.
    expect(grid.maxColumnGapMm).toBe(1320)
    expect(grid.warnings.some((w) => w.kind === 'spacing-exceeds-practical')).toBe(true)
  })

  it('picks a tie that reaches the wall and reports when none does', () => {
    expect(tieForThickness(PERI_TRIO, 200)?.system).toBeDefined()
    const grid = tieGrid(DOKA_FRAMAX_XLIFE, stackOf(DOKA_FRAMAX_XLIFE, 1350, 2700), {
      pressureKnM2: 20,
      wallThicknessMm: 3000,
    })
    expect(grid.warnings.some((w) => w.kind === 'no-tie-for-thickness')).toBe(
      grid.tie === undefined,
    )
  })

  it('sums the tributary areas to the wall area, so nothing is counted twice', () => {
    const courses = stackOf(DOKA_FRAMAX_XLIFE, 2700, 2700)
    const grid = tieGrid(DOKA_FRAMAX_XLIFE, courses, {
      pressureKnM2: 30,
      wallThicknessMm: 250,
    })
    const total = grid.ties.reduce((sum, tie) => sum + tie.tributarySqM, 0)
    const courseArea = courses.reduce(
      (sum, entry) => sum + (2700 / 1000) * (entry.course.heightMm / 1000),
      0,
    )
    expect(total).toBeCloseTo(courseArea, 6)
  })
})
