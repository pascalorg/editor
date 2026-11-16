import { refuse } from '../agent-tools/refusal'
import type { SiteNode } from '../schema/nodes/site'
import { terrainBreakFacts, terrainBreaksOf, validateTerrainBreakLotSpan } from './terrain-breaks'
import { persistedTerrainFieldOf } from './terrain-source-persisted'
import type { TerrainNodes } from './terrain-tiles'

function validateSiteBreaks(site: SiteNode, nodes: TerrainNodes): void {
  const breaks = terrainBreaksOf(site, nodes)
  if (!breaks.length) return
  for (const boundary of breaks) validateTerrainBreakLotSpan(boundary, site.polygon.points)
  const field = persistedTerrainFieldOf(site, nodes)
  if (!field) refuse('no_terrain', 'The proposed terrain-break field cannot be read.')
  for (const boundary of breaks) terrainBreakFacts(boundary, field)
}

export function validateTerrainBreakRelations(
  before: TerrainNodes,
  next: TerrainNodes,
  changedIds: Iterable<string>,
): void {
  const sites = new Set<string>()
  for (const id of changedIds) {
    for (const node of [before[id], next[id]]) {
      if ((node?.type === 'terrain-break' || node?.type === 'terrain-tile') && node.parentId)
        sites.add(node.parentId)
      if (node?.type === 'site') sites.add(node.id)
    }
    const boundary = next[id]
    if (boundary?.type !== 'terrain-break') continue
    const site = boundary.parentId ? next[boundary.parentId] : undefined
    if (site?.type !== 'site')
      refuse('invalid_parent', 'A terrain break must belong directly to a site.')
    if (boundary.kind !== 'cliff' && boundary.kind !== 'retaining' && boundary.kind !== 'soil')
      refuse('invalid_input', 'A terrain break must be cliff, retaining or soil.')
  }
  for (const id of sites) {
    const site = next[id]
    if (site?.type === 'site') validateSiteBreaks(site, next)
  }
}
