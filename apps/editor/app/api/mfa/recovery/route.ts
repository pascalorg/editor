import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { type MfaRecoveryResponse, mfaRecoverySchema } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { clearFailures, readLockState, registerFailure } from '@panel/lib/auth/lockout'
import { clearMfaPending, getSession } from '@panel/lib/auth/session'
import { consumeRecoveryCode } from '@panel/lib/auth/totp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/mfa/recovery — the way in when the authenticator is gone.
 *
 * A code is spent whether or not it was the last one: they are single-use by
 * definition, and the count that comes back is what lets the screen say how
 * many are left before somebody is locked out for good.
 */
export const POST = handler(async (request: Request) => {
  const parsed = await parseBody(request, mfaRecoverySchema)
  if (!parsed.ok) return parsed.response

  const session = await getSession({ touch: false })
  if (!session) return fail('unauthenticated', 'err.sessionExpired')

  // The lock is consulted BEFORE the code is spent. Checking it only on the
  // failure path — which is what this route used to do — counts misses and
  // reports "locked" while still admitting whoever eventually guesses right,
  // so the lock reported a state it did not enforce. Recovery codes are the
  // one credential that survives losing the authenticator, so an unbounded
  // guessing budget here is the weakest point in the second factor.
  const gate = await readLockState(session.userId)
  if (gate.locked) {
    return fail('account_locked', 'err.locked', { retryAfterSeconds: gate.retryAfterSeconds })
  }

  const result = await consumeRecoveryCode(session.userId, parsed.data.code)

  if (!result.ok) {
    const lock = await registerFailure(session.userId)
    await audit({
      actorUserId: session.userId,
      actorLabel: session.user.email,
      level: 'warn',
      kind: 'auth',
      message: 'Recovery code rejected',
      event: { k: 'recoveryRejected' },
    })
    return lock.locked
      ? fail('account_locked', 'err.locked', { retryAfterSeconds: lock.retryAfterSeconds })
      : fail('recovery_invalid', 'err.recoveryInvalid', { attemptsLeft: lock.attemptsLeft })
  }

  await clearFailures(session.userId)
  await clearMfaPending(session.id)

  await audit({
    actorUserId: session.userId,
    actorLabel: session.user.email,
    level: 'warn',
    kind: 'auth',
    message: 'Signed in with a recovery code',
    event: { k: 'recoveryUsed' },
    meta: { remaining: result.remaining },
  })

  const fresh = await getSession({ touch: false })
  const body: MfaRecoveryResponse = {
    state: fresh?.state === 'firstSignIn' ? 'firstSignIn' : 'signedIn',
    user: fresh?.user,
    codesRemaining: result.remaining,
  }
  return ok(body)
})
