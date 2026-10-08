import { expect, it } from 'bun:test'
import {
  measureStair,
  measureStairDetail,
  measureStairHeadroom,
  resolveArcStairConstruction,
  resolveStairWalkingSurfaces,
  resolveStraightStairConstruction,
  StairConstruction,
  StairNode,
  StairSegmentNode,
} from '../../index'

it('keeps finished walking heights while resolving explicit bodies, nosing and stringers', () => {
  const segment = StairSegmentNode.parse({ width: 1, length: 3, height: 2, stepCount: 10 })
  expect(resolveStraightStairConstruction(segment)).toBeNull()
  for (const mode of ['solid', 'waist', 'open', 'side-stringers', 'center-stringer'] as const) {
    const stair = StairNode.parse({
      totalRise: 2,
      children: [segment.id],
      construction: StairConstruction.parse({
        mode,
        finishThickness: 0.03,
        closedRisers: true,
        nosing: 0.04,
      }),
    })
    segment.parentId = stair.id
    const nodes = { [stair.id]: stair, [segment.id]: segment }
    const pieces = resolveStraightStairConstruction(segment, 0, stair)!
    expect(Math.max(...pieces.map((piece) => piece.top))).toBeCloseTo(2)
    expect(Math.min(...pieces.map((piece) => piece.z0))).toBeCloseTo(-0.04)
    expect(
      pieces.every((piece) => piece.profile.every((point) => point.every(Number.isFinite))),
    ).toBe(true)
    const walking = resolveStairWalkingSurfaces(stair, nodes)
    expect(walking.map((surface) => surface.top)).toEqual(
      Array.from({ length: 10 }, (_, i) => (i + 1) * 0.2),
    )
    expect(walking.every((surface) => surface.bodies && surface.bodies.length > 0)).toBe(true)
    expect(measureStair(stair, nodes).flights[0]!.construction?.mode).toBe(mode)
    expect(measureStairHeadroom(stair, nodes).obstructions).toHaveLength(0)
  }
  const lowerFlight = StairSegmentNode.parse({ width: 0.2, length: 3, height: 1, stepCount: 10 })
  const lower = StairNode.parse({ totalRise: 1, children: [lowerFlight.id] })
  lowerFlight.parentId = lower.id
  const upperFlight = StairSegmentNode.parse({ width: 1, length: 3, height: 1, stepCount: 10 })
  const headroom = (mode: 'open' | 'side-stringers' | 'center-stringer') => {
    const upper = StairNode.parse({
      position: [0, 3, 0],
      children: [upperFlight.id],
      totalRise: 1,
      construction: StairConstruction.parse({ mode, nosing: 0 }),
    })
    upperFlight.parentId = upper.id
    return measureStairHeadroom(lower, {
      [lower.id]: lower,
      [lowerFlight.id]: lowerFlight,
      [upper.id]: upper,
      [upperFlight.id]: upperFlight,
    }).minimum!
  }
  expect(headroom('side-stringers')).toBeCloseTo(headroom('open'))
  expect(headroom('center-stringer')).toBeLessThan(headroom('open'))
  const invalidFallback = StairNode.parse({
    width: 1,
    construction: { mode: 'side-stringers', stringerWidth: 0.8 },
  })
  const diagnostics = measureStair(invalidFallback, { [invalidFallback.id]: invalidFallback })
  expect(diagnostics.detail.status).toBe('unresolved')
  expect(diagnostics.headroom.status).toBe('unresolved')
  expect(diagnostics.diagnostics.some((issue) => issue.code === 'geometry-unresolved')).toBe(true)
  for (const mode of ['solid', 'waist'] as const) {
    const inherited = StairNode.parse({
      construction: { mode, closedRisers: true, riserThickness: 1e9 },
    })
    expect(resolveStraightStairConstruction(segment, 0, inherited)!.length).toBeGreaterThan(0)
  }
  const narrowLanding = StairSegmentNode.parse({ segmentType: 'landing', width: 0.1, height: 0 })
  const inherited = StairNode.parse({
    construction: { mode: 'side-stringers', stringerWidth: 0.3 },
  })
  expect(resolveStraightStairConstruction(narrowLanding, 2, inherited)!.length).toBe(1)
})

it('resolves explicit arc construction below the same signed multi-turn walking surfaces', () => {
  expect(resolveArcStairConstruction(StairNode.parse({ stairType: 'spiral' }), 3)).toBeNull()
  for (const mode of ['solid', 'waist', 'open', 'side-stringers', 'center-stringer'] as const) {
    for (const sign of [-1, 1]) {
      const stair = StairNode.parse({
        stairType: 'spiral',
        stepCount: 28,
        totalRise: 4.2,
        sweepAngle: sign * 4 * Math.PI,
        innerRadius: 0.6,
        width: 1.2,
        topLandingMode: 'integrated',
        construction: StairConstruction.parse({
          mode,
          finishThickness: 0.03,
          closedRisers: true,
          nosing: 0.04,
        }),
        showCenterColumn: false,
        showStepSupports: false,
      })
      const pieces = resolveArcStairConstruction(stair, 4.2)!
      expect(pieces.length).toBeGreaterThan(0)
      expect(Math.max(...pieces.map((piece) => piece.top))).toBeCloseTo(4.2)
      expect(
        pieces.every((piece) => piece.top > Math.max(piece.bottomStart, piece.bottomEnd)),
      ).toBe(true)
      expect(pieces.every((piece) => Math.sign(piece.endAngle - piece.startAngle) === sign)).toBe(
        true,
      )
      expect(pieces.some((piece) => piece.top === stair.totalRise)).toBe(true)
      const walking = resolveStairWalkingSurfaces(stair, { [stair.id]: stair })
      expect(walking.every((surface, i) => i === 0 || surface.top >= walking[i - 1]!.top)).toBe(
        true,
      )
      expect(walking[0]!.top).toBeCloseTo(0.15)
      expect(walking.at(-1)!.top).toBeCloseTo(4.2)
      expect(walking.every((surface) => surface.bodies!.length > 0)).toBe(true)
      for (const surface of walking)
        for (const body of surface.bodies!) {
          const [a, b, c] = body.underside
          expect(
            body.region.outer.every(
              ([x, z]) => Number.isFinite(a * x + b * z + c) && a * x + b * z + c < body.top,
            ),
          ).toBe(true)
        }
      expect(measureStairDetail(stair, []).status).toBe('evaluated')
    }
  }
  const impossible = StairNode.parse({
    stairType: 'curved',
    stepCount: 2,
    sweepAngle: 5 * Math.PI,
    construction: { mode: 'waist' },
  })
  expect(measureStairDetail(impossible, []).error).toContain('One tread')
})
