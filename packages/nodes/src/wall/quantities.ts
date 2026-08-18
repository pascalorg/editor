import {
  getWallCurveLength,
  getWallThickness,
  getMaterialLabel,
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

    // Walls have two faces. For quantities, we can either emit one gross face area row
    // and group it by the interior material (as a proxy), or emit interior and exterior separately.
    // The issue says "Duvar, döşeme, tavan katkılarında group'u malzeme adına bağla".
    // We'll emit two face area rows (one for interior, one for exterior) to accurately group them by material.
    const interiorRef = wall.slots?.['interior'] ?? wall.interiorMaterialPreset ?? wall.materialPreset
    const exteriorRef = wall.slots?.['exterior'] ?? wall.exteriorMaterialPreset ?? wall.materialPreset
    
    rows.push({
      key: 'face-area-interior',
      label: 'Face area (interior, gross)',
      unit: 'area',
      value: length * height,
      group: getMaterialLabel(interiorRef, ctx),
    })
    
    rows.push({
      key: 'face-area-exterior',
      label: 'Face area (exterior, gross)',
      unit: 'area',
      value: length * height,
      group: getMaterialLabel(exteriorRef, ctx),
    })

    rows.push({
      key: 'volume',
      label: 'Volume',
      unit: 'volume',
      value: length * height * thickness,
      // Volume doesn't typically have a surface material group, but we can leave it ungrouped or grouped by a structural material if we had one.
    })
  }

  return rows.length > 0 ? { label: 'Walls', rows } : null
}
