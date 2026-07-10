import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type GridEvent,
  type NodeEvent,
  useScene,
} from '@pascal-app/core'
import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three'
import {
  DEFAULT_MEASUREMENT_SNAP_SETTINGS,
  type MeasurementSnapKind,
  useMeasurementTool,
} from '../../../store/use-measurement-tool'
import {
  getMeasurementValuePillClassName,
  handleMeasurementGridClick3D,
  handleMeasurementGridMove3D,
  handleMeasurementNodeClick3D,
  staggerMeasurementLabelLayouts3D,
} from './measurement-tool'

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
    stopPropagation: () => {},
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
  test('uses the shared floating pill visual language for 3D measurement values', () => {
    const className = getMeasurementValuePillClassName({})

    expect(className).toContain('rounded-full')
    expect(className).toContain('border-border/60')
    expect(className).toContain('bg-background/90')
    expect(className).toContain('px-4')
    expect(className).toContain('py-1.5')
    expect(className).toContain('text-xs')
    expect(className).toContain('tabular-nums')
    expect(className).toContain('shadow-sm')
    expect(className).toContain('backdrop-blur')
  })

  test('adds measurement value pill states without changing the base shape', () => {
    const className = getMeasurementValuePillClassName({
      draft: true,
      interactive: true,
      isSelected: false,
    })

    expect(className).toContain('rounded-full')
    expect(className).toContain('pointer-events-auto')
    expect(className).toContain('cursor-pointer')
    expect(className).toContain('border-amber-500/60')
    expect(className).toContain('text-amber-700')
    expect(className).toContain('opacity-45')
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

  test('shift locks the 3D draft endpoint to the strongest axis while drawing', () => {
    const canvas = new globalThis.HTMLCanvasElement()

    handleMeasurementGridClick3D(gridEvent([0, 0, 0], canvas), canvas)
    handleMeasurementGridMove3D(gridEvent([1, 2, 5], canvas, { shiftKey: true }), canvas)
    handleMeasurementGridClick3D(gridEvent([1, 2, 5], canvas, { shiftKey: true }), canvas)

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [0, 0, 5],
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

  test('shift locks the committed 3D surface endpoint after snapping', () => {
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [0.08, 0, 0.06]))
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [3.92, 0, 2.92], { shiftKey: true }))

    expect(useMeasurementTool.getState().segments[0]).toMatchObject({
      start: [0, 0, 0],
      end: [4, 0, 0],
      view: '3d',
    })
  })

  test('snaps 3D angle points to nearby surface anchors', () => {
    useMeasurementTool.getState().setMode('angle')

    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [0.08, 0, 0.06]))
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [2.02, 0, 1.52]))
    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [3.92, 0, 2.92]))

    expect(useMeasurementTool.getState().angles[0]).toMatchObject({
      first: [0, 0, 0],
      vertex: [2, 0, 1.5],
      second: [4, 0, 3],
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

    handleMeasurementGridClick3D(gridEvent([1, 0, 0], canvas), canvas)
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

  test('shows 3D grid snap target feedback on grid movement', () => {
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
      labelPoint: [2, 0.05, 1.5],
      view: '3d',
    })
    expect(state.perimeters).toHaveLength(0)
  })

  test('adds 3D surface perimeter in perimeter mode', () => {
    useMeasurementTool.getState().setMode('perimeter')

    handleMeasurementNodeClick3D(nodeEvent(zoneNode(), [2, 0, 1.5]))

    const state = useMeasurementTool.getState()
    expect(state.perimeters).toHaveLength(1)
    expect(state.perimeters[0]).toMatchObject({
      labelPoint: [2, 0.05, 1.5],
      lengthMeters: 14,
      view: '3d',
    })
    expect(state.areas).toHaveLength(0)
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
})
