import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BeamNode,
  type FloorplanGeometry,
  type FloorplanPalette,
  type GeometryContext,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { buildBeamFloorplan } from './floorplan'
import { beamMoveEndpointAffordance } from './floorplan-affordances'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const palette: FloorplanPalette = {
  selectedStroke: '#334155',
  selectedFill: '#ffffff',
  selectedHatch: '#334155',
  wallHoverStroke: '#334155',
  endpointHandleFill: '#ffffff',
  endpointHandleStroke: '#334155',
  endpointHandleHoverStroke: '#334155',
  endpointHandleActiveFill: '#334155',
  endpointHandleActiveStroke: '#334155',
  curveHandleFill: '#ffffff',
  curveHandleStroke: '#334155',
  curveHandleHoverStroke: '#334155',
  measurementStroke: '#334155',
  measurementLabelBackground: '#ffffff',
  measurementLabelText: '#111827',
}

function context(selected = false): GeometryContext {
  return {
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: null,
    viewState: {
      selected,
      unit: 'metric',
      highlighted: false,
      hovered: false,
      moving: false,
      palette,
    },
  }
}

function flatten(geometry: FloorplanGeometry): FloorplanGeometry[] {
  return geometry.kind === 'group' ? [geometry, ...geometry.children.flatMap(flatten)] : [geometry]
}

describe('buildBeamFloorplan', () => {
  const beam = BeamNode.parse({
    id: 'beam_main',
    parentId: 'level_main',
    start: [0, 0],
    end: [4, 0],
    width: 0.3,
    depth: 0.6,
    elevation: 3,
  })

  test('emits a width band around the centreline with a hit-line', () => {
    const geometry = buildBeamFloorplan(beam, context())
    expect(geometry).not.toBeNull()
    if (!geometry) return
    const entries = flatten(geometry)
    const polygon = entries.find((entry) => entry.kind === 'polygon')
    const hitLine = entries.find((entry) => entry.kind === 'hit-line')

    expect(polygon?.kind).toBe('polygon')
    expect(hitLine?.kind).toBe('hit-line')
    if (polygon?.kind !== 'polygon') return
    // Band is width (0.3) wide across the centreline: y ranges ±0.15.
    const ys = polygon.points.map((point) => point[1])
    expect(Math.max(...ys)).toBeCloseTo(0.15)
    expect(Math.min(...ys)).toBeCloseTo(-0.15)
    expect(Math.max(...polygon.points.map((point) => point[0]))).toBeCloseTo(4)
  })

  test('emits endpoint handles, side arrows and a length label when selected', () => {
    const geometry = buildBeamFloorplan(beam, context(true))
    if (!geometry) return
    const entries = flatten(geometry)
    const handles = entries.filter((entry) => entry.kind === 'endpoint-handle')
    const arrows = entries.filter((entry) => entry.kind === 'move-arrow')
    const label = entries.find((entry) => entry.kind === 'dimension-label')

    expect(handles).toHaveLength(2)
    expect(arrows).toHaveLength(2)
    expect(label).toMatchObject({ kind: 'dimension-label', text: '4m' })
    // No hit-line while selected — the handles + arrows take over.
    expect(entries.find((entry) => entry.kind === 'hit-line')).toBeUndefined()
  })

  test('returns null for a collapsed centreline', () => {
    const collapsed = BeamNode.parse({ ...beam, start: [1, 1], end: [1, 1] })
    expect(buildBeamFloorplan(collapsed, context())).toBeNull()
  })
})

describe('beamMoveEndpointAffordance', () => {
  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
  })

  const modifiers = {
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  }

  test('moves the dragged endpoint and commits both in one tracked write', () => {
    const beam = BeamNode.parse({
      id: 'beam_drag',
      parentId: null,
      start: [0, 0],
      end: [4, 0],
      width: 0.3,
      depth: 0.6,
      elevation: 3,
    })
    useScene.setState({ nodes: { [beam.id]: beam } as never })

    const session = beamMoveEndpointAffordance.start({
      node: beam,
      payload: { beamId: beam.id, endpoint: 'end' },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [4, 0],
      gridSnapStep: 0.1,
    })
    session.apply({ planPoint: [6, 0], modifiers })

    // Scene untouched during the drag; the override previews the new span.
    expect((useScene.getState().nodes[beam.id] as typeof beam).end).toEqual([4, 0])
    expect(useLiveNodeOverrides.getState().get(beam.id as AnyNodeId)?.end).toEqual([6, 0])

    expect(session.canCommit()).toBe(true)
    session.commit?.()

    expect((useScene.getState().nodes[beam.id] as typeof beam).end).toEqual([6, 0])
    expect(useLiveNodeOverrides.getState().get(beam.id as AnyNodeId)).toBeUndefined()
  })

  test('rejects a collapsed span at commit', () => {
    const beam = BeamNode.parse({
      id: 'beam_collapse',
      parentId: null,
      start: [0, 0],
      end: [4, 0],
      width: 0.3,
      depth: 0.6,
      elevation: 3,
    })
    useScene.setState({ nodes: { [beam.id]: beam } as never })

    const session = beamMoveEndpointAffordance.start({
      node: beam,
      payload: { beamId: beam.id, endpoint: 'end' },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [4, 0],
      gridSnapStep: 0.1,
    })
    // Snap the end onto the fixed start — the span collapses.
    session.apply({ planPoint: [0, 0], modifiers })
    expect(session.canCommit()).toBe(false)
  })
})
