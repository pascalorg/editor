import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { type AnyNode, type RoofSegmentNode, useScene } from '@pascal-app/core'
import { getRoofSurfaceFaceBoundsAt } from './roof-surface'

mock.module('@pascal-app/editor', () => ({
  useOpeningGuides: {
    getState: () => ({
      clear: () => undefined,
      set: () => undefined,
    }),
  },
}))

mock.module('@pascal-app/viewer', () => ({
  Brush: class {},
  SUBTRACTION: 0,
  csgEvaluator: {
    evaluate: () => ({ geometry: { dispose: () => undefined } }),
  },
  csgGeometry: () => ({
    clone: () => ({
      addGroup: () => undefined,
      clearGroups: () => undefined,
      getIndex: () => null,
      translate: () => undefined,
    }),
  }),
  prepareBrushForCSG: () => undefined,
  useViewer: {
    getState: () => ({
      selection: {},
    }),
  },
}))

mock.module('../skylight/frame-csg', () => ({
  buildFrameGeometry: () => null,
}))

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
    pitch: (Math.atan2(2, 3) * 180) / Math.PI,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    children: [],
    ...overrides,
  }) as RoofSegmentNode

const roofItem = (
  id: string,
  position: [number, number, number],
  overrides?: Record<string, unknown>,
): AnyNode =>
  ({
    object: 'node',
    id,
    type: 'box-vent',
    parentId: 'rseg_fixture',
    visible: true,
    metadata: {},
    position,
    rotation: 0,
    width: 1,
    depth: 1,
    height: 0.2,
    style: 'box',
    ...overrides,
  }) as AnyNode

const dormerItem = (id: string, position: [number, number, number]): AnyNode =>
  roofItem(id, position, {
    type: 'dormer',
    width: 1.2,
    depth: 1.4,
    height: 0.4,
    roofType: 'gable',
    roofHeight: 0.5,
    wallSkirtHeight: 1.2,
  })

const chimneyItem = (id: string, position: [number, number, number]): AnyNode =>
  roofItem(id, position, {
    type: 'chimney',
    bodyShape: 'square',
    bodyHollowDepth: 0.6,
    bodyHollowMargin: 0.08,
    width: 0.6,
    depth: 0.6,
    heightAboveRidge: 1,
    cutoutOffset: 0,
    cornerBevel: 0,
    cap: true,
    capShape: 'flat',
    capOverhang: 0.04,
    capThickness: 0.08,
    flueCount: 1,
    flueShape: 'round',
    flueHeight: 0.3,
    flueDiameter: 0.22,
    flueSpacing: 1,
    flueWallThickness: 0.02,
    shoulderStyle: 'none',
    shoulderHeight: 0.5,
    shoulderExtent: 0.1,
    bandStyle: 'none',
    bandHeight: 0.1,
    bandExtent: 0.04,
    bandOffset: 0.4,
    cricketStyle: 'none',
    cricketLength: 0.6,
    cricketHeight: 0.4,
    cricketSide: 'front',
    panelStyle: 'none',
    panelDepth: 0.03,
    panelHeight: 0.8,
    panelOffsetTop: 0.15,
    panelMargin: 0.1,
  })

const supportedRoofSibling = (
  type: string,
  id: string,
  position: [number, number, number],
): AnyNode => {
  switch (type) {
    case 'dormer':
      return dormerItem(id, position)
    case 'chimney':
      return chimneyItem(id, position)
    case 'solar-panel':
      return roofItem(id, position, {
        type,
        columns: 2,
        rows: 1,
        panelWidth: 0.8,
        panelHeight: 1.2,
        gapX: 0.05,
        gapY: 0.05,
        mountingType: 'flush',
        tiltAngle: 15,
        frameThickness: 0.04,
        frameDepth: 0.04,
        standoffHeight: 0.1,
      })
    case 'ridge-vent':
      return roofItem(id, position, { type, length: 1.2, width: 0.25, height: 0.1 })
    case 'gutter':
      return roofItem(id, position, {
        type,
        length: 1.2,
        size: 0.15,
        thickness: 0.006,
        profile: 'k-style',
        endCapLeft: true,
        endCapRight: true,
        hangerStyle: 'strap',
        hangerSpacing: 0.6,
        outlets: [],
      })
    case 'turbine-vent':
      return roofItem(id, position, { type, diameter: 0.5, height: 0.7 })
    case 'skylight':
      return roofItem(id, position, {
        type,
        width: 0.8,
        height: 1.1,
        frameDepth: 0.05,
        frameThickness: 0.08,
        glassThickness: 0.02,
        curb: false,
        curbHeight: 0,
      })
    case 'cupola':
      return roofItem(id, position, { type, width: 0.8, depth: 0.8, height: 1 })
    case 'eyebrow-vent':
      return roofItem(id, position, { type, width: 0.8, depth: 0.4, height: 0.25 })
    default:
      return roofItem(id, position, { type })
  }
}

beforeEach(() => {
  useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
})

describe('roofSiblingSpacingGuides', () => {
  test('measures to the nearest aligned roof item bounding-box side', async () => {
    const { roofFaceKey, roofGuideBounds, roofSiblingSpacingGuides } = await import(
      './roof-surface-placement-guides'
    )
    const segment = fixtureSegment({ children: ['near', 'far'] as never })
    useScene.setState({
      nodes: {
        near: roofItem('near', [2, 0, 1]),
        far: roofItem('far', [4, 0, 1]),
      },
    } as never)

    const faceKey = roofFaceKey(getRoofSurfaceFaceBoundsAt(segment, 0, 1).polygon)
    const guides = roofSiblingSpacingGuides({
      segment,
      movingBounds: roofGuideBounds([0, 0, 1], { width: 1, depth: 1 }),
      faceKey,
      dimension: (id, from, to) => ({
        id,
        from,
        to,
        value: Math.hypot(to[0] - from[0], to[1] - from[1]),
      }),
    })

    expect(guides).toEqual([
      {
        id: 'roof-sibling:right',
        from: [0.5, 1],
        to: [1.5, 1],
        value: 1,
      },
    ])
  })

  test('marks the roof-edge side as blocked when an aligned item is between them', async () => {
    const { roofFaceKey, roofGuideBounds, roofSiblingSpacing } = await import(
      './roof-surface-placement-guides'
    )
    const segment = fixtureSegment({ children: ['left'] as never })
    useScene.setState({
      nodes: {
        left: roofItem('left', [-3, 0, 1]),
      },
    } as never)

    const faceKey = roofFaceKey(getRoofSurfaceFaceBoundsAt(segment, 0, 1).polygon)
    const spacing = roofSiblingSpacing({
      segment,
      movingBounds: roofGuideBounds([0, 0, 1], { width: 1, depth: 1 }),
      faceKey,
      dimension: (id, from, to) => ({ id, from, to }),
    })

    expect(spacing.blockedSides).toEqual({
      left: true,
      right: false,
      bottom: false,
      top: false,
    })
    expect(spacing.guides).toEqual([
      {
        id: 'roof-sibling:left',
        from: [-2.5, 1],
        to: [-0.5, 1],
      },
    ])
  })

  test('measures to a roof item whose bounding box crosses the guide lane', async () => {
    const { roofFaceKey, roofGuideBounds, roofSiblingSpacingGuides } = await import(
      './roof-surface-placement-guides'
    )
    const segment = fixtureSegment({ children: ['offset'] as never })
    useScene.setState({
      nodes: {
        offset: roofItem('offset', [2, 0, 1.2]),
      },
    } as never)

    const faceKey = roofFaceKey(getRoofSurfaceFaceBoundsAt(segment, 0, 1).polygon)
    const guides = roofSiblingSpacingGuides({
      segment,
      movingBounds: roofGuideBounds([0, 0, 1], { width: 1, depth: 1 }),
      faceKey,
      dimension: (id, from, to) => ({ id, from, to }),
    })

    expect(guides).toEqual([
      {
        id: 'roof-sibling:right',
        from: [0.5, 1],
        to: [1.5, 1],
      },
    ])
  })

  test('adds a red alignment guide when roof item centers align on a lane', async () => {
    const { roofFaceKey, roofGuideBounds, roofSiblingSpacing } = await import(
      './roof-surface-placement-guides'
    )
    const segment = fixtureSegment({ children: ['aligned'] as never })
    useScene.setState({
      nodes: {
        aligned: roofItem('aligned', [2, 0, 1]),
      },
    } as never)

    const faceKey = roofFaceKey(getRoofSurfaceFaceBoundsAt(segment, 0, 1).polygon)
    const spacing = roofSiblingSpacing({
      segment,
      movingBounds: roofGuideBounds([0, 0, 1], { width: 1, depth: 1 }),
      faceKey,
      dimension: (id, from, to) => ({ kind: 'dimension', id, from, to }),
      alignLine: (id, from, to) => ({ kind: 'align-line', id, from, to }),
    })

    expect(spacing.guides).toContainEqual({
      kind: 'align-line',
      id: 'roof-align:z',
      from: [-0.5, 1],
      to: [2.5, 1],
    })
  })

  test('adds an alignment guide when roof item bounding-box edges align', async () => {
    const { roofFaceKey, roofGuideBounds, roofSiblingSpacing } = await import(
      './roof-surface-placement-guides'
    )
    const segment = fixtureSegment({ children: ['aligned'] as never })
    useScene.setState({
      nodes: {
        aligned: roofItem('aligned', [2, 0, 1]),
      },
    } as never)

    const faceKey = roofFaceKey(getRoofSurfaceFaceBoundsAt(segment, 0, 1).polygon)
    const spacing = roofSiblingSpacing({
      segment,
      movingBounds: roofGuideBounds([0, 0, 2], { width: 1, depth: 1 }),
      faceKey,
      dimension: (id, from, to) => ({ kind: 'dimension', id, from, to }),
      alignLine: (id, from, to) => ({ kind: 'align-line', id, from, to }),
    })

    expect(spacing.guides).toContainEqual({
      kind: 'align-line',
      id: 'roof-align:z',
      from: [-0.5, 1.5],
      to: [2.5, 1.5],
    })
  })

  test('snaps a dragged roof item onto a nearby sibling bounding-box alignment', async () => {
    const { snapRoofSurfaceNodeTarget } = await import('./roof-surface-placement-guides')
    const segment = fixtureSegment({ children: ['aligned'] as never })
    useScene.setState({
      nodes: {
        aligned: roofItem('aligned', [2, 0, 1]),
      },
    } as never)

    const snapped = snapRoofSurfaceNodeTarget({
      target: {
        segment,
        localX: 0,
        localY: 0,
        localZ: 2.04,
        hit: {} as never,
      },
      node: roofItem('moving', [0, 0, 0]),
    })

    expect(snapped.localZ).toBeCloseTo(2)
  })

  test('adds equal-spacing badges for a roof item between evenly spaced siblings', async () => {
    const { roofFaceKey, roofGuideBounds, roofSiblingSpacing } = await import(
      './roof-surface-placement-guides'
    )
    const segment = fixtureSegment({ children: ['left', 'right'] as never })
    useScene.setState({
      nodes: {
        left: roofItem('left', [-2, 0, 1]),
        right: roofItem('right', [2, 0, 1]),
      },
    } as never)

    const faceKey = roofFaceKey(getRoofSurfaceFaceBoundsAt(segment, 0, 1).polygon)
    const spacing = roofSiblingSpacing({
      segment,
      movingBounds: roofGuideBounds([0, 0, 1], { width: 1, depth: 1 }),
      faceKey,
      dimension: (id, from, to) => ({ kind: 'dimension', id, from, to }),
      badge: (id, at, value) => ({ kind: 'badge', id, at, value }),
    })

    expect(spacing.guides).toContainEqual({
      kind: 'badge',
      id: 'roof-spacing:x:0',
      at: [-1, 1],
      value: 1,
    })
    expect(spacing.guides).toContainEqual({
      kind: 'badge',
      id: 'roof-spacing:x:1',
      at: [1, 1],
      value: 1,
    })
  })

  test('adds equal-spacing badges for mixed roof item types on the same lane', async () => {
    const { roofFaceKey, roofGuideBounds, roofSiblingSpacing, roofSurfaceFootprintFromNode } =
      await import('./roof-surface-placement-guides')
    const segment = fixtureSegment({ children: ['chimney', 'vent'] as never })
    const chimney = chimneyItem('chimney', [0, 0, 1])
    const vent = roofItem('vent', [0, 0, 1], { type: 'turbine-vent', diameter: 0.6, height: 0.7 })
    const movingFootprint = { width: 1.4, depth: 1 }
    const movingBounds = roofGuideBounds([0, 0, 1], movingFootprint)
    const gap = 0.8
    const chimneyWidth = roofSurfaceFootprintFromNode(chimney, { segment }).width
    const ventWidth = roofSurfaceFootprintFromNode(vent, { segment }).width
    useScene.setState({
      nodes: {
        chimney: { ...chimney, position: [movingBounds.minX - gap - chimneyWidth / 2, 0, 1] },
        vent: { ...vent, position: [movingBounds.maxX + gap + ventWidth / 2, 0, 1] },
      },
    } as never)

    const faceKey = roofFaceKey(getRoofSurfaceFaceBoundsAt(segment, 0, 1).polygon)
    const spacing = roofSiblingSpacing({
      segment,
      movingBounds,
      faceKey,
      dimension: (id, from, to) => ({ kind: 'dimension', id, from, to }),
      badge: (id, at, value) => ({ kind: 'badge', id, at, value }),
    })

    expect(spacing.guides).toContainEqual({
      kind: 'badge',
      id: 'roof-spacing:x:0',
      at: [movingBounds.minX - gap / 2, 1],
      value: 0.8,
    })
    expect(spacing.guides).toContainEqual({
      kind: 'badge',
      id: 'roof-spacing:x:1',
      at: [movingBounds.maxX + gap / 2, 1],
      value: 0.8,
    })
  })

  test('does not measure to a roof item outside the guide lane bounding box', async () => {
    const { roofFaceKey, roofGuideBounds, roofSiblingSpacingGuides } = await import(
      './roof-surface-placement-guides'
    )
    const segment = fixtureSegment({ children: ['offset'] as never })
    useScene.setState({
      nodes: {
        offset: roofItem('offset', [2, 0, 2]),
      },
    } as never)

    const faceKey = roofFaceKey(getRoofSurfaceFaceBoundsAt(segment, 0, 1).polygon)
    const guides = roofSiblingSpacingGuides({
      segment,
      movingBounds: roofGuideBounds([0, 0, 1], { width: 1, depth: 1 }),
      faceKey,
      dimension: (id, from, to) => ({ id, from, to }),
    })

    expect(guides).toEqual([])
  })

  test.each([
    ['chimney moving next to dormer', dormerItem('sibling', [2, 0, 1])],
    ['dormer moving next to chimney', chimneyItem('sibling', [2, 0, 1])],
    ['dormer moving next to dormer', dormerItem('sibling', [2, 0, 1])],
    ['dormer moving next to vent', roofItem('sibling', [2, 0, 1])],
  ])('measures mixed roof item spacing: %s', async (_label, sibling) => {
    const { roofFaceKey, roofGuideBounds, roofSiblingSpacingGuides } = await import(
      './roof-surface-placement-guides'
    )
    const segment = fixtureSegment({ children: ['sibling'] as never })
    useScene.setState({
      nodes: {
        sibling,
      },
    } as never)

    const faceKey = roofFaceKey(getRoofSurfaceFaceBoundsAt(segment, 0, 1).polygon)
    const guides = roofSiblingSpacingGuides({
      segment,
      movingBounds: roofGuideBounds([0, 0, 1], { width: 1, depth: 1 }),
      faceKey,
      dimension: (id, from, to) => ({ id, from, to }),
    })

    expect(guides).toHaveLength(1)
    expect(guides[0]?.id).toBe('roof-sibling:right')
  })

  test.each([
    'box-vent',
    'turbine-vent',
    'eyebrow-vent',
    'solar-panel',
    'skylight',
    'cupola',
    'chimney',
    'ridge-vent',
    'gutter',
    'dormer',
  ])('recognizes %s as a roof spacing sibling', async (type) => {
    const { roofFaceKey, roofGuideBounds, roofSiblingSpacingGuides } = await import(
      './roof-surface-placement-guides'
    )
    const sibling = supportedRoofSibling(type, 'sibling', [2, 0, 1])
    const segment = fixtureSegment({ children: ['sibling'] as never })
    useScene.setState({
      nodes: {
        sibling,
      },
    } as never)

    const faceKey = roofFaceKey(getRoofSurfaceFaceBoundsAt(segment, 0, 1).polygon)
    const guides = roofSiblingSpacingGuides({
      segment,
      movingBounds: roofGuideBounds([0, 0, 1], { width: 1, depth: 1 }),
      faceKey,
      dimension: (id, from, to) => ({ id, from, to }),
    })

    expect(guides).toHaveLength(1)
    expect(guides[0]?.id).toBe('roof-sibling:right')
  })
})
