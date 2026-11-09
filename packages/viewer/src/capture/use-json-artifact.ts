import { useEffect, useState } from 'react'
import { FileLoader } from 'three'
import { rewriteLoopbackAssetUrl } from './asset-url'

const requests = new Map<string, Promise<unknown>>()

function loadJsonArtifact(url: string): Promise<unknown> {
  const cached = requests.get(url)
  if (cached) return cached
  const request = new FileLoader().setResponseType('json').loadAsync(url)
  requests.set(url, request)
  // Keep successful downloads across view switches, but let a remount retry failures.
  void request.catch(() => requests.delete(url))
  return request
}

export function useJsonArtifactPayload(url: string | null): unknown {
  const resolvedUrl = url ? rewriteLoopbackAssetUrl(url) : null
  const [result, setResult] = useState<{
    url: string
    payload?: unknown
    error?: Error
  } | null>(null)

  useEffect(() => {
    if (!resolvedUrl) return
    let active = true
    void loadJsonArtifact(resolvedUrl).then(
      (payload) => {
        if (active) setResult({ url: resolvedUrl, payload })
      },
      (cause: unknown) => {
        if (active) {
          setResult({
            url: resolvedUrl,
            error: cause instanceof Error ? cause : new Error('Could not load capture data.'),
          })
        }
      },
    )
    return () => {
      active = false
    }
  }, [resolvedUrl])

  if (!result || result.url !== resolvedUrl) return null
  if (result.error) throw result.error
  return result.payload ?? null
}
