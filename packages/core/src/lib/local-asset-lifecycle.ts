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

/** Collect local references from JSON-shaped scene data, including plugin fields. */
export function collectLocalAssetUrls(value: unknown): string[] {
  const pending: unknown[] = [value]
  const urls: string[] = []
  const seen = new WeakSet<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === 'string' && current.startsWith(ASSET_URL_PREFIX)) {
      urls.push(current)
    } else if (current !== null && typeof current === 'object' && !seen.has(current)) {
      seen.add(current)
      for (const child of Object.values(current)) pending.push(child)
    }
  }
  return urls
}

export function collectNodeAssetUrls(node: AnyNode | undefined): string[] {
  return collectLocalAssetUrls(node)
}

export function collectSceneAssetUrls(nodes: Record<string, AnyNode>): string[] {
  return collectLocalAssetUrls(nodes)
}

export function collectGraphAssetUrlsFromParts(
  nodes: Record<string, AnyNode> | undefined,
  materials: unknown,
): string[] {
  return collectLocalAssetUrls([nodes, materials])
}
