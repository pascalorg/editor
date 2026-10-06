import { expect, it } from 'bun:test'
import {
  type AnyNode,
  computeSegmentTransforms,
  measureStair,
  planStairPreset,
  planStairSizing,
  planStairSizingEdit,
  proposeStairLayouts,
  StairDesignTargets,
  StairNode,
  type StairNode as StairNodeType,
  StairSegmentNode,
  syncStairRises,
} from '../../index'

it('sizes proposed stairs uniformly without redesigning measured chains until explicit repair', () => {
  const first = StairSegmentNode.parse({ height: 1, length: 2, stepCount: 4 })
  const second = StairSegmentNode.parse({ height: 2, length: 4, stepCount: 8 })
  const stair = StairNode.parse({ totalRise: 3, children: [first.id, second.id] })
  const nodes: Record<string, AnyNode> = {
    [stair.id]: stair,
    [first.id]: first,
    [second.id]: second,
  }
  expect(syncStairRises(nodes)).toEqual([])
  const patches = planStairSizingEdit(stair, nodes, true)
  for (const patch of patches) nodes[patch.id] = { ...nodes[patch.id], ...patch.data } as AnyNode
  const fitted = nodes[stair.id] as StairNodeType
  const measurement = measureStair(fitted, nodes)
  expect(
    measurement.flights.every(
      (flight) => flight.riserHeight! <= measurement.targets.maxRiserHeight,
    ),
  ).toBe(true)
  expect(measurement.uniformity).toBeCloseTo(0, 10)
  expect(
    measurement.flights.every(
      (flight) => Math.abs(flight.going! - measurement.targets.targetGoing) < 1e-8,
    ),
  ).toBe(true)
  expect(measurement.diagnostics.some((entry) => entry.code === 'riser-target')).toBe(false)
  nodes[stair.id] = { ...fitted, totalRise: 3.4 }
  const synced = syncStairRises(nodes)
  for (const patch of synced) nodes[patch.id] = { ...nodes[patch.id], ...patch.data } as AnyNode
  expect(measureStair(nodes[stair.id] as StairNodeType, nodes).uniformity).toBeCloseTo(0, 10)
  expect(
    measureStair(nodes[stair.id] as StairNodeType, nodes).flights.reduce(
      (sum, flight) => sum + flight.rise,
      0,
    ),
  ).toBeCloseTo(3.4)
  expect(() => planStairSizing(0)).toThrow(RangeError)
})

it('fits the minimum going for straight and signed arc stairs and refuses landing-only repair', () => {
  for (const stairType of ['straight', 'curved', 'spiral'] as const) {
    for (const sign of [-1, 1]) {
      const flight = StairSegmentNode.parse({ height: 3, length: 3, stepCount: 10 })
      const stair = StairNode.parse({
        stairType,
        totalRise: 3,
        children: [flight.id],
        sweepAngle: sign * Math.PI * 2,
        designTargets: StairDesignTargets.parse({ minimumGoing: 0.4, targetGoing: 0.28 }),
      })
      const nodes: Record<string, AnyNode> = { [stair.id]: stair, [flight.id]: flight }
      for (const patch of planStairSizingEdit(stair, nodes, true))
        nodes[patch.id] = { ...nodes[patch.id], ...patch.data } as AnyNode
      const fitted = nodes[stair.id] as StairNodeType
      expect(measureStair(fitted, nodes).flights[0]!.going).toBeCloseTo(0.4)
      expect(
        measureStair(fitted, nodes).diagnostics.some((entry) => entry.code === 'going-target'),
      ).toBe(false)
      if (stairType !== 'straight') expect(Math.sign(fitted.sweepAngle)).toBe(sign)
    }
  }
  const landing = StairSegmentNode.parse({ segmentType: 'landing', height: 0 })
  const stair = StairNode.parse({ totalRise: 3, children: [landing.id] })
  expect(() => planStairSizingEdit(stair, { [stair.id]: stair, [landing.id]: landing })).toThrow(
    RangeError,
  )
})

it('measures child flights and repairs huge stored arc counts without constructing treads', () => {
  const flight = StairSegmentNode.parse({ height: 3, length: 4.5, stepCount: 16 })
  const stair = StairNode.parse({ totalRise: 3, stepCount: 4294967296, children: [flight.id] })
  expect(measureStair(stair, { [stair.id]: stair, [flight.id]: flight }).riserCount).toBe(
    flight.stepCount,
  )
  const spiral = StairNode.parse({ stairType: 'spiral', totalRise: 3, stepCount: 4294967296 })
  const repaired = planStairSizingEdit(spiral, { [spiral.id]: spiral }, true)[0]!.data
  expect(spiral.totalRise! / repaired.stepCount!).toBeLessThanOrEqual(
    StairDesignTargets.parse({}).maxRiserHeight,
  )
})

it('proposes connected straight, L and U chains with uniform risers and width-sized landings', () => {
  const originalFlight = StairSegmentNode.parse({
    height: 3,
    slots: { tread: 'library:wood' },
    width: 1.2,
  })
  const stair = StairNode.parse({ totalRise: 3, width: 1.2, children: [originalFlight.id] })
  const nodes = { [stair.id]: stair, [originalFlight.id]: originalFlight }
  const before = JSON.stringify(nodes)
  for (const layout of ['straight', 'l', 'u'] as const) {
    for (const turn of ['left', 'right'] as const) {
      const plan = planStairPreset(stair, nodes, { layout, turn })
      expect(plan.segments[0]!.id).toBe(originalFlight.id)
      expect(plan.segments[0]!.slots).toEqual(originalFlight.slots)
      const proposed: Record<string, AnyNode> = { ...nodes, [stair.id]: plan.stair }
      for (const segment of plan.segments) proposed[segment.id] = segment
      const measured = measureStair(plan.stair, proposed)
      expect(measured.uniformity).toBeLessThan(1e-10)
      expect(
        measured.flights.every((flight) => flight.riserHeight! <= measured.targets.maxRiserHeight),
      ).toBe(true)
      expect(plan.segments.reduce((sum, s) => sum + s.height, 0)).toBeCloseTo(3)
      for (const landing of plan.segments.filter((s) => s.segmentType === 'landing')) {
        expect(landing.height).toBe(0)
        expect(landing.length).toBe(1.2)
      }
      const transforms = computeSegmentTransforms(plan.segments)
      const final = transforms.at(-1)!
      expect(final.rotation).toBeCloseTo(
        (turn === 'left' ? 1 : -1) * (layout === 'l' ? Math.PI / 2 : layout === 'u' ? Math.PI : 0),
      )
      if (layout === 'u') {
        expect(Math.abs(final.position[0])).toBeCloseTo(1.2)
        expect(final.position[2]).toBeCloseTo(plan.segments[0]!.length)
        expect(plan.footprint.width).toBeCloseTo(2.4)
      }
    }
  }
  const alternatives = proposeStairLayouts(stair, nodes, { width: 2.4, length: 4 })
  expect(new Set(alternatives.map((option) => option.layout))).toEqual(
    new Set(['straight', 'l', 'u']),
  )
  expect(alternatives.find((option) => option.layout === 'u')!.fits).toBe(true)
  expect(alternatives.find((option) => option.layout === 'straight')!.fits).toBe(false)
  expect(JSON.stringify(nodes)).toBe(before)
  expect(() => planStairPreset(stair, nodes, { layout: 'l', landingDepth: 0.5 })).toThrow(
    RangeError,
  )
})

it('sizes winder risers from their current walking distance and preserves ignored straight length', () => {
  const winder = StairSegmentNode.parse({
    length: 999,
    width: 1,
    height: 1,
    stepCount: 3,
    winder: { turn: 'right', innerGap: 0.2, walkingLineOffset: 0.5 },
  })
  const straight = StairSegmentNode.parse({ length: 1.4, height: 2, stepCount: 7 })
  const stair = StairNode.parse({
    totalRise: 3,
    children: [winder.id, straight.id],
    railingMode: 'none',
  })
  const nodes = { [stair.id]: stair, [winder.id]: winder, [straight.id]: straight }
  const updates = planStairSizingEdit(stair, nodes, true)
  const winderUpdate = updates.find((update) => update.id === winder.id)!.data
  const straightUpdate = updates.find((update) => update.id === straight.id)!.data
  expect(
    Math.abs(
      (winderUpdate as StairSegmentNode).stepCount - (straightUpdate as StairSegmentNode).stepCount,
    ),
  ).toBeLessThanOrEqual(1)
  expect(winderUpdate.length).toBeUndefined()
  expect(straightUpdate.length).toBeGreaterThan(0)
})

it('shares default sizing numbers across creation planners', () => {
  for (const [rise, maxRiserHeight, stepCount, length] of [
    [3, 0.18, 17, 4.76],
    [2.7, 0.18, 15, 4.2],
    [2.4, 0.18, 14, 3.92],
    [3, 0.15, 20, 5.6],
    [1.5, 0.18, 9, 2.52],
  ]) {
    const sizing = planStairSizing(rise!, { targets: { maxRiserHeight: maxRiserHeight! } })
    expect(sizing.stepCount).toBe(stepCount!)
    expect(sizing.length).toBeCloseTo(length!)
    expect(sizing.going).toBeCloseTo(0.28)
  }
})
