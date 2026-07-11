import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type GridEvent,
  type NodeEvent,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, Vector3 } from 'three'
import { registerMeasurementTestNodes } from '../../../lib/register-measurement-test-nodes'
import {
  DEFAULT_MEASUREMENT_SNAP_SETTINGS,
  type MeasurementPoint,
  type MeasurementSnapKind,
  useMeasurementTool,
} from '../../../store/use-measurement-tool'
import {
  getMeasurementAngleLayout3D,
  getMeasurementAnnotationColors,
  handleMeasurementGridClick3D,
  handleMeasurementGridMove3D,
  handleMeasurementNodeClick3D,
  handleMeasurementNodeMove3D,
  staggerMeasurementLabelLayouts3D,
} from './measurement-tool'

beforeAll(() => {
  class TestCanvas {}
  globalThis.HTMLCanvasElement = TestCanvas as never
  registerMeasurementTestNodes()
})

beforeEach(() => {
  useScene.getState().clearScene()
  sceneRegistry.nodes.clear()
  useMeasurementTool.getState().clear()
  useMeasurementTool.getState().setMode('distance')
  resetSnapSettings()
})

afterEach(() => {
  useScene.getState().clearScene()
  sceneRegistry.nodes.clear()
  useMeasurementTool.getState().clear()
  useMeasurementTool.getState().setMode('distance')
  resetSnapSettings()
})

function resetSnapSettings() {
  for (const [kind, enabled] of Object.entries(DEFAULT_MEASUREMENT_SNAP_SETTINGS)) {
    useMeasurementTool.getState().setSnapKindEnabled(kind as MeasurementSnapKind, enabled)
  }
}

test('builds 3D angle measurement arc layout in the measured plane', () => {
  const layout = getMeasurementAngleLayout3D({
    first: [1, 0, 0],
    id: 'angle-layout-3d',
    second: [0, 0, 1],
    vertex: [0, 0, 0],
    view: '3d',
  })

  expect(layout).not.toBeNull()
  expect(layout?.arcSegments.length).toBeGreaterThanOrEqual(8)
  expect(layout?.arcRadials).toHaveLength(2)
  expect(layout?.arcRadials[0]?.start.toArray()).toEqual([0, 0, 0])
  expect(layout?.arcRadials[0]?.end.x).toBeCloseTo(0.35)
  expect(layout?.arcRadials[0]?.end.y).toBeCloseTo(0)
  expect(layout?.arcRadials[0]?.end.z).toBeCloseTo(0)
  expect(layout?.arcRadials[1]?.start.toArray()).toEqual([0, 0, 0])
  expect(layout?.arcRadials[1]?.end.x).toBeCloseTo(0)
  expect(layout?.arcRadials[1]?.end.y).toBeCloseTo(0)
  expect(layout?.arcRadials[1]?.end.z).toBeCloseTo(0.35)
  expect(layout?.arcSegments[0]?.start.x).toBeCloseTo(0.35)
  expect(layout?.arcSegments[0]?.start.y).toBeCloseTo(0)
  expect(layout?.arcSegments[0]?.start.z).toBeCloseTo(0)
  expect(layout?.arcSegments.at(-1)?.end.x).toBeCloseTo(0)
  expect(layout?.arcSegments.at(-1)?.end.y).toBeCloseTo(0)
  expect(layout?.arcSegments.at(-1)?.end.z).toBeCloseTo(0.35)
  expect(layout?.labelPosition.x).toBeCloseTo(0.417)
  expect(layout?.labelPosition.y).toBeCloseTo(0)
  expect(layout?.labelPosition.z).toBeCloseTo(0.417)
})

function gridEvent(
  localPosition: [number, number, number],
  canvas: HTMLCanvasElement,
  options: { shiftKey?: boolean; target?: unknown } = {},
): GridEvent {
  return {
    position: localPosition,
    localPosition,
    nativeEvent: {
      shiftKey: options.shiftKey ?? false,
      target: options.target ?? canvas,
    } as never,
  }
}

function nodeEvent(
  node: AnyNode,
  position: [number, number, number],
  options: {
    altKey?: boolean
    ctrlKey?: boolean
    faceIndex?: number
    localPosition?: [number, number, number]
    metaKey?: boolean
    normal?: [number, number, number]
    object?: NodeEvent['object']
    onStopPropagation?: () => void
    shiftKey?: boolean
  } = {},
): NodeEvent {
  return {
    node,
    position,
    localPosition: options.localPosition ?? position,
    normal: options.normal,
    faceIndex: options.faceIndex,
    object: options.object ?? ({} as never),
    stopPropagation: options.onStopPropagation ?? (() => {}),
    nativeEvent: {
      altKey: options.altKey ?? false,
      ctrlKey: options.ctrlKey ?? false,
      metaKey: options.metaKey ?? false,
      shiftKey: options.shiftKey ?? false,
    } as never,
  }
}

function zoneNode(): AnyNode {
  return {
    id: 'zone_measurement',
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

function areaOutlinedPerimeterNode(): AnyNode {
  return {
    ...zoneNode(),
    id: 'area_outlined_perimeter_measurement_3d',
    type: 'surface-perimeter-without-boundary',
  } as never
}

function slabWithHoleNode(): AnyNode {
  return {
    id: 'slab_measurement_hole',
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
    id: 'site_measurement',
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
    id: 'wall_measurement',
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
    id: 'wall_measurement_curved',
    curveOffset: 1,
  } as never
}

function splineFenceNode(): AnyNode {
  return {
    id: 'fence_measurement_spline',
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
    id: 'window_measurement',
    type: 'window',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    wallId: 'wall_measurement',
    position: [2, 1, 0],
    width: 1,
    height: 1,
  } as never
}

function doorNode(): AnyNode {
  return {
    id: 'door_measurement',
    type: 'door',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    wallId: 'wall_measurement',
    position: [2, 1.05, 0],
    width: 0.9,
    height: 2.1,
  } as never
}

function spawnNode(): AnyNode {
  return {
    id: 'spawn_measurement',
    type: 'spawn',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: 0,
  } as never
}

function stairNode(): AnyNode {
  return {
    id: 'stair_measurement',
    type: 'stair',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['stair_segment_measurement'],
    position: [0, 0, 0],
    rotation: 0,
    stairType: 'straight',
    width: 1,
  } as never
}

function stairSegmentNode(): AnyNode {
  return {
    id: 'stair_segment_measurement',
    type: 'stair-segment',
    object: 'node',
    parentId: 'stair_measurement',
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
    id: 'duct_segment_measurement',
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
    id: 'roof_measurement',
    type: 'roof',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: ['roof_segment_measurement'],
    position: [0, 0, 0],
    rotation: 0,
    ...overrides,
  } as never
}

function roofSegmentNode(overrides: Partial<AnyNode> = {}): AnyNode {
  return {
    id: 'roof_segment_measurement',
    type: 'roof-segment',
    object: 'node',
    parentId: 'roof_measurement',
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
    id: 'skylight_measurement',
    type: 'skylight',
    object: 'node',
    parentId: 'roof_segment_measurement',
    visible: true,
    metadata: {},
    children: [],
    roofSegmentId: 'roof_segment_measurement',
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

function triangleMesh() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  return new Mesh(geometry)
}

function twoTriangleMesh() {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0.32, 0.34, 0, 1.2, 0.34, 0, 0.32, 1.2, 0],
      3,
    ),
  )
  return new Mesh(geometry)
}

function indexedTriangleMesh() {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 4, 4], 3),
  )
  geometry.setIndex([2, 0, 1])
  return new Mesh(geometry)
}

describe('measurement 3D grid handlers', () => {
  test('uses the wall-top measurement annotation colors in 3D', () => {
    expect(getMeasurementAnnotationColors('light')).toEqual({
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      borderColor: 'rgba(139, 92, 246, 0.72)',
      color: '#7c3aed',
      shadowColor: '#ffffff',
    })
    expect(getMeasurementAnnotationColors('dark')).toEqual({
      backgroundColor: 'rgba(24, 24, 27, 0.94)',
      borderColor: 'rgba(139, 92, 246, 0.72)',
      color: '#c4b5fd',
      shadowColor: '#111111',
    })
  })

  test('staggers overlapping 3D measurement value labels', () => {
    const layouts = staggerMeasurementLabelLayouts3D([
      {
        id: 'a',
        labelPosition: new Vector3(1, 1, 1),
        tickDirection: new Vector3(0, 1, 0),
      },
      {
        id: 'b',
        labelPosition: new Vector3(1.02, 1.01, 1.03),
        tickDirection: new Vector3(0, 1, 0),
      },
      {
        id: 'c',
        labelPosition: new Vector3(4, 4, 4),
        tickDirection: new Vector3(0, 1, 0),
      },
    ])

    expect(layouts[0]?.labelPosition.y).toBe(1)
    expect(layouts[1]?.labelPosition.y).toBeGreaterThan(1.01)
    expect(layouts[2]?.labelPosition.y).toBe(4)
  })

  test('commits a 3D point-to-point distance from two grid clicks', () => {
    const canvas = new globalThis.HTMLCanvasElement()

    handleMeasurementGridClick3D(gridEvent([0, 0, 0], canvas), canvas)
    handleMeasurementGridMove3D(gridEvent([0, 3, 4], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([0, 3, 4], canvas), canvas)

    const state = useMeasurementTool.getState()
    expect(state.draft).toBeNull()
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [0, 3, 4],
      view: '3d',
    })
    expect(state.selectedId).toBe(state.segments[0]?.id ?? null)
  })

  test('updates the 3D draft endpoint while moving the pointer', () => {
    const canvas = new globalThis.HTMLCanvasElement()

    handleMeasurementGridClick3D(gridEvent([0, 0, 0], canvas), canvas)
    handleMeasurementGridMove3D(gridEvent([2, 1, 0], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0, 0, 0],
      end: [2, 1, 0],
      view: '3d',
    })
  })

  test('drags a saved 3D grid measurement endpoint through snapping', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([wallNode()])
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('3d', [1, 0, 1], [2, 0, 1], 1)
    const segmentId = useMeasurementTool.getState().segments[0]!.id

    measurement.setSnapKindEnabled('guide', false)
    measurement.startSegmentEndpointDrag(segmentId, 'end')
    handleMeasurementGridMove3D(gridEvent([3.9, 0, 0.08], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([3.9, 0, 0.08], canvas), canvas)

    const segment = useMeasurementTool.getState().segments[0]
    expect(segment).toMatchObject({
      start: [1, 0, 1],
      measuredDistanceMeters: undefined,
      view: '3d',
    })
    expect(segment?.end[0]).toBeCloseTo(4)
    expect(segment?.end[1]).toBeCloseTo(0)
    expect(segment?.end[2]).toBeCloseTo(0)
    expect(useMeasurementTool.getState().draggingSegmentEndpoint).toBeNull()
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'endpoint',
      point: [4, 0, 0],
      view: '3d',
    })
  })

  test('does not start a new 3D measurement from the click after endpoint drag release', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('3d', [1, 0, 1], [2, 0, 1], 1)
    const segmentId = useMeasurementTool.getState().segments[0]!.id

    measurement.startSegmentEndpointDrag(segmentId, 'end')
    handleMeasurementGridMove3D(gridEvent([3, 0, 1], canvas), canvas)
    measurement.endSegmentEndpointDrag({ suppressNextClick: true })
    handleMeasurementGridClick3D(gridEvent([3, 0, 1], canvas), canvas)

    const state = useMeasurementTool.getState()
    expect(state.segments).toHaveLength(1)
    expect(state.draft).toBeNull()
    expect(state.segments[0]).toMatchObject({
      end: [3, 0, 1],
      start: [1, 0, 1],
      view: '3d',
    })
  })

  test('does not start a new 3D measurement from a node click after endpoint drag release', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('3d', [1, 0, 1], [2, 0, 1], 1)
    const segmentId = useMeasurementTool.getState().segments[0]!.id

    measurement.startSegmentEndpointDrag(segmentId, 'end')
    handleMeasurementGridMove3D(gridEvent([3, 0, 1], canvas), canvas)
    measurement.endSegmentEndpointDrag({ suppressNextClick: true })
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [0.08, 0, 0.06]))

    const state = useMeasurementTool.getState()
    expect(state.segments).toHaveLength(1)
    expect(state.draft).toBeNull()
    expect(state.segments[0]).toMatchObject({
      end: [3, 0, 1],
      start: [1, 0, 1],
      view: '3d',
    })
  })

  test('drags a saved 3D surface measurement endpoint through surface snapping', () => {
    const measurement = useMeasurementTool.getState()
    measurement.addSegment('3d', [1, 0, 1], [2, 0, 1], 1)
    const segmentId = useMeasurementTool.getState().segments[0]!.id

    measurement.startSegmentEndpointDrag(segmentId, 'start')
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [0.08, 0, 0.06]))

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [2, 0, 1],
      measuredDistanceMeters: undefined,
      view: '3d',
    })
    expect(useMeasurementTool.getState().draggingSegmentEndpoint).toBeNull()
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'vertex',
      point: [0, 0, 0],
      view: '3d',
    })
  })

  test('shift does not axis-lock the 3D draft endpoint while drawing', () => {
    const canvas = new globalThis.HTMLCanvasElement()

    handleMeasurementGridClick3D(gridEvent([0, 0, 0], canvas), canvas)
    handleMeasurementGridMove3D(gridEvent([1, 2, 5], canvas, { shiftKey: true }), canvas)
    handleMeasurementGridClick3D(gridEvent([1, 2, 5], canvas, { shiftKey: true }), canvas)

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [1, 2, 5],
      view: '3d',
    })
  })

  test('snaps the first 3D surface placement point to nearby surface anchors', () => {
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [0.08, 0, 0.06]))

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      label: 'Vertex',
      point: [0, 0, 0],
      view: '3d',
    })
  })

  test('snaps the committed 3D surface endpoint to nearby surface anchors', () => {
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [0.08, 0, 0.06]))
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [3.92, 0, 2.92]))

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [4, 0, 3],
      view: '3d',
    })
  })

  test('shift does not axis-lock the committed 3D surface endpoint after snapping', () => {
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [0.08, 0, 0.06]))
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [3.92, 0, 2.92], { shiftKey: true }))

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [4, 0, 3],
      view: '3d',
    })
  })

  test('snaps 3D angle points to nearby surface anchors', () => {
    useMeasurementTool.getState().setMode('angle')

    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [2.02, 0, 1.52]))
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [3.92, 0, 2.92]))

    expect(useMeasurementTool.getState().angles[0]).toMatchObject({
      vertex: [2, 0, 1.5],
      second: [4, 0, 3],
      view: '3d',
    })
    expect(useMeasurementTool.getState().angles[0]?.first[0]).toBeCloseTo(4.5)
    expect(useMeasurementTool.getState().angles[0]?.first[1]).toBeCloseTo(0)
    expect(useMeasurementTool.getState().angles[0]?.first[2]).toBeCloseTo(1.5)
  })

  test('uses a 3D grid edge projection as the angle reference', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([wallNode()])
    useMeasurementTool.getState().setMode('angle')

    handleMeasurementGridClick3D(gridEvent([2, 0, 0.05], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([2, 0, 2], canvas), canvas)

    expect(useMeasurementTool.getState().angles[0]).toMatchObject({
      first: [4, 0, 0],
      vertex: [2, 0, 0],
      second: [2, 0, 2],
      view: '3d',
    })
  })

  test('uses the adjacent 3D mesh edge as the angle reference at a vertex', () => {
    const mesh = triangleMesh()
    useMeasurementTool.getState().setMode('angle')

    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [0.04, 0.02, 0], {
        faceIndex: 0,
        localPosition: [0.04, 0.02, 0],
        object: mesh,
      }),
    )
    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [0, 1, 0], {
        faceIndex: 0,
        localPosition: [0, 1, 0],
        object: mesh,
      }),
    )

    expect(useMeasurementTool.getState().angles[0]).toMatchObject({
      first: [1, 0, 0],
      vertex: [0, 0, 0],
      second: [0, 1, 0],
      view: '3d',
    })
  })

  test('snaps 3D node hits to mesh vertices', () => {
    const mesh = triangleMesh()

    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [0.04, 0.02, 0], {
        faceIndex: 0,
        localPosition: [0.04, 0.02, 0],
        object: mesh,
      }),
    )

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'vertex',
      label: 'Mesh vertex',
      point: [0, 0, 0],
      view: '3d',
    })
  })

  test('does not snap 3D node hits to mesh vertices when vertex snaps are disabled', () => {
    const mesh = triangleMesh()
    useMeasurementTool.getState().setSnapKindEnabled('vertex', false)

    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [0.04, 0.02, 0], {
        faceIndex: 0,
        localPosition: [0.04, 0.02, 0],
        object: mesh,
      }),
    )

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0.04, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Mesh edge',
      point: [0.04, 0, 0],
      view: '3d',
    })
  })

  test('snaps 3D node hits to mesh edge projections', () => {
    const mesh = triangleMesh()

    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [0.5, 0.04, 0], {
        faceIndex: 0,
        localPosition: [0.5, 0.04, 0],
        object: mesh,
      }),
    )

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0.5, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Mesh edge',
      point: [0.5, 0, 0],
      targetLine: {
        start: [0, 0, 0],
        end: [1, 0, 0],
      },
      view: '3d',
    })
  })

  test('snaps 3D node hits to mesh face centers', () => {
    const mesh = triangleMesh()

    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [1 / 3, 1 / 3, 0], {
        faceIndex: 0,
        localPosition: [1 / 3, 1 / 3, 0],
        object: mesh,
      }),
    )

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1 / 3, 1 / 3, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'center',
      label: 'Face center',
      point: [1 / 3, 1 / 3, 0],
      view: '3d',
    })
  })

  test('snaps 3D node hits to indexed mesh triangle vertices', () => {
    const mesh = indexedTriangleMesh()

    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [0.02, 0.96, 0], {
        faceIndex: 0,
        localPosition: [0.02, 0.96, 0],
        object: mesh,
      }),
    )

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0, 1, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'vertex',
      label: 'Mesh vertex',
      point: [0, 1, 0],
      view: '3d',
    })
  })

  test('snaps 3D node hits to indexed mesh edge projections', () => {
    const mesh = indexedTriangleMesh()

    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [0.5, 0.04, 0], {
        faceIndex: 0,
        localPosition: [0.5, 0.04, 0],
        object: mesh,
      }),
    )

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0.5, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Mesh edge',
      point: [0.5, 0, 0],
      view: '3d',
    })
  })

  test('snaps 3D node hits to indexed mesh face centers', () => {
    const mesh = indexedTriangleMesh()

    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [1 / 3, 1 / 3, 0], {
        faceIndex: 0,
        localPosition: [1 / 3, 1 / 3, 0],
        object: mesh,
      }),
    )

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1 / 3, 1 / 3, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'center',
      label: 'Face center',
      point: [1 / 3, 1 / 3, 0],
      view: '3d',
    })
  })

  test('ignores closer vertices from non-hit mesh triangles', () => {
    const mesh = twoTriangleMesh()

    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [1 / 3, 1 / 3, 0], {
        faceIndex: 0,
        localPosition: [1 / 3, 1 / 3, 0],
        object: mesh,
      }),
    )

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1 / 3, 1 / 3, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'center',
      label: 'Face center',
      point: [1 / 3, 1 / 3, 0],
      view: '3d',
    })
  })

  test('measures surface-to-surface distance between parallel 3D faces', () => {
    const mesh = triangleMesh()

    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [0.04, 0.02, 0], {
        localPosition: [0.04, 0.02, 0],
        normal: [1, 0, 0],
        object: mesh,
      }),
    )
    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [2.02, 0.02, 0], {
        localPosition: [2.02, 0.02, 0],
        normal: [-1, 0, 0],
        object: mesh,
      }),
    )

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [2, 0, 0],
      measuredDistanceMeters: 2,
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'surface',
      label: 'Surface distance',
      point: [2, 0, 0],
      view: '3d',
    })
  })

  test('does not use surface-to-surface distance when surface snaps are disabled', () => {
    const mesh = triangleMesh()
    useMeasurementTool.getState().setSnapKindEnabled('surface', false)

    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [0.04, 0.02, 0], {
        localPosition: [0.04, 0.02, 0],
        normal: [1, 0, 0],
        object: mesh,
      }),
    )
    handleMeasurementNodeClick3D(
      nodeEvent(zoneNode(), [2.02, 0.02, 0], {
        localPosition: [2.02, 0.02, 0],
        normal: [-1, 0, 0],
        object: mesh,
      }),
    )

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [2, 0, 0],
      measuredDistanceMeters: undefined,
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget?.kind).not.toBe('surface')
  })

  test('commits a 3D angle in angle mode', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    const measurement = useMeasurementTool.getState()
    measurement.setMode('angle')

    handleMeasurementGridClick3D(gridEvent([0, 0, 0], canvas), canvas)
    handleMeasurementGridMove3D(gridEvent([0, 1, 0], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([0, 1, 0], canvas), canvas)

    const state = useMeasurementTool.getState()
    expect(state.angleDraft).toBeNull()
    expect(state.angles).toHaveLength(1)
    expect(state.angles[0]).toMatchObject({
      first: [1, 0, 0],
      vertex: [0, 0, 0],
      second: [0, 1, 0],
      view: '3d',
    })
  })

  test('ignores events from a non-canvas target', () => {
    const canvas = new globalThis.HTMLCanvasElement()

    handleMeasurementGridClick3D(gridEvent([0, 0, 0], canvas, { target: {} }), canvas)

    expect(useMeasurementTool.getState().draft).toBeNull()
    expect(useMeasurementTool.getState().segments).toHaveLength(0)
  })

  test('ignores grid events suppressed after a surface event', () => {
    const canvas = new globalThis.HTMLCanvasElement()

    handleMeasurementGridClick3D(gridEvent([0, 0, 0], canvas), canvas, () => true)

    expect(useMeasurementTool.getState().draft).toBeNull()
  })

  test('tracks 3D grid snap target on grid movement', () => {
    const canvas = new globalThis.HTMLCanvasElement()

    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [0.08, 0, 0.06]))
    handleMeasurementGridMove3D(gridEvent([1, 0, 1], canvas), canvas)

    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'grid',
      label: 'Grid',
      point: [1, 0, 1],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to nearby scene wall endpoints', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([wallNode()])

    handleMeasurementGridClick3D(gridEvent([0.08, 0, 0.06], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      label: 'Endpoint',
      point: [0, 0, 0],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to nearby scene wall edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([wallNode()])

    handleMeasurementGridClick3D(gridEvent([1.25, 0, 0.08], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.25, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      label: 'Wall edge',
      point: [1.25, 0, 0],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to sampled curved wall edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([curvedWallNode()])

    handleMeasurementGridClick3D(
      gridEvent([0.8819660112501051, 0, -0.7360679774997898], canvas),
      canvas,
    )

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0.8819660112501051, 0, -0.7360679774997898],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Wall edge',
      point: [0.8819660112501051, 0, -0.7360679774997898],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to sampled spline fence edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([splineFenceNode()])

    handleMeasurementGridClick3D(gridEvent([0.9704915028125263, 0, 0.625], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0.9704915028125263, 0, 0.625],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Fence edge',
      point: [0.9704915028125263, 0, 0.625],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to hosted opening endpoints', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([wallNode(), windowNode()])

    handleMeasurementGridClick3D(gridEvent([1.52, 0, 0.03], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.5, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'endpoint',
      label: 'Opening endpoint',
      point: [1.5, 0, 0],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to hosted opening centers', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([wallNode(), windowNode()])

    handleMeasurementGridClick3D(gridEvent([2.03, 0, 0.04], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [2, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'center',
      label: 'Opening center',
      point: [2, 0, 0],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to hosted opening edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([wallNode(), windowNode()])

    handleMeasurementGridClick3D(gridEvent([1.75, 0, 0.08], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.75, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Opening edge',
      point: [1.75, 0, 0],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to composite stair footprint corners', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([stairNode(), stairSegmentNode()])

    handleMeasurementGridClick3D(gridEvent([-0.48, 0, 2.96], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [-0.5, 0, 3],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'vertex',
      label: 'Stair corner',
      point: [-0.5, 0, 3],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to MEP run path edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([ductSegmentNode()])

    handleMeasurementGridClick3D(gridEvent([2.08, 0, 1.25], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [2, 0, 1.25],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Run edge',
      point: [2, 0, 1.25],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to surface opening hole edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([slabWithHoleNode()])
    useMeasurementTool.getState().setSnapKindEnabled('midpoint', false)

    handleMeasurementGridClick3D(gridEvent([1.4, 0, 1.08], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.4, 0, 1],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Surface opening edge',
      point: [1.4, 0, 1],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to site property lines', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([siteNode()])
    useMeasurementTool.getState().setSnapKindEnabled('midpoint', false)

    handleMeasurementGridClick3D(gridEvent([0.4, 0, -1.08], canvas), canvas)

    const draft = useMeasurementTool.getState().draft
    expect(draft?.start[0]).toBeCloseTo(0.4)
    expect(draft?.start[1]).toBeCloseTo(0)
    expect(draft?.start[2]).toBeCloseTo(-1)
    expect(draft?.view).toBe('3d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Property line edge',
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(0.4)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(-1)
  })

  test('snaps 3D grid clicks to roof ridge edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([roofNode(), roofSegmentNode()])

    handleMeasurementGridClick3D(gridEvent([1.25, 0, 0.08], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.25, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof ridge edge',
      point: [1.25, 0, 0],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to roof eave corners', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([roofNode(), roofSegmentNode()])

    handleMeasurementGridClick3D(gridEvent([-2.03, 0, -1.04], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [-2, 0, -1],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'vertex',
      label: 'Roof eave corner',
      point: [-2, 0, -1],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to rotated roof ridge edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([roofNode(), roofSegmentNode({ rotation: Math.PI / 2 } as never)])

    handleMeasurementGridClick3D(gridEvent([0.08, 0, -1.25], canvas), canvas)

    const draft = useMeasurementTool.getState().draft
    expect(draft?.start[0]).toBeCloseTo(0)
    expect(draft?.start[1]).toBeCloseTo(0)
    expect(draft?.start[2]).toBeCloseTo(-1.25)
    expect(draft?.view).toBe('3d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof ridge edge',
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(0)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(-1.25)
  })

  test('snaps 3D grid clicks to roof accessory edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([
      roofNode({ position: [10, 0, 20], rotation: Math.PI / 2 } as never),
      roofSegmentNode({ position: [2, 0, 0] } as never),
      skylightNode(),
    ])
    useMeasurementTool.getState().setSnapKindEnabled('midpoint', false)

    handleMeasurementGridClick3D(gridEvent([10.58, 0, 18.2], canvas), canvas)

    const draft = useMeasurementTool.getState().draft
    expect(draft?.start[0]).toBeCloseTo(10.5)
    expect(draft?.start[1]).toBeCloseTo(0)
    expect(draft?.start[2]).toBeCloseTo(18.2)
    expect(draft?.view).toBe('3d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Skylight edge',
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to hip roof edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([roofNode(), roofSegmentNode({ roofType: 'hip' } as never)])

    handleMeasurementGridClick3D(gridEvent([-1.2, 0, 0.2], canvas), canvas)

    const draft = useMeasurementTool.getState().draft
    expect(draft?.start[0]).toBeCloseTo(-1.2)
    expect(draft?.start[1]).toBeCloseTo(0)
    expect(draft?.start[2]).toBeCloseTo(0.2)
    expect(draft?.view).toBe('3d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof hip edge',
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(-1.2)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(0.2)
  })

  test('snaps 3D grid clicks to mansard roof break edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([roofNode(), roofSegmentNode({ roofType: 'mansard' } as never)])

    handleMeasurementGridClick3D(gridEvent([0.6, 0, 0.7], canvas), canvas)

    const draft = useMeasurementTool.getState().draft
    expect(draft?.start[0]).toBeCloseTo(0.6)
    expect(draft?.start[1]).toBeCloseTo(0)
    expect(draft?.start[2]).toBeCloseTo(0.7)
    expect(draft?.view).toBe('3d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof break edge',
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(0.6)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(0.7)
  })

  test('snaps 3D grid clicks to dutch roof ridge and break edges', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([roofNode(), roofSegmentNode({ roofType: 'dutch' } as never)])

    handleMeasurementGridClick3D(gridEvent([0.4, 0, 0.08], canvas), canvas)

    const ridgeDraft = useMeasurementTool.getState().draft
    expect(ridgeDraft?.start[0]).toBeCloseTo(0.4)
    expect(ridgeDraft?.start[1]).toBeCloseTo(0)
    expect(ridgeDraft?.start[2]).toBeCloseTo(0)
    expect(ridgeDraft?.view).toBe('3d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof ridge edge',
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(0.4)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(0)

    useMeasurementTool.getState().clear()
    useMeasurementTool.getState().setMode('distance')

    handleMeasurementGridClick3D(gridEvent([0.4, 0, 0.5], canvas), canvas)

    const breakDraft = useMeasurementTool.getState().draft
    expect(breakDraft?.start[0]).toBeCloseTo(0.4)
    expect(breakDraft?.start[1]).toBeCloseTo(0)
    expect(breakDraft?.start[2]).toBeCloseTo(0.5)
    expect(breakDraft?.view).toBe('3d')
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Roof break edge',
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget?.point[0]).toBeCloseTo(0.4)
    expect(useMeasurementTool.getState().snapTarget?.point[2]).toBeCloseTo(0.5)
  })

  test('prefers 3D scene endpoints over closer edge projections in crowded snaps', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([wallNode()])

    handleMeasurementGridClick3D(gridEvent([0.12, 0, 0.04], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [0, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'endpoint',
      label: 'Endpoint',
      point: [0, 0, 0],
      view: '3d',
    })
  })

  test('does not snap 3D grid clicks to scene anchors outside the snap radius', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([wallNode()])

    handleMeasurementGridClick3D(gridEvent([1.04, 0, 1.96], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1, 0, 2],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'grid',
      label: 'Grid',
      point: [1, 0, 2],
      view: '3d',
    })
  })

  test('snaps 3D grid clicks to saved measurement midpoints', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    useMeasurementTool.getState().addSegment('3d', [0, 0, 0], [3, 0, 0])

    handleMeasurementGridClick3D(gridEvent([1.52, 0, 0.04], canvas), canvas)

    expect(useMeasurementTool.getState().draft).toMatchObject({
      start: [1.5, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      kind: 'measurement',
      label: 'Measurement midpoint',
      point: [1.5, 0, 0],
      view: '3d',
    })
  })

  test('constrains 3D grid endpoints parallel to a nearby host edge', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([wallNode()])

    handleMeasurementGridClick3D(gridEvent([0.08, 0, 0.06], canvas), canvas)
    handleMeasurementGridMove3D(gridEvent([2, 0, 0.08], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([2, 0, 0.08], canvas), canvas)

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [2, 0, 0],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      guideLine: {
        end: [2, 0, 0],
        start: [-2, 0, 0],
      },
      kind: 'guide',
      label: 'Parallel',
      point: [2, 0, 0],
      view: '3d',
    })
  })

  test('constrains 3D grid endpoints perpendicular to a nearby host edge', () => {
    const canvas = new globalThis.HTMLCanvasElement()
    seedScene([wallNode()])

    handleMeasurementGridClick3D(gridEvent([0.08, 0, 0.06], canvas), canvas)
    handleMeasurementGridMove3D(gridEvent([0.08, 0, 2], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([0.08, 0, 2], canvas), canvas)

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [0, 0, 2],
      view: '3d',
    })
    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      label: 'Perpendicular',
      point: [0, 0, 2],
      view: '3d',
    })
  })

  test('adds 3D surface area in area mode', () => {
    useMeasurementTool.getState().setMode('area')

    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [2, 0, 1.5]))

    const state = useMeasurementTool.getState()
    expect(state.areas).toHaveLength(1)
    expect(state.areas[0]).toMatchObject({
      areaSquareMeters: 12,
      boundaryPoints: [
        [0, 0.02, 0],
        [4, 0.02, 0],
        [4, 0.02, 3],
        [0, 0.02, 3],
      ],
      labelPoint: [2, 0.05, 1.5],
      view: '3d',
    })
    expect(state.perimeters).toHaveLength(0)
  })

  test('hovering a 3D surface previews area in area mode without saving it', () => {
    useMeasurementTool.getState().setMode('area')

    handleMeasurementNodeMove3D(nodeEvent(zoneNode(), [2, 0, 1.5]))

    const state = useMeasurementTool.getState()
    expect(state.previewArea).toMatchObject({
      areaSquareMeters: 12,
      boundaryPoints: [
        [0, 0.02, 0],
        [4, 0.02, 0],
        [4, 0.02, 3],
        [0, 0.02, 3],
      ],
      view: '3d',
    })
    expect(state.areas).toHaveLength(0)
  })

  test('commits a freeform 3D area polygon by clicking the first point again', () => {
    useMeasurementTool.getState().setMode('area')
    const canvas = new globalThis.HTMLCanvasElement()

    handleMeasurementGridClick3D(gridEvent([0, 0, 0], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([4, 0, 0], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([4, 0, 3], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([0, 0, 0], canvas), canvas)

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
      view: '3d',
    })
  })

  test('adds 3D surface perimeter in perimeter mode', () => {
    useMeasurementTool.getState().setMode('perimeter')

    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [2, 0, 1.5]))

    const state = useMeasurementTool.getState()
    expect(state.perimeters).toHaveLength(1)
    expect(state.perimeters[0]).toMatchObject({
      boundaryPoints: [
        [0, 0.02, 0],
        [4, 0.02, 0],
        [4, 0.02, 3],
        [0, 0.02, 3],
      ],
      labelPoint: [2, 0.05, 1.5],
      lengthMeters: 14,
      view: '3d',
    })
    expect(state.areas).toHaveLength(0)
  })

  test('draws 3D slab perimeter on the rendered slab edge', () => {
    useMeasurementTool.getState().setMode('perimeter')

    handleMeasurementNodeClick3D(nodeEvent(slabWithHoleNode(), [2, 0, 2]))

    const perimeter = useMeasurementTool.getState().perimeters[0]
    expect(perimeter).toMatchObject({
      view: '3d',
    })
    expect(perimeter?.boundaryPoints).toHaveLength(4)
    const boundaryPoints = perimeter?.boundaryPoints
    expect(boundaryPoints).toBeDefined()
    const expectedBoundaryPoints: MeasurementPoint[] = [
      [4.05, 0.02, -0.05],
      [4.05, 0.02, 4.05],
      [-0.05, 0.02, 4.05],
      [-0.05, 0.02, -0.05],
    ]
    expectedBoundaryPoints.forEach((point, index) => {
      expect(boundaryPoints![index]?.[0]).toBeCloseTo(point[0])
      expect(boundaryPoints![index]?.[1]).toBeCloseTo(point[1])
      expect(boundaryPoints![index]?.[2]).toBeCloseTo(point[2])
    })
    expect(perimeter?.labelPoint[0]).toBeCloseTo(2)
    expect(perimeter?.labelPoint[1]).toBeCloseTo(0.05)
    expect(perimeter?.labelPoint[2]).toBeCloseTo(2)
    expect(perimeter?.lengthMeters).toBeCloseTo(20.4)
  })

  test('hovering a 3D surface previews perimeter in perimeter mode without saving it', () => {
    useMeasurementTool.getState().setMode('perimeter')

    handleMeasurementNodeMove3D(nodeEvent(zoneNode(), [2, 0, 1.5]))

    const state = useMeasurementTool.getState()
    expect(state.previewPerimeter).toMatchObject({
      boundaryPoints: [
        [0, 0.02, 0],
        [4, 0.02, 0],
        [4, 0.02, 3],
        [0, 0.02, 3],
      ],
      lengthMeters: 14,
      view: '3d',
    })
    expect(state.perimeters).toHaveLength(0)
  })

  test('3D perimeter reuses the area outline when its perimeter has no boundary points', () => {
    useMeasurementTool.getState().setMode('perimeter')

    handleMeasurementNodeMove3D(nodeEvent(areaOutlinedPerimeterNode(), [2, 0, 1.5]))

    const state = useMeasurementTool.getState()
    expect(state.previewPerimeter).toMatchObject({
      boundaryPoints: [
        [0, 0.02, 0],
        [4, 0.02, 0],
        [4, 0.02, 3],
        [0, 0.02, 3],
      ],
      lengthMeters: 14,
      view: '3d',
    })
  })

  test('commits a freeform 3D perimeter polygon by clicking the first point again', () => {
    useMeasurementTool.getState().setMode('perimeter')
    const canvas = new globalThis.HTMLCanvasElement()

    handleMeasurementGridClick3D(gridEvent([0, 0, 0], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([4, 0, 0], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([4, 0, 3], canvas), canvas)
    handleMeasurementGridClick3D(gridEvent([0, 0, 0], canvas), canvas)

    const state = useMeasurementTool.getState()
    expect(state.polygonDraft).toBeNull()
    expect(state.perimeters).toHaveLength(1)
    expect(state.perimeters[0]).toMatchObject({
      boundaryPoints: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 3],
      ],
      lengthMeters: 12,
      view: '3d',
    })
  })

  test('alt-click on a 3D surface adds perimeter only', () => {
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [2, 0, 1.5], { altKey: true }))

    const state = useMeasurementTool.getState()
    expect(state.perimeters).toHaveLength(1)
    expect(state.areas).toHaveLength(0)
  })

  test('normal click on a 3D measurable wall starts point-to-point drawing', () => {
    handleMeasurementNodeClick3D(nodeEvent(wallNode(), [2, 0, 0]))

    const state = useMeasurementTool.getState()
    expect(state.draft).toMatchObject({
      start: [2, 0, 0],
      view: '3d',
    })
    expect(state.segments).toHaveLength(0)
  })

  test('hovering a 3D measurable wall previews its direct length without saving it', () => {
    handleMeasurementNodeMove3D(nodeEvent(wallNode(), [2, 0, 0]))

    const state = useMeasurementTool.getState()
    expect(state.previewSegment).toMatchObject({
      start: [0, 0, 0],
      end: [4, 0, 0],
      measuredDistanceMeters: 4,
      view: '3d',
    })
    expect(state.segments).toHaveLength(0)

    const canvas = {} as HTMLCanvasElement
    handleMeasurementGridMove3D(gridEvent([8, 0, 0], canvas), canvas)

    expect(useMeasurementTool.getState().previewSegment).toBeNull()
  })

  test('ignores the 3D site ground plane for measurement hover', () => {
    handleMeasurementNodeMove3D(nodeEvent(siteNode(), [0, 0, 0]))

    const state = useMeasurementTool.getState()
    expect(state.cursor).toBeNull()
    expect(state.previewSegment).toBeNull()
    expect(state.previewArea).toBeNull()
    expect(state.previewPerimeter).toBeNull()
    expect(state.snapTarget).toBeNull()
  })

  test('hovering a 3D surface edge previews the edge under the cursor', () => {
    handleMeasurementNodeMove3D(nodeEvent(zoneNode(), [4, 0, 1.5]))

    expect(useMeasurementTool.getState().previewSegment).toMatchObject({
      measuredDistanceMeters: 3,
      start: [4, 0, 0],
      end: [4, 0, 3],
      view: '3d',
    })
  })

  test('hovering a 3D roof ridge previews the actual roof line under the cursor', () => {
    const roof = roofNode()
    const segment = roofSegmentNode()
    seedScene([roof, segment])

    handleMeasurementNodeMove3D(nodeEvent(segment, [1, 0, 0]))

    expect(useMeasurementTool.getState().previewSegment).toMatchObject({
      measuredDistanceMeters: 4,
      start: [-2, 0, 0],
      end: [2, 0, 0],
      view: '3d',
    })
  })

  test('hovering a 3D stair footprint edge previews the edge under the cursor', () => {
    const stair = stairNode()
    const segment = stairSegmentNode()
    seedScene([stair, segment])

    handleMeasurementNodeMove3D(nodeEvent(stair, [0.5, 0, 1.5]))

    expect(useMeasurementTool.getState().previewSegment).toMatchObject({
      measuredDistanceMeters: 3,
      start: [0.5, 0, 0],
      end: [0.5, 0, 3],
      view: '3d',
    })
  })

  test('hovering a 3D fence side previews the fence height', () => {
    const fence = { ...splineFenceNode(), height: 1.8, thickness: 0.08 } as AnyNode
    seedScene([fence])

    handleMeasurementNodeMove3D(nodeEvent(fence, [2, 0.9, 1]))

    const preview = useMeasurementTool.getState().previewSegment
    expect(preview?.measuredDistanceMeters).toBeCloseTo(1.8)
    expect(preview?.start[1]).toBeCloseTo(0)
    expect(preview?.end[1]).toBeCloseTo(1.8)
    expect(preview?.view).toBe('3d')
  })

  test('hovering a 3D window side edge previews the opening height', () => {
    const window = {
      ...windowNode(),
      position: [2, 1, 0],
      width: 3,
      height: 1,
    } as AnyNode
    seedScene([wallNode(), window])

    handleMeasurementNodeMove3D(nodeEvent(window, [0.5, 1, 0.08]))

    expect(useMeasurementTool.getState().previewSegment).toMatchObject({
      measuredDistanceMeters: 1,
      start: [0.5, 0.5, 0.08],
      end: [0.5, 1.5, 0.08],
      view: '3d',
    })
  })

  test('hovering a 3D window bottom edge still previews the opening width', () => {
    const window = {
      ...windowNode(),
      position: [2, 1, 0],
      width: 3,
      height: 1,
    } as AnyNode
    seedScene([wallNode(), window])

    handleMeasurementNodeMove3D(nodeEvent(window, [2, 0.5, 0.08]))

    expect(useMeasurementTool.getState().previewSegment).toMatchObject({
      measuredDistanceMeters: 3,
      start: [0.5, 0.5, 0.08],
      end: [3.5, 0.5, 0.08],
      view: '3d',
    })
  })

  test('hovering a 3D door side edge previews the door height', () => {
    const door = doorNode()
    seedScene([wallNode(), door])

    handleMeasurementNodeMove3D(nodeEvent(door, [2.45, 1.05, 0.08]))

    expect(useMeasurementTool.getState().previewSegment).toMatchObject({
      measuredDistanceMeters: 2.1,
      start: [2.45, 0, 0.08],
      end: [2.45, 2.1, 0.08],
      view: '3d',
    })
  })

  test('hovering a 3D wall side previews semantic wall height instead of rendered bounds', () => {
    const wall = { ...wallNode(), height: 2.5, thickness: 0.2 } as AnyNode
    const mesh = new Mesh(new BoxGeometry(4, 3.54, 0.2))
    mesh.position.y = 1.77
    sceneRegistry.nodes.set(wall.id as AnyNodeId, mesh)

    handleMeasurementNodeMove3D(
      nodeEvent(wall, [1.2, 1.4, 0.1], { normal: [0, 0, 1], object: mesh }),
    )

    const state = useMeasurementTool.getState()
    expect(state.previewSegment).toMatchObject({
      measuredDistanceMeters: 2.5,
      start: [1.2, 0, 0.1],
      end: [1.2, 2.5, 0.1],
      view: '3d',
    })
    expect(state.segments).toHaveLength(0)
  })

  test('hovering a 3D wall side anchors the preview to the wall face', () => {
    const wall = { ...wallNode(), height: 2.5, thickness: 0.2 } as AnyNode
    const mesh = new Mesh(new BoxGeometry(4, 3.54, 0.2))
    mesh.position.y = 1.77
    sceneRegistry.nodes.set(wall.id as AnyNodeId, mesh)

    handleMeasurementNodeMove3D(
      nodeEvent(wall, [1.2, 1.4, 0.34], { normal: [0, 0, 1], object: mesh }),
    )

    const state = useMeasurementTool.getState()
    expect(state.previewSegment).toMatchObject({
      measuredDistanceMeters: 2.5,
      start: [1.2, 0, 0.1],
      end: [1.2, 2.5, 0.1],
      view: '3d',
    })
  })

  test('hovering a 3D wall side without a face normal still previews semantic wall height', () => {
    const wall = { ...wallNode(), height: 2.5, thickness: 0.2 } as AnyNode
    const mesh = new Mesh(new BoxGeometry(4, 3.54, 0.2))
    mesh.position.y = 1.77
    sceneRegistry.nodes.set(wall.id as AnyNodeId, mesh)

    handleMeasurementNodeMove3D(nodeEvent(wall, [1.2, 1.4, 0.1], { object: mesh }))

    const state = useMeasurementTool.getState()
    expect(state.previewSegment).toMatchObject({
      measuredDistanceMeters: 2.5,
      start: [1.2, 0, 0.1],
      end: [1.2, 2.5, 0.1],
      view: '3d',
    })
  })

  test('hovering an elevated 3D wall anchors semantic height to its rendered level', () => {
    const wall = { ...wallNode(), height: 2.5, thickness: 0.2 } as AnyNode
    const building = new Group()
    const level = new Group()
    const mesh = new Mesh(new BoxGeometry(4, 2.5, 0.2))
    level.position.y = 5
    mesh.position.y = 1.25
    level.add(mesh)
    building.add(level)
    building.updateMatrixWorld(true)
    sceneRegistry.nodes.set('building_measurement' as AnyNodeId, building)
    sceneRegistry.nodes.set(wall.id as AnyNodeId, mesh)

    handleMeasurementNodeMove3D(
      nodeEvent(wall, [1.2, 6.4, 0.1], { normal: [0, 0, 1], object: mesh }),
      'building_measurement' as AnyNodeId,
    )

    expect(useMeasurementTool.getState().previewSegment).toMatchObject({
      measuredDistanceMeters: 2.5,
      start: [1.2, 5, 0.1],
      end: [1.2, 7.5, 0.1],
      view: '3d',
    })
  })

  test('hovering a rendered external asset owns the hover preview over the underlay', () => {
    const node = spawnNode()
    const mesh = new Mesh(new BoxGeometry(2, 1, 3))
    mesh.position.y = 0.5
    const canvas = {} as HTMLCanvasElement
    let stopped = false
    sceneRegistry.nodes.set(node.id as AnyNodeId, mesh)

    handleMeasurementNodeMove3D(
      nodeEvent(node, [0, 0, 0], {
        object: mesh,
        onStopPropagation: () => {
          stopped = true
        },
      }),
    )

    const state = useMeasurementTool.getState()
    expect(stopped).toBe(true)
    expect(state.previewSegment).toMatchObject({
      measuredDistanceMeters: 3,
      start: [-1, 0, -1.5],
      end: [-1, 0, 1.5],
      view: '3d',
    })

    handleMeasurementGridMove3D(gridEvent([2, 0, 1.5], canvas), canvas, () => true)

    expect(useMeasurementTool.getState().previewSegment).toMatchObject({
      measuredDistanceMeters: 3,
      start: [-1, 0, -1.5],
      end: [-1, 0, 1.5],
      view: '3d',
    })
  })

  test('hovering a rendered external asset previews the edge under the cursor', () => {
    const node = spawnNode()
    const mesh = new Mesh(new BoxGeometry(2, 1, 3))
    mesh.position.y = 0.5
    sceneRegistry.nodes.set(node.id as AnyNodeId, mesh)

    handleMeasurementNodeMove3D(nodeEvent(node, [0, 1, 1.5], { object: mesh }))

    const state = useMeasurementTool.getState()
    expect(state.previewSegment).toMatchObject({
      measuredDistanceMeters: 2,
      start: [-1, 1, 1.5],
      end: [1, 1, 1.5],
      view: '3d',
    })
    expect(state.cursor).toEqual({ point: [0, 1, 1.5], view: '3d' })
    expect(state.snapTarget).toMatchObject({
      kind: 'edge',
      label: 'Box edge',
      point: [0, 1, 1.5],
      view: '3d',
    })
  })

  test('hovering a rendered vertical side previews a surface-aligned height', () => {
    const node = spawnNode()
    const mesh = new Mesh(new BoxGeometry(2, 1, 3))
    mesh.position.y = 0.5
    sceneRegistry.nodes.set(node.id as AnyNodeId, mesh)

    handleMeasurementNodeMove3D(nodeEvent(node, [1, 0.6, 0.2], { normal: [1, 0, 0], object: mesh }))

    const state = useMeasurementTool.getState()
    expect(state.previewSegment).toMatchObject({
      measuredDistanceMeters: 1,
      start: [1, 0, 0.2],
      end: [1, 1, 0.2],
      view: '3d',
    })
  })

  test('normal click after a 3D hover preview starts point-to-point drawing', () => {
    const node = spawnNode()
    const mesh = new Mesh(new BoxGeometry(2, 1, 3))
    mesh.position.y = 0.5
    sceneRegistry.nodes.set(node.id as AnyNodeId, mesh)

    handleMeasurementNodeMove3D(nodeEvent(node, [0, 1, 1.5], { object: mesh }))
    handleMeasurementNodeClick3D(nodeEvent(node, [0, 1, 1.5], { object: mesh }))

    const state = useMeasurementTool.getState()
    expect(state.draft).toMatchObject({
      start: [0, 1, 1.5],
      view: '3d',
    })
    expect(state.previewSegment).toBeNull()
    expect(state.segments).toHaveLength(0)
  })

  test('normal clicks on 3D measurable walls commit point-to-point drawing', () => {
    handleMeasurementNodeClick3D(nodeEvent(wallNode(), [1, 0, 0]))
    handleMeasurementNodeClick3D(nodeEvent(wallNode(), [3, 0, 0]))

    const state = useMeasurementTool.getState()
    expect(state.draft).toBeNull()
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]).toMatchObject({
      start: [1, 0, 0],
      end: [3, 0, 0],
      view: '3d',
    })
  })

  test('alt-click on a 3D measurable wall adds its length in distance mode', () => {
    handleMeasurementNodeClick3D(nodeEvent(wallNode(), [2, 0, 0], { altKey: true }))

    const state = useMeasurementTool.getState()
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [4, 0, 0],
      measuredDistanceMeters: 4,
      view: '3d',
    })
  })

  test('ctrl-click on a 3D measurable wall quick-adds its length without starting a draft', () => {
    handleMeasurementNodeClick3D(nodeEvent(wallNode(), [2, 0, 0], { ctrlKey: true }))

    const state = useMeasurementTool.getState()
    expect(state.draft).toBeNull()
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [4, 0, 0],
      measuredDistanceMeters: 4,
      view: '3d',
    })
  })

  test('alt-click on a rendered external asset uses its bounding box length', () => {
    const node = spawnNode()
    const mesh = new Mesh(new BoxGeometry(2, 1, 3))
    mesh.position.y = 0.5
    sceneRegistry.nodes.set(node.id as AnyNodeId, mesh)

    handleMeasurementNodeClick3D(nodeEvent(node, [0, 0, 0], { altKey: true, object: mesh }))

    const state = useMeasurementTool.getState()
    expect(state.segments).toHaveLength(1)
    expect(state.segments[0]).toMatchObject({
      measuredDistanceMeters: 3,
      start: [-1, 0, -1.5],
      end: [-1, 0, 1.5],
      view: '3d',
    })
  })
})
