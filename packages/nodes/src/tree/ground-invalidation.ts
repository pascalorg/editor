import {
  type AnyNode,
  type AnyNodeId,
  SITE_GROUND_DEPENDENCY_TYPES,
  type TreeNode,
  useScene,
} from '@pascal-app/core'
import { belongsToSite } from '../shared/site-context'

type Nodes = Readonly<Record<string, AnyNode>>
const groundKinds = new Set<string>(SITE_GROUND_DEPENDENCY_TYPES)

function treeGroundParts(nodes: Nodes, siteId: string): unknown[] {
  const site = nodes[siteId]
  const parts: unknown[] = site?.type === 'site' ? [site.terrain, site.polygon] : [undefined]
  for (const node of Object.values(nodes))
    if (groundKinds.has(node.type) && belongsToSite(node, siteId, nodes)) parts.push(node)
  return parts
}

export function treeFloorplanDependencies(node: TreeNode, nodes: Nodes): AnyNodeId[] {
  const siteId = node.parentId
  if (!siteId) return []
  return [
    siteId as AnyNodeId,
    ...Object.values(nodes)
      .filter((part) => groundKinds.has(part.type) && belongsToSite(part, siteId, nodes))
      .map((part) => part.id),
  ]
}

export function treesOnChangedGround(
  nodes: Nodes,
  previous: Map<string, unknown[]>,
): { dirty: AnyNodeId[]; parts: Map<string, unknown[]> } {
  const parts = new Map<string, unknown[]>()
  const dirty: AnyNodeId[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'tree' || !node.parentId) continue
    let now = parts.get(node.parentId)
    if (!now) {
      now = treeGroundParts(nodes, node.parentId)
      parts.set(node.parentId, now)
    }
    const before = previous.get(node.parentId)
    if (before && (before.length !== now.length || before.some((part, i) => part !== now[i])))
      dirty.push(node.id)
  }
  return { dirty, parts }
}

/** Only dirty marks: terrain/support edits never persist a vertical tree coordinate. */
export function initializeTreeGroundInvalidation(): () => void {
  let previous = treesOnChangedGround(useScene.getState().nodes, new Map()).parts
  return useScene.subscribe((state, before) => {
    if (state.nodes === before.nodes) return
    const { dirty, parts } = treesOnChangedGround(state.nodes, previous)
    previous = parts
    for (const id of dirty) state.markDirty(id)
  })
}
