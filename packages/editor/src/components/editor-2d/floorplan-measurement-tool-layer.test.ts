import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, type GridEvent, useScene } from '@pascal-app/core'
import { useMeasurementTool } from '../../store/use-measurement-tool'
import {
  handleFloorplanMeasurementGridClick,
  handleFloorplanMeasurementGridMove,
  handleFloorplanMeasurementNodeClick2D,
} from './floorplan-measurement-tool-layer'

beforeAll(() => {
  class TestCanvas {}
  globalThis.HTMLCanvasElement = TestCanvas as never
})

beforeEach(() => {
  useScene.getState().clearScene()
  useMeasurementTool.getState().clear()
  useMeasurementTool.getState().setMode('distance')
})

afterEach(() => {
  useScene.getState().clearScene()
  useMeasurementTool.getState().clear()
  useMeasurementTool.getState().setMode('distance')
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

function seedScene(nodes: AnyNode[]) {
  useScene.setState({
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: nodes.map((node) => node.id as AnyNodeId),
    dirtyNodes: new Set(),
    collections: {},
  } as never)
}

describe('floorplan measurement grid handlers', () => {
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
      label: 'Endpoint',
      point: [0, 0, 0],
      view: '2d',
    })
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

  test('shows 2D snap target feedback while moving before first placement', () => {
    seedScene([wallNode()])

    handleFloorplanMeasurementGridMove(gridEvent([2.04, 0, 0.04]))

    expect(useMeasurementTool.getState().snapTarget).toMatchObject({
      label: 'Midpoint',
      point: [2, 0, 0],
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
      labelPoint: [2, 0, 1.5],
      view: '2d',
    })
    expect(state.perimeters).toHaveLength(0)
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

  test('alt-click on a 2D surface adds perimeter only', () => {
    const handled = handleFloorplanMeasurementNodeClick2D(zoneNode() as never, { altKey: true })

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

  test('alt-click on a 2D measurable wall adds its length in distance mode', () => {
    const handled = handleFloorplanMeasurementNodeClick2D(wallNode() as never, { altKey: true })

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
    const handled = handleFloorplanMeasurementNodeClick2D(wallNode() as never, { ctrlKey: true })

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

  test('deleteSelected removes the selected 2D measurement', () => {
    handleFloorplanMeasurementNodeClick2D(wallNode() as never, { altKey: true })

    expect(useMeasurementTool.getState().segments).toHaveLength(1)
    useMeasurementTool.getState().deleteSelected()

    expect(useMeasurementTool.getState().segments).toHaveLength(0)
    expect(useMeasurementTool.getState().selectedId).toBeNull()
  })
})
