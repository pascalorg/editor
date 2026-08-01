import { fail, handler, ok } from '@panel/lib/api'
import type { MfaSetupResponse } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { getSession } from '@panel/lib/auth/session'
import { isEnrolled, startEnrolment } from '@panel/lib/auth/totp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/mfa/setup — mints the secret the enrolment screen renders.
 *
 * Reachable with a half-open session on purpose: a person whose organisation
 * requires two-factor arrives here from sign-in with `mfaPending` still set,
 * and demanding a complete session to finish becoming complete is a deadlock.
 * Nothing here grants access — the secret is unconfirmed until /verify.
 *
 * Refuses when already enrolled, so a live second factor can never be replaced
 * by anyone holding only the first one.
 */
export const POST = handler(async () => {
  const session = await getSession({ touch: false })
  if (!session) return fail('unauthenticated', 'err.sessionExpired')

  if (await isEnrolled(session.userId)) return fail('conflict', 'err.mfaAlreadyEnrolled')

  const { qrDataUrl, manualKey } = await startEnrolment(session.userId, session.user.email)

  await audit({
    actorUserId: session.userId,
    actorLabel: session.user.email,
    level: 'info',
    kind: 'auth',
    message: 'Two-factor enrolment started',
    event: { k: 'mfaEnrolStarted' },
  })

  const body: MfaSetupResponse = { qrDataUrl, manualKey }
  return ok(body)
})
