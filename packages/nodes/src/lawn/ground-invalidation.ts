import {
  type AnyNode,
  type AnyNodeId,
  type LawnNode,
  SITE_GROUND_DEPENDENCY_TYPES,
  useScene,
} from '@pascal-app/core'
import { belongsToSite } from '../shared/site-context'

type Nodes = Readonly<Record<string, AnyNode>>
const dependencyTypes = new Set<string>([...SITE_GROUND_DEPENDENCY_TYPES, 'planting'])

export function lawnSceneParts(nodes: Nodes, siteId: string): unknown[] {
  const site = nodes[siteId]
  const parts: unknown[] = site?.type === 'site' ? [site.terrain, site.polygon] : [undefined]
  for (const node of Object.values(nodes)) {
    if (node.id !== siteId && dependencyTypes.has(node.type) && belongsToSite(node, siteId, nodes))
      parts.push(node)
  }
  return parts
}

export function lawnFloorplanDependencies(node: LawnNode, nodes: Nodes): AnyNodeId[] {
  const siteId = node.parentId
  if (!siteId) return []
  return [
    siteId as AnyNodeId,
    ...Object.values(nodes)
      .filter((part) => dependencyTypes.has(part.type) && belongsToSite(part, siteId, nodes))
      .map((part) => part.id),
  ]
}

export function lawnsOnChangedScene(nodes: Nodes, previous: Map<string, unknown[]>) {
  const bySite = new Map<string, AnyNodeId[]>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'lawn' || !node.parentId) continue
    const ids = bySite.get(node.parentId) ?? []
    ids.push(node.id)
    bySite.set(node.parentId, ids)
  }
  const parts = new Map<string, unknown[]>()
  const dirty: AnyNodeId[] = []
  for (const [siteId, ids] of bySite) {
    const now = lawnSceneParts(nodes, siteId)
    const before = previous.get(siteId)
    parts.set(siteId, now)
    if (
      before &&
      (before.length !== now.length || before.some((part, index) => part !== now[index]))
    )
      dirty.push(...ids)
  }
  return { dirty, parts }
}

export function initializeLawnSceneInvalidation(): () => void {
  let previous = lawnsOnChangedScene(useScene.getState().nodes, new Map()).parts
  return useScene.subscribe((state, before) => {
    if (state.nodes === before.nodes) return
    const next = lawnsOnChangedScene(state.nodes, previous)
    previous = next.parts
    for (const id of next.dirty) state.markDirty(id)
  })
}
