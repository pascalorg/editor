import { get, set } from 'idb-keyval'
import { customAlphabet } from 'nanoid'

export const ASSET_PREFIX = 'asset_data:'

// Cache for active object URLs to prevent leaks and flickering
const urlCache = new Map<string, string>()

// Unlike crypto.randomUUID(), nanoid works outside secure contexts.
const nanoAssetId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16)

/**
 * Save a file to IndexedDB and return a custom protocol URL
 */
/**
 * Stored shape for assets. Raw bytes go through the portable structured-clone
 * path, which every IndexedDB implementation supports; File/Blob records do
 * not (WebKit has rejected them). The content type is kept so the object URL
 * served later still carries the original MIME type.
 */
export interface StoredAssetRecord {
  assetVersion: 1
  bytes: ArrayBuffer
  type: string
}

function isStoredAssetRecord(value: unknown): value is StoredAssetRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as StoredAssetRecord).assetVersion === 1 &&
    (value as StoredAssetRecord).bytes instanceof ArrayBuffer &&
    typeof (value as StoredAssetRecord).type === 'string'
  )
}

/**
 * Turn whatever is in IndexedDB back into a Blob. Records written before the
 * byte format existed are plain File/Blob objects and stay readable.
 */
function toBlob(value: unknown): Blob | null {
  if (value instanceof Blob) return value
  if (isStoredAssetRecord(value)) return new Blob([value.bytes], { type: value.type })
  return null
}

/**
 * Save a file to IndexedDB and return a custom protocol URL
 */
export async function saveAsset(file: File): Promise<string> {
  const id = nanoAssetId()
  const record: StoredAssetRecord = {
    assetVersion: 1,
    bytes: await file.arrayBuffer(),
    type: file.type,
  }
  await set(`${ASSET_PREFIX}${id}`, record)
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
  if (url.startsWith('asset://')) {
    const id = url.replace('asset://', '')

    // Check cache first
    if (urlCache.has(id)) {
      return urlCache.get(id)!
    }

    try {
      const stored = await get<unknown>(`${ASSET_PREFIX}${id}`)
      if (!stored) {
        console.warn(`Asset not found: ${id}`)
        return null
      }
      const blob = toBlob(stored)
      if (!blob) {
        console.warn(`Asset ${id} has an unreadable record`)
        return null
      }
      const objectUrl = URL.createObjectURL(blob)
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
