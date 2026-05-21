import { describe, expect, test } from 'bun:test'
import { getActiveRoofHeight, type RoofSegmentNode } from '@pascal-app/core'
import {
  buildSolarPanelGeometry,
  computeAutoFit,
  flippedPanelDims,
  getAnalyticalNormal,
  getSurfaceY,
} from '../geometry'
import { SolarPanelNode } from '../schema'

// atan(2 / 3) in degrees — gives `getActiveRoofHeight` ≈ 2.0 on the
// default 8×6 gable so peak / slope assertions keep their previous values.
const FIXTURE_PITCH_DEG = (Math.atan2(2, 3) * 180) / Math.PI

const fixtureSegment = (overrides?: Partial<RoofSegmentNode>): RoofSegmentNode =>
  ({
    object: 'node',
    id: 'rseg_fixture',
    type: 'roof-segment',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    roofType: 'gable',
    width: 8,
    depth: 6,
    wallHeight: 2.5,
    pitch: FIXTURE_PITCH_DEG,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    ...overrides,
  }) as RoofSegmentNode

describe('buildSolarPanelGeometry', () => {
  test('default grid yields a non-empty geometry with two render groups', () => {
    const geo = buildSolarPanelGeometry(SolarPanelNode.parse({}))
    expect(geo).not.toBeNull()
    expect(geo!.getAttribute('position').count).toBeGreaterThan(0)
    // Two groups: frame (0) and glass (1).
    expect(geo!.groups.length).toBe(2)
  })

  test('rows × columns drives the cell count — bigger grid means more vertices', () => {
    const small = buildSolarPanelGeometry(SolarPanelNode.parse({ rows: 1, columns: 1 }))!
    const large = buildSolarPanelGeometry(SolarPanelNode.parse({ rows: 4, columns: 5 }))!
    expect(large.getAttribute('position').count).toBeGreaterThan(
      small.getAttribute('position').count,
    )
  })

  test('frameThickness=0 still yields a frame group (zero-width strips collapse)', () => {
    const geo = buildSolarPanelGeometry(SolarPanelNode.parse({ frameThickness: 0 }))
    expect(geo).not.toBeNull()
  })
})

describe('getSurfaceY', () => {
  test('flat segment returns wallHeight regardless of position', () => {
    const seg = fixtureSegment({ roofType: 'flat' })
    expect(getSurfaceY(0, 0, seg)).toBe(seg.wallHeight)
    expect(getSurfaceY(2, -1, seg)).toBe(seg.wallHeight)
  })
  test('gable peak (z=0) reads at wallHeight + active roof height', () => {
    const seg = fixtureSegment()
    expect(getSurfaceY(0, 0, seg)).toBeCloseTo(seg.wallHeight + getActiveRoofHeight(seg))
  })
  test('gable eave (|z|=depth/2) reads at wallHeight', () => {
    const seg = fixtureSegment()
    expect(getSurfaceY(0, seg.depth / 2, seg)).toBeCloseTo(seg.wallHeight)
    expect(getSurfaceY(0, -seg.depth / 2, seg)).toBeCloseTo(seg.wallHeight)
  })
})

describe('getAnalyticalNormal', () => {
  test('flat segment returns world up', () => {
    const n = getAnalyticalNormal(0, 0, fixtureSegment({ roofType: 'flat' }))
    expect(n.x).toBeCloseTo(0)
    expect(n.y).toBeCloseTo(1)
    expect(n.z).toBeCloseTo(0)
  })
  test('gable z=+1 returns normal pointing toward +z (down-slope)', () => {
    const n = getAnalyticalNormal(0, 1, fixtureSegment())
    expect(n.z).toBeGreaterThan(0)
    expect(n.y).toBeGreaterThan(0)
  })
})

describe('computeAutoFit', () => {
  test('default panel + 8m × 6m gable fits a sensible grid', () => {
    const fit = computeAutoFit(fixtureSegment(), SolarPanelNode.parse({}))!
    expect(fit.rows).toBeGreaterThanOrEqual(1)
    expect(fit.columns).toBeGreaterThanOrEqual(1)
    expect(fit.rows).toBeLessThanOrEqual(20)
    expect(fit.columns).toBeLessThanOrEqual(20)
  })
  test('panel larger than segment returns null', () => {
    const fit = computeAutoFit(
      fixtureSegment({ width: 0.5, depth: 0.5 }),
      SolarPanelNode.parse({ panelWidth: 1, panelHeight: 1 }),
    )
    expect(fit).toBeNull()
  })
})

describe('flippedPanelDims', () => {
  test('swaps width and height', () => {
    expect(flippedPanelDims(SolarPanelNode.parse({ panelWidth: 1, panelHeight: 1.65 }))).toEqual({
      panelWidth: 1.65,
      panelHeight: 1,
    })
  })
})
