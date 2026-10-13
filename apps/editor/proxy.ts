import { type NextRequest, NextResponse } from 'next/server'
import { resolveAuthMode, sessionPrincipal } from '@/lib/self-host-auth'

/**
 * Self-host gate. Pages redirect to `/login` (or `/setup` when nothing is
 * configured); API routes answer JSON. The scene API is left to its own guard,
 * which also accepts the agents' bearer token.
 */
const OPEN_PATHS = new Set([
  '/login',
  '/setup',
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
])
const OPEN_PREFIXES = ['/embed/']
const SELF_GUARDED_API_PREFIXES = ['/api/scenes', '/api/artifacts']

export function proxy(request: NextRequest) {
  return gateRequest(request) ?? NextResponse.next()
}

export function gateRequest(request: Request): NextResponse | null {
  const url = new URL(request.url)
  const { pathname } = url
  if (OPEN_PATHS.has(pathname) || OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix)))
    return null
  if (SELF_GUARDED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null

  const mode = resolveAuthMode(request)
  if (mode === 'open') return null

  const isApi = pathname.startsWith('/api/')
  if (mode === 'unconfigured') {
    if (isApi) {
      return NextResponse.json({ error: 'self_host_unconfigured' }, { status: 503 })
    }
    return NextResponse.redirect(new URL('/setup', request.url))
  }

  if (sessionPrincipal(request)) return null
  if (isApi) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const login = new URL('/login', request.url)
  if (pathname !== '/') login.searchParams.set('next', `${pathname}${url.search}`)
  return NextResponse.redirect(login)
}

export const config = {
  // Everything except Next's own assets and files served from `public/`.
  matcher: ['/((?!_next/|.*\\.[a-zA-Z0-9]+$).*)'],
}
