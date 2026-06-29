import { describe, expect, test } from 'bun:test'
import {
  createDefaultRidgeVentsForSegment,
  getRidgeVentLinesForSegment,
  isAutoRidgeVentEnabled,
  isDefaultRidgeVentNode,
} from './ridge-vent'
import { RoofSegmentNode } from './roof-segment'

describe('createDefaultRidgeVentsForSegment', () => {
  test('creates one shingled default ridge vent for gable roofs', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'gable',
      width: 8,
      depth: 6,
    })

    const vents = createDefaultRidgeVentsForSegment(segment)

    expect(vents).toHaveLength(1)
    expect(vents[0]?.name).toBe('Ridge Vent')
    expect(vents[0]?.style).toBe('shingled')
    expect(vents[0]?.roofSegmentId).toBe(segment.id)
    expect(isDefaultRidgeVentNode(vents[0], segment.id)).toBe(true)
  })

  test('keeps generated gable ridge vents anchored to the untrimmed ridge', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'gable',
      width: 8,
      depth: 6,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
      trim: { left: 1, right: 2, front: 0, back: 0 },
    })

    const vents = createDefaultRidgeVentsForSegment(segment)

    expect(vents).toHaveLength(1)
    expect(vents[0]?.length).toBeCloseTo(8)
    expect(vents[0]?.position[0]).toBeCloseTo(0)
  })

  test('creates top ridge plus four hip vents for rectangular hip roofs', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'hip',
      width: 8,
      depth: 6,
    })

    const vents = createDefaultRidgeVentsForSegment(segment)

    expect(vents).toHaveLength(5)
    expect(vents.filter((vent) => vent.name === 'Ridge Vent')).toHaveLength(1)
    expect(vents.filter((vent) => vent.name === 'Hip Ridge Vent')).toHaveLength(4)
    for (const vent of vents) {
      expect(vent.style).toBe('shingled')
      expect(vent.length).toBeGreaterThan(0.4)
      expect(isDefaultRidgeVentNode(vent, segment.id)).toBe(true)
    }
  })

  test('omits the collapsed top ridge on square hip roofs', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'hip',
      width: 6,
      depth: 6,
    })

    const vents = createDefaultRidgeVentsForSegment(segment)

    expect(vents).toHaveLength(4)
    expect(vents.every((vent) => vent.name === 'Hip Ridge Vent')).toBe(true)
  })

  test('does not create default ridge vents for width-axis Dutch roofs', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
    })

    const vents = createDefaultRidgeVentsForSegment(segment)
    const lines = getRidgeVentLinesForSegment(segment)

    expect(vents).toEqual([])
    expect(lines).toEqual([])
  })

  test('treats legacy segments with generated ridge vents as auto-enabled', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'gable',
      width: 8,
      depth: 6,
    })

    const vents = createDefaultRidgeVentsForSegment(segment)
    const nodes = Object.fromEntries(vents.map((vent) => [vent.id, vent]))

    expect(
      isAutoRidgeVentEnabled(
        {
          id: segment.id,
          children: vents.map((vent) => vent.id),
          metadata: {},
        },
        nodes,
      ),
    ).toBe(true)
  })

  test('does not create ridge lines for depth-axis Dutch roofs either', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 6,
      depth: 8,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
    })

    const lines = getRidgeVentLinesForSegment(segment)
    expect(lines).toEqual([])
  })

  test('creates top ridge plus four upper hip vents plus four lower-slope vents for mansard roofs', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'mansard',
      width: 8,
      depth: 6,
    })

    const vents = createDefaultRidgeVentsForSegment(segment)

    expect(vents).toHaveLength(9)
    expect(vents.filter((vent) => vent.name === 'Ridge Vent')).toHaveLength(1)
    expect(vents.filter((vent) => vent.name === 'Hip Ridge Vent')).toHaveLength(4)
    expect(vents.filter((vent) => vent.name === 'Slope Ridge Vent')).toHaveLength(4)
    expect(vents.find((vent) => vent.name === 'Ridge Vent')?.length).toBeLessThan(segment.width)
    const slopeVents = vents.filter((vent) => vent.name === 'Slope Ridge Vent')
    const slopeRotations = slopeVents.map((vent) => Math.abs(vent.rotation))
    expect(slopeRotations.every((rotation) => rotation > 0.1)).toBe(true)
    expect(slopeRotations.every((rotation) => Math.abs(rotation - Math.PI / 2) > 0.1)).toBe(true)
    expect(
      slopeVents.every(
        (vent) =>
          Math.abs(vent.position[0]) > segment.width / 2 - 0.8 &&
          Math.abs(vent.position[2]) > segment.depth / 2 - 0.8,
      ),
    ).toBe(true)
    expect(
      new Set(
        slopeVents.map((vent) => `${Math.sign(vent.position[0])},${Math.sign(vent.position[2])}`),
      ).size,
    ).toBe(4)
    for (const vent of vents) {
      expect(vent.style).toBe('shingled')
      expect(isDefaultRidgeVentNode(vent, segment.id)).toBe(true)
    }
  })
})
