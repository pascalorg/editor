import {
  type AnyNodeId,
  itemClipRegistry,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { hideFromScene, SCENE_LAYER, showInScene, useViewer } from '@pascal-app/viewer'
import { type Material, Matrix4, type Mesh, type Object3D } from 'three'
import type { ItemBatchEntry, ItemCandidate } from './item-batch-types'

/**
 * Candidate collection + source hide/reveal for item batching. Counterpart of
 * the wall batch's `toCandidate` (../wall/wall-batch-system.tsx), walking the
 * item's mounted GLB clone instead of a single wall mesh.
 */

const rootInverse = new Matrix4()

/** Source meshes currently draw-hidden per item, so reveal needs no candidate. */
const hiddenMeshesByItem = new Map<string, Mesh[]>()

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

export function collectItemCandidate(itemId: string): ItemCandidate | null {
  const nodes = useScene.getState().nodes
  const node = nodes[itemId as AnyNodeId]
  if (node?.type !== 'item' || node.visible === false) return null

  // v1 scope: only items parented directly to a level. A wall-, ceiling- or
  // roof-hosted item moves when its HOST changes — a signal that dirties the
  // host, not the item — so its captured batch transform would go stale with
  // nothing to release it. Hosted kinds keep drawing themselves for now.
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
  if (parent?.type !== 'level') return null
  const levelId = parent.id as string

  const asset = (node as { asset?: { interactive?: unknown } }).asset
  if (asset?.interactive) return null
  // A registered clip means the item animates its own subtree (a fan's spin) —
  // per-mesh transforms move under a static batch instance.
  if (itemClipRegistry.has(itemId)) return null

  const group = sceneRegistry.nodes.get(itemId)
  if (!group) return null
  if ((group.userData as { itemModelSettled?: boolean }).itemModelSettled !== true) return null

  // A live override means an in-flight gesture: transforms are moving under
  // our feet and the commit's dirty mark has not landed yet.
  if (useLiveNodeOverrides.getState().get(itemId as AnyNodeId)) return null

  const levelRoot = sceneRegistry.nodes.get(levelId)
  if (!levelRoot) return null

  const meshes: Mesh[] = []
  collectMeshes(group, meshes)
  if (meshes.length === 0) return null

  levelRoot.updateWorldMatrix(true, false)
  rootInverse.copy(levelRoot.matrixWorld).invert()

  const entries: ItemBatchEntry[] = []
  for (const mesh of meshes) {
    const material = mesh.material as Material | Material[]
    // Array materials draw per geometry group — a shape BatchedMesh cannot
    // hold; transparent ones depend on per-object blend ordering (the wall
    // batch excludes them for the same reason).
    if (Array.isArray(material)) continue
    if (!material || material.transparent === true) continue
    if (!mesh.geometry?.getAttribute('position')) continue

    mesh.updateWorldMatrix(true, false)
    entries.push({
      itemId,
      levelId,
      mesh,
      geometry: mesh.geometry,
      material,
      matrixInLevel: new Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld),
    })
  }
  if (entries.length === 0) return null

  return { itemId, levelId, entries }
}

export function hideBatchedItem(candidate: ItemCandidate): void {
  const meshes = candidate.entries.map((entry) => entry.mesh)
  for (const mesh of meshes) hideFromScene(mesh, 'batched')
  hiddenMeshesByItem.set(candidate.itemId, meshes)
}

export function revealBatchedItem(itemId: string): void {
  const meshes = hiddenMeshesByItem.get(itemId)
  if (!meshes) return
  for (const mesh of meshes) showInScene(mesh, 'batched')
  hiddenMeshesByItem.delete(itemId)
}

/** Items the viewer is lighting up — same want as the wall batch's tinted set. */
export function collectTintedItems(itemIds: ReadonlySet<string>): Set<string> {
  const viewer = useViewer.getState()
  const tinted = new Set<string>()
  for (const id of viewer.selection.selectedIds) if (itemIds.has(id)) tinted.add(id)
  for (const id of viewer.previewSelectedIds) if (itemIds.has(id)) tinted.add(id)
  const hovered = viewer.hoveredId
  if (hovered && itemIds.has(hovered)) tinted.add(hovered)
  return tinted
}

export function getBatchableItemIds(): ReadonlySet<string> {
  return sceneRegistry.byType.item ?? new Set()
}
