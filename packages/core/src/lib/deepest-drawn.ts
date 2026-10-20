import type { AnyNode, AnyNodeId } from '../schema'
import { getLevelElevations } from '../services/storey'
import { FOUNDATION_STANDARD } from './foundation-standard'
import { isSiteFlatwork } from './site-flatwork'
import { FLAT_GROUND_Y } from './site-ground-height'
import { heightAtSample, type TerrainField } from './terrain-field'
import { terrainFieldOf } from './terrain-source'

type Nodes = Record<AnyNodeId, AnyNode>

const lowestHeight = new WeakMap<TerrainField, number>()

/**
 * The lowest the site's ground lies: the sculpted terrain's lowest height where the site has one,
 * the flat plane everywhere else. How far a dive under the ground is measured from.
 */
export function lowestGroundY(nodes: Nodes): number {
  const site = Object.values(nodes).find((node) => node.type === 'site')
  const field = site ? terrainFieldOf(site) : null
  if (!field) return FLAT_GROUND_Y
  let lowest = lowestHeight.get(field)
  if (lowest === undefined) {
    lowest = Number.POSITIVE_INFINITY
    for (let row = 0; row < field.rows; row += 1)
      for (let col = 0; col < field.cols; col += 1)
        lowest = Math.min(lowest, heightAtSample(field, col, row))
    if (!Number.isFinite(lowest)) lowest = FLAT_GROUND_Y
    lowestHeight.set(field, lowest)
  }
  return lowest
}

/**
 * The world Y of the deepest thing the scene draws: the bottom of the footing under the lowest floor
 * slab (its underside less a footing's thickness; never above the walls' base, as the footing
 * itself is). A recessed slab (a basin) is drawn down to its own underside, with no footing under
 * it. Site flatwork (a lawn, a driveway) is not a floor of the house and counts for nothing. A
 * footing under a floor at or over grade sits about as deep, and never nearer the dive's own floor,
 * so the floors alone decide. `null` for a scene with no floor.
 */
export function deepestDrawnY(nodes: Nodes): number | null {
  const elevations = getLevelElevations(nodes)
  let deepest: number | null = null
  for (const node of Object.values(nodes)) {
    if (node.type !== 'level') continue
    const elevation = elevations.get(node.id)
    if (!elevation) continue
    const building = elevation.buildingId ? nodes[elevation.buildingId as AnyNodeId] : undefined
    const planeY = (building?.type === 'building' ? building.position[1] : 0) + elevation.baseY
    let floorUnderside = planeY
    let basinUnderside = Number.POSITIVE_INFINITY
    for (const id of node.children) {
      const child = nodes[id as AnyNodeId]
      if (child?.type !== 'slab' || isSiteFlatwork(child)) continue
      const underside = planeY + child.elevation - child.thickness
      if (child.recessed === true) basinUnderside = Math.min(basinUnderside, underside)
      else floorUnderside = Math.min(floorUnderside, underside)
    }
    const bottom = Math.min(floorUnderside - FOUNDATION_STANDARD.footingThickness, basinUnderside)
    if (deepest === null || bottom < deepest) deepest = bottom
  }
  return deepest
}
