import { describe, expect, test } from 'bun:test'
import {
  BoxVentNode,
  difference,
  getActiveRoofHeight,
  intersection,
  nodeRegistry,
  type RoofSegmentNode,
  registerNode,
  SkylightNode,
} from '@pascal-app/core'
import { boxVentDefinition } from '../../box-vent'
import {
  getAnalyticalNormal,
  getRoofSurfaceFaceBoundsAt,
  getSurfaceY,
} from '../../shared/roof-surface'
import { skylightDefinition } from '../../skylight'
import {
  buildSolarPanelGeometry,
  computeAutoFit,
  flippedPanelDims,
  resolveSolarPanelPlacement,
  solarPanelDefinition,
  solarPanelFootprint,
  solarPanelObstacles,
} from '../index'
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
    const fit = computeAutoFit(fixtureSegment(), SolarPanelNode.parse({ position: [0, 0, 1.5] }))!
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

describe('solar auto-fit placement constraints', () => {
  const panelAt = (position: [number, number, number], rotation = 0) =>
    SolarPanelNode.parse({
      position,
      rotation,
      panelWidth: 1,
      panelHeight: 1,
      gapX: 0,
      gapY: 0,
      standoffHeight: 0,
      frameDepth: 0.02,
    })

  test('fits at the current offset rather than using the entire roof width', () => {
    const segment = fixtureSegment({
      roofType: 'flat',
      width: 8,
      depth: 6,
      overhang: 0,
      wallThickness: 0,
    })
    const centered = computeAutoFit(segment, panelAt([0, 0, 0]))!
    const offset = computeAutoFit(segment, panelAt([3, 0, 0]))!
    expect(offset.columns).toBeLessThan(centered.columns)
    expect(offset.columns).toBe(2)
    expect(computeAutoFit(segment, panelAt([10, 0, 0]))).toBeNull()
  })

  test('rotation changes how many rectangular modules fit', () => {
    const segment = fixtureSegment({
      roofType: 'flat',
      width: 8,
      depth: 3,
      overhang: 0,
      wallThickness: 0,
    })
    const panel = SolarPanelNode.parse({ ...panelAt([0, 0, 0]), panelWidth: 2, panelHeight: 1 })
    expect(computeAutoFit(segment, panel)).toEqual({ rows: 3, columns: 4 })
    expect(computeAutoFit(segment, { ...panel, rotation: Math.PI / 2 })).toEqual({
      rows: 8,
      columns: 1,
    })
  })

  test('uses slope length on both gable faces and refuses to straddle the ridge', () => {
    const segment = fixtureSegment({ pitch: 60, overhang: 0, wallThickness: 0 })
    for (const z of [-1.5, 1.5]) {
      const panel = panelAt([0, 0, z])
      const fit = computeAutoFit(segment, panel)!
      expect(fit.rows).toBeGreaterThan(3)
      const footprint = solarPanelFootprint(segment, { ...panel, ...fit })
      expect(footprint.every((point) => Math.sign(point[1]) === Math.sign(z))).toBe(true)
    }
    expect(computeAutoFit(segment, panelAt([0, 0, 0]))).toBeNull()
  })

  test('a rotated array stays within the triangular hip face', () => {
    const segment = fixtureSegment({ roofType: 'hip' })
    const panel = panelAt([3, 0, 0], Math.PI / 5)
    const fit = computeAutoFit(segment, panel)!
    expect(fit).not.toBeNull()
    const footprint = solarPanelFootprint(segment, { ...panel, ...fit })
    const face = getRoofSurfaceFaceBoundsAt(segment, 3, 0).polygon
    expect(difference(footprint, face)).toEqual([])
  })

  test('avoids occupied space and reports when the current center is blocked', () => {
    const segment = fixtureSegment({ roofType: 'flat', width: 8, depth: 6 })
    const panel = panelAt([0, 0, 0])
    const obstacle: [number, number][] = [
      [1.2, -4],
      [3, -4],
      [3, 4],
      [1.2, 4],
    ]
    const fit = computeAutoFit(segment, panel, [obstacle])!
    expect(fit.columns).toBe(2)
    expect(intersection(solarPanelFootprint(segment, { ...panel, ...fit }), obstacle)).toEqual([])
    expect(computeAutoFit(segment, panelAt([2, 0, 0]), [obstacle])).toBeNull()
  })

  test('respects trimmed edges and diagonal corner cuts', () => {
    const segment = fixtureSegment({ roofType: 'flat', width: 8, depth: 6 })
    const trimmed = {
      ...segment,
      trim: { left: 0, right: 3, front: 0, back: 0 },
    } as RoofSegmentNode
    expect(computeAutoFit(trimmed, panelAt([0, 0, 0]))!.columns).toBe(2)
    const corner = { ...segment, trim: { frontRightX: 3, frontRightZ: 3 } } as RoofSegmentNode
    expect(computeAutoFit(segment, panelAt([3, 0, 2]))).not.toBeNull()
    expect(computeAutoFit(corner, panelAt([3, 0, 2]))).toBeNull()
  })

  test('keeps the schema row and column limit on a large roof', () => {
    const fit = computeAutoFit(
      fixtureSegment({ roofType: 'flat', width: 100, depth: 100 }),
      panelAt([0, 0, 0]),
    )
    expect(fit).toEqual({ rows: 20, columns: 20 })
  })
})

test('auto-fit collects occupied accessory envelopes from the current roof segment', () => {
  const restoreRegistry = nodeRegistry._snapshot()
  try {
    for (const definition of [solarPanelDefinition, boxVentDefinition, skylightDefinition]) {
      if (!nodeRegistry.get(definition.kind)) registerNode(definition)
    }
    const segment = fixtureSegment({ roofType: 'flat' })
    const panel = SolarPanelNode.parse({ roofSegmentId: segment.id })
    const vent = BoxVentNode.parse({ roofSegmentId: segment.id, position: [2, 0, 0] })
    const skylight = SkylightNode.parse({ roofSegmentId: segment.id, position: [-2, 0, 0] })
    const otherPanel = SolarPanelNode.parse({ roofSegmentId: segment.id, position: [0, 0, 2] })
    const elsewhere = BoxVentNode.parse({ roofSegmentId: 'rseg_elsewhere' })
    const obstacles = solarPanelObstacles(segment, panel, [
      panel,
      vent,
      skylight,
      otherPanel,
      elsewhere,
    ])
    expect(obstacles).toHaveLength(3)
    for (const [x, z] of [
      [2, 0],
      [-2, 0],
      [0, 2],
    ]) {
      expect(computeAutoFit(segment, { ...panel, position: [x!, 0, z!] }, obstacles)).toBeNull()
    }
  } finally {
    restoreRegistry()
  }
})

test('tilted glass stays above its mounting plane across the entire array', () => {
  for (const tiltAngle of [0, 15, 45]) {
    const panel = SolarPanelNode.parse({ rows: 3, columns: 2, mountingType: 'tilted', tiltAngle })
    const geo = buildSolarPanelGeometry(panel)!
    geo.rotateX((tiltAngle * Math.PI) / 180)
    const group = geo.groups.find((g) => g.materialIndex === 1)!
    const positions = geo.getAttribute('position')
    for (let i = group.start; i < group.start + group.count; i++) {
      const vertex = geo.index ? geo.index.getX(i) : i
      expect(positions.getY(vertex)).toBeGreaterThan(0)
    }
    geo.dispose()
  }
})

test('placement rejects roof-edge and obstacle overlap and uses the selected grid', () => {
  const segment = fixtureSegment({ roofType: 'flat' })
  const panel = SolarPanelNode.parse({ rows: 1, columns: 1 })
  expect(
    resolveSolarPanelPlacement(segment, panel, 0.26, 0.74, { gridStep: 0.5 }).position.filter(
      (_, i) => i !== 1,
    ),
  ).toEqual([0.5, 0.5])
  expect(resolveSolarPanelPlacement(segment, panel, 0, 0).valid).toBe(true)
  expect(resolveSolarPanelPlacement(segment, panel, 4, 3).valid).toBe(false)
  expect(
    resolveSolarPanelPlacement(segment, panel, 0, 0, {
      obstacles: [
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ],
      ],
    }).valid,
  ).toBe(false)
})
