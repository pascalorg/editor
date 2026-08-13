'use client'

import {
  type AnyNode,
  type AnyNodeId,
  buildQuantityTakeoff,
  nodeRegistry,
  type QuantitiesContribution,
  type QuantityTakeoff,
  type QuantityUnit,
  quantityTakeoffToCsv,
  useScene,
} from '@pascal-app/core'
import {
  formatAreaLabel,
  formatLinearMeasurement,
  formatVolumeLabel,
  type LinearUnit,
  type MetricNotation,
} from './measurements'

/**
 * The editor's binding of the core takeoff to the live registry and scene.
 *
 * Core stays free of the registry singleton — it takes a lookup — so this is
 * the one place the two meet.
 */
export function takeoffForSubtree(rootId: AnyNodeId): QuantityTakeoff {
  return buildQuantityTakeoff(
    useScene.getState().nodes as Readonly<Record<AnyNodeId, AnyNode>>,
    rootId,
    (kind) => nodeRegistry.get(kind)?.quantities as QuantitiesContribution<AnyNode> | undefined,
  )
}

/** Format a takeoff value for display in the user's chosen units. */
export function formatQuantity(
  value: number,
  quantityUnit: QuantityUnit,
  unit: LinearUnit,
  metricNotation: MetricNotation = 'meters',
): string {
  switch (quantityUnit) {
    case 'length':
      return formatLinearMeasurement(value, unit, metricNotation)
    case 'area':
      return formatAreaLabel(value, unit)
    case 'volume':
      return formatVolumeLabel(value, unit)
    default:
      // A tally is a whole number of things; rounding hides the float drift a
      // summed 1-per-node row can accumulate.
      return String(Math.round(value))
  }
}

/**
 * Hand the CSV to the browser as a download.
 *
 * The blob URL is revoked on the next tick rather than immediately — Safari
 * cancels an in-flight download when its URL is revoked in the same task.
 */
export function downloadQuantityCsv(takeoff: QuantityTakeoff, filename = 'quantities.csv'): void {
  if (typeof document === 'undefined') return

  const blob = new Blob([quantityTakeoffToCsv(takeoff)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
