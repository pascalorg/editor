import { del, get, keys, set } from 'idb-keyval'
import { customAlphabet } from 'nanoid'

export const ASSET_PREFIX = 'asset_data:'

// Cache for active object URLs to prevent leaks and flickering
const urlCache = new Map<string, string>()

// Unlike crypto.randomUUID(), nanoid works outside secure contexts.
const nanoAssetId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16)

function assetIdFromUrl(url: string): string | null {
  if (!url.startsWith('asset://')) return null
  return url.replace('asset://', '') || null
}

function revokeCachedObjectUrl(id: string) {
  const objectUrl = urlCache.get(id)
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    urlCache.delete(id)
  }
}

/**
 * Save a file to IndexedDB and return a custom protocol URL
 */
export async function saveAsset(file: File): Promise<string> {
  const id = nanoAssetId()
  await set(`${ASSET_PREFIX}${id}`, file)
  return `asset://${id}`
}

/**
 * Load a file from IndexedDB and return an object URL
 * If the URL is not a custom protocol URL, return it as is
 */
export async function loadAssetUrl(url: string): Promise<string | null> {
  if (!url) return null

  // If it's already a blob or http URL, return as is
  if (url.startsWith('blob:') || url.startsWith('http')) {
    return url
  }

  // Handle our custom asset protocol
  const id = assetIdFromUrl(url)
  if (id) {
    // Check cache first
    if (urlCache.has(id)) {
      return urlCache.get(id)!
    }

    try {
      const file = await get<File | Blob>(`${ASSET_PREFIX}${id}`)
      if (!file) {
        console.warn(`Asset not found: ${id}`)
        return null
      }
      const objectUrl = URL.createObjectURL(file)
      urlCache.set(id, objectUrl)
      return objectUrl
    } catch (error) {
      console.error('Failed to load asset:', error)
      return null
    }
  }

  // Legacy data URLs are returned as is
  return url
}

/**
 * Delete a locally stored `asset://` file from IndexedDB and drop any cached
 * object URL. No-op for non-asset URLs.
 *
 * Callers must only invoke this when no *persisted* scene still references
 * the URL — IndexedDB is origin-global and not scoped by project (#733).
 */
export async function deleteAsset(url: string): Promise<boolean> {
  const id = assetIdFromUrl(url)
  if (!id) return false
  revokeCachedObjectUrl(id)
  try {
    await del(`${ASSET_PREFIX}${id}`)
    return true
  } catch (error) {
    console.error('Failed to delete asset:', error)
    return false
  }
}

/** Every `asset://` id currently stored in IndexedDB. */
export async function listLocalAssetUrls(): Promise<string[]> {
  try {
    const allKeys = await keys()
    const urls: string[] = []
    for (const key of allKeys) {
      if (typeof key === 'string' && key.startsWith(ASSET_PREFIX)) {
        urls.push(`asset://${key.slice(ASSET_PREFIX.length)}`)
      }
    }
    return urls
  } catch (error) {
    console.error('Failed to list local assets:', error)
    return []
  }
}

/**
 * Explicit garbage collection: delete every local asset URL not in
 * `keepUrls`.
 *
 * `keepUrls` MUST be the union of asset references across **every persisted
 * graph** the origin can still open (current scene, localStorage scene,
 * server scenes). A keep-set built from only the active graph will corrupt
 * other projects that share an `asset://` handle after duplication (#733).
 */
export async function sweepLocalAssetsExcept(keepUrls: Iterable<string>): Promise<number> {
  const keep = new Set<string>()
  for (const url of keepUrls) {
    if (typeof url === 'string' && url.startsWith('asset://')) keep.add(url)
  }

  let removed = 0
  try {
    for (const url of await listLocalAssetUrls()) {
      if (keep.has(url)) continue
      if (await deleteAsset(url)) removed += 1
    }
  } catch (error) {
    console.error('Failed to sweep local assets:', error)
  }
  return removed
}
