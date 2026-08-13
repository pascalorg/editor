import { describe, expect, test } from 'bun:test'
import {
  elevationCaveats,
  FORMWORK_ELEVATION_DESCRIPTION,
  type ShutterElevation,
} from './elevation'

/**
 * The words on the drawing.
 *
 * The rectangles are asserted where they are produced, in `packages/nodes`. What is here is the
 * part that is only words and is load-bearing anyway: a shop elevation is read against the
 * engineer's, so a sentence that fails to say which frame the figures are in, or that lets a
 * factory-drilled grid read as a calculated spacing, is a sentence that puts a rod through a
 * steel frame.
 */

function elevation(overrides: Partial<ShutterElevation> = {}): ShutterElevation {
  return {
    runMm: 3000,
    formBaseMm: 0,
    concreteTopMm: 2400,
    formTopMm: 2400,
    courses: [{ baseMm: 0, topMm: 2400 }],
    openings: [],
    ties: [],
    tiesDropped: [],
    tiesFrom: 'none',
    faces: [],
    ...overrides,
  }
}

describe('elevationCaveats', () => {
  test('leads with the frame, on every drawing, before anything else', () => {
    // The one thing a reader assumes rather than looks up: a lift's drawing starting at zero
    // reads as the wall starting at zero, and then every figure is out by the pour below.
    for (const shown of [
      elevation(),
      elevation({ formBaseMm: 75, tiesFrom: 'drilled-holes' }),
      elevation({ courses: [], tiesFrom: 'solved-spacing' }),
    ]) {
      const first = elevationCaveats(shown)[0] ?? ''
      expect(first).toContain('this pour’s own start')
      expect(first).toContain('three lifts')
    }
  })

  test('says the concrete stops below the panels, and by how much', () => {
    const lines = elevationCaveats(elevation({ concreteTopMm: 2300, formTopMm: 2400 }))
    const freeboard = lines.find((line) => line.includes('freeboard'))

    expect(freeboard).toContain('2300 mm')
    expect(freeboard).toContain('2400 mm')
    expect(freeboard).toContain('100 mm of shutter is freeboard')
  })

  test('says nothing about freeboard when the shutter finishes at the concrete', () => {
    // A conventional shutter cut to the lift has no freeboard, and a sentence saying "0 mm of
    // shutter holds nothing back" is a sentence somebody has to work out is vacuous.
    const lines = elevationCaveats(elevation({ concreteTopMm: 2400, formTopMm: 2400 }))
    expect(lines.some((line) => line.includes('freeboard'))).toBe(false)
  })

  test('a drilled grid is said to be unmovable; a solved spacing is not', () => {
    const drilled = elevationCaveats(elevation({ tiesFrom: 'drilled-holes' })).join(' ')
    const solved = elevationCaveats(elevation({ tiesFrom: 'solved-spacing' })).join(' ')

    expect(drilled).toContain('cannot be moved')
    expect(drilled).toContain('goes through a steel frame')
    // And the reverse mistake is guarded too: a carpenter's shutter is bored to the
    // calculation, so telling them a station is fixed would stop them boring it at all.
    expect(solved).not.toContain('cannot be moved')
    expect(solved).toContain('bored where the calculation asks')
    expect(solved).toContain('graded')
  })

  test('splits the dropped stations by why, because the two have different answers', () => {
    const lines = elevationCaveats(
      elevation({
        tiesFrom: 'drilled-holes',
        tiesDropped: [
          { xMm: 1200, yMm: 1500, because: 'opening' },
          { xMm: 1800, yMm: 1500, because: 'opening' },
          { xMm: 200, yMm: 600, because: 'corner' },
        ],
      }),
    )
    const dropped = lines.find((line) => line.includes('not tied')) ?? ''

    expect(dropped).toContain('3 stations')
    expect(dropped).toContain('2 inside an opening')
    expect(dropped).toContain('1 over a corner unit')
    // A void needs a tie moved or a bracing detail; a corner unit already ties through its
    // own holes and needs nothing at all. One count would read as one problem.
    expect(dropped).toContain('somebody queries')
  })

  test('names one dropped station in the singular', () => {
    const dropped =
      elevationCaveats(
        elevation({ tiesDropped: [{ xMm: 1200, yMm: 1500, because: 'opening' }] }),
      ).find((line) => line.includes('not tied')) ?? ''

    expect(dropped).toContain('1 station')
    expect(dropped).toContain('is not tied')
    expect(dropped).not.toContain('stations the grid')
  })

  test('says the aligned joints are deliberate, on a stack and not on one course', () => {
    const stacked = elevationCaveats(
      elevation({
        formTopMm: 4800,
        concreteTopMm: 4800,
        courses: [
          { baseMm: 0, topMm: 2400 },
          { baseMm: 2400, topMm: 4800 },
        ],
      }),
    ).join(' ')

    // A reader who knows masonry reports this as a defect unless the drawing says why.
    expect(stacked).toContain('2 courses')
    expect(stacked).toContain('reverse of masonry')
    expect(stacked).toContain('would be the error')
    expect(elevationCaveats(elevation()).join(' ')).not.toContain('reverse of masonry')
  })

  test('closes by saying what is not drawn, and that a rectangle is not a quantity', () => {
    const last = elevationCaveats(elevation()).at(-1) ?? ''

    expect(last).toContain('shutter face only')
    expect(last).toContain('rakers')
    expect(last).toContain('the rectangles do not count')
  })

  test('a kicker is named as wall rather than as an unformed strip', () => {
    const kicker =
      elevationCaveats(elevation({ formBaseMm: 150 })).find((line) => line.includes('kicker')) ?? ''

    expect(kicker).toContain('150 mm')
    expect(kicker).toContain('not an unformed strip')
  })
})

describe('FORMWORK_ELEVATION_DESCRIPTION', () => {
  test('tells the model the four things it must not reword', () => {
    // Each of these is a way a model paraphrases the drawing into something wrong: a pour
    // quoted to the top of the panels, a fixed station offered as movable, an absence read as
    // an omission, and a correct detail reported as a defect.
    expect(FORMWORK_ELEVATION_DESCRIPTION).toContain('formTopMm')
    expect(FORMWORK_ELEVATION_DESCRIPTION).toContain('never offer to shift one')
    expect(FORMWORK_ELEVATION_DESCRIPTION).toContain('tiesDropped is on the drawing on purpose')
    expect(FORMWORK_ELEVATION_DESCRIPTION).toContain('never a defect to report')
    expect(FORMWORK_ELEVATION_DESCRIPTION).toContain('A rectangle is not a quantity')
    // And that asking for one on a column is asking for the wrong drawing.
    expect(FORMWORK_ELEVATION_DESCRIPTION).toContain('Only walls have this drawing')
  })
})
