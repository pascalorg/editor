import { terrainBreakFacts, terrainBreaksOf } from '../lib/terrain-breaks'
import { persistedTerrainFieldOf } from '../lib/terrain-source-persisted'
import type { AnyNode } from '../schema'
import type { SceneNodes } from './types'

export function terrainFactsForNode(node: AnyNode, nodes: SceneNodes): Record<string, unknown> {
  const site = node.type === 'site' ? node : node.parentId ? nodes[node.parentId] : undefined
  if (site?.type !== 'site' || (node.type !== 'site' && node.type !== 'terrain-break')) return {}
  const field = persistedTerrainFieldOf(site, nodes)
  if (!field) return node.type === 'site' ? { breaks: [] } : {}
  return node.type === 'terrain-break'
    ? { terrainBreak: terrainBreakFacts(node, field) }
    : {
        breaks: terrainBreaksOf(site, nodes).map((terrainBreak) =>
          terrainBreakFacts(terrainBreak, field),
        ),
      }
}
