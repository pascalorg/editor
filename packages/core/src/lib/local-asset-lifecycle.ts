import type { AnyNode } from '../schema'
import { deleteAsset } from './asset-storage'

/**
 * Local `asset://` lifecycle for deleted nodes.
 *
 * IndexedDB is origin-global and not scoped by scene, so cleanup must be
 * driven by the deletion lifecycle (not UI entry points): keyboard delete,
 * selection delete, MCP, panels, and group actions all go through
 * `deleteNodes` / committed node removals (#733).
 *
 * This module must not import `useScene` at module scope — it is called from
 * `node-actions`, and `use-scene` imports those actions (cycle).
 */
export const ASSET_URL_PREFIX = 'asset://'

/** Extract local asset URLs from a single node (url and src). */
export function collectNodeAssetUrls(node: AnyNode | undefined): string[] {
  if (!node) return []
  const urls: string[] = []
  const candidate = (node as { url?: unknown }).url
  if (typeof candidate === 'string' && candidate.startsWith(ASSET_URL_PREFIX)) {
    urls.push(candidate)
  }
  const src = (node as { src?: unknown }).src
  if (typeof src === 'string' && src.startsWith(ASSET_URL_PREFIX)) {
    urls.push(src)
  }
  return urls
}

/** Collect every `asset://` URL still referenced by the given node map. */
export function collectSceneAssetUrls(nodes: Record<string, AnyNode>): string[] {
  const urls: string[] = []
  for (const node of Object.values(nodes)) {
    urls.push(...collectNodeAssetUrls(node))
  }
  return urls
}

const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>()
const DELETE_GRACE_MS = 120_000
let deleteGraceMs = DELETE_GRACE_MS

/** Test-only: shrink the delayed-delete window so tests need not wait 120s. */
export function setLocalAssetDeleteGraceMsForTests(ms: number): void {
  deleteGraceMs = ms
}

/**
 * Bumped whenever a scene graph is applied (open, switch, remote apply).
 * IndexedDB is origin-global; a File scheduled for delete under one graph
 * may still be referenced by another saved scene, so a timer that fires
 * after a scene switch must not delete.
 */
let sceneEpoch = 0

export function bumpLocalAssetSceneEpoch(): number {
  sceneEpoch += 1
  return sceneEpoch
}

/**
 * Schedule deletion of a local `asset://` File after a grace period so undo
 * (which restores the node, not a new upload) can still load the blob.
 * Cancels any prior pending delete for the same URL.
 *
 * `isStillReferenced` is consulted when the timer fires (undo may have
 * restored the node). Callers that already checked the live graph can omit
 * it; the scene-epoch guard still applies.
 */
export function scheduleLocalAssetDelete(
  url: string,
  graceMs: number = deleteGraceMs,
  isStillReferenced?: () => boolean,
): void {
  if (!url.startsWith(ASSET_URL_PREFIX)) return
  const existing = pendingDeletes.get(url)
  if (existing) clearTimeout(existing)

  const scheduledEpoch = sceneEpoch
  const timer = setTimeout(() => {
    pendingDeletes.delete(url)
    if (scheduledEpoch !== sceneEpoch) return
    if (isStillReferenced?.()) return
    void deleteAsset(url)
  }, graceMs)
  pendingDeletes.set(url, timer)
}

/**
 * After nodes are removed from the live graph, schedule cleanup for any
 * local asset URLs those nodes carried that nothing else still references.
 *
 * `getRemainingNodes` must return the current (post-deletion) node map.
 */
export function scheduleLocalAssetCleanupForRemovedNodes(
  removedNodes: readonly AnyNode[],
  getRemainingNodes: () => Record<string, AnyNode>,
  graceMs: number = deleteGraceMs,
): void {
  const stillReferenced = new Set(collectSceneAssetUrls(getRemainingNodes()))
  for (const node of removedNodes) {
    for (const url of collectNodeAssetUrls(node)) {
      if (stillReferenced.has(url)) continue
      scheduleLocalAssetDelete(url, graceMs, () =>
        collectSceneAssetUrls(getRemainingNodes()).includes(url),
      )
    }
  }
}

/** Cancel a scheduled local asset delete (e.g. node reappeared via undo). */
export function cancelLocalAssetDelete(url: string): void {
  const existing = pendingDeletes.get(url)
  if (!existing) return
  clearTimeout(existing)
  pendingDeletes.delete(url)
}

/** Clear every pending delayed delete (tests / full scene teardown). */
export function clearPendingLocalAssetDeletes(): void {
  for (const timer of pendingDeletes.values()) clearTimeout(timer)
  pendingDeletes.clear()
}
