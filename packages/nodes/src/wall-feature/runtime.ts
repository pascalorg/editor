import {
  type AnyNode,
  type AnyNodeId,
  resolveWallFeaturePlacement,
  useLiveNodeOverrides,
  useScene,
  type WallFeatureNode,
  type WallFeaturePlacement,
  type WallFeaturePlacementContext,
  type WallNode,
} from '@pascal-app/core'
import type { WallBodyGeometryContext, WallBodyGeometryModifier } from '@pascal-app/viewer'
import { buildWallFeatureBody } from './geometry'

type Nodes = Readonly<Record<string, AnyNode>>
type Overrides = ReturnType<typeof useLiveNodeOverrides.getState>['overrides']
type FeatureGraph = { nodes: Nodes; byWall: Map<string, WallFeatureNode[]> }

let graphCache = new WeakMap<Nodes, { overrides: Overrides; graph: FeatureGraph }>()
let featureIndex = new WeakMap<Nodes, WallFeatureNode[]>()
let geometryCache = new WeakMap<
  Nodes,
  { overrides: Overrides; revision: number; graph: FeatureGraph }
>()
let deferralRevision = 0

function indexedFeatures(nodes: Nodes): WallFeatureNode[] {
  const cached = featureIndex.get(nodes)
  if (cached) return cached
  const features = Object.values(nodes).filter(
    (node): node is WallFeatureNode => node.type === 'wall-feature',
  )
  featureIndex.set(nodes, features)
  return features
}

// Preserve scene-map enumeration for domain queries while resolving overrides lazily.
// Pointer ticks allocate only patched nodes; the committed scene map stays untouched.
function overlayNodes(nodes: Nodes, patches: ReadonlyMap<string, Record<string, unknown>>): Nodes {
  if (!patches.size) return nodes
  const resolved = new Map<string, AnyNode>()
  const get = (key: string) => {
    const node = nodes[key]
    const patch = patches.get(key)
    if (!node || !patch) return node
    const cached = resolved.get(key)
    if (cached) return cached
    const effective = { ...node, ...patch } as AnyNode
    resolved.set(key, effective)
    return effective
  }
  return new Proxy(Object.create(null) as Record<string, AnyNode>, {
    get: (_target, key) => (typeof key === 'string' ? get(key) : Reflect.get(nodes, key)),
    has: (_target, key) => key in nodes,
    ownKeys: () => Reflect.ownKeys(nodes),
    getOwnPropertyDescriptor: (_target, key) =>
      Object.hasOwn(nodes, key)
        ? {
            configurable: true,
            enumerable: true,
            value: typeof key === 'string' ? get(key) : Reflect.get(nodes, key),
          }
        : undefined,
  })
}

function groupFeatures(source: Nodes, effective: Nodes): FeatureGraph {
  const byWall = new Map<string, WallFeatureNode[]>()
  for (const raw of indexedFeatures(source)) {
    const node = effective[raw.id] as WallFeatureNode
    const root = featureWall(node, effective)
    if (!root) continue
    const features = byWall.get(root.id) ?? []
    features.push(node)
    byWall.set(root.id, features)
  }
  return { nodes: effective, byWall }
}

function featureWall(
  node: WallFeatureNode,
  nodes: Nodes,
): { id: WallNode['id']; visible: boolean } | null {
  let current: AnyNode | undefined = node
  let visible = true
  const visited = new Set<string>()
  while (current) {
    if (visited.has(current.id)) return null
    visited.add(current.id)
    visible &&= current.visible !== false
    if (current.type === 'wall') return { id: current.id, visible }
    if (current.type !== 'wall-feature' || !current.parentId) return null
    current = nodes[current.parentId]
  }
  return null
}

function effectiveGraph(nodes: Nodes): FeatureGraph {
  const overrides = useLiveNodeOverrides.getState().overrides
  const cached = graphCache.get(nodes)
  if (cached?.overrides === overrides) return cached.graph
  const graph = groupFeatures(nodes, overlayNodes(nodes, overrides))
  graphCache.set(nodes, { overrides, graph })
  return graph
}

const wallContexts = new Map<string, WallFeaturePlacementContext>()
const placementCache = new Map<
  string,
  {
    graph: FeatureGraph
    context: WallFeaturePlacementContext | undefined
    placement: WallFeaturePlacement | null
  }
>()

export function getWallFeatureWallContext(id: string) {
  return wallContexts.get(id)
}

export function getWallFeaturePlacement(id: string): WallFeaturePlacement | null {
  const graph = effectiveGraph(useScene.getState().nodes)
  const node = graph.nodes[id]
  if (node?.type !== 'wall-feature') return null
  const root = featureWall(node, graph.nodes)
  if (!root?.visible) return null
  const context = wallContexts.get(root.id)
  const cached = placementCache.get(id)
  if (cached?.graph === graph && cached.context === context) return cached.placement
  let placement: WallFeaturePlacement | null = null
  try {
    placement = resolveWallFeaturePlacement(graph.nodes, node, context)
  } catch {}
  placementCache.set(id, { graph, context, placement })
  return placement
}

const deferredFeatures = new Set<string>()
export function isWallFeatureGeometryDeferred(id: string) {
  return deferredFeatures.has(id)
}
export function deferWallFeatureGeometry(id: string, deferred: boolean) {
  if (deferredFeatures.has(id) === deferred) return
  if (deferred) deferredFeatures.add(id)
  else deferredFeatures.delete(id)
  deferralRevision++
  previousNodes = undefined
}

function geometryGraph(nodes: Nodes): FeatureGraph {
  if (!deferredFeatures.size) return effectiveGraph(nodes)
  const overrides = useLiveNodeOverrides.getState().overrides
  const cached = geometryCache.get(nodes)
  if (cached?.overrides === overrides && cached.revision === deferralRevision) return cached.graph
  const active = new Map([...overrides].filter(([id]) => !deferredFeatures.has(id)))
  const graph = groupFeatures(nodes, overlayNodes(nodes, active))
  geometryCache.set(nodes, { overrides, revision: deferralRevision, graph })
  return graph
}

export function createWallFeatureBodyModifier(
  wall: WallNode,
  context: WallBodyGeometryContext,
): WallBodyGeometryModifier | undefined {
  wallContexts.set(wall.id, { support: context.support, planeTop: context.planeTop })
  const graph = geometryGraph(context.nodes)
  const features = graph.byWall
    .get(wall.id)
    ?.filter((node) => featureWall(node, graph.nodes)?.visible)
  if (!features?.length) return undefined
  const nodes = overlayNodes(graph.nodes, new Map([[wall.id, wall]]))
  const placements = features.map((node) => resolveWallFeaturePlacement(nodes, node, context))
  return (body) => buildWallFeatureBody(body, placements, context.elevation)
}

type FeatureInput = { node: WallFeatureNode; override: unknown; wallId: WallNode['id'] | null }
let previousNodes: Nodes | undefined
let previousOverrides: Overrides | undefined
const previousInputs = new Map<string, FeatureInput>()

/** Invalidates both former and current roots, including deletions and cleared live overrides. */
export function syncWallFeatureGeometry(): void {
  const state = useScene.getState()
  const nodes: Nodes = state.nodes
  const overrides = useLiveNodeOverrides.getState().overrides
  if (nodes === previousNodes && overrides === previousOverrides) return
  for (const id of wallContexts.keys()) if (!nodes[id]) wallContexts.delete(id)
  for (const id of placementCache.keys()) if (!nodes[id]) placementCache.delete(id)
  previousNodes = nodes
  previousOverrides = overrides
  const graph = geometryGraph(nodes)
  const seen = new Set<string>()
  const dirty = new Set<WallNode['id']>()
  for (const node of indexedFeatures(nodes)) {
    seen.add(node.id)
    const override = deferredFeatures.has(node.id) ? undefined : overrides.get(node.id)
    const effective = graph.nodes[node.id] as WallFeatureNode
    const wallId = featureWall(effective, graph.nodes)?.id ?? null
    const previous = previousInputs.get(node.id)
    if (previous?.node !== node || previous.override !== override || previous.wallId !== wallId) {
      if (previous?.wallId) dirty.add(previous.wallId)
      if (wallId) dirty.add(wallId)
    }
    previousInputs.set(node.id, { node, override, wallId })
  }
  for (const [id, previous] of previousInputs) {
    if (seen.has(id)) continue
    if (previous.wallId) dirty.add(previous.wallId)
    previousInputs.delete(id)
  }
  for (const id of dirty) if (nodes[id]?.type === 'wall') state.markDirty(id as AnyNodeId)
}

export function resetWallFeatureGeometry(): void {
  deferredFeatures.clear()
  wallContexts.clear()
  placementCache.clear()
  previousNodes = undefined
  previousOverrides = undefined
  previousInputs.clear()
  graphCache = new WeakMap()
  featureIndex = new WeakMap()
  geometryCache = new WeakMap()
  deferralRevision = 0
}
