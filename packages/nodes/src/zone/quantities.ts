import type { QuantitiesContribution, QuantityRow, ZoneNode } from '@pascal-app/core'
import { planPolygonArea, planPolygonPerimeter } from '../shared/plan-polygon-area'

/**
 * Zone takeoff: floor area, perimeter and clear volume, split per room.
 *
 * Each zone becomes its own group so the panel reads as a room schedule
 * rather than one lump — "how big is the kitchen" is the question a zone
 * exists to answer.
 *
 * Volume uses the zone's own `ceilingHeight` and is therefore a clear-height
 * figure, not a proven envelope. `deriveZoneQuantityReport` is the stricter
 * evidence-based report; this is the cheap roll-up a live panel can afford on
 * every edit.
 */
export const zoneQuantities: QuantitiesContribution<ZoneNode> = (zones) => {
  const rows: QuantityRow[] = []

  for (const zone of zones) {
    const area = planPolygonArea(zone.polygon)
    if (!Number.isFinite(area) || area <= 0) continue
    // `name` is required on a zone, so the fallback is for a blank one, not a
    // missing one.
    const group = zone.name.trim() || 'Unnamed zone'

    rows.push({ key: 'area', label: 'Floor area', unit: 'area', value: area, group })
    rows.push({
      key: 'perimeter',
      label: 'Perimeter',
      unit: 'length',
      value: planPolygonPerimeter(zone.polygon),
      group,
    })
    rows.push({
      key: 'volume',
      label: 'Clear volume',
      unit: 'volume',
      value: area * zone.ceilingHeight,
      group,
    })
  }

  return rows.length > 0 ? { label: 'Zones', rows } : null
}
