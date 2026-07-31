import { fail, handler, ok, parseBody } from '@panel/lib/api'
import type { ResetConfirmResponse } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { checkPasswordPolicy, hashPassword } from '@panel/lib/auth/password'
import { getSession, revokeAllSessions } from '@panel/lib/auth/session'
import { isEnrolled } from '@panel/lib/auth/totp'
import { exec } from '@panel/lib/db'
import { getSettings } from '@panel/lib/settings'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z
  .object({
    password: z.string().min(10).max(512),
    passwordAgain: z.string().min(10).max(512),
    revokeOtherSessions: z.boolean().default(true),
    acceptPolicy: z.boolean().default(false),
  })
  .refine((v) => v.password === v.passwordAgain, {
    path: ['passwordAgain'],
    params: { code: 'password_mismatch' },
    message: 'err.passwordMismatch',
  })

/**
 * POST /api/auth/password — the forced change on first sign-in.
 *
 * Distinct from /api/auth/reset/confirm, which is driven by an emailed token.
 * This one is driven by an authenticated session carrying must_change_password,
 * which is how a seeded or admin-provisioned account arrives with no invite link
 * in play. Either route sets the same column and clears the same flag.
 */
export const POST = handler(async (request: Request) => {
  const parsed = await parseBody(request, schema)
  if (!parsed.ok) return parsed.response

  const session = await getSession()
  if (!session || session.mfaPending) return fail('unauthenticated', 'err.sessionExpired')
  if (!parsed.data.acceptPolicy)
    return fail('validation', 'err.policyRequired', { field: 'acceptPolicy' })

  const policy = checkPasswordPolicy(
    parsed.data.password,
    session.user.username || session.user.email,
  )
  if (!policy.ok) return fail('password_policy', 'err.passwordPolicy', { policy })

  await exec(
    'UPDATE users SET password_hash = ?, password_set_at = NOW(), must_change_password = 0 WHERE id = ?',
    [await hashPassword(parsed.data.password), session.userId],
  )

  // Spare the current session — the user just proved themselves and should not
  // be thrown back to sign-in for changing their own password.
  const revokedSessions = parsed.data.revokeOtherSessions
    ? await revokeAllSessions(session.userId, session.id)
    : 0

  await audit({
    actorUserId: session.userId,
    actorLabel: session.user.email,
    level: 'info',
    kind: 'auth',
    message: 'Password changed on first sign-in',
    event: { k: 'passwordChangedFirst' },
    meta: { revokedSessions },
  })

  const settings = await getSettings()
  const mfaOwed = settings.mfaRequired && !(await isEnrolled(session.userId))

  const body: ResetConfirmResponse = {
    state: 'signedIn',
    next: mfaOwed ? 'mfa-setup' : 'console',
    revokedSessions,
  }
  return ok(body)
})
