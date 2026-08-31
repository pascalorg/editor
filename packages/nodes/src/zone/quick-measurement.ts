import {
  type GeometryContext,
  type QuickMeasurementReport,
  resolveAutoZonePolygon,
  type ZoneNode,
} from '@pascal-app/core'
import {
  polygonBoundaryLength,
  polygonReportAnchor,
  polygonSurfaceArea,
} from '../shared/quick-measurement'

export function zoneQuickMeasurement(
  node: ZoneNode,
  context?: GeometryContext,
): QuickMeasurementReport | null {
  const polygon = context ? resolveAutoZonePolygon(node, context.resolve) : node.polygon
  if (polygon.length < 3) return null

  return {
    title: node.name,
    kindLabel: 'Zone',
    anchor: polygonReportAnchor(polygon, 0.08),
    metrics: [
      {
        key: 'area',
        label: 'Footprint',
        abbreviation: 'A',
        quantity: 'area',
        value: polygonSurfaceArea(polygon),
      },
      {
        key: 'perimeter',
        label: 'Perimeter',
        abbreviation: 'P',
        quantity: 'length',
        value: polygonBoundaryLength(polygon),
      },
    ],
    note: 'Footprint only — room envelope not proven.',
  }
}
