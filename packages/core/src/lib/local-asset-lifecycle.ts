import type { AnyNode } from '../schema'

/**
 * Local `asset://` reference collection.
 *
 * IndexedDB is origin-global and not scoped by scene. Physical deletion must
 * only happen via an explicit GC that unions references from **every
 * persisted graph** (see `sweepLocalAssetsExcept` in asset-storage). This
 * module never deletes Files (#733 review).
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
