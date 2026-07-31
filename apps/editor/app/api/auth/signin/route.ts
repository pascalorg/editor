import { fail, handler, ok, parseBody } from '@panel/lib/api'
import { type SignInResponse, signInSchema } from '@panel/lib/api-contract'
import { audit } from '@panel/lib/auth/audit'
import { clearFailures, lockStateFrom, registerFailure } from '@panel/lib/auth/lockout'
import { fakeVerify, verifyPassword } from '@panel/lib/auth/password'
import { createSession, getSession, hasTrustedDevice } from '@panel/lib/auth/session'
import { isEnrolled } from '@panel/lib/auth/totp'
import { findUserByIdentifier, pendingLabel } from '@panel/lib/auth/users'
import { getSettings, isSsoEnforced } from '@panel/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/signin
 *
 * Outcomes, in the order the state machine reaches them:
 *   mfaRequired  — credentials good, OTP step still owed
 *   firstSignIn  — credentials good, must_change_password set
 *   signedIn     — fully established session
 *
 * Every failure answers `invalid_credentials` with the same message regardless of
 * whether the account exists, and the miss path still pays the argon2 cost so the
 * response time does not leak existence either.
 */
export const POST = handler(async (request: Request) => {
  const parsed = await parseBody(request, signInSchema)
  if (!parsed.ok) return parsed.response

  const { identifier, password, keepSignedIn } = parsed.data
  const user = await findUserByIdentifier(identifier)

  if (!user) {
    await fakeVerify()
    await audit({
      actorLabel: identifier.slice(0, 64),
      level: 'warn',
      kind: 'auth',
      message: 'Sign-in failed — unknown identifier',
      event: { k: 'signInUnknown' },
    })
    return fail('invalid_credentials', 'err.credentials')
  }

  const lock = lockStateFrom(user.failed_attempts, user.locked_until)
  if (lock.locked) {
    return fail('account_locked', 'err.locked', { retryAfterSeconds: lock.retryAfterSeconds })
  }

  if (user.status === 'suspended') {
    await audit({
      actorUserId: user.id,
      actorLabel: user.email,
      level: 'warn',
      kind: 'auth',
      message: 'Sign-in refused — account suspended',
      event: { k: 'signInSuspended' },
    })
    return fail('account_suspended', 'err.suspended')
  }
  if (user.status === 'inactive') {
    return fail('account_inactive', 'err.inactive')
  }

  // An SSO-enforced domain means the password path is closed for this address —
  // checked before the hash so a correct password still cannot slip through.
  if (await isSsoEnforced(user.email)) {
    return fail('sso_required', 'err.ssoRequired', { domain: user.email.split('@')[1] ?? null })
  }

  // An invited account has no password yet; it can only arrive through the
  // invite link, which lands on /welcome and sets one.
  if (user.status === 'invited' || !user.password_hash) {
    await fakeVerify()
    return fail('invalid_credentials', 'err.credentials')
  }

  if (!(await verifyPassword(user.password_hash, password))) {
    const next = await registerFailure(user.id)
    await audit({
      actorUserId: user.id,
      actorLabel: user.email,
      level: 'warn',
      kind: 'auth',
      message: `Sign-in failed — wrong password (attempt ${next.failedAttempts})`,
      event: { k: 'signInWrongPassword', p: { attempt: next.failedAttempts } },
    })
    return next.locked
      ? fail('account_locked', 'err.locked', { retryAfterSeconds: next.retryAfterSeconds })
      : fail('invalid_credentials', 'err.credentials', { attemptsLeft: next.attemptsLeft })
  }

  await clearFailures(user.id)

  const settings = await getSettings()
  const enrolled = await isEnrolled(user.id)
  const trusted = enrolled && (await hasTrustedDevice(user.id))
  // MFA is owed when the org requires it or the user already enrolled — unless a
  // live trusted-device grant covers this account.
  const mfaOwed = (settings.mfaRequired || enrolled) && !trusted

  await createSession({ userId: user.id, keepSignedIn, mfaPending: mfaOwed })

  await audit({
    actorUserId: user.id,
    actorLabel: user.email,
    level: 'info',
    kind: 'auth',
    message: mfaOwed ? 'Password accepted — awaiting two-factor' : 'Signed in',
    event: { k: mfaOwed ? 'signInAwaitingMfa' : 'signedIn' },
    meta: { keepSignedIn, trustedDevice: trusted },
  })

  if (mfaOwed) {
    const body: SignInResponse = {
      state: 'mfaRequired',
      pendingLabel: pendingLabel(user),
      enrolmentRequired: !enrolled,
    }
    return ok(body)
  }

  // Session is live from here, so re-reading it gives the client the same
  // SessionUser shape GET /api/auth/session returns.
  const session = await getSession({ touch: false })
  const body: SignInResponse = {
    state: user.must_change_password === 1 ? 'firstSignIn' : 'signedIn',
    user: session?.user,
  }
  return ok(body)
})
