import {
  type AnyNode,
  type AnyNodeId,
  type HedgeNode,
  SITE_GROUND_DEPENDENCY_TYPES,
  useScene,
} from '@pascal-app/core'
import { belongsToSite } from '../shared/site-context'

type Nodes = Readonly<Record<string, AnyNode>>

/** Keep invalidation aligned with the committed inputs read by the ground adapter. */
const groundKinds = new Set<string>(SITE_GROUND_DEPENDENCY_TYPES)

/**
 * What the ground under a Site's hedges is made of, by identity: its stored terrain and lot, and
 * its slab supports, cutters and structural inputs. The store replaces a node it changes, so two reads that
 * hold the same objects read the same ground.
 */
export function hedgeGroundParts(nodes: Nodes, siteId: string): unknown[] {
  const site = nodes[siteId] as { terrain?: unknown; polygon?: unknown } | undefined
  const parts: unknown[] = [site?.terrain, site?.polygon]
  for (const node of Object.values(nodes))
    if (groundKinds.has(node.type) && belongsToSite(node, siteId, nodes)) parts.push(node)
  return parts
}

export function hedgeFloorplanDependencies(node: HedgeNode, nodes: Nodes): AnyNodeId[] {
  if (!node.parentId) return []
  return [
    node.parentId as AnyNodeId,
    ...Object.values(nodes)
      .filter((part) => groundKinds.has(part.type) && belongsToSite(part, node.parentId!, nodes))
      .map((part) => part.id),
  ]
}

function hedgesBySite(nodes: Nodes): Map<string, AnyNode['id'][]> {
  const bySite = new Map<string, AnyNode['id'][]>()
  for (const node of Object.values(nodes))
    if (node.type === 'hedge' && node.parentId)
      bySite.set(node.parentId, [...(bySite.get(node.parentId) ?? []), node.id])
  return bySite
}

const sameParts = (a: unknown[] | undefined, b: unknown[]) =>
  !!a && a.length === b.length && a.every((part, i) => part === b[i])

/** The hedges to rebuild between two scenes: those of every Site whose ground changed. */
export function hedgesOnChangedGround(
  nodes: Nodes,
  previous: Map<string, unknown[]>,
): { dirty: AnyNode['id'][]; parts: Map<string, unknown[]> } {
  const parts = new Map<string, unknown[]>()
  const dirty: AnyNode['id'][] = []
  for (const [siteId, hedges] of hedgesBySite(nodes)) {
    const now = hedgeGroundParts(nodes, siteId)
    parts.set(siteId, now)
    if (previous.has(siteId) && !sameParts(previous.get(siteId), now)) dirty.push(...hedges)
  }
  return { dirty, parts }
}

/**
 * A hedge's mesh has the ground under it baked into its vertices, so it is rebuilt when that
 * ground changes. Only dirty marks cross into the store.
 */
export function initializeHedgeGroundInvalidation(): () => void {
  let previous = hedgesOnChangedGround(useScene.getState().nodes, new Map()).parts
  return useScene.subscribe((state, before) => {
    if (state.nodes === before.nodes) return
    const { dirty, parts } = hedgesOnChangedGround(state.nodes, previous)
    previous = parts
    for (const id of dirty) state.markDirty(id)
  })
}
