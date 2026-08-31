import { describe, expect, test } from 'bun:test'
import { getConicalRoofCoverage, RoofSegmentNode } from './roof-segment'

describe('conical roof coverage', () => {
  test('keeps an existing clipped sector when full circle is off', () => {
    const node = RoofSegmentNode.parse({
      roofType: 'conical',
      conicalStartAngle: Math.PI / 4,
      conicalSweepAngle: Math.PI,
    })

    expect(getConicalRoofCoverage(node)).toEqual({
      fullCircle: false,
      startAngle: Math.PI / 4,
      sweepAngle: Math.PI,
    })
  })

  test('temporarily ignores clipping angles when full circle is on', () => {
    const node = RoofSegmentNode.parse({
      roofType: 'conical',
      conicalFullCircle: true,
      conicalStartAngle: Math.PI / 4,
      conicalSweepAngle: Math.PI,
    })

    expect(getConicalRoofCoverage(node)).toEqual({
      fullCircle: true,
      startAngle: 0,
      sweepAngle: -Math.PI * 2,
    })
    expect(node.conicalStartAngle).toBe(Math.PI / 4)
    expect(node.conicalSweepAngle).toBe(Math.PI)
  })

  test('infers legacy full cones and clipped sectors', () => {
    expect(getConicalRoofCoverage(RoofSegmentNode.parse({ roofType: 'conical' })).fullCircle).toBe(
      true,
    )
    expect(
      getConicalRoofCoverage(
        RoofSegmentNode.parse({ roofType: 'conical', conicalSweepAngle: -Math.PI / 2 }),
      ).fullCircle,
    ).toBe(false)
  })

  test('uses a half circle when a legacy full cone is switched to clipped', () => {
    const node = RoofSegmentNode.parse({ roofType: 'conical', conicalFullCircle: false })

    expect(getConicalRoofCoverage(node)).toEqual({
      fullCircle: false,
      startAngle: 0,
      sweepAngle: -Math.PI,
    })
  })
})
