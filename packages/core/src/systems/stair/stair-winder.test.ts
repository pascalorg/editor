import { expect, it } from 'bun:test'
import {
  computeSegmentTransforms,
  measureStair,
  planStairPreset,
  resolveStairWinder,
  resolveWinderStairConstruction,
  StairConstruction,
  StairNode,
  StairSegmentNode,
} from '../../index'

it('rectangular winders divide square walking lines, preserve corner area and chain exact exits', () => {
  for (const turn of ['left', 'right'] as const) {
    const flight = StairSegmentNode.parse({
      width: 1.2,
      height: 0.9,
      stepCount: 5,
      winder: { turn, innerGap: 0.2, walkingLineOffset: 0.6 },
    })
    const layout = resolveStairWinder(flight)!
    const area = (polygon: [number, number][]) =>
      Math.abs(
        polygon.reduce((sum, a, i) => {
          const b = polygon[(i + 1) % polygon.length]!
          return sum + a[0] * b[1] - a[1] * b[0]
        }, 0) / 2,
      )
    expect(layout.treads.reduce((sum, tread) => sum + area(tread.polygon), 0)).toBeCloseTo(
      1.4 ** 2 - 0.2 ** 2,
      10,
    )
    expect(layout.footprint.every((point) => point.every(Number.isFinite))).toBe(true)
    for (const tread of layout.treads)
      expect(tread.endStation - tread.startStation).toBeCloseTo(1.6 / 5, 10)
    const straight = StairSegmentNode.parse({
      width: 1.2,
      length: 2,
      height: 1,
      attachmentSide: 'front',
    })
    const transforms = computeSegmentTransforms([flight, straight])
    expect(transforms[1]!.position).toEqual(layout.exit.position)
    expect(transforms[1]!.rotation).toBe(layout.exit.rotation)
    const stair = StairNode.parse({ totalRise: 3.1, width: 1.2, railingMode: 'none' })
    for (const shape of ['l', 'u'] as const) {
      const plan = planStairPreset(
        stair,
        { [stair.id]: stair },
        { layout: shape, turn, turningStrategy: 'winder' },
      )
      expect(plan.segments.filter((segment) => segment.winder).length).toBe(shape === 'u' ? 2 : 1)
      expect(plan.segments.reduce((sum, segment) => sum + segment.height, 0)).toBeCloseTo(3.1, 10)
      const risers = plan.segments.map((segment) => segment.height / segment.stepCount)
      expect(Math.max(...risers) - Math.min(...risers)).toBeLessThan(1e-10)
      const nodes = {
        [plan.stair.id]: plan.stair,
        ...Object.fromEntries(plan.segments.map((segment) => [segment.id, segment])),
      }
      expect(
        measureStair(plan.stair, nodes).diagnostics.some((d) => d.code === 'narrow-winder-end'),
      ).toBe(true)
    }
  }
})

it('winder construction keeps finished heights across all body modes and rejects invalid walking lines', () => {
  for (const mode of ['solid', 'waist', 'open', 'side-stringers', 'center-stringer'] as const) {
    const flight = StairSegmentNode.parse({
      width: 1.2,
      height: 0.9,
      stepCount: 5,
      winder: { turn: 'left', innerGap: 0.1, walkingLineOffset: 0.6 },
      construction: StairConstruction.parse({ mode, finishThickness: 0.02, nosing: 0.03 }),
    })
    const pieces = resolveWinderStairConstruction(flight, 0.4)!
    for (let index = 0; index < 5; index++) {
      expect(Math.max(...pieces.filter((p) => p.index === index).map((p) => p.top))).toBeCloseTo(
        (index + 1) * 0.18,
        10,
      )
      for (const piece of pieces.filter((p) => p.index === index))
        expect(piece.bottom.every((bottom) => bottom < piece.top)).toBe(true)
    }
  }
  expect(() =>
    resolveStairWinder(
      StairSegmentNode.parse({ width: 0.5, winder: { turn: 'right', walkingLineOffset: 0.6 } }),
    ),
  ).toThrow('walking line')
  expect(resolveStairWinder(StairSegmentNode.parse({}))).toBeNull()
})
