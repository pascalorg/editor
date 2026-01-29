import { loadAssetUrl } from '@pascal-app/core'
import { useEffect, useState } from 'react'

/**
 * Resolves an asset:// URL to a blob URL for use with Three.js loaders.
 * Returns null while loading or if resolution fails.
 */
export function useAssetUrl(url: string): string | null {
  const [resolved, setResolved] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setResolved(null)
    loadAssetUrl(url).then((result) => {
      if (!cancelled) setResolved(result)
    })
    return () => {
      cancelled = true
    }
  }, [url])

  return resolved
}
