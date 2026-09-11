import { type AnyNode, deleteAsset, sweepOrphanAssets, useScene } from '@pascal-app/core'

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

/**
 * Drop IndexedDB assets no longer referenced by the scene (issue #733).
 * Intended for scene-load: undo restores nodes in-session without re-running
 * this sweep, so a mid-session undo still finds its File.
 */
export async function sweepUnreferencedSceneAssets(): Promise<number> {
  return sweepOrphanAssets(collectSceneAssetUrls())
}

const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>()
const DELETE_GRACE_MS = 120_000

function isAssetStillReferenced(url: string): boolean {
  return collectSceneAssetUrls().includes(url)
}

/**
 * Schedule deletion of a local `asset://` File after a grace period so undo
 * (which restores the node, not a new upload) can still load the blob.
 * Cancels any prior pending delete for the same URL.
 */
export function scheduleLocalAssetDelete(url: string, graceMs: number = DELETE_GRACE_MS): void {
  if (!url.startsWith('asset://')) return
  const existing = pendingDeletes.get(url)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    pendingDeletes.delete(url)
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
