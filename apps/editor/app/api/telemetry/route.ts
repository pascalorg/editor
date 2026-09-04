import { handler, ok, parseBody } from '@panel/lib/api'
import { telemetrySchema } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { getSession } from '@panel/lib/auth/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/telemetry — the browser error sink.
 *
 * Recorded with actor_label 'browser', as the contract specifies, which is also
 * what keeps it out of the "connected users" panel. The client suppresses
 * repeats for 5 s; this side additionally refuses to trust anything in the
 * payload beyond its shape — the message is truncated and never interpolated
 * into anything but the log text.
 *
 * Always answers 202, even unauthenticated: an error sink that fails when the
 * session has expired misses exactly the errors worth having.
 */
export const POST = handler(async (request: Request) => {
  const parsed = await parseBody(request, telemetrySchema)
  if (!parsed.ok) return ok({ accepted: false }, { status: 202 })

  const session = await getSession({ touch: false })
  const { message, source, line, column, stack } = parsed.data

  await audit({
    actorUserId: session?.userId ?? null,
    actorLabel: 'browser',
    level: 'error',
    kind: 'telemetry',
    message: `Browser error captured: ${message}`.slice(0, 1024),
    event: { k: 'browserError', p: { message: message.slice(0, 900) } },
    meta: {
      source: source?.slice(0, 512) ?? null,
      line: line ?? null,
      column: column ?? null,
      stack: stack?.slice(0, 2000) ?? null,
      user: session?.user.email ?? null,
    },
  })

  return ok({ accepted: true }, { status: 202 })
})
