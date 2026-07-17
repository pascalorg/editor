import type { QuickMeasurementReport, SlabNode } from '@pascal-app/core'
import {
  polygonBoundaryLength,
  polygonReportAnchor,
  polygonSurfaceArea,
} from '../shared/quick-measurement'

export function slabQuickMeasurement(node: SlabNode): QuickMeasurementReport | null {
  if (node.polygon.length < 3) return null
  const thickness = node.elevation ?? 0.05

  return {
    title: node.name ?? 'Floor slab',
    kindLabel: 'Floor slab',
    anchor: polygonReportAnchor(node.polygon, thickness + 0.04),
    metrics: [
      {
        key: 'area',
        label: 'Surface',
        abbreviation: 'A',
        quantity: 'area',
        value: polygonSurfaceArea(node.polygon, node.holes),
      },
      {
        key: 'perimeter',
        label: 'Perimeter',
        abbreviation: 'P',
        quantity: 'length',
        value: polygonBoundaryLength(node.polygon),
      },
      {
        key: 'thickness',
        label: 'Thickness',
        abbreviation: 'T',
        quantity: 'length',
        value: thickness,
      },
    ],
    note: node.holes.length > 0 ? 'Surface excludes slab openings.' : undefined,
  }
}
