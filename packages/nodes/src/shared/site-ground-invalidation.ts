import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { belongsToSite } from './site-context'

type NodeType = AnyNode['type']
type Nodes = Readonly<Record<string, AnyNode>>

type Registration = {
  kind: NodeType
  types: ReadonlySet<string>
  previous: Map<string, unknown[]>
}

const registrations = new Map<symbol, Registration>()
let unsubscribeScene: (() => void) | null = null

function ensureSceneSubscription() {
  if (unsubscribeScene) return
  unsubscribeScene = useScene.subscribe((state, before) => {
    if (state.nodes === before.nodes) return
    for (const entry of registrations.values()) {
      const next = siteKindsOnChangedGround(state.nodes, entry.previous, entry.kind, entry.types)
      entry.previous = next.parts
      for (const id of next.dirty) state.markDirty(id)
    }
  })
}

function toTypeSet(dependencyTypes: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return dependencyTypes instanceof Set ? dependencyTypes : new Set(dependencyTypes)
}

/** Snapshot of Site ground inputs and same-Site dependency nodes for invalidation checks. */
export function siteGroundParts(
  nodes: Nodes,
  siteId: string,
  dependencyTypes: ReadonlySet<string> | readonly string[],
): unknown[] {
  const types = toTypeSet(dependencyTypes)
  const site = nodes[siteId]
  const parts: unknown[] = site?.type === 'site' ? [site.terrain, site.polygon] : [undefined]
  for (const node of Object.values(nodes)) {
    if (node.id !== siteId && types.has(node.type) && belongsToSite(node, siteId, nodes))
      parts.push(node)
  }
  return parts
}

/** Floorplan dependency node ids for any Site-hosted garden element. */
export function siteFloorplanDependencies(
  node: Pick<AnyNode, 'parentId'>,
  nodes: Nodes,
  dependencyTypes: ReadonlySet<string> | readonly string[],
): AnyNodeId[] {
  const siteId = node.parentId
  if (!siteId) return []
  const types = toTypeSet(dependencyTypes)
  return [
    siteId as AnyNodeId,
    ...Object.values(nodes)
      .filter((part) => types.has(part.type) && belongsToSite(part, siteId, nodes))
      .map((part) => part.id),
  ]
}

const sameParts = (a: unknown[] | undefined, b: unknown[]) =>
  !!a && a.length === b.length && a.every((part, i) => part === b[i])

/** Diff Site ground dependencies for one node kind and report newly stale node ids. */
export function siteKindsOnChangedGround(
  nodes: Nodes,
  previous: Map<string, unknown[]>,
  kind: NodeType,
  dependencyTypes: ReadonlySet<string> | readonly string[],
): { dirty: AnyNodeId[]; parts: Map<string, unknown[]> } {
  const types = toTypeSet(dependencyTypes)
  const bySite = new Map<string, AnyNodeId[]>()
  for (const node of Object.values(nodes)) {
    if (node.type !== kind || !node.parentId) continue
    const ids = bySite.get(node.parentId) ?? []
    ids.push(node.id)
    bySite.set(node.parentId, ids)
  }
  const parts = new Map<string, unknown[]>()
  const dirty: AnyNodeId[] = []
  for (const [siteId, ids] of bySite) {
    const now = siteGroundParts(nodes, siteId, types)
    const before = previous.get(siteId)
    parts.set(siteId, now)
    if (previous.has(siteId) && !sameParts(before, now)) dirty.push(...ids)
  }
  return { dirty, parts }
}

/**
 * Share one `useScene.subscribe` listener across all Site-grounded vegetation systems so each
 * commit scans dependencies per active kind without registering redundant store subscribers.
 */
export function registerSiteGroundInvalidation(
  kind: NodeType,
  dependencyTypes: ReadonlySet<string> | readonly string[],
): () => void {
  const types = toTypeSet(dependencyTypes)
  const key = Symbol(kind)
  registrations.set(key, {
    kind,
    types,
    previous: siteKindsOnChangedGround(useScene.getState().nodes, new Map(), kind, types).parts,
  })
  ensureSceneSubscription()
  return () => {
    registrations.delete(key)
    if (registrations.size === 0 && unsubscribeScene) {
      unsubscribeScene()
      unsubscribeScene = null
    }
  }
}
