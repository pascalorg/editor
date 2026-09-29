import type { QuickMeasurementReport, ZoneNode } from '@pascal-app/core'
import {
  polygonBoundaryLength,
  polygonReportAnchor,
  polygonSurfaceArea,
} from '../shared/quick-measurement'

export function zoneQuickMeasurement(node: ZoneNode): QuickMeasurementReport | null {
  if (node.autoFromWalls && node.enclosureStatus === 'open') return null
  const polygon = node.polygon
  if (polygon.length < 3) return null

  return {
    title: node.name,
    kindLabel: node.spaceRole === 'room' ? 'Room' : 'Zone',
    anchor: polygonReportAnchor(polygon, 0.08),
    metrics: [
      {
        key: 'area',
        label: 'Footprint',
        abbreviation: 'A',
        quantity: 'area',
        value: polygonSurfaceArea(polygon, node.holes),
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
