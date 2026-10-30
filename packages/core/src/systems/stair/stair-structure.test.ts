import { describe, expect, it } from 'bun:test'
import {
  type AnyNode,
  autoStairStringerCount,
  inferStairStructure,
  measureStair,
  resolveStairConstruction,
  resolveStairStringerLayout,
  resolveStairStructure,
  resolveStraightStairConstruction,
  STAIR_CODE,
  STAIR_STRINGER_STOCK,
  StairNode,
  StairSegmentNode,
  StairStructure,
  stairLandingFrame,
  stairStringerCut,
  stairStringerFlight,
  stairStructureConstruction,
} from '../../index'

const IN = 0.0254

/** A straight stair with one flight of `risers` × `riser` in over `going` in treads. */
function flightStair(
  risers: number,
  riser: number,
  going: number,
  stair: Partial<StairNode> = {},
  width = 36 * IN,
) {
  const flight = StairSegmentNode.parse({
    width,
    height: risers * riser * IN,
    length: risers * going * IN,
    stepCount: risers,
  })
  const node = StairNode.parse({
    width,
    totalRise: risers * riser * IN,
    stepCount: risers,
    railingMode: 'both',
    railingHeight: 36 * IN,
    children: [flight.id],
    ...stair,
  })
  flight.parentId = node.id
  const nodes: Record<string, AnyNode> = { [node.id]: node, [flight.id]: flight }
  return { stair: node, flight, nodes }
}

describe('stair structure schema', () => {
  it('defaults to cut 2x12 wood stringers at 16 in o.c. and leaves stairs without one alone', () => {
    expect(StairStructure.parse({})).toEqual({
      type: 'wood-stringers',
      stringerStock: '2x12',
      stringerType: 'cut',
      stringerSpacing: 16 * IN,
    })
    const legacy = StairNode.parse({})
    expect(legacy.structure).toBeUndefined()
    expect(resolveStairStructure(legacy)).toBeNull()
    expect(resolveStairConstruction(StairSegmentNode.parse({}), legacy)).toBeNull()
  })

  it('makes its automatic choices from where the stair stands and how far it rises', () => {
    const inside = resolveStairStructure(StairNode.parse({ structure: {} }))!
    expect(inside).toMatchObject({
      treadStock: '2x12',
      closedRisers: true,
      treated: false,
      nosing: 1 * IN,
      exterior: false,
    })
    // a short porch flight: open risers are fine up to a 30 in rise (R311.7.5.1)
    const porch = resolveStairStructure(
      StairNode.parse({ structure: {}, deckSlabId: 'slab_porch', totalRise: 21 * IN }),
    )!
    expect(porch).toMatchObject({
      treadStock: '2x6-pair',
      closedRisers: false,
      treated: true,
      exterior: true,
    })
    const deck = resolveStairStructure(
      StairNode.parse({ structure: {}, destinationSurfaceId: 'deck', totalRise: 40 * IN }),
    )!
    expect(deck.closedRisers).toBe(true)
    expect(
      resolveStairStructure(StairNode.parse({ structure: { type: 'concrete' } }))!.nosing,
    ).toBe(0)
    // the hand-set choices win
    expect(
      resolveStairStructure(
        StairNode.parse({
          structure: { treadStock: '5/4x6-pair', closedRisers: false, treated: true, nosing: 0.03 },
        }),
      ),
    ).toMatchObject({ treadStock: '5/4x6-pair', closedRisers: false, treated: true, nosing: 0.03 })
  })

  it('infers a legacy stair as concrete when it is painted concrete, wood stringers otherwise', () => {
    expect(
      inferStairStructure(StairNode.parse({ materialPreset: 'library:concrete-raw' })).type,
    ).toBe('concrete')
    expect(inferStairStructure(StairNode.parse({ material: { preset: 'concrete' } })).type).toBe(
      'concrete',
    )
    expect(
      inferStairStructure(StairNode.parse({ materialPreset: 'library:wood-floorplank1' })).type,
    ).toBe('wood-stringers')
    expect(
      inferStairStructure(StairNode.parse({ structure: { type: 'steel-stringers' } })).type,
    ).toBe('steel-stringers')
  })
})

describe('stringer count and spacing', () => {
  it('counts ceil(width / spacing) + 1 stringers, at least two and three from 36 in wide', () => {
    expect(autoStairStringerCount(36 * IN, 16 * IN)).toBe(4)
    expect(autoStairStringerCount(36 * IN, 18 * IN)).toBe(3)
    expect(autoStairStringerCount(36 * IN, 24 * IN)).toBe(3)
    expect(autoStairStringerCount(36 * IN, 12 * IN)).toBe(4)
    expect(autoStairStringerCount(48 * IN, 16 * IN)).toBe(4)
    expect(autoStairStringerCount(24 * IN, 24 * IN)).toBe(2)
    expect(autoStairStringerCount(30 * IN, 24 * IN)).toBe(3)
    expect(autoStairStringerCount(1, 16 * IN)).toBe(4)
  })

  it('lays the outer stringers flush with the sides and the rest evenly between, never past the spacing', () => {
    const width = 1.0
    for (const spacing of [12, 16, 18, 24]) {
      const structure = resolveStairStructure(
        StairNode.parse({ structure: { stringerSpacing: spacing * IN } }),
      )!
      const layout = resolveStairStringerLayout(width, structure)
      expect(layout.auto).toBe(true)
      expect(layout.count).toBe(autoStairStringerCount(width, spacing * IN))
      expect(layout.spacing).toBeLessThanOrEqual(spacing * IN + 1e-9)
      expect(layout.bands[0]!.x0).toBeCloseTo(-width / 2, 9)
      expect(layout.bands.at(-1)!.x1).toBeCloseTo(width / 2, 9)
      for (let i = 1; i < layout.bands.length; i++)
        expect(layout.bands[i]!.x - layout.bands[i - 1]!.x).toBeCloseTo(layout.spacing, 9)
      expect(layout.bands.every((band) => band.kind === 'cut' && !band.steel)).toBe(true)
      expect(layout.thickness).toBeCloseTo(1.5 * IN, 9)
      expect(layout.depth).toBeCloseTo(STAIR_STRINGER_STOCK['2x12'].depth, 9)
    }
    const set = resolveStairStructure(
      StairNode.parse({
        structure: { stringerCount: 5, stringerType: 'housed', stringerStock: '2x10' },
      }),
    )!
    const housed = resolveStairStringerLayout(36 * IN, set)
    expect(housed.auto).toBe(false)
    expect(housed.count).toBe(5)
    expect(housed.depth).toBeCloseTo(9.25 * IN, 9)
    expect(housed.bands.map((band) => band.kind)).toEqual(['housed', 'cut', 'cut', 'cut', 'housed'])
    const steel = resolveStairStructure(
      StairNode.parse({ structure: { type: 'steel-stringers' } }),
    )!
    expect(resolveStairStringerLayout(1, steel).count).toBe(2)
    expect(resolveStairStringerLayout(1.6, steel).count).toBe(3)
    expect(resolveStairStringerLayout(1, steel).bands.map((band) => band.kind)).toEqual([
      'housed',
      'housed',
    ])
    // never more stringers than fit side by side
    expect(resolveStairStringerLayout(3 * IN, set).count).toBe(2)
  })
})

describe('stringer geometry', () => {
  // ten 7 in risers over 11 in treads, 2x12 stringers, two 2x6 treads, open risers
  const structure = resolveStairStructure(
    StairNode.parse({ structure: { treadStock: '2x6-pair', closedRisers: false } }),
  )!
  const construction = stairStructureConstruction(structure)
  const flight = stairStringerFlight(
    { stepCount: 10, height: 70 * IN, length: 110 * IN },
    construction,
  )

  it('notches a cut stringer for every tread: seats under the treads, a throat of D − r·cos θ, a level seat on the base and a plumb cut at the top', () => {
    const cut = stairStringerCut({ kind: 'cut', depth: 11.25 * IN }, flight)
    expect(cut.slices).toHaveLength(10)
    const cos = 11 / Math.hypot(7, 11)
    expect(cut.throat).toBeCloseTo((11.25 - 7 * cos) * IN, 9)
    expect(cut.throat).toBeGreaterThan(STAIR_CODE.minThroat)
    for (const [i, slice] of cut.slices.entries()) {
      // each seat is the walking top less the 1-1/2 in tread
      expect(slice.top).toBeCloseTo(((i + 1) * 7 - 1.5) * IN, 9)
      expect(Math.min(...slice.profile.map((point) => point[1]))).toBeGreaterThanOrEqual(-1e-9)
    }
    // the first riser cut stands on the base and the board is cut level along it
    expect(cut.seat![0]).toBeCloseTo(0, 9)
    expect(cut.seat![1]).toBeGreaterThan(11 * IN)
    expect(cut.plumb.z).toBeCloseTo(110 * IN, 9)
    expect(cut.plumb.top).toBeCloseTo((70 - 1.5) * IN, 9)
    // the cut length: the run along the slope plus the seat height over the top
    const sin = 7 / Math.hypot(7, 11)
    expect(cut.length).toBeCloseTo(110 * IN * cos + (70 - 1.5) * IN * sin, 9)
  })

  it('sets the riser cuts back behind riser boards and keeps the last seat inside the run', () => {
    const closed = stairStringerFlight(
      { stepCount: 10, height: 70 * IN, length: 110 * IN },
      stairStructureConstruction({ ...structure, closedRisers: true }),
    )
    const cut = stairStringerCut({ kind: 'cut', depth: 11.25 * IN }, closed)
    expect(Math.min(...cut.slices[0]!.profile.map((point) => point[0]))).toBeCloseTo(0.75 * IN, 9)
    expect(Math.max(...cut.slices.at(-1)!.profile.map((point) => point[0]))).toBeCloseTo(
      110 * IN,
      9,
    )
  })

  it('stands a housed stringer over the nosing line, level at the base and the floor it reaches', () => {
    const housed = stairStringerCut({ kind: 'housed', depth: 11.25 * IN }, flight)
    const points = housed.slices.flatMap((slice) => slice.profile)
    expect(housed.slices).toHaveLength(10)
    expect(Math.min(...points.map((point) => point[1]))).toBeGreaterThanOrEqual(-1e-9)
    expect(Math.max(...points.map((point) => point[1]))).toBeLessThanOrEqual(70 * IN + 1e-9)
    // its top edge runs 2 in (square) over the nosing line: through each nosing at (i·11 − 1, (i+1)·7)
    const slope = 7 / 11
    const reveal = 2 * Math.hypot(1, slope)
    for (let i = 0; i < 8; i++) {
      const z1 = (i + 1) * 11
      const nosingLine = slope * (z1 + 1) + 7
      expect(housed.slices[i]!.top).toBeCloseTo((nosingLine + reveal) * IN, 9)
    }
    // it runs an inch ahead of the bottom nosing before its plumb cut
    expect(Math.min(...points.map((point) => point[0]))).toBeCloseTo(-2 * IN, 9)
    expect(housed.throat).toBeCloseTo(11.25 * IN, 9)
  })
})

describe('the body a structure draws', () => {
  it('draws treads, risers and a cut stringer per step at every stringer place for wood stringers', () => {
    const { stair, flight } = flightStair(10, 7, 11, {
      structure: StairStructure.parse({ closedRisers: true }),
    })
    const pieces = resolveStraightStairConstruction(flight, 0, stair)!
    const layout = resolveStairStringerLayout(flight.width, resolveStairStructure(stair)!)
    expect(layout.count).toBe(4)
    for (const band of layout.bands) {
      const own = pieces.filter((piece) => piece.x0 === band.x0 && piece.x1 === band.x1)
      expect(own).toHaveLength(10)
      expect(own.every((piece) => piece.role === 'body')).toBe(true)
    }
    const treads = pieces.filter((piece) => piece.role === 'tread')
    expect(treads).toHaveLength(10)
    // the walking tops stay the finished heights; the nosing projects 1 in
    expect(Math.max(...treads.map((piece) => piece.top))).toBeCloseTo(70 * IN, 9)
    expect(Math.min(...treads.map((piece) => piece.z0))).toBeCloseTo(-1 * IN, 9)
    // one riser board per step, in front of the riser cuts
    const risers = pieces.filter(
      (piece) =>
        piece.role === 'body' && piece.x0 === -flight.width / 2 && piece.x1 === flight.width / 2,
    )
    expect(risers).toHaveLength(10)
  })

  it('pours concrete as one solid mass to the base with no stringers', () => {
    const { stair, flight } = flightStair(4, 7, 11, {
      structure: StairStructure.parse({ type: 'concrete' }),
    })
    const construction = resolveStairConstruction(flight, stair)!
    expect(construction.mode).toBe('solid')
    expect(construction.nosing).toBe(0)
    const pieces = resolveStraightStairConstruction(flight, 0, stair)!
    expect(pieces).toHaveLength(4)
    expect(pieces.every((piece) => piece.role === 'body')).toBe(true)
    expect(pieces.every((piece) => piece.underside[1] === 0)).toBe(true)
  })

  it('keeps an explicit body over the structure and frames a wood landing', () => {
    const { stair, flight } = flightStair(10, 7, 11, {
      structure: StairStructure.parse({}),
      construction: { mode: 'solid' } as StairNode['construction'],
    })
    expect(resolveStairConstruction(flight, stair)!.structure).toBeUndefined()
    const landing = StairSegmentNode.parse({
      segmentType: 'landing',
      width: 1,
      length: 1,
      height: 0,
    })
    const wood = StairNode.parse({ structure: {} })
    const pieces = resolveStraightStairConstruction(landing, 1.2, wood)!
    const frame = stairLandingFrame({ width: 1, length: 1 }, 1.5 * IN, 1.2)
    expect(frame.rims).toHaveLength(4)
    expect(frame.posts).toHaveLength(4)
    expect(frame.joists.length).toBeGreaterThan(0)
    expect(pieces).toHaveLength(1 + frame.rims.length + frame.joists.length + frame.posts.length)
    // a landing barely off the base sits on blocking, not posts
    expect(stairLandingFrame({ width: 1, length: 1 }, 1.5 * IN, 0.2).posts).toHaveLength(0)
  })
})

describe('code checks', () => {
  const codes = (stair: StairNode, nodes: Record<string, AnyNode>) =>
    measureStair(stair, nodes).diagnostics.map((issue) => issue.code)

  it('passes a code-sized wood stair and reports nothing extra for a stair without a structure', () => {
    const good = flightStair(14, 7.25, 10.5, { structure: StairStructure.parse({}) })
    expect(codes(good.stair, good.nodes).filter((code) => /^(code|stringer)-/.test(code))).toEqual(
      [],
    )
    const legacy = flightStair(4, 8, 9, { railingMode: 'none' })
    expect(
      codes(legacy.stair, legacy.nodes).filter((code) => /^(code|stringer)-/.test(code)),
    ).toEqual([])
  })

  it('flags risers, treads, nosings, the handrail, the guard, open risers and DCA 6 stringer limits', () => {
    const steep = flightStair(5, 8, 9, {
      railingMode: 'none',
      structure: StairStructure.parse({ closedRisers: false, nosing: 0, stringerCount: 2 }),
    })
    const found = codes(steep.stair, steep.nodes)
    for (const code of [
      'code-riser',
      'code-tread',
      'code-nosing',
      'code-handrail',
      'code-guard',
      'code-open-risers',
      'stringer-spacing',
    ])
      expect(found).toContain(code)
    // a deck stair: a long cut-stringer span and a thin 2x10 throat
    const long = flightStair(10, 7.75, 10, {
      deckSlabId: 'slab_deck',
      structure: StairStructure.parse({ stringerStock: '2x10' }),
    })
    const longCodes = codes(long.stair, long.nodes)
    expect(longCodes).toContain('stringer-span')
    expect(longCodes).toContain('stringer-throat')
    // a narrow stair
    const narrow = flightStair(4, 7, 11, { structure: StairStructure.parse({}) }, 30 * IN)
    expect(codes(narrow.stair, narrow.nodes)).toContain('code-width')
  })
})
