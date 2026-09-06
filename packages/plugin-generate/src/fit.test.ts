import { describe, expect, test } from 'bun:test'
import { crossesSetback, envelopeEdges, refaceCandidates, refaceNote } from './fit'

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
