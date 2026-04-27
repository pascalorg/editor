import { loadAssetUrl } from '@pascal-app/core'

export const ASSETS_CDN_URL = process.env.NEXT_PUBLIC_ASSETS_CDN_URL || 'https://editor.pascal.app'

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

function getPreferredAssetOrigin(): string {
  if (typeof window === 'undefined') {
    return ASSETS_CDN_URL
  }

  try {
    const currentOrigin = new URL(window.location.origin)
    // App-served public assets should stay on the active loopback origin in
    // local dev, even when production points at a remote CDN host.
    if (isLoopbackHost(currentOrigin.hostname)) {
      return currentOrigin.origin
    }
  } catch {
    return ASSETS_CDN_URL
  }

  return ASSETS_CDN_URL
}

/**
 * Resolves an asset URL to the appropriate format:
 * - If URL starts with http:// or https://, return as-is (external URL)
 * - If URL starts with asset://, resolve from IndexedDB storage
 * - If URL starts with /, prepend CDN URL (absolute path)
 * - Otherwise, prepend CDN URL (relative path)
 */
export async function resolveAssetUrl(url: string | undefined | null): Promise<string | null> {
  if (!url) return null

  // External URL - use as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  // IndexedDB asset - resolve from storage
  if (url.startsWith('asset://')) {
    return loadAssetUrl(url)
  }

  // Absolute or relative path - prepend CDN URL
  const normalizedPath = url.startsWith('/') ? url : `/${url}`
  return `${getPreferredAssetOrigin()}${normalizedPath}`
}

/**
 * Synchronous version for URLs that don't need IndexedDB resolution
 * Only use this if you're sure the URL is not an asset:// URL
 */
export function resolveCdnUrl(url: string | undefined | null): string | null {
  if (!url) return null

  // External URL - use as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  // Don't use this for asset:// URLs - use resolveAssetUrl instead
  if (url.startsWith('asset://')) {
    console.warn('Use resolveAssetUrl() for asset:// URLs, not resolveCdnUrl()')
    return null
  }

  // Absolute or relative path - prepend CDN URL
  const normalizedPath = url.startsWith('/') ? url : `/${url}`
  return `${getPreferredAssetOrigin()}${normalizedPath}`
}
