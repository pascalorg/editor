import { guardSceneApiRequest } from './scene-api-security'

/**
 * Applies the scene API guard (origin, loopback-or-token auth, rate limit) to
 * the server-rendered scene pages, which read scenes straight from
 * `getSceneOperations()` instead of going through `/api/scenes`. Server
 * components have no `Request`, so one is rebuilt from the incoming headers.
 * Returns the HTTP status the API would answer with, or `null` when allowed.
 */
export function guardScenePage(requestHeaders: Headers, pathname: string): number | null {
  const host = requestHeaders.get('host')
  if (!host) return 400
  const proto = requestHeaders.get('x-forwarded-proto') ?? 'http'
  const request = new Request(`${proto}://${host}${pathname}`, { headers: requestHeaders })
  return guardSceneApiRequest(request)?.status ?? null
}
