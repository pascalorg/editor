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

/** Max nesting when walking a node for `asset://` strings (guards cycles). */
const MAX_ASSET_WALK_DEPTH = 8

function collectAssetUrlsDeep(
  value: unknown,
  urls: string[],
  depth: number,
  seen: WeakSet<object>,
): void {
  if (depth > MAX_ASSET_WALK_DEPTH) return
  if (typeof value === 'string') {
    if (value.startsWith(ASSET_URL_PREFIX)) urls.push(value)
    return
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectAssetUrlsDeep(item, urls, depth + 1, seen)
    return
  }
  for (const nested of Object.values(value)) {
    collectAssetUrlsDeep(nested, urls, depth + 1, seen)
  }
}

/**
 * Extract every `asset://` URL referenced by a node, including nested fields
 * (`item.asset.src` / `thumbnail`, `scan.captureSession.manifestUrl`, …).
 */
export function collectNodeAssetUrls(node: AnyNode | undefined): string[] {
  if (!node) return []
  const urls: string[] = []
  collectAssetUrlsDeep(node, urls, 0, new WeakSet<object>())
  return urls
}

/** Collect every `asset://` URL still referenced by the given node map. */
export function collectSceneAssetUrls(nodes: Record<string, AnyNode>): string[] {
  const urls: string[] = []
  const seen = new WeakSet<object>()
  for (const node of Object.values(nodes)) {
    collectAssetUrlsDeep(node, urls, 0, seen)
  }
  return urls
}

/**
 * Collect `asset://` URLs from a whole scene graph (nodes **and** materials
 * texture maps).
 */
export function collectGraphAssetUrlsFromParts(
  nodes: Record<string, AnyNode> | undefined,
  materials: unknown,
): string[] {
  const urls: string[] = []
  const seen = new WeakSet<object>()
  if (nodes) {
    for (const node of Object.values(nodes)) {
      collectAssetUrlsDeep(node, urls, 0, seen)
    }
  }
  collectAssetUrlsDeep(materials, urls, 0, seen)
  return urls
}
