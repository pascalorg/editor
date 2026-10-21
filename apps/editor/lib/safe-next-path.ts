/**
 * The post-login destination, reduced to a path on `origin`. Anything that
 * parses to another origin (or fails to parse) falls back to `/`.
 */
export function safeNextPath(next: string | undefined, origin: string): string {
  if (!next?.startsWith('/')) return '/'
  let target: URL
  try {
    target = new URL(next, origin)
    if (target.origin !== new URL(origin).origin) return '/'
  } catch {
    return '/'
  }
  const path = `${target.pathname}${target.search}${target.hash}`
  // A normalised path like `//host` would read as protocol-relative to the client router.
  return path.startsWith('//') ? '/' : path
}
