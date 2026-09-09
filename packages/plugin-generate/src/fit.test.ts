import { describe, expect, test } from 'bun:test'
import { crossesSetback, envelopeEdges, refaceCandidates, refaceNote, bandFit } from './fit'

type Pt = readonly [number, number]

const FT = 0.3048
// a 40 ft × 72 ft buildable envelope, the street on the 40 ft edge (edge 0)
const ENV: Pt[] = [
  [0, 0],
  [40 * FT, 0],
  [40 * FT, 72 * FT],
  [0, 72 * FT],
]

describe('envelopeEdges', () => {
  test('each edge is a frontage with its square-on depth', () => {
    const edges = envelopeEdges(ENV)
    expect(edges.map((e) => Math.round(e.frontageFt))).toEqual([40, 72, 40, 72])
    expect(edges.map((e) => Math.round(e.depthFt))).toEqual([72, 40, 72, 40])
  })

  test('a turned envelope keeps its own frontages and depths', () => {
    const c = Math.cos(0.7)
    const s = Math.sin(0.7)
    const turned = ENV.map(([x, z]) => [x * c - z * s + 5, x * s + z * c - 3] as Pt)
    const edges = envelopeEdges(turned)
    expect(edges.map((e) => Math.round(e.frontageFt))).toEqual([40, 72, 40, 72])
    expect(edges.map((e) => Math.round(e.depthFt))).toEqual([72, 40, 72, 40])
  })

  test('fewer than three points is no envelope', () => {
    expect(
      envelopeEdges([
        [0, 0],
        [1, 1],
      ]),
    ).toEqual([])
  })
})

describe('refaceCandidates', () => {
  test('only wider edges, widest first', () => {
    const edges = envelopeEdges(ENV)
    expect(refaceCandidates(edges, 0).map((e) => e.index)).toEqual([1, 3])
    expect(refaceCandidates(edges, 1)).toEqual([])
    expect(refaceCandidates(edges, 9)).toEqual([])
  })
})

describe('crossesSetback / refaceNote', () => {
  test('reads the roll warnings', () => {
    expect(
      crossesSetback([
        "the plan is 58.5' wide but the buildable frontage is 39.0' — it will cross a side setback.",
      ]),
    ).toBe(true)
    expect(
      crossesSetback([
        "the plan is 50.0' deep but the buildable depth is 40.0' — it will cross the rear setback.",
      ]),
    ).toBe(true)
    expect(crossesSetback(['rolled without a garage'])).toBe(false)
  })

  test('the note names both edges', () => {
    const edges = envelopeEdges(ENV)
    expect(refaceNote(edges[0]!, edges[1]!)).toContain("(40' buildable)")
    expect(refaceNote(edges[0]!, edges[1]!)).toContain("lot edge 2 (72')")
  })
})

describe('bandFit — the band a plan of a given depth can stand in (2026-09-09)', () => {
  const FT = 0.3048
  // a 60 × 100 ft lot inset 7/20 front-rear and 7 ft each side: the envelope is a 46 × 73 ft rectangle
  const rect: [number, number][] = [
    [2.1336, 7.62],
    [18.288 - 2.1336, 7.62],
    [18.288 - 2.1336, 30.48 - 6.096],
    [2.1336, 30.48 - 6.096],
  ]
  test('a rectangle: the band is the frontage, centred, at any depth', () => {
    const b = bandFit(rect, 0, 10)
    expect(b.widthFt).toBeCloseTo(46, 1)
    expect(b.offsetM).toBeCloseTo(0, 6)
    expect(b.depthFt).toBeCloseTo((30.48 - 6.096 - 7.62) / FT, 1) // 55 ft between the front and rear setback lines
  })
  test('a tapered lot: the band is the narrowest chord the plan reaches, and its centre is off the front midpoint', () => {
    // the same front, the rear pulled in to x 6..12 (a pie lot narrowing to the back)
    const pie: [number, number][] = [
      [2.1336, 7.62],
      [18.288 - 2.1336, 7.62],
      [12, 30.48 - 6.096],
      [6, 30.48 - 6.096],
    ]
    const shallow = bandFit(pie, 0, 2)
    const deep = bandFit(pie, 0, 12)
    expect(shallow.widthFt).toBeGreaterThan(deep.widthFt)
    // at 12 m the left line has moved from x 2.13 toward 6 and the right from 16.15 toward 12
    const f = 12 / (30.48 - 6.096 - 7.62)
    const lo = 2.1336 + (6 - 2.1336) * f
    const hi = 18.288 - 2.1336 + (12 - (18.288 - 2.1336)) * f
    expect(deep.widthFt).toBeCloseTo((hi - lo) / FT, 0)
    expect(deep.offsetM).toBeCloseTo((lo + hi) / 2 - 18.288 / 2, 1)
    // the whole depth: the rear chord (6 ft ≈ 19.7 ft wide)
    expect(bandFit(pie, 0, 100).widthFt).toBeCloseTo(6 / FT, 0)
  })
  test('fewer than three points is no band', () => {
    expect(bandFit([[0, 0], [1, 0]], 0, 5).widthFt).toBe(0)
  })
  test('a rear line out of square: a band asked past the depth answers at the depth, never a corner sliver (Modesto, 2026-09-09)', () => {
    // the Modesto envelope: 50 ft front, 65 ft deep, the left side tapering in 3.75 m, the rear line 4 cm out of square
    const modesto: [number, number][] = [
      [-7.61, 0],
      [7.61, 0],
      [8.24, 19.79],
      [-3.86, 19.75],
    ]
    const house = bandFit(modesto, 0, 64 * FT, 0.5, 24 * FT)
    expect(house.widthFt).toBeGreaterThan(36)
    expect(house.offsetM).toBeGreaterThan(1.5)
    expect(house.offsetM).toBeLessThan(2.5)
    // 8 ft past the rear line: the same band, and the depth says the porch does not fit
    const deep = bandFit(modesto, 0, 72 * FT, 0.5, 24 * FT)
    expect(deep.widthFt).toBeCloseTo(house.widthFt, 0)
    expect(deep.offsetM).toBeCloseTo(house.offsetM, 1)
    expect(deep.depthFt).toBeLessThan(66)
    expect(deep.depthFt).toBeGreaterThan(63)
    // the two-column plan's band, 53 ft deep: the lot has the depth; the left line's taper takes the band to
    // about 40 ft (the right line flares out going back, so the band's right side is the front corner's)
    const wide = bandFit(modesto, 0, 53 * FT, 0.5, 24 * FT)
    expect(wide.depthFt).toBeGreaterThan(63)
    expect(wide.widthFt).toBeGreaterThan(39)
    expect(wide.widthFt).toBeLessThan(41)
    // the house's centre plus half its width stays inside the right side line
    expect(deep.offsetM + (32 * FT) / 2).toBeLessThan(8.24)
  })
})

