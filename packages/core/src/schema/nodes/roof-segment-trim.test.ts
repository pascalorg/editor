import { describe, expect, test } from 'bun:test'
import {
  getRoofSegmentVisibleTopBounds,
  normalizeRoofSegmentTrim,
  RoofSegmentNode,
} from './roof-segment'

describe('roof segment trim', () => {
  test('defaults legacy segments to no trim', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test',
      type: 'roof-segment',
    })

    expect(segment.trim).toEqual({
      left: 0,
      right: 0,
      front: 0,
      back: 0,
      frontLeft: 0,
      frontRight: 0,
      backLeft: 0,
      backRight: 0,
      frontLeftX: 0,
      frontLeftZ: 0,
      frontRightX: 0,
      frontRightZ: 0,
      backLeftX: 0,
      backLeftZ: 0,
      backRightX: 0,
      backRightZ: 0,
    })
  })

  test('normalizes impossible side totals without inverting the footprint', () => {
    const trim = normalizeRoofSegmentTrim({
      width: 4,
      depth: 3,
      trim: { left: 3, right: 3, front: 2, back: 2 },
    })

    expect(trim.left + trim.right).toBeCloseTo(3.9)
    expect(trim.front + trim.back).toBeCloseTo(2.9)
  })

  test('visible top bounds respect asymmetric trims', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test',
      type: 'roof-segment',
      width: 8,
      depth: 6,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
      trim: { left: 1, right: 2, front: 0, back: 0 },
    })

    const bounds = getRoofSegmentVisibleTopBounds(segment)

    expect(bounds.minX).toBeCloseTo(-3)
    expect(bounds.maxX).toBeCloseTo(2)
    expect(bounds.width).toBeCloseTo(5)
  })

  test('visible top bounds stay finite for legacy partial segments', () => {
    const bounds = getRoofSegmentVisibleTopBounds({
      id: 'rseg_legacy',
      type: 'roof-segment',
      roofType: 'gable',
      trim: { left: 1 },
    } as unknown as Parameters<typeof getRoofSegmentVisibleTopBounds>[0])

    expect(Number.isFinite(bounds.minX)).toBe(true)
    expect(Number.isFinite(bounds.maxX)).toBe(true)
    expect(Number.isFinite(bounds.minZ)).toBe(true)
    expect(Number.isFinite(bounds.maxZ)).toBe(true)
    expect(Number.isFinite(bounds.width)).toBe(true)
    expect(Number.isFinite(bounds.depth)).toBe(true)
  })

  test('diagonal trims can shorten the ridge span', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test',
      type: 'roof-segment',
      width: 8,
      depth: 6,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
      trim: { left: 0, right: 0, front: 0, back: 0, frontLeft: 4, backRight: 4 },
    })

    const bounds = getRoofSegmentVisibleTopBounds(segment)

    expect(bounds.minX).toBeCloseTo(-3)
    expect(bounds.maxX).toBeCloseTo(3)
    expect(bounds.width).toBeCloseTo(6)
  })

  test('diagonal trims support independent width and depth endpoints', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test',
      type: 'roof-segment',
      width: 8,
      depth: 6,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
      trim: {
        frontLeftX: 5,
        frontLeftZ: 2,
        backRightX: 2,
        backRightZ: 5,
      },
    })

    const trim = normalizeRoofSegmentTrim(segment)
    const bounds = getRoofSegmentVisibleTopBounds(segment)

    expect(trim.frontLeft).toBeCloseTo(2)
    expect(trim.frontLeftX).toBeCloseTo(5)
    expect(trim.frontLeftZ).toBeCloseTo(2)
    expect(bounds.maxZ).toBeCloseTo(2.6)
    expect(bounds.maxX).toBeCloseTo(3.2)
  })
})
