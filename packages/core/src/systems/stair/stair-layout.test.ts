import { describe, expect, it } from 'bun:test'
import {
  createAngleAccumulator,
  planStairSweepEdit,
  resolveStairArcDimensions,
  resolveStairArcLayout,
  StairNode,
} from '../../index'

describe('arc stair walking elevations', () => {
  it('keeps thin and thick spiral treads on the same uniform rise and destination', () => {
    for (const thickness of [0.05, 0.25]) {
      const stair = StairNode.parse({ stairType: 'spiral', stepCount: 15, thickness })
      const layout = resolveStairArcLayout(stair, 3)
      expect(layout.steps[0]!.top).toBeCloseTo(0.2)
      expect(layout.steps.at(-1)!.top).toBeCloseTo(3)
      expect(layout.steps.at(-1)!.top - layout.steps.at(-1)!.bottom).toBeCloseTo(thickness)
    }
  })
  it('places an integrated landing at the destination for either winding direction', () => {
    for (const sweepAngle of [7, -7]) {
      const layout = resolveStairArcLayout(
        StairNode.parse({
          stairType: 'spiral',
          topLandingMode: 'integrated',
          sweepAngle,
          thickness: 0.05,
        }),
        3,
      )
      expect(layout.landing!.top).toBe(3)
      expect(layout.landing!.bottom).toBeCloseTo(2.95)
      expect(Math.sign(layout.landingSweep)).toBe(Math.sign(sweepAngle))
    }
  })
  it('keeps a filled curved stair on the riser schedule with thick finish parameters', () => {
    const layout = resolveStairArcLayout(
      StairNode.parse({ stairType: 'curved', stepCount: 10, thickness: 0.5 }),
      2,
    )
    expect(layout.steps[0]!.top).toBeCloseTo(0.2)
    expect(layout.steps[0]!.bottom).toBe(0)
  })
})

it('angular sweep edits grow across turns and hold the opposite stair edge fixed', () => {
  for (const sign of [-1, 1]) {
    for (const end of ['start', 'end'] as const) {
      const stair = StairNode.parse({
        stairType: 'spiral',
        sweepAngle: sign * 4 * Math.PI,
        rotation: 0.7,
        width: 0.1,
        innerRadius: 0.02,
        thickness: 0.005,
      })
      const accumulate = createAngleAccumulator(0)
      let delta = 0
      for (let index = 1; index <= 80; index++) {
        const angle = (sign * (end === 'end' ? 1 : -1) * index * Math.PI) / 10
        delta = accumulate(Math.atan2(Math.sin(angle), Math.cos(angle)))
      }
      const edit = planStairSweepEdit(stair, delta, end)
      expect(edit.sweepAngle).toBeCloseTo(sign * 12 * Math.PI)
      const fixedBefore = -stair.rotation + ((end === 'end' ? -1 : 1) * stair.sweepAngle) / 2
      const fixedAfter = -edit.rotation + ((end === 'end' ? -1 : 1) * edit.sweepAngle) / 2
      expect(fixedAfter).toBeCloseTo(fixedBefore)
      const dimensions = resolveStairArcDimensions(stair, 0.05)
      expect(dimensions.width).toBe(0.4)
      expect(dimensions.innerRadius).toBe(0.2)
      expect(dimensions.thickness).toBe(0.005)
      const crossed = planStairSweepEdit(stair, -sign * 20 * Math.PI, 'end')
      expect(Math.sign(crossed.sweepAngle)).toBe(sign)
      expect(crossed.sweepAngle * sign).toBeGreaterThan(0)
    }
  }
})
