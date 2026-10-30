import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '../schema/nodes/roof-segment'
import { LUMBER_DEPTH, ROOF_BUILD_UP_PRESETS, roofBuildUpPatch } from './build-up'
import {
  eaveContains,
  FASCIA_DROP,
  FASCIA_THICKNESS,
  fasciaStockFor,
  LEVEL_CUT_RUN,
  roofEaveProfile,
  roofSegmentEaveInput,
  roofSegmentEaveProfile,
  SOFFIT_THICKNESS,
} from './roof-eave'

const IN = 0.0254
const SHEET = (7 / 16) * IN

/** 2x10 rafters at 6/12 under a 7/16 in sheet, 0.6 m out from the plate line. */
const input = (cut: 'plumb' | 'square' | 'plumb-level') => ({
  tan: 0.5,
  reach: 0.6,
  wallOut: 0.075,
  tailDepth: LUMBER_DEPTH['2x10'],
  tailLift: 0,
  deckDepth: LUMBER_DEPTH['2x10'] + SHEET,
  cut,
})

describe('an eave cut by its rule', () => {
  test('plumb: the tails cut plumb at the reach, a plumb 1x over their face from the sheathing to 3/4 in under them', () => {
    const eave = roofEaveProfile(input('plumb'))
    const cos = 1 / Math.hypot(1, 0.5)
    const top = (LUMBER_DEPTH['2x10'] + SHEET) / cos - 0.6 * 0.5
    expect(eave.end).toEqual([
      [0.6, top],
      [0.6, -0.3],
    ])
    expect(eave.low).toBeCloseTo(-0.3, 9)
    const [backTop, frontTop, frontBottom, backBottom] = eave.fascia.corners
    expect(backTop).toEqual([0.6, top])
    expect(frontTop[0]).toBeCloseTo(0.6 + FASCIA_THICKNESS, 9)
    expect(backBottom[0]).toBeCloseTo(0.6, 9)
    // 10.34 in of plumb tail and 0.49 in of sheet: a whole 1x12 drops 0.42 in under it
    expect(eave.fascia).toMatchObject({ square: false, stock: '1x12', ripped: false })
    expect(eave.fascia.height).toBeCloseTo(11.25 * IN, 9)
    expect(frontBottom[1]).toBeCloseTo(top - 11.25 * IN, 9)
    expect(-0.3 - frontBottom[1]).toBeGreaterThan(0.25 * IN)
    // a 2x6's 6.64 in takes a whole 1x8, 0.61 in under it
    const six = roofEaveProfile({
      ...input('plumb'),
      tailDepth: LUMBER_DEPTH['2x6'],
      deckDepth: LUMBER_DEPTH['2x6'] + SHEET,
    })
    expect(six.fascia).toMatchObject({ stock: '1x8', ripped: false })
    // where no whole 1x drops 1/4 to 3/4 in under the tails, one ripped to drop 3/4 in
    const four = roofEaveProfile({
      ...input('plumb'),
      tailDepth: LUMBER_DEPTH['2x4'],
      deckDepth: LUMBER_DEPTH['2x4'] + SHEET,
    })
    expect(four.fascia.corners[2][1]).toBeCloseTo(-0.3 - FASCIA_DROP, 9)
    expect(four.fascia).toMatchObject({ stock: '1x6', ripped: true })
    expect(eave.soffit).toBeNull()
  })

  test('square: the tails cut square to the slope through the sheathing edge, the fascia square on them', () => {
    const eave = roofEaveProfile(input('square'))
    const cos = 1 / Math.hypot(1, 0.5)
    const sin = 0.5 * cos
    const depth = LUMBER_DEPTH['2x10'] + SHEET
    const [corner, foot] = eave.end as [[number, number], [number, number]]
    expect(foot[0]).toBeCloseTo(0.6 - depth * sin, 9)
    expect(foot[1]).toBeCloseTo(corner[1] - depth * cos, 9)
    // on the tails' underside
    expect(foot[1]).toBeCloseTo(eave.under(foot[0]), 9)
    const [backTop, frontTop, frontBottom, backBottom] = eave.fascia.corners
    expect(eave.fascia.square).toBe(true)
    expect(eave.fascia.height).toBeCloseTo(depth + FASCIA_DROP, 9)
    // its top face in the sheathing's plane, its back on the cut
    expect(frontTop[1]).toBeCloseTo(eave.top(frontTop[0]), 9)
    expect(backBottom[0] - backTop[0]).toBeCloseTo(-eave.fascia.height * sin, 9)
    expect(frontBottom[0] - backBottom[0]).toBeCloseTo(FASCIA_THICKNESS * cos, 9)
    // nothing of the tails out past the cut
    expect(eaveContains(eave, [0.6, eave.under(0.6) + 0.01])).toBe(false)
    expect(eaveContains(eave, [foot[0] - 0.001, foot[1] + 0.002])).toBe(true)
  })

  test('plumb and level: a level cut under the plumb cut, a soffit nailed up to it from the wall out to the fascia', () => {
    const eave = roofEaveProfile(input('plumb-level'))
    const [, plumbFoot, inner] = eave.end as [[number, number], [number, number], [number, number]]
    expect(plumbFoot[0]).toBeCloseTo(0.6, 9)
    expect(plumbFoot[1]).toBeCloseTo(-0.3 + LEVEL_CUT_RUN * 0.5, 9)
    expect(inner).toEqual([0.6 - LEVEL_CUT_RUN, plumbFoot[1]])
    // the level cut meets the tails' underside
    expect(inner[1]).toBeCloseTo(eave.under(inner[0]), 9)
    expect(eave.soffit).toEqual({
      y: plumbFoot[1],
      thickness: SOFFIT_THICKNESS,
      from: 0.075,
      to: 0.6,
    })
    expect(eave.fascia.corners[2][1]).toBeCloseTo(plumbFoot[1] - FASCIA_DROP, 9)
    // the box down to the soffit's underside is the eave's, nothing under it
    expect(eaveContains(eave, [0.3, plumbFoot[1] - SOFFIT_THICKNESS + 0.001])).toBe(true)
    expect(eaveContains(eave, [0.3, plumbFoot[1] - SOFFIT_THICKNESS - 0.002])).toBe(false)
    // a steep 2x4's level cut takes at most half its plumb depth
    const steep = roofEaveProfile({
      ...input('plumb-level'),
      tan: 1,
      tailDepth: LUMBER_DEPTH['2x4'],
    })
    const [, foot] = steep.end as [unknown, [number, number]]
    expect(foot[1] - steep.under(0.6)).toBeCloseTo((LUMBER_DEPTH['2x4'] * Math.SQRT2) / 2, 9)
  })

  test('a truss tail rides its bottom chord: its underside a chord over the plate, the fascia to 3/4 in under it', () => {
    const chord = LUMBER_DEPTH['2x4']
    const eave = roofEaveProfile({
      ...input('plumb'),
      tailDepth: chord,
      tailLift: chord,
      deckDepth: 2 * chord + SHEET,
    })
    expect(eave.under(0.6)).toBeCloseTo(chord - 0.3, 9)
    const drop = chord - 0.3 - eave.fascia.corners[2][1]
    expect(drop).toBeGreaterThanOrEqual(0.25 * IN - 1e-9)
    expect(drop).toBeLessThanOrEqual(FASCIA_DROP + 1e-9)
  })

  test('a flat eave and a rising edge are plumb, whatever the plane asks', () => {
    expect(roofEaveProfile({ ...input('square'), tan: 0 }).cut).toBe('plumb')
    expect(roofEaveProfile({ ...input('plumb-level'), tan: -0.5 }).cut).toBe('plumb')
  })

  test('the 1x a board is cut from: the narrowest as wide, ripped; past a 1x12 a ripped width', () => {
    expect(fasciaStockFor(5.5 * IN)).toEqual({ stock: '1x6', ripped: false })
    expect(fasciaStockFor(6 * IN)).toEqual({ stock: '1x8', ripped: true })
    expect(fasciaStockFor(11.25 * IN)).toEqual({ stock: '1x12', ripped: false })
    expect(fasciaStockFor(12 * IN)).toEqual({ stock: null, ripped: true })
  })
})

describe("a roof plane's eave", () => {
  const segment = (patch: Partial<RoofSegmentNode> = {}) =>
    RoofSegmentNode.parse({
      roofType: 'gable',
      width: 8,
      depth: 6,
      pitch: 26.565,
      wallThickness: 0.15,
      overhang: 0.6,
      ...patch,
    })

  test('its layers name its tails; a truss rides its bottom chord; without layers, rafters under a sheet', () => {
    const preset = ROOF_BUILD_UP_PRESETS[0]!.buildUp
    const trusses = roofSegmentEaveInput(segment(roofBuildUpPatch(preset)))
    expect(trusses.tailDepth).toBeCloseTo(LUMBER_DEPTH['2x4'], 9)
    expect(trusses.tailLift).toBeCloseTo(LUMBER_DEPTH['2x4'], 9)
    expect(trusses.deckDepth).toBeCloseTo(2 * LUMBER_DEPTH['2x4'] + SHEET, 9)
    const bare = roofSegmentEaveInput(segment({ deckThickness: 0.1 }))
    expect(bare.tailDepth).toBeCloseTo(0.1 - SHEET, 9)
    expect(bare.tailLift).toBe(0)
    // the deck's edge, out past the wall's outer face by the overhang along the slope
    expect(bare.reach).toBeCloseTo(0.075 + 0.6 * Math.cos(Math.atan(0.5)), 4)
  })

  test('absent, the cut is plumb; a saved plane loads as it was drawn', () => {
    expect(segment().eaveCut).toBeUndefined()
    expect(roofSegmentEaveProfile(segment()).cut).toBe('plumb')
    expect(roofSegmentEaveProfile(segment({ eaveCut: 'square' })).cut).toBe('square')
    // a shed's high edge stays plumb
    expect(
      roofSegmentEaveProfile(segment({ roofType: 'shed', eaveCut: 'square' }), 'high').cut,
    ).toBe('plumb')
  })

  test("a flat roof's boards sized on purpose rise over its membrane", () => {
    const flat = roofSegmentEaveProfile(
      segment({ roofType: 'flat', pitch: 0, fasciaHeight: 0.3, shingleThickness: 0.02 }),
    )
    expect(flat.fascia.corners[0][1]).toBeCloseTo(flat.top(flat.reach) + 0.02, 9)
    expect(flat.fascia.height).toBe(0.3)
  })
})
