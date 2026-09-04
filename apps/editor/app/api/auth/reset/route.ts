import { handler, ok, parseBody } from '@panel/lib/api'
import { type ResetRequestResponse, resetRequestSchema } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { issueReset } from '@panel/lib/auth/reset'
import { findUserByEmail } from '@panel/lib/auth/users'
import { deliverResetLink } from '@panel/lib/mail'
import { headers } from 'next/headers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/reset — "send me a reset link".
 *
 * Always 202 with the same body. Whether the address exists, is suspended or has
 * never been registered is not disclosed; the screen says "a link is on its way"
 * either way. Only the audit trail records which branch actually ran.
 */
export const POST = handler(async (request: Request) => {
  const parsed = await parseBody(request, resetRequestSchema)
  if (!parsed.ok) return parsed.response

  const email = parsed.data.email.trim().toLowerCase()
  const user = await findUserByEmail(email)
  const eligible = user !== null && user.status !== 'suspended' && user.status !== 'inactive'

  if (eligible) {
    const h = await headers()
    const { token, expiresAt } = await issueReset(
      user.id,
      h.get('x-forwarded-for') ?? h.get('x-real-ip'),
    )
    await deliverResetLink({ email: user.email, fullName: user.full_name, token, expiresAt })
    await audit({
      actorUserId: user.id,
      actorLabel: user.email,
      level: 'info',
      kind: 'auth',
      message: 'Password reset link issued',
      event: { k: 'resetIssued' },
    })
  } else {
    await audit({
      actorLabel: email.slice(0, 64),
      level: 'warn',
      kind: 'auth',
      message: 'Password reset requested for an address that cannot receive one',
      event: { k: 'resetUnroutable' },
    })
  }

  const body: ResetRequestResponse = { accepted: true }
  return ok(body, { status: 202 })
})
