import { type AnyNode, deleteAsset, useScene } from '@pascal-app/core'

/** Collect every `asset://` URL still referenced by a live scene node. */
export function collectSceneAssetUrls(
  nodes: Record<string, AnyNode> = useScene.getState().nodes,
): string[] {
  const urls: string[] = []
  for (const node of Object.values(nodes)) {
    const candidate = (node as { url?: unknown }).url
    if (typeof candidate === 'string' && candidate.startsWith('asset://')) {
      urls.push(candidate)
    }
    const src = (node as { src?: unknown }).src
    if (typeof src === 'string' && src.startsWith('asset://')) {
      urls.push(src)
    }
  }
  return urls
}

const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>()
const DELETE_GRACE_MS = 120_000

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

function isAssetStillReferenced(url: string): boolean {
  return collectSceneAssetUrls().includes(url)
}

/**
 * Schedule deletion of a local `asset://` File after a grace period so undo
 * (which restores the node, not a new upload) can still load the blob.
 * Cancels any prior pending delete for the same URL.
 *
 * Only call this when the last live node in the *current* graph that pointed
 * at the URL is gone. The timer re-checks live references and refuses to
 * delete if the scene epoch changed (another graph may still use the File).
 */
export function scheduleLocalAssetDelete(url: string, graceMs: number = DELETE_GRACE_MS): void {
  if (!url.startsWith('asset://')) return
  const existing = pendingDeletes.get(url)
  if (existing) clearTimeout(existing)

  const scheduledEpoch = sceneEpoch
  const timer = setTimeout(() => {
    pendingDeletes.delete(url)
    if (scheduledEpoch !== sceneEpoch) return
    if (isAssetStillReferenced(url)) return
    void deleteAsset(url)
  }, graceMs)
  pendingDeletes.set(url, timer)
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
