import { fail, handler, ok } from '@panel/lib/api'
import type { SessionsResponse } from '@panel/lib/api-contract'
import { getSession, listSessions } from '@panel/lib/auth/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/auth/sessions — the signed-in user's own live sessions. */
export const GET = handler(async () => {
  const session = await getSession()
  if (!session || session.mfaPending) return fail('unauthenticated', 'err.sessionExpired')

  const body: SessionsResponse = { sessions: await listSessions(session.userId, session.id) }
  return ok(body)
})
