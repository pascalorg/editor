/**
 * The origin this editor is reached at, resolved per request so one build
 * serves any domain. `PASCAL_PUBLIC_URL` wins; otherwise the proxy's forwarded
 * headers, then the request's own host.
 */
export function resolvePublicUrl(request: Request): string {
  const configured = process.env.PASCAL_PUBLIC_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const forwardedHost = request.headers.get('x-forwarded-host')
  const host = forwardedHost ?? request.headers.get('host') ?? new URL(request.url).host
  const proto =
    request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '')
  return `${proto}://${host}`
}
