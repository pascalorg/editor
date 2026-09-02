import { get, set } from 'idb-keyval'
import { customAlphabet } from 'nanoid'

export const ASSET_PREFIX = 'asset_data:'

// Cache for active object URLs to prevent leaks and flickering
const urlCache = new Map<string, string>()

// Unlike crypto.randomUUID(), nanoid works outside secure contexts.
const nanoAssetId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16)

/**
 * `crypto.randomUUID` exists only in secure contexts, and an editor served
 * over plain http on a LAN is not one — the first line of every upload threw
 * `TypeError` and the user saw "Could not add that guide image" with no cause.
 * `getRandomValues` is NOT secure-context-gated, so the fallback keeps the
 * same entropy; the id only needs uniqueness, never secrecy.
 */
function randomAssetId(): string {
  const webCrypto = globalThis.crypto
  if (webCrypto?.randomUUID) return webCrypto.randomUUID()
  const bytes = webCrypto?.getRandomValues?.(new Uint8Array(16))
  if (bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
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
  if (url.startsWith('asset://')) {
    const id = url.replace('asset://', '')

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
