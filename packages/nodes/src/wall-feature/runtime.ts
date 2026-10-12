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
  const effective = { ...nodes }
  for (const [id, patch] of overrides) {
    const node = nodes[id]
    if (node) effective[id] = { ...node, ...patch } as AnyNode
  }
  const byWall = new Map<string, WallFeatureNode[]>()
  for (const node of Object.values(effective)) {
    if (node.type !== 'wall-feature') continue
    const root = featureWall(node, effective)
    if (!root) continue
    const features = byWall.get(root.id) ?? []
    features.push(node)
    byWall.set(root.id, features)
  }
  const graph = { nodes: effective, byWall }
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
  previousNodes = undefined
}

function geometryGraph(nodes: Nodes): FeatureGraph {
  if (!deferredFeatures.size) return effectiveGraph(nodes)
  const graph = effectiveGraph(nodes)
  const restored = { ...graph.nodes }
  for (const id of deferredFeatures) if (nodes[id]) restored[id] = nodes[id]!
  const byWall = new Map<string, WallFeatureNode[]>()
  for (const node of Object.values(restored)) {
    if (node.type !== 'wall-feature') continue
    const root = featureWall(node, restored)
    if (!root) continue
    const list = byWall.get(root.id) ?? []
    list.push(node)
    byWall.set(root.id, list)
  }
  return { nodes: restored, byWall }
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
  const nodes = { ...graph.nodes, [wall.id]: wall }
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
  for (const node of Object.values(nodes)) {
    if (node.type !== 'wall-feature') continue
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
}
