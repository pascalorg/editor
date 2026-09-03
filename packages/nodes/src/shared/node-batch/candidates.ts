import {
  type AnyNode,
  type AnyNodeId,
  itemClipRegistry,
  sceneRegistry,
  useInteractive,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { hideFromScene, SCENE_LAYER, showInScene, useViewer } from '@pascal-app/viewer'
import { type Material, Matrix4, type Mesh, type Object3D } from 'three'
import type { BatchCandidate, BatchEntry } from './types'

/**
 * Candidate collection + source hide/reveal for node batching. Counterpart of
 * the wall batch's `toCandidate` (../../wall/wall-batch-system.tsx), walking
 * each node's mounted subtree instead of a single wall mesh.
 */

/** Kinds the batch system manages. Walls keep their merged-geometry batch. */
export const BATCH_KINDS: ReadonlySet<string> = new Set(['item', 'column', 'door', 'window'])

const rootInverse = new Matrix4()

/** Source meshes currently draw-hidden per node, so reveal needs no candidate. */
const hiddenMeshesByNode = new Map<string, Mesh[]>()

/**
 * Batchable meshes of one subtree. Recurses manually and cuts at the first
 * invisible node — `traverse` would descend into hidden branches (a toggled-off
 * variant, a cutout group) and batch meshes the renderer never draws.
 */
function collectMeshes(object: Object3D, out: Mesh[]): void {
  if (object.visible === false) return
  const mesh = object as Mesh
  if (mesh.isMesh && mesh.name !== 'cutout' && mesh.layers.isEnabled(SCENE_LAYER)) {
    out.push(mesh)
  }
  for (const child of object.children) collectMeshes(child, out)
}

/**
 * The level this node's batches live under, or null when the node is not in
 * batchable scope. Items and columns qualify parented directly to a level;
 * doors and windows through a wall that is itself parented to a level. Other
 * hosting shapes (roof faces, blocks, wall-hosted items) move when their host
 * changes without any signal the batch would see — they draw themselves.
 */
function resolveLevelId(node: AnyNode, nodes: Record<string, AnyNode | undefined>): string | null {
  const parent = node.parentId ? nodes[node.parentId] : undefined
  if (!parent) return null
  if (node.type === 'item' || node.type === 'column') {
    return parent.type === 'level' ? (parent.id as string) : null
  }
  // door / window: host wall → its level
  if (parent.type !== 'wall') return null
  const level = parent.parentId ? nodes[parent.parentId] : undefined
  return level?.type === 'level' ? (level.id as string) : null
}

function isExcluded(node: AnyNode): boolean {
  if (node.type === 'item') {
    const asset = (node as { asset?: { interactive?: unknown } }).asset
    if (asset?.interactive) return true
    // A registered clip means the item animates its own subtree (a fan's
    // spin) — per-mesh transforms move under a static batch instance.
    if (itemClipRegistry.has(node.id as string)) return true
    return false
  }
  if (node.type === 'door') {
    // Mid-swing doors rebuild per tick off their animation record; the
    // completion dirty mark re-joins them at the settled pose.
    return node.id in useInteractive.getState().doorAnimations
  }
  if (node.type === 'window') {
    return node.id in useInteractive.getState().windowAnimations
  }
  return false
}

export function collectBatchCandidate(nodeId: string): BatchCandidate | null {
  const nodes = useScene.getState().nodes
  const node = nodes[nodeId as AnyNodeId]
  if (!node || !BATCH_KINDS.has(node.type) || node.visible === false) return null

  const levelId = resolveLevelId(node, nodes)
  if (!levelId) return null
  if (isExcluded(node)) return null

  const group = sceneRegistry.nodes.get(nodeId)
  if (!group) return null
  // Items hold their dirty mark until the GLB settles; other kinds mount
  // their real geometry synchronously and carry no such flag.
  if (
    node.type === 'item' &&
    (group.userData as { itemModelSettled?: boolean }).itemModelSettled !== true
  ) {
    return null
  }

  // A live override on the node (or, for hosted openings, on the host wall)
  // means an in-flight gesture: transforms are moving under our feet and the
  // commit's dirty mark has not landed yet.
  const overrides = useLiveNodeOverrides.getState()
  if (overrides.get(nodeId as AnyNodeId)) return null
  if (
    (node.type === 'door' || node.type === 'window') &&
    node.parentId &&
    overrides.get(node.parentId as AnyNodeId)
  ) {
    return null
  }

  const levelRoot = sceneRegistry.nodes.get(levelId)
  if (!levelRoot) return null

  const meshes: Mesh[] = []
  collectMeshes(group, meshes)
  if (meshes.length === 0) return null

  levelRoot.updateWorldMatrix(true, false)
  rootInverse.copy(levelRoot.matrixWorld).invert()

  const entries: BatchEntry[] = []
  for (const mesh of meshes) {
    const material = mesh.material as Material | Material[]
    // Array materials draw per geometry group — a shape BatchedMesh cannot
    // hold; transparent ones depend on per-object blend ordering (door/window
    // glass keeps its own draw); `material.visible === false` is the
    // selection-hitbox idiom — hitboxes must stay pickable sources, never
    // batch geometry.
    if (Array.isArray(material)) continue
    if (!material || material.transparent === true || material.visible === false) continue
    if (!mesh.geometry?.getAttribute('position')) continue

    mesh.updateWorldMatrix(true, false)
    entries.push({
      nodeId,
      levelId,
      mesh,
      geometry: mesh.geometry,
      material,
      matrixInLevel: new Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld),
    })
  }
  if (entries.length === 0) return null

  return { nodeId, levelId, entries }
}

export function hideBatchedNode(candidate: BatchCandidate): void {
  const meshes = candidate.entries.map((entry) => entry.mesh)
  for (const mesh of meshes) hideFromScene(mesh, 'batched')
  hiddenMeshesByNode.set(candidate.nodeId, meshes)
}

/**
 * Belt-and-braces reveal: drops the 'batched' hold from EVERY mesh under
 * every level root. Per-node reveals track the meshes they hid, but a system
 * can rebuild a node's children while it is batched (swapping the tracked
 * refs), and a stale ref means a mesh stays off the scene layer — which the
 * GLB exporter prunes. `showInScene` is a no-op on unheld meshes, so the
 * sweep is safe; it runs only on the rare release-everything paths (capture,
 * appearance switches, isolation).
 */
export function revealAllBatchedHolds(): void {
  for (const levelId of sceneRegistry.byType.level ?? []) {
    const root = sceneRegistry.nodes.get(levelId)
    root?.traverse((child) => {
      if ((child as Mesh).isMesh) showInScene(child, 'batched')
    })
  }
  hiddenMeshesByNode.clear()
}

export function revealBatchedNode(nodeId: string): void {
  const meshes = hiddenMeshesByNode.get(nodeId)
  if (!meshes) return
  for (const mesh of meshes) showInScene(mesh, 'batched')
  hiddenMeshesByNode.delete(nodeId)
}

/**
 * Nodes the viewer is lighting up — plus hosted openings whose host wall is
 * lit or mid-gesture: a dragged wall carries its doors with it through live
 * overrides, and a batched copy would stay behind until commit.
 */
export function collectTintedNodes(nodeIds: ReadonlySet<string>): Set<string> {
  const viewer = useViewer.getState()
  const tinted = new Set<string>()
  for (const id of viewer.selection.selectedIds) if (nodeIds.has(id)) tinted.add(id)
  for (const id of viewer.previewSelectedIds) if (nodeIds.has(id)) tinted.add(id)
  const hovered = viewer.hoveredId
  if (hovered && nodeIds.has(hovered)) tinted.add(hovered)

  const nodes = useScene.getState().nodes
  const overrides = useLiveNodeOverrides.getState()
  const wallLit = new Set<string>()
  for (const id of viewer.selection.selectedIds) wallLit.add(id)
  for (const id of viewer.previewSelectedIds) wallLit.add(id)
  if (hovered) wallLit.add(hovered)
  for (const id of nodeIds) {
    if (tinted.has(id)) continue
    const node = nodes[id as AnyNodeId]
    if (!node || (node.type !== 'door' && node.type !== 'window')) continue
    const wallId = node.parentId as string | null
    if (!wallId) continue
    if (wallLit.has(wallId) || overrides.get(wallId as AnyNodeId)) tinted.add(id)
  }
  return tinted
}

export function getBatchableNodeIds(): ReadonlySet<string> {
  const out = new Set<string>()
  for (const kind of BATCH_KINDS) {
    const ids = sceneRegistry.byType[kind]
    if (ids) for (const id of ids) out.add(id)
  }
  return out
}
