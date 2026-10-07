import {
  type AnyNode,
  type AnyNodeId,
  type BatchableConfig,
  getRegistryVersion,
  nodeRegistry,
  sceneRegistry,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { hideFromScene, SCENE_LAYER, showInScene, useViewer } from '@pascal-app/viewer'
import { type Material, Matrix4, type Mesh, type Object3D } from 'three'
import { isSlotPaintPreviewActive } from '../slot-paint'
import type { BatchCandidate, BatchEntry } from './types'

/**
 * Candidate collection + source hide/reveal for node batching. Counterpart of
 * the wall batch's `toCandidate` (../../wall/wall-batch-system.tsx), walking
 * each node's mounted subtree instead of a single wall mesh.
 */

let batchKindsVersion = -1
let batchKinds: ReadonlyMap<string, BatchableConfig> = new Map()

/**
 * Kinds that declare `capabilities.batchable`, re-read when a plugin
 * registers. Walls keep their merged-geometry batch.
 */
export function batchableKinds(): ReadonlyMap<string, BatchableConfig> {
  const version = getRegistryVersion()
  if (version !== batchKindsVersion) {
    const kinds = new Map<string, BatchableConfig>()
    for (const [kind, definition] of nodeRegistry.entries()) {
      const batchable = definition.capabilities?.batchable
      if (batchable) kinds.set(kind, batchable)
    }
    batchKinds = kinds
    batchKindsVersion = version
  }
  return batchKinds
}

export function batchableConfig(node: AnyNode | undefined): BatchableConfig | undefined {
  return node ? batchableKinds().get(node.type) : undefined
}

/** A wall-scoped node (door, window) moves with its host wall. */
export function isWallHosted(node: AnyNode | undefined): boolean {
  return batchableConfig(node)?.scope === 'wall'
}

const rootInverse = new Matrix4()

/** Source meshes currently draw-hidden per node, so reveal needs no candidate. */
const hiddenMeshesByNode = new Map<string, Mesh[]>()

/**
 * Batchable meshes of one subtree. Recurses manually and cuts at the first
 * invisible node — `traverse` would descend into hidden branches (a toggled-off
 * variant, a cutout group) — and at any HOSTED child node's registered group:
 * an item can host other items (a shelf's books), whose groups mount inside
 * the host's. Packing those would freeze the child at the host's join pose
 * with no release of its own (it is not a store member).
 */
function collectMeshes(object: Object3D, out: Mesh[], hostedRoots: ReadonlySet<Object3D>): void {
  if (object.visible === false || hostedRoots.has(object)) return
  const mesh = object as Mesh
  if (
    mesh.isMesh &&
    mesh.name !== 'cutout' &&
    mesh.name !== 'ceiling-grid' &&
    mesh.layers.isEnabled(SCENE_LAYER)
  ) {
    out.push(mesh)
  }
  for (const child of object.children) collectMeshes(child, out, hostedRoots)
}

/**
 * The level this node's batches live under, or null when the node is not in
 * batchable scope. Level-scoped kinds qualify directly under a level; doors
 * and windows through a wall that is itself parented to a level. Other
 * hosting shapes (roof faces, blocks, wall-hosted items) move when their host
 * changes without any signal the batch would see — they draw themselves.
 */
function resolveLevelId(
  node: AnyNode,
  batchable: BatchableConfig,
  nodes: Record<string, AnyNode | undefined>,
): string | null {
  const parent = node.parentId ? nodes[node.parentId] : undefined
  if (!parent) return null
  if (batchable.scope === 'level') {
    return parent.type === 'level' ? (parent.id as string) : null
  }
  // Wall-hosted: host wall → its level. A hidden wall hides its openings
  // through group visibility — batch instances hang off the level root and
  // would keep drawing them.
  if (parent.type !== 'wall' || parent.visible === false) return null
  const level = parent.parentId ? nodes[parent.parentId] : undefined
  return level?.type === 'level' ? (level.id as string) : null
}

export function collectBatchCandidate(nodeId: string): BatchCandidate | null {
  const nodes = useScene.getState().nodes
  const node = nodes[nodeId as AnyNodeId]
  const batchable = batchableConfig(node)
  if (!node || !batchable || node.visible === false) return null

  const levelId = resolveLevelId(node, batchable, nodes)
  if (!levelId) return null
  if (batchable.excluded?.(node) || isSlotPaintPreviewActive(nodeId)) return null

  const group = sceneRegistry.nodes.get(nodeId)
  if (!group) return null
  if (batchable.settled && !batchable.settled(group.userData)) return null

  // A live override on the node (or, for hosted openings, on the host wall)
  // means an in-flight gesture: transforms are moving under our feet and the
  // commit's dirty mark has not landed yet.
  const overrides = useLiveNodeOverrides.getState()
  if (overrides.get(nodeId as AnyNodeId) || useLiveTransforms.getState().get(nodeId)) return null
  if (batchable.scope === 'wall' && node.parentId && overrides.get(node.parentId as AnyNodeId)) {
    return null
  }

  const levelRoot = sceneRegistry.nodes.get(levelId)
  if (!levelRoot) return null

  const hostedRoots = new Set<Object3D>()
  const children = (node as { children?: unknown }).children
  if (Array.isArray(children)) {
    for (const childId of children) {
      const childGroup = sceneRegistry.nodes.get(String(childId))
      if (childGroup) hostedRoots.add(childGroup)
    }
  }

  const meshes: Mesh[] = []
  collectMeshes(group, meshes, hostedRoots)
  if (meshes.length === 0) return null

  levelRoot.updateWorldMatrix(true, false)
  rootInverse.copy(levelRoot.matrixWorld).invert()

  const entries: BatchEntry[] = []
  for (const [meshIndex, mesh] of meshes.entries()) {
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
      allocationKey: batchable.batchKey?.(node, meshIndex),
      mesh,
      geometry: mesh.geometry,
      material,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
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
  for (const id of viewer.externalSelectedIds) if (nodeIds.has(id)) tinted.add(id)
  const hovered = viewer.hoveredId
  if (hovered && nodeIds.has(hovered)) tinted.add(hovered)

  const nodes = useScene.getState().nodes
  const overrides = useLiveNodeOverrides.getState()
  const wallLit = new Set<string>()
  for (const id of viewer.selection.selectedIds) wallLit.add(id)
  for (const id of viewer.previewSelectedIds) wallLit.add(id)
  for (const id of viewer.externalSelectedIds) wallLit.add(id)
  if (hovered) wallLit.add(hovered)
  for (const id of nodeIds) {
    if (tinted.has(id)) continue
    const node = nodes[id as AnyNodeId]
    if (!node || !isWallHosted(node)) continue
    const wallId = node.parentId as string | null
    if (!wallId) continue
    if (wallLit.has(wallId) || overrides.get(wallId as AnyNodeId)) tinted.add(id)
  }
  return tinted
}

export function getBatchableNodeIds(): ReadonlySet<string> {
  const out = new Set<string>()
  for (const kind of batchableKinds().keys()) {
    const ids = sceneRegistry.byType[kind]
    if (ids) for (const id of ids) out.add(id)
  }
  return out
}
