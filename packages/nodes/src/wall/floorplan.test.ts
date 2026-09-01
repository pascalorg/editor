import { describe, expect, test } from 'bun:test'
import {
  type FloorplanGeometry,
  type FloorplanPalette,
  type GeometryContext,
  WallNode,
} from '@pascal-app/core'
import { createFloorplanContextExtensions, readFloorplanGeometryMetadata } from '@pascal-app/editor'
import { buildWallFloorplan } from './floorplan'

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

function context(
  purpose: 'edit' | 'document',
  selected = false,
  metricNotation: 'meters' | 'millimeters' = 'meters',
  wallDimensionReference: 'finished-faces' | 'centerline' | 'stud-faces' = 'finished-faces',
  automaticDimensions = true,
): GeometryContext {
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
    extensions: createFloorplanContextExtensions({
      automaticDimensions,
      metricNotation,
      purpose,
      wallDimensionReference,
    }),
  }
}

function flatten(geometry: FloorplanGeometry): FloorplanGeometry[] {
  return geometry.kind === 'group' ? [geometry, ...geometry.children.flatMap(flatten)] : [geometry]
}

describe('buildWallFloorplan render purpose', () => {
  const wall = WallNode.parse({
    id: 'wall_main',
    parentId: 'level_main',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.1,
    frontSide: 'exterior',
    backSide: 'interior',
  })

  test('keeps thin walls legible in edit mode but uses modeled thickness in documents', () => {
    const edit = buildWallFloorplan(wall, context('edit'))
    const document = buildWallFloorplan(wall, context('document'))
    const editPolygon = edit && flatten(edit).find((entry) => entry.kind === 'polygon')
    const documentPolygon = document && flatten(document).find((entry) => entry.kind === 'polygon')

    expect(editPolygon?.kind).toBe('polygon')
    expect(documentPolygon?.kind).toBe('polygon')
    if (editPolygon?.kind !== 'polygon' || documentPolygon?.kind !== 'polygon') return

    const editThickness =
      Math.max(...editPolygon.points.map((point) => point[1])) -
      Math.min(...editPolygon.points.map((point) => point[1]))
    const documentThickness =
      Math.max(...documentPolygon.points.map((point) => point[1])) -
      Math.min(...documentPolygon.points.map((point) => point[1]))
    expect(editThickness).toBeCloseTo(0.13)
    expect(documentThickness).toBeCloseTo(0.1)
    expect(readFloorplanGeometryMetadata(editPolygon).annotationObstacle).toBe('outline')
    expect(readFloorplanGeometryMetadata(documentPolygon).annotationObstacle).toBe('outline')
  })

  test('draws crisp diagonal hatch strokes inside a selected wall', () => {
    const diagonalWall = WallNode.parse({
      ...wall,
      end: [4, 4],
    })
    const selected = buildWallFloorplan(diagonalWall, context('edit', true))
    const selectedOutline = selected
      ? flatten(selected).find((entry) => entry.kind === 'polygon')
      : undefined
    const hatchLines = selected
      ? flatten(selected).filter(
          (entry) => entry.kind === 'line' && entry.stroke === palette.selectedHatch,
        )
      : []

    expect(selectedOutline?.kind).toBe('polygon')
    expect(hatchLines.length).toBeGreaterThan(8)
    expect(
      hatchLines.every(
        (entry) =>
          entry.kind === 'line' &&
          entry.strokeWidth === 0.02 &&
          entry.strokeWidth < (selectedOutline?.strokeWidth ?? 0) &&
          entry.vectorEffect === undefined &&
          entry.pointerEvents === 'none' &&
          readFloorplanGeometryMetadata(entry).renderPass === 'overlay',
      ),
    ).toBe(true)
  })

  test('extends selected-wall hatch strokes to both wall faces', () => {
    const selected = buildWallFloorplan(wall, context('edit', true))
    const entries = selected ? flatten(selected) : []
    const outline = entries.find((entry) => entry.kind === 'polygon')
    const hatch = entries.find(
      (entry) => entry.kind === 'line' && entry.stroke === palette.selectedHatch,
    )

    expect(outline?.kind).toBe('polygon')
    expect(hatch?.kind).toBe('line')
    if (outline?.kind !== 'polygon' || hatch?.kind !== 'line') return

    const wallFaces = outline.points.map((point) => point[1])
    expect(Math.min(hatch.y1, hatch.y2)).toBeCloseTo(Math.min(...wallFaces))
    expect(Math.max(hatch.y1, hatch.y2)).toBeCloseTo(Math.max(...wallFaces))
  })

  test('uses document metric notation only for document output', () => {
    const edit = buildWallFloorplan(wall, context('edit'))
    const document = buildWallFloorplan(wall, context('document'))
    const texts = (geometry: FloorplanGeometry | null) =>
      geometry
        ? flatten(geometry).flatMap((entry) =>
            entry.kind === 'dimension-string' ? entry.segments.map((segment) => segment.text) : [],
          )
        : []

    expect(texts(edit)).toContain('4m')
    expect(texts(document)).toContain('4000')
  })

  test('uses the live millimeter notation in edit mode', () => {
    const edit = buildWallFloorplan(wall, context('edit', false, 'millimeters'))
    const texts = edit
      ? flatten(edit).flatMap((entry) =>
          entry.kind === 'dimension-string' ? entry.segments.map((segment) => segment.text) : [],
        )
      : []

    expect(texts).toContain('4000')
  })

  test('does not construct automatic wall dimensions when presentation disables them', () => {
    const geometry = buildWallFloorplan(
      wall,
      context('edit', false, 'meters', 'finished-faces', false),
    )
    const entries = geometry ? flatten(geometry) : []

    expect(
      entries.some(
        (entry) =>
          entry.kind === 'dimension' ||
          entry.kind === 'dimension-string' ||
          entry.kind === 'dimension-label',
      ),
    ).toBe(false)
    expect(entries.some((entry) => entry.kind === 'polygon')).toBe(true)
  })

  test('keeps standalone wall witnesses on the wall face in every intersection mode', () => {
    const plainWall = WallNode.parse({
      ...wall,
      thickness: 0.1,
    })
    const witnessY = (reference: 'finished-faces' | 'centerline' | 'stud-faces') => {
      const geometry = buildWallFloorplan(plainWall, context('edit', false, 'meters', reference))
      const dimension = geometry
        ? flatten(geometry).find((entry) => entry.kind === 'dimension-string')
        : undefined
      return dimension?.kind === 'dimension-string' ? dimension.segments[0]?.start[1] : undefined
    }

    expect(witnessY('finished-faces')).toBeCloseTo(0.065)
    expect(witnessY('centerline')).toBeCloseTo(0.065)
    expect(witnessY('stud-faces')).toBeCloseTo(0.065)
  })

  test('shows an orthogonal depth dimension for a curved wall without a radius leader', () => {
    const curved = WallNode.parse({ ...wall, curveOffset: 1 })
    const geometry = buildWallFloorplan(curved, context('edit'))
    const entries = geometry ? flatten(geometry) : []

    expect(entries.find((entry) => entry.kind === 'dimension-label')).toBeUndefined()
    expect(entries.find((entry) => entry.kind === 'dimension-string')).toMatchObject({
      kind: 'dimension-string',
      segments: [{ text: '1m' }],
    })
  })

  test('places selected move arrows on the curved wall midpoint', () => {
    const curved = WallNode.parse({ ...wall, curveOffset: 1 })
    const geometry = buildWallFloorplan(curved, context('edit', true))
    const arrows = geometry ? flatten(geometry).filter((entry) => entry.kind === 'move-arrow') : []

    expect(arrows).toHaveLength(2)
    expect(arrows[0]).toMatchObject({ kind: 'move-arrow', angle: Math.PI / 2 })
    expect(arrows[1]).toMatchObject({ kind: 'move-arrow', angle: -Math.PI / 2 })
    if (arrows[0]?.kind !== 'move-arrow' || arrows[1]?.kind !== 'move-arrow') return
    expect(arrows[0].point[0]).toBeCloseTo(2)
    expect(arrows[0].point[1]).toBeCloseTo(-0.885)
    expect(arrows[1].point[0]).toBeCloseTo(2)
    expect(arrows[1].point[1]).toBeCloseTo(-1.115)
  })

  test('places thickness handles on both visible faces of a curved wall', () => {
    const curved = WallNode.parse({ ...wall, curveOffset: 1 })
    const geometry = buildWallFloorplan(curved, context('edit', true))
    const handles = geometry
      ? flatten(geometry).filter(
          (entry) => entry.kind === 'endpoint-handle' && entry.affordance === 'thickness',
        )
      : []

    expect(handles).toHaveLength(2)
    if (handles[0]?.kind !== 'endpoint-handle' || handles[1]?.kind !== 'endpoint-handle') return
    expect(handles[0].point[0]).toBeCloseTo(2)
    expect(handles[0].point[1]).toBeCloseTo(-0.935)
    expect(handles[1].point[0]).toBeCloseTo(2)
    expect(handles[1].point[1]).toBeCloseTo(-1.065)
  })
})
