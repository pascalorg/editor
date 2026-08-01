import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { type MfaVerifyResponse, mfaVerifySchema } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { clearFailures, registerFailure } from '@panel/lib/auth/lockout'
import { clearMfaPending, getSession } from '@panel/lib/auth/session'
import { confirmEnrolment, isEnrolled, verifyTotp } from '@panel/lib/auth/totp'
import { exec } from '@panel/lib/db'
import { deliverTwoFactorChanged } from '@panel/lib/mail'
import { getSettings } from '@panel/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/mfa/verify — one endpoint, two moments.
 *
 * Enrolment: the secret exists but is unconfirmed, so a correct code confirms
 * it and returns the recovery set. That set is shown once and never again,
 * which is why it is returned here rather than fetchable later.
 *
 * Sign-in: the secret is already confirmed, so a correct code simply clears
 * `mfa_pending` on the session that is already open.
 *
 * A wrong code counts against the same lockout counter as a wrong password —
 * an attacker holding the password must not get unlimited guesses at the
 * second factor.
 */
export const POST = handler(async (request: Request) => {
  const parsed = await parseBody(request, mfaVerifySchema)
  if (!parsed.ok) return parsed.response

  const session = await getSession({ touch: false })
  if (!session) return fail('unauthenticated', 'err.sessionExpired')

  const enrolling = !(await isEnrolled(session.userId))

  const recoveryCodes = enrolling
    ? await confirmEnrolment(session.userId, session.user.email, parsed.data.code)
    : null
  const accepted = enrolling
    ? recoveryCodes !== null
    : await verifyTotp(session.userId, session.user.email, parsed.data.code)

  if (!accepted) {
    const lock = await registerFailure(session.userId)
    await audit({
      actorUserId: session.userId,
      actorLabel: session.user.email,
      level: 'warn',
      kind: 'auth',
      message: 'Two-factor code rejected',
      event: { k: 'mfaCodeRejected' },
    })
    return lock.locked
      ? fail('account_locked', 'err.locked', { retryAfterSeconds: lock.retryAfterSeconds })
      : fail('mfa_invalid', 'err.mfaInvalid', { attemptsLeft: lock.attemptsLeft })
  }

  await clearFailures(session.userId)
  await clearMfaPending(session.id)

  // "Trust this device" is a grant on this session alone; the window comes from
  // the organisation's settings rather than being hard-coded here.
  if (parsed.data.trustDevice) {
    const { trustedDeviceDays } = await getSettings()
    await exec('UPDATE sessions SET trusted_until = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id = ?', [
      trustedDeviceDays,
      session.id,
    ])
  }

  await audit({
    actorUserId: session.userId,
    actorLabel: session.user.email,
    level: 'info',
    kind: 'auth',
    message: enrolling ? 'Two-factor enrolled' : 'Signed in — two-factor cleared',
    event: { k: enrolling ? 'mfaEnrolled' : 'signedInMfaCleared' },
    meta: { trustDevice: parsed.data.trustDevice },
  })

  if (enrolling) {
    await deliverTwoFactorChanged({
      email: session.user.email,
      fullName: session.user.name,
      enabled: true,
    })
  }

  // Re-read so the client gets the session in its post-verification shape.
  const fresh = await getSession({ touch: false })
  const body: MfaVerifyResponse = {
    state: fresh?.state === 'firstSignIn' ? 'firstSignIn' : 'signedIn',
    user: fresh?.user,
    ...(recoveryCodes ? { recoveryCodes } : {}),
  }
  return ok(body)
})
