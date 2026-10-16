import type { AnyNode, AnyNodeId, SlabNode } from '../schema'
import { levelFloorWorldY } from '../services/storey'
import { FOUNDATION_STANDARD } from './foundation-standard'
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
 * slab (its underside less a footing's thickness). A footing under a floor at or over grade sits
 * about as deep, and never nearer the dive's own floor, so the floors alone decide. `null` for a
 * scene with no floor.
 */
export function deepestDrawnY(nodes: Nodes): number | null {
  let deepest: number | null = null
  for (const node of Object.values(nodes)) {
    if (node.type !== 'level') continue
    const floorY = levelFloorWorldY(nodes, node.id)
    if (floorY === null) continue
    const thickest = node.children.reduce((thickness, id) => {
      const child = nodes[id as AnyNodeId]
      return child?.type === 'slab' ? Math.max(thickness, (child as SlabNode).thickness) : thickness
    }, 0)
    const bottom = floorY - thickest - FOUNDATION_STANDARD.footingThickness
    if (deepest === null || bottom < deepest) deepest = bottom
  }
  return deepest
}
