import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { audit } from '@panel/lib/auth/audit'
import { requirePermission } from '@panel/lib/auth/guard'
import { deliverTestMessage } from '@panel/lib/mail'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  /** Defaults to the administrator's own address — the safe thing to test with. */
  to: z.string().trim().email().max(320).optional(),
  lang: z.enum(['en', 'tr']).optional(),
})

/**
 * POST /api/settings/test-mail
 *
 * Proves delivery end to end without waiting for somebody to forget a
 * password. Restricted to `admin_access`: an open endpoint that sends mail to
 * an arbitrary address from the organisation's own domain is a spam relay.
 */
export const POST = handler(async (request: Request) => {
  const guard = await requirePermission('admin_access')
  if (!guard.ok) {
    return guard.reason === 'forbidden'
      ? fail('forbidden', 'err.forbidden')
      : fail('unauthenticated', 'err.sessionExpired')
  }

  const parsed = await parseBody(request, schema)
  if (!parsed.ok) return parsed.response

  const to = parsed.data.to ?? guard.session.user.email

  // Unlike every other message, a failure here is the answer, not a nuisance:
  // this endpoint exists to tell an administrator whether mail actually leaves
  // the building. Reporting "sent" after a timeout would be worse than useless.
  try {
    await deliverTestMessage({
      email: to,
      fullName: guard.session.user.name,
      lang: parsed.data.lang,
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[mail] test message to ${to} failed:`, err)
    await audit({
      actorUserId: guard.session.userId,
      actorLabel: guard.session.user.email,
      level: 'error',
      kind: 'settings',
      message: `Test message to ${to} failed: ${reason}`,
      event: { k: 'settingsChanged', p: { changes: `test mail failed → ${to}` } },
    })
    return fail('server_error', 'err.mailFailed', { reason })
  }

  await audit({
    actorUserId: guard.session.userId,
    actorLabel: guard.session.user.email,
    level: 'info',
    kind: 'settings',
    message: `Test message sent to ${to}`,
    event: { k: 'settingsChanged', p: { changes: `test mail → ${to}` } },
  })

  return ok({ sent: true, to })
})
