import { loadAssetUrl } from '@pascal-app/core'

export const ASSETS_CDN_URL = process.env.NEXT_PUBLIC_ASSETS_CDN_URL?.replace(/\/$/, '') ?? ''

function resolveHostedPath(url: string) {
  const normalizedPath = url.startsWith('/') ? url : `/${url}`
  return ASSETS_CDN_URL ? `${ASSETS_CDN_URL}${normalizedPath}` : normalizedPath
}

/**
 * Resolves an asset URL to the appropriate format:
 * - If URL starts with http:// or https://, return as-is (external URL)
 * - If URL starts with asset://, resolve from IndexedDB storage
 * - If NEXT_PUBLIC_ASSETS_CDN_URL is configured, prepend it to hosted paths
 * - Otherwise, keep hosted paths same-origin
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

  return resolveHostedPath(url)
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

  return resolveHostedPath(url)
}
