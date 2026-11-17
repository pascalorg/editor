import {
  type AnyNode,
  type AnyNodeId,
  PLANTING_SCENE_DEPENDENCY_TYPES,
  type PlantingNode,
  useScene,
} from '@pascal-app/core'
import { belongsToSite } from '../shared/site-context'

type Nodes = Readonly<Record<string, AnyNode>>
const dependencyTypes = new Set<string>(PLANTING_SCENE_DEPENDENCY_TYPES)

/** Shared resolver inputs, including ancestor transforms and building/path footprints. */
export function plantingSceneParts(nodes: Nodes, siteId: string): unknown[] {
  const site = nodes[siteId]
  const parts: unknown[] = site?.type === 'site' ? [site.terrain, site.polygon] : [undefined]
  for (const node of Object.values(nodes))
    if (dependencyTypes.has(node.type) && belongsToSite(node, siteId, nodes)) parts.push(node)
  return parts
}

export function plantingFloorplanDependencies(node: PlantingNode, nodes: Nodes): AnyNodeId[] {
  if (!node.parentId) return []
  return [
    node.parentId as AnyNodeId,
    ...Object.values(nodes)
      .filter(
        (part) => dependencyTypes.has(part.type) && belongsToSite(part, node.parentId!, nodes),
      )
      .map((part) => part.id),
  ]
}

function plantingsBySite(nodes: Nodes): Map<string, AnyNodeId[]> {
  const bySite = new Map<string, AnyNodeId[]>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'planting' || !node.parentId) continue
    const ids = bySite.get(node.parentId) ?? []
    ids.push(node.id)
    bySite.set(node.parentId, ids)
  }
  return bySite
}

export function plantingsOnChangedScene(
  nodes: Nodes,
  previous: Map<string, unknown[]>,
): { dirty: AnyNodeId[]; parts: Map<string, unknown[]> } {
  const parts = new Map<string, unknown[]>()
  const dirty: AnyNodeId[] = []
  for (const [siteId, ids] of plantingsBySite(nodes)) {
    const now = plantingSceneParts(nodes, siteId)
    const before = previous.get(siteId)
    parts.set(siteId, now)
    if (before && (before.length !== now.length || before.some((part, i) => part !== now[i])))
      dirty.push(...ids)
  }
  return { dirty, parts }
}

/** Dirty marks only: no writes to persisted planting parameters during ground or obstacle edits. */
export function initializePlantingSceneInvalidation(): () => void {
  let previous = plantingsOnChangedScene(useScene.getState().nodes, new Map()).parts
  return useScene.subscribe((state, before) => {
    if (state.nodes === before.nodes) return
    const { dirty, parts } = plantingsOnChangedScene(state.nodes, previous)
    previous = parts
    for (const id of dirty) state.markDirty(id)
  })
}
