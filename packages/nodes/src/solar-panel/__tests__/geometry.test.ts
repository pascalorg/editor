import { describe, expect, test } from 'bun:test'
import { getActiveRoofHeight, type RoofSegmentNode } from '@pascal-app/core'
import { getAnalyticalNormal, getSurfaceY } from '../../shared/roof-surface'
import { buildSolarPanelGeometry, computeAutoFit, flippedPanelDims } from '../geometry'
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
  // Regression: previously `(0, depth, -rh)` flipped the shed preview's
  // tilt opposite the actual slope (peak at -d/2, eave at +d/2 → outward
  // normal tilts toward +Z, the low side).
  test('shed returns normal tilted toward the +z low side', () => {
    const n = getAnalyticalNormal(0, 0, fixtureSegment({ roofType: 'shed' }))
    expect(n.z).toBeGreaterThan(0)
    expect(n.y).toBeGreaterThan(0)
  })
  test('gambrel lower tier z=+halfD tilts toward +z', () => {
    const seg = fixtureSegment({ roofType: 'gambrel' })
    const n = getAnalyticalNormal(0, seg.depth / 2 - 0.01, seg)
    expect(n.z).toBeGreaterThan(0)
    expect(n.y).toBeGreaterThan(0)
  })
  test('gambrel upper tier (|z|<mz) uses shallower slope than lower tier', () => {
    const seg = fixtureSegment({
      roofType: 'gambrel',
      gambrelLowerWidthRatio: 0.5,
      gambrelLowerHeightRatio: 0.7,
    })
    const lower = getAnalyticalNormal(0, seg.depth / 2 - 0.01, seg)
    const upper = getAnalyticalNormal(0, 0.01, seg)
    // Both tilt toward +z; upper tier is shallower, so its Z component
    // (sin θ) is smaller than the lower tier's.
    expect(upper.z).toBeGreaterThan(0)
    expect(upper.z).toBeLessThan(lower.z)
  })
  test('hip +x face tilts toward +x, not +z', () => {
    const n = getAnalyticalNormal(2, 0, fixtureSegment({ roofType: 'hip' }))
    expect(n.x).toBeGreaterThan(0)
    expect(Math.abs(n.z)).toBeLessThan(1e-6)
    expect(n.y).toBeGreaterThan(0)
  })
  // Regression: mansard previously fell through to gable code, ignoring
  // the X axis. Points near the +X edge tilted toward +Z instead of +X.
  test('mansard +x steep band tilts toward +x', () => {
    const seg = fixtureSegment({ roofType: 'mansard' })
    const n = getAnalyticalNormal(seg.width / 2 - 0.01, 0, seg)
    expect(n.x).toBeGreaterThan(0)
    expect(Math.abs(n.z)).toBeLessThan(1e-6)
    expect(n.y).toBeGreaterThan(0)
  })
  test('mansard top hip (inside waist) is shallower than the steep band', () => {
    const seg = fixtureSegment({
      roofType: 'mansard',
      mansardSteepWidthRatio: 0.2,
      mansardSteepHeightRatio: 0.7,
    })
    const steep = getAnalyticalNormal(seg.width / 2 - 0.01, 0, seg)
    const top = getAnalyticalNormal(0.01, 0, seg)
    expect(top.x).toBeGreaterThan(0)
    expect(top.x).toBeLessThan(steep.x)
  })
  test('dutch width-axis shoulder tilts toward +x when outside the waist span', () => {
    const seg = fixtureSegment({ roofType: 'dutch', width: 8, depth: 6 })
    const n = getAnalyticalNormal(seg.width / 2 - 0.01, 0, seg)
    expect(n.x).toBeGreaterThan(0)
    expect(Math.abs(n.z)).toBeLessThan(1e-6)
    expect(n.y).toBeGreaterThan(0)
  })
  test('dutch +z gable side tilts toward +z (w>=d)', () => {
    const seg = fixtureSegment({ roofType: 'dutch', width: 8, depth: 6 })
    const n = getAnalyticalNormal(0, seg.depth / 2 - 0.01, seg)
    expect(n.z).toBeGreaterThan(0)
    expect(Math.abs(n.x)).toBeLessThan(1e-6)
    expect(n.y).toBeGreaterThan(0)
  })
  test('dutch top gable face keeps the same fall direction near the ridge', () => {
    const seg = fixtureSegment({
      roofType: 'dutch',
      width: 8,
      depth: 6,
      dutchHipWidthRatio: 0.2,
      dutchHipHeightRatio: 0.6,
    })
    const upper = getAnalyticalNormal(0, 0.01, seg)
    expect(upper.z).toBeGreaterThan(0)
    expect(Math.abs(upper.x)).toBeLessThan(1e-6)
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
