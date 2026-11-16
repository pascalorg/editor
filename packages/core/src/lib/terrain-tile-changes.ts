import type { SceneChanges, SceneNodes } from '../agent-operations/types'
import type { SiteNode } from '../schema'
import type { TerrainField } from './terrain-field'
import { planTerrainTileWrites } from './terrain-tile-write'

/** Adapt the shared tile planner to the scene authority's atomic history edit. */
export function planTerrainTileChanges(
  site: SiteNode,
  nodes: SceneNodes,
  before: TerrainField,
  after: TerrainField,
): SceneChanges {
  const writes = planTerrainTileWrites(site, nodes, before, after)
  return {
    create: writes.creates.map((node) => ({ node, parentId: site.id })),
    update: writes.updates.map(({ id, heights, step }) => ({ id, data: { heights, step } })),
  }
}
