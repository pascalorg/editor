import type { QuantitiesContribution, QuantityRow, SlabNode } from '@pascal-app/core'
import { planPolygonNetArea, planPolygonPerimeter } from '../shared/plan-polygon-area'

/**
 * Slab takeoff: hole-subtracted surface, edge perimeter and poured volume.
 *
 * Holes are netted out of both the area and the volume — a stair opening is
 * concrete nobody pours, and reporting it would overstate the pour on every
 * multi-storey model.
 */
export const slabQuantities: QuantitiesContribution<SlabNode> = (slabs) => {
  const rows: QuantityRow[] = []

  for (const slab of slabs) {
    const area = planPolygonNetArea(slab.polygon, slab.holes)
    if (!Number.isFinite(area) || area <= 0) continue

    rows.push({ key: 'area', label: 'Surface area', unit: 'area', value: area })
    rows.push({
      key: 'perimeter',
      label: 'Edge perimeter',
      unit: 'length',
      value: planPolygonPerimeter(slab.polygon),
    })
    rows.push({ key: 'volume', label: 'Volume', unit: 'volume', value: area * slab.thickness })
  }

  return rows.length > 0 ? { label: 'Slabs', rows } : null
}
