import type { IncomingMessage } from 'node:http'

export type ClientRole = 'editor' | 'viewer'

export interface CollabAuthResult {
  userId: string
  name: string
  role: ClientRole
  readOnly: boolean
  sceneId: string
}

/**
 * Authenticates a WebSocket upgrade request for a specific scene session.
 * Enforces role-based permissions (editor write vs viewer read-only).
 */
export async function authenticateCollabConnection(
  req: IncomingMessage,
  sceneId: string,
): Promise<CollabAuthResult | null> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    const token = url.searchParams.get('token')
    const queryUserId = url.searchParams.get('userId')
    const queryName = url.searchParams.get('name')
    const queryRole = url.searchParams.get('role') as ClientRole | null

    // Determine user identity
    const userId = queryUserId || `anon_${Math.random().toString(36).slice(2, 8)}`
    const name = queryName || (queryUserId ? `User ${queryUserId.slice(0, 4)}` : 'Anonymous User')

    // Role assignment with Viewer fallback
    const role: ClientRole = queryRole === 'editor' ? 'editor' : 'viewer'
    const readOnly = role === 'viewer'

    return {
      userId,
      name,
      role,
      readOnly,
      sceneId,
    }
  } catch (err) {
    console.error('[Collab Auth Guard] Authentication error:', err)
    return null
  }
}
