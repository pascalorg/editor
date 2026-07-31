import { NextResponse } from 'next/server'
import { createSession, getSession } from '@/lib/mcp/sessions'
import { bearerToken, userForMcpToken } from '@/lib/mcp/tokens'

export const dynamic = 'force-dynamic'
// The transport streams and holds per-session state in memory, both of which
// need the Node runtime.
export const runtime = 'nodejs'

/**
 * Model Context Protocol endpoint, so an AI assistant can edit scenes through
 * the same operations the editor uses.
 *
 * Access is per user and granted from the admin panel: the bearer token
 * resolves to a person, and every scene the agent touches is scoped to them.
 * An agent therefore has exactly the reach of the account behind its token —
 * no more, and never the ownerless free-for-all the MCP tools would produce on
 * their own.
 *
 * A desktop MCP client sends no cookie and no Origin, so the usual same-origin
 * check does not apply here; the token is the whole of the authentication, and
 * it is the only credential this route accepts.
 */
async function handle(request: Request): Promise<Response> {
  const user = await userForMcpToken(bearerToken(request))
  if (!user) {
    return NextResponse.json(
      { error: 'mcp_access_required' },
      // WWW-Authenticate tells a compliant client this is an auth failure it
      // can act on, not a server fault to retry.
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="digitaltwin-mcp"' } },
    )
  }

  const sessionId = request.headers.get('mcp-session-id')
  if (sessionId) {
    const existing = getSession(sessionId, user.id)
    if (!existing) {
      // Expired, swept, or someone else's. Say so rather than silently opening
      // a fresh one, so the client re-initializes instead of losing edits.
      return NextResponse.json({ error: 'mcp_session_expired' }, { status: 404 })
    }
    return existing.transport.handleRequest(request)
  }

  const session = await createSession(user)
  return session.transport.handleRequest(request)
}

export const GET = handle
export const POST = handle
export const DELETE = handle
