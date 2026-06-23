import { describe, expect, test } from 'bun:test'
import { createDefaultRidgeVentsForSegment, isDefaultRidgeVentNode } from './ridge-vent'
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

  test('shortens generated gable ridge vents to the trimmed visible span', () => {
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
    expect(vents[0]?.length).toBeCloseTo(5)
    expect(vents[0]?.position[0]).toBeCloseTo(-0.5)
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

  test('creates top ridge plus four slope vents for dutch roofs', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
    })

    const vents = createDefaultRidgeVentsForSegment(segment)
    const gableVent = createDefaultRidgeVentsForSegment(
      RoofSegmentNode.parse({ roofType: 'gable', width: 8, depth: 6 }),
    )[0]

    expect(vents).toHaveLength(5)
    expect(vents.filter((vent) => vent.name === 'Ridge Vent')).toHaveLength(1)
    expect(vents.filter((vent) => vent.name === 'Hip Ridge Vent')).toHaveLength(4)
    const topRidge = vents.find((vent) => vent.name === 'Ridge Vent')
    expect(topRidge?.length).toBeLessThan(gableVent?.length ?? 0)
    expect(topRidge?.width).toBe(0.3)
    expect(topRidge?.height).toBe(0.1)
    expect(
      vents.filter((vent) => vent.name === 'Hip Ridge Vent').every((vent) => vent.rotation !== 0),
    ).toBe(true)
    for (const vent of vents) {
      expect(vent.style).toBe('shingled')
      expect(isDefaultRidgeVentNode(vent, segment.id)).toBe(true)
    }
  })

  test('creates top ridge plus four upper hip vents for mansard roofs', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'mansard',
      width: 8,
      depth: 6,
    })

    const vents = createDefaultRidgeVentsForSegment(segment)

    expect(vents).toHaveLength(5)
    expect(vents.filter((vent) => vent.name === 'Ridge Vent')).toHaveLength(1)
    expect(vents.filter((vent) => vent.name === 'Hip Ridge Vent')).toHaveLength(4)
    expect(vents.find((vent) => vent.name === 'Ridge Vent')?.length).toBeLessThan(segment.width)
    for (const vent of vents) {
      expect(vent.style).toBe('shingled')
      expect(isDefaultRidgeVentNode(vent, segment.id)).toBe(true)
    }
  })
})
