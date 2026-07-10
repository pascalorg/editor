import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, type GridEvent, useScene } from '@pascal-app/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DEFAULT_MEASUREMENT_SNAP_SETTINGS,
  type MeasurementSnapKind,
  useMeasurementTool,
} from '../../store/use-measurement-tool'
import {
  getFloorplanAngleMeasurementLayout,
  getFloorplanEndpointHandleMetrics,
  getFloorplanMeasurementColor,
  handleFloorplanMeasurementGridClick,
  handleFloorplanMeasurementGridMove,
  handleFloorplanMeasurementNodeClick2D,
  previewFloorplanMeasurementNode2D,
  staggerFloorplanMeasurementLabels,
} from './floorplan-measurement-tool-layer'
import {
  FloorplanMeasurementsLayer,
  getFloorplanMeasurementPillMetrics,
} from './renderers/floorplan-measurements-layer'

beforeAll(() => {
  class TestCanvas {}
  globalThis.HTMLCanvasElement = TestCanvas as never
})

beforeEach(() => {
  useScene.getState().clearScene()
  useMeasurementTool.getState().clear()
  useMeasurementTool.getState().setMode('distance')
  resetSnapSettings()
})

afterEach(() => {
  useScene.getState().clearScene()
  useMeasurementTool.getState().clear()
  useMeasurementTool.getState().setMode('distance')
  resetSnapSettings()
})

function resetSnapSettings() {
  for (const [kind, enabled] of Object.entries(DEFAULT_MEASUREMENT_SNAP_SETTINGS)) {
    useMeasurementTool.getState().setSnapKindEnabled(kind as MeasurementSnapKind, enabled)
  }
}

test('builds floorplan angle measurement as a wedge with a pill anchor', () => {
  const layout = getFloorplanAngleMeasurementLayout({
    first: [1, 0, 0],
    id: 'angle-layout',
    second: [0, 0, 1],
    vertex: [0, 0, 0],
    view: '2d',
  })

  expect(layout).not.toBeNull()
  expect(layout?.wedgePath.startsWith('M 0 0 L 0.35 0')).toBe(true)
  expect(layout?.arcPath.startsWith('M 0.35 0')).toBe(true)
  expect(layout?.arcRadials).toHaveLength(2)
  expect(layout?.arcRadials[0]).toEqual({ x1: 0, x2: 0.35, y1: 0, y2: 0 })
  expect(layout?.arcRadials[1]?.x1).toBe(0)
  expect(layout?.arcRadials[1]?.x2).toBeCloseTo(0)
  expect(layout?.arcRadials[1]?.y1).toBe(0)
  expect(layout?.arcRadials[1]?.y2).toBeCloseTo(0.35)
  expect(layout?.label.x).toBeCloseTo(0.403)
  expect(layout?.label.y).toBeCloseTo(0.403)
})

function gridEvent(
  localPosition: [number, number, number],
  options: { shiftKey?: boolean; target?: unknown } = {},
): GridEvent {
  return {
    position: localPosition,
    localPosition,
    nativeEvent: {
      shiftKey: options.shiftKey ?? false,
      target: options.target ?? {},
    } as never,
  }
}

function zoneNode(): AnyNode {
  return {
    id: 'zone_measurement_2d',
    type: 'zone',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  } as never
}

function slabWithHoleNode(): AnyNode {
  return {
    id: 'slab_measurement_hole_2d',
    type: 'slab',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    elevation: 0,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    holes: [
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
      ],
    ],
  } as never
}

function siteNode(): AnyNode {
  return {
    id: 'site_measurement_2d',
    type: 'site',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    polygon: {
      type: 'polygon',
      points: [
        [-2, -1],
        [2, -1],
        [2, 1],
        [-2, 1],
      ],
    },
  } as never
}

function wallNode(): AnyNode {
  return {
    id: 'wall_measurement_2d',
    type: 'wall',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [4, 0],
  } as never
}

function curvedWallNode(): AnyNode {
  return {
    ...wallNode(),
    id: 'wall_measurement_curved_2d',
    curveOffset: 1,
  } as never
}

function splineFenceNode(): AnyNode {
  return {
    id: 'fence_measurement_spline_2d',
    type: 'fence',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [4, 0],
    path: [
      [0, 0],
      [2, 1],
      [4, 0],
    ],
  } as never
}

function windowNode(): AnyNode {
  return {
    id: 'window_measurement_2d',
    type: 'window',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    wallId: 'wall_measurement_2d',
    position: [2, 1, 0],
    width: 1,
    height: 1,
  } as never
}

function shelfNode(): AnyNode {
  return {
    id: 'shelf_measurement_2d',
    type: 'shelf',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [2, 0, 3],
    rotation: [0, 0, 0],
    width: 2,
    depth: 0.6,
    height: 1.2,
  } as never
}

function looseSkylightNode(): AnyNode {
  return {
    id: 'loose_skylight_measurement_2d',
    type: 'skylight',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [5, 0, 6],
    rotation: 0,
    width: 0.9,
    height: 1.2,
  } as never
}

function solarPanelNode(): AnyNode {
  return {
    id: 'solar_panel_measurement_2d',
    type: 'solar-panel',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [8, 0, 4],
    rotation: 0,
    rows: 2,
    columns: 3,
    panelWidth: 1,
    panelHeight: 1.65,
    gapX: 0.02,
    gapY: 0.02,
  } as never
}

function crossingWallNode(): AnyNode {
  return {
    id: 'wall_measurement_crossing_2d',
    type: 'wall',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [2, -2],
    end: [2, 2],
  } as never
}

function stairNode(): AnyNode {
  return {
    id: 'stair_measurement_2d',
    type: 'stair',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['stair_segment_measurement_2d'],
    position: [0, 0, 0],
    rotation: 0,
    stairType: 'straight',
    width: 1,
  } as never
}

function stairSegmentNode(): AnyNode {
  return {
    id: 'stair_segment_measurement_2d',
    type: 'stair-segment',
    object: 'node',
    parentId: 'stair_measurement_2d',
    visible: true,
    metadata: {},
    children: [],
    width: 1,
    length: 3,
    height: 2.5,
    attachmentSide: 'front',
  } as never
}

function ductSegmentNode(): AnyNode {
  return {
    id: 'duct_segment_measurement_2d',
    type: 'duct-segment',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    path: [
      [0, 2.4, 0],
      [2, 2.4, 0],
      [2, 2.4, 3],
    ],
  } as never
}

function roofNode(overrides: Partial<AnyNode> = {}): AnyNode {
  return {
    id: 'roof_measurement_2d',
    type: 'roof',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['roof_segment_measurement_2d'],
    position: [0, 0, 0],
    rotation: 0,
    ...overrides,
  } as never
}

function roofSegmentNode(overrides: Partial<AnyNode> = {}): AnyNode {
  return {
    id: 'roof_segment_measurement_2d',
    type: 'roof-segment',
    object: 'node',
    parentId: 'roof_measurement_2d',
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: 0,
    roofType: 'gable',
    width: 4,
    depth: 2,
    pitch: 40,
    wallHeight: 0.5,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    gambrelLowerWidthRatio: 0.5,
    mansardSteepWidthRatio: 0.15,
    dutchHipWidthRatio: 0.25,
    dutchWaistLengthRatio: 0.98,
    ...overrides,
  } as never
}

function skylightNode(): AnyNode {
  return {
    id: 'skylight_measurement_2d',
    type: 'skylight',
    object: 'node',
    parentId: 'roof_segment_measurement_2d',
    visible: true,
    metadata: {},
    children: [],
    roofSegmentId: 'roof_segment_measurement_2d',
    position: [0, 0, 0],
    rotation: 0,
    width: 2,
    height: 1,
  } as never
}

function seedScene(nodes: AnyNode[]) {
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: nodes.map((node) => node.id as AnyNodeId),
    dirtyNodes: new Set(),
    collections: {},
  } as never)
}

function measurementOverlay(id: string, labelX: number, labelY: number) {
  return {
    id,
    label: id,
    labelX,
    labelY,
    labelAngleDeg: 0,
    dimensionLineStart: { x1: 0, y1: 0, x2: 1, y2: 0 },
    dimensionLineEnd: { x1: 1, y1: 0, x2: 2, y2: 0 },
    extensionStart: { x1: 0, y1: 0, x2: 0, y2: 0 },
    extensionEnd: { x1: 2, y1: 0, x2: 2, y2: 0 },
  }
}

describe('floorplan measurement grid handlers', () => {
  test('uses violet as the floorplan measurement color', () => {
    expect(getFloorplanMeasurementColor()).toBe('#8b5cf6')
  })

  test('renders linear measurement labels as zoom-stable pills', () => {
    const markup = renderToStaticMarkup(
      createElement(
        'svg',
        null,
        createElement(FloorplanMeasurementsLayer, {
          className: 'floorplan-measurement-tool',
          measurements: [
            {
              ...measurementOverlay('12.34 m', 1, 1),
              isSelected: true,
              label: '12.34 m',
            },
          ],
          palette: {
            measurementStroke: 'rgb(14, 165, 233)',
          },
          sceneRotationDeg: 0,
        }),
      ),
    )

    expect(markup).toContain('<foreignObject')
    expect(markup).toContain('rounded-full border border-border/60 bg-background/90')
    expect(markup).toContain('px-4 py-1.5 text-xs tabular-nums')
    expect(markup).toContain('font-medium text-foreground')
    expect(markup).toContain('transform:scale(0.01)')
    expect(markup).toContain('transform="translate(-0.39520000000000005 -0.14)"')
    expect(markup).toContain('x="0" y="0"')
    expect(markup).toContain('12.34 m')
  })

  test('shares pill metrics across 2D measurement label types', () => {
    const metrics = getFloorplanMeasurementPillMetrics('12.34 m', 0.01)

    expect(metrics.fontSize).toBe(0.12)
    expect(metrics.height).toBeCloseTo(0.28)
    expect(metrics.pixelHeight).toBe(28)
    expect(metrics.pixelWidth).toBeCloseTo(79.04)
    expect(metrics.radius).toBeCloseTo(0.14)
    expect(metrics.strokeWidth).toBeCloseTo(0.01)
    expect(metrics.width).toBeCloseTo(0.7904)
  })

  test('keeps shared HTML pill dimensions stable across floorplan zoom', () => {
    const base = getFloorplanMeasurementPillMetrics('12.34 m', 0.01)
    const zoomed = getFloorplanMeasurementPillMetrics('12.34 m', 0.05)

    expect(zoomed.pixelHeight).toBe(base.pixelHeight)
    expect(zoomed.pixelWidth).toBe(base.pixelWidth)
    expect(zoomed.height / 0.05).toBeCloseTo(base.height / 0.01)
    expect(zoomed.width / 0.05).toBeCloseTo(base.width / 0.01)
  })

  test('keeps endpoint handle hit and visible radii tied to screen zoom', () => {
    expect(getFloorplanEndpointHandleMetrics(0.01, false)).toEqual({
      handleRadius: 0.055,
      hitRadius: 0.16,
    })
    expect(getFloorplanEndpointHandleMetrics(0.01, true)).toEqual({
      handleRadius: 0.07,
      hitRadius: 0.16,
    })
  })

  test('staggers overlapping 2D measurement labels', () => {
    const overlays = staggerFloorplanMeasurementLabels([
      measurementOverlay('a', 1, 1),
      measurementOverlay('b', 1.02, 1.01),
      measurementOverlay('c', 4, 4),
    ])

    expect(overlays[0]?.labelX).toBe(1)
    expect(overlays[0]?.labelY).toBe(1)
    expect(overlays[1]?.labelX).toBeCloseTo(1.02)
    expect(overlays[1]?.labelY).toBeGreaterThan(1.01)
    expect(overlays[2]?.labelX).toBe(4)
    expect(overlays[2]?.labelY).toBe(4)
  })

  test('commits a 2D point-to-point distance from two grid clicks', () => {
    handleFloorplanMeasurementGridClick(gridEvent([0, 0, 0]))
    handleFloorplanMeasurementGridMove(gridEvent([3, 0, 4]))
    handleFloorplanMeasurementGridClick(gridEvent([3, 0, 4]))

    const state = useMeasurementTool.getState()
    expect(state.draft).toBeNull()
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [3, 0, 4],
      view: '2d',
    })
    expect(state.selectedId).toBe(state.segments[0]?.id ?? null)
  })

  test('updates the draft endpoint while moving the pointer', () => {
    handleFloorplanMeasurementGridClick(gridEvent([0, 0, 0]))
    handleFloorplanMeasurementGridMove(gridEvent([2, 0, 0]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0, 0, 0],
      end: [2, 0, 0],
      view: '2d',
    })
  })

  test('drags a saved 2D measurement endpoint through snapping', () => {
    seedScene([wallNode()])
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('2d', [1, 0, 1], [2, 0, 1], 1)
    const segmentId = useMeasurementTool.getState().segments[0]!.id

    measurement.setSnapKindEnabled('guide', false)
    measurement.startSegmentEndpointDrag(segmentId, 'end')
    handleFloorplanMeasurementGridMove(gridEvent([3.9, 0, 0.08]))
    handleFloorplanMeasurementGridClick(gridEvent([3.9, 0, 0.08]))

    const segment = useMeasurementTool.getState().segments[0]
    expect(segment).toMatchObject({
      start: [1, 0, 1],
      measuredDistanceMeters: undefined,
      view: '2d',
    })
    expect(segment?.end[0]).toBeCloseTo(4)
    expect(segment?.end[1]).toBeCloseTo(0)
    expect(segment?.end[2]).toBeCloseTo(0)
    expect(useMeasurementTool.getState().draggingSegmentEndpoint).toBeNull()
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'endpoint',
      point: [4, 0, 0],
      view: '2d',
    })
  })

  test('shift locks the 2D draft endpoint to horizontal or vertical while drawing', () => {
    handleFloorplanMeasurementGridClick(gridEvent([0, 0, 0]))
    handleFloorplanMeasurementGridMove(gridEvent([1, 0, 4], { shiftKey: true }))
    handleFloorplanMeasurementGridClick(gridEvent([1, 0, 4], { shiftKey: true }))

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [0, 0, 4],
      view: '2d',
    })
  })

  test('snaps the first 2D placement point to nearby wall anchors', () => {
    seedScene([wallNode()])

    handleFloorplanMeasurementGridClick(gridEvent([0.08, 0, 0.06]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0, 0, 0],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'endpoint',
      label: 'Endpoint',
      point: [0, 0, 0],
      view: '2d',
    })
  })

  test('does not snap 2D placement to endpoints when endpoint snaps are disabled', () => {
    seedScene([wallNode()])
    useMeasurementTool.getState().setSnapKindEnabled('endpoint', false)
    useMeasurementTool.getState().setSnapKindEnabled('edge', false)
    useMeasurementTool.getState().setSnapKindEnabled('grid', false)

    handleFloorplanMeasurementGridClick(gridEvent([0.08, 0, 0.06]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0.08, 0, 0.06],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget?.kind).not.toBe('endpoint')
  })

  test('snaps the committed 2D endpoint to nearby wall anchors', () => {
    seedScene([wallNode()])

    handleFloorplanMeasurementGridClick(gridEvent([0.08, 0, 0.06]))
    handleFloorplanMeasurementGridMove(gridEvent([3.9, 0, 0.08]))
    handleFloorplanMeasurementGridClick(gridEvent([3.9, 0, 0.08]))

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [4, 0, 0],
      view: '2d',
    })
  })

  test('tracks 2D snap target while moving before first placement', () => {
    seedScene([wallNode()])

    handleFloorplanMeasurementGridMove(gridEvent([2.04, 0, 0.04]))

    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      label: 'Midpoint',
      point: [2, 0, 0],
      view: '2d',
    })
  })

  test('snaps 2D placement points to wall edge projections', () => {
    seedScene([wallNode()])

    handleFloorplanMeasurementGridClick(gridEvent([1.25, 0, 0.08]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.25, 0, 0],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Wall edge',
      point: [1.25, 0, 0],
      view: '2d',
    })
  })

  test('snaps 2D placement points to sampled curved wall edges', () => {
    seedScene([curvedWallNode()])

    handleFloorplanMeasurementGridClick(gridEvent([0.8819660112501051, 0, -0.7360679774997898]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0.8819660112501051, 0, -0.7360679774997898],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Wall edge',
      point: [0.8819660112501051, 0, -0.7360679774997898],
      view: '2d',
    })
  })

  test('snaps 2D placement points to sampled spline fence edges', () => {
    seedScene([splineFenceNode()])

    handleFloorplanMeasurementGridClick(gridEvent([0.9704915028125263, 0, 0.625]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0.9704915028125263, 0, 0.625],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Fence edge',
      point: [0.9704915028125263, 0, 0.625],
      view: '2d',
    })
  })

  test('snaps 2D placement points to hosted opening endpoints', () => {
    seedScene([wallNode(), windowNode()])

    handleFloorplanMeasurementGridClick(gridEvent([1.52, 0, 0.03]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.5, 0, 0],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'endpoint',
      label: 'Opening endpoint',
      point: [1.5, 0, 0],
      view: '2d',
    })
  })

  test('snaps 2D placement points to hosted opening centers', () => {
    seedScene([wallNode(), windowNode()])

    handleFloorplanMeasurementGridClick(gridEvent([2.03, 0, 0.04]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [2, 0, 0],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'center',
      label: 'Opening center',
      point: [2, 0, 0],
      view: '2d',
    })
  })

  test('snaps 2D placement points to hosted opening edges', () => {
    seedScene([wallNode(), windowNode()])

    handleFloorplanMeasurementGridClick(gridEvent([1.75, 0, 0.08]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.75, 0, 0],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Opening edge',
      point: [1.75, 0, 0],
      view: '2d',
    })
  })

  test('snaps 2D placement points to composite stair footprint corners', () => {
    seedScene([stairNode(), stairSegmentNode()])

    handleFloorplanMeasurementGridClick(gridEvent([-0.48, 0, 2.96]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [-0.5, 0, 3],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'vertex',
      label: 'Stair corner',
      point: [-0.5, 0, 3],
      view: '2d',
    })
  })

  test('snaps 2D placement points to MEP run path edges', () => {
    seedScene([ductSegmentNode()])

    handleFloorplanMeasurementGridClick(gridEvent([2.08, 0, 1.25]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [2, 0, 1.25],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Run edge',
      point: [2, 0, 1.25],
      view: '2d',
    })
  })

  test('snaps 2D placement points to surface opening hole edges', () => {
    seedScene([slabWithHoleNode()])
    useMeasurementTool.getState().setSnapKindEnabled('midpoint', false)

    handleFloorplanMeasurementGridClick(gridEvent([1.4, 0, 1.08]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.4, 0, 1],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Surface opening edge',
      point: [1.4, 0, 1],
      view: '2d',
    })
  })

  test('snaps 2D placement points to site property lines', () => {
    seedScene([siteNode()])
    useMeasurementTool.getState().setSnapKindEnabled('midpoint', false)

    handleFloorplanMeasurementGridClick(gridEvent([0.4, 0, -1.08]))

    const draft = useMeasurementTool.getState().draft
    expect(draft?.start[0]).toBeCloseTo(0.4)
    expect(draft?.start[1]).toBeCloseTo(0)
    expect(draft?.start[2]).toBeCloseTo(-1)
    expect(draft?.view).toBe('2d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Property line edge',
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(0.4)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(-1)
  })

  test('snaps 2D placement points to roof ridge edges', () => {
    seedScene([roofNode(), roofSegmentNode()])

    handleFloorplanMeasurementGridClick(gridEvent([1.25, 0, 0.08]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.25, 0, 0],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof ridge edge',
      point: [1.25, 0, 0],
      view: '2d',
    })
  })

  test('snaps 2D placement points to roof eave corners', () => {
    seedScene([roofNode(), roofSegmentNode()])

    handleFloorplanMeasurementGridClick(gridEvent([-2.03, 0, -1.04]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [-2, 0, -1],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'vertex',
      label: 'Roof eave corner',
      point: [-2, 0, -1],
      view: '2d',
    })
  })

  test('snaps 2D placement points to rotated roof ridge edges', () => {
    seedScene([roofNode(), roofSegmentNode({ rotation: Math.PI / 2 } as never)])

    handleFloorplanMeasurementGridClick(gridEvent([0.08, 0, -1.25]))

    const draft = useMeasurementTool.getState().draft
    expect(draft?.start[0]).toBeCloseTo(0)
    expect(draft?.start[1]).toBeCloseTo(0)
    expect(draft?.start[2]).toBeCloseTo(-1.25)
    expect(draft?.view).toBe('2d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof ridge edge',
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(0)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(-1.25)
  })

  test('snaps 2D placement points to roof accessory edges', () => {
    seedScene([
      roofNode({ position: [10, 0, 20], rotation: Math.PI / 2 } as never),
      roofSegmentNode({ position: [2, 0, 0] } as never),
      skylightNode(),
    ])
    useMeasurementTool.getState().setSnapKindEnabled('midpoint', false)

    handleFloorplanMeasurementGridClick(gridEvent([10.58, 0, 18.2]))

    const draft = useMeasurementTool.getState().draft
    expect(draft?.start[0]).toBeCloseTo(10.5)
    expect(draft?.start[1]).toBeCloseTo(0)
    expect(draft?.start[2]).toBeCloseTo(18.2)
    expect(draft?.view).toBe('2d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Skylight edge',
      view: '2d',
    })
  })

  test('snaps 2D placement points to hip roof edges', () => {
    seedScene([roofNode(), roofSegmentNode({ roofType: 'hip' } as never)])

    handleFloorplanMeasurementGridClick(gridEvent([-1.2, 0, 0.2]))

    const draft = useMeasurementTool.getState().draft
    expect(draft?.start[0]).toBeCloseTo(-1.2)
    expect(draft?.start[1]).toBeCloseTo(0)
    expect(draft?.start[2]).toBeCloseTo(0.2)
    expect(draft?.view).toBe('2d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof hip edge',
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(-1.2)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(0.2)
  })

  test('snaps 2D placement points to mansard roof break edges', () => {
    seedScene([roofNode(), roofSegmentNode({ roofType: 'mansard' } as never)])

    handleFloorplanMeasurementGridClick(gridEvent([0.6, 0, 0.7]))

    const draft = useMeasurementTool.getState().draft
    expect(draft?.start[0]).toBeCloseTo(0.6)
    expect(draft?.start[1]).toBeCloseTo(0)
    expect(draft?.start[2]).toBeCloseTo(0.7)
    expect(draft?.view).toBe('2d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof break edge',
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(0.6)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(0.7)
  })

  test('snaps 2D placement points to dutch roof ridge and break edges', () => {
    seedScene([roofNode(), roofSegmentNode({ roofType: 'dutch' } as never)])

    handleFloorplanMeasurementGridClick(gridEvent([0.4, 0, 0.08]))

    const ridgeDraft = useMeasurementTool.getState().draft
    expect(ridgeDraft?.start[0]).toBeCloseTo(0.4)
    expect(ridgeDraft?.start[1]).toBeCloseTo(0)
    expect(ridgeDraft?.start[2]).toBeCloseTo(0)
    expect(ridgeDraft?.view).toBe('2d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof ridge edge',
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(0.4)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(0)

    useMeasurementTool.getState().clear()
    useMeasurementTool.getState().setMode('distance')

    handleFloorplanMeasurementGridClick(gridEvent([0.4, 0, 0.5]))

    const breakDraft = useMeasurementTool.getState().draft
    expect(breakDraft?.start[0]).toBeCloseTo(0.4)
    expect(breakDraft?.start[1]).toBeCloseTo(0)
    expect(breakDraft?.start[2]).toBeCloseTo(0.5)
    expect(breakDraft?.view).toBe('2d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof break edge',
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(0.4)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(0.5)
  })

  test('prefers 2D endpoints over closer edge projections in crowded snaps', () => {
    seedScene([wallNode()])

    handleFloorplanMeasurementGridClick(gridEvent([0.12, 0, 0.04]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0, 0, 0],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'endpoint',
      label: 'Endpoint',
      point: [0, 0, 0],
      view: '2d',
    })
  })

  test('prefers 2D wall intersections when segments cross nearby', () => {
    seedScene([wallNode(), crossingWallNode()])

    handleFloorplanMeasurementGridClick(gridEvent([2.03, 0, 0.04]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [2, 0, 0],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'intersection',
      label: 'Intersection',
      point: [2, 0, 0],
      view: '2d',
    })
  })

  test('falls back to 2D grid snapping when no object target is nearby', () => {
    handleFloorplanMeasurementGridClick(gridEvent([1.04, 0, 1.96]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1, 0, 2],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'grid',
      label: 'Grid',
      point: [1, 0, 2],
      view: '2d',
    })
  })

  test('does not snap 2D points to anchors outside the snap radius', () => {
    seedScene([wallNode()])

    handleFloorplanMeasurementGridClick(gridEvent([1.04, 0, 1.96]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1, 0, 2],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      label: 'Grid',
      point: [1, 0, 2],
      view: '2d',
    })
  })

  test('snaps 2D points to saved measurement midpoints', () => {
    useMeasurementTool.getState().addSegment('2d', [0, 0, 0], [3, 0, 0])

    handleFloorplanMeasurementGridClick(gridEvent([1.52, 0, 0.04]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.5, 0, 0],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'measurement',
      label: 'Measurement midpoint',
      point: [1.5, 0, 0],
      view: '2d',
    })
  })

  test('constrains 2D distance endpoints parallel to a nearby host edge', () => {
    seedScene([wallNode()])

    handleFloorplanMeasurementGridClick(gridEvent([0.08, 0, 0.06]))
    handleFloorplanMeasurementGridMove(gridEvent([2, 0, 0.08]))
    handleFloorplanMeasurementGridClick(gridEvent([2, 0, 0.08]))

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [2, 0, 0],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      guideLine: {
        end: [2, 0, 0],
        start: [-2, 0, 0],
      },
      kind: 'guide',
      label: 'Parallel',
      point: [2, 0, 0],
      view: '2d',
    })
  })

  test('constrains 2D distance endpoints perpendicular to a nearby host edge', () => {
    seedScene([wallNode()])

    handleFloorplanMeasurementGridClick(gridEvent([0.08, 0, 0.06]))
    handleFloorplanMeasurementGridMove(gridEvent([0.08, 0, 2]))
    handleFloorplanMeasurementGridClick(gridEvent([0.08, 0, 2]))

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [0, 0, 2],
      view: '2d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      label: 'Perpendicular',
      point: [0, 0, 2],
      view: '2d',
    })
  })

  test('snaps 2D angle points to nearby wall anchors', () => {
    seedScene([wallNode()])
    useMeasurementTool.getState().setMode('angle')

    handleFloorplanMeasurementGridClick(gridEvent([0.08, 0, 0.06]))
    handleFloorplanMeasurementGridClick(gridEvent([2.06, 0, 0.04]))
    handleFloorplanMeasurementGridClick(gridEvent([3.92, 0, 0.05]))

    expect(useMeasurementTool.getState().angles[0]).toMatchObject({
      first: [0, 0, 0],
      vertex: [2, 0, 0],
      second: [4, 0, 0],
      view: '2d',
    })
  })

  test('commits a 2D angle in angle mode', () => {
    const measurement = useMeasurementTool.getState()
    measurement.setMode('angle')

    handleFloorplanMeasurementGridClick(gridEvent([1, 0, 0]))
    handleFloorplanMeasurementGridClick(gridEvent([0, 0, 0]))
    handleFloorplanMeasurementGridMove(gridEvent([0, 0, 1]))
    handleFloorplanMeasurementGridClick(gridEvent([0, 0, 1]))

    const state = useMeasurementTool.getState()
    expect(state.angleDraft).toBeNull()
    expect(state.angles).toHaveLength(1)
    expect(state.angles[0]).toMatchObject({
      first: [1, 0, 0],
      vertex: [0, 0, 0],
      second: [0, 0, 1],
      view: '2d',
    })
  })

  test('ignores events that came from the 3D canvas', () => {
    const canvasTarget = new globalThis.HTMLCanvasElement()

    handleFloorplanMeasurementGridClick(gridEvent([0, 0, 0], { target: canvasTarget }))

    expect(useMeasurementTool.getState().draft).toBeNull()
    expect(useMeasurementTool.getState().segments).toHaveLength(0)
  })

  test('adds 2D surface area in area mode', () => {
    useMeasurementTool.getState().setMode('area')

    const handled = handleFloorplanMeasurementNodeClick2D(zoneNode() as never)

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.areas).toHaveLength(1)
    expect(state.areas[0]).toMatchObject({
      areaSquareMeters: 12,
      boundaryPoints: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 3],
        [0, 0, 3],
      ],
      labelPoint: [2, 0, 1.5],
      view: '2d',
    })
    expect(state.perimeters).toHaveLength(0)
  })

  test('hovering a 2D surface previews area in area mode without saving it', () => {
    useMeasurementTool.getState().setMode('area')

    const handled = previewFloorplanMeasurementNode2D(zoneNode() as never)

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.previewArea).toMatchObject({
      areaSquareMeters: 12,
      boundaryPoints: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 3],
        [0, 0, 3],
      ],
      view: '2d',
    })
    expect(state.areas).toHaveLength(0)
  })

  test('commits a freeform 2D area polygon by clicking the first point again', () => {
    useMeasurementTool.getState().setMode('area')

    handleFloorplanMeasurementGridClick(gridEvent([0, 0, 0]))
    handleFloorplanMeasurementGridClick(gridEvent([4, 0, 0]))
    handleFloorplanMeasurementGridClick(gridEvent([4, 0, 3]))
    handleFloorplanMeasurementGridClick(gridEvent([0, 0, 0]))

    const state = useMeasurementTool.getState()
    expect(state.polygonDraft).toBeNull()
    expect(state.areas).toHaveLength(1)
    expect(state.areas[0]).toMatchObject({
      areaSquareMeters: 6,
      boundaryPoints: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 3],
      ],
      view: '2d',
    })
  })

  test('adds 2D surface perimeter in perimeter mode', () => {
    useMeasurementTool.getState().setMode('perimeter')

    const handled = handleFloorplanMeasurementNodeClick2D(zoneNode() as never)

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.perimeters).toHaveLength(1)
    expect(state.perimeters[0]).toMatchObject({
      labelPoint: [2, 0, 1.5],
      lengthMeters: 14,
      view: '2d',
    })
    expect(state.areas).toHaveLength(0)
  })

  test('hovering a 2D surface previews perimeter in perimeter mode without saving it', () => {
    useMeasurementTool.getState().setMode('perimeter')

    const handled = previewFloorplanMeasurementNode2D(zoneNode() as never)

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.previewPerimeter).toMatchObject({
      lengthMeters: 14,
      view: '2d',
    })
    expect(state.perimeters).toHaveLength(0)
  })

  test('commits a freeform 2D perimeter polygon by clicking the first point again', () => {
    useMeasurementTool.getState().setMode('perimeter')

    handleFloorplanMeasurementGridClick(gridEvent([0, 0, 0]))
    handleFloorplanMeasurementGridClick(gridEvent([4, 0, 0]))
    handleFloorplanMeasurementGridClick(gridEvent([4, 0, 3]))
    handleFloorplanMeasurementGridClick(gridEvent([0, 0, 0]))

    const state = useMeasurementTool.getState()
    expect(state.polygonDraft).toBeNull()
    expect(state.perimeters).toHaveLength(1)
    expect(state.perimeters[0]).toMatchObject({
      lengthMeters: 12,
      view: '2d',
    })
  })

  test('alt-click on a 2D surface adds perimeter only', () => {
    const handled = handleFloorplanMeasurementNodeClick2D(zoneNode() as never, {
      altKey: true,
    })

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.perimeters).toHaveLength(1)
    expect(state.areas).toHaveLength(0)
  })

  test('normal click on a 2D measurable wall leaves drawing to the grid handler', () => {
    const handled = handleFloorplanMeasurementNodeClick2D(wallNode() as never)

    expect(handled).toBe(false)
    expect(useMeasurementTool.getState().segments).toHaveLength(0)
  })

  test('hovering a 2D measurable wall previews its direct length without saving it', () => {
    const handled = previewFloorplanMeasurementNode2D(wallNode() as never)

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.previewSegment).toMatchObject({
      start: [0, 0, 0],
      end: [4, 0, 0],
      measuredDistanceMeters: 4,
      view: '2d',
    })
    expect(state.segments).toHaveLength(0)

    handleFloorplanMeasurementGridMove(gridEvent([8, 0, 0]))

    expect(useMeasurementTool.getState().previewSegment).toBeNull()
  })

  test('alt-click on a 2D measurable wall adds its length in distance mode', () => {
    const handled = handleFloorplanMeasurementNodeClick2D(wallNode() as never, {
      altKey: true,
    })

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [4, 0, 0],
      measuredDistanceMeters: 4,
      view: '2d',
    })
  })

  test('ctrl-click on a 2D measurable wall quick-adds its length without taking over drawing clicks', () => {
    const handled = handleFloorplanMeasurementNodeClick2D(wallNode() as never, {
      ctrlKey: true,
    })

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.draft).toBeNull()
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [4, 0, 0],
      measuredDistanceMeters: 4,
      view: '2d',
    })
  })

  test('alt-click on a 2D window adds its hosted opening width', () => {
    seedScene([wallNode(), windowNode()])

    const handled = handleFloorplanMeasurementNodeClick2D(windowNode() as never, { altKey: true })

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]).toMatchObject({
      start: [1.5, 0, 0],
      end: [2.5, 0, 0],
      measuredDistanceMeters: 1,
      view: '2d',
    })
  })

  test('hovering a 2D modular cabinet footprint previews its direct length', () => {
    const handled = previewFloorplanMeasurementNode2D(shelfNode() as never)

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.previewSegment).toMatchObject({
      start: [1, 0, 2.7],
      end: [3, 0, 2.7],
      measuredDistanceMeters: 2,
      view: '2d',
    })
  })

  test('hovering a 2D footprint previews the edge under the cursor', () => {
    useMeasurementTool.getState().setSnapTarget({
      kind: 'grid',
      label: 'Grid',
      point: [0, 0, 0],
      view: '2d',
    })

    const handled = previewFloorplanMeasurementNode2D(shelfNode() as never, [2, 0, 3.3])

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.previewSegment).toMatchObject({
      start: [3, 0, 3.3],
      end: [1, 0, 3.3],
      measuredDistanceMeters: 2,
      view: '2d',
    })
    expect(state.cursor).toEqual({ point: [2, 0, 3.3], view: '2d' })
    expect(state.snapTarget).toBeNull()
  })

  test('normal click after a 2D hover preview leaves drawing to the grid handler', () => {
    previewFloorplanMeasurementNode2D(shelfNode() as never, [2, 0, 3.3])

    const handled = handleFloorplanMeasurementNodeClick2D(shelfNode() as never, {
      cursorPoint: [2, 0, 3.3],
    })

    const state = useMeasurementTool.getState()
    expect(handled).toBe(false)
    expect(state.draft).toBeNull()
    expect(state.previewSegment).toMatchObject({
      start: [3, 0, 3.3],
      end: [1, 0, 3.3],
      view: '2d',
    })
    expect(state.segments).toHaveLength(0)
  })

  test('hovering a 2D skylight footprint uses width by height as direct length', () => {
    const handled = previewFloorplanMeasurementNode2D(looseSkylightNode() as never)

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.previewSegment?.measuredDistanceMeters).toBeCloseTo(1.2)
    expect(state.previewSegment?.start).toEqual([5.45, 0, 5.4])
    expect(state.previewSegment?.end).toEqual([5.45, 0, 6.6])
  })

  test('hovering a 2D solar array footprint uses its full panel grid dimensions', () => {
    const handled = previewFloorplanMeasurementNode2D(solarPanelNode() as never)

    const state = useMeasurementTool.getState()
    expect(handled).toBe(true)
    expect(state.previewSegment?.measuredDistanceMeters).toBeCloseTo(3.32)
    expect(state.previewSegment?.start[0]).toBeCloseTo(9.52)
    expect(state.previewSegment?.start[2]).toBeCloseTo(2.34)
    expect(state.previewSegment?.end[0]).toBeCloseTo(9.52)
    expect(state.previewSegment?.end[2]).toBeCloseTo(5.66)
  })

  test('deleteSelected removes the selected 2D measurement', () => {
    handleFloorplanMeasurementNodeClick2D(wallNode() as never, {
      altKey: true,
    })

    expect(useMeasurementTool.getState().segments).toHaveLength(1)
    useMeasurementTool.getState().deleteSelected()

    expect(useMeasurementTool.getState().segments).toHaveLength(0)
    expect(useMeasurementTool.getState().selectedId).toBeNull()
  })
})
