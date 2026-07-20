import { describe, expect, test } from 'bun:test'
import {
  type FloorplanGeometry,
  type FloorplanPalette,
  type GeometryContext,
  WallNode,
} from '@pascal-app/core'
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

function context(purpose: 'edit' | 'document'): GeometryContext {
  return {
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: null,
    viewState: {
      selected: false,
      unit: 'metric',
      purpose,
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
  })

  test('uses document metric notation only for document output', () => {
    const edit = buildWallFloorplan(wall, context('edit'))
    const document = buildWallFloorplan(wall, context('document'))
    const texts = (geometry: FloorplanGeometry | null) =>
      geometry
        ? flatten(geometry).flatMap((entry) => (entry.kind === 'dimension' ? [entry.text] : []))
        : []

    expect(texts(edit)).toContain('4m')
    expect(texts(document)).toContain('4000')
  })
})
