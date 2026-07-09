import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { AnyNode, GridEvent, NodeEvent } from '@pascal-app/core'
import { useMeasurementTool } from '../../../store/use-measurement-tool'
import {
  handleMeasurementGridClick3D,
  handleMeasurementGridMove3D,
  handleMeasurementNodeClick3D,
} from './measurement-tool'

beforeAll(() => {
  class TestCanvas {}
  globalThis.HTMLCanvasElement = TestCanvas as never
})

beforeEach(() => {
  useMeasurementTool.getState().clear()
  useMeasurementTool.getState().setMode('distance')
})

afterEach(() => {
  useMeasurementTool.getState().clear()
  useMeasurementTool.getState().setMode('distance')
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
  options: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
): NodeEvent {
  return {
    node,
    position,
    localPosition: position,
    object: {} as never,
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

describe('measurement 3D grid handlers', () => {
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
