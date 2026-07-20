import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  ConstructionDimensionNode,
  type FloorplanGeometry,
  type GeometryContext,
  nodeRegistry,
  registerNode,
  WallNode,
} from '@pascal-app/core'
import { wallDefinition } from '../wall/definition'
import { buildConstructionDimensionFloorplan } from './floorplan'

const palette = {
  selectedStroke: '#2563eb',
  selectedFill: '#dbeafe',
  selectedHatch: '#93c5fd',
  wallHoverStroke: '#60a5fa',
  endpointHandleFill: '#f97316',
  endpointHandleStroke: '#ffffff',
  endpointHandleHoverStroke: '#fdba74',
  endpointHandleActiveFill: '#ea580c',
  endpointHandleActiveStroke: '#ffffff',
  curveHandleFill: '#14b8a6',
  curveHandleStroke: '#ffffff',
  curveHandleHoverStroke: '#5eead4',
  measurementStroke: '#334155',
  measurementLabelBackground: '#ffffff',
  measurementLabelText: '#0f172a',
}

function context(nodes: Record<string, AnyNode> = {}, selected = false): GeometryContext {
  return {
    resolve: (id) => nodes[id],
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

describe('buildConstructionDimensionFloorplan', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    registerNode(wallDefinition)
  })

  afterEach(() => nodeRegistry._reset())

  test('projects witness origins onto the placed baseline', () => {
    const node = ConstructionDimensionNode.parse({
      anchors: [
        [1, 0, 1],
        [4, 0, 2],
      ],
      baseline: { origin: [0, 5], direction: [1, 0] },
    })

    const geometry = buildConstructionDimensionFloorplan(node, context())
    const dimension = geometry && flatten(geometry).find((entry) => entry.kind === 'dimension')

    expect(dimension).toMatchObject({
      start: [1, 1],
      end: [4, 2],
      dimensionStart: [1, 5],
      dimensionEnd: [4, 5],
      text: '3m',
    })
  })

  test('follows semantic anchors and reports dangling references', () => {
    const wall = WallNode.parse({ id: 'wall_target', start: [0, 0], end: [4, 0] })
    const node = ConstructionDimensionNode.parse({
      anchors: [
        {
          kind: 'feature',
          reference: { nodeId: wall.id, featureId: 'wall:centerline', parameters: { t: 0.25 } },
          fallback: [1, 0, 0],
        },
        [4, 0, 0],
      ],
      baseline: { origin: [0, 1], direction: [1, 0] },
    })

    const linked = buildConstructionDimensionFloorplan(node, context({ [wall.id]: wall }))
    const movedWall = WallNode.parse({ ...wall, start: [2, 0], end: [6, 0] })
    const moved = buildConstructionDimensionFloorplan(node, context({ [wall.id]: movedWall }))
    const dangling = buildConstructionDimensionFloorplan(node, context())
    const linkedDimension = linked && flatten(linked).find((entry) => entry.kind === 'dimension')
    const movedDimension = moved && flatten(moved).find((entry) => entry.kind === 'dimension')
    const danglingDimension =
      dangling && flatten(dangling).find((entry) => entry.kind === 'dimension')

    expect(linkedDimension).toMatchObject({ start: [1, 0], text: '3m' })
    expect(movedDimension).toMatchObject({ start: [3, 0], text: '1m' })
    expect(danglingDimension).toMatchObject({
      start: [1, 0],
      text: 'UNLINKED · 3m',
      stroke: '#dc2626',
    })
  })

  test('renders a continuous string as adjacent associative segments', () => {
    const node = ConstructionDimensionNode.parse({
      anchors: [
        [0, 0, 0],
        [2, 0, 0],
        [5, 0, 0],
        [9, 0, 0],
      ],
      baseline: { origin: [0, 1], direction: [1, 0] },
      chainMode: 'continuous',
    })

    const geometry = buildConstructionDimensionFloorplan(node, context())
    const dimensions = geometry
      ? flatten(geometry).filter((entry) => entry.kind === 'dimension')
      : []

    expect(dimensions).toHaveLength(3)
    expect(
      dimensions.map((dimension) => (dimension.kind === 'dimension' ? dimension.text : '')),
    ).toEqual(['2m', '3m', '4m'])
    expect(dimensions[1]).toMatchObject({
      start: [2, 0],
      end: [5, 0],
      dimensionStart: [2, 1],
      dimensionEnd: [5, 1],
    })
  })

  test('shows one baseline handle only while selected', () => {
    const node = ConstructionDimensionNode.parse({})
    const idle = buildConstructionDimensionFloorplan(node, context())
    const selected = buildConstructionDimensionFloorplan(node, context({}, true))

    expect(idle && flatten(idle).filter((entry) => entry.kind === 'endpoint-handle')).toHaveLength(
      0,
    )
    expect(
      selected && flatten(selected).filter((entry) => entry.kind === 'endpoint-handle'),
    ).toEqual([expect.objectContaining({ affordance: 'move-construction-dimension-baseline' })])
  })

  test('keeps linked or reference geometry read-only in a dependent drawing', () => {
    const node = ConstructionDimensionNode.parse({
      metadata: { drawingCoordinationLocked: true },
    })
    const geometry = buildConstructionDimensionFloorplan(node, context({}, true))

    expect(
      geometry && flatten(geometry).filter((entry) => entry.kind === 'endpoint-handle'),
    ).toHaveLength(0)
  })

  test('renders radius notation with a leader and center mark', () => {
    const node = ConstructionDimensionNode.parse({
      mode: 'radius',
      anchors: [
        [0, 0, 0],
        [2, 0, 0],
      ],
      baseline: { origin: [3, 1], direction: [1, 0] },
    })
    const geometry = buildConstructionDimensionFloorplan(node, context())
    const entries = geometry ? flatten(geometry) : []

    expect(entries.find((entry) => entry.kind === 'dimension-label')).toMatchObject({
      text: 'R 2m',
      cx: 3,
      cy: 1,
    })
    expect(entries.filter((entry) => entry.kind === 'line').length).toBeGreaterThanOrEqual(6)
  })

  test('renders diameter and repeated-feature notation', () => {
    const node = ConstructionDimensionNode.parse({
      mode: 'diameter',
      anchors: [
        [-1, 0, 0],
        [1, 0, 0],
      ],
      featureCount: 6,
      prefix: 'TYP · ',
      suffix: ' CLR',
      reference: true,
    })
    const geometry = buildConstructionDimensionFloorplan(node, context())
    const entries = geometry ? flatten(geometry) : []

    expect(entries.find((entry) => entry.kind === 'dimension')).toMatchObject({
      text: '(TYP · 6 x Ø 2m CLR)',
      start: [-1, 0],
      end: [1, 0],
    })
    expect(entries.filter((entry) => entry.kind === 'line')).toHaveLength(4)
  })

  test('renders a standalone center mark from a center and radius point', () => {
    const node = ConstructionDimensionNode.parse({
      mode: 'center-mark',
      anchors: [
        [3, 0, 4],
        [5, 0, 4],
      ],
    })
    const geometry = buildConstructionDimensionFloorplan(node, context())
    const entries = geometry ? flatten(geometry) : []

    expect(entries.filter((entry) => entry.kind === 'line')).toHaveLength(4)
    expect(entries.some((entry) => entry.kind === 'dimension-label')).toBe(false)
    expect(entries.some((entry) => entry.kind === 'dimension')).toBe(false)
  })

  test('renders chord and arc-length dimensions', () => {
    const chord = ConstructionDimensionNode.parse({
      mode: 'chord',
      anchors: [
        [-1, 0, 0],
        [1, 0, 0],
      ],
      baseline: { origin: [0, 1], direction: [1, 0] },
    })
    const arc = ConstructionDimensionNode.parse({
      mode: 'arc-length',
      anchors: [
        [0, 0, 0],
        [2, 0, 0],
        [0, 0, 2],
      ],
      baseline: { origin: [2, 2], direction: [1, 0] },
    })
    const chordGeometry = buildConstructionDimensionFloorplan(chord, context())
    const arcGeometry = buildConstructionDimensionFloorplan(arc, context())
    const chordEntries = chordGeometry ? flatten(chordGeometry) : []
    const arcEntries = arcGeometry ? flatten(arcGeometry) : []

    expect(chordEntries.find((entry) => entry.kind === 'dimension')).toMatchObject({
      text: 'CH 2m',
    })
    expect(arcEntries.some((entry) => entry.kind === 'path')).toBe(true)
    expect(arcEntries.find((entry) => entry.kind === 'dimension-label')).toMatchObject({
      text: 'ARC 3.14m',
    })
  })

  test('renders angular dimensions with an architectural angle label', () => {
    const node = ConstructionDimensionNode.parse({
      mode: 'angular',
      anchors: [
        [0, 0, 0],
        [2, 0, 0],
        [0, 0, 2],
      ],
      baseline: { origin: [0.5, 0.5], direction: [1, 0] },
    })
    const geometry = buildConstructionDimensionFloorplan(node, context())
    const entries = geometry ? flatten(geometry) : []

    expect(entries.some((entry) => entry.kind === 'path')).toBe(true)
    expect(entries.find((entry) => entry.kind === 'dimension-label')).toMatchObject({
      text: '∠ 90°',
      screenUpright: true,
    })
  })

  test('renders signed coordinate labels for repeated circular features', () => {
    const node = ConstructionDimensionNode.parse({
      mode: 'coordinate',
      anchors: [
        [0, 0, 0],
        [2, 0, 3],
        [-1, 0, 4],
      ],
    })
    const geometry = buildConstructionDimensionFloorplan(node, context())
    const labels = geometry
      ? flatten(geometry)
          .filter((entry) => entry.kind === 'dimension-label')
          .map((entry) => entry.text)
      : []

    expect(labels).toEqual(['P1 · X 2m · Y 3m', 'P2 · X -1m · Y 4m'])
  })
})
