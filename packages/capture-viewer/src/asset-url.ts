export function rewriteLoopbackAssetUrl(value: string): string {
  try {
    const url = new URL(value)
    if (
      typeof window !== 'undefined' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    ) {
      url.hostname = window.location.hostname
    }
    return url.toString()
  } catch {
    return value
  }
}
