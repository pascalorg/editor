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
import { createFloorplanContextExtensions } from '@pascal-app/editor'
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

function context(
  nodes: Record<string, AnyNode> = {},
  selected = false,
  purpose: 'edit' | 'document' = 'edit',
  metricNotation?: 'meters' | 'millimeters',
): GeometryContext {
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
    extensions: createFloorplanContextExtensions({ metricNotation, purpose }),
  }
}

function flatten(geometry: FloorplanGeometry): FloorplanGeometry[] {
  return geometry.kind === 'group' ? [geometry, ...geometry.children.flatMap(flatten)] : [geometry]
}

function dimensionSegments(geometry: FloorplanGeometry | null): Array<{
  start: readonly [number, number]
  end: readonly [number, number]
  dimensionStart?: readonly [number, number]
  dimensionEnd?: readonly [number, number]
  text: string
  stroke?: string
}> {
  if (!geometry) return []
  return flatten(geometry).flatMap((entry) => {
    if (entry.kind === 'dimension') return [entry]
    if (entry.kind === 'dimension-string')
      return entry.segments.map((segment) => ({ ...segment, stroke: entry.stroke }))
    return []
  })
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
    const dimension = dimensionSegments(geometry)[0]

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
    const linkedDimension = dimensionSegments(linked)[0]
    const movedDimension = dimensionSegments(moved)[0]
    const danglingDimension = dimensionSegments(dangling)[0]

    expect(linkedDimension).toMatchObject({ start: [1, 0], text: '3m' })
    expect(movedDimension).toMatchObject({ start: [3, 0], text: '1m' })
    expect(danglingDimension).toMatchObject({
      start: [1, 0],
      text: 'UNLINKED · 3m',
      stroke: '#dc2626',
    })
  })

  test('resolves wall anchors against the selected assembly datum', () => {
    const wall = WallNode.parse({
      id: 'wall_assembly',
      start: [0, 0],
      end: [4, 0],
      assemblyLayers: [
        {
          id: 'stud-core',
          role: 'structure',
          side: 'core',
          thickness: 0.1,
          datumEligible: ['structural-face'],
        },
        {
          id: 'exterior-finish',
          role: 'exterior-finish',
          side: 'exterior',
          thickness: 0.03,
          datumEligible: ['finish-face'],
        },
      ],
    })
    const anchor = {
      kind: 'feature' as const,
      reference: { nodeId: wall.id, featureId: 'wall:centerline', parameters: { t: 0.25 } },
      fallback: [1, 0, 0] as [number, number, number],
    }
    const build = (datumPolicy: 'centerline' | 'wall-face' | 'structural-face' | 'finish-face') =>
      buildConstructionDimensionFloorplan(
        ConstructionDimensionNode.parse({
          anchors: [anchor, [3, 0, 0]],
          baseline: { origin: [0, 1], direction: [1, 0] },
          datumPolicy,
        }),
        context({ [wall.id]: wall }),
      )

    expect(dimensionSegments(build('centerline'))[0]?.start).toEqual([1, 0])
    expect(dimensionSegments(build('structural-face'))[0]?.start[1]).toBeCloseTo(0.05)
    expect(dimensionSegments(build('finish-face'))[0]?.start[1]).toBeCloseTo(0.08)
    expect(dimensionSegments(build('wall-face'))[0]?.start[1]).toBeCloseTo(0.08)
  })

  test('uses millimetre notation in document output', () => {
    const node = ConstructionDimensionNode.parse({
      anchors: [
        [0, 0, 0],
        [3, 0, 0],
      ],
      baseline: { origin: [0, 1], direction: [1, 0] },
    })

    expect(
      dimensionSegments(
        buildConstructionDimensionFloorplan(node, context({}, false, 'document')),
      )[0]?.text,
    ).toBe('3000')
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
    const dimensions = dimensionSegments(geometry)

    expect(dimensions).toHaveLength(3)
    expect(dimensions.map((dimension) => dimension.text)).toEqual(['2m', '3m', '4m'])
    expect(dimensions[1]).toMatchObject({
      start: [2, 0],
      end: [5, 0],
      dimensionStart: [2, 1],
      dimensionEnd: [5, 1],
    })
  })

  test('renders point-to-point strings as independent witness pairs', () => {
    const node = ConstructionDimensionNode.parse({
      anchors: [
        [0, 0, 0],
        [2, 0, 0],
        [5, 0, 0],
        [9, 0, 0],
      ],
      baseline: { origin: [0, 1], direction: [1, 0] },
      chainMode: 'point-to-point',
    })

    const geometry = buildConstructionDimensionFloorplan(node, context())
    const dimensions = dimensionSegments(geometry)

    expect(dimensions).toHaveLength(2)
    expect(dimensions.map((dimension) => dimension.text)).toEqual(['2m', '4m'])
    expect(dimensions[1]).toMatchObject({
      start: [5, 0],
      end: [9, 0],
      dimensionStart: [5, 1],
      dimensionEnd: [9, 1],
    })
  })

  test('suppresses view-specific string segments without mutating physical anchors', () => {
    const node = ConstructionDimensionNode.parse({
      anchors: [
        [0, 0, 0],
        [2, 0, 0],
        [5, 0, 0],
        [9, 0, 0],
      ],
      baseline: { origin: [0, 1], direction: [1, 0] },
      chainMode: 'continuous',
      metadata: { suppressedDimensionSegmentIndexes: [1] },
    })

    const geometry = buildConstructionDimensionFloorplan(node, context())
    const dimensions = dimensionSegments(geometry)

    expect(node.anchors).toHaveLength(4)
    expect(dimensions).toHaveLength(2)
    expect(dimensions.map((dimension) => dimension.text)).toEqual(['2m', '4m'])
  })

  test('passes persistent dimension standards to linear dimension strings', () => {
    const node = ConstructionDimensionNode.parse({
      anchors: [
        [0, 0, 0],
        [2, 0, 0],
      ],
      baseline: { origin: [0, 1], direction: [1, 0] },
      datumPolicy: 'finish-face',
      terminator: 'dot',
      textPosition: 'centered',
      metricNotation: 'millimeters',
      extensionStartGap: 0.025,
      extensionOvershoot: 0.08,
    })

    const geometry = buildConstructionDimensionFloorplan(node, context({}, false, 'document'))
    const string = geometry
      ? flatten(geometry).find((entry) => entry.kind === 'dimension-string')
      : null

    expect(string).toMatchObject({
      terminator: 'dot',
      textPosition: 'centered',
      extensionStartGap: 0.025,
      extensionOvershoot: 0.08,
    })
    expect(dimensionSegments(geometry)[0]?.text).toBe('2000')
  })

  test('uses the live metric notation for manual dimensions in edit mode', () => {
    const node = ConstructionDimensionNode.parse({
      anchors: [
        [0, 0, 0],
        [2, 0, 0],
      ],
      baseline: { origin: [0, 1], direction: [1, 0] },
    })

    const geometry = buildConstructionDimensionFloorplan(
      node,
      context({}, false, 'edit', 'millimeters'),
    )
    expect(dimensionSegments(geometry)[0]?.text).toBe('2000')
  })

  test('shows witness and baseline handles only while selected', () => {
    const node = ConstructionDimensionNode.parse({})
    const idle = buildConstructionDimensionFloorplan(node, context())
    const selected = buildConstructionDimensionFloorplan(node, context({}, true))

    expect(idle && flatten(idle).filter((entry) => entry.kind === 'endpoint-handle')).toHaveLength(
      0,
    )
    const handles = selected
      ? flatten(selected).filter((entry) => entry.kind === 'endpoint-handle')
      : []
    expect(handles).toHaveLength(3)
    expect(handles).toContainEqual(
      expect.objectContaining({
        affordance: 'move-construction-dimension-witness',
        payload: { witnessIndex: 0 },
      }),
    )
    expect(handles).toContainEqual(
      expect.objectContaining({
        affordance: 'move-construction-dimension-witness',
        payload: { witnessIndex: 1 },
      }),
    )
    expect(handles).toContainEqual(
      expect.objectContaining({ affordance: 'move-construction-dimension-baseline' }),
    )
  })

  test('keeps linked geometry read-only in a dependent drawing', () => {
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

  test('updates an associative curved-wall radius when the host curve changes', () => {
    const wall = WallNode.parse({
      id: 'wall_curve',
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
    })
    const node = ConstructionDimensionNode.parse({
      mode: 'radius',
      anchors: [
        {
          kind: 'feature',
          reference: { nodeId: wall.id, featureId: 'wall:curve:center' },
          fallback: [2, 0, 1.5],
        },
        {
          kind: 'feature',
          reference: { nodeId: wall.id, featureId: 'wall:midpoint' },
          fallback: [2, 0, -1],
        },
      ],
      baseline: { origin: [2, -1.5], direction: [0, -1] },
    })
    const reshapedWall = WallNode.parse({ ...wall, curveOffset: 0.5 })
    const original = buildConstructionDimensionFloorplan(node, context({ [wall.id]: wall }))
    const reshaped = buildConstructionDimensionFloorplan(node, context({ [wall.id]: reshapedWall }))
    const originalLabel =
      original && flatten(original).find((entry) => entry.kind === 'dimension-label')
    const reshapedLabel =
      reshaped && flatten(reshaped).find((entry) => entry.kind === 'dimension-label')

    expect(originalLabel).toMatchObject({ text: 'R 2.5m' })
    expect(reshapedLabel).toMatchObject({ text: 'R 4.25m' })
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
    })
    const geometry = buildConstructionDimensionFloorplan(node, context())
    const entries = geometry ? flatten(geometry) : []

    expect(dimensionSegments(geometry)[0]).toMatchObject({
      text: 'TYP · 6 x Ø 2m CLR',
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
    expect(dimensionSegments(geometry).length).toBe(0)
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
        [2, 0, 0],
        [0, 0, 0],
        [0, 0, 2],
      ],
      baseline: { origin: [2, 2], direction: [1, 0] },
    })
    const chordGeometry = buildConstructionDimensionFloorplan(chord, context())
    const arcGeometry = buildConstructionDimensionFloorplan(arc, context())
    const chordEntries = chordGeometry ? flatten(chordGeometry) : []
    const arcEntries = arcGeometry ? flatten(arcGeometry) : []

    expect(dimensionSegments(chordGeometry)[0]).toMatchObject({
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
        [2, 0, 0],
        [0, 0, 0],
        [0, 0, 2],
      ],
      baseline: { origin: [1.5, 0.5], direction: [1, 0] },
    })
    const geometry = buildConstructionDimensionFloorplan(node, context())
    const entries = geometry ? flatten(geometry) : []

    expect(entries.some((entry) => entry.kind === 'path')).toBe(true)
    expect(entries.find((entry) => entry.kind === 'dimension-label')).toMatchObject({
      cx: 1.5,
      cy: 0.5,
      text: '∠ 90°',
      screenUpright: true,
    })
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'line', x2: 1.5, y2: 0.5 }))
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
