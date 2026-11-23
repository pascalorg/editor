import { resolveBuildingForLevel } from '../lib/node-ancestry'
import { heightAt } from '../lib/terrain-field'
import { persistedTerrainFieldOf } from '../lib/terrain-source-persisted'
import type { AnyNode, AnyNodeId, SiteNode } from '../schema'
import { queryNodes } from './scene-queries'
import type { SceneNodes } from './types'

type Pt = [number, number]

/**
 * The terrain under a level's plan point, as a height in the level's building frame, or null when
 * the level has no building. A site with no persisted terrain is the flat datum plane. The
 * building's own offset and turn put its plan in the site's frame, where the terrain is read.
 */
export function groundReader(nodes: SceneNodes) {
  const sites = queryNodes<SiteNode>(nodes, { type: 'site' })
  const field = sites.length === 1 ? persistedTerrainFieldOf(sites[0] as SiteNode) : null
  return (levelId: string, [x, z]: Pt): number | null => {
    const buildingId = resolveBuildingForLevel(
      levelId as AnyNodeId,
      nodes as Record<AnyNodeId, AnyNode>,
    )
    const building = buildingId ? nodes[buildingId] : undefined
    if (building?.type !== 'building') return null
    const [cos, sin] = [Math.cos(building.rotation[1]), Math.sin(building.rotation[1])]
    const [siteX, siteZ] = [
      cos * x + sin * z + building.position[0],
      -sin * x + cos * z + building.position[2],
    ]
    return (field ? heightAt(field, siteX, siteZ) : 0) - building.position[1]
  }
}
