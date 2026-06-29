import { describe, expect, test } from 'bun:test'
import {
  createDefaultRidgeVentsForSegment,
  getRidgeVentLinesForSegment,
  isAutoRidgeVentEnabled,
  isDefaultRidgeVentNode,
  RidgeVentNode,
} from './ridge-vent'
import {
  getDutchRoofMetrics,
  getRoofSegmentVisibleTopBounds,
  ROOF_SHAPE_DEFAULTS,
  RoofSegmentNode,
} from './roof-segment'

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

  test('creates a top ridge plus four hip vents for width-axis Dutch roofs', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
    })

    const vents = createDefaultRidgeVentsForSegment(segment)

    expect(vents.filter((vent) => vent.name === 'Ridge Vent')).toHaveLength(1)
    expect(vents.filter((vent) => vent.name === 'Hip Ridge Vent')).toHaveLength(4)
    // Width-axis Dutch ridge runs along X (constant Z = 0).
    const metrics = getDutchRoofMetrics(segment)
    const ridge = vents.find((vent) => vent.name === 'Ridge Vent')
    const frontRightHip = vents.find(
      (vent) =>
        vent.name === 'Hip Ridge Vent' &&
        (vent.position[0] ?? 0) > 0 &&
        (vent.position[2] ?? 0) > 0,
    )
    const expectedRakeReach = Math.min(
      segment.dutchGabletRake,
      Math.max(0, segment.width / 2 - metrics.waistHalfX) * 0.98,
    )
    expect(ridge?.position[2]).toBeCloseTo(0)
    expect(ridge?.length).toBeCloseTo((metrics.waistHalfX + expectedRakeReach) * 2, 2)
    expect(frontRightHip?.position[0]).toBeCloseTo((4 + 2.93) / 2, 2)
    expect(frontRightHip?.position[2]).toBeCloseTo((3 + 1.5) / 2, 2)
    for (const vent of vents) {
      expect(vent.style).toBe('shingled')
      expect(vent.length).toBeGreaterThan(0.4)
      expect(isDefaultRidgeVentNode(vent, segment.id)).toBe(true)
    }
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

  test('treats legacy preset-white ridge vents as generated defaults', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      roofType: 'gable',
      width: 8,
      depth: 6,
    })
    const legacyVent = RidgeVentNode.parse({
      id: 'rvent_legacy' as never,
      roofSegmentId: segment.id,
      name: 'Ridge Vent',
      style: 'shingled',
      materialPreset: 'preset-white',
      position: [0, 0, 0],
      length: 8,
    })

    expect(isDefaultRidgeVentNode(legacyVent, segment.id)).toBe(true)
  })

  test('creates a Z-oriented ridge plus four hip lines for depth-axis Dutch roofs', () => {
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 6,
      depth: 8,
      overhang: 0,
      wallThickness: 0,
      shingleThickness: 0,
    })

    const lines = getRidgeVentLinesForSegment(segment)
    const metrics = getDutchRoofMetrics(segment)
    const expectedRakeReach = Math.min(
      segment.dutchGabletRake,
      Math.max(0, segment.depth / 2 - metrics.waistHalfZ) * 0.98,
    )

    const ridges = lines.filter((line) => line.name === 'Ridge Vent')
    const hips = lines.filter((line) => line.name === 'Hip Ridge Vent')
    expect(ridges).toHaveLength(1)
    expect(hips).toHaveLength(4)
    // Depth-axis Dutch ridge runs along Z (constant X = 0).
    expect(ridges[0]?.start[0]).toBeCloseTo(0)
    expect(ridges[0]?.end[0]).toBeCloseTo(0)
    expect(Math.abs(ridges[0]?.start[1] ?? 0)).toBeCloseTo(
      metrics.waistHalfZ + expectedRakeReach,
      2,
    )
  })

  test('keeps Dutch hip lines on the rendered arris when the roof has overhang', () => {
    // Overhang + shingle thickness expand the rendered roof; the eave corners
    // and the waist must share that expanded frame, otherwise the hip lines
    // tilt off the arris and the vents sink into the slope.
    const segment = RoofSegmentNode.parse({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      overhang: 0.5,
      wallThickness: 0.2,
      shingleThickness: 0.05,
    })

    const lines = getRidgeVentLinesForSegment(segment)
    const hips = lines.filter((line) => line.name === 'Hip Ridge Vent')
    const ridge = lines.find((line) => line.name === 'Ridge Vent')
    expect(hips).toHaveLength(4)
    expect(ridge).toBeDefined()

    const bounds = getRoofSegmentVisibleTopBounds(segment)
    const { axis, inset } = getDutchRoofMetrics(segment)
    const waistLengthRatio = segment.dutchWaistLengthRatio
    // width 8 >= depth 6 -> axis 'x': the ridge runs along X (waist scaled by
    // waistLengthRatio), and Z is the clean hipped axis (inset exactly).
    expect(axis).toBe('x')
    const halfWExpanded = bounds.maxX
    const halfDExpanded = bounds.maxZ
    const expectedWaistX = (halfWExpanded - inset) * waistLengthRatio
    const expectedWaistZ = halfDExpanded - inset
    const expectedRakeReach = Math.min(
      segment.dutchGabletRake ?? ROOF_SHAPE_DEFAULTS.dutchGabletRake,
      Math.max(0, halfWExpanded - expectedWaistX) * 0.98,
    )

    for (const hip of hips) {
      const [ex, ez] = hip.start
      const [wx, wz] = hip.end
      // Eave end on an expanded-bounds corner; upper end at the rendered rake
      // termination where the lower slope starts, derived from the SAME
      // expanded frame (not the base-dim inner waist).
      expect(Math.abs(ex)).toBeCloseTo(halfWExpanded)
      expect(Math.abs(ez)).toBeCloseTo(halfDExpanded)
      expect(Math.abs(wx)).toBeCloseTo(expectedWaistX + expectedRakeReach)
      expect(Math.abs(wz)).toBeCloseTo(expectedWaistZ)
    }
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
