import {
  getWallCurveLength,
  getWallThickness,
  type QuantitiesContribution,
  type QuantityRow,
  type WallNode,
} from '@pascal-app/core'
import { resolveWallOpeningCeiling } from '../shared/wall-opening-ceiling'

/**
 * Wall takeoff: centreline length, gross face area and volume.
 *
 * Face area is gross — before openings — and says so, matching what
 * `wallQuickMeasure` already reports. Netting doors and windows out needs the
 * opening geometry each wall hosts, which is a separate piece of work; a
 * quietly-net number would be worse than an honestly-gross one.
 */
export const wallQuantities: QuantitiesContribution<WallNode> = (walls, ctx) => {
  const rows: QuantityRow[] = []

  for (const wall of walls) {
    const length = getWallCurveLength(wall)
    const height = resolveWallOpeningCeiling(wall, ctx.nodes)
    const thickness = getWallThickness(wall)
    if (!(Number.isFinite(length) && Number.isFinite(height))) continue

    rows.push({ key: 'length', label: 'Centreline length', unit: 'length', value: length })
    rows.push({
      key: 'face-area',
      label: 'Face area (gross)',
      unit: 'area',
      // Both faces — a takeoff for finishes wants the surface you actually paint.
      value: length * height * 2,
    })
    rows.push({
      key: 'volume',
      label: 'Volume',
      unit: 'volume',
      value: length * height * thickness,
    })
  }

  return rows.length > 0 ? { label: 'Walls', rows } : null
}
