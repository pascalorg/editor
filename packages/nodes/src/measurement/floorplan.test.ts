import { describe, expect, test } from 'bun:test'
import { type FloorplanGeometry, type GeometryContext, MeasurementNode } from '@pascal-app/core'
import { buildMeasurementFloorplan } from './floorplan'

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
  measurementStroke: '#0f766e',
  measurementLabelBackground: '#ffffff',
  measurementLabelText: '#0f172a',
}

const context = (unit: 'metric' | 'imperial'): GeometryContext => ({
  resolve: () => undefined,
  children: [],
  siblings: [],
  parent: null,
  viewState: {
    selected: false,
    unit,
    highlighted: false,
    hovered: false,
    moving: false,
    palette,
  },
})

const labels = (geometry: FloorplanGeometry): string[] => {
  if (geometry.kind === 'dimension-label') return [geometry.text]
  if (geometry.kind === 'group') return geometry.children.flatMap(labels)
  return []
}

const flattenGeometry = (geometry: FloorplanGeometry): FloorplanGeometry[] =>
  geometry.kind === 'group' ? [geometry, ...geometry.children.flatMap(flattenGeometry)] : [geometry]

describe('buildMeasurementFloorplan', () => {
  test('formats distance labels with the active floorplan unit', () => {
    const node = MeasurementNode.parse({
      id: 'measurement_distance',
      type: 'measurement',
      measurement: {
        kind: 'distance',
        points: [
          [0, 0, 0],
          [3.048, 0, 0],
        ],
      },
    })

    const metric = buildMeasurementFloorplan(node, context('metric'))
    const imperial = buildMeasurementFloorplan(node, context('imperial'))

    expect(metric && labels(metric)).toEqual(['3.05m'])
    expect(imperial && labels(imperial)).toEqual([`10'0"`])
    expect(
      metric && flattenGeometry(metric).find((entry) => entry.kind === 'dimension-label'),
    ).toMatchObject({ appearance: 'outlined' })
  })

  test('emits semantic polygon geometry and derived area and volume labels', () => {
    const area = MeasurementNode.parse({
      id: 'measurement_area',
      type: 'measurement',
      measurement: {
        kind: 'area',
        base: [
          [0, 0, 0],
          [2, 0, 0],
          [2, 0, 3],
          [0, 0, 3],
        ],
      },
    })
    const volume = MeasurementNode.parse({
      id: 'measurement_volume',
      type: 'measurement',
      measurement: {
        kind: 'volume',
        base: area.measurement.kind === 'area' ? area.measurement.base : [],
        extrusion: [0, 2, 0],
      },
    })

    const areaGeometry = buildMeasurementFloorplan(area, context('metric'))
    const volumeGeometry = buildMeasurementFloorplan(volume, context('metric'))

    expect(areaGeometry?.kind).toBe('group')
    expect(areaGeometry && labels(areaGeometry)).toEqual(['A 6.0m²'])
    expect(volumeGeometry && labels(volumeGeometry)).toEqual(['V 12.0m³'])
    expect(
      areaGeometry &&
        flattenGeometry(areaGeometry).find((entry) => entry.kind === 'dimension-label'),
    ).toMatchObject({ appearance: 'outlined', screenUpright: true })
    expect(
      volumeGeometry &&
        flattenGeometry(volumeGeometry).find((entry) => entry.kind === 'dimension-label'),
    ).toMatchObject({ appearance: 'outlined', screenUpright: true })
  })

  test('omits hidden measurements', () => {
    const node = MeasurementNode.parse({
      id: 'measurement_hidden',
      type: 'measurement',
      visible: false,
      measurement: {
        kind: 'distance',
        points: [
          [0, 0, 0],
          [1, 0, 0],
        ],
      },
    })

    expect(buildMeasurementFloorplan(node, context('metric'))).toBeNull()
  })

  test('keeps a vertically projected distance selectable in plan view', () => {
    const node = MeasurementNode.parse({
      id: 'measurement_vertical',
      type: 'measurement',
      measurement: {
        kind: 'distance',
        points: [
          [1, 0, 2],
          [1, 3, 2],
        ],
      },
    })

    const geometry = buildMeasurementFloorplan(node, context('metric'))
    expect(geometry).not.toBeNull()
    if (!geometry) return

    const hitTarget = flattenGeometry(geometry).find(
      (entry) => entry.kind === 'circle' && entry.pointerEvents === 'all',
    )
    expect(hitTarget).toMatchObject({
      kind: 'circle',
      cx: 1,
      cy: 2,
      fill: 'transparent',
      pointerEvents: 'all',
    })
  })
})
