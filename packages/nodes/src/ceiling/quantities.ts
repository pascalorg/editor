import type { CeilingNode, QuantitiesContribution, QuantityRow } from '@pascal-app/core'
import { planPolygonNetArea, planPolygonPerimeter } from '../shared/plan-polygon-area'

/** Ceiling takeoff: hole-subtracted surface and edge perimeter. */
export const ceilingQuantities: QuantitiesContribution<CeilingNode> = (ceilings) => {
  const rows: QuantityRow[] = []

  for (const ceiling of ceilings) {
    const area = planPolygonNetArea(ceiling.polygon, ceiling.holes)
    if (!Number.isFinite(area) || area <= 0) continue

    rows.push({ key: 'area', label: 'Surface area', unit: 'area', value: area })
    rows.push({
      key: 'perimeter',
      label: 'Edge perimeter',
      unit: 'length',
      value: planPolygonPerimeter(ceiling.polygon),
    })
  }

  return rows.length > 0 ? { label: 'Ceilings', rows } : null
}
