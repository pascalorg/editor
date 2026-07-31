import type { SessionUser } from '@/lib/auth/session'
import { getSceneStore } from '@/lib/scene-store-server'
import { ownerScopedStore } from './owner-scoped-store'

/**
 * An MCP conversation is stateful: the agent loads a scene, edits it over
 * several calls, then saves. That working scene lives in a `SceneBridge` held
 * in memory, so it has to survive between HTTP requests — the transport's
 * session id is what ties them together.
 *
 * The host runs one long-lived Node process, so an in-process map is the right
 * shape. Sessions are dropped on idle rather than kept forever: an abandoned
 * desktop client would otherwise pin a scene graph in memory indefinitely.
 */

const IDLE_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
const MAX_SESSIONS = 64

interface McpSession {
  userId: string
  transport: { handleRequest(req: Request): Promise<Response> }
  lastSeen: number
  close(): Promise<void>
}

const sessions = new Map<string, McpSession>()

function sweep(now: number): void {
  for (const [id, session] of sessions) {
    if (now - session.lastSeen > IDLE_TIMEOUT_MS) {
      sessions.delete(id)
      void session.close().catch(() => {})
    }
  }
  // A hard cap as well as a timeout: many short-lived clients could otherwise
  // accumulate faster than the idle sweep retires them.
  while (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0]
    if (!oldest) break
    sessions.delete(oldest[0])
    void oldest[1].close().catch(() => {})
  }
}

export function getSession(id: string, userId: string): McpSession | null {
  const session = sessions.get(id)
  if (!session) return null
  // A session id is a bearer of its own; refuse to hand one user another's
  // in-flight scene even if they somehow learned the id.
  if (session.userId !== userId) return null
  session.lastSeen = Date.now()
  return session
}

/**
 * Builds an MCP server bound to one user and attaches it to a Web-standard
 * streamable transport, which takes a `Request` and returns a `Response` —
 * exactly what a route handler has, with no Node req/res shim in between.
 */
export async function createSession(user: SessionUser): Promise<McpSession> {
  const [{ SceneBridge }, { createPascalMcpServer }, { WebStandardStreamableHTTPServerTransport }] =
    await Promise.all([
      import('@pascal-app/mcp/bridge'),
      import('@pascal-app/mcp/server'),
      import('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'),
    ])

  const store = ownerScopedStore(await getSceneStore(), user.id)
  const bridge = new SceneBridge()
  const server = createPascalMcpServer({ bridge, store })

  let sessionId: string | null = null
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id: string) => {
      sessionId = id
      const now = Date.now()
      sessions.set(id, entry)
      entry.lastSeen = now
      sweep(now)
    },
  })

  const entry: McpSession = {
    userId: user.id,
    transport,
    lastSeen: Date.now(),
    close: async () => {
      if (sessionId) sessions.delete(sessionId)
      await server.close().catch(() => {})
    },
  }

  await server.connect(transport)
  return entry
}

/** Test seam: drop every session without waiting for the idle sweep. */
export function clearSessions(): void {
  for (const session of sessions.values()) void session.close().catch(() => {})
  sessions.clear()
}
