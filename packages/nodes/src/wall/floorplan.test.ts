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

  test('keeps standalone wall witnesses on the stud face in every intersection mode', () => {
    const assemblyWall = WallNode.parse({
      ...wall,
      thickness: undefined,
      assemblyLayers: [
        {
          id: 'stud-core',
          role: 'structure',
          side: 'core',
          thickness: 0.1,
          materialRef: 'library:stud',
          datumEligible: ['structural-face'],
        },
        {
          id: 'interior-finish',
          role: 'interior-finish',
          side: 'interior',
          thickness: 0.02,
          materialRef: 'library:gypsum-board',
          datumEligible: ['finish-face'],
        },
        {
          id: 'exterior-finish',
          role: 'exterior-finish',
          side: 'exterior',
          thickness: 0.03,
          materialRef: 'library:cladding',
          datumEligible: ['finish-face'],
        },
      ],
    })
    const witnessY = (reference: 'finished-faces' | 'centerline' | 'stud-faces') => {
      const geometry = buildWallFloorplan(assemblyWall, context('edit', false, 'meters', reference))
      const dimension = geometry
        ? flatten(geometry).find((entry) => entry.kind === 'dimension-string')
        : undefined
      return dimension?.kind === 'dimension-string' ? dimension.segments[0]?.start[1] : undefined
    }

    expect(witnessY('finished-faces')).toBeCloseTo(0.05)
    expect(witnessY('centerline')).toBeCloseTo(0.05)
    expect(witnessY('stud-faces')).toBeCloseTo(0.05)
  })

  test('uses total assembly thickness and emits construction graphics for modeled layers', () => {
    const assemblyWall = WallNode.parse({
      ...wall,
      thickness: undefined,
      assemblyLayers: [
        {
          id: 'block-core',
          role: 'concrete-block',
          side: 'core',
          thickness: 0.19,
          materialRef: 'library:cmu',
          datumEligible: ['structural-face'],
        },
        {
          id: 'interior-furring',
          role: 'furring',
          side: 'interior',
          thickness: 0.025,
          materialRef: 'library:furring',
          datumEligible: [],
        },
        {
          id: 'interior-gwb',
          role: 'interior-finish',
          side: 'interior',
          thickness: 0.016,
          materialRef: 'library:gypsum-board',
          datumEligible: ['finish-face'],
        },
        {
          id: 'exterior-air-space',
          role: 'air-space',
          side: 'exterior',
          thickness: 0.025,
          materialRef: '',
          datumEligible: [],
        },
        {
          id: 'brick-veneer',
          role: 'masonry-veneer',
          side: 'exterior',
          thickness: 0.09,
          materialRef: 'library:brick',
          datumEligible: ['veneer-face'],
        },
      ],
    })

    const document = buildWallFloorplan(assemblyWall, context('document'))
    const entries = document ? flatten(document) : []
    const polygons = entries.filter((entry) => entry.kind === 'polygon')
    const mainPolygon = polygons[0]

    expect(mainPolygon?.kind).toBe('polygon')
    if (mainPolygon?.kind !== 'polygon') return

    const documentThickness =
      Math.max(...mainPolygon.points.map((point) => point[1])) -
      Math.min(...mainPolygon.points.map((point) => point[1]))
    expect(documentThickness).toBeCloseTo(0.346)

    const layerPolygons = polygons.slice(1)
    expect(layerPolygons).toHaveLength(5)
    expect(
      layerPolygons.every((entry) => entry.kind === 'polygon' && entry.pointerEvents === 'none'),
    ).toBe(true)
    expect(
      layerPolygons.map((entry) => (entry.kind === 'polygon' ? entry.fill : undefined)),
    ).toEqual(['#cbd5e1', '#fde68a', '#f8fafc', '#ffffff', '#fca5a5'])

    const lines = entries.filter((entry) => entry.kind === 'line')
    expect(lines.some((entry) => entry.kind === 'line' && entry.stroke === '#991b1b')).toBe(true)
    expect(
      lines.some(
        (entry) =>
          entry.kind === 'line' &&
          entry.stroke === '#64748b' &&
          entry.strokeDasharray === '0.035 0.025',
      ),
    ).toBe(true)
    expect(
      lines.some(
        (entry) =>
          entry.kind === 'line' &&
          entry.stroke === '#92400e' &&
          entry.strokeDasharray === '0.04 0.02',
      ),
    ).toBe(true)
    expect(
      lines.filter(
        (entry) =>
          entry.kind === 'line' && entry.stroke === '#111827' && entry.strokeWidth === 0.85,
      ),
    ).toHaveLength(2)
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
})
